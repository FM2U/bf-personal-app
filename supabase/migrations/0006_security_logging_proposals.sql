-- 0006: Row Level Security on every table, change log, updated_at triggers,
-- AI proposal approval function, and the single-owner rule.

-- Change log: one row per changed field, with old value, new value, and actor.
create or replace function public.log_change()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
  k text;
  v_actor text := public.current_actor();
  secret_fields text[] := array['refresh_token_enc', 'access_token_enc', 'token_hash', 'token_encrypted', 'sync_cursor'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - secret_fields;
    insert into public.change_log (owner_id, table_name, record_id, action, new_value, actor)
    values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'insert', v_new, v_actor);
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - secret_fields;
    v_new := to_jsonb(new) - secret_fields;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_old -> k) is distinct from (v_new -> k) then
        insert into public.change_log (owner_id, table_name, record_id, action, field, old_value, new_value, actor)
        values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'update', k, v_old -> k, v_new -> k, v_actor);
      end if;
    end loop;
    return new;
  else
    -- Skip when the owner account itself is being deleted.
    if exists (select 1 from auth.users where id = old.owner_id) then
      v_old := to_jsonb(old) - secret_fields;
      insert into public.change_log (owner_id, table_name, record_id, action, old_value, actor)
      values (old.owner_id, tg_table_name, (v_old ->> 'id')::uuid, 'delete', v_old, v_actor);
    end if;
    return old;
  end if;
end;
$$;

-- Apply RLS, updated_at, and change log to every table that has owner_id.
do $$
declare
  t record;
  no_log text[] := array['change_log', 'input_history', 'stage_history', 'ai_messages', 'ai_usage', 'raw_import_rows', 'daily_plans'];
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'owner_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format(
      'create policy owner_only on public.%I for all to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id))',
      t.table_name
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.table_name);
    execute format('grant all on public.%I to service_role', t.table_name);
    execute format('revoke all on public.%I from anon', t.table_name);

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t.table_name and column_name = 'updated_at') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t.table_name);
    end if;

    if not (t.table_name = any (no_log)) then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t.table_name);
    end if;
  end loop;
end $$;

grant select on public.account_current_balances, public.monthly_category_totals, public.deal_financials_calculated to authenticated, service_role;
revoke all on public.account_current_balances, public.monthly_category_totals, public.deal_financials_calculated from anon;

-- AI proposals: the AI never writes records. Bram approves a proposal, and this function applies it
-- inside one transaction, marking the change log actor as 'ai'. Runs with Bram's permissions (RLS applies).
create or replace function public.apply_proposal(p_id uuid, p_overrides jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  p public.ai_proposals;
  v_payload jsonb;
  v_cols text;
  v_id uuid;
  blocked text[] := array['ai_proposals', 'ai_usage', 'ai_messages', 'ai_conversations', 'change_log', 'input_history',
                          'google_connections', 'plaid_items', 'partner_links', 'partner_reports', 'owner_profile', 'stage_history'];
begin
  select * into p from public.ai_proposals where id = p_id for update;
  if not found then
    raise exception 'Proposal not found';
  end if;
  if p.status <> 'pending' then
    raise exception 'Proposal is no longer pending';
  end if;
  if p.table_name = any (blocked) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p.table_name and column_name = 'owner_id'
  ) then
    raise exception 'Proposals cannot change table %', p.table_name;
  end if;

  v_payload := (p.payload || coalesce(p_overrides, '{}'::jsonb)) - 'id' - 'owner_id' - 'created_at' - 'updated_at';

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p.table_name and v_payload ? c.column_name;

  if v_cols is null then
    raise exception 'Proposal has no valid fields';
  end if;

  perform set_config('app.actor', 'ai', true);

  if p.action = 'create' then
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
      p.table_name, v_cols, v_cols, p.table_name
    ) into v_id using v_payload;
  else
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 returning id',
      p.table_name, v_cols, v_cols, p.table_name
    ) into v_id using v_payload, p.record_id;
    if v_id is null then
      raise exception 'Record to update was not found';
    end if;
  end if;

  perform set_config('app.actor', '', true);

  update public.ai_proposals
     set status = 'approved', decided_at = now(), result_record_id = v_id, error = null
   where id = p_id;

  -- Approving one option of a group (example: one of 3 reduction suggestions) rejects the others.
  if p.group_id is not null then
    update public.ai_proposals
       set status = 'rejected', decided_at = now()
     where group_id = p.group_id and id <> p_id and status = 'pending';
  end if;

  return v_id;
end;
$$;

grant execute on function public.apply_proposal(uuid, jsonb) to authenticated;
revoke execute on function public.apply_proposal(uuid, jsonb) from anon;

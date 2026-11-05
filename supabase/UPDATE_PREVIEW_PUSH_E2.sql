-- BF Personal App: update for push E part 2 (2026-11-05). For the NEW database (bf-personal-app-final) that already has
-- SETUP_NEW_DATABASE.sql, UPDATE_PREVIEW_PUSH_B.sql, UPDATE_PREVIEW_PUSH_C.sql, UPDATE_PREVIEW_PUSH_D.sql and
-- UPDATE_PREVIEW_PUSH_E.sql run. SQL Editor, New query, paste this whole file, Run. Safe to run twice.
--
-- What it changes:
--   Several waits on one deal or person: a new table, waits. Each wait is one line: what is waited on, since when,
--   and (for a wait added from an email) the email it came from. Follow up also remembers the follow-up email, so a
--   reply to either email shows "Replied".
--   The waits saved today (Waiting on and Since on deals, job and consulting items, and people, and the email a wait
--   came from) are moved into the new table, and the old columns (waiting_on, waiting_since, waiting_comm_id) are
--   removed. Nothing is lost: every wait moves first, in the same run.
--   Sample data: Load and Remove sample data know the waits.
--
-- The last statement is a check. Expected result: one row, push_e2_ready = true.

-- Stops here, changing nothing, on the old database, on an empty one, or before the push E update.
do $$
begin
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'gmail_thread_id') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_B.sql first, then UPDATE_PREVIEW_PUSH_C.sql, UPDATE_PREVIEW_PUSH_D.sql and UPDATE_PREVIEW_PUSH_E.sql, then this file. Nothing was changed.';
  end if;
  if to_regclass('public.time_blocks') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_C.sql first, then UPDATE_PREVIEW_PUSH_D.sql and UPDATE_PREVIEW_PUSH_E.sql, then this file. Nothing was changed.';
  end if;
  if to_regclass('public.monthly_reviews') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_D.sql first, then UPDATE_PREVIEW_PUSH_E.sql, then this file. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'communications' and column_name = 'no_reply_dismissed_at') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_E.sql first, then this file. Nothing was changed.';
  end if;
end $$;

-- The waits: one row per thing waited on, on a deal or job or consulting item (pipeline_item_id) or a person (contact_id).
create table if not exists public.waits (
    id uuid default gen_random_uuid() not null,
    owner_id uuid default auth.uid() not null,
    pipeline_item_id uuid,
    contact_id uuid,
    text text not null,
    since date not null,
    comm_id uuid,
    follow_up_comm_id uuid,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    constraint waits_one_record check ((num_nonnulls(pipeline_item_id, contact_id) = 1)),
    constraint waits_text_check check (((length(btrim(text)) >= 1) and (length(text) <= 120)))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'waits_pkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waits_owner_id_fkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waits_pipeline_item_id_fkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_pipeline_item_id_fkey foreign key (pipeline_item_id) references public.pipeline_items(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waits_contact_id_fkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_contact_id_fkey foreign key (contact_id) references public.contacts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waits_comm_id_fkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_comm_id_fkey foreign key (comm_id) references public.communications(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waits_follow_up_comm_id_fkey' and conrelid = 'public.waits'::regclass) then
    alter table only public.waits add constraint waits_follow_up_comm_id_fkey foreign key (follow_up_comm_id) references public.communications(id) on delete set null;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'waits' and policyname = 'owner_only') then
    create policy owner_only on public.waits to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id));
  end if;
end $$;
create index if not exists waits_owner_idx on public.waits using btree (owner_id);
create index if not exists waits_item_idx on public.waits using btree (pipeline_item_id) where (pipeline_item_id is not null);
create index if not exists waits_contact_idx on public.waits using btree (contact_id) where (contact_id is not null);
alter table public.waits enable row level security;
drop trigger if exists log_change on public.waits;
create trigger log_change after insert or delete or update on public.waits for each row execute function public.log_change();
drop trigger if exists set_updated_at on public.waits;
create trigger set_updated_at before update on public.waits for each row execute function public.set_updated_at();
grant all on table public.waits to authenticated;
grant all on table public.waits to service_role;

-- Moves the waits saved today into the new table: Waiting on and Since of every deal, job and consulting item, and
-- person, with the email a wait came from. Runs only while the old columns are there (a second run skips it). A blank
-- Since takes today's date. The move is not written to the change history.
do $$
begin
  perform set_config('app.skip_change_log', 'on', true);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pipeline_items' and column_name = 'waiting_on') then
    execute $m$
      insert into public.waits (owner_id, pipeline_item_id, text, since, comm_id)
      select i.owner_id, i.id, left(btrim(i.waiting_on), 120), coalesce(i.waiting_since, public.owner_local_date(i.owner_id)), i.waiting_comm_id
      from public.pipeline_items i
      where btrim(coalesce(i.waiting_on, '')) <> ''
        and not exists (select 1 from public.waits w where w.pipeline_item_id = i.id)
    $m$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'waiting_on') then
    execute $m$
      insert into public.waits (owner_id, contact_id, text, since, comm_id)
      select p.owner_id, p.id, left(btrim(p.waiting_on), 120), coalesce(p.waiting_since, public.owner_local_date(p.owner_id)), p.waiting_comm_id
      from public.contacts p
      where btrim(coalesce(p.waiting_on, '')) <> ''
        and not exists (select 1 from public.waits w where w.contact_id = p.id)
    $m$;
  end if;
  perform set_config('app.skip_change_log', '', true);
end $$;

-- The old columns are no longer read or written by the app (their values are in waits now).
alter table public.pipeline_items drop column if exists waiting_comm_id;
alter table public.pipeline_items drop column if exists waiting_on;
alter table public.pipeline_items drop column if exists waiting_since;
alter table public.contacts drop column if exists waiting_comm_id;
alter table public.contacts drop column if exists waiting_on;
alter table public.contacts drop column if exists waiting_since;

-- Sample data: the batch insert knows waits.
create or replace function public.insert_record_batch(p_batches jsonb, p_actor text default 'owner'::text, p_sample_batch uuid default null::uuid) returns jsonb
    language plpgsql
    set search_path to 'public'
    as $_$
declare
  v_owner uuid := auth.uid();
  b jsonb;
  r jsonb;
  v_table text;
  v_op text;
  v_row jsonb;
  v_cols text;
  v_id uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  allowed text[] := array[
    'targets', 'record_links', 'notes', 'time_blocks', 'projects', 'deal_todos', 'organizations', 'contacts',
    'communications', 'pipeline_items', 'deal_financials', 'consulting_details', 'work_events', 'end_of_day', 'partner_reports',
    'monthly_reviews', 'waits'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can save these records';
  end if;
  if jsonb_typeof(p_batches) <> 'array' then
    raise exception 'p_batches must be a list';
  end if;
  if p_actor in ('ai', 'owner') then
    perform set_config('app.actor', p_actor, true);
  end if;
  if p_sample_batch is not null then
    perform set_config('app.skip_change_log', 'on', true);
  end if;

  for b in select * from jsonb_array_elements(p_batches) loop
    v_table := b ->> 'table';
    v_op := coalesce(b ->> 'op', 'insert');
    if not (v_table = any (allowed)) then
      raise exception 'Records of type % cannot be saved this way', v_table;
    end if;
    v_n := 0;
    for r in select * from jsonb_array_elements(coalesce(b -> 'rows', '[]'::jsonb)) loop
      if v_op = 'update' then
        v_row := r - 'owner_id' - 'created_at' - 'updated_at';
        select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_table and v_row ? c.column_name and c.column_name <> 'id';
        if v_cols is null then continue; end if;
        execute format(
          'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 and owner_id = $3 returning id',
          v_table, v_cols, v_cols, v_table
        ) into v_id using v_row, (r ->> 'id')::uuid, v_owner;
        if v_id is null then
          raise exception 'A % record to update was not found', v_table;
        end if;
      else
        v_row := (r - 'created_at' - 'updated_at') || jsonb_build_object('owner_id', v_owner);
        if not (v_row ? 'id') then
          v_row := v_row || jsonb_build_object('id', gen_random_uuid());
        end if;
        select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_table and v_row ? c.column_name;
        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
          v_table, v_cols, v_cols, v_table
        ) into v_id using v_row;
        if p_sample_batch is not null then
          insert into public.sample_records (owner_id, table_name, record_id, batch_id)
          values (v_owner, v_table, v_id, p_sample_batch)
          on conflict (owner_id, table_name, record_id) do nothing;
        end if;
      end if;
      v_n := v_n + 1;
    end loop;
    v_counts := v_counts || jsonb_build_object(v_table, coalesce((v_counts ->> v_table)::int, 0) + v_n);
  end loop;

  if p_sample_batch is not null then
    perform set_config('app.skip_change_log', '', true);
    insert into public.change_log (owner_id, table_name, record_id, action, field, new_value, actor)
    values (v_owner, 'sample_records', p_sample_batch, 'insert', 'sample_data_loaded', v_counts, 'owner');
  end if;
  perform set_config('app.actor', '', true);
  return v_counts;
end;
$_$;

-- Remove sample data: also the sample waits (they also go with their deal or person).
create or replace function public.remove_sample_data() returns jsonb
    language plpgsql security definer
    set search_path to 'public'
    as $_$
declare
  v_owner uuid := auth.uid();
  v_ids uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_paths jsonb;
  v_n int;
  t text;
  delete_order text[] := array[
    'waits', 'monthly_reviews', 'end_of_day', 'work_events', 'partner_reports', 'time_blocks', 'deal_todos', 'projects', 'notes',
    'record_links', 'communications', 'consulting_details', 'deal_financials', 'pipeline_items', 'contacts', 'organizations'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can remove sample data';
  end if;
  perform set_config('app.skip_change_log', 'on', true);
  perform set_config('app.bulk_delete', 'on', true);

  select array_agg(record_id) into v_ids from sample_records where owner_id = v_owner;
  if v_ids is null then
    perform set_config('app.skip_change_log', '', true);
    perform set_config('app.bulk_delete', '', true);
    return jsonb_build_object('deleted', '{}'::jsonb, 'storage_paths', '[]'::jsonb, 'total', 0);
  end if;

  delete from record_links where owner_id = v_owner and (from_id = any (v_ids) or to_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('record_links', v_n);
  delete from notes where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notes', v_n);
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from documents where owner_id = v_owner and record_id = any (v_ids);
  delete from documents where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);
  delete from communications where owner_id = v_owner and (contact_id = any (v_ids) or organization_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('communications', v_n);
  delete from partner_reports where owner_id = v_owner and contact_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('partner_reports', v_n);
  delete from stage_history where owner_id = v_owner and item_id = any (v_ids);
  -- The tasks of sample records, the sample to-dos, and every repeating copy made from them.
  with recursive gone as (
    select d.id from deal_todos d where d.owner_id = v_owner and (d.record_id = any (v_ids) or d.deal_id = any (v_ids) or d.id = any (v_ids))
    union
    select d.id from deal_todos d join gone g on d.repeat_from = g.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) || v_ids into v_ids from gone;
  delete from time_blocks where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('time_blocks', v_n);
  delete from deal_todos where owner_id = v_owner and (record_id = any (v_ids) or deal_id = any (v_ids) or id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('deal_todos', v_n);

  foreach t in array delete_order loop
    execute format('delete from public.%I where owner_id = $1 and id in (select record_id from public.sample_records where owner_id = $1 and table_name = %L)', t, t)
      using v_owner;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts ->> t)::int, 0) + v_n);
  end loop;

  delete from sample_records where owner_id = v_owner;

  perform set_config('app.skip_change_log', '', true);
  perform set_config('app.bulk_delete', '', true);
  insert into change_log (owner_id, table_name, record_id, action, field, new_value, actor)
  values (v_owner, 'sample_records', null, 'delete', 'sample_data_removed', v_counts, 'owner');
  return jsonb_build_object('deleted', v_counts, 'storage_paths', v_paths,
    'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_counts)));
end;
$_$;

-- Check (expected: one row, push_e2_ready = true).
select (to_regclass('public.waits') is not null
  and exists (select 1 from pg_constraint where conname = 'waits_one_record')
  and exists (select 1 from pg_constraint where conname = 'waits_comm_id_fkey')
  and exists (select 1 from pg_constraint where conname = 'waits_follow_up_comm_id_fkey')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'waits' and policyname = 'owner_only')
  and (select relrowsecurity from pg_class where oid = 'public.waits'::regclass)
  and has_table_privilege('authenticated', 'public.waits', 'insert')
  and has_table_privilege('authenticated', 'public.waits', 'delete')
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('pipeline_items', 'contacts') and column_name in ('waiting_on', 'waiting_since', 'waiting_comm_id'))
  and (select prosrc from pg_proc where oid = 'public.insert_record_batch(jsonb, text, uuid)'::regprocedure) like '%''waits''%'
  and (select prosrc from pg_proc where oid = 'public.remove_sample_data()'::regprocedure) like '%''waits''%') as push_e2_ready;

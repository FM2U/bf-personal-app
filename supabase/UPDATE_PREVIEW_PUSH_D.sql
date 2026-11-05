-- BF Personal App: update for push D (2026-11-04). For the NEW database (bf-personal-app-final) that already has
-- SETUP_NEW_DATABASE.sql, UPDATE_PREVIEW_PUSH_B.sql and UPDATE_PREVIEW_PUSH_C.sql run. SQL Editor, New query, paste
-- this whole file, Run. Safe to run twice.
--
-- What it adds:
--   An end date for repeating to-dos and tasks (deal_todos.repeat_until): after that date, checking one off adds no
--   new copy. Blank means it repeats with no end, as before.
--   The Weekly review answers on Friday's End of day (end_of_day.weekly_review): what went well, what slipped, next
--   week's focus. They go into Friday's report to each partner who gets that section.
--   Monthly reviews (table monthly_reviews): one row per month reviewed, with how the month went and next month's
--   targets as set when it was finished, and when the export was downloaded.
--   Sample data: Load and Remove sample data know the monthly reviews.
--
-- The last statement is a check. Expected result: one row, push_d_ready = true.

-- Stops here, changing nothing, on the old database, on an empty one, or before the push C update.
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
    raise exception 'Run UPDATE_PREVIEW_PUSH_B.sql first, then UPDATE_PREVIEW_PUSH_C.sql, then this file. Nothing was changed.';
  end if;
  if to_regclass('public.time_blocks') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deal_todos' and column_name = 'repeat') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_C.sql first, then this file. Nothing was changed.';
  end if;
end $$;

-- Repeat: an optional end date (blank repeats with no end).
alter table public.deal_todos add column if not exists repeat_until date;

-- The Weekly review answers on Friday's End of day.
alter table public.end_of_day add column if not exists weekly_review jsonb default '{}'::jsonb not null;

-- Monthly reviews: one per month (month is the first day of the month reviewed).
create table if not exists public.monthly_reviews (
    id uuid default gen_random_uuid() not null,
    owner_id uuid default auth.uid() not null,
    month date not null,
    results jsonb default '[]'::jsonb not null,
    next_targets jsonb default '[]'::jsonb not null,
    exported_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    constraint monthly_reviews_month_first_day check ((extract(day from month) = (1)::numeric))
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'monthly_reviews_pkey' and conrelid = 'public.monthly_reviews'::regclass) then
    alter table only public.monthly_reviews add constraint monthly_reviews_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_reviews_owner_month_key' and conrelid = 'public.monthly_reviews'::regclass) then
    alter table only public.monthly_reviews add constraint monthly_reviews_owner_month_key unique (owner_id, month);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_reviews_owner_id_fkey' and conrelid = 'public.monthly_reviews'::regclass) then
    alter table only public.monthly_reviews add constraint monthly_reviews_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'monthly_reviews' and policyname = 'owner_only') then
    create policy owner_only on public.monthly_reviews to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id));
  end if;
end $$;
alter table public.monthly_reviews enable row level security;
drop trigger if exists log_change on public.monthly_reviews;
create trigger log_change after insert or delete or update on public.monthly_reviews for each row execute function public.log_change();
drop trigger if exists set_updated_at on public.monthly_reviews;
create trigger set_updated_at before update on public.monthly_reviews for each row execute function public.set_updated_at();
grant all on table public.monthly_reviews to authenticated;
grant all on table public.monthly_reviews to service_role;

-- Sample data: the batch insert knows monthly_reviews.
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
    'monthly_reviews'];
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

-- Remove sample data: also the sample monthly reviews.
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
    'monthly_reviews', 'end_of_day', 'work_events', 'partner_reports', 'time_blocks', 'deal_todos', 'projects', 'notes',
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

-- Check (expected: one row, push_d_ready = true).
select (to_regclass('public.monthly_reviews') is not null
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deal_todos' and column_name = 'repeat_until')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'end_of_day' and column_name = 'weekly_review')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'monthly_reviews' and policyname = 'owner_only')
  and has_table_privilege('authenticated', 'public.monthly_reviews', 'insert')) as push_d_ready;

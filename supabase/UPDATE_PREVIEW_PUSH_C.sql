-- BF Personal App: update for push C (2026-11-03). For the NEW database (bf-personal-app-final) that already has
-- SETUP_NEW_DATABASE.sql and UPDATE_PREVIEW_PUSH_B.sql run. SQL Editor, New query, paste this whole file, Run.
-- Safe to run twice.
--
-- What it adds:
--   One list of tasks: a personal to-do and a task on a record are now the same kind of item (table deal_todos).
--   A to-do with no record is a personal to-do; linking it to a record puts it on that record's Tasks card. Every
--   to-do you already have is moved over, with its text, date, position and done state, and the old todos table is
--   then removed.
--   Tasks and to-dos get a due date and Repeat (every day, every weekday, every week, every month).
--   Block time: the blocks you put on Google Calendar from Home (table time_blocks), and the default block length
--   (60 minutes) on your profile.
--   Remove sample data also removes the blocks and the repeating copies of sample items.

-- Stops here, changing nothing, on the old database, on an empty one, or before the push B update.
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
    raise exception 'Run UPDATE_PREVIEW_PUSH_B.sql first, then this file. Nothing was changed.';
  end if;
end $$;

-- Tasks: a due date, Repeat, and the item a repeating copy came from; a task may have no record (a personal to-do).
alter table public.deal_todos add column if not exists due_on date;
alter table public.deal_todos add column if not exists repeat text;
alter table public.deal_todos add column if not exists repeat_from uuid;
alter table public.deal_todos alter column record_type drop not null;
alter table public.deal_todos alter column record_type drop default;
alter table public.deal_todos drop constraint if exists deal_todos_repeat_check;
alter table public.deal_todos add constraint deal_todos_repeat_check check ((repeat is null) or (repeat = any (array['daily'::text, 'weekdays'::text, 'weekly'::text, 'monthly'::text])));
alter table public.deal_todos drop constraint if exists deal_todos_record_pair_check;
alter table public.deal_todos add constraint deal_todos_record_pair_check check (((record_type is null) = (record_id is null)));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deal_todos_repeat_from_fkey' and conrelid = 'public.deal_todos'::regclass) then
    alter table public.deal_todos add constraint deal_todos_repeat_from_fkey foreign key (repeat_from) references public.deal_todos(id) on delete set null;
  end if;
end $$;
create index if not exists deal_todos_due_idx on public.deal_todos using btree (owner_id, due_on) where (done_at is null);
create index if not exists deal_todos_repeat_from_idx on public.deal_todos using btree (repeat_from) where (repeat_from is not null);

create or replace function public.deal_todos_before() returns trigger
    language plpgsql
    as $$
begin
  if new.record_id is null and new.deal_id is not null then
    new.record_type := 'pipeline_items';
    new.record_id := new.deal_id;
  end if;
  -- A personal to-do (push C) has no record, so no type and no deal.
  if new.record_id is null then
    new.record_type := null;
  elsif new.record_type is null then
    raise exception 'A task linked to a record needs the record type';
  end if;
  if new.record_type = 'pipeline_items' then
    new.deal_id := new.record_id;
  else
    new.deal_id := null;
  end if;
  return new;
end;
$$;

-- Your to-dos move into the one list (same ids, text, dates, positions, done state); then the old table goes.
do $$
begin
  if to_regclass('public.todos') is not null then
    perform set_config('app.skip_change_log', 'on', true);
    insert into public.deal_todos (id, owner_id, text, due_on, done_at, "position", created_at)
      select t.id, t.owner_id, t.text, t.due_on, t.done_at, t."position", t.created_at from public.todos t
      on conflict (id) do nothing;
    update public.sample_records set table_name = 'deal_todos' where table_name = 'todos';
    perform set_config('app.skip_change_log', '', true);
    drop table public.todos;
  end if;
end $$;

-- Block time: the default block length, and the blocks put on Google Calendar from Home.
alter table public.owner_profile add column if not exists default_block_minutes integer default 60 not null;
alter table public.owner_profile drop constraint if exists owner_profile_default_block_minutes_check;
alter table public.owner_profile add constraint owner_profile_default_block_minutes_check check (((default_block_minutes >= 5) and (default_block_minutes <= 480)));

create table if not exists public.time_blocks (
    id uuid default gen_random_uuid() not null,
    owner_id uuid default auth.uid() not null,
    row_key text not null,
    record_type text,
    record_id uuid,
    title text not null,
    starts_at timestamp with time zone not null,
    ends_at timestamp with time zone not null,
    google_event_id text,
    created_at timestamp with time zone default now() not null,
    constraint time_blocks_ends_after_start check ((ends_at > starts_at))
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_blocks_pkey' and conrelid = 'public.time_blocks'::regclass) then
    alter table only public.time_blocks add constraint time_blocks_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_blocks_owner_id_fkey' and conrelid = 'public.time_blocks'::regclass) then
    alter table only public.time_blocks add constraint time_blocks_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_blocks' and policyname = 'owner_only') then
    create policy owner_only on public.time_blocks to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id));
  end if;
end $$;
create index if not exists time_blocks_owner_idx on public.time_blocks using btree (owner_id, starts_at);
create index if not exists time_blocks_record_idx on public.time_blocks using btree (record_id) where (record_id is not null);
alter table public.time_blocks enable row level security;
drop trigger if exists log_change on public.time_blocks;
create trigger log_change after insert or delete or update on public.time_blocks for each row execute function public.log_change();
grant all on table public.time_blocks to authenticated;
grant all on table public.time_blocks to service_role;

-- Sample data: the batch insert knows time_blocks (and no longer todos).
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
    'communications', 'pipeline_items', 'deal_financials', 'consulting_details', 'work_events', 'end_of_day', 'partner_reports'];
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

-- Remove sample data: also the blocks on sample records and tasks, and the repeating copies of sample items.
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
    'end_of_day', 'work_events', 'partner_reports', 'time_blocks', 'deal_todos', 'projects', 'notes', 'record_links',
    'communications', 'consulting_details', 'deal_financials', 'pipeline_items', 'contacts', 'organizations'];
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

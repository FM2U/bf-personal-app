-- BF Personal App: database update 0019 (the focused version, batch 1: Today and Close the day).
-- For a database that has 0001 to 0018 (the live database with 0001 to 0019 uses UPDATE_0020_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, and no existing
-- record is changed or deleted. What it adds:
--   A table of daily outcomes: up to 3 planned outcomes per day, each with an initiative, a planned block in minutes,
--   and after the close a status (complete, partial, incomplete), a one-line result, and optional actual minutes.
--   On the daily plan: focused hours, what changed in the plan, and tomorrow's top priority.
--   On tasks: who the task is waiting on and since when (the Waiting on someone list on Today).
--   Sample data and Reset all data also cover daily outcomes. And a check function.
-- Generated from supabase/migrations/0019_focused_today.sql by supabase/build_combined.py.

-- 0019: The focused version, batch 1: Today, Close the day, and the daily report content (approved 2026-10-30).
-- Depends on 0005 (daily_plans, tasks, reviews), 0006 (owner_only policy and change log), 0014 (insert_record_batch,
-- remove_sample_data), and 0017 (reset_all_data).
-- Safe to run more than once: every statement checks first, and no existing record is changed.
--
-- What it adds:
--   1. daily_outcomes: up to 3 planned outcomes per day (position 1 to 3), each with a title, an optional initiative,
--      pipeline item, or task it is for, a planned block in minutes, and after the close a status (planned, complete,
--      partial, incomplete), a one-line result, and optional actual minutes. One row per owner, day, and position.
--   2. daily_plans: focused_hours (the hours available for focused work that day), changes_note ("What changed in the
--      plan?"), and tomorrow_priority ("Tomorrow's top priority"), all empty until the owner fills them.
--   3. tasks: waiting_on (who the task waits on) and waiting_since (since when), shown on Today under
--      "Waiting on someone".
--   4. insert_record_batch (sample data) also accepts daily_outcomes; remove_sample_data and reset_all_data also
--      delete them. The function bodies are otherwise the same as in 0014 and 0017.
--   5. public.schema_has_0019(): the app calls it to check that this update is applied. Before it runs, Today shows
--      "Database update needed" and every other screen keeps working.

-- 1. Daily outcomes
create table if not exists public.daily_outcomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_date date not null,
  position int not null check (position between 1 and 3),
  title text not null default '',
  initiative_id uuid references public.initiatives (id) on delete set null,
  pipeline_item_id uuid references public.pipeline_items (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  block_minutes int check (block_minutes is null or block_minutes between 0 and 1440),
  status text not null default 'planned' check (status in ('planned', 'complete', 'partial', 'incomplete')),
  result_note text,
  actual_minutes int check (actual_minutes is null or actual_minutes between 0 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, plan_date, position)
);
create index if not exists daily_outcomes_owner_date_idx on public.daily_outcomes (owner_id, plan_date);

-- Row Level Security, owner-only policy, grants, updated_at, and change log (the same statements as 0014 and 0017).
do $$
declare
  t text := 'daily_outcomes';
begin
  execute format('alter table public.%I enable row level security', t);
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
    execute format(
      'create policy owner_only on public.%I for all to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id))',
      t
    );
  end if;
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('grant all on public.%I to service_role', t);
  execute format('revoke all on public.%I from anon', t);
  if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'set_updated_at') then
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
    execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
  end if;
end $$;

-- 2. The day's focused hours, what changed in the plan, and tomorrow's top priority
alter table public.daily_plans add column if not exists focused_hours numeric;
alter table public.daily_plans add column if not exists changes_note text;
alter table public.daily_plans add column if not exists tomorrow_priority text;
alter table public.daily_plans drop constraint if exists daily_plans_focused_hours_check;
alter table public.daily_plans add constraint daily_plans_focused_hours_check check (focused_hours is null or (focused_hours >= 0 and focused_hours <= 24));

-- 3. Waiting on someone
alter table public.tasks add column if not exists waiting_on text;
alter table public.tasks add column if not exists waiting_since date;

-- 4. Sample data and reset: daily_outcomes is a sample table too (the functions are the same as 0014 and 0017 otherwise).
create or replace function public.insert_record_batch(p_batches jsonb, p_actor text default 'owner', p_sample_batch uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
    'initiatives', 'goals', 'milestones', 'milestone_options', 'decision_conditions', 'task_templates', 'targets',
    'budgets', 'budget_lines', 'reduction_actions', 'plan_documents', 'checklists', 'checklist_items', 'record_links',
    'savings_ideas', 'notes', 'tasks', 'commitments', 'daily_outcomes',
    'accounts', 'account_balances', 'transactions', 'debts', 'income_sources', 'organizations', 'contacts',
    'communications', 'pipeline_items', 'deal_financials', 'consulting_details', 'partners', 'funding_sources',
    'repayment_schedules', 'savings_targets'];
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
$$;

revoke execute on function public.insert_record_batch(jsonb, text, uuid) from public, anon;
grant execute on function public.insert_record_batch(jsonb, text, uuid) to authenticated;

create or replace function public.remove_sample_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_ids uuid[];
  v_series uuid[];
  v_tasks uuid[];
  v_since timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_paths jsonb;
  v_n int;
  t text;
  delete_order text[] := array[
    'daily_outcomes', 'checklist_items', 'checklists', 'plan_documents', 'milestone_options', 'milestones', 'goals', 'decision_conditions',
    'targets', 'task_templates', 'reduction_actions', 'budget_lines', 'savings_ideas', 'notes', 'record_links', 'tasks',
    'repayment_schedules', 'funding_sources', 'communications', 'consulting_details', 'deal_financials', 'pipeline_items',
    'debts', 'account_balances', 'transactions', 'accounts', 'income_sources', 'partners', 'contacts', 'organizations',
    'budgets', 'savings_targets', 'initiatives'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can remove sample data';
  end if;
  perform set_config('app.skip_change_log', 'on', true);
  perform set_config('app.bulk_delete', 'on', true);

  select array_agg(record_id), min(created_at) into v_ids, v_since from sample_records where owner_id = v_owner;
  if v_ids is null then
    perform set_config('app.skip_change_log', '', true);
    perform set_config('app.bulk_delete', '', true);
    return jsonb_build_object('deleted', '{}'::jsonb, 'storage_paths', '[]'::jsonb, 'total', 0);
  end if;

  select array_agg(distinct recurring_series_id) into v_series
  from transactions where owner_id = v_owner and id = any (v_ids) and recurring_series_id is not null;
  v_series := coalesce(v_series, '{}');

  -- Tasks the app created from sample rows (stage tasks and next actions for sample pipeline items, tasks from
  -- sample recurring tasks, follow-ups for sample contacts).
  select array_agg(id) into v_tasks from tasks
  where owner_id = v_owner
    and (id = any (v_ids) or pipeline_item_id = any (v_ids) or template_id = any (v_ids) or related_id = any (v_ids)
         or goal_id = any (v_ids) or milestone_id = any (v_ids));
  v_tasks := coalesce(v_tasks, '{}');

  delete from commitments where owner_id = v_owner and (record_id = any (v_tasks) or record_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('commitments', v_n);
  delete from calendar_events where owner_id = v_owner and task_id = any (v_tasks);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('calendar_events', v_n);
  delete from tasks where owner_id = v_owner and id = any (v_tasks);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tasks', v_n);
  delete from record_links where owner_id = v_owner and (from_id = any (v_ids) or to_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('record_links', v_n);
  delete from notes where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notes', v_n);
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from documents where owner_id = v_owner and record_id = any (v_ids);
  delete from documents where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);
  delete from alerts where owner_id = v_owner and related_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('alerts', v_n);
  delete from partner_reports where owner_id = v_owner and partner_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('partner_reports', v_n);
  delete from reduction_actions where owner_id = v_owner and (transaction_id = any (v_ids) or recurring_series_id = any (v_series));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reduction_actions', v_n);
  delete from savings_ideas where owner_id = v_owner
    and (recurring_series_id = any (v_series) or (status in ('pending', 'later') and created_at >= v_since));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('savings_ideas', v_n);
  delete from initiative_drafts where owner_id = v_owner and status = 'draft' and created_at >= v_since;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('initiative_drafts', v_n);
  delete from stage_history where owner_id = v_owner and item_id = any (v_ids);

  foreach t in array delete_order loop
    execute format('delete from public.%I where owner_id = $1 and id in (select record_id from public.sample_records where owner_id = $1 and table_name = %L)', t, t)
      using v_owner;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts ->> t)::int, 0) + v_n);
  end loop;

  -- Recurring charges found only in sample transactions
  delete from recurring_series s where s.owner_id = v_owner and s.id = any (v_series)
    and not exists (select 1 from transactions x where x.recurring_series_id = s.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recurring_series', v_n);

  delete from sample_records where owner_id = v_owner;

  perform set_config('app.skip_change_log', '', true);
  perform set_config('app.bulk_delete', '', true);
  insert into change_log (owner_id, table_name, record_id, action, field, new_value, actor)
  values (v_owner, 'sample_records', null, 'delete', 'sample_data_removed', v_counts, 'owner');
  return jsonb_build_object('deleted', v_counts, 'storage_paths', v_paths,
    'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_counts)));
end;
$$;

revoke execute on function public.remove_sample_data() from public, anon;
grant execute on function public.remove_sample_data() to authenticated;

create or replace function public.reset_all_data(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_today date;
  v_counts jsonb := '{}'::jsonb;
  v_paths jsonb;
  v_n int;
  v_pf uuid;
  t text;
  default_initiatives text[] := array['Personal Finance', 'Acquisition Search', 'Employment', 'Rosara', 'Other Income', 'Consulting'];
  delete_order text[] := array[
    'ai_messages', 'ai_proposals', 'ai_conversations', 'initiative_drafts', 'savings_ideas',
    'checklist_items', 'checklists', 'plan_documents', 'sample_records',
    'record_links', 'notes', 'documents', 'alerts', 'calendar_events', 'daily_outcomes', 'daily_plans',
    'missed_commitments', 'commitments', 'reviews', 'target_entries', 'target_misses',
    'partner_links', 'partner_reports', 'partners', 'tasks',
    'raw_import_rows', 'import_batches', 'repayment_schedules', 'funding_sources', 'debt_payments', 'debts',
    'reduction_actions', 'budget_lines', 'budgets', 'savings_targets',
    'transactions', 'recurring_series', 'merchants', 'account_balances', 'accounts', 'income_sources',
    'scenario_input_changes', 'scenarios', 'decision_options', 'decisions', 'decision_conditions',
    'milestone_options', 'milestones', 'goals',
    'pipeline_item_stage_extensions', 'stage_history', 'diligence_items', 'deal_financials', 'job_details',
    'investor_details', 'consulting_details', 'pipeline_items',
    'communications', 'contacts', 'organizations'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can reset the data';
  end if;
  if coalesce(p_confirm, '') <> 'RESET' then
    raise exception 'Type RESET to confirm';
  end if;
  select (now() at time zone coalesce(nullif(timezone, ''), 'America/New_York'))::date into v_today
  from owner_profile where owner_id = v_owner;
  v_today := coalesce(v_today, current_date);

  perform set_config('app.skip_change_log', 'on', true);
  perform set_config('app.bulk_delete', 'on', true);

  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from documents where owner_id = v_owner;

  foreach t in array delete_order loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    execute format('delete from public.%I where owner_id = $1', t) using v_owner;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;

  -- Initiatives the owner created (default initiatives and initiatives a pipeline belongs to are setup)
  delete from initiatives i where i.owner_id = v_owner
    and not (i.name = any (default_initiatives))
    and not exists (select 1 from pipelines p where p.initiative_id = i.id);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('initiatives', v_n);
  update initiatives set parent_initiative_id = null where owner_id = v_owner and parent_initiative_id is not null;

  -- Partner report templates the owner added (the starter templates stay, and missing ones are created again below)
  delete from partner_report_templates where owner_id = v_owner and starter_key is null;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('partner_report_templates', v_n);

  -- Setup that stays: targets count from today; recurring tasks are created again from the next morning job.
  update targets set start_date = v_today where owner_id = v_owner;
  update task_templates set last_generated_on = null where owner_id = v_owner;

  -- Default rows created again (the same as for a new owner)
  select id into v_pf from initiatives where owner_id = v_owner and name = 'Personal Finance';
  insert into budgets (owner_id, name) values (v_owner, 'Monthly budget');
  insert into savings_targets (owner_id, name, kind) values (v_owner, 'Emergency fund', 'emergency_fund'), (v_owner, 'Retirement', 'retirement');
  insert into decision_conditions (owner_id, initiative_id, name, metric_key, operator, threshold, actions) values
    (v_owner, v_pf, 'Runway under 6 months', 'runway_months', 'lt', 6,
     '[{"type":"create_task","title":"Start active job search"},{"type":"create_alert","message":"Runway is under 6 months."}]'::jsonb);
  perform public.seed_owner_report_templates(v_owner);

  perform set_config('app.skip_change_log', '', true);
  perform set_config('app.bulk_delete', '', true);
  insert into change_log (owner_id, table_name, record_id, action, field, new_value, actor)
  values (v_owner, 'owner_profile', null, 'delete', 'all_data_reset', v_counts, 'owner');

  return jsonb_build_object(
    'deleted', v_counts,
    'storage_paths', v_paths,
    'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_counts)),
    'recreated', jsonb_build_array('Monthly budget', 'Emergency fund', 'Retirement', 'Runway under 6 months'),
    'targets_count_from', v_today
  );
end;
$$;

revoke execute on function public.reset_all_data(text) from public, anon;
grant execute on function public.reset_all_data(text) to authenticated;

-- 5. Check function
create or replace function public.schema_has_0019()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0019() from public, anon;
grant execute on function public.schema_has_0019() to authenticated, service_role;

-- 0014: "Start an initiative", weekly AI savings ideas, checklists, sample data, and Reset data (approved 2026-10-27).
-- Depends on 0001 to 0012 (0013 is not required). Safe to run more than once: every statement checks first.
--
-- What it adds:
--   1. initiatives.parent_initiative_id: an initiative can belong under another one (example: Weekly meal plan under
--      Personal Finance). goals.metric_params: details for a measured number (example: {"category":"Groceries"}).
--   2. plan_documents: a written plan (markdown, bulleted) on an initiative.
--   3. checklists and checklist_items: named lists of items (example: "Grocery list"), linked to an initiative and
--      optionally to a recurring task. "Reset each week" unchecks every item when that recurring task is created.
--   4. initiative_drafts: what the AI proposed for "Start an initiative" (or a savings idea turned into a plan),
--      kept until the owner approves the selected items. Nothing else is saved before approval.
--   5. savings_ideas: up to 3 AI savings ideas per week, with the targeted expense, estimated monthly savings and how
--      it was estimated, effort, steps, and the owner's choice (Approve, Decline with a reason, Later).
--   6. sample_records: which rows are sample data (table and id), so "Remove sample data" deletes only those rows.
--   7. log_change() skips per-row change log entries while sample data is loaded or removed and while all data is
--      reset (each of those writes one summary entry instead). protect_finalized_report() allows a finalized
--      partner report to be deleted only during "Reset all data" or "Remove sample data".
--   8. insert_record_batch(): inserts or updates several records in one transaction (all or nothing). Used when the
--      owner approves an initiative draft and when sample data is loaded. Runs with the owner's permissions.
--   9. remove_sample_data(): deletes only sample rows and the rows the app made from them (one transaction).
--  10. reset_all_data('RESET'): deletes every record the owner created or imported and keeps the setup
--      (one transaction, owner only). See the lists in the function and in src/lib/reset.ts.
--  11. public.schema_has_0014(): the app calls it to check that this update is applied.

-- 1. New columns on existing tables (nullable; nothing existing changes)
alter table public.initiatives add column if not exists parent_initiative_id uuid references public.initiatives (id) on delete set null;
alter table public.goals add column if not exists metric_params jsonb;

-- 2. Plan documents
create table if not exists public.plan_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  initiative_id uuid references public.initiatives (id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_documents_initiative_idx on public.plan_documents (initiative_id);

-- 3. Checklists
create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  initiative_id uuid references public.initiatives (id) on delete cascade,
  related_type text,
  related_id uuid,
  task_template_id uuid references public.task_templates (id) on delete set null,
  reset_weekly boolean not null default false,
  last_reset_on date,
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklists_initiative_idx on public.checklists (initiative_id);
create index if not exists checklists_template_idx on public.checklists (task_template_id);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  checklist_id uuid not null references public.checklists (id) on delete cascade,
  text text not null,
  quantity text,
  notes text,
  checked boolean not null default false,
  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklist_items_checklist_idx on public.checklist_items (checklist_id, sort_order);

-- 4. Savings ideas (created before initiative_drafts, which can point to one)
create table if not exists public.savings_ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  -- The expense the idea targets: "series:<id>", "category:<id>", or "merchant:<normalized name>".
  -- A declined idea is not proposed again for the same target_key for 90 days.
  target_key text not null,
  target_type text not null check (target_type in ('recurring_series', 'category', 'merchant')),
  target_label text not null,
  recurring_series_id uuid references public.recurring_series (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  current_monthly_cost numeric(14,2),
  estimated_monthly_savings numeric(14,2) not null default 0,
  estimate_basis text,
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'later', 'approved', 'declined')),
  decline_reason text,
  decided_at timestamptz,
  result_table text,
  result_id uuid,
  source text not null default 'weekly' check (source in ('weekly', 'manual')),
  batch_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists savings_ideas_status_idx on public.savings_ideas (owner_id, status, created_at desc);
create index if not exists savings_ideas_target_idx on public.savings_ideas (owner_id, target_key);

-- 5. Initiative drafts
create table if not exists public.initiative_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  prompt text not null default '',
  proposal jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  source text not null default 'typed' check (source in ('typed', 'chat', 'savings_idea')),
  savings_idea_id uuid references public.savings_ideas (id) on delete set null,
  result_initiative_id uuid,
  result_summary jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists initiative_drafts_status_idx on public.initiative_drafts (owner_id, status, created_at desc);

-- 6. Sample data registry
create table if not exists public.sample_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  batch_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, table_name, record_id)
);
create index if not exists sample_records_table_idx on public.sample_records (owner_id, table_name);

-- Row Level Security, owner-only policy, grants, updated_at, and change log for the new tables
-- (the same statements 0006 applied to every table that existed then). sample_records has no change log.
do $$
declare
  t text;
begin
  foreach t in array array['plan_documents', 'checklists', 'checklist_items', 'savings_ideas', 'initiative_drafts', 'sample_records'] loop
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
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'updated_at')
       and not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'set_updated_at') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    end if;
    if t <> 'sample_records' and not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
    end if;
  end loop;
end $$;

-- 7a. Change log: same as 0006, plus one rule: while app.skip_change_log is 'on' (bulk sample data and reset,
-- which each write one summary entry), rows are not logged one by one.
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
  if coalesce(current_setting('app.skip_change_log', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
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
    if public.owner_exists(old.owner_id) then
      v_old := to_jsonb(old) - secret_fields;
      insert into public.change_log (owner_id, table_name, record_id, action, old_value, actor)
      values (old.owner_id, tg_table_name, (v_old ->> 'id')::uuid, 'delete', v_old, v_actor);
    end if;
    return old;
  end if;
end;
$$;

-- 7b. A finalized partner report never changes. Same as 0005, plus: "Reset all data" and "Remove sample data"
-- (app.bulk_delete = 'on', set only inside those two functions) may delete it.
create or replace function public.protect_finalized_report()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' and coalesce(current_setting('app.bulk_delete', true), '') <> 'on' then
      raise exception 'A finalized partner report cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'finalized' then
    if new.snapshot is distinct from old.snapshot
       or new.summary is distinct from old.summary
       or new.status is distinct from old.status
       or new.partner_id is distinct from old.partner_id
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.finalized_at is distinct from old.finalized_at then
      raise exception 'A finalized partner report cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

-- 8. Insert or update several records in one transaction (all or nothing), with the owner's permissions (RLS).
-- p_batches: [{"table": "initiatives", "op": "insert" | "update", "rows": [{...}, ...]}, ...] in the order given.
-- Insert rows carry their own id (so later rows can refer to them); update rows need "id" and change only the
-- fields given. owner_id is always the signed-in owner. p_actor 'ai' marks the change log entries as an approved
-- AI proposal. p_sample_batch: when given, every inserted row is recorded in sample_records with that batch id and
-- rows are not logged one by one (one summary entry is written instead).
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
    'savings_ideas', 'notes', 'tasks', 'commitments',
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

-- 9. Remove sample data: deletes only rows recorded in sample_records, plus the rows the app made from them
-- (tasks for sample pipeline items or sample recurring tasks, their commitments and calendar blocks, links, notes,
-- documents, alerts, recurring charges found only in sample transactions, reduction actions and savings ideas on
-- those, partner reports for sample partners, and initiative drafts and savings ideas not yet decided that were
-- made while sample data was loaded). One transaction; one change log entry. Returns counts and the storage paths
-- of deleted documents (the app removes those files).
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
    'checklist_items', 'checklists', 'plan_documents', 'milestone_options', 'milestones', 'goals', 'decision_conditions',
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

-- 10. Reset all data. Deletes every record the owner created or imported, keeps the setup. All or nothing.
-- Deleted (in this order): see delete_order below.
-- Kept: owner_profile, entities, inputs and input_history (Inputs and Assumptions values), categories,
--   categorization_rules, import_layouts (saved column layouts per bank), pipelines, pipeline_stages, stage_tasks,
--   targets (definitions; "Counting starts on" is set to today), task_templates, the default initiatives (Personal
--   Finance, Acquisition Search, Employment, Rosara, Other Income, Consulting, and any initiative a pipeline belongs
--   to), google_connections, plaid_items, ai_usage (needed for the monthly AI cap), and change_log (one entry
--   "All data reset" is added with the counts).
-- Default rows deleted with their table and then created again: the "Monthly budget" container, the Emergency fund
--   and Retirement savings targets, and the "Runway under 6 months" decision condition.
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
    'record_links', 'notes', 'documents', 'alerts', 'calendar_events', 'daily_plans',
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

-- 11. Check function
create or replace function public.schema_has_0014()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0014() from public, anon;
grant execute on function public.schema_has_0014() to authenticated, service_role;

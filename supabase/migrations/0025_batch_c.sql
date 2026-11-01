-- 0025: Batch C of the Work module (approved 2026-10-31): Targets, End of day, Reports.
-- Depends on 0022 (insert_record_batch, remove_sample_data, reset_all_data as they are there), 0018 (partner_reports.report_kind),
-- 0008 (targets). Safe to run more than once: every statement checks first. Nothing is deleted and no existing row changes.
--   1. targets.counts_key: what a target counts from the app's own data (listings screened, passes, brokers contacted,
--      emails sent, calls logged, outreach contacts, follow-ups on time, deals moved, next actions done, Rosara focus
--      done); targets.archived_at (Remove on the Targets page archives; nothing is deleted). The existing columns
--      period (day or week), minimum_count, and is_commitment carry the cadence, the number, and the Commitment switch.
--      The six default targets are seeded by the app the first time Targets opens (seed_owner_batch_c does the same
--      for a future owner).
--   2. work_events: what the app counts that no other table records: a next action marked Done (deals, projects, job
--      and consulting items), a follow-up marked Done (with whether it was on or before its date), the Rosara weekly
--      focus marked done. One row per event with its local date.
--   3. end_of_day: one row per day: the reasons for missed commitments (json by target id), tomorrow's line, the
--      status (open, sent, skipped), the skip reason, when it was sent, the partner report it became, and the email
--      exactly as sent (subject and HTML). Sent reports stay partner_reports rows (report_kind end_of_day), so the
--      reviewed state and the partner's comment keep working through the existing private link.
--   4. partner_reports.report_kind also allows 'end_of_day'.
--   5. insert_record_batch, remove_sample_data, and reset_all_data cover the new tables and sample sent reports.
--   6. schema_has_0025().

-- 1. Targets: what it counts, and archived
alter table public.targets add column if not exists counts_key text;
alter table public.targets add column if not exists archived_at timestamptz;
alter table public.targets drop constraint if exists targets_counts_key_check;
alter table public.targets add constraint targets_counts_key_check
  check (counts_key is null or counts_key in ('listings_screened', 'passes', 'brokers_contacted', 'emails_sent', 'calls_logged', 'outreach_contacts', 'follow_ups_on_time', 'deals_moved', 'next_actions_done', 'rosara_focus_done'));

-- 2. Work events
create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('next_action_done', 'follow_up_done', 'focus_done')),
  record_type text,
  record_id uuid,
  label text,
  happened_on date not null default current_date,
  happened_at timestamptz not null default now(),
  on_time boolean,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists work_events_owner_day_idx on public.work_events (owner_id, happened_on);

-- 3. End of day
create table if not exists public.end_of_day (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  status text not null default 'open' check (status in ('open', 'sent', 'skipped')),
  reasons jsonb not null default '{}'::jsonb,
  tomorrow_line text,
  skip_reason text,
  sent_at timestamptz,
  skipped_at timestamptz,
  report_id uuid references public.partner_reports (id) on delete set null,
  report_subject text,
  report_html text,
  report_edited boolean not null default false,
  judged jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, day)
);

-- Row Level Security, owner-only policy, grants, updated_at, and change log for the new tables (as 0022).
do $$
declare
  t text;
begin
  foreach t in array array['work_events', 'end_of_day'] loop
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
    if t = 'end_of_day' and not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'set_updated_at') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    end if;
    if t <> 'work_events' and not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
    end if;
  end loop;
end $$;

-- 4. Sent End of day reports are partner reports of their own kind
alter table public.partner_reports drop constraint if exists partner_reports_report_kind_check;
alter table public.partner_reports add constraint partner_reports_report_kind_check
  check (report_kind in ('regular', 'daily', 'end_of_day'));

-- The six default targets for a future owner (the app seeds the same rows for the existing owner when Targets, End of day,
-- Reports, or Home first opens after this update: src/lib/accountability/data.ts).
create or replace function public.seed_owner_batch_c(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if exists (select 1 from targets where owner_id = p_owner and counts_key is not null) then return; end if;
  for r in select * from (values
      ('Listings screened', 'day', 5, true, 1, 'listings_screened'),
      ('Brokers contacted', 'week', 5, false, 2, 'brokers_contacted'),
      ('Network outreach', 'week', 10, true, 3, 'outreach_contacts'),
      ('Follow-ups done on time', 'week', 100, false, 4, 'follow_ups_on_time'),
      ('Deals moved a stage', 'week', 2, false, 5, 'deals_moved'),
      ('Rosara focus done', 'week', 1, false, 6, 'rosara_focus_done')
    ) as v (name, period, n, commit, pos, key) loop
    -- A target of that name from an earlier update (Network outreach from 0008, Listings screened from 0016) keeps its
    -- row and its history; it now counts the batch C way.
    if exists (select 1 from targets where owner_id = p_owner and name = r.name) then
      update targets set counts_key = r.key, period = r.period, minimum_count = r.n, is_commitment = r.commit, active = true, archived_at = null, sort_order = r.pos
       where owner_id = p_owner and name = r.name;
    else
      insert into targets (owner_id, name, period, minimum_count, active_weekdays, count_source, is_commitment, show_to_partners, active, sort_order, counts_key, notes)
      values (p_owner, r.name, r.period, r.n, '{1,2,3,4,5}', 'manual', r.commit, false, true, r.pos, r.key, 'Counted from what you do in the app (Targets, batch C).');
    end if;
  end loop;
end;
$$;

revoke execute on function public.seed_owner_batch_c(uuid) from public, anon, authenticated;

create or replace function public.handle_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.owner_profile (owner_id) values (new.id) on conflict do nothing;
  perform public.seed_owner_defaults(new.id);
  if to_regprocedure('public.seed_owner_targets(uuid)') is not null then
    perform public.seed_owner_targets(new.id);
  end if;
  if to_regprocedure('public.seed_owner_pipeline_accountability(uuid)') is not null then
    perform public.seed_owner_pipeline_accountability(new.id);
  end if;
  perform public.seed_owner_commitment_rule(new.id);
  perform public.seed_owner_consulting(new.id);
  perform public.seed_owner_deal_funnel(new.id);
  perform public.seed_owner_report_templates(new.id);
  perform public.seed_owner_work_module(new.id);
  perform public.seed_owner_batch_b(new.id);
  perform public.seed_owner_batch_c(new.id);
  return new;
end;
$$;

-- 5. Sample data: the batch also accepts work_events, end_of_day, and partner_reports (sample sent reports); removal and
-- reset delete the new tables. The function bodies are otherwise the same as in 0022.
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
    'savings_ideas', 'notes', 'tasks', 'commitments', 'daily_outcomes', 'todos', 'projects', 'deal_todos',
    'accounts', 'account_balances', 'transactions', 'debts', 'income_sources', 'organizations', 'contacts',
    'communications', 'pipeline_items', 'deal_financials', 'consulting_details', 'partners', 'funding_sources',
    'repayment_schedules', 'savings_targets', 'work_events', 'end_of_day', 'partner_reports'];
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
    'end_of_day', 'work_events', 'partner_reports', 'todos', 'deal_todos', 'projects',
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
  -- Tasks on sample records (deals, people, projects), whichever way they were added.
  delete from deal_todos where owner_id = v_owner and (record_id = any (v_ids) or deal_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('deal_todos', v_n);

  foreach t in array delete_order loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
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

-- Reset all data also lists the new tables (the same function as 0022 otherwise).
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
    'ai_messages', 'ai_proposals', 'ai_conversations', 'ai_order_cache', 'initiative_drafts', 'savings_ideas',
    'checklist_items', 'checklists', 'plan_documents', 'sample_records', 'end_of_day', 'work_events',
    'record_links', 'notes', 'documents', 'alerts', 'calendar_events', 'daily_outcomes', 'daily_plans',
    'missed_commitments', 'commitments', 'reviews', 'target_entries', 'target_misses',
    'partner_links', 'partner_reports', 'partners', 'tasks', 'todos',
    'raw_import_rows', 'import_batches', 'repayment_schedules', 'funding_sources', 'debt_payments', 'debts',
    'reduction_actions', 'budget_lines', 'budgets', 'savings_targets',
    'transactions', 'recurring_series', 'merchants', 'account_balances', 'accounts', 'income_sources',
    'scenario_input_changes', 'scenarios', 'decision_options', 'decisions', 'decision_conditions',
    'milestone_options', 'milestones', 'goals',
    'pipeline_item_stage_extensions', 'stage_history', 'diligence_items', 'deal_financials', 'job_details',
    'investor_details', 'consulting_details', 'deal_todos', 'projects', 'pipeline_items',
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

-- 6. Check function
create or replace function public.schema_has_0025()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0025() from public, anon;
grant execute on function public.schema_has_0025() to authenticated, service_role;

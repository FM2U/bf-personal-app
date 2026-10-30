-- BF Personal App: database update 0017 (partner report templates).
-- For a database that has 0001 to 0016 (the live database with 0001 to 0017 uses UPDATE_0018_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, and no existing
-- record is changed or deleted. What it adds:
--   A table of partner report templates (which measures a report shows, the period, an optional note) with three
--   starter templates for you and future owners: Summary, Standard, Detailed.
--   A default template on each accountability partner (Standard for existing partners).
--   Reset all data: also deletes templates you added and keeps the three starter templates. And a check function.
-- The balance sheet and the deal scorecard need no database change.
-- Generated from supabase/migrations/0017_partner_report_templates.sql by supabase/build_combined.py.

-- 0017: Partner report templates (approved 2026-10-29). Depends on 0005 (partners), 0006 (owner_only policy and
-- change log), 0014 (reset_all_data), and 0016 (owner setup function).
-- Safe to run more than once: every statement checks first, and existing templates and partner choices are never changed.
--
-- What it adds:
--   1. partner_report_templates: which measures a partner report shows (high-level ones such as commitments met and
--      missed, completion %, tasks done; detailed ones such as each daily target count, reply rate, pipeline moves per
--      pipeline, runway months), the period (week by default, two weeks, or month), and an optional short note.
--      Three starter templates for every owner: Summary, Standard, Detailed (starter_key). The owner can add, edit,
--      rename, and delete templates; a deleted starter template is created again only by "Reset all data".
--   2. partners.report_template_id: the default template for each accountability partner (Standard for existing
--      partners). At send time another template, or two templates together, can be chosen.
--   3. reset_all_data(): the same as 0014, plus: templates the owner added are deleted, and the starter templates are
--      kept (created again when missing).
--   4. public.schema_has_0017(): the app calls it to check that this update is applied.
--
-- The balance sheet (Finance) and the deal scorecard (pipelines) need no database change: they use account_balances
-- (balance history) and existing pipeline data.

-- 1. Templates
create table if not exists public.partner_report_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  measures text[] not null default '{}',
  period text not null default 'week' check (period in ('week', 'two_weeks', 'month')),
  note text,
  -- 'summary', 'standard', or 'detailed' for the three starter templates; null for templates the owner adds.
  starter_key text check (starter_key in ('summary', 'standard', 'detailed')),
  sort_order int not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists partner_report_templates_starter_idx on public.partner_report_templates (owner_id, starter_key) where starter_key is not null;
create index if not exists partner_report_templates_owner_idx on public.partner_report_templates (owner_id, sort_order, name);

-- 2. Default template per partner (nullable; the app uses Standard when empty)
alter table public.partners add column if not exists report_template_id uuid references public.partner_report_templates (id) on delete set null;

-- Row Level Security, owner-only policy, grants, updated_at, and change log (the same statements as 0014).
do $$
declare
  t text := 'partner_report_templates';
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

-- Starter templates for one owner. Only adds a starter template that is missing (matched by starter_key), and gives
-- every partner without a template the Standard template. Measure keys are listed in src/lib/calc/partner-report.ts.
create or replace function public.seed_owner_report_templates(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_standard uuid;
begin
  insert into partner_report_templates (owner_id, name, measures, period, note, starter_key, sort_order)
  select p_owner, s.name, s.measures, 'week', null, s.key, s.sort_order
  from (values
    ('summary', 'Summary', array['completion_pct', 'commitments_met', 'commitments_missed', 'targets_met_pct'], 1),
    ('standard', 'Standard', array['completion_pct', 'commitments_met', 'commitments_missed', 'tasks_done', 'tasks_overdue',
                                   'deals_sourced', 'outreach_done', 'targets_met_pct'], 2),
    ('detailed', 'Detailed', array['completion_pct', 'commitments_met', 'commitments_missed', 'tasks_done', 'tasks_overdue',
                                   'deals_sourced', 'outreach_done', 'targets_met_pct', 'listings_screened', 'cims_reviewed',
                                   'deal_calls', 'network_outreach', 'reply_rate', 'meetings_booked', 'pipeline_moves',
                                   'runway_months', 'milestones_due'], 3)
  ) as s (key, name, measures, sort_order)
  where not exists (select 1 from partner_report_templates t where t.owner_id = p_owner and t.starter_key = s.key);

  select id into v_standard from partner_report_templates where owner_id = p_owner and starter_key = 'standard';
  update partners set report_template_id = v_standard where owner_id = p_owner and report_template_id is null;
end;
$$;

revoke execute on function public.seed_owner_report_templates(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function also creates the starter templates.
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
  return new;
end;
$$;

-- Existing owners: add the starter templates once and give each partner the Standard template.
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_report_templates(r.owner_id);
  end loop;
end $$;

-- 3. Reset all data. The same as 0014, plus: templates the owner added are deleted; starter templates stay (and are
-- created again when missing). Deleted (in this order): see delete_order below.
-- Kept: owner_profile, entities, inputs and input_history (Inputs and Assumptions values), categories,
--   categorization_rules, import_layouts (saved column layouts per bank), pipelines, pipeline_stages, stage_tasks,
--   targets (definitions; "Counting starts on" is set to today), task_templates, the default initiatives (Personal
--   Finance, Acquisition Search, Employment, Rosara, Other Income, Consulting, and any initiative a pipeline belongs
--   to), the starter partner report templates (Summary, Standard, Detailed), google_connections, plaid_items, ai_usage
--   (needed for the monthly AI cap), and change_log (one entry "All data reset" is added with the counts).
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

-- 4. Check function
create or replace function public.schema_has_0017()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0017() from public, anon;
grant execute on function public.schema_has_0017() to authenticated, service_role;

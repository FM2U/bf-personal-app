-- 0021: Edit batch A (approved 2026-10-31): listing and company names, open questions as structured text,
-- the "Also to do" checklist per deal, and "Chase" renamed "Follow up" in the stage defaults.
-- Depends on 0020 (the Work module: pipeline_items columns, the acquisition stages and their default next actions).
-- Safe to run more than once: every statement checks first. Nothing is deleted; no deal is changed except the two
-- renamed default next action titles (the deal keeps its due date).
--
-- What it adds:
--   1. pipeline_items.company_name: the real company name once it is known. The existing name column holds the
--      listing name ("00 Industrial Filtration Distributor" until the company is named). The screens show the
--      company name when set, otherwise the listing name.
--   2. pipeline_items.open_questions_json: the open questions as three groups of lines, {"seller": [...],
--      "broker": [...], "self": [...]} (Ask the seller, Ask the broker, Find out myself). Lines typed earlier into the
--      plain-text open_questions column are copied once into the "seller" group; the old column is kept as it was.
--   3. deal_todos: the "Also to do" checklist of a deal (text, position, done_at), owner-only like the other tables,
--      deleted with its deal (Remove sample data deletes deals, so the to-dos go with them; Reset all data lists the
--      table too, so its count shows in the summary).
--   4. "Chase" becomes "Follow up" in the two stage defaults that used the word (stage_tasks and the deals whose next
--      action is still that default), in the waiting setting's description, and in the seed for future owners.
--   5. public.schema_has_0021(): the app calls it to check that this update is applied. Before it runs, the Work
--      screens show "Database update needed" and every other screen keeps working.

-- 1 and 2. Columns on pipeline_items
alter table public.pipeline_items add column if not exists company_name text;
alter table public.pipeline_items add column if not exists open_questions_json jsonb;

-- Open questions typed before this update (one per line) become "Ask the seller" lines, once.
update public.pipeline_items
   set open_questions_json = jsonb_build_object(
         'seller', coalesce((select jsonb_agg(l) from (select trim(x) as l from unnest(string_to_array(open_questions, E'\n')) as x where trim(x) <> '') q), '[]'::jsonb),
         'broker', '[]'::jsonb,
         'self', '[]'::jsonb)
 where open_questions_json is null and open_questions is not null and trim(open_questions) <> '';

-- 3. The "Also to do" checklist per deal
create table if not exists public.deal_todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deal_id uuid not null references public.pipeline_items (id) on delete cascade,
  text text not null,
  position int not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists deal_todos_deal_idx on public.deal_todos (deal_id, position);

-- Row Level Security, owner-only policy, grants, and change log (the same statements as 0014, 0017, and 0019).
do $$
declare
  t text := 'deal_todos';
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
  if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
    execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
  end if;
end $$;

-- 4. "Chase" becomes "Follow up" in the stage defaults. The deals that still carry the old default get the new text
-- (same action, same due date), so Done keeps asking about the next stage.
update public.stage_tasks set title = 'Follow up with the broker for the CIM and the call' where title = 'Chase the broker for the CIM and the call';
update public.stage_tasks set title = 'Wait for the broker, follow up in 7 days' where title = 'Wait for the broker, chase in 7 days';
update public.pipeline_items set next_action = 'Follow up with the broker for the CIM and the call' where next_action = 'Chase the broker for the CIM and the call';
update public.pipeline_items set next_action = 'Wait for the broker, follow up in 7 days' where next_action = 'Wait for the broker, chase in 7 days';
update public.inputs set description = replace(description, 'Chase resets the count.', 'Follow up resets the count.')
 where key = 'waiting_threshold_days' and description like '%Chase resets the count.%';

-- The seed for future owners (the same as 0020 with the two renamed titles).
create or replace function public.seed_owner_work_module(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  r record;
  v_from uuid;
  v_to uuid;
  v_stage uuid;
begin
  for p in select id from pipelines where owner_id = p_owner and kind = 'acquisition' loop
    -- One-to-one renames keep the stage id (targets, stage history, and extensions stay valid).
    for r in select * from (values ('Screened', 'Interested'), ('CIM reviewed', 'CIM review'), ('IOI sent', 'IOI or LOI')) v (old_name, new_name) loop
      if exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.old_name)
         and not exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.new_name) then
        update pipeline_stages set name = r.new_name where pipeline_id = p.id and name = r.old_name;
      end if;
    end loop;

    -- Every stage of the new list exists.
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome)
    select p_owner, p.id, v.name, v.pos, v.outcome
      from (values
        ('Interested', 1, 'open'), ('NDA signed', 2, 'open'), ('Broker call', 3, 'open'), ('CIM review', 4, 'open'),
        ('Seller call', 5, 'open'), ('Model', 6, 'open'), ('Partner presentation', 7, 'open'), ('IOI or LOI', 8, 'open'),
        ('Diligence', 9, 'open'), ('Closed', 10, 'won'), ('Passed', 11, 'lost'), ('Lost', 12, 'lost')
      ) as v (name, pos, outcome)
     where not exists (select 1 from pipeline_stages s where s.pipeline_id = p.id and s.name = v.name);

    -- Items in a stage that goes away move to the nearest new stage. The move is a remap, not progress: the stage
    -- defaults and stage task triggers stay quiet (no new next action, no new tasks), and days in stage are kept.
    for r in select * from (values ('Sourced', 'Interested'), ('LOI signed', 'IOI or LOI')) v (old_name, new_name) loop
      select id into v_from from pipeline_stages where pipeline_id = p.id and name = r.old_name;
      if v_from is not null then
        select id into v_to from pipeline_stages where pipeline_id = p.id and name = r.new_name;
        alter table public.pipeline_items disable trigger pipeline_items_before;
        alter table public.pipeline_items disable trigger pipeline_items_stage_defaults;
        alter table public.pipeline_items disable trigger pipeline_items_stage_tasks;
        update pipeline_items set stage_id = v_to where pipeline_id = p.id and stage_id = v_from;
        alter table public.pipeline_items enable trigger pipeline_items_before;
        alter table public.pipeline_items enable trigger pipeline_items_stage_defaults;
        alter table public.pipeline_items enable trigger pipeline_items_stage_tasks;
        update targets set stage_id = v_to where stage_id = v_from;
        update pipeline_item_stage_extensions set stage_id = v_to where stage_id = v_from;
        delete from pipeline_stages where id = v_from;
      end if;
    end loop;

    -- Positions in the approved order.
    update pipeline_stages s set position = v.pos
      from (values
        ('Interested', 1), ('NDA signed', 2), ('Broker call', 3), ('CIM review', 4), ('Seller call', 5), ('Model', 6),
        ('Partner presentation', 7), ('IOI or LOI', 8), ('Diligence', 9), ('Closed', 10), ('Passed', 11), ('Lost', 12)
      ) as v (name, pos)
     where s.pipeline_id = p.id and s.name = v.name and s.position <> v.pos;

    -- Time limits for the stages that are new (the others keep theirs).
    update pipeline_stages s set max_days_in_stage = v.days
      from (values ('Broker call', 7), ('Seller call', 10), ('Model', 14), ('Partner presentation', 14)) as v (name, days)
     where s.pipeline_id = p.id and s.name = v.name and s.max_days_in_stage is null;

    -- The default next action of each stage. A stage that already has this title keeps its list (the owner may have
    -- edited it); otherwise its old list is replaced by the one approved default.
    for r in select * from (values
        ('Interested', 'Sign the NDA and ask the broker for a call', 1),
        ('NDA signed', 'Follow up with the broker for the CIM and the call', 3),
        ('Broker call', 'Ask for the seller call', 2),
        ('CIM review', 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3),
        ('Seller call', 'Ask for tax returns and start the model', 3),
        ('Model', 'Book the partner meeting', 5),
        ('Partner presentation', 'Submit the IOI or LOI', 5),
        ('IOI or LOI', 'Wait for the broker, follow up in 7 days', 7),
        ('Diligence', 'Data room, quality of earnings, lawyer review', 14)
      ) v (stage, title, due) loop
      select id into v_stage from pipeline_stages where pipeline_id = p.id and name = r.stage;
      if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage and title = r.title) then
        -- A deal whose next action is still the stage's old default gets the new default (its due date stays).
        update pipeline_items set next_action = r.title
         where pipeline_id = p.id and stage_id = v_stage and status = 'open'
           and next_action in (select title from stage_tasks where pipeline_stage_id = v_stage and is_next_action_default);
        delete from stage_tasks where pipeline_stage_id = v_stage;
        insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
        values (p_owner, v_stage, r.title, r.due, 1, true, true);
      end if;
    end loop;
    -- Lost gets the same kind of note task as Passed (not a next action, not a commitment).
    select id into v_stage from pipeline_stages where pipeline_id = p.id and name = 'Lost';
    if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage) then
      insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
      values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
    end if;
  end loop;

  -- The waiting setting (Plan, Inputs, category Acquisition).
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'waiting_threshold_days', 'Days waiting on someone before it is marked amber', 'Acquisition', 'number', 5, null,
     'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Follow up resets the count.', 80)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_owner_work_module(uuid) from public, anon, authenticated;

-- Reset all data also lists the to-dos (the same function as 0019 otherwise; they would go with their deals anyway).
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
    'investor_details', 'consulting_details', 'deal_todos', 'pipeline_items',
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
create or replace function public.schema_has_0021()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0021() from public, anon;
grant execute on function public.schema_has_0021() to authenticated, service_role;

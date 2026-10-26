-- LOCAL TESTING ONLY. Checks the migrations behave as intended.
\set ON_ERROR_STOP 1

-- 1. Creating the owner seeds the default configuration.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'owner@example.com');

do $$ begin
  assert (select count(*) from public.pipelines) = 6, 'expected 6 pipelines';
  assert (select count(*) from public.initiatives) = 6, 'expected 6 initiatives';
  assert (select count(*) from public.pipeline_stages) = 42, 'expected 42 stages';
  assert (select count(*) from public.inputs) > 20, 'expected inputs';
  assert (select count(*) from public.owner_profile) = 1, 'expected owner profile';
end $$;

-- 2. A second account is rejected.
do $$ begin
  begin
    insert into auth.users (email) values ('other@example.com');
    raise exception 'second account was allowed';
  exception when raise_exception then
    if sqlerrm = 'second account was allowed' then raise; end if;
  end;
end $$;

-- 3. Row Level Security: owner with aal2 can read and write; aal1 sees nothing.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.aal', 'aal1', false);
do $$ begin
  assert (select count(*) from public.pipelines) = 0, 'aal1 session must not see data';
end $$;
select set_config('request.jwt.claim.aal', 'aal2', false);
do $$ begin
  assert (select count(*) from public.pipelines) = 6, 'aal2 owner must see data';
end $$;

insert into public.accounts (name, kind) values ('Test checking', 'checking');
insert into public.account_balances (account_id, balance) select id, 1000 from public.accounts where name = 'Test checking';
do $$ begin
  assert (select balance from public.account_current_balances limit 1) = 1000, 'current balance view';
  assert (select count(*) from public.change_log where table_name = 'accounts') >= 1, 'change log insert row';
end $$;

-- 4. Inputs history.
update public.inputs set value_number = 9 where key = 'runway_target_months';
do $$ begin
  assert (select count(*) from public.input_history) = 1, 'input history row';
end $$;

-- 5. Stage history and status from stage outcome.
insert into public.pipeline_items (pipeline_id, stage_id, name)
select p.id, s.id, 'Test deal' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id
where p.name = 'Acquisitions' and s.name = 'Sourced';
update public.pipeline_items set stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Passed'
) where name = 'Test deal';
do $$ begin
  assert (select count(*) from public.stage_history) = 2, 'stage history rows';
  assert (select status from public.pipeline_items where name = 'Test deal') = 'lost', 'status follows stage outcome';
end $$;

-- 6. AI proposal approval (single-field update and create), actor recorded as ai.
insert into public.ai_proposals (table_name, action, record_id, payload, summary)
select 'accounts', 'update', id, '{"name":"Renamed checking"}', 'Rename account' from public.accounts where name = 'Test checking';
select public.apply_proposal((select id from public.ai_proposals limit 1));
do $$ begin
  assert exists (select 1 from public.accounts where name = 'Renamed checking'), 'proposal applied';
  assert exists (select 1 from public.change_log where table_name = 'accounts' and field = 'name' and actor = 'ai'), 'actor ai';
end $$;
insert into public.ai_proposals (table_name, action, payload, summary, group_id)
values ('tasks', 'create', '{"title":"Option A","due_date":"2027-01-01"}', 'A', '00000000-0000-0000-0000-0000000000aa'),
       ('tasks', 'create', '{"title":"Option B"}', 'B', '00000000-0000-0000-0000-0000000000aa');
select public.apply_proposal((select id from public.ai_proposals where summary = 'A'), '{"priority":1}');
do $$ begin
  assert (select priority from public.tasks where title = 'Option A') = 1, 'override applied';
  assert (select status from public.ai_proposals where summary = 'B') = 'rejected', 'sibling rejected';
end $$;
do $$ begin
  begin
    insert into public.ai_proposals (table_name, action, payload, summary) values ('change_log', 'create', '{}', 'bad');
    perform public.apply_proposal((select id from public.ai_proposals where summary = 'bad'));
    raise exception 'blocked table allowed';
  exception when raise_exception then
    if sqlerrm = 'blocked table allowed' then raise; end if;
  end;
end $$;

-- 7. Finalized partner reports cannot change.
insert into public.partners (name) values ('Accountability partner A');
insert into public.partner_reports (partner_id, period_start, period_end, status, snapshot, summary, finalized_at)
select id, '2026-10-01', '2026-10-07', 'finalized', '{"runway":7}', 'Summary', now() from public.partners;
update public.partner_reports set reviewed_at = now();
do $$ begin
  begin
    update public.partner_reports set summary = 'changed';
    raise exception 'finalized report changed';
  exception when raise_exception then
    if sqlerrm = 'finalized report changed' then raise; end if;
  end;
end $$;

-- 8. Task completed_at is set automatically.
update public.tasks set status = 'done' where title = 'Option A';
do $$ begin
  assert (select completed_at from public.tasks where title = 'Option A') is not null, 'completed_at set';
end $$;

-- 9. Deleting a record as the owner works and is logged.
delete from public.tasks where title = 'Option A';
do $$ begin
  assert exists (select 1 from public.change_log where table_name = 'tasks' and action = 'delete'), 'delete logged';
end $$;

-- 10. Targets and outreach (0008): owner sees the seeded target, manual taps and outreach logging work.
do $$ begin
  assert (select count(*) from public.targets) = 3, 'aal2 owner must see the 3 seeded targets';
  assert (select count_source from public.targets where name = 'Network outreach') = 'communications_outreach', 'seed target source';
  assert (select minimum_count from public.targets where name = 'Network outreach') = 3, 'seed target minimum';
  assert (select active_weekdays from public.targets where name = 'Network outreach') = '{1,2,3,4,5}'::int[], 'seed target weekdays';
  assert (select i.name from public.targets t join public.initiatives i on i.id = t.initiative_id where t.name = 'Network outreach') = 'Acquisition Search', 'seed target initiative';
end $$;
insert into public.target_entries (target_id, entry_date, count) select id, current_date, 2 from public.targets where name = 'Network outreach';
insert into public.communications (method, subject, is_outreach, outcome) values ('email', 'Outreach test', true, 'replied');
insert into public.contacts (name, relationship_group, outreach_every_days) values ('Test contact', 'warm', null);
do $$ begin
  assert (select count(*) from public.target_entries) = 1, 'target entry saved';
  assert exists (select 1 from public.change_log where table_name = 'target_entries' and action = 'insert'), 'target entry change log';
  assert (select count(*) from public.communications where is_outreach) = 1, 'outreach communication saved';
end $$;
do $$ begin
  begin
    insert into public.communications (method, subject, is_outreach, outcome) values ('email', 'Bad outcome', true, 'maybe');
    raise exception 'invalid outcome allowed';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.aal', 'aal1', false);
do $$ begin
  assert (select count(*) from public.targets) = 0, 'aal1 session must not see targets';
  assert (select count(*) from public.target_entries) = 0, 'aal1 session must not see target entries';
end $$;
select set_config('request.jwt.claim.aal', 'aal2', false);

-- 11. The anon role (public visitors) cannot read any table.
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.partner_links limit 1;
    raise exception 'anon read allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  begin
    perform 1 from public.targets limit 1;
    raise exception 'anon read of targets allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- 12. New tables have Row Level Security and the owner-only policy; the target seed does not duplicate.
do $$
declare t text;
begin
  foreach t in array array['targets', 'target_entries', 'target_misses'] loop
    assert (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass), format('RLS on %s', t);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only'), format('policy on %s', t);
    assert exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change'), format('change log on %s', t);
  end loop;
end $$;
select public.seed_owner_targets('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.targets) = 3, 'seed targets must not duplicate';
end $$;

-- 13. Pipeline accountability (0009): new tables locked to the owner, seeds present and not duplicated.
do $$
declare t text;
begin
  foreach t in array array['stage_tasks', 'pipeline_item_stage_extensions'] loop
    assert (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass), format('RLS on %s', t);
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only'), format('policy on %s', t);
    assert exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change'), format('change log on %s', t);
    assert exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'set_updated_at'), format('updated_at on %s', t);
  end loop;
end $$;
do $$ begin
  assert (select count(*) from public.stage_tasks) = 60, 'seeded stage tasks';
  assert (select count(distinct p.id) from public.stage_tasks st join public.pipeline_stages s on s.id = st.pipeline_stage_id join public.pipelines p on p.id = s.pipeline_id) = 6, 'stage tasks for all 6 pipelines';
  assert (select count(*) from public.pipeline_stages s where not exists (select 1 from public.stage_tasks st where st.pipeline_stage_id = s.id)) = 0, 'every stage has tasks';
  assert (select max_days_in_stage from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'LOI signed') = 30, 'LOI signed limit';
  assert (select required_fields from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'IOI sent') = '{revenue,ebitda,asking_price}'::text[], 'IOI sent required fields';
  assert (select count(*) from public.pipeline_stages s where outcome = 'open' and max_days_in_stage is null and s.name <> 'Active') = 0, 'every open stage has a time limit (except consulting Active)';
  assert (select count(*) from public.targets where name in ('Deals sourced', 'Deals advanced')) = 2, 'deal targets';
  assert (select minimum_count from public.targets where name = 'Deals sourced') = 5, 'deals sourced minimum';
  assert (select count_source from public.targets where name = 'Deals advanced') = 'deals_advanced', 'deals advanced source';
  assert (select s.name from public.targets t join public.pipeline_stages s on s.id = t.stage_id where t.name = 'Deals advanced') = 'NDA signed', 'deals advanced stage';
  assert (select start_date from public.targets where name = 'Deals sourced') = (now() at time zone 'America/New_York')::date, 'counting starts today (New York)';
  assert (select value_number from public.inputs where key = 'pipeline_stall_days') = 7, 'stall days input';
  assert (select category from public.inputs where key = 'pipeline_stall_days') = 'Opportunities', 'stall days category';
end $$;
select public.seed_owner_pipeline_accountability('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.stage_tasks) = 60, 'stage tasks must not duplicate';
  assert (select count(*) from public.targets) = 3, 'targets must not duplicate';
end $$;

-- 14. Entering a stage: default next action, stage tasks, commitments (once per item and stage task).
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
insert into public.pipeline_items (pipeline_id, stage_id, name, deal_source_type)
select p.id, s.id, 'Playbook deal', 'proprietary' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id
where p.name = 'Acquisitions' and s.name = 'Sourced';
do $$ begin
  assert (select next_action from public.pipeline_items where name = 'Playbook deal') = 'Request teaser or CIM', 'default next action';
  assert (select next_action_due from public.pipeline_items where name = 'Playbook deal') = (now() at time zone 'America/New_York')::date + 2, 'default next action due';
  assert (select count(*) from public.tasks where title like 'Playbook deal: %') = 2, 'Sourced stage tasks created';
  assert (select count(*) from public.commitments where title like 'Playbook deal: %') = 1, 'only the next-action stage task is a commitment';
  assert (select count(*) from public.commitments where title = 'Playbook deal: Request teaser or CIM') = 1, 'next-action task is the commitment';
  assert (select initiative_id is not null from public.tasks where title = 'Playbook deal: Request teaser or CIM'), 'task linked to initiative';
end $$;
update public.pipeline_items set stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Screened'
) where name = 'Playbook deal';
do $$ begin
  assert (select next_action from public.pipeline_items where name = 'Playbook deal') = 'Sign NDA', 'next action follows the new stage';
  assert (select count(*) from public.tasks where title like 'Playbook deal: %') = 4, 'Screened stage tasks added';
  assert (select count(*) from public.commitments where title like 'Playbook deal: %') = 2, 'one commitment per stage (Sign NDA added)';
end $$;
-- Back to Sourced and forward again: no duplicate tasks. A next action typed by hand is kept.
update public.pipeline_items set stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Sourced'
) where name = 'Playbook deal';
update public.pipeline_items set next_action = 'Call the owner directly', stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Screened'
) where name = 'Playbook deal';
do $$ begin
  assert (select count(*) from public.tasks where title like 'Playbook deal: %') = 4, 'stage tasks not duplicated on re-entry';
  assert (select next_action from public.pipeline_items where name = 'Playbook deal') = 'Call the owner directly', 'typed next action kept';
end $$;
-- Passing the item skips its open pipeline tasks and releases their commitments (not counted as missed).
update public.pipeline_items set stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Passed'
) where name = 'Playbook deal';
do $$ begin
  assert (select count(*) from public.tasks where title like 'Playbook deal: %' and status = 'todo') = 1, 'only the Passed stage task stays open';
  assert (select count(*) from public.commitments where title like 'Playbook deal: %' and status = 'open') = 0, 'no open commitments (the Passed task is a regular task)';
  assert (select count(*) from public.commitments where title like 'Playbook deal: %' and status = 'released') = 2, 'commitments released, not missed';
end $$;
-- Purpose defaults to deal_sourcing for deal-source contacts; the new count sources are accepted.
insert into public.contacts (name, is_deal_source) values ('Deal source CPA', true);
insert into public.communications (method, subject, contact_id, purpose)
select 'email', 'Asked about off-market sellers', id, null from public.contacts where name = 'Deal source CPA';
insert into public.communications (method, subject) values ('email', 'Plain note');
insert into public.targets (name, count_source) values ('Test deals advanced', 'deals_advanced');
insert into public.pipeline_item_stage_extensions (item_id, stage_id, stage_entered_at, extra_days)
select id, stage_id, stage_entered_at, 7 from public.pipeline_items where name = 'Playbook deal';
do $$ begin
  assert (select purpose from public.communications where subject = 'Asked about off-market sellers') = 'deal_sourcing', 'deal source purpose';
  assert (select purpose from public.communications where subject = 'Plain note') = 'general', 'general purpose';
  assert (select count(*) from public.pipeline_item_stage_extensions) = 1, 'extension saved';
end $$;
do $$ begin
  begin
    update public.pipeline_items set deal_source_type = 'rumor' where name = 'Playbook deal';
    raise exception 'invalid deal source allowed';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.aal', 'aal1', false);
do $$ begin
  assert (select count(*) from public.stage_tasks) = 0, 'aal1 session must not see stage tasks';
  assert (select count(*) from public.pipeline_item_stage_extensions) = 0, 'aal1 session must not see extensions';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.stage_tasks limit 1;
    raise exception 'anon read of stage tasks allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 15. Commitment rule (0010): times moved, released status, input, template and stage task defaults, run twice.
do $$ begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'times_moved'), 'tasks.times_moved';
  assert (select value_number from public.inputs where key = 'task_moved_review_threshold') = 5, 'moved threshold input';
  assert (select count(*) from public.task_templates where is_commitment) = 4, 'only the 4 review templates are commitments';
  assert (select bool_and(is_commitment) from public.task_templates where public.is_review_template_title(title)), 'review templates are commitments';
  assert not (select is_commitment from public.task_templates where title like 'Download the full data export%'), 'export template is a regular task';
  assert (select count(*) from public.stage_tasks where is_commitment <> is_next_action_default) = 0, 'only next-action stage tasks are commitments';
  assert (select count(*) from public.stage_tasks where is_commitment) = 30, 'one next-action task per open stage (30)';
  assert (select commitment_rule_applied_at is not null from public.owner_profile limit 1), 'rule applied to the owner';
end $$;
-- The owner's later choice in Settings is kept when the rule runs again.
update public.task_templates set is_commitment = true where title = 'Categorize new transactions';
select public.seed_owner_commitment_rule('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select is_commitment from public.task_templates where title = 'Categorize new transactions'), 'owner change kept';
  assert (select count(*) from public.inputs where key = 'task_moved_review_threshold') = 1, 'input not duplicated';
end $$;
update public.task_templates set is_commitment = false where title = 'Categorize new transactions';
do $$ begin
  begin
    insert into public.commitments (owner_id, title, record_type, record_id, due_date, status)
    values ('00000000-0000-0000-0000-000000000001', 'Bad status', 'tasks', gen_random_uuid(), current_date, 'forgotten');
    raise exception 'invalid commitment status allowed';
  exception when check_violation then null;
  end;
end $$;

-- 16. Source chain and Consulting (0011): new table locked to the owner, seeds present and not duplicated,
-- consulting items get their stage tasks, and the new columns and values are accepted.
do $$ begin
  assert (select relrowsecurity from pg_class where oid = 'public.consulting_details'::regclass), 'RLS on consulting_details';
  assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'consulting_details' and policyname = 'owner_only'), 'policy on consulting_details';
  assert exists (select 1 from pg_trigger where tgrelid = 'public.consulting_details'::regclass and tgname = 'log_change'), 'change log on consulting_details';
  assert exists (select 1 from pg_trigger where tgrelid = 'public.consulting_details'::regclass and tgname = 'set_updated_at'), 'updated_at on consulting_details';
  assert (select kind from public.pipelines where name = 'Consulting') = 'consulting', 'consulting pipeline';
  assert (select i.name from public.pipelines p join public.initiatives i on i.id = p.initiative_id where p.name = 'Consulting') = 'Consulting', 'consulting initiative';
  assert (select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting') = 9, '9 consulting stages';
  assert (select count(*) from public.stage_tasks st join public.pipeline_stages s on s.id = st.pipeline_stage_id join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting') = 14, '14 consulting stage tasks';
  assert (select count(*) from public.stage_tasks st join public.pipeline_stages s on s.id = st.pipeline_stage_id join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and st.is_commitment) = 7, 'one commitment per open consulting stage';
  assert (select required_fields from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and s.name = 'Signed') = '{rate_type,rate,start_date}'::text[], 'Signed required details';
  assert (select required_fields from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and s.name = 'Proposal sent') = '{rate_type,rate}'::text[], 'Proposal sent required details';
  assert (select max_days_in_stage from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and s.name = 'Proposal sent') = 14, 'Proposal sent limit';
  assert (select max_days_in_stage is null and counts_as_signed from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and s.name = 'Active'), 'Active: no limit, signed work';
  assert (select count(*) from public.pipeline_stages where counts_as_signed) = 2, 'Signed and Active count as signed work';
  assert (select default_probability_pct from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting' and s.name = 'Proposal sent') = 50, 'stage probability';
  assert (select value_number from public.inputs where key = 'runway_include_signed_consulting') = 0, 'runway consulting input off';
  assert (select category from public.inputs where key = 'runway_include_signed_consulting') = 'Runway', 'runway consulting category';
  assert (select value_number from public.inputs where key = 'consulting_months') = 12, 'consulting months input';
  assert (select value_number from public.inputs where key = 'consulting_monthly_income') = 0, 'consulting monthly income input';
end $$;
select public.seed_owner_consulting('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.pipelines) = 6, 'pipelines must not duplicate';
  assert (select count(*) from public.stage_tasks) = 60, 'stage tasks must not duplicate (consulting)';
  assert (select count(*) from public.inputs where key in ('runway_include_signed_consulting', 'consulting_monthly_income', 'consulting_months')) = 3, 'inputs not duplicated';
end $$;
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
insert into public.contacts (name, is_consulting_lead) values ('Consulting lead', true);
insert into public.pipeline_items (pipeline_id, stage_id, name, source_contact_id, introduced_by_contact_id)
select p.id, s.id, 'Consulting test', (select id from public.contacts where name = 'Consulting lead'), (select id from public.contacts where name = 'Deal source CPA')
from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id where p.name = 'Consulting' and s.name = 'Identified';
insert into public.consulting_details (item_id, rate_type, rate, expected_hours_per_month) select id, 'hourly', 150, 20 from public.pipeline_items where name = 'Consulting test';
insert into public.communications (method, subject, contact_id, purpose)
select 'email', 'Consulting availability', id, null from public.contacts where name = 'Consulting lead';
insert into public.accounts (name, kind) values ('Consulting checking', 'checking');
insert into public.transactions (account_id, date, amount, description, pipeline_item_id)
select a.id, current_date, 3000, 'Client payment', i.id from public.accounts a, public.pipeline_items i where a.name = 'Consulting checking' and i.name = 'Consulting test';
do $$ begin
  assert (select next_action from public.pipeline_items where name = 'Consulting test') = 'Research the client and their need', 'consulting default next action';
  assert (select count(*) from public.tasks where title like 'Consulting test: %') = 2, 'consulting stage tasks created';
  assert (select count(*) from public.commitments where title = 'Consulting test: Research the client and their need') = 1, 'consulting next action is a commitment';
  assert (select purpose from public.communications where subject = 'Consulting availability') = 'consulting', 'consulting lead purpose';
  assert (select count(*) from public.transactions where pipeline_item_id is not null) = 1, 'payment linked to the engagement';
  assert (select introduced_by_contact_id is not null from public.pipeline_items where name = 'Consulting test'), 'introduced by saved';
end $$;
do $$ begin
  begin
    insert into public.consulting_details (item_id, rate_type) select id, 'weekly' from public.pipeline_items where name = 'Playbook deal';
    raise exception 'invalid rate type allowed';
  exception when check_violation then null;
  end;
end $$;
select set_config('request.jwt.claim.aal', 'aal1', false);
do $$ begin
  assert (select count(*) from public.consulting_details) = 0, 'aal1 session must not see consulting details';
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.consulting_details limit 1;
    raise exception 'anon read of consulting details allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'smoke test passed' as result;

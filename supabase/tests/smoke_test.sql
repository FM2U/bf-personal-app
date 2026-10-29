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
  assert (select count(*) from public.targets) = 6, 'aal2 owner must see the 6 seeded targets (0008, 0009, 0016)';
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
  assert (select count(*) from public.targets) = 6, 'seed targets must not duplicate';
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
  assert (select count(*) from public.targets) = 6, 'targets must not duplicate';
end $$;

-- 13b. Deal funnel (0016): three targets and five inputs for the owner, owner-only, not duplicated by a second run.
do $$ begin
  assert (select count(*) from public.targets where name in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')) = 3, '0016 targets';
  assert (select count_source || ':' || period || ':' || minimum_count from public.targets where name = 'Listings screened') = 'manual:day:20', 'listings target';
  assert (select count_source || ':' || period || ':' || minimum_count from public.targets where name = 'CIMs reviewed') = 'cims_reviewed:day:1', 'CIMs target';
  assert (select count_source || ':' || period || ':' || minimum_count from public.targets where name = 'Broker or owner calls') = 'deal_calls:week:2', 'calls target';
  assert (select bool_and(is_commitment and active) from public.targets where name in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')), '0016 targets are active commitments';
  assert (select s.name from public.targets t join public.pipeline_stages s on s.id = t.stage_id where t.name = 'CIMs reviewed') = 'CIM reviewed', 'CIMs target stage';
  assert (select p.name from public.targets t join public.pipelines p on p.id = t.pipeline_id where t.name = 'Listings screened') = 'Acquisitions', 'listings target pipeline';
  assert (select i.name from public.targets t join public.initiatives i on i.id = t.initiative_id where t.name = 'Broker or owner calls') = 'Acquisition Search', '0016 initiative';
  assert (select start_date from public.targets where name = 'CIMs reviewed') = (now() at time zone 'America/New_York')::date, '0016 counting starts today (New York)';
  assert (select count(*) from public.inputs where category = 'Acquisition' and key in ('search_hours_per_day', 'minutes_per_listing_screen', 'minutes_per_cim_review', 'minutes_per_nda_reply', 'minutes_per_call')) = 5, '0016 inputs';
  assert (select value_number from public.inputs where key = 'search_hours_per_day') = 2, 'search hours default';
  assert (select value_number from public.inputs where key = 'minutes_per_cim_review') = 45, 'CIM minutes default';
  assert public.schema_has_0016(), '0016 check function';
end $$;
select public.seed_owner_deal_funnel('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.targets) = 6, '0016 targets must not duplicate';
  assert (select count(*) from public.inputs where key = 'search_hours_per_day') = 1, '0016 inputs must not duplicate';
end $$;
set role authenticated;
do $$ begin
  begin
    perform public.seed_owner_deal_funnel('00000000-0000-0000-0000-000000000001');
    raise exception 'a signed-in user can run the 0016 seed function';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.targets (name, count_source) values ('Bad source', 'cims_reviewed_typo');
    raise exception 'unknown count source allowed';
  exception when check_violation or insufficient_privilege then null;
  end;
end $$;
reset role;

-- 13c. Partner report templates (0017): three starter templates, not duplicated by a second run, owner-only.
do $$ begin
  assert (select count(*) from public.partner_report_templates where starter_key is not null) = 3, '0017 starter templates';
  assert (select name from public.partner_report_templates where starter_key = 'standard') = 'Standard', 'Standard template';
  assert (select array_length(measures, 1) from public.partner_report_templates where starter_key = 'detailed') = 17, 'Detailed has every measure';
  assert (select bool_and(period = 'week') from public.partner_report_templates), 'week by default';
  assert public.schema_has_0017(), '0017 check function';
  assert (select prosrc from pg_proc where proname = 'handle_new_owner') like '%seed_owner_report_templates%', 'owner setup seeds 0017';
end $$;
select public.seed_owner_report_templates('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.partner_report_templates) = 3, '0017 templates must not duplicate';
end $$;
set role authenticated;
do $$ begin
  begin
    perform public.seed_owner_report_templates('00000000-0000-0000-0000-000000000001');
    raise exception 'a signed-in user can run the 0017 seed function';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.partner_report_templates (name, period) values ('Bad period', 'year');
    raise exception 'unknown period allowed';
  exception when check_violation or insufficient_privilege then null;
  end;
end $$;
reset role;

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

-- 0012: relationship groups Friend and Other, the check function, and the runway setting text.
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
insert into public.contacts (name, relationship_group, roles) values ('Smoke friend', 'friend', '{friend}'), ('Smoke other', 'other', '{}');
do $$ begin
  assert (select count(*) from public.contacts where name in ('Smoke friend', 'Smoke other')) = 2, 'friend and other groups saved';
  assert public.schema_has_0012(), 'check function callable by the owner';
  assert (select description like '%until the item''s first payment is received%' from public.inputs where key = 'runway_include_signed_consulting'), 'runway setting text';
  begin
    insert into public.contacts (name, relationship_group) values ('Smoke bad group', 'acquaintance');
    raise exception 'unknown relationship group allowed';
  exception when check_violation then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.schema_has_0012();
    raise exception 'anon can call the 0012 check function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 0014: initiative builder (insert_record_batch), sample data (load and remove only sample rows), Reset all data.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select set_config('request.jwt.claim.aal', 'aal2', false);
do $$
declare
  v jsonb;
  pf uuid := (select id from public.initiatives where name = 'Personal Finance');
  tpl uuid := gen_random_uuid();
  ini uuid := gen_random_uuid();
  cl uuid := gen_random_uuid();
begin
  assert public.schema_has_0014(), '0014 check function';
  v := public.insert_record_batch(jsonb_build_array(
    jsonb_build_object('table', 'initiatives', 'rows', jsonb_build_array(jsonb_build_object('id', ini, 'name', 'Smoke meal plan', 'description', 'Cook on Sunday', 'parent_initiative_id', pf))),
    jsonb_build_object('table', 'goals', 'rows', jsonb_build_array(jsonb_build_object('initiative_id', ini, 'title', 'Food under 1000', 'metric_key', 'category_spending_last_month', 'metric_params', '{"categories":["Groceries"]}'::jsonb, 'target_value', 1000, 'deadline', current_date + 90))),
    jsonb_build_object('table', 'task_templates', 'rows', jsonb_build_array(jsonb_build_object('id', tpl, 'title', 'Shop for the week''s groceries', 'cadence', 'weekly', 'weekday', 6, 'initiative_id', ini))),
    jsonb_build_object('table', 'checklists', 'rows', jsonb_build_array(jsonb_build_object('id', cl, 'name', 'Grocery list', 'initiative_id', ini, 'task_template_id', tpl, 'reset_weekly', true))),
    jsonb_build_object('table', 'checklist_items', 'rows', jsonb_build_array(jsonb_build_object('checklist_id', cl, 'text', 'Eggs', 'quantity', '1 dozen'), jsonb_build_object('checklist_id', cl, 'text', 'Rice'))),
    jsonb_build_object('table', 'plan_documents', 'rows', jsonb_build_array(jsonb_build_object('initiative_id', ini, 'title', 'Menu', 'body', '- **Sunday:** cook'))),
    jsonb_build_object('table', 'record_links', 'rows', jsonb_build_array(jsonb_build_object('from_type', 'initiatives', 'from_id', ini, 'to_type', 'checklists', 'to_id', cl, 'relation', 'checklist')))
  ), 'ai', null);
  assert (v ->> 'checklist_items')::int = 2, 'batch counts';
  assert (select parent_initiative_id from public.initiatives where id = ini) = pf, 'parent initiative saved';
  assert (select count(*) from public.change_log where record_id = ini and actor = 'ai' and action = 'insert') = 1, 'approved AI records are logged as AI';
  -- All or nothing: a bad row rolls back the whole batch.
  begin
    perform public.insert_record_batch(jsonb_build_array(
      jsonb_build_object('table', 'initiatives', 'rows', jsonb_build_array(jsonb_build_object('name', 'Smoke rollback'))),
      jsonb_build_object('table', 'goals', 'rows', jsonb_build_array(jsonb_build_object('title', 'No deadline is fine', 'comparison', 'between')))
    ), 'ai', null);
    raise exception 'bad batch saved';
  exception when check_violation then null;
  end;
  assert not exists (select 1 from public.initiatives where name = 'Smoke rollback'), 'batch rolled back';
  begin
    perform public.insert_record_batch('[{"table":"change_log","rows":[{"table_name":"x","action":"insert"}]}]'::jsonb, 'owner', null);
    raise exception 'change_log written through the batch';
  exception when raise_exception then
    if sqlerrm = 'change_log written through the batch' then raise; end if;
  end;
end $$;
-- New tables: aal1 sees nothing, anon is refused
select set_config('request.jwt.claim.aal', 'aal1', false);
do $$ begin
  assert (select count(*) from public.checklists) = 0, 'aal1 must not see checklists';
  assert (select count(*) from public.sample_records) = 0, 'aal1 must not see sample records';
  begin
    perform public.reset_all_data('RESET');
    raise exception 'aal1 reset allowed';
  exception when raise_exception then
    if sqlerrm = 'aal1 reset allowed' then raise; end if;
  end;
  begin
    perform public.remove_sample_data();
    raise exception 'aal1 sample removal allowed';
  exception when raise_exception then
    if sqlerrm = 'aal1 sample removal allowed' then raise; end if;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.savings_ideas limit 1;
    raise exception 'anon read of savings ideas allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reset_all_data('RESET');
    raise exception 'anon reset allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Sample data: rows recorded in sample_records; one summary change log entry; Remove deletes only sample rows
-- and what the app made from them (stage tasks of a sample pipeline item).
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
insert into public.accounts (name, kind) values ('Real checking kept', 'checking');
do $$
declare
  b uuid := gen_random_uuid();
  acc uuid := gen_random_uuid();
  con uuid := gen_random_uuid();
  item uuid := gen_random_uuid();
  log_before int := (select count(*) from public.change_log);
  v jsonb;
begin
  v := public.insert_record_batch(jsonb_build_array(
    jsonb_build_object('table', 'accounts', 'rows', jsonb_build_array(jsonb_build_object('id', acc, 'name', 'Sample Checking', 'kind', 'checking'))),
    jsonb_build_object('table', 'transactions', 'rows', jsonb_build_array(
      jsonb_build_object('account_id', acc, 'date', current_date - 3, 'amount', -385, 'description', 'SAMPLE STORAGE CO. UNIT A', 'merchant_name', 'Sample Storage Co. Unit A'),
      jsonb_build_object('account_id', acc, 'date', current_date - 33, 'amount', -385, 'description', 'SAMPLE STORAGE CO. UNIT A', 'merchant_name', 'Sample Storage Co. Unit A'))),
    jsonb_build_object('table', 'contacts', 'rows', jsonb_build_array(jsonb_build_object('id', con, 'name', 'Sample Friend A', 'relationship_group', 'friend'))),
    jsonb_build_object('table', 'pipeline_items', 'rows', jsonb_build_array(jsonb_build_object('id', item, 'name', 'Sample HVAC Services Co.',
      'pipeline_id', (select id from public.pipelines where name = 'Acquisitions'),
      'stage_id', (select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Sourced'),
      'deal_source_type', 'proprietary', 'source_contact_id', con)))
  ), 'owner', b);
  assert (select count(*) from public.sample_records where batch_id = b) = 5, 'every sample row recorded';
  assert (select count(*) from public.change_log) = log_before + 1, 'one summary change log entry for the sample load';
  assert (select count(*) from public.change_log where field = 'sample_data_loaded') = 1, 'sample load summary entry';
  assert (select count(*) from public.tasks where pipeline_item_id = item) >= 1, 'stage tasks made for the sample item';
  insert into public.notes (record_type, record_id, body) values ('pipeline_items', item, 'Sample note');
  insert into public.record_links (from_type, from_id, to_type, to_id) values ('contacts', con, 'pipeline_items', item);
  v := public.remove_sample_data();
  assert (v ->> 'total')::int >= 5, 'removal counts';
  assert not exists (select 1 from public.accounts where id = acc), 'sample account removed';
  assert not exists (select 1 from public.transactions where account_id = acc), 'sample transactions removed';
  assert not exists (select 1 from public.pipeline_items where id = item), 'sample item removed';
  assert not exists (select 1 from public.tasks where pipeline_item_id = item or title like 'Sample HVAC%'), 'tasks made from the sample item removed';
  assert not exists (select 1 from public.notes where record_id = item), 'note on a sample row removed';
  assert not exists (select 1 from public.record_links where from_id = con or to_id = item), 'links removed';
  assert (select count(*) from public.sample_records) = 0, 'registry emptied';
  assert exists (select 1 from public.accounts where name = 'Real checking kept'), 'real account kept';
  assert exists (select 1 from public.initiatives where name = 'Smoke meal plan'), 'real initiative kept';
  assert (select count(*) from public.change_log where field = 'sample_data_removed') = 1, 'sample removal summary entry';
  assert (v -> 'storage_paths') = '[]'::jsonb, 'no files';
  v := public.remove_sample_data();
  assert (v ->> 'total')::int = 0, 'second removal finds nothing';
end $$;
reset role;

-- Reset all data: owner only, RESET typed, deletes data tables, keeps setup tables.
insert into public.google_connections (owner_id, google_email, status) values ('00000000-0000-0000-0000-000000000001', 'owner@example.com', 'connected');
insert into public.ai_usage (owner_id, purpose, model, cost_usd) values ('00000000-0000-0000-0000-000000000001', 'chat', 'test', 0.5);
insert into public.partners (owner_id, name) values ('00000000-0000-0000-0000-000000000001', 'Reset partner');
insert into public.partner_reports (owner_id, partner_id, period_start, period_end, status, finalized_at)
select owner_id, id, current_date - 7, current_date, 'finalized', now() from public.partners where name = 'Reset partner';
insert into public.ai_conversations (owner_id, title) values ('00000000-0000-0000-0000-000000000001', 'Reset chat');
insert into public.documents (owner_id, record_type, record_id, storage_path, file_name)
select owner_id, 'accounts', id, owner_id || '/accounts/statement.pdf', 'statement.pdf' from public.accounts where name = 'Real checking kept';
-- Partner report templates: one added, one starter renamed, one starter deleted (created again by the reset).
insert into public.partner_report_templates (owner_id, name, measures) values ('00000000-0000-0000-0000-000000000001', 'My own template', '{tasks_done}');
update public.partner_report_templates set name = 'Summary renamed' where starter_key = 'summary';
delete from public.partner_report_templates where starter_key = 'detailed';
update public.partners set report_template_id = (select id from public.partner_report_templates where name = 'My own template') where name = 'Reset partner';
update public.targets set start_date = current_date - 30;
create temp table reset_before as
select (select count(*) from public.pipelines) pipelines, (select count(*) from public.pipeline_stages) stages,
       (select count(*) from public.stage_tasks) stage_tasks, (select count(*) from public.targets) targets,
       (select count(*) from public.task_templates) templates, (select count(*) from public.categories) categories,
       (select count(*) from public.categorization_rules) rules, (select count(*) from public.inputs) inputs,
       (select count(*) from public.ai_usage) ai_usage, (select count(*) from public.change_log) change_log,
       (select count(*) from public.entities) entities;
grant select on reset_before to authenticated;
set role authenticated;
select set_config('request.jwt.claim.aal', 'aal2', false);
do $$
declare v jsonb;
begin
  assert (select count(*) from public.transactions) > 0 and (select count(*) from public.contacts) > 0 and (select count(*) from public.tasks) > 0, 'data exists before the reset';
  begin
    perform public.reset_all_data('reset');
    raise exception 'lowercase confirmation allowed';
  exception when raise_exception then
    if sqlerrm = 'lowercase confirmation allowed' then raise; end if;
  end;
  -- Another signed-in user (not the owner) is refused.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
  begin
    perform public.reset_all_data('RESET');
    raise exception 'another user reset allowed';
  exception when raise_exception then
    if sqlerrm = 'another user reset allowed' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  assert (select count(*) from public.transactions) > 0, 'refused resets deleted nothing';

  v := public.reset_all_data('RESET');
  assert (v ->> 'total')::int > 0, 'reset counts';
  assert (v -> 'storage_paths') ? '00000000-0000-0000-0000-000000000001/accounts/statement.pdf', 'document paths returned for file removal';
  -- Deleted
  assert (select count(*) from public.transactions) = 0, 'transactions deleted';
  assert (select count(*) from public.accounts) = 0, 'accounts deleted';
  assert (select count(*) from public.account_balances) = 0, 'balances deleted';
  assert (select count(*) from public.debts) = 0, 'debts deleted';
  assert (select count(*) from public.funding_sources) = 0, 'funding deleted';
  assert (select count(*) from public.income_sources) = 0, 'income deleted';
  assert (select count(*) from public.pipeline_items) = 0, 'pipeline items deleted';
  assert (select count(*) from public.stage_history) = 0, 'stage history deleted';
  assert (select count(*) from public.contacts) = 0, 'contacts deleted';
  assert (select count(*) from public.organizations) = 0, 'organizations deleted';
  assert (select count(*) from public.communications) = 0, 'communications deleted';
  assert (select count(*) from public.tasks) = 0, 'tasks deleted';
  assert (select count(*) from public.commitments) = 0, 'commitments deleted';
  assert (select count(*) from public.reviews) = 0, 'reviews deleted';
  assert (select count(*) from public.partners) = 0 and (select count(*) from public.partner_reports) = 0, 'partners and finalized reports deleted';
  assert (select count(*) from public.documents) = 0 and (select count(*) from public.notes) = 0, 'documents and notes deleted';
  assert (select count(*) from public.checklists) = 0 and (select count(*) from public.checklist_items) = 0 and (select count(*) from public.plan_documents) = 0, 'checklists and plans deleted';
  assert (select count(*) from public.record_links) = 0, 'links deleted';
  assert (select count(*) from public.ai_conversations) = 0 and (select count(*) from public.ai_proposals) = 0, 'AI conversations and proposals deleted';
  assert (select count(*) from public.goals) = 0 and (select count(*) from public.milestones) = 0, 'goals and milestones deleted';
  assert (select count(*) from public.decisions) = 0 and (select count(*) from public.alerts) = 0, 'decisions and alerts deleted';
  assert (select count(*) from public.target_entries) = 0 and (select count(*) from public.target_misses) = 0, 'target counts deleted';
  assert not exists (select 1 from public.initiatives where name = 'Smoke meal plan'), 'owner-created initiative deleted';
  -- Kept
  assert (select count(*) from public.initiatives) = 6, 'default initiatives kept';
  assert (select count(*) from public.pipelines) = (select pipelines from reset_before), 'pipelines kept';
  assert (select count(*) from public.pipeline_stages) = (select stages from reset_before), 'stages kept';
  assert (select count(*) from public.stage_tasks) = (select stage_tasks from reset_before), 'stage task lists kept';
  assert (select count(*) from public.targets) = (select targets from reset_before), 'targets kept';
  assert (select bool_and(start_date = (now() at time zone 'America/New_York')::date) from public.targets), 'targets count from today';
  assert (select count(*) from public.task_templates) = (select templates from reset_before), 'recurring tasks kept';
  assert (select count(*) from public.categories) = (select categories from reset_before), 'categories kept';
  assert (select count(*) from public.categorization_rules) = (select rules from reset_before), 'category rules kept';
  assert (select count(*) from public.inputs) = (select inputs from reset_before), 'inputs kept';
  assert (select count(*) from public.ai_usage) = (select ai_usage from reset_before), 'AI usage kept';
  assert (select count(*) from public.entities) = (select entities from reset_before), 'entities kept';
  assert (select count(*) from public.owner_profile) = 1, 'owner profile kept';
  assert (select count(*) from public.google_connections) = 1, 'Google connection kept';
  -- Defaults created again; one change log entry, not one per deleted row
  assert (select count(*) from public.budgets) = 1, 'default budget created again';
  assert (select count(*) from public.savings_targets) = 2, 'default savings targets created again';
  assert (select count(*) from public.decision_conditions where name = 'Runway under 6 months') = 1, 'default condition created again';
  assert (select count(*) from public.change_log) <= (select change_log from reset_before) + 6, 'change log not filled with one entry per deleted row';
  assert (select count(*) from public.change_log where field = 'all_data_reset' and actor = 'owner') = 1, 'All data reset entry';
  assert (select count(*) from public.partner_report_templates where starter_key is null) = 0, 'templates you added deleted';
  assert (select count(*) from public.partner_report_templates where starter_key is not null) = 3, 'starter templates kept or created again';
  assert (select name from public.partner_report_templates where starter_key = 'summary') = 'Summary renamed', 'renamed starter template kept as is';
end $$;
reset role;

select 'smoke test passed' as result;

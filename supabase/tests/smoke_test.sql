-- LOCAL TESTING ONLY. Checks the migrations behave as intended.
\set ON_ERROR_STOP 1

-- 1. Creating the owner seeds the default configuration.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'owner@example.com');

do $$ begin
  assert (select count(*) from public.pipelines) = 5, 'expected 5 pipelines';
  assert (select count(*) from public.initiatives) = 5, 'expected 5 initiatives';
  assert (select count(*) from public.pipeline_stages) = 33, 'expected 33 stages';
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
  assert (select count(*) from public.pipelines) = 5, 'aal2 owner must see data';
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

-- 10. The anon role (public visitors) cannot read any table.
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.partner_links limit 1;
    raise exception 'anon read allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'smoke test passed' as result;

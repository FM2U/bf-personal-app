-- BF Personal App: update for the report redesign of 2026-11-15 (push I). For the NEW database (bf-personal-app-final)
-- that already has SETUP_NEW_DATABASE.sql and the updates B, C, D, E, E2, F, G and H run. SQL Editor, New query, paste
-- this whole file, Run. Safe to run twice.
--
-- What it changes (Bram, 2026-11-15; claude/2026-11-15-report-redesign-decisions-log.md):
--   Stage names (each stage keeps its id, its deals, their history and your default next actions):
--     Acquisitions: "Diligence" (after the LOI) becomes "Confirmatory diligence", then "Model" becomes "Diligence".
--     Job search: "Contact" becomes "Lead"; "Conversation" becomes "Applied" (its default next action, if you never
--       changed it, becomes "Follow up on the application", 5 days).
--     Consulting: a new stage "Intro call" between Lead and Proposal (default next action "Send the scope and fee",
--       3 days); "Proposal" becomes "Proposal sent" (its default next action, if you never changed it, becomes
--       "Follow up on the proposal", 5 days). The stages after it move down one place.
--     A deal, job or consulting item whose next action is still the old default of its stage ("Send a thank-you note
--       and ask about the next step" at Applied, "Send the scope and fee" at Proposal sent) gets the new default's
--       text; its due date stays.
--   Top priorities (used from the next release): on deals, jobs and consulting items (pipeline_items) and on Rosara
--     projects (projects): priority_rank (1 to 3, one of each per pipeline), why_fits, strength (hot, warm, cold),
--     next_decision and next_decision_on. All empty to start.
--   A new table, decisions: one line per go or no-go you mark on a record, for "Decided this week".
--   No other table or row changes. Nothing is deleted.
--
-- The last statement is a check. Expected result: one row, push_i_ready = true, acquisition_stages = 9 names ending in
-- "Confirmatory diligence", job_stages = Lead, Applied, Interview, Offer, consulting_stages = Lead, Intro call, Proposal
-- sent, Engagement, Paid.

do $$
declare
  p record;
  v_stage uuid;
  v_pos int;
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push H update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'owner_profile' and column_name = 'week_start') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_H.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;

  -- Acquisitions: only while "Model" is still there (a second run finds none and changes nothing).
  for p in select id from public.pipelines where kind = 'acquisition' loop
    if exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Model') then
      if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Confirmatory diligence') then
        update public.pipeline_stages set name = 'Confirmatory diligence' where pipeline_id = p.id and name = 'Diligence';
      end if;
      if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Diligence') then
        update public.pipeline_stages set name = 'Diligence' where pipeline_id = p.id and name = 'Model';
      end if;
    end if;
  end loop;

  -- Job search.
  for p in select id from public.pipelines where kind = 'job' loop
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Lead') then
      update public.pipeline_stages set name = 'Lead' where pipeline_id = p.id and name = 'Contact';
    end if;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Applied') then
      update public.pipeline_stages set name = 'Applied' where pipeline_id = p.id and name = 'Conversation';
      update public.stage_tasks t set title = 'Follow up on the application', due_in_days = 5
        from public.pipeline_stages s
        where s.id = t.pipeline_stage_id and s.pipeline_id = p.id and s.name = 'Applied'
          and t.is_next_action_default and t.title = 'Send a thank-you note and ask about the next step' and t.due_in_days = 2;
      -- Items now at Applied that still carry the old default next action get the new text (their due date stays).
      update public.pipeline_items i set next_action = 'Follow up on the application'
        from public.pipeline_stages s
        where s.id = i.stage_id and s.pipeline_id = p.id and s.name = 'Applied' and i.next_action = 'Send a thank-you note and ask about the next step';
    end if;
  end loop;

  -- Consulting: Intro call is added once, after Lead; then Proposal is renamed.
  for p in select id, owner_id from public.pipelines where kind = 'consulting' loop
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Intro call') then
      -- Right after Lead (position 1 in the app's setup; the first stage if Lead was renamed).
      select coalesce((select position from public.pipeline_stages where pipeline_id = p.id and name = 'Lead'), 1) into v_pos;
      update public.pipeline_stages set position = position + 1 where pipeline_id = p.id and position > v_pos;
      insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed)
        values (p.owner_id, p.id, 'Intro call', v_pos + 1, 'open', 14, '{}'::text[], 25, false) returning id into v_stage;
      insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
        values (p.owner_id, v_stage, 'Send the scope and fee', 3, 1, true, false);
    end if;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Proposal sent') then
      update public.pipeline_stages set name = 'Proposal sent' where pipeline_id = p.id and name = 'Proposal';
      update public.stage_tasks t set title = 'Follow up on the proposal', due_in_days = 5
        from public.pipeline_stages s
        where s.id = t.pipeline_stage_id and s.pipeline_id = p.id and s.name = 'Proposal sent'
          and t.is_next_action_default and t.title = 'Send the scope and fee' and t.due_in_days = 3;
      -- Items now at Proposal sent that still carry the old default next action get the new text (their due date stays).
      update public.pipeline_items i set next_action = 'Follow up on the proposal'
        from public.pipeline_stages s
        where s.id = i.stage_id and s.pipeline_id = p.id and s.name = 'Proposal sent' and i.next_action = 'Send the scope and fee';
    end if;
  end loop;

  -- Top priorities on deals, jobs and consulting items.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pipeline_items' and column_name = 'priority_rank') then
    alter table public.pipeline_items add column priority_rank smallint;
    alter table public.pipeline_items add column why_fits text;
    alter table public.pipeline_items add column strength text;
    alter table public.pipeline_items add column next_decision text;
    alter table public.pipeline_items add column next_decision_on date;
    alter table public.pipeline_items add constraint pipeline_items_priority_rank_check check (priority_rank is null or (priority_rank >= 1 and priority_rank <= 3));
    alter table public.pipeline_items add constraint pipeline_items_strength_check check (strength is null or strength = any (array['hot'::text, 'warm'::text, 'cold'::text]));
    alter table public.pipeline_items add constraint pipeline_items_priority_rank_key unique (pipeline_id, priority_rank);
  end if;

  -- Top priorities on Rosara projects.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'priority_rank') then
    alter table public.projects add column priority_rank smallint;
    alter table public.projects add column why_fits text;
    alter table public.projects add column strength text;
    alter table public.projects add column next_decision text;
    alter table public.projects add column next_decision_on date;
    alter table public.projects add constraint projects_priority_rank_check check (priority_rank is null or (priority_rank >= 1 and priority_rank <= 3));
    alter table public.projects add constraint projects_strength_check check (strength is null or strength = any (array['hot'::text, 'warm'::text, 'cold'::text]));
    alter table public.projects add constraint projects_priority_rank_key unique (owner_id, priority_rank);
  end if;

  -- Decisions made (go or no-go), each on one deal, job, consulting item or Rosara project; removed with its record.
  if to_regclass('public.decisions') is null then
    create table public.decisions (
      id uuid default gen_random_uuid() not null,
      owner_id uuid default auth.uid() not null,
      pipeline_item_id uuid,
      project_id uuid,
      decided_on date not null,
      outcome text not null,
      line text,
      created_at timestamp with time zone default now() not null,
      constraint decisions_pkey primary key (id),
      constraint decisions_one_record_check check (((pipeline_item_id is not null)::int + (project_id is not null)::int) = 1),
      constraint decisions_outcome_check check (outcome = any (array['go'::text, 'no_go'::text])),
      constraint decisions_line_check check (line is null or char_length(line) <= 300),
      constraint decisions_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade,
      constraint decisions_pipeline_item_id_fkey foreign key (pipeline_item_id) references public.pipeline_items(id) on delete cascade,
      constraint decisions_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade
    );
    create index decisions_owner_idx on public.decisions using btree (owner_id, decided_on);
    create trigger log_change after insert or delete or update on public.decisions for each row execute function public.log_change();
    alter table public.decisions enable row level security;
    create policy owner_only on public.decisions to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id));
    grant all on table public.decisions to authenticated;
    grant all on table public.decisions to service_role;
  end if;
end $$;

-- New owners get the new stage names (the same function as in SETUP_NEW_DATABASE.sql).
create or replace function public.seed_owner(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipe uuid;
  v_stage uuid;
begin
  insert into public.owner_profile (owner_id) values (p_owner) on conflict do nothing;
  if exists (select 1 from public.pipelines where owner_id = p_owner) then
    return;
  end if;
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Acquisitions', 'acquisition', 1, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interested', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Sign the NDA and ask the broker for a call', 1, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'NDA signed', 2, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask the broker for the CIM', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'CIM review', 3, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Broker call', 4, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for the seller call', 2, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Seller call', 5, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for tax returns and start the model', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Diligence', 6, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Book the partner meeting', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Partner presentation', 7, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Submit the IOI or LOI', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'IOI or LOI', 8, 'open', 14, array['revenue','ebitda','asking_price']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Wait for the broker, follow up in 7 days', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Confirmatory diligence', 9, 'open', 60, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Data room, quality of earnings, lawyer review', 14, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Closed', 10, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Upload the signed closing documents', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Passed', 11, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for passing', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 12, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Job search', 'job', 2, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lead', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for an introduction or a first conversation', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Applied', 2, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Follow up on the application', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interview', 3, 'open', 21, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Prepare for the interview', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Offer', 4, 'open', 7, array['salary']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Compare the offer with the acquisition path and decide', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Accepted', 5, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Confirm the start date and paperwork', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Declined', 6, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for declining', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Not chosen', 7, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Consulting', 'consulting', 6, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lead', 1, 'open', 7, '{}'::text[], 10, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Find out what they need and who decides', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Intro call', 2, 'open', 14, '{}'::text[], 25, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Send the scope and fee', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Proposal sent', 3, 'open', 14, array['rate_type','rate']::text[], 50, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Follow up on the proposal', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Engagement', 4, 'open', 7, array['rate_type','rate','start_date']::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Do the work and send the invoice on schedule', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Paid', 5, 'open', null, '{}'::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or the next project', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Done', 6, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or a testimonial', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 7, 'lost', null, '{}'::text[], 0, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason', 1, 1, false, false);
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'waiting_threshold_days', 'Days waiting on someone before it is marked amber', 'Acquisition', 'number', 5, null, 'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Follow up resets the count.', 80) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'outreach_weekly_target', 'Network outreach per week', 'Outreach', 'number', 10, null, 'The weekly counter on Outreach and Home: emails sent and calls logged to people on Outreach, Monday to Friday, out of this number.', 90) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'rosara_weekly_focus', 'Rosara weekly focus', 'Rosara', 'text', null, null, 'The one thing Rosara gets this week. Edited at the top of the Rosara page and shown on Home.', 91) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'ai_monthly_cap_usd', 'AI monthly spending cap', 'AI', 'usd', 25, null, 'AI requests stop once this amount is spent in the month. The AI_MONTHLY_CAP_USD setting on the server is the upper limit.', 260) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'anthropic_key_expiry_date', 'Anthropic API key expiry date', 'AI', 'date', null, null, 'Date the Anthropic API key stops working (shown in the Anthropic Console). The app adds a to-do 14 days before.', 265)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_owner(uuid) from public, anon, authenticated;

select to_regclass('public.decisions') is not null
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'next_decision_on') as push_i_ready,
       (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'acquisition' and s.outcome = 'open') as acquisition_stages,
       (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'job' and s.outcome = 'open') as job_stages,
       (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'consulting' and s.outcome = 'open') as consulting_stages;

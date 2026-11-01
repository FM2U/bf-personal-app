-- 0022: Batch B (approved 2026-10-31): Outreach as the working view of contacts, calls and emails logged on
-- records, personal To-dos, and what batch B2 needs (Rosara projects, the Job search and Consulting pipelines with
-- their stages, opportunity fields, the AI order cache), so Bram runs one file for the whole batch.
-- Depends on 0021 (deal_todos, reset_all_data as it is there), 0019 (insert_record_batch, remove_sample_data),
-- 0011 (the Consulting pipeline), and 0007 (the Jobs pipeline).
-- Safe to run more than once: every statement checks first. No contact, communication, deal, opportunity, or
-- consulting item is deleted. The only rows removed are consulting stages that go away after their items moved
-- (Contacted, Discovery call, Negotiating, Active) and the stage task lists replaced by one approved default per
-- stage, the same rule update 0020 used for the acquisition stages.
--
-- What it adds:
--   1. contacts: outreach_role (broker, lender, former_colleague, service_provider, rosara_customer, recruiter,
--      cofounder_candidate, investor, other), purposes (several of off_market_deals, job_search, consulting, rosara),
--      linkedin_url, last_contact_at and last_contact_kind (kept up to date from the logged emails and calls, stored
--      for speed), archived_at (Archive on the person page). The next follow-up date and what it is for are the
--      existing follow_up_date and follow_up_note columns.
--   2. communications: call_minutes, call_outcome (the next action typed when a call is logged), awaiting_log (an
--      incoming reply not yet on the timeline; "Log it" clears it). The existing summary column holds what was said.
--      A trigger keeps the contact's last contact fields current.
--   3. todos: the personal to-do list (text, due_on, done_at, position), owner-only, change-logged.
--   4. The setting "Network outreach per week" (inputs, key outreach_weekly_target, default 10).
--   5. deal_todos generalized: record_type and record_id (existing rows stay deals: record_type pipeline_items,
--      record_id = deal_id); deal_id stays filled for deals. Tasks of a contact or a project go with it.
--   6. projects (Rosara): name, goal, milestone, status open or closed, closed_at, next action with due date and
--      minutes, position. The weekly focus is the setting rosara_weekly_focus (inputs, text).
--   7. The Jobs pipeline becomes Job search with the stages Contact, Conversation, Interview, Offer (open), Accepted
--      (won), Declined and Not chosen (lost): Identified, Applied, and Interviewing are renamed in place (ids kept).
--   8. The Consulting pipeline's stages become Lead, Proposal, Engagement, Paid (open), Done (won), Lost (lost):
--      Identified, Proposal sent, Signed, and Completed are renamed in place; items in Contacted and Discovery call
--      move to Lead, Negotiating to Proposal, Active to Engagement, then those four stages are removed. Each open
--      stage gets its approved default next action. Engagement and Paid count as signed work (runway).
--   9. pipeline_items: role_title (the job), contact_name (a typed contact), fee (consulting).
--  10. ai_order_cache: the AI's order of the day's next actions (one row per day: ordered ids and reasons).
--  11. insert_record_batch, remove_sample_data, and reset_all_data cover the new tables.
--  12. public.schema_has_0022(): the app calls it to check that this update is applied. Before it runs, the Work
--      screens show "Database update needed" and every other screen keeps working.

-- 1. Contacts
alter table public.contacts add column if not exists outreach_role text;
alter table public.contacts add column if not exists purposes text[] not null default '{}';
alter table public.contacts add column if not exists linkedin_url text;
alter table public.contacts add column if not exists last_contact_at timestamptz;
alter table public.contacts add column if not exists last_contact_kind text;
alter table public.contacts add column if not exists archived_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_outreach_role_check') then
    alter table public.contacts add constraint contacts_outreach_role_check
      check (outreach_role is null or outreach_role in ('broker', 'lender', 'former_colleague', 'service_provider', 'rosara_customer', 'recruiter', 'cofounder_candidate', 'investor', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_purposes_check') then
    alter table public.contacts add constraint contacts_purposes_check
      check (purposes <@ array['off_market_deals', 'job_search', 'consulting', 'rosara']::text[]);
  end if;
end $$;
create index if not exists contacts_outreach_idx on public.contacts (owner_id, follow_up_date) where archived_at is null;

-- 2. Communications: call fields and incoming replies waiting to be logged
alter table public.communications add column if not exists call_minutes int;
alter table public.communications add column if not exists call_outcome text;
alter table public.communications add column if not exists awaiting_log boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'communications_call_minutes_check') then
    alter table public.communications add constraint communications_call_minutes_check
      check (call_minutes is null or (call_minutes >= 0 and call_minutes <= 1440));
  end if;
end $$;
create index if not exists communications_awaiting_idx on public.communications (owner_id, contact_id) where awaiting_log;

-- The contact's last contact: the newest logged email, call, meeting, video call, or text with that contact.
create or replace function public.refresh_contact_last_contact(p_contact uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.contacts c
     set last_contact_at = l.occurred_at,
         last_contact_kind = l.method
    from (select m.occurred_at, m.method
            from public.communications m
           where m.contact_id = p_contact and not m.awaiting_log and m.method in ('email', 'call', 'meeting', 'video', 'text')
           order by m.occurred_at desc limit 1) l
   where c.id = p_contact
     and (c.last_contact_at is distinct from l.occurred_at or c.last_contact_kind is distinct from l.method);
  update public.contacts c
     set last_contact_at = null, last_contact_kind = null
   where c.id = p_contact and (c.last_contact_at is not null or c.last_contact_kind is not null)
     and not exists (select 1 from public.communications m where m.contact_id = p_contact and not m.awaiting_log and m.method in ('email', 'call', 'meeting', 'video', 'text'));
$$;

create or replace function public.communications_touch_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.contact_id is not null then
    perform public.refresh_contact_last_contact(new.contact_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.contact_id is not null and (tg_op = 'DELETE' or old.contact_id is distinct from new.contact_id) then
    perform public.refresh_contact_last_contact(old.contact_id);
  end if;
  return null;
end;
$$;

drop trigger if exists communications_touch_contact on public.communications;
create trigger communications_touch_contact after insert or update or delete on public.communications
  for each row execute function public.communications_touch_contact();

-- Existing contacts get their last contact once (the trigger keeps it current from here on).
do $$
declare c record;
begin
  for c in select distinct contact_id from public.communications where contact_id is not null loop
    perform public.refresh_contact_last_contact(c.contact_id);
  end loop;
end $$;

-- 3. Personal to-dos
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null,
  due_on date,
  done_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todos_owner_idx on public.todos (owner_id, due_on, position);

-- 6. Projects (Rosara, batch B2)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  goal text,
  milestone text,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  next_action text,
  next_action_due date,
  next_action_minutes int check (next_action_minutes is null or (next_action_minutes >= 0 and next_action_minutes <= 1440)),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (owner_id, status, next_action_due);

-- 10. The AI order of the day's next actions (batch B2): one row per owner and day.
create table if not exists public.ai_order_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  ordered_ids jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, for_date)
);

-- Row Level Security, owner-only policy, grants, and change log for the three new tables (as 0014, 0019, 0021).
do $$
declare
  t text;
begin
  foreach t in array array['todos', 'projects', 'ai_order_cache'] loop
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
    if t <> 'ai_order_cache' and not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
    end if;
  end loop;
end $$;

-- 5. Tasks on any record: deal_todos keeps its name and its rows; record_type and record_id say which record.
alter table public.deal_todos add column if not exists record_type text not null default 'pipeline_items';
alter table public.deal_todos add column if not exists record_id uuid;
alter table public.deal_todos alter column deal_id drop not null;
update public.deal_todos set record_id = deal_id where record_id is null and deal_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deal_todos_record_type_check') then
    alter table public.deal_todos add constraint deal_todos_record_type_check
      check (record_type in ('pipeline_items', 'contacts', 'projects'));
  end if;
end $$;
create index if not exists deal_todos_record_idx on public.deal_todos (record_type, record_id, position);

-- A task saved with only deal_id (older code) gets record_type and record_id; one saved as a deal task with only
-- record_id gets deal_id, so the delete-with-the-deal rule keeps working.
create or replace function public.deal_todos_before()
returns trigger
language plpgsql
as $$
begin
  if new.record_id is null and new.deal_id is not null then
    new.record_type := 'pipeline_items';
    new.record_id := new.deal_id;
  end if;
  if new.record_type = 'pipeline_items' and new.deal_id is null then
    new.deal_id := new.record_id;
  end if;
  if new.record_id is null then
    raise exception 'A task needs a record';
  end if;
  return new;
end;
$$;
drop trigger if exists deal_todos_before on public.deal_todos;
create trigger deal_todos_before before insert or update on public.deal_todos
  for each row execute function public.deal_todos_before();

-- Tasks of a contact or a project are deleted with it (a deal's tasks already go with the deal).
create or replace function public.delete_record_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.deal_todos where record_type = tg_table_name and record_id = old.id;
  return old;
end;
$$;
drop trigger if exists contacts_delete_tasks on public.contacts;
create trigger contacts_delete_tasks after delete on public.contacts for each row execute function public.delete_record_tasks();
drop trigger if exists projects_delete_tasks on public.projects;
create trigger projects_delete_tasks after delete on public.projects for each row execute function public.delete_record_tasks();

-- 9. Opportunity and consulting fields on pipeline items
alter table public.pipeline_items add column if not exists role_title text;
alter table public.pipeline_items add column if not exists contact_name text;
alter table public.pipeline_items add column if not exists fee numeric(14, 2);

-- 4, 6, 7, and 8. The settings and the two pipelines, for one owner. Only changes what needs changing.
create or replace function public.seed_owner_batch_b(p_owner uuid)
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
  -- The settings.
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'outreach_weekly_target', 'Network outreach per week', 'Outreach', 'number', 10, null,
     'The weekly counter on Outreach and Home: emails sent and calls logged to people on Outreach, Monday to Friday, out of this number.', 90)
  on conflict (owner_id, key) do nothing;
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'rosara_weekly_focus', 'Rosara weekly focus', 'Rosara', 'text', null, null,
     'The one thing Rosara gets this week. Edited at the top of the Rosara page and shown on Home.', 91)
  on conflict (owner_id, key) do nothing;

  -- The Job search pipeline (kind job): renames in place keep the stage ids.
  for p in select id from pipelines where owner_id = p_owner and kind = 'job' loop
    update pipelines set name = 'Job search' where id = p.id and name = 'Jobs'
      and not exists (select 1 from pipelines x where x.owner_id = p_owner and x.name = 'Job search');
    for r in select * from (values ('Identified', 'Contact'), ('Applied', 'Conversation'), ('Interviewing', 'Interview')) v (old_name, new_name) loop
      if exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.old_name)
         and not exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.new_name) then
        update pipeline_stages set name = r.new_name where pipeline_id = p.id and name = r.old_name;
      end if;
    end loop;
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome)
    select p_owner, p.id, v.name, v.pos, v.outcome
      from (values ('Contact', 1, 'open'), ('Conversation', 2, 'open'), ('Interview', 3, 'open'), ('Offer', 4, 'open'), ('Accepted', 5, 'won'), ('Declined', 6, 'lost'), ('Not chosen', 7, 'lost')) as v (name, pos, outcome)
     where not exists (select 1 from pipeline_stages s where s.pipeline_id = p.id and s.name = v.name);
    update pipeline_stages s set position = v.pos
      from (values ('Contact', 1), ('Conversation', 2), ('Interview', 3), ('Offer', 4), ('Accepted', 5), ('Declined', 6), ('Not chosen', 7)) as v (name, pos)
     where s.pipeline_id = p.id and s.name = v.name and s.position <> v.pos;
    -- One default next action per open stage (a stage that already has the title keeps its list).
    for r in select * from (values
        ('Contact', 'Ask for an introduction or a first conversation', 3),
        ('Conversation', 'Send a thank-you note and ask about the next step', 2),
        ('Interview', 'Prepare for the interview', 3),
        ('Offer', 'Compare the offer with the acquisition path and decide', 5)
      ) v (stage, title, due) loop
      select id into v_stage from pipeline_stages where pipeline_id = p.id and name = r.stage;
      if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage and title = r.title) then
        update pipeline_items set next_action = r.title
         where pipeline_id = p.id and stage_id = v_stage and status = 'open'
           and next_action in (select title from stage_tasks where pipeline_stage_id = v_stage and is_next_action_default);
        delete from stage_tasks where pipeline_stage_id = v_stage;
        insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
        values (p_owner, v_stage, r.title, r.due, 1, true, true);
      end if;
    end loop;
    select id into v_stage from pipeline_stages where pipeline_id = p.id and name = 'Not chosen';
    if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage) then
      insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
      values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
    end if;
  end loop;

  -- The Consulting pipeline (kind consulting).
  for p in select id from pipelines where owner_id = p_owner and kind = 'consulting' loop
    for r in select * from (values ('Identified', 'Lead'), ('Proposal sent', 'Proposal'), ('Signed', 'Engagement'), ('Completed', 'Done')) v (old_name, new_name) loop
      if exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.old_name)
         and not exists (select 1 from pipeline_stages where pipeline_id = p.id and name = r.new_name) then
        update pipeline_stages set name = r.new_name where pipeline_id = p.id and name = r.old_name;
      end if;
    end loop;
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome)
    select p_owner, p.id, v.name, v.pos, v.outcome
      from (values ('Lead', 1, 'open'), ('Proposal', 2, 'open'), ('Engagement', 3, 'open'), ('Paid', 4, 'open'), ('Done', 5, 'won'), ('Lost', 6, 'lost')) as v (name, pos, outcome)
     where not exists (select 1 from pipeline_stages s where s.pipeline_id = p.id and s.name = v.name);
    -- Items in a stage that goes away move to the nearest new stage (a remap, not progress: triggers stay quiet).
    for r in select * from (values ('Contacted', 'Lead'), ('Discovery call', 'Lead'), ('Negotiating', 'Proposal'), ('Active', 'Engagement')) v (old_name, new_name) loop
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
        update stage_history set stage_id = v_to where stage_id = v_from;
        delete from pipeline_stages where id = v_from;
      end if;
    end loop;
    update pipeline_stages s set position = v.pos
      from (values ('Lead', 1), ('Proposal', 2), ('Engagement', 3), ('Paid', 4), ('Done', 5), ('Lost', 6)) as v (name, pos)
     where s.pipeline_id = p.id and s.name = v.name and s.position <> v.pos;
    -- Engagement and Paid are signed work (runway); the other settings stay as they are.
    update pipeline_stages set counts_as_signed = true, default_probability_pct = coalesce(default_probability_pct, 100)
     where pipeline_id = p.id and name in ('Engagement', 'Paid') and not counts_as_signed;
    update pipeline_stages set max_days_in_stage = coalesce(max_days_in_stage, v.days)
      from (values ('Lead', 14), ('Proposal', 14)) as v (name, days)
     where pipeline_id = p.id and pipeline_stages.name = v.name;
    -- One default next action per open stage (a stage that already has the title keeps its list).
    for r in select * from (values
        ('Lead', 'Find out what they need and who decides', 3),
        ('Proposal', 'Send the scope and fee', 3),
        ('Engagement', 'Do the work and send the invoice on schedule', 7),
        ('Paid', 'Ask for a referral or the next project', 7)
      ) v (stage, title, due) loop
      select id into v_stage from pipeline_stages where pipeline_id = p.id and name = r.stage;
      if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage and title = r.title) then
        update pipeline_items set next_action = r.title
         where pipeline_id = p.id and stage_id = v_stage and status = 'open'
           and next_action in (select title from stage_tasks where pipeline_stage_id = v_stage and is_next_action_default);
        delete from stage_tasks where pipeline_stage_id = v_stage;
        insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
        values (p_owner, v_stage, r.title, r.due, 1, true, true);
      end if;
    end loop;
    for r in select * from (values ('Done', 'Ask for a referral or a testimonial'), ('Lost', 'Write down the reason')) v (stage, title) loop
      select id into v_stage from pipeline_stages where pipeline_id = p.id and name = r.stage;
      if v_stage is not null and not exists (select 1 from stage_tasks where pipeline_stage_id = v_stage and title = r.title) then
        delete from stage_tasks where pipeline_stage_id = v_stage;
        insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
        values (p_owner, v_stage, r.title, 3, 1, false, false);
      end if;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.seed_owner_batch_b(uuid) from public, anon, authenticated;

-- Existing owners.
do $$
declare o record;
begin
  for o in select owner_id from public.owner_profile loop
    perform public.seed_owner_batch_b(o.owner_id);
  end loop;
end $$;

-- Future owners: the owner setup function also runs this seed (the same as 0020, plus this one).
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
  return new;
end;
$$;

-- 11. Sample data: the batch (insert_record_batch) also accepts todos, projects, and deal_todos; removal and reset
-- delete them. The function bodies are otherwise the same as in 0019 and 0021.
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
    'todos', 'deal_todos', 'projects',
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

-- Reset all data also lists the new tables (the same function as 0021 otherwise).
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
    'checklist_items', 'checklists', 'plan_documents', 'sample_records',
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

-- 12. Check function
create or replace function public.schema_has_0022()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0022() from public, anon;
grant execute on function public.schema_has_0022() to authenticated, service_role;

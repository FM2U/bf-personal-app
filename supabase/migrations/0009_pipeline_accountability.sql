-- 0009: Accountability on every pipeline item, deal source tracking, and the two deal targets.
-- Depends on 0008. Safe to run more than once: every statement checks whether its change already exists,
-- and default lists are only added where nothing is set yet.
--
-- What it adds:
--   1. Stage task lists ("stage playbooks"): default tasks per pipeline stage (table stage_tasks).
--   2. Stage time limits (pipeline_stages.max_days_in_stage) and per-item extensions (pipeline_item_stage_extensions).
--   3. Required details before an item can enter a stage (pipeline_stages.required_fields).
--   4. Deal source on acquisition items (proprietary or brokered), the source contact, and source notes.
--   5. Deal-source contacts (contacts.is_deal_source) and a purpose on communications.
--   6. Targets counted from deals: "Deals sourced" and "Deals advanced".
--   7. Input "pipeline_stall_days" (Opportunities) and "stage_extension_days".

-- 1. Stage settings: time limit and required details.
-- required_fields holds field keys. The app lists them in src/lib/calc/pipeline.ts (REQUIRED_FIELD_DEFS):
--   asking_price, revenue, ebitda, sde, financing_structure (acquisitions), salary, bonus (jobs),
--   amount_discussed, amount_committed (investors), deal_source_type, primary_contact_id, organization_id.
-- An item can enter a stage only when every required field of that stage and of every earlier stage is filled.
-- Moving to a "passed or lost" stage never needs details.
alter table public.pipeline_stages add column if not exists max_days_in_stage int;
alter table public.pipeline_stages add column if not exists required_fields text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_max_days_check') then
    alter table public.pipeline_stages add constraint pipeline_stages_max_days_check
      check (max_days_in_stage is null or max_days_in_stage between 1 and 365);
  end if;
end $$;

-- 2. Stage task lists: tasks created for an item when it enters the stage (including when it is created).
create table if not exists public.stage_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pipeline_stage_id uuid not null references public.pipeline_stages (id) on delete cascade,
  title text not null,
  due_in_days int not null default 2 check (due_in_days between 0 and 365),
  sort_order int not null default 1,
  is_next_action_default boolean not null default false,
  is_commitment boolean not null default false, -- only the next-action task is a commitment by default (0010)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stage_tasks_stage_idx on public.stage_tasks (pipeline_stage_id, sort_order);

-- Extra days granted when "Extend" is chosen on a stage time limit decision.
-- Applies only to the item's current stay in that stage (matched on stage_entered_at).
create table if not exists public.pipeline_item_stage_extensions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.pipeline_items (id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages (id) on delete cascade,
  stage_entered_at timestamptz not null,
  extra_days int not null default 7 check (extra_days between 1 and 365),
  decision_id uuid references public.decisions (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipeline_item_stage_extensions_item_idx on public.pipeline_item_stage_extensions (item_id, stage_id);

-- 3. Decisions opened by a stage time limit. dedupe_key keeps one decision per item, stage stay, and limit.
alter table public.decisions add column if not exists dedupe_key text;
create unique index if not exists decisions_dedupe on public.decisions (owner_id, dedupe_key) where dedupe_key is not null;
alter table public.decisions drop constraint if exists decisions_source_check;
alter table public.decisions add constraint decisions_source_check
  check (source in ('manual', 'milestone', 'decision_condition', 'missed_commitment', 'ai', 'pipeline_stage'));

-- 4. Deal source on pipeline items (used by acquisition items).
alter table public.pipeline_items add column if not exists deal_source_type text;
alter table public.pipeline_items add column if not exists source_contact_id uuid references public.contacts (id) on delete set null;
alter table public.pipeline_items add column if not exists source_notes text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_deal_source_type_check') then
    alter table public.pipeline_items add constraint pipeline_items_deal_source_type_check
      check (deal_source_type is null or deal_source_type in ('proprietary', 'brokered'));
  end if;
end $$;
create index if not exists pipeline_items_created_idx on public.pipeline_items (owner_id, created_at);

-- 5. Deal-source contacts and the purpose of each communication.
-- purpose: general, deal_sourcing (outreach to find off-market deals),
--          cim_request and source_contact (logged on an acquisition item; counted by "Deals advanced").
alter table public.contacts add column if not exists is_deal_source boolean not null default false;
alter table public.communications add column if not exists purpose text not null default 'general';
alter table public.communications add column if not exists pipeline_item_id uuid references public.pipeline_items (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communications_purpose_check') then
    alter table public.communications add constraint communications_purpose_check
      check (purpose in ('general', 'deal_sourcing', 'cim_request', 'source_contact'));
  end if;
end $$;
create index if not exists communications_item_idx on public.communications (pipeline_item_id, occurred_at);

-- When a communication is saved with no purpose, use deal_sourcing for deal-source contacts, otherwise general.
create or replace function public.communication_default_purpose()
returns trigger
language plpgsql
as $$
begin
  if new.purpose is null then
    new.purpose := case
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_deal_source) then 'deal_sourcing'
      else 'general'
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists communications_default_purpose on public.communications;
create trigger communications_default_purpose before insert or update on public.communications
  for each row execute function public.communication_default_purpose();

-- 6. Targets counted from deals.
--   deals_sourced  = acquisition pipeline items created that day (proprietary and brokered).
--   deals_advanced = acquisition items, each counted once per day, that moved into stage_id or a later stage
--                    that day (the stage an item is created in does not count as a move), or had a communication
--                    with purpose cim_request or source_contact that day.
alter table public.targets add column if not exists stage_id uuid references public.pipeline_stages (id) on delete set null;
-- Replaced only when it does not allow deals_advanced yet, so running this again after 0016 (which allows more
-- count sources) keeps the wider rule.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'targets_count_source_check'
                 and pg_get_constraintdef(oid) like '%deals_advanced%') then
    alter table public.targets drop constraint if exists targets_count_source_check;
    alter table public.targets add constraint targets_count_source_check
      check (count_source in ('communications_outreach', 'pipeline_items_created', 'manual', 'deals_sourced', 'deals_advanced'));
  end if;
end $$;

-- 7. Row Level Security, owner-only policy, grants, updated_at, and change log for the new tables
-- (the same statements 0006 applied to every table that existed then).
do $$
declare
  t text;
begin
  foreach t in array array['stage_tasks', 'pipeline_item_stage_extensions'] loop
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
  end loop;
end $$;

-- 8. Owner's local date (used for task due dates created by the database).
create or replace function public.owner_local_date(p_owner uuid)
returns date
language sql
stable
as $$
  select (now() at time zone coalesce((select timezone from public.owner_profile where owner_id = p_owner), 'America/New_York'))::date
$$;

-- 9. Entering a stage sets the next action from the stage's default task, when the next action was empty
-- or was a task of the stage the item is leaving (and was not changed in the same save).
create or replace function public.pipeline_item_stage_defaults()
returns trigger
language plpgsql
as $$
declare
  v_title text;
  v_due int;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if new.stage_id is null then
    return new;
  end if;
  select st.title, st.due_in_days into v_title, v_due
  from public.stage_tasks st
  where st.pipeline_stage_id = new.stage_id and st.is_next_action_default
  order by st.sort_order, st.title
  limit 1;
  if v_title is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.next_action is null or btrim(new.next_action) = '' then
      new.next_action := v_title;
      new.next_action_due := coalesce(new.next_action_due, public.owner_local_date(new.owner_id) + v_due);
    end if;
  elsif new.next_action is not distinct from old.next_action
        and (old.next_action is null
             or exists (select 1 from public.stage_tasks st where st.pipeline_stage_id = old.stage_id and st.title = old.next_action)) then
    new.next_action := v_title;
    new.next_action_due := public.owner_local_date(new.owner_id) + v_due;
  end if;
  return new;
end;
$$;
drop trigger if exists pipeline_items_stage_defaults on public.pipeline_items;
create trigger pipeline_items_stage_defaults before insert or update on public.pipeline_items
  for each row execute function public.pipeline_item_stage_defaults();

-- 10. Entering a stage creates the stage's tasks for the item (once per item and stage task),
-- linked to the item and its initiative, and marked as commitments where the stage task says so.
-- (0010 replaces this function: closing an item releases those commitments instead of counting them as missed.)
-- Closing an item (won or passed) skips its open pipeline tasks and closes their commitments.
create or replace function public.pipeline_item_stage_tasks()
returns trigger
language plpgsql
as $$
declare
  t record;
  v_init uuid;
  v_today date;
  v_task uuid;
  v_stage text;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'open' and new.status <> 'open' then
    update public.commitments set status = 'closed_by_decision'
     where record_type = 'tasks' and status = 'open'
       and record_id in (select id from public.tasks where pipeline_item_id = new.id and status = 'todo' and source = 'pipeline');
    update public.tasks set status = 'skipped'
     where pipeline_item_id = new.id and status = 'todo' and source = 'pipeline';
  end if;
  if new.stage_id is null then
    return new;
  end if;
  select initiative_id into v_init from public.pipelines where id = new.pipeline_id;
  select name into v_stage from public.pipeline_stages where id = new.stage_id;
  v_today := public.owner_local_date(new.owner_id);
  for t in
    select * from public.stage_tasks where pipeline_stage_id = new.stage_id order by sort_order, title
  loop
    v_task := null;
    insert into public.tasks (owner_id, title, description, due_date, status, priority, initiative_id, pipeline_item_id,
                              related_type, related_id, source, source_key)
    values (new.owner_id, new.name || ': ' || t.title,
            'Created when this item entered the stage "' || coalesce(v_stage, 'unknown') || '" (stage task list in Settings, Initiatives and pipelines).',
            v_today + t.due_in_days, 'todo', 2, v_init, new.id, 'pipeline_items', new.id, 'pipeline',
            'stage-task:' || new.id || ':' || t.id)
    on conflict (owner_id, source_key) where source_key is not null do nothing
    returning id into v_task;
    if v_task is not null and t.is_commitment then
      insert into public.commitments (owner_id, title, record_type, record_id, due_date, original_due_date)
      values (new.owner_id, new.name || ': ' || t.title, 'tasks', v_task, v_today + t.due_in_days, v_today + t.due_in_days)
      on conflict (owner_id, record_type, record_id) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists pipeline_items_stage_tasks on public.pipeline_items;
create trigger pipeline_items_stage_tasks after insert or update on public.pipeline_items
  for each row execute function public.pipeline_item_stage_tasks();

-- 11. Default stage task lists, time limits, required details, inputs, and the two deal targets.
-- Only fills what is empty, so running it again never duplicates or overwrites the owner's edits
-- (a stage that already has any task keeps its list).
create or replace function public.seed_owner_pipeline_accountability(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := (now() at time zone 'America/New_York')::date;
  v_acq uuid;
  v_nda uuid;
  v_init uuid;
begin
  -- Inputs
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'pipeline_stall_days', 'Days without activity before a pipeline item is marked stalled', 'Opportunities', 'number', 7, null,
     'An open item with no stage change, communication, completed task, note, or document for this many days is marked Stalled.', 300),
    (p_owner, 'stage_extension_days', 'Days added when "Extend" is chosen on a stage time limit', 'Opportunities', 'number', 7, null,
     'Used by the decision that opens when an item is in a stage longer than the stage time limit.', 310)
  on conflict (owner_id, key) do nothing;

  -- Time limits (days) and required details per stage. Only empty settings are filled.
  update pipeline_stages s
     set max_days_in_stage = coalesce(s.max_days_in_stage, v.max_days),
         required_fields = case when cardinality(s.required_fields) = 0 then v.required else s.required_fields end
    from pipelines p,
         (values
           ('Acquisitions', 'Sourced', 7, '{}'::text[]),
           ('Acquisitions', 'Screened', 7, '{}'::text[]),
           ('Acquisitions', 'NDA signed', 7, '{}'::text[]),
           ('Acquisitions', 'CIM reviewed', 10, '{}'::text[]),
           ('Acquisitions', 'IOI sent', 14, '{revenue,ebitda,asking_price}'::text[]),
           ('Acquisitions', 'LOI signed', 30, '{revenue,ebitda,asking_price,financing_structure}'::text[]),
           ('Acquisitions', 'Diligence', 60, '{}'::text[]),
           ('Jobs', 'Identified', 7, '{}'::text[]),
           ('Jobs', 'Applied', 14, '{}'::text[]),
           ('Jobs', 'Interviewing', 21, '{}'::text[]),
           ('Jobs', 'Offer', 7, '{salary}'::text[]),
           ('Rosara Co-founder Search', 'Identified', 7, '{}'::text[]),
           ('Rosara Co-founder Search', 'Contacted', 10, '{}'::text[]),
           ('Rosara Co-founder Search', 'First call', 10, '{}'::text[]),
           ('Rosara Co-founder Search', 'Working session', 14, '{}'::text[]),
           ('Rosara Co-founder Search', 'Terms discussed', 21, '{}'::text[]),
           ('Rosara Investor Outreach', 'Identified', 7, '{}'::text[]),
           ('Rosara Investor Outreach', 'Contacted', 10, '{}'::text[]),
           ('Rosara Investor Outreach', 'Meeting', 7, '{}'::text[]),
           ('Rosara Investor Outreach', 'Materials sent', 14, '{}'::text[]),
           ('Rosara Investor Outreach', 'Committed', null, '{amount_committed}'::text[]),
           ('Other Income Opportunities', 'Identified', 7, '{}'::text[]),
           ('Other Income Opportunities', 'Evaluating', 14, '{}'::text[]),
           ('Other Income Opportunities', 'Pursuing', 21, '{}'::text[])
         ) as v (pipeline, stage, max_days, required)
   where p.id = s.pipeline_id and p.owner_id = p_owner and p.name = v.pipeline and s.name = v.stage;

  -- Stage task lists. A stage that already has tasks keeps its list.
  -- Only the next-action task of each stage is a commitment (commitment rule, 0010).
  insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
  select p_owner, s.id, v.title, v.due, v.ord, v.is_default, v.is_default
    from (values
      ('Acquisitions', 'Sourced', 'Request teaser or CIM', 2, 1, true),
      ('Acquisitions', 'Sourced', 'Identify owner or decision maker', 3, 2, false),
      ('Acquisitions', 'Screened', 'Sign NDA', 3, 1, true),
      ('Acquisitions', 'Screened', 'Request CIM', 3, 2, false),
      ('Acquisitions', 'NDA signed', 'Request CIM and financials', 2, 1, true),
      ('Acquisitions', 'CIM reviewed', 'Enter revenue, EBITDA, asking price', 2, 1, true),
      ('Acquisitions', 'CIM reviewed', 'Decide: IOI or pass', 5, 2, false),
      ('Acquisitions', 'IOI sent', 'Follow up on IOI response', 7, 1, true),
      ('Acquisitions', 'LOI signed', 'Start diligence checklist', 2, 1, true),
      ('Acquisitions', 'LOI signed', 'Engage QoE provider and attorney', 7, 2, false),
      ('Acquisitions', 'Diligence', 'Weekly diligence status check', 7, 1, true),
      ('Acquisitions', 'Closed', 'Upload the signed closing documents', 3, 1, false),
      ('Acquisitions', 'Passed', 'Write down the reason for passing', 1, 1, false),
      ('Jobs', 'Identified', 'Research the company and the role', 2, 1, true),
      ('Jobs', 'Identified', 'Find a contact or referral at the company', 3, 2, false),
      ('Jobs', 'Applied', 'Follow up on the application', 7, 1, true),
      ('Jobs', 'Interviewing', 'Prepare for the next interview', 3, 1, true),
      ('Jobs', 'Interviewing', 'Send a thank-you note after each interview', 1, 2, false),
      ('Jobs', 'Offer', 'Enter salary, bonus, and benefits', 1, 1, true),
      ('Jobs', 'Offer', 'Compare the offer in the job vs acquisition scenario', 3, 2, false),
      ('Jobs', 'Accepted', 'Confirm the start date and paperwork', 3, 1, false),
      ('Jobs', 'Declined', 'Write down the reason for declining', 1, 1, false),
      ('Rosara Co-founder Search', 'Identified', 'Send an intro message', 2, 1, true),
      ('Rosara Co-founder Search', 'Identified', 'Review their background and past work', 3, 2, false),
      ('Rosara Co-founder Search', 'Contacted', 'Follow up if there is no reply', 5, 1, true),
      ('Rosara Co-founder Search', 'First call', 'Send follow-up notes after the call', 1, 1, true),
      ('Rosara Co-founder Search', 'First call', 'Schedule a working session', 5, 2, false),
      ('Rosara Co-founder Search', 'Working session', 'Agree on the working session task and date', 2, 1, true),
      ('Rosara Co-founder Search', 'Working session', 'Write notes on how the working session went', 3, 2, false),
      ('Rosara Co-founder Search', 'Terms discussed', 'Send written terms (equity, vesting, role)', 5, 1, true),
      ('Rosara Co-founder Search', 'Terms discussed', 'Check references', 7, 2, false),
      ('Rosara Co-founder Search', 'Signed', 'Sign the founder agreement and upload it', 3, 1, false),
      ('Rosara Co-founder Search', 'Passed', 'Write down the reason for passing', 1, 1, false),
      ('Rosara Investor Outreach', 'Identified', 'Send an intro message or ask for an introduction', 2, 1, true),
      ('Rosara Investor Outreach', 'Contacted', 'Follow up if there is no reply', 5, 1, true),
      ('Rosara Investor Outreach', 'Meeting', 'Send follow-up notes and next steps', 1, 1, true),
      ('Rosara Investor Outreach', 'Meeting', 'Send the materials they asked for', 3, 2, false),
      ('Rosara Investor Outreach', 'Materials sent', 'Follow up and ask for a decision', 7, 1, true),
      ('Rosara Investor Outreach', 'Committed', 'Collect signed documents and funds', 7, 1, false),
      ('Rosara Investor Outreach', 'Passed', 'Write down the reason for passing', 1, 1, false),
      ('Other Income Opportunities', 'Identified', 'Write down the expected income and hours', 2, 1, true),
      ('Other Income Opportunities', 'Evaluating', 'Decide: pursue or drop', 7, 1, true),
      ('Other Income Opportunities', 'Pursuing', 'Send the proposal or application', 5, 1, true),
      ('Other Income Opportunities', 'Pursuing', 'Follow up on the proposal', 12, 2, false),
      ('Other Income Opportunities', 'Active', 'Record the first payment received', 14, 1, false),
      ('Other Income Opportunities', 'Dropped', 'Write down the reason for dropping', 1, 1, false)
    ) as v (pipeline, stage, title, due, ord, is_default)
    join pipelines p on p.owner_id = p_owner and p.name = v.pipeline
    join pipeline_stages s on s.pipeline_id = p.id and s.name = v.stage
   where not exists (select 1 from stage_tasks st where st.pipeline_stage_id = s.id);

  -- Targets: Deals sourced (5 per weekday) and Deals advanced (1 per weekday), counting from today (New York date).
  select id into v_acq from pipelines where owner_id = p_owner and kind = 'acquisition' order by sort_order, created_at limit 1;
  select id into v_nda from pipeline_stages where pipeline_id = v_acq and name = 'NDA signed' limit 1;
  select id into v_init from initiatives where owner_id = p_owner and name = 'Acquisition Search' limit 1;
  insert into targets (owner_id, name, initiative_id, period, minimum_count, active_weekdays, count_source, pipeline_id, stage_id,
                       is_commitment, show_to_partners, active, start_date, sort_order, notes)
  values
    (p_owner, 'Deals sourced', v_init, 'day', 5, '{1,2,3,4,5}', 'deals_sourced', v_acq, null, true, false, true, v_start, 2,
     'Counts new Acquisitions pipeline items added that day, proprietary (off-market) and brokered.'),
    (p_owner, 'Deals advanced', v_init, 'day', 1, '{1,2,3,4,5}', 'deals_advanced', v_acq, v_nda, true, false, true, v_start, 3,
     'Counts each Acquisitions item once per day when it moved into NDA signed or a later stage that day (not the stage it was created in), or when a CIM request or a contact with the broker or referral source was logged on it that day.')
  on conflict (owner_id, name) do nothing;
end;
$$;

revoke execute on function public.seed_owner_pipeline_accountability(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function also creates these defaults.
create or replace function public.handle_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.owner_profile (owner_id) values (new.id) on conflict do nothing;
  perform public.seed_owner_defaults(new.id);
  perform public.seed_owner_targets(new.id);
  perform public.seed_owner_pipeline_accountability(new.id);
  return new;
end;
$$;

-- Existing owners: add the defaults once (skipped where they already exist).
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_pipeline_accountability(r.owner_id);
  end loop;
end $$;

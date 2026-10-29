-- BF Personal App: database update (0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, and 0016).
--   0008: Daily Targets and Outreach Queue.
--   0009: Stage task lists, stage time limits, required details, stalled items, deal source (proprietary or brokered),
--         deal-source contacts, and the Deals sourced and Deals advanced targets.
--   0010: Commitment rule: only pipeline next actions, milestones, daily targets, and reviews are commitments;
--         regular tasks that are not done move to the next day; the weekly review lists tasks moved 5 or more times.
--   0011: Deal source chain (Deal came from, Introduced by) and the Consulting initiative and pipeline.
--   0012: Relationship groups Friend and Other; runway setting text (signed work counts until its first payment).
--   0013: Send email from the app: Gmail message ids on communications; partner reports marked sent with the date.
--   0014: Start an initiative (drafts, plan documents, checklists), weekly AI savings ideas, sample data, Reset data.
--   0015: Gmail signature on emails sent or drafted from the app (four columns on owner_profile).
--   0016: Deal funnel: Listings screened, CIMs reviewed, and Broker or owner calls targets; search hours and minutes per step.
-- For a database that already has 0001 to 0007 (or 0001 to 0008, 0009, 0010, 0011, 0012, 0013, 0014, or 0015). Paste this whole file into the
-- Supabase SQL Editor and press Run. Safe to run more than once: nothing is duplicated.
-- Generated from supabase/migrations by supabase/build_combined.py.

-- ===== supabase/migrations/0008_targets_outreach.sql =====
-- 0008: Daily targets (countable-activity commitments), outreach logging on communications,
-- contact outreach settings, and the "Network outreach" target for the owner.
-- Safe to run more than once: every statement checks whether its change already exists.

-- 1. Outreach is logged as a communication with is_outreach = true (one record, one source of truth).
alter table public.communications add column if not exists is_outreach boolean not null default false;
alter table public.communications add column if not exists outcome text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communications_outcome_check') then
    alter table public.communications add constraint communications_outcome_check
      check (outcome is null or outcome in ('replied', 'meeting_booked', 'referral', 'no_response'));
  end if;
end $$;
create index if not exists communications_outreach_idx on public.communications (owner_id, is_outreach, occurred_at desc);

-- 2. Contacts: relationship group and how often to reach out.
-- When outreach_every_days is empty, the app uses the group default: close 30, warm 60, professional 90 days.
-- The last contact date is never stored; it is read from the latest communication with the contact.
alter table public.contacts add column if not exists relationship_group text;
alter table public.contacts add column if not exists outreach_every_days int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_relationship_group_check') then
    alter table public.contacts add constraint contacts_relationship_group_check
      check (relationship_group is null or relationship_group in ('close', 'warm', 'professional'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_outreach_every_days_check') then
    alter table public.contacts add constraint contacts_outreach_every_days_check
      check (outreach_every_days is null or outreach_every_days between 1 and 3650);
  end if;
end $$;

-- 3. Targets: a minimum count of an activity per day or per week.
-- Counts for automatic sources are calculated from the source records, never typed in:
--   communications_outreach = communications with is_outreach = true
--   pipeline_items_created  = pipeline items created (optionally only in pipeline_id)
--   manual                  = the sum of target_entries
-- active_weekdays: 0 = Sunday ... 6 = Saturday. Used by day targets only.
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  initiative_id uuid references public.initiatives (id) on delete set null,
  period text not null default 'day' check (period in ('day', 'week')),
  minimum_count int not null default 1 check (minimum_count between 1 and 1000),
  active_weekdays int[] not null default '{1,2,3,4,5}' check (active_weekdays <@ '{0,1,2,3,4,5,6}'::int[]),
  count_source text not null default 'manual' check (count_source in ('communications_outreach', 'pipeline_items_created', 'manual')),
  pipeline_id uuid references public.pipelines (id) on delete set null,
  is_commitment boolean not null default true,
  show_to_partners boolean not null default false,
  active boolean not null default true,
  start_date date not null default current_date,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- Manual taps for targets with count_source = 'manual'.
create table if not exists public.target_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  entry_date date not null default current_date,
  count int not null default 1 check (count between 1 and 1000),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists target_entries_target_date_idx on public.target_entries (target_id, entry_date);

-- One row per missed target period, holding the one-line reason given in the daily close.
create table if not exists public.target_misses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_id uuid not null references public.targets (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  actual_count int not null default 0,
  required_count int not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_id, period_start)
);

-- 4. Row Level Security, owner-only policy, grants, updated_at, and change log for the new tables
-- (the same statements 0006 applied to every table that existed then).
do $$
declare
  t text;
begin
  foreach t in array array['targets', 'target_entries', 'target_misses'] loop
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

-- 5. The "Network outreach" target: 3 outreach communications per weekday.
create or replace function public.seed_owner_targets(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into targets (owner_id, name, initiative_id, period, minimum_count, active_weekdays, count_source,
                       is_commitment, show_to_partners, active, sort_order, notes)
  values (
    p_owner,
    'Network outreach',
    (select id from initiatives where owner_id = p_owner and name = 'Acquisition Search' limit 1),
    'day', 3, '{1,2,3,4,5}', 'communications_outreach',
    true, false, true, 1,
    'Counts communications logged as outreach (People, Outreach Queue, Log outreach).'
  )
  on conflict (owner_id, name) do nothing;
end;
$$;

revoke execute on function public.seed_owner_targets(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function now also creates the target.
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
  return new;
end;
$$;

-- Existing owners: create the target once (skipped when it already exists).
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_targets(r.owner_id);
  end loop;
end $$;

-- ===== supabase/migrations/0009_pipeline_accountability.sql =====
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

-- ===== supabase/migrations/0010_commitment_rule.sql =====
-- 0010: Commitment rule (approved 2026-10-26): fewer commitments, less clutter.
-- Safe to run more than once. Works on a database with 0001 to 0007, 0001 to 0008, or 0001 to 0009
-- (the parts for stage task lists run only when that table exists).
--
-- What counts as a commitment (only these):
--   pipeline next-action tasks (the stage task marked as the next action, and an item's current next action task),
--   milestones, daily targets, and the scheduled reviews (daily close, weekly, monthly, quarterly).
-- Everything else is a regular task. A regular task that is not done by its due date moves to the next day
-- automatically (the morning job), and tasks.times_moved counts how many times it moved.
--
-- What it changes:
--   1. tasks.times_moved (how many times a regular task moved to the next day).
--   2. A commitment can be "released" (no longer a commitment under this rule). Released commitments and their
--      misses are left out of scores, reviews, and partner reports. Nothing is deleted.
--   3. Input "task_moved_review_threshold" (default 5): the weekly review lists regular tasks moved this many times.
--   4. Stage task lists: only the next-action task is a commitment by default.
--   5. Recurring task templates: only the review templates are commitments by default.
--   6. Existing owner: the rule is applied once to existing templates, stage tasks, and open commitments
--      (owner_profile.commitment_rule_applied_at records when). Later changes made in Settings are kept.

-- 1. Times moved
alter table public.tasks add column if not exists times_moved int not null default 0;

-- 2. Released commitments
alter table public.commitments drop constraint if exists commitments_status_check;
alter table public.commitments add constraint commitments_status_check
  check (status in ('open', 'met', 'missed', 'closed_by_decision', 'released'));
alter table public.missed_commitments drop constraint if exists missed_commitments_resolution_check;
alter table public.missed_commitments add constraint missed_commitments_resolution_check
  check (resolution in ('pending', 'new_date', 'decision', 'released'));

-- 6. Marker: the rule was applied to this owner's existing data.
alter table public.owner_profile add column if not exists commitment_rule_applied_at timestamptz;

-- 4. New stage tasks are regular tasks unless marked (the next-action task is marked when seeded).
do $$
begin
  if to_regclass('public.stage_tasks') is not null then
    alter table public.stage_tasks alter column is_commitment set default false;
  end if;
end $$;

-- True when a recurring template is one of the scheduled reviews.
create or replace function public.is_review_template_title(p_title text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_title, '') ~* '(daily close|weekly review|monthly review|quarterly review)'
$$;

-- Closing a pipeline item (won or passed) skips its open pipeline tasks. Their commitments are released
-- (not counted as missed). Same as 0009 otherwise.
do $$
begin
  if to_regclass('public.stage_tasks') is not null then
    execute $f$
create or replace function public.pipeline_item_stage_tasks()
returns trigger
language plpgsql
as $body$
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
    update public.commitments set status = 'released'
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
    -- Only stage tasks marked as commitments (by default the next-action task) become commitments.
    if v_task is not null and t.is_commitment then
      insert into public.commitments (owner_id, title, record_type, record_id, due_date, original_due_date)
      values (new.owner_id, new.name || ': ' || t.title, 'tasks', v_task, v_today + t.due_in_days, v_today + t.due_in_days)
      on conflict (owner_id, record_type, record_id) do nothing;
    end if;
  end loop;
  return new;
end;
$body$
    $f$;
  end if;
end $$;

-- 3, 5, 6. Applies the rule to one owner. The input is added every time (skipped when it exists);
-- the data changes run once per owner, so later changes made in Settings are never overwritten.
create or replace function public.seed_owner_commitment_rule(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released uuid[];
begin
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'task_moved_review_threshold', 'Times a task can move to the next day before the weekly review lists it', 'Productivity', 'number', 5, null,
     'A regular task that is not done moves to the next day automatically. The weekly review lists tasks moved this many times or more, to do, reschedule, or delete.', 290)
  on conflict (owner_id, key) do nothing;

  if exists (select 1 from owner_profile where owner_id = p_owner and commitment_rule_applied_at is not null) then
    return;
  end if;

  -- Recurring templates: only the reviews are commitments.
  update task_templates set is_commitment = public.is_review_template_title(title)
   where owner_id = p_owner and is_commitment is distinct from public.is_review_template_title(title);

  -- Stage task lists: only the next-action task is a commitment.
  if to_regclass('public.stage_tasks') is not null then
    update stage_tasks set is_commitment = is_next_action_default
     where owner_id = p_owner and is_commitment is distinct from is_next_action_default;
  end if;

  -- Open or missed commitments on tasks that are now regular tasks are released (kept, not counted):
  -- tasks from recurring templates that are not reviews, and stage tasks that are not the next-action task.
  select coalesce(array_agg(c.id), '{}') into v_released
    from commitments c
    join tasks t on t.id = c.record_id
    join task_templates tt on tt.id = t.template_id
   where c.owner_id = p_owner and c.record_type = 'tasks' and c.status in ('open', 'missed')
     and t.source = 'template' and not tt.is_commitment;
  if to_regclass('public.stage_tasks') is not null then
    v_released := v_released || coalesce((
      select array_agg(c.id)
        from commitments c
        join tasks t on t.id = c.record_id
        join stage_tasks st on st.id::text = split_part(t.source_key, ':', 3)
       where c.owner_id = p_owner and c.record_type = 'tasks' and c.status in ('open', 'missed')
         and t.source = 'pipeline' and t.source_key like 'stage-task:%' and not st.is_commitment), '{}');
  end if;
  if cardinality(v_released) > 0 then
    update commitments set status = 'released' where id = any (v_released);
    update missed_commitments set resolution = 'released' where commitment_id = any (v_released) and resolution = 'pending';
    update alerts set status = 'dismissed', dismissed_at = now()
     where owner_id = p_owner and status = 'open' and related_type = 'commitments' and related_id = any (v_released);
    update tasks set status = 'skipped'
     where owner_id = p_owner and status = 'todo' and source = 'missed_commitment'
       and related_type = 'commitments' and related_id = any (v_released);
  end if;

  update owner_profile set commitment_rule_applied_at = now() where owner_id = p_owner;
end;
$$;

revoke execute on function public.seed_owner_commitment_rule(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function applies the rule after the other defaults.
-- Each earlier setup step runs only when its update is present.
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
  return new;
end;
$$;

-- Existing owners: apply the rule once.
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_commitment_rule(r.owner_id);
  end loop;
end $$;

-- ===== supabase/migrations/0011_source_chain_consulting.sql =====
-- 0011: Deal source chain and the Consulting pipeline (approved 2026-10-26).
-- Depends on 0008, 0009, and 0010. Safe to run more than once: every statement checks whether its change already exists,
-- and default lists are only added where nothing is set yet.
--
-- What it adds:
--   A. Deal source chain
--      1. pipeline_items.introduced_by_contact_id ("Introduced by": the person in your network who started the chain).
--         The existing source_contact_id is shown as "Deal came from" (acquisitions) or "Lead came from" (consulting).
--   B. Consulting
--      2. Pipeline kind 'consulting'.
--      3. pipeline_stages.default_probability_pct (chance an item in the stage becomes paid work) and
--         pipeline_stages.counts_as_signed (signed work: counted in runway when the runway setting is on).
--      4. consulting_details: rate type, rate, hours, project length, start and end dates, probability (one row per item).
--         Model: rate is the price for the rate type: per hour (hourly), the whole project fee (project), or per month
--         (monthly_retainer). Expected monthly income is calculated in the app, never typed:
--           hourly = rate x expected hours per month; retainer = rate; project = rate / project months
--           (project months empty: months from start date to end date).
--      5. transactions.pipeline_item_id: money received linked to a consulting engagement.
--      6. contacts.is_consulting_lead and communication purpose 'consulting'.
--      7. Inputs: runway_include_signed_consulting (0), consulting_monthly_income (0), consulting_months (12).
--      8. The Consulting initiative and pipeline with stages, stage task lists, time limits, required details,
--         and stage probabilities, for the existing owner and future owners.

-- 1. Introduced by
alter table public.pipeline_items add column if not exists introduced_by_contact_id uuid references public.contacts (id) on delete set null;
create index if not exists pipeline_items_source_contact_idx on public.pipeline_items (source_contact_id) where source_contact_id is not null;
create index if not exists pipeline_items_introduced_by_idx on public.pipeline_items (introduced_by_contact_id) where introduced_by_contact_id is not null;

-- 2. Pipeline kind 'consulting'
alter table public.pipelines drop constraint if exists pipelines_kind_check;
alter table public.pipelines add constraint pipelines_kind_check
  check (kind in ('acquisition', 'job', 'investor', 'cofounder', 'other', 'consulting'));

-- 3. Stage probability and signed work
alter table public.pipeline_stages add column if not exists default_probability_pct int;
alter table public.pipeline_stages add column if not exists counts_as_signed boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_probability_check') then
    alter table public.pipeline_stages add constraint pipeline_stages_probability_check
      check (default_probability_pct is null or default_probability_pct between 0 and 100);
  end if;
end $$;

-- 4. Consulting details (one row per consulting item)
create table if not exists public.consulting_details (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null unique references public.pipeline_items (id) on delete cascade,
  rate_type text check (rate_type is null or rate_type in ('hourly', 'project', 'monthly_retainer')),
  rate numeric(14, 2) check (rate is null or rate >= 0),
  expected_hours_per_month numeric(8, 2) check (expected_hours_per_month is null or expected_hours_per_month >= 0),
  project_months numeric(6, 2) check (project_months is null or project_months > 0),
  start_date date,
  end_date date,
  probability_pct int check (probability_pct is null or probability_pct between 0 and 100),
  scope_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Money received linked to a consulting engagement
alter table public.transactions add column if not exists pipeline_item_id uuid references public.pipeline_items (id) on delete set null;
create index if not exists transactions_pipeline_item_idx on public.transactions (pipeline_item_id, date) where pipeline_item_id is not null;

-- 6. Consulting leads and the consulting purpose
alter table public.contacts add column if not exists is_consulting_lead boolean not null default false;
alter table public.communications drop constraint if exists communications_purpose_check;
alter table public.communications add constraint communications_purpose_check
  check (purpose in ('general', 'deal_sourcing', 'cim_request', 'source_contact', 'consulting'));

-- A communication saved with no purpose: consulting for consulting leads, deal_sourcing for deal-source contacts, otherwise general.
create or replace function public.communication_default_purpose()
returns trigger
language plpgsql
as $$
begin
  if new.purpose is null then
    new.purpose := case
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_consulting_lead) then 'consulting'
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_deal_source) then 'deal_sourcing'
      else 'general'
    end;
  end if;
  return new;
end;
$$;

-- Row Level Security, owner-only policy, grants, updated_at, and change log for the new table
-- (the same statements 0006 applied to every table that existed then).
do $$
declare
  t text;
begin
  foreach t in array array['consulting_details'] loop
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

-- 7 and 8. Consulting defaults for one owner. Only fills what is missing, so running it again never duplicates
-- or overwrites the owner's edits (a stage that already has any task keeps its list; set limits are kept).
create or replace function public.seed_owner_consulting(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_init uuid;
  v_pipe uuid;
begin
  -- Inputs
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'runway_include_signed_consulting', 'Count signed consulting income in runway (1 = yes, 0 = no)', 'Runway', 'boolean', 0, null,
     'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula until the item''s first payment is received. After that, its payments are already in average monthly income.', 45),
    (p_owner, 'consulting_monthly_income', 'Consulting: monthly income', 'Consulting', 'usd', 0, null,
     'Used in scenarios: consulting income added each month for the number of months below, and in the Bridge comparison.', 320),
    (p_owner, 'consulting_months', 'Consulting: months of consulting income', 'Consulting', 'months', 12, null,
     'Number of months the consulting income above is received, starting next month.', 330)
  on conflict (owner_id, key) do nothing;

  -- Initiative
  insert into initiatives (owner_id, name, description, sort_order)
  values (p_owner, 'Consulting', 'Paid consulting work: finding clients, proposals, signed engagements, and income received.', 6)
  on conflict (owner_id, name) do nothing;
  select id into v_init from initiatives where owner_id = p_owner and name = 'Consulting';

  -- Pipeline (kept as is when the owner already has a pipeline with this name)
  insert into pipelines (owner_id, initiative_id, name, kind, sort_order)
  values (p_owner, v_init, 'Consulting', 'consulting', 6)
  on conflict (owner_id, name) do nothing;
  select id into v_pipe from pipelines where owner_id = p_owner and name = 'Consulting' and kind = 'consulting';
  if v_pipe is null then
    return;
  end if;

  -- Stages (added only when the pipeline has no stages yet)
  if not exists (select 1 from pipeline_stages where pipeline_id = v_pipe) then
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
      (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Contacted', 2, 'open'),
      (p_owner, v_pipe, 'Discovery call', 3, 'open'), (p_owner, v_pipe, 'Proposal sent', 4, 'open'),
      (p_owner, v_pipe, 'Negotiating', 5, 'open'), (p_owner, v_pipe, 'Signed', 6, 'open'),
      (p_owner, v_pipe, 'Active', 7, 'open'), (p_owner, v_pipe, 'Completed', 8, 'won'),
      (p_owner, v_pipe, 'Lost', 9, 'lost');
  end if;

  -- Time limits, required details, probabilities, and signed work. Only empty settings are filled.
  update pipeline_stages s
     set max_days_in_stage = coalesce(s.max_days_in_stage, v.max_days),
         required_fields = case when cardinality(s.required_fields) = 0 then v.required else s.required_fields end,
         default_probability_pct = coalesce(s.default_probability_pct, v.probability),
         counts_as_signed = s.counts_as_signed or v.signed
    from (values
      ('Identified', 7, '{}'::text[], 10, false),
      ('Contacted', 10, '{}'::text[], 20, false),
      ('Discovery call', 7, '{}'::text[], 30, false),
      ('Proposal sent', 14, '{rate_type,rate}'::text[], 50, false),
      ('Negotiating', 10, '{}'::text[], 70, false),
      ('Signed', 7, '{rate_type,rate,start_date}'::text[], 100, true),
      ('Active', null, '{start_date}'::text[], 100, true),
      ('Completed', null, '{}'::text[], null, false),
      ('Lost', null, '{}'::text[], 0, false)
    ) as v (stage, max_days, required, probability, signed)
   where s.pipeline_id = v_pipe and s.name = v.stage;

  -- Stage task lists. Only the next-action task of each stage is a commitment (commitment rule, 0010).
  insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
  select p_owner, s.id, v.title, v.due, v.ord, v.is_default, v.is_default
    from (values
      ('Identified', 'Research the client and their need', 2, 1, true),
      ('Identified', 'Find a contact or referral', 3, 2, false),
      ('Contacted', 'Follow up if there is no reply', 5, 1, true),
      ('Discovery call', 'Send follow-up notes and next steps', 1, 1, true),
      ('Discovery call', 'Write the scope and price outline', 3, 2, false),
      ('Proposal sent', 'Follow up on the proposal', 5, 1, true),
      ('Negotiating', 'Agree on final terms', 5, 1, true),
      ('Signed', 'Countersign the contract and upload it', 2, 1, true),
      ('Signed', 'Send the first invoice or set the invoice schedule', 5, 2, false),
      ('Active', 'Monthly check-in with the client', 30, 1, true),
      ('Active', 'Send invoices on schedule', 30, 2, false),
      ('Completed', 'Ask for a referral or testimonial', 7, 1, false),
      ('Completed', 'Write down results and lessons', 3, 2, false),
      ('Lost', 'Write down the reason', 1, 1, false)
    ) as v (stage, title, due, ord, is_default)
    join pipeline_stages s on s.pipeline_id = v_pipe and s.name = v.stage
   where not exists (select 1 from stage_tasks st where st.pipeline_stage_id = s.id);
end;
$$;

revoke execute on function public.seed_owner_consulting(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function also creates the consulting defaults.
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
  return new;
end;
$$;

-- Existing owners: add the consulting defaults once (skipped where they already exist).
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_consulting(r.owner_id);
  end loop;
end $$;

-- ===== supabase/migrations/0012_contacts_sources.sql =====
-- 0012: Contact options and the runway setting text (approved 2026-10-26).
-- Depends on 0008 (relationship groups) and 0011 (the runway setting). Safe to run more than once.
--
-- What it changes:
--   1. Relationship groups Friend (every 30 days) and Other (no set schedule: in the Outreach Queue only when
--      "Reach out every (days)" is set on the contact). The schedules are applied in the app (src/lib/calc/outreach.ts).
--      The Friend role needs no database change (contacts.roles has no fixed list).
--   2. The description of the input runway_include_signed_consulting: a signed or active engagement counts in runway
--      only until its first payment is received. Changed only where the description is still the original text.
--   3. public.schema_has_0012(): the app calls it to check that this update is applied (Friend and Other appear in
--      forms only after that).
-- No new columns or tables. "Not a person" sources for "Deal came from" use the existing pipeline_items.source column.

-- 1. Relationship groups
alter table public.contacts drop constraint if exists contacts_relationship_group_check;
alter table public.contacts add constraint contacts_relationship_group_check
  check (relationship_group is null or relationship_group in ('close', 'friend', 'warm', 'professional', 'other'));

-- 2. Runway setting text
update public.inputs
   set description = 'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula until the item''s first payment is received. After that, its payments are already in average monthly income.'
 where key = 'runway_include_signed_consulting'
   and description = 'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula.';

-- 3. Check function for the app
create or replace function public.schema_has_0012()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0012() from public, anon;
grant execute on function public.schema_has_0012() to authenticated, service_role;

-- ===== supabase/migrations/0013_gmail_send.sql =====
-- 0013: Send email from the app, with confirmation (approved 2026-10-26).
-- Depends on 0005 (communications, partner_reports). Safe to run more than once: every statement checks first.
--
-- What it adds (all columns are nullable; nothing existing changes):
--   1. communications.gmail_message_id and communications.gmail_thread_id: the Gmail message an email sent from the
--      app became (users.messages.send). No existing column fits: communications had no external id.
--   2. partner_reports.sent_at and partner_reports.gmail_message_id: a partner report sent from the app is marked
--      sent with the date. (A finalized report still never changes; these are delivery details, like gmail_draft_id.)
--   3. public.schema_has_0013(): the app calls it to check that this update is applied.
-- Before this update runs, the app still sends: it saves the communication without the Gmail ids and records the
-- send (with the Gmail id and date) in the change log.

alter table public.communications add column if not exists gmail_message_id text;
alter table public.communications add column if not exists gmail_thread_id text;
create index if not exists communications_gmail_message_idx on public.communications (gmail_message_id) where gmail_message_id is not null;

alter table public.partner_reports add column if not exists sent_at timestamptz;
alter table public.partner_reports add column if not exists gmail_message_id text;

create or replace function public.schema_has_0013()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0013() from public, anon;
grant execute on function public.schema_has_0013() to authenticated, service_role;

-- ===== supabase/migrations/0014_initiative_builder_reset.sql =====
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

-- ===== supabase/migrations/0015_email_signature.sql =====
-- 0015: Gmail signature on emails sent or drafted from the app (approved 2026-10-28).
-- Depends on 0001 to 0014 (only 0002 is needed: owner_profile). Safe to run more than once: every statement checks first.
--
-- What it adds (all empty; nothing existing changes):
--   1. owner_profile.email_signature_html: the signature as HTML (sanitized by the app before it is saved).
--   2. owner_profile.email_signature_text: the plain text version (made by the app from the HTML).
--   3. owner_profile.email_signature_enabled: "Add signature to emails sent or drafted from the app"
--      (empty means on once a signature is saved).
--   4. owner_profile.email_signature_updated_at: when the signature was last saved.
--   5. public.schema_has_0015(): the app may call it to check that this update is applied.

alter table public.owner_profile add column if not exists email_signature_html text;
alter table public.owner_profile add column if not exists email_signature_text text;
alter table public.owner_profile add column if not exists email_signature_enabled boolean;
alter table public.owner_profile add column if not exists email_signature_updated_at timestamptz;

create or replace function public.schema_has_0015()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0015() from public, anon;
grant execute on function public.schema_has_0015() to authenticated, service_role;

-- ===== supabase/migrations/0016_deal_funnel.sql =====
-- 0016: Deal funnel (approved 2026-10-28). Depends on 0008 (targets), 0009 (deal targets), and 0011 (owner setup).
-- Safe to run more than once: every statement checks first, and existing targets and inputs are never changed.
--
-- What it adds:
--   1. Two count sources for targets:
--        cims_reviewed = acquisition items, each counted once (ever), on the New York date they first moved into
--                        "CIM reviewed" or a later stage (skipping it counts too; passed stages never count). The stage
--                        an item was created in is not a move: an item created at "CIM reviewed" or later never counts.
--        deal_calls    = communications with method call, meeting, or video linked to an acquisition item
--                        (at most one per item per day).
--      "Listings screened" uses the existing manual count source (+1 and +5 buttons; an optional one-line note).
--   2. Three targets for every owner (existing owners now, future owners in the owner setup function), counting
--      from the New York date this update runs, all commitments, initiative Acquisition Search:
--        Listings screened      20 per weekday   manual (its +1 buttons also show on the Acquisitions page)
--        CIMs reviewed           1 per weekday   cims_reviewed
--        Broker or owner calls   2 per week      deal_calls
--   3. Five inputs (category Acquisition): search hours per day (2) and minutes per step: listing screen (3),
--      CIM review (45), NDA or reply (5), call (30). Used only for the "Suggested targets" line.
--   4. public.schema_has_0016(): the app calls it to check that this update is applied.

-- 1. Count sources.
-- (0009 keeps this wider rule when it is run again after this update.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'targets_count_source_check'
                 and pg_get_constraintdef(oid) like '%deal_calls%') then
    alter table public.targets drop constraint if exists targets_count_source_check;
    alter table public.targets add constraint targets_count_source_check
      check (count_source in ('communications_outreach', 'pipeline_items_created', 'manual', 'deals_sourced', 'deals_advanced',
                              'cims_reviewed', 'deal_calls'));
  end if;
end $$;

-- 2 and 3. Targets and inputs for one owner. Only adds what is missing (matched by target name and input key).
create or replace function public.seed_owner_deal_funnel(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := (now() at time zone 'America/New_York')::date;
  v_acq uuid;
  v_cim uuid;
  v_init uuid;
begin
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'search_hours_per_day', 'Search hours per day (hours)', 'Acquisition', 'number', 2, null,
     'Hours each weekday for the deal search. Used for the "Suggested targets" line on the Acquisitions page and on Targets.', 70),
    (p_owner, 'minutes_per_listing_screen', 'Minutes to screen one listing', 'Acquisition', 'number', 3, null,
     'Used for the "Suggested targets" line.', 80),
    (p_owner, 'minutes_per_cim_review', 'Minutes to review one CIM', 'Acquisition', 'number', 45, null,
     'Used for the "Suggested targets" line.', 90),
    (p_owner, 'minutes_per_nda_reply', 'Minutes to reply to a deal or send an NDA', 'Acquisition', 'number', 5, null,
     'Used for the "Suggested targets" line.', 100),
    (p_owner, 'minutes_per_call', 'Minutes per broker or owner call', 'Acquisition', 'number', 30, null,
     'Used for the "Suggested targets" line.', 110)
  on conflict (owner_id, key) do nothing;

  select id into v_acq from pipelines where owner_id = p_owner and kind = 'acquisition' order by sort_order, created_at limit 1;
  select id into v_cim from pipeline_stages where pipeline_id = v_acq and name = 'CIM reviewed' limit 1;
  select id into v_init from initiatives where owner_id = p_owner and name = 'Acquisition Search' limit 1;
  insert into targets (owner_id, name, initiative_id, period, minimum_count, active_weekdays, count_source, pipeline_id, stage_id,
                       is_commitment, show_to_partners, active, start_date, sort_order, notes)
  values
    (p_owner, 'Listings screened', v_init, 'day', 20, '{1,2,3,4,5}', 'manual', v_acq, null, true, false, true, v_start, 4,
     'Counted with the +1 and +5 buttons (Targets, the Acquisitions page, Home, and Productivity). A note per entry is optional.'),
    (p_owner, 'CIMs reviewed', v_init, 'day', 1, '{1,2,3,4,5}', 'cims_reviewed', v_acq, v_cim, true, false, true, v_start, 5,
     'Counts each Acquisitions item once, on the day it first moved into CIM reviewed or a later stage (not the stage it was created in).'),
    (p_owner, 'Broker or owner calls', v_init, 'week', 2, '{1,2,3,4,5}', 'deal_calls', v_acq, null, true, false, true, v_start, 6,
     'Counts calls, meetings, and video calls logged on Acquisitions items (one per item per day), Monday to Sunday.')
  on conflict (owner_id, name) do nothing;
end;
$$;

revoke execute on function public.seed_owner_deal_funnel(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function also creates the deal funnel targets and inputs.
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
  return new;
end;
$$;

-- Existing owners: add the targets and inputs once (skipped where they already exist).
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_deal_funnel(r.owner_id);
  end loop;
end $$;

-- 4. Check function.
create or replace function public.schema_has_0016()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0016() from public, anon;
grant execute on function public.schema_has_0016() to authenticated, service_role;

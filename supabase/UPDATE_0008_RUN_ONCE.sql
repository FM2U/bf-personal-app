-- USE supabase/UPDATE_RUN_ONCE.sql INSTEAD. That file includes this update (0008) and the next ones (0009 to 0016).
-- This file is kept for reference only.
--
-- BF Personal App: database update 0008 (Daily Targets and Outreach Queue).
-- For a database that already has 0001 to 0007. Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once. Generated from supabase/migrations/0008_targets_outreach.sql.

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

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

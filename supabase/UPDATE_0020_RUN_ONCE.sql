-- BF Personal App: database update 0020 (the Work module, batch A: Work on now, Screen listings, Deals, the deal page).
-- For the live database, which has 0001 to 0019. Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated and no deal is deleted.
-- What it changes:
--   On pipeline items (deals): what it does, location, industry, link, broker, why selling, key finding, open questions,
--   waiting on and since when, pass reason, screened (a listing is a deal not yet screened), buy box note, block minutes.
--   The acquisition pipeline's stages become Interested, NDA signed, Broker call, CIM review, Seller call, Model,
--   Partner presentation, IOI or LOI, Diligence, then Closed, Passed, Lost. Screened is renamed Interested, CIM reviewed
--   is renamed CIM review, IOI sent is renamed IOI or LOI; deals in Sourced move to Interested and deals in LOI signed move
--   to IOI or LOI (those two stages are removed). Each stage gets its approved default next action.
--   The setting "Days waiting on someone before it is marked amber" (5; red at double) under Plan, Inputs, Acquisition.
--   Future owners get the same. And a check function.
-- Generated from supabase/migrations/0020_work_module.sql by supabase/build_combined.py.

-- 0020: The Work module, batch A (approved 2026-10-30): Work on now, Screen listings, Deals, and the deal page.
-- Depends on 0004 (pipelines, pipeline_items, deal_financials), 0007 (owner setup), 0009 (stage_tasks and the stage
-- triggers), and 0010 (the stage tasks trigger as it is now).
-- Safe to run more than once: every statement checks first. No item is deleted; items in a stage that goes away are
-- moved to the nearest new stage first.
--
-- What it adds:
--   1. pipeline_items: the listing and deal facts (what_it_does, location, industry, listing_url, broker_name,
--      why_selling), the findings (key_finding, open_questions), waiting_on and waiting_since, pass_reason,
--      screened (a listing is a deal with screened = false), buy_box_note, and next_action_minutes (the block).
--   2. The acquisition pipeline's stages become, in order: Interested, NDA signed, Broker call, CIM review,
--      Seller call, Model, Partner presentation, IOI or LOI, Diligence, then Closed (won), Passed (lost), Lost (lost).
--      Existing stages are renamed where one maps to one (Screened to Interested, CIM reviewed to CIM review,
--      IOI sent to IOI or LOI), so stage ids, targets, and history stay valid. Items in Sourced move to Interested and
--      items in LOI signed move to IOI or LOI; those two stages are then removed. Each of the nine stages gets its
--      default next action (stage_tasks, is_next_action_default) with its due-in-days.
--   3. The setting "Days waiting before amber" (inputs, key waiting_threshold_days, default 5; red at double).
--   4. Future owners get the same stages and setting (seed_owner_work_module, called by the owner setup function).
--   5. public.schema_has_0020(): the app calls it to check that this update is applied. Before it runs, the Work
--      screens show "Database update needed" and every other screen keeps working.

-- 1. Columns on pipeline_items
alter table public.pipeline_items add column if not exists what_it_does text;
alter table public.pipeline_items add column if not exists location text;
alter table public.pipeline_items add column if not exists industry text;
alter table public.pipeline_items add column if not exists listing_url text;
alter table public.pipeline_items add column if not exists broker_name text;
alter table public.pipeline_items add column if not exists why_selling text;
alter table public.pipeline_items add column if not exists key_finding text;
alter table public.pipeline_items add column if not exists open_questions text;
alter table public.pipeline_items add column if not exists waiting_on text;
alter table public.pipeline_items add column if not exists waiting_since date;
alter table public.pipeline_items add column if not exists pass_reason text;
alter table public.pipeline_items add column if not exists screened boolean not null default true;
alter table public.pipeline_items add column if not exists buy_box_note text;
alter table public.pipeline_items add column if not exists next_action_minutes int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_pass_reason_check') then
    alter table public.pipeline_items add constraint pipeline_items_pass_reason_check
      check (pass_reason is null or pass_reason in ('franchise', 'too_small', 'too_big', 'location', 'retail_dtc', 'no_growth_path', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_next_action_minutes_check') then
    alter table public.pipeline_items add constraint pipeline_items_next_action_minutes_check
      check (next_action_minutes is null or (next_action_minutes >= 0 and next_action_minutes <= 1440));
  end if;
end $$;
create index if not exists pipeline_items_unscreened_idx on public.pipeline_items (owner_id) where screened = false;

-- 2 and 3. The acquisition stages, their default next actions, and the waiting setting, for one owner.
-- Only changes what needs changing, so running it again does nothing.
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
        ('NDA signed', 'Chase the broker for the CIM and the call', 3),
        ('Broker call', 'Ask for the seller call', 2),
        ('CIM review', 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3),
        ('Seller call', 'Ask for tax returns and start the model', 3),
        ('Model', 'Book the partner meeting', 5),
        ('Partner presentation', 'Submit the IOI or LOI', 5),
        ('IOI or LOI', 'Wait for the broker, chase in 7 days', 7),
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
     'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Chase resets the count.', 80)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_owner_work_module(uuid) from public, anon, authenticated;

-- Existing owners.
do $$
declare o record;
begin
  for o in select owner_id from public.owner_profile loop
    perform public.seed_owner_work_module(o.owner_id);
  end loop;
end $$;

-- 4. Future owners: the owner setup function also creates these (the same as 0017, plus this seed).
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
  return new;
end;
$$;

-- 5. Check function
create or replace function public.schema_has_0020()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0020() from public, anon;
grant execute on function public.schema_has_0020() to authenticated, service_role;

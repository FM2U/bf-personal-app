-- 0024: Edit batch B of the Work module (approved 2026-11-01). Broker call moves to Evaluate, after CIM review.
-- Depends on 0020 and 0021 (the acquisition stages and their defaults). Safe to run more than once. Nothing is
-- deleted: stage rows keep their ids, every deal keeps its stage, and only positions and two texts change by UPDATE.
--   1. In every acquisition pipeline the stage order becomes Interested, NDA signed, CIM review, Broker call,
--      Seller call, Model, Partner presentation, IOI or LOI, Diligence (CIM review takes position 3, Broker call 4).
--   2. The NDA signed default next action becomes "Ask the broker for the CIM" (was "Follow up with the broker for
--      the CIM and the call"); the deals that still carry the old text get the new one (same due date). The Broker
--      call default stays "Ask for the seller call"; the CIM review default is unchanged.
--   3. Future owners get the same order and defaults (seed_owner_work_module, called by the owner setup function).
--   4. schema_has_0024().

-- 1. Positions: CIM review before Broker call, in every acquisition pipeline that has both.
update public.pipeline_stages s set position = v.pos
  from (values ('CIM review', 3), ('Broker call', 4)) as v (name, pos), public.pipelines p
 where p.id = s.pipeline_id and p.kind = 'acquisition' and s.name = v.name and s.position <> v.pos
   and exists (select 1 from public.pipeline_stages x where x.pipeline_id = p.id and x.name = 'CIM review')
   and exists (select 1 from public.pipeline_stages x where x.pipeline_id = p.id and x.name = 'Broker call');

-- 2. The NDA signed default and the deals that still carry the old text.
update public.stage_tasks set title = 'Ask the broker for the CIM' where title = 'Follow up with the broker for the CIM and the call';
update public.pipeline_items set next_action = 'Ask the broker for the CIM' where next_action = 'Follow up with the broker for the CIM and the call';

-- 3. Future owners: the same function as 0021 with the new order and the new NDA signed default.
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

    -- Every stage of the list exists.
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome)
    select p_owner, p.id, v.name, v.pos, v.outcome
      from (values
        ('Interested', 1, 'open'), ('NDA signed', 2, 'open'), ('CIM review', 3, 'open'), ('Broker call', 4, 'open'),
        ('Seller call', 5, 'open'), ('Model', 6, 'open'), ('Partner presentation', 7, 'open'), ('IOI or LOI', 8, 'open'),
        ('Diligence', 9, 'open'), ('Closed', 10, 'won'), ('Passed', 11, 'lost'), ('Lost', 12, 'lost')
      ) as v (name, pos, outcome)
     where not exists (select 1 from pipeline_stages s where s.pipeline_id = p.id and s.name = v.name);

    -- Items in a stage that goes away move to the nearest stage. The move is a remap, not progress: the stage
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

    -- Positions in the approved order (Broker call after CIM review since Edit batch B).
    update pipeline_stages s set position = v.pos
      from (values
        ('Interested', 1), ('NDA signed', 2), ('CIM review', 3), ('Broker call', 4), ('Seller call', 5), ('Model', 6),
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
        ('NDA signed', 'Ask the broker for the CIM', 3),
        ('CIM review', 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3),
        ('Broker call', 'Ask for the seller call', 2),
        ('Seller call', 'Ask for tax returns and start the model', 3),
        ('Model', 'Book the partner meeting', 5),
        ('Partner presentation', 'Submit the IOI or LOI', 5),
        ('IOI or LOI', 'Wait for the broker, follow up in 7 days', 7),
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
     'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Follow up resets the count.', 80)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_owner_work_module(uuid) from public, anon, authenticated;

-- 4. Check function
create or replace function public.schema_has_0024()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0024() from public, anon;
grant execute on function public.schema_has_0024() to authenticated, service_role;

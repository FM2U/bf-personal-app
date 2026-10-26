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

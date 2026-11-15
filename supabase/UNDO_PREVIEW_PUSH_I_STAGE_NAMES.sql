-- BF Personal App: ONLY IF the push I release has to be taken back (after a Vercel Instant Rollback to the release
-- before it). Puts the stage names back the way they were before UPDATE_PREVIEW_PUSH_I.sql, so the older app finds
-- every deal, job and consulting item again. SQL Editor, New query, paste this whole file, Run. Safe to run twice.
--
-- What it changes:
--   Acquisitions: "Diligence" becomes "Model" again, then "Confirmatory diligence" becomes "Diligence" again.
--   Job search: "Lead" becomes "Contact", "Applied" becomes "Conversation".
--   Consulting: "Proposal sent" becomes "Proposal"; the "Intro call" stage is removed and the stages after it move up
--     one place. If any consulting item is at Intro call, this file stops and changes nothing: move that item to
--     another stage first (its page, the stage menu), then run it again.
--   The default next actions the update changed go back, if you have not changed them since.
--   It keeps the new Top priorities fields and the decisions table (the older app does not read them).
--
-- The last statement is a check. Expected result: acquisition_stages ending in "IOI or LOI, Diligence",
-- job_stages = Contact, Conversation, Interview, Offer, consulting_stages = Lead, Proposal, Engagement, Paid.

do $$
declare
  p record;
  v_intro uuid;
  v_pos int;
  v_n int;
begin
  -- Stops first if any consulting item is at Intro call (nothing is changed).
  select count(*) into v_n from public.pipeline_items i join public.pipeline_stages s on s.id = i.stage_id
    join public.pipelines pp on pp.id = s.pipeline_id where pp.kind = 'consulting' and s.name = 'Intro call';
  if v_n > 0 then
    raise exception '% consulting item(s) are at Intro call. Move them to another stage first, then run this file again. Nothing was changed.', v_n;
  end if;

  for p in select id from public.pipelines where kind = 'acquisition' loop
    if exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Confirmatory diligence') then
      if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Model') then
        update public.pipeline_stages set name = 'Model' where pipeline_id = p.id and name = 'Diligence';
      end if;
      update public.pipeline_stages set name = 'Diligence' where pipeline_id = p.id and name = 'Confirmatory diligence';
    end if;
  end loop;

  for p in select id from public.pipelines where kind = 'job' loop
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Contact') then
      update public.pipeline_stages set name = 'Contact' where pipeline_id = p.id and name = 'Lead';
    end if;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Conversation') then
      update public.pipeline_stages set name = 'Conversation' where pipeline_id = p.id and name = 'Applied';
      update public.stage_tasks t set title = 'Send a thank-you note and ask about the next step', due_in_days = 2
        from public.pipeline_stages s
        where s.id = t.pipeline_stage_id and s.pipeline_id = p.id and s.name = 'Conversation'
          and t.is_next_action_default and t.title = 'Follow up on the application' and t.due_in_days = 5;
    end if;
  end loop;

  for p in select id from public.pipelines where kind = 'consulting' loop
    select id, position into v_intro, v_pos from public.pipeline_stages where pipeline_id = p.id and name = 'Intro call';
    if v_intro is not null then
      delete from public.stage_tasks where pipeline_stage_id = v_intro;
      delete from public.pipeline_stages where id = v_intro;
      update public.pipeline_stages set position = position - 1 where pipeline_id = p.id and position > v_pos;
    end if;
    if not exists (select 1 from public.pipeline_stages where pipeline_id = p.id and name = 'Proposal') then
      update public.pipeline_stages set name = 'Proposal' where pipeline_id = p.id and name = 'Proposal sent';
      update public.stage_tasks t set title = 'Send the scope and fee', due_in_days = 3
        from public.pipeline_stages s
        where s.id = t.pipeline_stage_id and s.pipeline_id = p.id and s.name = 'Proposal'
          and t.is_next_action_default and t.title = 'Follow up on the proposal' and t.due_in_days = 5;
    end if;
  end loop;
end $$;

select (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'acquisition' and s.outcome = 'open') as acquisition_stages,
       (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'job' and s.outcome = 'open') as job_stages,
       (select string_agg(s.name, ', ' order by s.position) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.kind = 'consulting' and s.outcome = 'open') as consulting_stages;

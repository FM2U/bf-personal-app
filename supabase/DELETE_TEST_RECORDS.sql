-- BF Personal App: delete the test records from the preview database (Bram, 2026-11-06).
-- SQL Editor, New query, paste this whole file, Run. Safe to run twice (a second run finds nothing to delete).
--
-- What it deletes:
--   Test Partner, with everything the app keeps about that person: the sent reports, the logged emails and replies,
--   notes, links, calendar blocks, waits and tasks. The emails themselves stay in Gmail.
--   Every to-do typed by hand: each to-do that is not sample data, not a task on a sample deal, person or project, and
--   not a repeating copy of one of those (XXXX, XXX, YYYY, TEST XXX TTTT and the like).
-- What it keeps:
--   Sample data, with its own to-dos and tasks (Settings, Data, Remove sample data removes those later).
--   The 6 targets (the app's standard targets), Settings, the Google connection, and each day's End of day status.
-- It stops and changes nothing if more than one person is named Test Partner.
--
-- The result lists every record it deleted, then one last row with what is left. Expected last row:
-- "Left after the cleanup" with "Test Partner 0, to-dos typed by hand 0, targets 6".

drop table if exists cleanup_deleted;
create temp table cleanup_deleted (n serial, kind text, name text);

do $$
declare
  v_tp uuid[];
  v_reports uuid[];
begin
  if to_regclass('public.waits') is null then
    raise exception 'This database does not have the final app''s tables. Run this file only in bf-personal-app-final. Nothing was changed.';
  end if;

  select coalesce(array_agg(c.id), '{}') into v_tp
    from public.contacts c
   where c.name = 'Test Partner'
     and not exists (select 1 from public.sample_records s where s.table_name = 'contacts' and s.record_id = c.id);
  if cardinality(v_tp) > 1 then
    raise exception 'More than one person is named Test Partner, so nothing was deleted. Tell Claude.';
  end if;

  -- Sent reports are protected from deletion; these flags allow it inside this run only, without change-log rows.
  perform set_config('app.bulk_delete', 'on', true);
  perform set_config('app.skip_change_log', 'on', true);

  -- 1. Test Partner and everything tied to that person.
  select coalesce(array_agg(id), '{}') into v_reports from public.partner_reports where contact_id = any (v_tp);
  insert into cleanup_deleted (kind, name)
    select 'Email or call logged', coalesce(subject, '(no subject)') from public.communications
     where contact_id = any (v_tp) or partner_report_id = any (v_reports);
  delete from public.communications where contact_id = any (v_tp) or partner_report_id = any (v_reports);
  insert into cleanup_deleted (kind, name)
    select 'Sent report', report_kind || ', ' || period_start from public.partner_reports where id = any (v_reports);
  delete from public.partner_reports where id = any (v_reports);
  delete from public.notes where record_id = any (v_tp);
  delete from public.record_links where from_id = any (v_tp) or to_id = any (v_tp);
  delete from public.time_blocks where record_id = any (v_tp);
  insert into cleanup_deleted (kind, name) select 'Person', name from public.contacts where id = any (v_tp);
  delete from public.contacts where id = any (v_tp); -- its waits and tasks go with it

  -- 2. To-dos typed by hand: not sample data, not a task on a sample record, not a repeating copy of either.
  create temp table cleanup_keep on commit drop as
    with recursive keep as (
      select d.id from public.deal_todos d
       where exists (select 1 from public.sample_records s where s.record_id in (d.id, d.deal_id, d.record_id))
      union
      select d.id from public.deal_todos d join keep k on d.repeat_from = k.id
    )
    select id from keep;
  insert into cleanup_deleted (kind, name)
    select 'To-do', text from public.deal_todos where id not in (select id from cleanup_keep) order by created_at;
  delete from public.time_blocks where record_type = 'deal_todos' and record_id in (select id from public.deal_todos where id not in (select id from cleanup_keep));
  delete from public.deal_todos where id not in (select id from cleanup_keep);
end $$;

select kind, name from (
  select n, kind, name from cleanup_deleted
  union all
  select 1000000, 'Left after the cleanup',
         concat('Test Partner ', (select count(*) from public.contacts where name = 'Test Partner'),
                ', to-dos typed by hand ',
                (with recursive keep as (
                   select d.id from public.deal_todos d
                    where exists (select 1 from public.sample_records s where s.record_id in (d.id, d.deal_id, d.record_id))
                   union
                   select d.id from public.deal_todos d join keep k on d.repeat_from = k.id)
                 select count(*) from public.deal_todos where id not in (select id from keep)),
                ', targets ', (select count(*) from public.targets))
) x
order by n;

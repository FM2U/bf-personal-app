-- BF Personal App: READ ONLY list for the preview database (Bram, 2026-11-06). Changes nothing.
-- Lists every record that is NOT sample data, so Bram can say which are tests to delete and which to keep.
-- Sample data (Settings, Data, Remove sample data) is left out of this list; it is removed by that button later.
-- SQL Editor, New query, paste this whole file, Run. Then copy the result rows to Claude (or a screenshot).
--
-- Columns: kind (what it is), name, added (the day it was made), details (what is tied to it).

with sample as (select table_name, record_id from public.sample_records)
select kind, name, added, details from (
  select 1 as k, 'Person' as kind, c.name, c.created_at::date as added,
         concat_ws(', ',
           nullif(c.email, ''),
           case when c.outreach_role = 'accountability_partner' then 'accountability partner' end,
           (select nullif(count(*), 0) || ' sent reports' from public.partner_reports pr where pr.contact_id = c.id),
           (select nullif(count(*), 0) || ' emails or calls logged' from public.communications m where m.contact_id = c.id),
           case when c.archived_at is not null then 'archived' end) as details
    from public.contacts c
   where not exists (select 1 from sample s where s.table_name = 'contacts' and s.record_id = c.id)
  union all
  select 2, 'Organization', o.name, o.created_at::date, nullif(o.kind, '')
    from public.organizations o
   where not exists (select 1 from sample s where s.table_name = 'organizations' and s.record_id = o.id)
  union all
  select 3, 'Deal, listing, job or consulting item', i.name, i.created_at::date, (select p.name from public.pipelines p where p.id = i.pipeline_id)
    from public.pipeline_items i
   where not exists (select 1 from sample s where s.table_name = 'pipeline_items' and s.record_id = i.id)
  union all
  select 4, 'Project', pj.name, pj.created_at::date, pj.status
    from public.projects pj
   where not exists (select 1 from sample s where s.table_name = 'projects' and s.record_id = pj.id)
  union all
  select 5, 'To-do', t.text, t.created_at::date,
         concat_ws(', ', case when t.due_on is not null then 'due ' || t.due_on end, case when t.repeat is not null then 'repeats ' || t.repeat end, case when t.done_at is not null then 'done' end)
    from public.deal_todos t
   -- 2026-11-06 correction: a task on a sample deal, person or project, or a repeating copy of a sample to-do, is
   -- sample data too (Remove sample data deletes it); only to-dos typed by hand are listed.
   where t.id not in (
     with recursive keep as (
       select d.id from public.deal_todos d where exists (select 1 from sample s where s.record_id in (d.id, d.deal_id, d.record_id))
       union
       select d.id from public.deal_todos d join keep k on d.repeat_from = k.id)
     select id from keep)
  union all
  select 6, 'Target', tg.name, tg.created_at::date, case when tg.archived_at is not null then 'archived' end
    from public.targets tg
   where not exists (select 1 from sample s where s.table_name = 'targets' and s.record_id = tg.id)
  union all
  select 7, 'Emails or calls logged with no person', count(*)::text, null::date, null
    from public.communications m
   where m.contact_id is null
     and not exists (select 1 from sample s where s.table_name = 'communications' and s.record_id = m.id)
  having count(*) > 0
) x
order by k, added, name;

-- BF Personal App: update for the fix list of 2026-11-06 (push F). For the NEW database (bf-personal-app-final) that
-- already has SETUP_NEW_DATABASE.sql and the updates B, C, D, E and E2 run. SQL Editor, New query, paste this whole
-- file, Run. Safe to run twice.
--
-- What it changes:
--   Partner checkboxes on End of day: a new column, end_of_day.skipped_partners, holds the partners unticked for that
--   day only (fix list item 1). Every partner starts ticked; nothing else changes for the other days.
--   Re-open Friday Nov 6 for testing (Bram, 2026-11-06): on the FIRST run only, Friday Nov 6's End of day goes back to
--   not sent, so the checkboxes and the note look can be tried today. The app's record of that day's sent copy (the
--   partner report) is removed; the email itself stays in Gmail and on Test Partner's timeline. This step stops,
--   changing nothing, if Nov 6 was sent to anyone other than Test Partner. A second run never re-opens the day again.
--
-- The last statement is a check. Expected result: one row, push_f_ready = true.

do $$
declare
  first_run boolean;
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push E2 update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if to_regclass('public.waits') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_E2.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;

  first_run := not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'end_of_day' and column_name = 'skipped_partners');

  -- Item 1: the partners unticked for one day.
  alter table public.end_of_day add column if not exists skipped_partners jsonb default '[]'::jsonb not null;

  -- Re-open Friday Nov 6 (first run only).
  if first_run and exists (select 1 from public.end_of_day where day = date '2026-11-06' and status = 'sent') then
    if exists (
      select 1 from public.partner_reports pr
      left join public.contacts c on c.id = pr.contact_id
      where pr.report_kind = 'end_of_day' and pr.period_start = date '2026-11-06' and coalesce(c.name, '') <> 'Test Partner'
    ) then
      raise exception 'Friday Nov 6 was sent to someone other than Test Partner, so it is not re-opened. Nothing was changed.';
    end if;
    -- A sent report is protected from deletion; this flag allows it inside this run only.
    perform set_config('app.bulk_delete', 'on', true);
    delete from public.partner_reports where report_kind = 'end_of_day' and period_start = date '2026-11-06';
    update public.end_of_day
       set status = 'open', sent_at = null, report_id = null, report_subject = null, report_html = null, report_edited = false
     where day = date '2026-11-06' and status = 'sent';
  end if;
end $$;

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'end_of_day' and column_name = 'skipped_partners'
) as push_f_ready;

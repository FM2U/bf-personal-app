-- BF Personal App: TEST HELPER for the preview database only (Bram, 2026-11-06). Re-opens Friday Nov 6's End of day
-- so the note order and the Monday line can be tried today. SQL Editor, New query, paste this whole file, Run.
--
-- What it changes:
--   Friday Nov 6's End of day goes back to not sent. The app's records of that day's sent copies (the partner
--   reports) are removed; the emails themselves stay in Gmail and on each partner's timeline. Reasons, the Weekly
--   review answers and the Monday line are kept.
--   It runs only when every copy went to Test Partner or to a sample partner (Jake, Sarah); otherwise it changes nothing.
--   Running it again after another test send re-opens the day again (that is its purpose).
--
-- The last statement is a check. Expected result: one row, nov_6 = open.

do $$
begin
  if to_regclass('public.waits') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'end_of_day' and column_name = 'skipped_partners') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_F.sql first. Nothing was changed.';
  end if;
  if exists (
    select 1 from public.partner_reports pr
    left join public.contacts c on c.id = pr.contact_id
    where pr.report_kind = 'end_of_day' and pr.period_start = date '2026-11-06'
      and coalesce(c.name, '') <> 'Test Partner'
      and not exists (select 1 from public.sample_records sr where sr.table_name = 'contacts' and sr.record_id = pr.contact_id)
  ) then
    raise exception 'Friday Nov 6 went to a real partner other than Test Partner, so it is not re-opened. Nothing was changed.';
  end if;
  -- A sent report is protected from deletion; this flag allows it inside this run only.
  perform set_config('app.bulk_delete', 'on', true);
  delete from public.partner_reports where report_kind = 'end_of_day' and period_start = date '2026-11-06';
  update public.end_of_day
     set status = 'open', sent_at = null, report_id = null, report_subject = null, report_html = null, report_edited = false, skipped_partners = '[]'::jsonb
   where day = date '2026-11-06';
end $$;

select coalesce((select status from public.end_of_day where day = date '2026-11-06' limit 1), 'no row') as nov_6;

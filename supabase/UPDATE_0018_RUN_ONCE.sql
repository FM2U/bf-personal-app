-- BF Personal App: database update 0018 (resolve a miss as Done late; daily partner reports).
-- For a database that has 0001 to 0017 (the live database with 0001 to 0018 uses UPDATE_0019_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, and no existing
-- record is changed or deleted (existing partners get the report frequency Weekly). What it adds:
--   Done late: a missed commitment can be resolved with the date it was done. It still counts as a miss in the score.
--   The day period for report templates (today's numbers).
--   A report frequency on each accountability partner: Daily, Weekly, or Both (Weekly for existing partners).
--   Daily partner reports: drafted after the weekday daily close, sent only after you press Approve and send.
--   And a check function.
-- Generated from supabase/migrations/0018_resolve_daily_reports.sql by supabase/build_combined.py.

-- 0018: Resolve a miss as "Done late", and daily partner reports (approved 2026-10-30). Depends on 0005 (commitments,
-- partners, partner reports), 0010 (released commitments), and 0017 (partner report templates).
-- Safe to run more than once: every statement checks first, and no existing record is changed except that existing
-- partners get the report frequency Weekly (the column default).
--
-- What it adds:
--   1. "Done late": a missed commitment can be resolved as done late, with the date it was done
--      (missed_commitments.resolution 'done_late' and missed_commitments.done_on). The commitment gets the status
--      'done_late': it is closed, and it still counts as a miss in the commitment score.
--   2. Report templates can use the period "day" (today's numbers), as well as week, two weeks, and month.
--   3. partners.report_frequency: Daily, Weekly, or Both (Weekly for existing partners). Daily and Both partners get
--      a report drafted after the weekday daily close; Weekly and Both keep the scheduled report.
--   4. partner_reports: report_kind ('regular' or 'daily'), template_id (the template the daily draft uses), and
--      skipped_at ("Not today" on the daily close). One daily report per partner per day.
--   5. public.schema_has_0018(): the app calls it to check that this update is applied.

-- 1. Done late
alter table public.missed_commitments add column if not exists done_on date;
alter table public.missed_commitments drop constraint if exists missed_commitments_resolution_check;
alter table public.missed_commitments add constraint missed_commitments_resolution_check
  check (resolution in ('pending', 'new_date', 'decision', 'released', 'done_late'));
alter table public.commitments drop constraint if exists commitments_status_check;
alter table public.commitments add constraint commitments_status_check
  check (status in ('open', 'met', 'missed', 'closed_by_decision', 'released', 'done_late'));

-- 2. The "day" period for report templates
do $$
begin
  if to_regclass('public.partner_report_templates') is not null then
    alter table public.partner_report_templates drop constraint if exists partner_report_templates_period_check;
    alter table public.partner_report_templates add constraint partner_report_templates_period_check
      check (period in ('day', 'week', 'two_weeks', 'month'));
  end if;
end $$;

-- 3. Report frequency per partner
alter table public.partners add column if not exists report_frequency text not null default 'weekly';
alter table public.partners drop constraint if exists partners_report_frequency_check;
alter table public.partners add constraint partners_report_frequency_check
  check (report_frequency in ('daily', 'weekly', 'both'));

-- 4. Daily partner reports
alter table public.partner_reports add column if not exists report_kind text not null default 'regular';
alter table public.partner_reports drop constraint if exists partner_reports_report_kind_check;
alter table public.partner_reports add constraint partner_reports_report_kind_check
  check (report_kind in ('regular', 'daily'));
alter table public.partner_reports add column if not exists skipped_at timestamptz;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'template_id') then
    if to_regclass('public.partner_report_templates') is not null then
      alter table public.partner_reports add column template_id uuid references public.partner_report_templates (id) on delete set null;
    else
      alter table public.partner_reports add column template_id uuid;
    end if;
  end if;
end $$;
create unique index if not exists partner_reports_daily_idx on public.partner_reports (partner_id, period_end) where report_kind = 'daily';

-- 5. Check function
create or replace function public.schema_has_0018()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0018() from public, anon;
grant execute on function public.schema_has_0018() to authenticated, service_role;

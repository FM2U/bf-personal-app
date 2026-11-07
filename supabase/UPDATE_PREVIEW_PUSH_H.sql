-- BF Personal App: update for the work week of 2026-11-07 (push H). For the NEW database (bf-personal-app-final) that
-- already has SETUP_NEW_DATABASE.sql and the updates B, C, D, E, E2, F and G run. SQL Editor, New query, paste this
-- whole file, Run. Safe to run twice.
--
-- What it changes (Bram, 2026-11-07; claude/2026-11-07-part-b-fix-list.md, design B):
--   Two new settings on owner_profile: work_days (the work days, 1 Monday to 7 Sunday; Monday to Friday to start) and
--   week_start (1 Monday or 7 Sunday; Monday to start). Settings, Work settings shows them.
--   The weekly review day (owner_profile.weekly_review_weekday, an old Profile field the app never used; the app has
--   always reviewed on Friday) becomes Friday on the FIRST run, so nothing changes until you pick another day in
--   Settings, Work settings. A second run leaves your choice as it is.
--   No other table or row changes.
--
-- The last statement is a check. Expected result: one row, push_h_ready = true, work_days = {1,2,3,4,5},
-- week_start = 1, review_day = 5 (until you change them in Settings).

do $$
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push G update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if to_regprocedure('public.read_batch(jsonb)') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_G.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;

  -- First run only (the columns are not there yet): the unused review day becomes Friday, the day the app has used.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'owner_profile' and column_name = 'work_days') then
    alter table public.owner_profile add column work_days smallint[] default '{1,2,3,4,5}'::smallint[] not null;
    alter table public.owner_profile add column week_start smallint default 1 not null;
    alter table public.owner_profile add constraint owner_profile_work_days_check check (cardinality(work_days) >= 1 and work_days <@ '{1,2,3,4,5,6,7}'::smallint[]);
    alter table public.owner_profile add constraint owner_profile_week_start_check check (week_start = any (array[1, 7]));
    alter table public.owner_profile alter column weekly_review_weekday set default 5;
    update public.owner_profile set weekly_review_weekday = 5;
  end if;
end $$;

select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'owner_profile' and column_name = 'week_start') as push_h_ready,
       (select work_days::text from public.owner_profile limit 1) as work_days,
       (select week_start from public.owner_profile limit 1) as week_start,
       (select weekly_review_weekday from public.owner_profile limit 1) as review_day;

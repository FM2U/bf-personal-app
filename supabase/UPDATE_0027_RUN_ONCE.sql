-- BF Personal App: database update 0027 (the original listing text, year established, and employees).
-- For the live database, which has 0001 to 0026. Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, nothing is deleted, no existing row changes.
-- What it adds:
--   pipeline_items.listing_text (the full text pasted into Add a listing, shown in the Original listing text card and read by
--   every AI action on the listing or deal), pipeline_items.year_established and pipeline_items.employees (Facts). schema_has_0027().
-- Generated from supabase/migrations/0027_listing_text.sql by supabase/build_combined.py.

-- 0027: Fix (approved 2026-11-02): the original listing text and two more listing facts on pipeline items.
-- Depends on 0020 (listing and deal facts on pipeline items). Safe to run more than once. Nothing is deleted and no
-- existing row changes: three empty columns are added.
--   1. pipeline_items.listing_text: the full text pasted into Add a listing (or pasted later on the listing or deal
--      page), one per record; shown in the "Original listing text" card and read by every AI action on the record.
--      It is kept on the record and not as a note, so it never shows in the Timeline (notes.kind allows only 'note'
--      and 'finding').
--   2. pipeline_items.year_established and pipeline_items.employees: read by Fill from text when the listing states
--      them, shown and edited in Facts. Employees is text ("20+ coaches", "14 full-time").
--   3. schema_has_0027().

-- 1 and 2. The columns
alter table public.pipeline_items add column if not exists listing_text text;
alter table public.pipeline_items add column if not exists year_established integer;
alter table public.pipeline_items add column if not exists employees text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_year_established_check') then
    alter table public.pipeline_items add constraint pipeline_items_year_established_check check (year_established is null or (year_established between 1700 and 2200));
  end if;
end $$;

-- 3. Check function
create or replace function public.schema_has_0027()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0027() from public, anon;
grant execute on function public.schema_has_0027() to authenticated, service_role;

-- BF Personal App: database update 0023 (batch B2: findings with a source link on the timeline, the pay range of a job opportunity).
-- For a database that has 0001 to 0022 (the live database with 0001 to 0023 uses UPDATE_0024_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, and no existing record
-- is changed or deleted. It only adds empty columns and a check function:
--   notes.kind ('note' or 'finding') and notes.source_url, pipeline_items.pay_range, schema_has_0023().
-- Generated from supabase/migrations/0023_batch_b2.sql by supabase/build_combined.py.

-- 0023: Batch B2 of the Work module (Rosara projects, Job search, Consulting, the Ask AI panel, the AI order on Home).
-- Almost everything B2 needs was created by 0022 (projects, tasks on any record, the Job search and Consulting stages,
-- opportunity fields, the AI order cache, the weekly focus setting). This update adds the three small things that were
-- still missing. Nothing is deleted or changed; it only adds empty columns and a check function. Safe to run twice.
--   1. notes.kind ('note' or 'finding') and notes.source_url: a note on a project can be marked as a Finding with a
--      source link (the project page timeline shows a Finding pill and the source).
--   2. pipeline_items.pay_range: the pay range of a job opportunity as typed ("$150K to $170K").
--   3. schema_has_0023().

-- 1. Findings on the timeline
alter table public.notes add column if not exists kind text not null default 'note';
alter table public.notes add column if not exists source_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_kind_check') then
    alter table public.notes add constraint notes_kind_check check (kind in ('note', 'finding'));
  end if;
end $$;

-- 2. The pay range of a job opportunity
alter table public.pipeline_items add column if not exists pay_range text;

-- 3. Check function
create or replace function public.schema_has_0023()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0023() from public, anon;
grant execute on function public.schema_has_0023() to authenticated, service_role;

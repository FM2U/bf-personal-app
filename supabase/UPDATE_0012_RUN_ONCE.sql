-- BF Personal App: database update 0012 (relationship groups Friend and Other; runway setting text).
-- For a database that already has 0001 to 0011. Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once. (The live database with 0001 to 0010 uses supabase/UPDATE_0011_0012_RUN_ONCE.sql.)
-- Generated from supabase/migrations/0012_contacts_sources.sql by supabase/build_combined.py.

-- 0012: Contact options and the runway setting text (approved 2026-10-26).
-- Depends on 0008 (relationship groups) and 0011 (the runway setting). Safe to run more than once.
--
-- What it changes:
--   1. Relationship groups Friend (every 30 days) and Other (no set schedule: in the Outreach Queue only when
--      "Reach out every (days)" is set on the contact). The schedules are applied in the app (src/lib/calc/outreach.ts).
--      The Friend role needs no database change (contacts.roles has no fixed list).
--   2. The description of the input runway_include_signed_consulting: a signed or active engagement counts in runway
--      only until its first payment is received. Changed only where the description is still the original text.
--   3. public.schema_has_0012(): the app calls it to check that this update is applied (Friend and Other appear in
--      forms only after that).
-- No new columns or tables. "Not a person" sources for "Deal came from" use the existing pipeline_items.source column.

-- 1. Relationship groups
alter table public.contacts drop constraint if exists contacts_relationship_group_check;
alter table public.contacts add constraint contacts_relationship_group_check
  check (relationship_group is null or relationship_group in ('close', 'friend', 'warm', 'professional', 'other'));

-- 2. Runway setting text
update public.inputs
   set description = 'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula until the item''s first payment is received. After that, its payments are already in average monthly income.'
 where key = 'runway_include_signed_consulting'
   and description = 'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula.';

-- 3. Check function for the app
create or replace function public.schema_has_0012()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0012() from public, anon;
grant execute on function public.schema_has_0012() to authenticated, service_role;

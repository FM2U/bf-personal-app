-- BF Personal App: database update 0026 (Edit batch C round 2: the Personal network role).
-- For a database that has 0001 to 0025 (the live database with 0001 to 0026 uses UPDATE_0027_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated and nothing is deleted.
-- What it changes:
--   The outreach role "Former colleague" becomes "Personal network": every contact with the old role gets the new one by
--   UPDATE (every other field kept), and the role check allows the new key instead of the old one. schema_has_0026().
-- Generated from supabase/migrations/0026_edit_batch_c_round_2.sql by supabase/build_combined.py.

-- 0026: Edit batch C, round 2 (approved 2026-11-02). The outreach role "Former colleague" becomes "Personal network".
-- Depends on 0022 (contacts.outreach_role and its check). Safe to run more than once. Nothing is deleted: the contacts
-- that carry the old role keep every other field and only the role key changes, by UPDATE.
--   1. The role check is replaced: it allows personal_network instead of former_colleague (same list otherwise).
--   2. Every contact with outreach_role former_colleague gets personal_network.
--   3. schema_has_0026().
-- There is no enum type for the role (it is text with a check), so nothing else changes.

-- 1 and 2. The check comes off first, the rows move over, then the new check goes on (a second run finds nothing to move).
alter table public.contacts drop constraint if exists contacts_outreach_role_check;
update public.contacts set outreach_role = 'personal_network' where outreach_role = 'former_colleague';
alter table public.contacts add constraint contacts_outreach_role_check
  check (outreach_role is null or outreach_role in ('broker', 'lender', 'personal_network', 'service_provider', 'rosara_customer', 'recruiter', 'cofounder_candidate', 'investor', 'other'));

-- 3. Check function
create or replace function public.schema_has_0026()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0026() from public, anon;
grant execute on function public.schema_has_0026() to authenticated, service_role;

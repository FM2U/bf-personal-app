-- BF Personal App: database update 0015 (Gmail signature on emails sent or drafted from the app).
-- For a database that has 0001 to 0014. Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, and no existing
-- record is changed or deleted. It only adds four empty columns to owner_profile and a check function.
-- Generated from supabase/migrations/0015_email_signature.sql by supabase/build_combined.py.

-- 0015: Gmail signature on emails sent or drafted from the app (approved 2026-10-28).
-- Depends on 0001 to 0014 (only 0002 is needed: owner_profile). Safe to run more than once: every statement checks first.
--
-- What it adds (all empty; nothing existing changes):
--   1. owner_profile.email_signature_html: the signature as HTML (sanitized by the app before it is saved).
--   2. owner_profile.email_signature_text: the plain text version (made by the app from the HTML).
--   3. owner_profile.email_signature_enabled: "Add signature to emails sent or drafted from the app"
--      (empty means on once a signature is saved).
--   4. owner_profile.email_signature_updated_at: when the signature was last saved.
--   5. public.schema_has_0015(): the app may call it to check that this update is applied.

alter table public.owner_profile add column if not exists email_signature_html text;
alter table public.owner_profile add column if not exists email_signature_text text;
alter table public.owner_profile add column if not exists email_signature_enabled boolean;
alter table public.owner_profile add column if not exists email_signature_updated_at timestamptz;

create or replace function public.schema_has_0015()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0015() from public, anon;
grant execute on function public.schema_has_0015() to authenticated, service_role;

-- USE supabase/UPDATE_0013_0014_RUN_ONCE.sql INSTEAD. That file runs this update (0013) and the next one (0014).
-- This file is kept for reference only. Running it first does no harm: the combined file is safe after it.
--
-- BF Personal App: database update 0013 (send email from the app).
-- For the live database, which has 0001 to 0012. Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once: nothing is duplicated. It only adds empty columns and a check function:
--   communications.gmail_message_id, communications.gmail_thread_id, partner_reports.sent_at, partner_reports.gmail_message_id.
-- Generated from supabase/migrations/0013_gmail_send.sql by supabase/build_combined.py.

-- 0013: Send email from the app, with confirmation (approved 2026-10-26).
-- Depends on 0005 (communications, partner_reports). Safe to run more than once: every statement checks first.
--
-- What it adds (all columns are nullable; nothing existing changes):
--   1. communications.gmail_message_id and communications.gmail_thread_id: the Gmail message an email sent from the
--      app became (users.messages.send). No existing column fits: communications had no external id.
--   2. partner_reports.sent_at and partner_reports.gmail_message_id: a partner report sent from the app is marked
--      sent with the date. (A finalized report still never changes; these are delivery details, like gmail_draft_id.)
--   3. public.schema_has_0013(): the app calls it to check that this update is applied.
-- Before this update runs, the app still sends: it saves the communication without the Gmail ids and records the
-- send (with the Gmail id and date) in the change log.

alter table public.communications add column if not exists gmail_message_id text;
alter table public.communications add column if not exists gmail_thread_id text;
create index if not exists communications_gmail_message_idx on public.communications (gmail_message_id) where gmail_message_id is not null;

alter table public.partner_reports add column if not exists sent_at timestamptz;
alter table public.partner_reports add column if not exists gmail_message_id text;

create or replace function public.schema_has_0013()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0013() from public, anon;
grant execute on function public.schema_has_0013() to authenticated, service_role;

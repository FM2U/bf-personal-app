-- BF Personal App: update for push E (2026-11-05). For the NEW database (bf-personal-app-final) that already has
-- SETUP_NEW_DATABASE.sql, UPDATE_PREVIEW_PUSH_B.sql, UPDATE_PREVIEW_PUSH_C.sql and UPDATE_PREVIEW_PUSH_D.sql run.
-- SQL Editor, New query, paste this whole file, Run. Safe to run twice.
--
-- What it adds:
--   Waiting on a person: a person (contacts) can be waited on, like a deal: waiting_on, waiting_since.
--   Add to Waiting remembers the email it came from: waiting_comm_id on the deal (pipeline_items) and on the person
--   (contacts). It empties itself if that email is ever deleted.
--   Dismiss on "No reply yet": the email is marked (communications.no_reply_dismissed_at) and stays off the list.
--   An index so the app finds the emails of one Gmail thread quickly.
--   The setting "No reply yet after 2 days" needs no change here: it is saved the first time Work settings is saved,
--   and reads as 2 until then.
--
-- The last statement is a check. Expected result: one row, push_e_ready = true.

-- Stops here, changing nothing, on the old database, on an empty one, or before the push D update.
do $$
begin
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'gmail_thread_id') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_B.sql first, then UPDATE_PREVIEW_PUSH_C.sql, then UPDATE_PREVIEW_PUSH_D.sql, then this file. Nothing was changed.';
  end if;
  if to_regclass('public.time_blocks') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_C.sql first, then UPDATE_PREVIEW_PUSH_D.sql, then this file. Nothing was changed.';
  end if;
  if to_regclass('public.monthly_reviews') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deal_todos' and column_name = 'repeat_until') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_D.sql first, then this file. Nothing was changed.';
  end if;
end $$;

-- Dismiss on "No reply yet".
alter table public.communications add column if not exists no_reply_dismissed_at timestamp with time zone;

-- Waiting on a person, and the email a wait came from.
alter table public.contacts add column if not exists waiting_on text;
alter table public.contacts add column if not exists waiting_since date;
alter table public.contacts add column if not exists waiting_comm_id uuid;
alter table public.pipeline_items add column if not exists waiting_comm_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_waiting_comm_id_fkey' and conrelid = 'public.contacts'::regclass) then
    alter table only public.contacts add constraint contacts_waiting_comm_id_fkey foreign key (waiting_comm_id) references public.communications(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_waiting_comm_id_fkey' and conrelid = 'public.pipeline_items'::regclass) then
    alter table only public.pipeline_items add constraint pipeline_items_waiting_comm_id_fkey foreign key (waiting_comm_id) references public.communications(id) on delete set null;
  end if;
end $$;

-- The emails of one Gmail thread.
create index if not exists communications_thread_idx on public.communications using btree (owner_id, gmail_thread_id) where (gmail_thread_id is not null);

-- Check (expected: one row, push_e_ready = true).
select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'communications' and column_name = 'no_reply_dismissed_at')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'waiting_on')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'waiting_since')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'waiting_comm_id')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pipeline_items' and column_name = 'waiting_comm_id')
  and exists (select 1 from pg_constraint where conname = 'contacts_waiting_comm_id_fkey')
  and exists (select 1 from pg_constraint where conname = 'pipeline_items_waiting_comm_id_fkey')
  and to_regclass('public.communications_thread_idx') is not null
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'contacts' and policyname = 'owner_only')
  and has_column_privilege('authenticated', 'public.contacts', 'waiting_on', 'update')
  and has_column_privilege('authenticated', 'public.pipeline_items', 'waiting_comm_id', 'update')
  and has_column_privilege('authenticated', 'public.communications', 'no_reply_dismissed_at', 'update')) as push_e_ready;

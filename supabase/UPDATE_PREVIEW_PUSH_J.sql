-- BF Personal App: update for the Listings reviewed count (push J, 2026-11-23). For the NEW database
-- (bf-personal-app-final) that already has SETUP_NEW_DATABASE.sql and the updates B to I run. SQL Editor, New query,
-- paste this whole file, Run. Safe to run twice.
--
-- What it changes (Bram, 2026-11-23; claude/2026-11-23-report-h-listings-reviewed-build-plan.md):
--   A new table, listings_reviewed: one line per entry of listings reviewed (the day, how many, and where they came
--   from). Only the signed-in owner can read or change its rows, like every other table.
--   No other table or row changes. Nothing is deleted.
--
-- The last statement is a check. Expected result: one row, push_j_ready = true.

do $$
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push I update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if to_regclass('public.decisions') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_I.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;

  if to_regclass('public.listings_reviewed') is null then
    create table public.listings_reviewed (
      id uuid default gen_random_uuid() not null,
      owner_id uuid default auth.uid() not null,
      day date not null,
      reviewed integer not null,
      source text,
      created_at timestamp with time zone default now() not null,
      constraint listings_reviewed_pkey primary key (id),
      constraint listings_reviewed_count_check check (reviewed >= 0 and reviewed <= 2000),
      constraint listings_reviewed_source_check check (source is null or char_length(source) <= 80),
      constraint listings_reviewed_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade
    );
    create index listings_reviewed_owner_idx on public.listings_reviewed using btree (owner_id, day);
    create trigger log_change after insert or delete or update on public.listings_reviewed for each row execute function public.log_change();
    alter table public.listings_reviewed enable row level security;
    create policy owner_only on public.listings_reviewed to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id));
    grant all on table public.listings_reviewed to authenticated;
    grant all on table public.listings_reviewed to service_role;
  end if;
end;
$$;

select to_regclass('public.listings_reviewed') is not null as push_j_ready;

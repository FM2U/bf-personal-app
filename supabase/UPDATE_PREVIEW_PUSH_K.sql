-- BF Personal App: update for broker links (push K, 2026-11-24). For the NEW database (bf-personal-app-final) that
-- already has SETUP_NEW_DATABASE.sql and the updates B to J run. SQL Editor, New query, paste this whole file, Run.
-- Safe to run twice.
--
-- What it changes (Bram, 2026-11-24; claude/2026-11-24-broker-links-build-plan.md):
--   Deals (pipeline_items): two new links, the deal's associate (a second person at the brokerage) and the deal's
--   brokerage (an organization). The deal's broker uses the link deals already have (primary_contact_id).
--   People (contacts): a second role ("Also"), from the same list as Role.
--   No row changes. Nothing is deleted. Every new column starts empty.
--
-- The last statement is a check. Expected result: one row, push_k_ready = true.

do $$
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push J update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if to_regclass('public.listings_reviewed') is null then
    raise exception 'Run UPDATE_PREVIEW_PUSH_J.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;

  alter table public.pipeline_items add column if not exists broker_associate_contact_id uuid;
  alter table public.pipeline_items add column if not exists broker_organization_id uuid;
  alter table public.contacts add column if not exists second_role text;

  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_broker_associate_contact_id_fkey') then
    alter table public.pipeline_items add constraint pipeline_items_broker_associate_contact_id_fkey foreign key (broker_associate_contact_id) references public.contacts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_broker_organization_id_fkey') then
    alter table public.pipeline_items add constraint pipeline_items_broker_organization_id_fkey foreign key (broker_organization_id) references public.organizations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_second_role_check') then
    alter table public.contacts add constraint contacts_second_role_check check ((second_role is null) or (second_role = any (array['broker'::text, 'lender'::text, 'personal_network'::text, 'service_provider'::text, 'rosara_customer'::text, 'recruiter'::text, 'cofounder_candidate'::text, 'investor'::text, 'consulting_client'::text, 'other'::text])));
  end if;
  create index if not exists pipeline_items_broker_org_idx on public.pipeline_items using btree (broker_organization_id);
  create index if not exists pipeline_items_broker_associate_idx on public.pipeline_items using btree (broker_associate_contact_id);
end;
$$;

select (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'pipeline_items' and column_name in ('broker_associate_contact_id', 'broker_organization_id')) or (table_name = 'contacts' and column_name = 'second_role'))) = 3 as push_k_ready;

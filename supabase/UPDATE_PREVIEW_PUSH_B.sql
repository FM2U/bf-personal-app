-- BF Personal App: update for push B (2026-11-03). For the NEW database (bf-personal-app-final) that already has
-- SETUP_NEW_DATABASE.sql run. SQL Editor, New query, paste this whole file, Run. Safe to run twice.
--
-- What it adds:
--   Organizations: region, deal size, next action and its date, archive; the kind "consulting client".
--   People: the role "consulting client"; tasks on an organization.
--   Reports: the Gmail thread of each sent report, each partner's own edit of the day's report.
--   Replies: an incoming email is stored once (by its Gmail id) and linked to the report it answers; when the app
--   last looked for replies.
--   Remove sample data also removes emails and replies of the sample people.

-- Stops here, changing nothing, on the old database or on an empty one.
do $$
begin
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
end $$;

-- Organizations
alter table public.organizations add column if not exists region text;
alter table public.organizations add column if not exists deal_size text;
alter table public.organizations add column if not exists next_action text;
alter table public.organizations add column if not exists next_action_due date;
alter table public.organizations add column if not exists archived_at timestamp with time zone;
alter table public.organizations drop constraint if exists organizations_kind_check;
alter table public.organizations add constraint organizations_kind_check check (kind = any (array['broker'::text, 'lender'::text, 'employer'::text, 'investor'::text, 'consulting_client'::text, 'business'::text, 'service_provider'::text, 'nonprofit'::text, 'other'::text]));

-- People: the role "consulting client"
alter table public.contacts drop constraint if exists contacts_outreach_role_check;
alter table public.contacts add constraint contacts_outreach_role_check check ((outreach_role is null) or (outreach_role = any (array['broker'::text, 'lender'::text, 'personal_network'::text, 'service_provider'::text, 'rosara_customer'::text, 'recruiter'::text, 'cofounder_candidate'::text, 'investor'::text, 'accountability_partner'::text, 'consulting_client'::text, 'other'::text])));

-- Tasks on an organization
alter table public.deal_todos drop constraint if exists deal_todos_record_type_check;
alter table public.deal_todos add constraint deal_todos_record_type_check check (record_type = any (array['pipeline_items'::text, 'contacts'::text, 'projects'::text, 'organizations'::text]));

-- Reports and replies
alter table public.partner_reports add column if not exists gmail_thread_id text;
alter table public.end_of_day add column if not exists report_edits jsonb default '{}'::jsonb not null;
alter table public.google_connections add column if not exists replies_checked_at timestamp with time zone;
alter table public.communications add column if not exists partner_report_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communications_partner_report_id_fkey' and conrelid = 'public.communications'::regclass) then
    alter table public.communications add constraint communications_partner_report_id_fkey foreign key (partner_report_id) references public.partner_reports(id) on delete set null;
  end if;
end $$;
create index if not exists communications_partner_report_idx on public.communications using btree (partner_report_id) where (partner_report_id is not null);
create unique index if not exists communications_incoming_gmail_key on public.communications using btree (owner_id, gmail_message_id) where ((direction = 'incoming'::text) and (gmail_message_id is not null));

-- Remove sample data: also the emails and replies of the sample people and organizations
create or replace function public.remove_sample_data() returns jsonb
    language plpgsql security definer
    set search_path to 'public'
    as $_$
declare
  v_owner uuid := auth.uid();
  v_ids uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_paths jsonb;
  v_n int;
  t text;
  delete_order text[] := array[
    'end_of_day', 'work_events', 'partner_reports', 'todos', 'deal_todos', 'projects', 'notes', 'record_links',
    'communications', 'consulting_details', 'deal_financials', 'pipeline_items', 'contacts', 'organizations'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can remove sample data';
  end if;
  perform set_config('app.skip_change_log', 'on', true);
  perform set_config('app.bulk_delete', 'on', true);

  select array_agg(record_id) into v_ids from sample_records where owner_id = v_owner;
  if v_ids is null then
    perform set_config('app.skip_change_log', '', true);
    perform set_config('app.bulk_delete', '', true);
    return jsonb_build_object('deleted', '{}'::jsonb, 'storage_paths', '[]'::jsonb, 'total', 0);
  end if;

  delete from record_links where owner_id = v_owner and (from_id = any (v_ids) or to_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('record_links', v_n);
  delete from notes where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notes', v_n);
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from documents where owner_id = v_owner and record_id = any (v_ids);
  delete from documents where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);
  delete from communications where owner_id = v_owner and (contact_id = any (v_ids) or organization_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('communications', v_n);
  delete from partner_reports where owner_id = v_owner and contact_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('partner_reports', v_n);
  delete from stage_history where owner_id = v_owner and item_id = any (v_ids);
  delete from deal_todos where owner_id = v_owner and (record_id = any (v_ids) or deal_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('deal_todos', v_n);

  foreach t in array delete_order loop
    execute format('delete from public.%I where owner_id = $1 and id in (select record_id from public.sample_records where owner_id = $1 and table_name = %L)', t, t)
      using v_owner;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts ->> t)::int, 0) + v_n);
  end loop;

  delete from sample_records where owner_id = v_owner;

  perform set_config('app.skip_change_log', '', true);
  perform set_config('app.bulk_delete', '', true);
  insert into change_log (owner_id, table_name, record_id, action, field, new_value, actor)
  values (v_owner, 'sample_records', null, 'delete', 'sample_data_removed', v_counts, 'owner');
  return jsonb_build_object('deleted', v_counts, 'storage_paths', v_paths,
    'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_counts)));
end;
$_$;

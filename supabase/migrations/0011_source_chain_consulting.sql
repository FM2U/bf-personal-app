-- 0011: Deal source chain and the Consulting pipeline (approved 2026-10-26).
-- Depends on 0008, 0009, and 0010. Safe to run more than once: every statement checks whether its change already exists,
-- and default lists are only added where nothing is set yet.
--
-- What it adds:
--   A. Deal source chain
--      1. pipeline_items.introduced_by_contact_id ("Introduced by": the person in your network who started the chain).
--         The existing source_contact_id is shown as "Deal came from" (acquisitions) or "Lead came from" (consulting).
--   B. Consulting
--      2. Pipeline kind 'consulting'.
--      3. pipeline_stages.default_probability_pct (chance an item in the stage becomes paid work) and
--         pipeline_stages.counts_as_signed (signed work: counted in runway when the runway setting is on).
--      4. consulting_details: rate type, rate, hours, project length, start and end dates, probability (one row per item).
--         Model: rate is the price for the rate type: per hour (hourly), the whole project fee (project), or per month
--         (monthly_retainer). Expected monthly income is calculated in the app, never typed:
--           hourly = rate x expected hours per month; retainer = rate; project = rate / project months
--           (project months empty: months from start date to end date).
--      5. transactions.pipeline_item_id: money received linked to a consulting engagement.
--      6. contacts.is_consulting_lead and communication purpose 'consulting'.
--      7. Inputs: runway_include_signed_consulting (0), consulting_monthly_income (0), consulting_months (12).
--      8. The Consulting initiative and pipeline with stages, stage task lists, time limits, required details,
--         and stage probabilities, for the existing owner and future owners.

-- 1. Introduced by
alter table public.pipeline_items add column if not exists introduced_by_contact_id uuid references public.contacts (id) on delete set null;
create index if not exists pipeline_items_source_contact_idx on public.pipeline_items (source_contact_id) where source_contact_id is not null;
create index if not exists pipeline_items_introduced_by_idx on public.pipeline_items (introduced_by_contact_id) where introduced_by_contact_id is not null;

-- 2. Pipeline kind 'consulting'
alter table public.pipelines drop constraint if exists pipelines_kind_check;
alter table public.pipelines add constraint pipelines_kind_check
  check (kind in ('acquisition', 'job', 'investor', 'cofounder', 'other', 'consulting'));

-- 3. Stage probability and signed work
alter table public.pipeline_stages add column if not exists default_probability_pct int;
alter table public.pipeline_stages add column if not exists counts_as_signed boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_probability_check') then
    alter table public.pipeline_stages add constraint pipeline_stages_probability_check
      check (default_probability_pct is null or default_probability_pct between 0 and 100);
  end if;
end $$;

-- 4. Consulting details (one row per consulting item)
create table if not exists public.consulting_details (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null unique references public.pipeline_items (id) on delete cascade,
  rate_type text check (rate_type is null or rate_type in ('hourly', 'project', 'monthly_retainer')),
  rate numeric(14, 2) check (rate is null or rate >= 0),
  expected_hours_per_month numeric(8, 2) check (expected_hours_per_month is null or expected_hours_per_month >= 0),
  project_months numeric(6, 2) check (project_months is null or project_months > 0),
  start_date date,
  end_date date,
  probability_pct int check (probability_pct is null or probability_pct between 0 and 100),
  scope_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Money received linked to a consulting engagement
alter table public.transactions add column if not exists pipeline_item_id uuid references public.pipeline_items (id) on delete set null;
create index if not exists transactions_pipeline_item_idx on public.transactions (pipeline_item_id, date) where pipeline_item_id is not null;

-- 6. Consulting leads and the consulting purpose
alter table public.contacts add column if not exists is_consulting_lead boolean not null default false;
alter table public.communications drop constraint if exists communications_purpose_check;
alter table public.communications add constraint communications_purpose_check
  check (purpose in ('general', 'deal_sourcing', 'cim_request', 'source_contact', 'consulting'));

-- A communication saved with no purpose: consulting for consulting leads, deal_sourcing for deal-source contacts, otherwise general.
create or replace function public.communication_default_purpose()
returns trigger
language plpgsql
as $$
begin
  if new.purpose is null then
    new.purpose := case
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_consulting_lead) then 'consulting'
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_deal_source) then 'deal_sourcing'
      else 'general'
    end;
  end if;
  return new;
end;
$$;

-- Row Level Security, owner-only policy, grants, updated_at, and change log for the new table
-- (the same statements 0006 applied to every table that existed then).
do $$
declare
  t text;
begin
  foreach t in array array['consulting_details'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'owner_only') then
      execute format(
        'create policy owner_only on public.%I for all to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id))',
        t
      );
    end if;
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
    if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'set_updated_at') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = format('public.%I', t)::regclass and tgname = 'log_change') then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
    end if;
  end loop;
end $$;

-- 7 and 8. Consulting defaults for one owner. Only fills what is missing, so running it again never duplicates
-- or overwrites the owner's edits (a stage that already has any task keeps its list; set limits are kept).
create or replace function public.seed_owner_consulting(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_init uuid;
  v_pipe uuid;
begin
  -- Inputs
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'runway_include_signed_consulting', 'Count signed consulting income in runway (1 = yes, 0 = no)', 'Runway', 'boolean', 0, null,
     'When 1, the expected monthly income of Signed and Active consulting items (between their start and end dates) is added to average monthly income in the runway formula.', 45),
    (p_owner, 'consulting_monthly_income', 'Consulting: monthly income', 'Consulting', 'usd', 0, null,
     'Used in scenarios: consulting income added each month for the number of months below, and in the Bridge comparison.', 320),
    (p_owner, 'consulting_months', 'Consulting: months of consulting income', 'Consulting', 'months', 12, null,
     'Number of months the consulting income above is received, starting next month.', 330)
  on conflict (owner_id, key) do nothing;

  -- Initiative
  insert into initiatives (owner_id, name, description, sort_order)
  values (p_owner, 'Consulting', 'Paid consulting work: finding clients, proposals, signed engagements, and income received.', 6)
  on conflict (owner_id, name) do nothing;
  select id into v_init from initiatives where owner_id = p_owner and name = 'Consulting';

  -- Pipeline (kept as is when the owner already has a pipeline with this name)
  insert into pipelines (owner_id, initiative_id, name, kind, sort_order)
  values (p_owner, v_init, 'Consulting', 'consulting', 6)
  on conflict (owner_id, name) do nothing;
  select id into v_pipe from pipelines where owner_id = p_owner and name = 'Consulting' and kind = 'consulting';
  if v_pipe is null then
    return;
  end if;

  -- Stages (added only when the pipeline has no stages yet)
  if not exists (select 1 from pipeline_stages where pipeline_id = v_pipe) then
    insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
      (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Contacted', 2, 'open'),
      (p_owner, v_pipe, 'Discovery call', 3, 'open'), (p_owner, v_pipe, 'Proposal sent', 4, 'open'),
      (p_owner, v_pipe, 'Negotiating', 5, 'open'), (p_owner, v_pipe, 'Signed', 6, 'open'),
      (p_owner, v_pipe, 'Active', 7, 'open'), (p_owner, v_pipe, 'Completed', 8, 'won'),
      (p_owner, v_pipe, 'Lost', 9, 'lost');
  end if;

  -- Time limits, required details, probabilities, and signed work. Only empty settings are filled.
  update pipeline_stages s
     set max_days_in_stage = coalesce(s.max_days_in_stage, v.max_days),
         required_fields = case when cardinality(s.required_fields) = 0 then v.required else s.required_fields end,
         default_probability_pct = coalesce(s.default_probability_pct, v.probability),
         counts_as_signed = s.counts_as_signed or v.signed
    from (values
      ('Identified', 7, '{}'::text[], 10, false),
      ('Contacted', 10, '{}'::text[], 20, false),
      ('Discovery call', 7, '{}'::text[], 30, false),
      ('Proposal sent', 14, '{rate_type,rate}'::text[], 50, false),
      ('Negotiating', 10, '{}'::text[], 70, false),
      ('Signed', 7, '{rate_type,rate,start_date}'::text[], 100, true),
      ('Active', null, '{start_date}'::text[], 100, true),
      ('Completed', null, '{}'::text[], null, false),
      ('Lost', null, '{}'::text[], 0, false)
    ) as v (stage, max_days, required, probability, signed)
   where s.pipeline_id = v_pipe and s.name = v.stage;

  -- Stage task lists. Only the next-action task of each stage is a commitment (commitment rule, 0010).
  insert into stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment)
  select p_owner, s.id, v.title, v.due, v.ord, v.is_default, v.is_default
    from (values
      ('Identified', 'Research the client and their need', 2, 1, true),
      ('Identified', 'Find a contact or referral', 3, 2, false),
      ('Contacted', 'Follow up if there is no reply', 5, 1, true),
      ('Discovery call', 'Send follow-up notes and next steps', 1, 1, true),
      ('Discovery call', 'Write the scope and price outline', 3, 2, false),
      ('Proposal sent', 'Follow up on the proposal', 5, 1, true),
      ('Negotiating', 'Agree on final terms', 5, 1, true),
      ('Signed', 'Countersign the contract and upload it', 2, 1, true),
      ('Signed', 'Send the first invoice or set the invoice schedule', 5, 2, false),
      ('Active', 'Monthly check-in with the client', 30, 1, true),
      ('Active', 'Send invoices on schedule', 30, 2, false),
      ('Completed', 'Ask for a referral or testimonial', 7, 1, false),
      ('Completed', 'Write down results and lessons', 3, 2, false),
      ('Lost', 'Write down the reason', 1, 1, false)
    ) as v (stage, title, due, ord, is_default)
    join pipeline_stages s on s.pipeline_id = v_pipe and s.name = v.stage
   where not exists (select 1 from stage_tasks st where st.pipeline_stage_id = s.id);
end;
$$;

revoke execute on function public.seed_owner_consulting(uuid) from public, anon, authenticated;

-- Future owners: the owner setup function also creates the consulting defaults.
create or replace function public.handle_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.owner_profile (owner_id) values (new.id) on conflict do nothing;
  perform public.seed_owner_defaults(new.id);
  if to_regprocedure('public.seed_owner_targets(uuid)') is not null then
    perform public.seed_owner_targets(new.id);
  end if;
  if to_regprocedure('public.seed_owner_pipeline_accountability(uuid)') is not null then
    perform public.seed_owner_pipeline_accountability(new.id);
  end if;
  perform public.seed_owner_commitment_rule(new.id);
  perform public.seed_owner_consulting(new.id);
  return new;
end;
$$;

-- Existing owners: add the consulting defaults once (skipped where they already exist).
do $$
declare
  r record;
begin
  for r in select owner_id from public.owner_profile loop
    perform public.seed_owner_consulting(r.owner_id);
  end loop;
end $$;

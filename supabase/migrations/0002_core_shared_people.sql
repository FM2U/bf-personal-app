-- 0002: owner, entities, inputs and assumptions, shared records, people.

create table public.owner_profile (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'America/New_York',
  morning_hour int not null default 7 check (morning_hour between 0 and 23),
  evening_hour int not null default 20 check (evening_hour between 0 and 23),
  weekly_review_weekday int not null default 0 check (weekly_review_weekday between 0 and 6), -- 0 = Sunday
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'personal' check (kind in ('personal', 'business')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- Inputs and Assumptions: every changeable number in one list.
create table public.inputs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  label text not null,
  category text not null default 'General',
  unit text not null default 'number' check (unit in ('usd', 'months', 'percent', 'years', 'number', 'date', 'boolean', 'text')),
  value_number numeric,
  value_text text,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);

create table public.input_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  input_id uuid not null references public.inputs (id) on delete cascade,
  old_number numeric,
  new_number numeric,
  old_text text,
  new_text text,
  actor text not null default 'owner',
  changed_at timestamptz not null default now()
);
create index on public.input_history (input_id, changed_at desc);

create or replace function public.log_input_history()
returns trigger
language plpgsql
as $$
begin
  if (old.value_number is distinct from new.value_number) or (old.value_text is distinct from new.value_text) then
    insert into public.input_history (owner_id, input_id, old_number, new_number, old_text, new_text, actor)
    values (new.owner_id, new.id, old.value_number, new.value_number, old.value_text, new.value_text, public.current_actor());
  end if;
  return new;
end;
$$;
create trigger inputs_history after update on public.inputs
  for each row execute function public.log_input_history();

-- Any record can link to any other record. Types are table names (example: 'debts', 'contacts').
create table public.record_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, from_type, from_id, to_type, to_id)
);
create index on public.record_links (from_type, from_id);
create index on public.record_links (to_type, to_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  record_type text,
  record_id uuid,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  kind text not null default 'other' check (kind in ('signed_agreement', 'statement', 'proof', 'cim', 'nda', 'loi', 'report', 'other')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.documents (record_type, record_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.notes (record_type, record_id);

create table public.change_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  field text,
  old_value jsonb,
  new_value jsonb,
  actor text not null default 'owner',
  created_at timestamptz not null default now()
);
create index on public.change_log (table_name, record_id, created_at desc);
create index on public.change_log (owner_id, created_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'other' check (kind in ('decision_condition', 'missed_commitment', 'connection', 'milestone', 'budget', 'partner', 'other')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  message text not null,
  related_type text,
  related_id uuid,
  href text,
  status text not null default 'open' check (status in ('open', 'dismissed')),
  dedupe_key text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index alerts_open_dedupe on public.alerts (owner_id, dedupe_key) where status = 'open' and dedupe_key is not null;

-- People
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'other' check (kind in ('broker', 'lender', 'employer', 'investor', 'business', 'service_provider', 'nonprofit', 'other')),
  website text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  is_pseudonym boolean not null default false,
  roles text[] not null default '{}',
  organization_id uuid references public.organizations (id) on delete set null,
  title text,
  email text,
  phone text,
  mailing_address text,
  follow_up_date date,
  follow_up_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.contacts (follow_up_date);

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  method text not null default 'email' check (method in ('email', 'call', 'letter', 'meeting', 'text', 'video', 'other')),
  direction text not null default 'outgoing' check (direction in ('outgoing', 'incoming', 'both')),
  contact_id uuid references public.contacts (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  subject text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.communications (contact_id, occurred_at desc);

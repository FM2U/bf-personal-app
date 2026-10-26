-- BF Personal App: all database migrations combined (0001 to 0007), for one paste into the Supabase SQL Editor.
-- Generated from supabase/migrations. Run once on a new, empty project.

-- ===== supabase/migrations/0001_helpers.sql =====
-- 0001: extensions and shared helper functions.

create extension if not exists pgcrypto;

-- True when the signed-in user owns the row AND signed in with the second step (authenticator app).
-- "aal2" means the session passed the authenticator-app check.
create or replace function public.is_owner(row_owner uuid)
returns boolean
language sql
stable
as $$
  select row_owner is not null
     and row_owner = auth.uid()
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Keeps updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Who made the change: 'ai' when an approved AI proposal is applied, 'system' for scheduled jobs,
-- otherwise 'owner'.
create or replace function public.current_actor()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.actor', true), ''),
    case when auth.role() = 'service_role' then 'system' else 'owner' end
  )
$$;

-- ===== supabase/migrations/0002_core_shared_people.sql =====
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

-- ===== supabase/migrations/0003_finance.sql =====
-- 0003: finance records.
-- Sign rule for money: transactions.amount is negative for money out and positive for money in.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_id uuid references public.entities (id) on delete set null,
  name text not null,
  institution text,
  kind text not null default 'checking' check (kind in ('checking', 'savings', 'cash', 'credit_card', 'loan', 'investment', 'retirement', 'other_asset')),
  last4 text,
  is_emergency_fund boolean not null default false,
  include_in_runway boolean not null default true,
  is_active boolean not null default true,
  plaid_item_id text,
  plaid_account_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index accounts_plaid_account on public.accounts (owner_id, plaid_account_id) where plaid_account_id is not null;

create table public.account_balances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  as_of date not null default current_date,
  balance numeric(14, 2) not null,
  source text not null default 'manual' check (source in ('manual', 'plaid', 'csv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.account_balances (account_id, as_of desc, created_at desc);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  parent_id uuid references public.categories (id) on delete set null,
  is_software boolean not null default false,
  is_essential boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  default_category_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name)
);

create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  match_type text not null default 'contains' check (match_type in ('contains', 'equals', 'starts_with')),
  pattern text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  priority int not null default 100,
  created_from text not null default 'manual' check (created_from in ('manual', 'correction', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recurring_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  merchant_name text not null,
  normalized_name text not null,
  account_id uuid references public.accounts (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  average_amount numeric(14, 2) not null,
  monthly_cost numeric(14, 2) not null default 0,
  last_date date,
  next_expected_date date,
  occurrences int not null default 0,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  review_flag boolean not null default false,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'in_use', 'cancel_planned', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_name, frequency)
);

create table public.import_layouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  institution text not null,
  name text not null,
  has_header boolean not null default true,
  date_column text not null,
  description_column text not null,
  amount_column text,
  debit_column text,
  credit_column text,
  external_id_column text,
  amount_sign text not null default 'negative_is_outflow' check (amount_sign in ('negative_is_outflow', 'positive_is_outflow')),
  date_format text not null default 'auto' check (date_format in ('auto', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  layout_id uuid references public.import_layouts (id) on delete set null,
  file_name text,
  source text not null default 'csv' check (source in ('csv', 'plaid')),
  row_count int not null default 0,
  imported_count int not null default 0,
  duplicate_count int not null default 0,
  status text not null default 'review' check (status in ('review', 'committed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_id uuid references public.entities (id) on delete set null,
  name text not null,
  kind text not null default 'other' check (kind in ('salary', 'consulting', 'business', 'investment', 'other')),
  expected_monthly numeric(14, 2),
  contact_id uuid references public.contacts (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  date date not null,
  amount numeric(14, 2) not null,
  description text not null default '',
  merchant_id uuid references public.merchants (id) on delete set null,
  merchant_name text,
  category_id uuid references public.categories (id) on delete set null,
  category_source text not null default 'none' check (category_source in ('none', 'rule', 'ai', 'manual')),
  source text not null default 'manual' check (source in ('csv', 'plaid', 'manual')),
  external_id text,
  dedupe_hash text,
  pending boolean not null default false,
  is_transfer boolean not null default false,
  transfer_pair_id uuid,
  income_source_id uuid references public.income_sources (id) on delete set null,
  recurring_series_id uuid references public.recurring_series (id) on delete set null,
  import_batch_id uuid references public.import_batches (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index transactions_external on public.transactions (owner_id, account_id, external_id) where external_id is not null;
create index on public.transactions (owner_id, date desc);
create index on public.transactions (dedupe_hash);
create index on public.transactions (category_id);

create table public.raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  parsed jsonb,
  status text not null default 'new' check (status in ('new', 'duplicate', 'imported', 'skipped', 'error')),
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  budget_id uuid not null references public.budgets (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  current_monthly numeric(14, 2) not null default 0,
  target_monthly numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, category_id)
);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_id uuid references public.entities (id) on delete set null,
  name text not null,
  kind text not null default 'credit_card' check (kind in ('credit_card', 'loan', 'other')),
  account_id uuid references public.accounts (id) on delete set null,
  lender_contact_id uuid references public.contacts (id) on delete set null,
  current_balance numeric(14, 2) not null default 0,
  balance_as_of date default current_date,
  apr numeric(7, 3) not null default 0,
  minimum_payment numeric(14, 2) not null default 0,
  due_day int check (due_day between 1 and 31),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id uuid not null references public.debts (id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric(14, 2) not null,
  transaction_id uuid references public.transactions (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.funding_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  giver_name text not null,
  is_pseudonym boolean not null default false,
  contact_id uuid references public.contacts (id) on delete set null,
  entity_id uuid references public.entities (id) on delete set null,
  kind text not null default 'loan' check (kind in ('loan', 'gift', 'investment')),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'received', 'declined', 'repaid')),
  amount numeric(14, 2) not null default 0,
  interest_rate numeric(7, 3) not null default 0,
  term_months int,
  start_date date,
  repayment_frequency text not null default 'monthly' check (repayment_frequency in ('monthly', 'quarterly', 'annually', 'lump_sum', 'none')),
  conditions text,
  received_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.repayment_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  funding_source_id uuid not null references public.funding_sources (id) on delete cascade,
  due_date date not null,
  amount_due numeric(14, 2) not null,
  principal numeric(14, 2) not null default 0,
  interest numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  paid_on date,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.repayment_schedules (funding_source_id, due_date);

create table public.reduction_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  transaction_id uuid references public.transactions (id) on delete set null,
  recurring_series_id uuid references public.recurring_series (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  suggestions jsonb not null default '[]',
  chosen_suggestion text,
  deadline date,
  projected_monthly_savings numeric(14, 2) not null default 0,
  actual_monthly_savings numeric(14, 2),
  status text not null default 'chosen' check (status in ('chosen', 'in_progress', 'completed', 'dropped')),
  completed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.savings_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'custom' check (kind in ('emergency_fund', 'retirement', 'custom')),
  target_amount numeric(14, 2),
  target_date date,
  account_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Latest balance per account (calculated, never typed).
create view public.account_current_balances with (security_invoker = true) as
select distinct on (b.account_id)
  b.account_id, b.owner_id, b.balance, b.as_of, b.source
from public.account_balances b
order by b.account_id, b.as_of desc, b.created_at desc;

-- Spending and income per category per month (transfers excluded).
create view public.monthly_category_totals with (security_invoker = true) as
select
  t.owner_id,
  date_trunc('month', t.date)::date as month,
  t.category_id,
  sum(case when t.amount < 0 then -t.amount else 0 end) as spent,
  sum(case when t.amount > 0 then t.amount else 0 end) as received,
  count(*) as transaction_count
from public.transactions t
where not t.is_transfer
group by t.owner_id, date_trunc('month', t.date), t.category_id;

-- ===== supabase/migrations/0004_plan_opportunities.sql =====
-- 0004: Plan (initiatives, goals, milestones, conditions, scenarios, decisions) and Opportunities.

create table public.initiatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  initiative_id uuid references public.initiatives (id) on delete set null,
  title text not null,
  metric_key text,
  comparison text not null default 'gte' check (comparison in ('gte', 'lte')),
  target_value numeric,
  deadline date,
  status text not null default 'active' check (status in ('active', 'met', 'missed', 'dropped')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  title text not null,
  completion_test text not null,
  target_value numeric,
  current_value numeric,
  due_date date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'met', 'missed')),
  proof_type text not null default 'number' check (proof_type in ('document', 'number', 'link')),
  proof_value text,
  next_milestone_id uuid references public.milestones (id) on delete set null,
  met_on date,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Options written in advance for when a milestone is missed.
create table public.milestone_options (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  label text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rule: metric + operator + threshold + actions.
-- actions is a list such as:
--   [{"type":"create_task","title":"Start active job search"},
--    {"type":"create_alert","message":"Runway is under 6 months"},
--    {"type":"open_decision","title":"Continue search or accept a job","options":["Continue the search","Accept a job"]}]
create table public.decision_conditions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  initiative_id uuid references public.initiatives (id) on delete set null,
  name text not null,
  metric_key text not null,
  metric_params jsonb not null default '{}',
  operator text not null check (operator in ('lt', 'lte', 'gt', 'gte', 'eq', 'neq')),
  threshold numeric not null,
  check_from date,
  actions jsonb not null default '[]',
  is_active boolean not null default true,
  currently_met boolean not null default false,
  last_value numeric,
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  initiative_id uuid references public.initiatives (id) on delete set null,
  title text not null,
  context text,
  status text not null default 'open' check (status in ('open', 'decided')),
  source text not null default 'manual' check (source in ('manual', 'milestone', 'decision_condition', 'missed_commitment', 'ai')),
  source_id uuid,
  due_date date,
  decided_on date,
  chosen_option_id uuid,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decision_options (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  decision_id uuid not null references public.decisions (id) on delete cascade,
  label text not null,
  description text,
  numbers text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  kind text not null default 'general' check (kind in ('general', 'job_vs_acquisition')),
  horizon_months int not null default 60 check (horizon_months between 1 and 480),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each row overrides one input (by inputs.key) or one baseline figure (example: 'monthly_spending').
create table public.scenario_input_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scenario_id uuid not null references public.scenarios (id) on delete cascade,
  key text not null,
  value_number numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, key)
);

-- Opportunities: one shared pipeline system.
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  initiative_id uuid references public.initiatives (id) on delete set null,
  name text not null,
  kind text not null default 'other' check (kind in ('acquisition', 'job', 'investor', 'cofounder', 'other')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  name text not null,
  position int not null default 0,
  outcome text not null default 'open' check (outcome in ('open', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, name)
);

create table public.pipeline_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  stage_id uuid references public.pipeline_stages (id) on delete set null,
  name text not null,
  organization_id uuid references public.organizations (id) on delete set null,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  next_action text,
  next_action_due date,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  source text,
  stage_entered_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.pipeline_items (pipeline_id, stage_id);
create index on public.pipeline_items (next_action_due);

create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.pipeline_items (id) on delete cascade,
  stage_id uuid references public.pipeline_stages (id) on delete set null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz
);
create index on public.stage_history (item_id, entered_at);

create or replace function public.track_stage_history()
returns trigger
language plpgsql
as $$
declare
  v_outcome text;
begin
  if tg_op = 'INSERT' then
    insert into public.stage_history (owner_id, item_id, stage_id, entered_at)
    values (new.owner_id, new.id, new.stage_id, now());
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    update public.stage_history set exited_at = now()
      where item_id = new.id and exited_at is null;
    insert into public.stage_history (owner_id, item_id, stage_id, entered_at)
    values (new.owner_id, new.id, new.stage_id, now());
  end if;
  return new;
end;
$$;

create or replace function public.before_pipeline_item()
returns trigger
language plpgsql
as $$
declare
  v_outcome text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at = now();
    select outcome into v_outcome from public.pipeline_stages where id = new.stage_id;
    if v_outcome is not null then
      new.status = v_outcome;
    end if;
  end if;
  return new;
end;
$$;

create trigger pipeline_items_before before insert or update on public.pipeline_items
  for each row execute function public.before_pipeline_item();
create trigger pipeline_items_stage_history after insert or update on public.pipeline_items
  for each row execute function public.track_stage_history();

-- Acquisition items: financials and Bram's equity terms.
create table public.deal_financials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null unique references public.pipeline_items (id) on delete cascade,
  asking_price numeric(14, 2),
  revenue numeric(14, 2),
  ebitda numeric(14, 2),
  sde numeric(14, 2),
  financing_structure text,
  salary numeric(14, 2),
  equity_pct numeric(7, 3),
  vesting_terms text,
  earn_out_terms text,
  profit_share_terms text,
  scenario_id uuid references public.scenarios (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.diligence_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.pipeline_items (id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  due_date date,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_details (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null unique references public.pipeline_items (id) on delete cascade,
  salary numeric(14, 2),
  bonus numeric(14, 2),
  benefits text,
  equity_notes text,
  scenario_id uuid references public.scenarios (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.investor_details (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null unique references public.pipeline_items (id) on delete cascade,
  amount_discussed numeric(14, 2),
  amount_committed numeric(14, 2),
  terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Multiple (asking price divided by EBITDA) is calculated here, never typed.
create view public.deal_financials_calculated with (security_invoker = true) as
select f.*,
  case when f.ebitda is not null and f.ebitda <> 0 then round(f.asking_price / f.ebitda, 2) end as ebitda_multiple,
  case when f.sde is not null and f.sde <> 0 then round(f.asking_price / f.sde, 2) end as sde_multiple
from public.deal_financials f;

-- ===== supabase/migrations/0005_productivity_accountability_ai_integrations.sql =====
-- 0005: Productivity, Accountability, AI, and connections.

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly', 'quarterly')),
  weekday int check (weekday between 0 and 6),          -- weekly: 0 = Sunday
  day_of_month int check (day_of_month between 1 and 28), -- monthly and quarterly
  initiative_id uuid references public.initiatives (id) on delete set null,
  is_commitment boolean not null default false,
  is_active boolean not null default true,
  last_generated_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'done', 'skipped')),
  priority int not null default 2 check (priority between 1 and 3), -- 1 high, 2 normal, 3 low
  initiative_id uuid references public.initiatives (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  milestone_id uuid references public.milestones (id) on delete set null,
  pipeline_item_id uuid references public.pipeline_items (id) on delete set null,
  related_type text,
  related_id uuid,
  template_id uuid references public.task_templates (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'template', 'pipeline', 'milestone', 'decision_condition', 'follow_up', 'connection', 'review', 'ai', 'partner_report', 'missed_commitment')),
  source_key text,
  completed_at timestamptz,
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tasks_source_key on public.tasks (owner_id, source_key) where source_key is not null;
create index on public.tasks (owner_id, due_date, status);
create index on public.tasks (related_type, related_id);

create or replace function public.task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;
create trigger tasks_completed_at before insert or update on public.tasks
  for each row execute function public.task_completed_at();

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  google_event_id text,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'time_block' check (kind in ('time_block', 'review', 'follow_up', 'meeting')),
  task_id uuid references public.tasks (id) on delete set null,
  review_kind text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index calendar_events_dedupe on public.calendar_events (owner_id, dedupe_key) where dedupe_key is not null;

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_date date not null,
  content text not null,
  generated_by text not null default 'template' check (generated_by in ('ai', 'template')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, plan_date)
);

-- Accountability
create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  record_type text not null check (record_type in ('tasks', 'milestones', 'goals')),
  record_id uuid not null,
  due_date date not null,
  original_due_date date,
  status text not null default 'open' check (status in ('open', 'met', 'missed', 'closed_by_decision')),
  met_on date,
  miss_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, record_type, record_id)
);

create table public.missed_commitments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  missed_on date not null,
  reason text,
  resolution text not null default 'pending' check (resolution in ('pending', 'new_date', 'decision')),
  new_due_date date,
  decision_id uuid references public.decisions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commitment_id, missed_on)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly', 'monthly', 'quarterly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  ai_draft text,
  draft_source text not null default 'template' check (draft_source in ('ai', 'template')),
  data_snapshot jsonb not null default '{}',
  answers jsonb not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind, period_start)
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  is_pseudonym boolean not null default false,
  contact_id uuid references public.contacts (id) on delete set null,
  email text,
  phone text,
  mailing_address text,
  sections text[] not null default '{runway,milestones,commitments}',
  schedule text not null default 'weekly' check (schedule in ('weekly', 'biweekly', 'monthly')),
  delivery_methods text[] not null default '{email}',
  auto_send boolean not null default false,
  next_report_on date,
  funding_source_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private links. Only a hash of the token is used for lookups.
-- token_encrypted lets the app show the link again or include it in an email draft.
create table public.partner_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  token_hash text not null unique,
  token_encrypted text,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.partner_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  snapshot jsonb not null default '{}',
  summary text,
  summary_source text not null default 'template' check (summary_source in ('ai', 'template', 'owner')),
  finalized_at timestamptz,
  delivered_via text[] not null default '{}',
  gmail_draft_id text,
  reviewed_at timestamptz,
  partner_comment text,
  comment_at timestamptz,
  call_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A finalized report never changes. Only delivery details and the partner's optional responses can be recorded.
create or replace function public.protect_finalized_report()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' then
      raise exception 'A finalized partner report cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'finalized' then
    if new.snapshot is distinct from old.snapshot
       or new.summary is distinct from old.summary
       or new.status is distinct from old.status
       or new.partner_id is distinct from old.partner_id
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.finalized_at is distinct from old.finalized_at then
      raise exception 'A finalized partner report cannot be changed';
    end if;
  end if;
  return new;
end;
$$;
create trigger partner_reports_protect before update or delete on public.partner_reports
  for each row execute function public.protect_finalized_report();

-- AI
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  page_path text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index on public.ai_messages (conversation_id, created_at);

create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  table_name text not null,
  action text not null check (action in ('create', 'update')),
  record_id uuid,
  payload jsonb not null default '{}',
  summary text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  group_id uuid,
  source text not null default 'chat' check (source in ('chat', 'category_suggestion', 'reduction_suggestion', 'review', 'other')),
  conversation_id uuid references public.ai_conversations (id) on delete set null,
  result_record_id uuid,
  error text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_proposals (owner_id, status, created_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index on public.ai_usage (owner_id, created_at desc);

-- Connections
create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  google_email text,
  refresh_token_enc text,
  scopes text,
  status text not null default 'disconnected' check (status in ('connected', 'error', 'disconnected')),
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null unique,
  institution_name text,
  access_token_enc text not null,
  sync_cursor text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== supabase/migrations/0006_security_logging_proposals.sql =====
-- 0006: Row Level Security on every table, change log, updated_at triggers,
-- AI proposal approval function, and the single-owner rule.

-- True when the account still exists (used to skip logging while an account is being deleted).
create or replace function public.owner_exists(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from auth.users where id = p_owner)
$$;

-- Change log: one row per changed field, with old value, new value, and actor.
create or replace function public.log_change()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
  k text;
  v_actor text := public.current_actor();
  secret_fields text[] := array['refresh_token_enc', 'access_token_enc', 'token_hash', 'token_encrypted', 'sync_cursor'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - secret_fields;
    insert into public.change_log (owner_id, table_name, record_id, action, new_value, actor)
    values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'insert', v_new, v_actor);
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - secret_fields;
    v_new := to_jsonb(new) - secret_fields;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_old -> k) is distinct from (v_new -> k) then
        insert into public.change_log (owner_id, table_name, record_id, action, field, old_value, new_value, actor)
        values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'update', k, v_old -> k, v_new -> k, v_actor);
      end if;
    end loop;
    return new;
  else
    -- Skip when the owner account itself is being deleted.
    if public.owner_exists(old.owner_id) then
      v_old := to_jsonb(old) - secret_fields;
      insert into public.change_log (owner_id, table_name, record_id, action, old_value, actor)
      values (old.owner_id, tg_table_name, (v_old ->> 'id')::uuid, 'delete', v_old, v_actor);
    end if;
    return old;
  end if;
end;
$$;

-- Apply RLS, updated_at, and change log to every table that has owner_id.
do $$
declare
  t record;
  no_log text[] := array['change_log', 'input_history', 'stage_history', 'ai_messages', 'ai_usage', 'raw_import_rows', 'daily_plans'];
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'owner_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format(
      'create policy owner_only on public.%I for all to authenticated using (public.is_owner(owner_id)) with check (public.is_owner(owner_id))',
      t.table_name
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.table_name);
    execute format('grant all on public.%I to service_role', t.table_name);
    execute format('revoke all on public.%I from anon', t.table_name);

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t.table_name and column_name = 'updated_at') then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t.table_name);
    end if;

    if not (t.table_name = any (no_log)) then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t.table_name);
    end if;
  end loop;
end $$;

grant select on public.account_current_balances, public.monthly_category_totals, public.deal_financials_calculated to authenticated, service_role;
revoke all on public.account_current_balances, public.monthly_category_totals, public.deal_financials_calculated from anon;

-- AI proposals: the AI never writes records. Bram approves a proposal, and this function applies it
-- inside one transaction, marking the change log actor as 'ai'. Runs with Bram's permissions (RLS applies).
create or replace function public.apply_proposal(p_id uuid, p_overrides jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  p public.ai_proposals;
  v_payload jsonb;
  v_cols text;
  v_id uuid;
  blocked text[] := array['ai_proposals', 'ai_usage', 'ai_messages', 'ai_conversations', 'change_log', 'input_history',
                          'google_connections', 'plaid_items', 'partner_links', 'partner_reports', 'owner_profile', 'stage_history'];
begin
  select * into p from public.ai_proposals where id = p_id for update;
  if not found then
    raise exception 'Proposal not found';
  end if;
  if p.status <> 'pending' then
    raise exception 'Proposal is no longer pending';
  end if;
  if p.table_name = any (blocked) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p.table_name and column_name = 'owner_id'
  ) then
    raise exception 'Proposals cannot change table %', p.table_name;
  end if;

  v_payload := (p.payload || coalesce(p_overrides, '{}'::jsonb)) - 'id' - 'owner_id' - 'created_at' - 'updated_at';

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p.table_name and v_payload ? c.column_name;

  if v_cols is null then
    raise exception 'Proposal has no valid fields';
  end if;

  perform set_config('app.actor', 'ai', true);

  if p.action = 'create' then
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
      p.table_name, v_cols, v_cols, p.table_name
    ) into v_id using v_payload;
  else
    execute format(
      'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 returning id',
      p.table_name, v_cols, v_cols, p.table_name
    ) into v_id using v_payload, p.record_id;
    if v_id is null then
      raise exception 'Record to update was not found';
    end if;
  end if;

  perform set_config('app.actor', '', true);

  update public.ai_proposals
     set status = 'approved', decided_at = now(), result_record_id = v_id, error = null
   where id = p_id;

  -- Approving one option of a group (example: one of 3 reduction suggestions) rejects the others.
  if p.group_id is not null then
    update public.ai_proposals
       set status = 'rejected', decided_at = now()
     where group_id = p.group_id and id <> p_id and status = 'pending';
  end if;

  return v_id;
end;
$$;

grant execute on function public.apply_proposal(uuid, jsonb) to authenticated;
revoke execute on function public.apply_proposal(uuid, jsonb) from anon;

-- ===== supabase/migrations/0007_owner_setup_and_default_configuration.sql =====
-- 0007: single-owner rule, default configuration for the owner, and the documents storage bucket.
-- The default configuration is settings and lists (initiatives, pipelines, stages, categories, inputs),
-- not personal data.

create or replace function public.seed_owner_defaults(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_init_pf uuid; v_init_acq uuid; v_init_emp uuid; v_init_ros uuid; v_init_oth uuid;
  v_pipe uuid;
  v_budget uuid;
begin
  -- Entities
  insert into entities (owner_id, name, kind, is_default) values
    (p_owner, 'Personal', 'personal', true),
    (p_owner, 'Cyan Arc LLC', 'business', false)
  on conflict do nothing;

  -- Inputs and Assumptions (every changeable number)
  insert into inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'runway_target_months', 'Runway target', 'Runway', 'months', 12, null, 'Number of months of cash you want available. Home compares runway to this number.', 10),
    (p_owner, 'runway_lookback_months', 'Months of history used for averages', 'Runway', 'months', 3, null, 'Runway uses average monthly spending and income over this many past months.', 20),
    (p_owner, 'runway_subtract_income', 'Subtract average income in runway (1 = yes, 0 = no)', 'Runway', 'boolean', 1, null, 'Default formula: available cash divided by (average monthly spending minus average monthly income).', 30),
    (p_owner, 'runway_include_business_cash', 'Count Cyan Arc LLC cash in runway (1 = yes, 0 = no)', 'Runway', 'boolean', 0, null, 'When 0, only Personal accounts count as available cash and spending.', 40),
    (p_owner, 'acquisition_search_months_allowed', 'Months allowed for the acquisition search', 'Acquisition', 'months', 12, null, 'Months allowed before a continue-or-stop decision is required.', 50),
    (p_owner, 'acquisition_search_start_date', 'Acquisition search start date', 'Acquisition', 'date', null, null, 'Used with the months allowed to calculate the decision date.', 60),
    (p_owner, 'emergency_fund_months', 'Emergency fund target (months of spending)', 'Savings', 'months', 6, null, 'Emergency fund target = this number times average monthly spending.', 70),
    (p_owner, 'retirement_annual_spending', 'Yearly spending in retirement', 'Savings', 'usd', 80000, null, 'Retirement target = yearly spending divided by the withdrawal rate.', 80),
    (p_owner, 'withdrawal_rate_pct', 'Withdrawal rate', 'Savings', 'percent', 4, null, 'Share of the retirement balance withdrawn each year.', 90),
    (p_owner, 'current_age', 'Current age', 'Savings', 'years', null, null, 'Needed for required monthly retirement savings.', 100),
    (p_owner, 'retirement_age', 'Retirement age', 'Savings', 'years', 65, null, 'Age at which the retirement target should be reached.', 110),
    (p_owner, 'expected_annual_return_pct', 'Expected yearly investment return', 'Savings', 'percent', 6, null, 'Used for required monthly savings and scenario projections.', 120),
    (p_owner, 'debt_extra_monthly_payment', 'Extra monthly debt payment', 'Debt', 'usd', 0, null, 'Paid on top of minimum payments, to the debt first in the payoff order.', 130),
    (p_owner, 'debt_payoff_method', 'Debt payoff order', 'Debt', 'text', null, 'avalanche', 'avalanche = highest interest first. snowball = smallest balance first.', 140),
    (p_owner, 'monthly_spending_target', 'Monthly spending target', 'Budget', 'usd', null, null, 'Target total monthly spending.', 150),
    (p_owner, 'job_salary', 'Job: yearly salary', 'Job vs acquisition', 'usd', null, null, 'Used in the job vs acquisition comparison.', 160),
    (p_owner, 'job_bonus', 'Job: yearly bonus', 'Job vs acquisition', 'usd', null, null, null, 170),
    (p_owner, 'acquisition_salary', 'Acquisition: yearly salary', 'Job vs acquisition', 'usd', null, null, 'Salary paid to you by the acquired business.', 180),
    (p_owner, 'acquisition_equity_pct', 'Acquisition: your equity share', 'Job vs acquisition', 'percent', null, null, 'Your ownership share of the acquired business.', 190),
    (p_owner, 'acquisition_business_value', 'Acquisition: business value at purchase', 'Job vs acquisition', 'usd', null, null, 'Usually the purchase price.', 200),
    (p_owner, 'acquisition_debt', 'Acquisition: purchase debt', 'Job vs acquisition', 'usd', null, null, 'Debt used to buy the business. Subtracted from business value for equity value.', 210),
    (p_owner, 'acquisition_debt_years', 'Acquisition: years to repay purchase debt', 'Job vs acquisition', 'years', 10, null, null, 220),
    (p_owner, 'acquisition_value_growth_pct', 'Acquisition: yearly growth in business value', 'Job vs acquisition', 'percent', 3, null, null, 230),
    (p_owner, 'effective_tax_rate_pct', 'Effective tax rate on salary', 'Job vs acquisition', 'percent', 30, null, 'Used to convert salary to take-home pay in projections.', 240),
    (p_owner, 'comparison_years', 'Years compared', 'Job vs acquisition', 'years', 10, null, null, 250),
    (p_owner, 'ai_monthly_cap_usd', 'AI monthly spending cap', 'AI', 'usd', 25, null, 'AI requests stop once this amount is spent in the month. The AI_MONTHLY_CAP_USD setting on the server is the upper limit.', 260),
    (p_owner, 'time_block_minutes', 'Calendar time block length', 'Productivity', 'number', 60, null, 'Minutes per time block added to Google Calendar for priority tasks.', 270),
    (p_owner, 'time_blocks_per_day', 'Calendar time blocks per day', 'Productivity', 'number', 2, null, 'Number of priority tasks that get a time block each morning.', 280)
  on conflict do nothing;

  -- Categories
  insert into categories (owner_id, name, kind, is_software, is_essential) values
    (p_owner, 'Housing', 'expense', false, true),
    (p_owner, 'Utilities', 'expense', false, true),
    (p_owner, 'Phone and Internet', 'expense', false, true),
    (p_owner, 'Groceries', 'expense', false, true),
    (p_owner, 'Dining', 'expense', false, false),
    (p_owner, 'Transportation', 'expense', false, true),
    (p_owner, 'Insurance', 'expense', false, true),
    (p_owner, 'Health', 'expense', false, true),
    (p_owner, 'Storage', 'expense', false, false),
    (p_owner, 'Software and Subscriptions', 'expense', true, false),
    (p_owner, 'Entertainment', 'expense', false, false),
    (p_owner, 'Shopping', 'expense', false, false),
    (p_owner, 'Travel', 'expense', false, false),
    (p_owner, 'Fees and Interest', 'expense', false, false),
    (p_owner, 'Professional Services', 'expense', false, false),
    (p_owner, 'Taxes', 'expense', false, true),
    (p_owner, 'Gifts and Donations', 'expense', false, false),
    (p_owner, 'Other Expense', 'expense', false, false),
    (p_owner, 'Salary', 'income', false, false),
    (p_owner, 'Consulting Income', 'income', false, false),
    (p_owner, 'Other Income', 'income', false, false),
    (p_owner, 'Transfer', 'transfer', false, false),
    (p_owner, 'Credit Card Payment', 'transfer', false, false)
  on conflict do nothing;

  -- Initiatives
  insert into initiatives (owner_id, name, description, sort_order) values
    (p_owner, 'Personal Finance', 'Expense reduction, debt payoff, and savings.', 1) returning id into v_init_pf;
  insert into initiatives (owner_id, name, description, sort_order) values
    (p_owner, 'Acquisition Search', 'Buy a small business (salary plus equity).', 2) returning id into v_init_acq;
  insert into initiatives (owner_id, name, description, sort_order) values
    (p_owner, 'Employment', 'Job opportunities, compared against the acquisition path.', 3) returning id into v_init_emp;
  insert into initiatives (owner_id, name, description, sort_order) values
    (p_owner, 'Rosara', 'Co-founder search and investor outreach for Rosara.', 4) returning id into v_init_ros;
  insert into initiatives (owner_id, name, description, sort_order) values
    (p_owner, 'Other Income', 'Consulting and other income opportunities.', 5) returning id into v_init_oth;

  -- Pipelines and default stages
  insert into pipelines (owner_id, initiative_id, name, kind, sort_order) values
    (p_owner, v_init_acq, 'Acquisitions', 'acquisition', 1) returning id into v_pipe;
  insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
    (p_owner, v_pipe, 'Sourced', 1, 'open'), (p_owner, v_pipe, 'Screened', 2, 'open'),
    (p_owner, v_pipe, 'NDA signed', 3, 'open'), (p_owner, v_pipe, 'CIM reviewed', 4, 'open'),
    (p_owner, v_pipe, 'IOI sent', 5, 'open'), (p_owner, v_pipe, 'LOI signed', 6, 'open'),
    (p_owner, v_pipe, 'Diligence', 7, 'open'), (p_owner, v_pipe, 'Closed', 8, 'won'),
    (p_owner, v_pipe, 'Passed', 9, 'lost');

  insert into pipelines (owner_id, initiative_id, name, kind, sort_order) values
    (p_owner, v_init_emp, 'Jobs', 'job', 2) returning id into v_pipe;
  insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
    (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Applied', 2, 'open'),
    (p_owner, v_pipe, 'Interviewing', 3, 'open'), (p_owner, v_pipe, 'Offer', 4, 'open'),
    (p_owner, v_pipe, 'Accepted', 5, 'won'), (p_owner, v_pipe, 'Declined', 6, 'lost');

  insert into pipelines (owner_id, initiative_id, name, kind, sort_order) values
    (p_owner, v_init_ros, 'Rosara Co-founder Search', 'cofounder', 3) returning id into v_pipe;
  insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
    (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Contacted', 2, 'open'),
    (p_owner, v_pipe, 'First call', 3, 'open'), (p_owner, v_pipe, 'Working session', 4, 'open'),
    (p_owner, v_pipe, 'Terms discussed', 5, 'open'), (p_owner, v_pipe, 'Signed', 6, 'won'),
    (p_owner, v_pipe, 'Passed', 7, 'lost');

  insert into pipelines (owner_id, initiative_id, name, kind, sort_order) values
    (p_owner, v_init_ros, 'Rosara Investor Outreach', 'investor', 4) returning id into v_pipe;
  insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
    (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Contacted', 2, 'open'),
    (p_owner, v_pipe, 'Meeting', 3, 'open'), (p_owner, v_pipe, 'Materials sent', 4, 'open'),
    (p_owner, v_pipe, 'Committed', 5, 'won'), (p_owner, v_pipe, 'Passed', 6, 'lost');

  insert into pipelines (owner_id, initiative_id, name, kind, sort_order) values
    (p_owner, v_init_oth, 'Other Income Opportunities', 'other', 5) returning id into v_pipe;
  insert into pipeline_stages (owner_id, pipeline_id, name, position, outcome) values
    (p_owner, v_pipe, 'Identified', 1, 'open'), (p_owner, v_pipe, 'Evaluating', 2, 'open'),
    (p_owner, v_pipe, 'Pursuing', 3, 'open'), (p_owner, v_pipe, 'Active', 4, 'won'),
    (p_owner, v_pipe, 'Dropped', 5, 'lost');

  -- Recurring task templates (examples from the architecture)
  insert into task_templates (owner_id, title, cadence, weekday, day_of_month, initiative_id, is_commitment) values
    (p_owner, 'Import or enter transactions', 'daily', null, null, v_init_pf, false),
    (p_owner, 'Categorize new transactions', 'daily', null, null, v_init_pf, false),
    (p_owner, 'Complete today''s pipeline actions', 'daily', null, null, null, false),
    (p_owner, 'Complete the daily close', 'daily', null, null, null, true),
    (p_owner, 'Complete the weekly review', 'weekly', 0, null, null, true),
    (p_owner, 'Complete the monthly review', 'monthly', null, 1, null, true),
    (p_owner, 'Download the full data export (Settings, Export)', 'monthly', null, 1, null, true),
    (p_owner, 'Complete the quarterly review', 'quarterly', null, 1, null, true),
    (p_owner, 'Review and update Inputs and Assumptions', 'quarterly', null, 1, null, false);

  -- Example decision condition from the architecture
  insert into decision_conditions (owner_id, initiative_id, name, metric_key, operator, threshold, actions) values
    (p_owner, v_init_pf, 'Runway under 6 months', 'runway_months', 'lt', 6,
     '[{"type":"create_task","title":"Start active job search"},{"type":"create_alert","message":"Runway is under 6 months."}]'::jsonb);

  -- Budget container and calculated savings targets
  insert into budgets (owner_id, name) values (p_owner, 'Monthly budget') returning id into v_budget;
  insert into savings_targets (owner_id, name, kind) values
    (p_owner, 'Emergency fund', 'emergency_fund'),
    (p_owner, 'Retirement', 'retirement');
end;
$$;

revoke execute on function public.seed_owner_defaults(uuid) from public, anon, authenticated;

-- Only one account can ever exist in this app.
create or replace function public.enforce_single_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if exists (select 1 from auth.users where id <> new.id) then
    raise exception 'This app allows one owner account only.';
  end if;
  return new;
end;
$$;

create trigger enforce_single_owner before insert on auth.users
  for each row execute function public.enforce_single_owner();

create or replace function public.handle_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.owner_profile (owner_id) values (new.id) on conflict do nothing;
  perform public.seed_owner_defaults(new.id);
  return new;
end;
$$;

create trigger on_owner_created after insert on auth.users
  for each row execute function public.handle_new_owner();

-- Documents bucket (private). Files are stored under <owner id>/<record type>/<file>.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
    on conflict (id) do nothing;

    execute $p$
      create policy "owner documents read" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
    $p$;
    execute $p$
      create policy "owner documents insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
    $p$;
    execute $p$
      create policy "owner documents delete" on storage.objects for delete to authenticated
      using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
    $p$;
  end if;
end $$;

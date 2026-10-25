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

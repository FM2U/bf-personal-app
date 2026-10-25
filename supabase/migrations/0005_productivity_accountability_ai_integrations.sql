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

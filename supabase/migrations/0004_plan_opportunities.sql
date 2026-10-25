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

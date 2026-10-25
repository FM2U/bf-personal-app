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

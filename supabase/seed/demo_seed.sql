-- DEMO DATA FOR TESTING ONLY. Every name, amount, and company here is made up.
-- Not applied by the migrations. Run it only in a test project, after the owner account exists:
--   psql "$DATABASE_URL" -f supabase/seed/demo_seed.sql
-- It uses the single owner account in auth.users.

do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
  personal uuid;
  llc uuid;
  chk uuid; sav uuid; card uuid; llc_chk uuid; ira uuid;
  cat_housing uuid; cat_groceries uuid; cat_dining uuid; cat_software uuid; cat_storage uuid; cat_salary uuid; cat_consult uuid; cat_utilities uuid; cat_transport uuid;
  budget uuid;
  debt_card uuid; debt_loan uuid;
  fund uuid;
  org_broker uuid; org_employer uuid; c_broker uuid; c_lender uuid; c_partner uuid;
  p_acq uuid; p_jobs uuid; p_inv uuid;
  s uuid;
  item uuid; item2 uuid; item3 uuid;
  init_acq uuid; init_pf uuid;
  g1 uuid; g2 uuid; m1 uuid; m2 uuid; t1 uuid;
  partner uuid;
  sc uuid;
  m int;
  d date;
begin
  if o is null then raise exception 'Create the owner account first'; end if;
  select id into personal from entities where owner_id = o and kind = 'personal' limit 1;
  select id into llc from entities where owner_id = o and kind = 'business' limit 1;
  select id into cat_housing from categories where owner_id = o and name = 'Housing';
  select id into cat_groceries from categories where owner_id = o and name = 'Groceries';
  select id into cat_dining from categories where owner_id = o and name = 'Dining';
  select id into cat_software from categories where owner_id = o and name = 'Software and Subscriptions';
  select id into cat_storage from categories where owner_id = o and name = 'Storage';
  select id into cat_salary from categories where owner_id = o and name = 'Salary';
  select id into cat_consult from categories where owner_id = o and name = 'Consulting Income';
  select id into cat_utilities from categories where owner_id = o and name = 'Utilities';
  select id into cat_transport from categories where owner_id = o and name = 'Transportation';
  select id into init_acq from initiatives where owner_id = o and name = 'Acquisition Search';
  select id into init_pf from initiatives where owner_id = o and name = 'Personal Finance';

  update inputs set value_number = 41 where owner_id = o and key = 'current_age';
  update inputs set value_number = 150000 where owner_id = o and key = 'job_salary';
  update inputs set value_number = 20000 where owner_id = o and key = 'job_bonus';
  update inputs set value_number = 130000 where owner_id = o and key = 'acquisition_salary';
  update inputs set value_number = 25 where owner_id = o and key = 'acquisition_equity_pct';
  update inputs set value_number = 4000000 where owner_id = o and key = 'acquisition_business_value';
  update inputs set value_number = 3000000 where owner_id = o and key = 'acquisition_debt';
  update inputs set value_text = (current_date - 60)::text where owner_id = o and key = 'acquisition_search_start_date';
  update inputs set value_number = 200 where owner_id = o and key = 'debt_extra_monthly_payment';

  insert into accounts (owner_id, entity_id, name, institution, kind, last4) values (o, personal, 'Demo Checking', 'Example Bank', 'checking', '1111') returning id into chk;
  insert into accounts (owner_id, entity_id, name, institution, kind, last4, is_emergency_fund) values (o, personal, 'Demo Savings', 'Example Bank', 'savings', '2222', true) returning id into sav;
  insert into accounts (owner_id, entity_id, name, institution, kind, last4) values (o, personal, 'Demo Rewards Card', 'Sample Card Co', 'credit_card', '3333') returning id into card;
  insert into accounts (owner_id, entity_id, name, institution, kind, last4) values (o, llc, 'Demo LLC Operating', 'Example Bank', 'checking', '4444') returning id into llc_chk;
  insert into accounts (owner_id, entity_id, name, institution, kind) values (o, personal, 'Demo IRA', 'Sample Brokerage', 'retirement') returning id into ira;

  for m in 1..5 loop
    d := (date_trunc('month', current_date) - (m || ' months')::interval)::date;
    insert into account_balances (owner_id, account_id, as_of, balance) values
      (o, chk, d + 27, 18000 + m * 3100), (o, sav, d + 27, 12000 + m * 400), (o, card, d + 27, 3200 + m * 150),
      (o, llc_chk, d + 27, 6000 + m * 500), (o, ira, d + 27, 145000 - m * 1200);
  end loop;
  insert into account_balances (owner_id, account_id, as_of, balance) values (o, chk, current_date, 17250), (o, sav, current_date, 12000), (o, card, current_date, 3050), (o, ira, current_date, 146200);

  for m in 1..4 loop
    d := (date_trunc('month', current_date) - (m || ' months')::interval)::date;
    insert into transactions (owner_id, account_id, date, amount, description, merchant_name, category_id, source, dedupe_hash) values
      (o, chk, d + 0, -2850, 'DEMO APARTMENTS RENT', 'Demo Apartments', cat_housing, 'manual', md5('rent' || d)),
      (o, chk, d + 4, -185.40, 'EXAMPLE POWER CO', 'Example Power', cat_utilities, 'manual', md5('power' || d)),
      (o, card, d + 2, -15.99, 'NETFLIX.COM', 'Netflix', cat_software, 'manual', md5('nflx' || d)),
      (o, card, d + 9, -54.99, 'ADOBE CREATIVE CLOUD', 'Adobe', cat_software, 'manual', md5('adobe' || d)),
      (o, card, d + 11, -29.00, 'SAMPLE PROJECT APP SUBSCRIPTION', 'Sample Project App', cat_software, 'manual', md5('spa' || d)),
      (o, chk, d + 14, -219.00, 'PUBLIC STORAGE 0042', 'Public Storage', cat_storage, 'manual', md5('stor' || d)),
      (o, card, d + 6, -312.45, 'FRESH MARKET DEMO', 'Fresh Market Demo', cat_groceries, 'manual', md5('groc1' || d)),
      (o, card, d + 20, -287.10, 'FRESH MARKET DEMO', 'Fresh Market Demo', cat_groceries, 'manual', md5('groc2' || d)),
      (o, card, d + 12, -164.00, 'BISTRO EXAMPLE', 'Bistro Example', cat_dining, 'manual', md5('dine1' || d)),
      (o, card, d + 25, -96.50, 'TACO SAMPLE', 'Taco Sample', cat_dining, 'manual', md5('dine2' || d)),
      (o, card, d + 16, -61.20, 'GAS STATION DEMO', 'Gas Station Demo', cat_transport, 'manual', md5('gas' || d)),
      (o, chk, d + 15, 4200, 'CONSULTING CLIENT DEMO PAYMENT', 'Consulting Client Demo', cat_consult, 'manual', md5('cons' || d)),
      (o, chk, d + 18, -640, 'UNCATEGORIZED DEMO PURCHASE ' || m, 'Demo Store', null, 'manual', md5('unc' || d));
  end loop;
  insert into transactions (owner_id, account_id, date, amount, description, merchant_name, category_id, source) values
    (o, chk, current_date - 3, -88.20, 'FRESH MARKET DEMO', 'Fresh Market Demo', cat_groceries, 'manual'),
    (o, card, current_date - 2, -42.00, 'BISTRO EXAMPLE', 'Bistro Example', cat_dining, 'manual');

  select id into budget from budgets where owner_id = o limit 1;
  insert into budget_lines (owner_id, budget_id, category_id, current_monthly, target_monthly) values
    (o, budget, cat_housing, 2850, 2850), (o, budget, cat_groceries, 550, 450), (o, budget, cat_dining, 200, 120),
    (o, budget, cat_software, 90, 40), (o, budget, cat_storage, 219, 0), (o, budget, cat_utilities, 200, 180), (o, budget, cat_transport, 80, 80);

  insert into organizations (owner_id, name, kind) values (o, 'Example Business Brokers', 'broker') returning id into org_broker;
  insert into organizations (owner_id, name, kind) values (o, 'Sample Software Inc', 'employer') returning id into org_employer;
  insert into contacts (owner_id, name, roles, organization_id, email, follow_up_date, follow_up_note) values (o, 'Alex Example', '{broker}', org_broker, 'alex@example.com', current_date + 2, 'Ask for the CIM') returning id into c_broker;
  insert into contacts (owner_id, name, is_pseudonym, roles, email) values (o, 'Lender A (pseudonym)', true, '{lender}', 'lender-a@example.com') returning id into c_lender;
  insert into contacts (owner_id, name, is_pseudonym, roles, email) values (o, 'Partner One (pseudonym)', true, '{accountability_partner}', 'partner-one@example.com') returning id into c_partner;

  insert into debts (owner_id, entity_id, name, kind, account_id, current_balance, apr, minimum_payment, due_day) values (o, personal, 'Demo Rewards Card', 'credit_card', card, 3050, 24.99, 95, 12) returning id into debt_card;
  insert into debts (owner_id, entity_id, name, kind, current_balance, apr, minimum_payment, due_day, lender_contact_id) values (o, personal, 'Demo Car Loan', 'loan', 11400, 6.4, 345, 20, null) returning id into debt_loan;
  insert into debt_payments (owner_id, debt_id, paid_on, amount) values (o, debt_card, current_date - 13, 150), (o, debt_loan, current_date - 5, 345);

  insert into funding_sources (owner_id, giver_name, is_pseudonym, contact_id, entity_id, kind, status, amount, interest_rate, term_months, start_date, repayment_frequency, received_on, conditions)
  values (o, 'Lender A (pseudonym)', true, c_lender, personal, 'loan', 'received', 20000, 4, 24, current_date - 90, 'monthly', current_date - 90, 'Repay monthly. No penalty for early repayment.') returning id into fund;
  insert into repayment_schedules (owner_id, funding_source_id, due_date, amount_due, principal, interest, paid_amount, paid_on)
  select o, fund, (current_date - 90 + (n || ' months')::interval)::date, 868.50, 802, 66.50,
         case when n <= 2 then 868.50 else 0 end, case when n <= 2 then (current_date - 90 + (n || ' months')::interval)::date end
  from generate_series(1, 24) n;

  insert into income_sources (owner_id, entity_id, name, kind, expected_monthly) values (o, personal, 'Demo consulting retainer', 'consulting', 4200);

  select id into p_acq from pipelines where owner_id = o and kind = 'acquisition';
  select id into p_jobs from pipelines where owner_id = o and kind = 'job';
  select id into p_inv from pipelines where owner_id = o and kind = 'investor';
  select id into s from pipeline_stages where pipeline_id = p_acq and name = 'CIM reviewed';
  insert into pipeline_items (owner_id, pipeline_id, stage_id, name, organization_id, primary_contact_id, next_action, next_action_due)
  values (o, p_acq, s, 'Demo HVAC Services Co', org_broker, c_broker, 'Send IOI draft to broker', current_date + 1) returning id into item;
  insert into deal_financials (owner_id, item_id, asking_price, revenue, ebitda, sde, financing_structure, salary, equity_pct, vesting_terms)
  values (o, item, 3800000, 6200000, 950000, 1100000, 'SBA 7(a) loan plus seller note (example)', 130000, 25, '4 years, 1 year cliff (example)');
  insert into diligence_items (owner_id, item_id, title, is_done, sort_order) values (o, item, 'Quality of earnings review', false, 1), (o, item, 'Customer concentration check', true, 2), (o, item, 'Lease review', false, 3);
  select id into s from pipeline_stages where pipeline_id = p_acq and name = 'Screened';
  insert into pipeline_items (owner_id, pipeline_id, stage_id, name, next_action, next_action_due) values (o, p_acq, s, 'Demo Landscaping LLC', 'Request financials', current_date - 1) returning id into item2;
  insert into deal_financials (owner_id, item_id, asking_price, ebitda) values (o, item2, 1500000, 400000);
  select id into s from pipeline_stages where pipeline_id = p_jobs and name = 'Interviewing';
  insert into pipeline_items (owner_id, pipeline_id, stage_id, name, organization_id, next_action, next_action_due) values (o, p_jobs, s, 'VP Operations, Sample Software Inc', org_employer, 'Prepare for final interview', current_date + 4) returning id into item3;
  insert into job_details (owner_id, item_id, salary, bonus, benefits) values (o, item3, 150000, 20000, 'Health, 401k match (example)');
  select id into s from pipeline_stages where pipeline_id = p_inv and name = 'Meeting';
  insert into pipeline_items (owner_id, pipeline_id, stage_id, name, next_action, next_action_due) values (o, p_inv, s, 'Example Angel Fund', 'Send deck', current_date + 6) returning id into item;
  insert into investor_details (owner_id, item_id, amount_discussed) values (o, item, 100000);

  insert into goals (owner_id, initiative_id, title, metric_key, comparison, target_value, deadline) values (o, init_pf, 'Monthly spending under $5,500 by March 1, 2027', 'avg_monthly_spending', 'lte', 5500, '2027-03-01') returning id into g1;
  insert into goals (owner_id, initiative_id, title, metric_key, comparison, target_value, deadline) values (o, init_acq, 'Signed LOI by June 30, 2027', 'pipeline_items_at_or_past_stage', 'gte', 1, '2027-06-30') returning id into g2;
  insert into milestones (owner_id, goal_id, title, completion_test, target_value, due_date, status, proof_type) values (o, g2, 'Submit 3 IOIs', '3 IOIs submitted', 3, current_date + 45, 'active', 'number') returning id into m1;
  insert into milestones (owner_id, goal_id, title, completion_test, target_value, due_date, status, proof_type) values (o, g2, 'Review 10 CIMs', '10 CIMs reviewed', 10, current_date - 2, 'active', 'number') returning id into m2;
  update milestones set next_milestone_id = m1 where id = m2;
  insert into milestone_options (owner_id, milestone_id, label, sort_order) values (o, m2, 'Extend 60 days', 1), (o, m2, 'Change search criteria', 2), (o, m2, 'Start job search', 3);
  insert into milestone_options (owner_id, milestone_id, label, sort_order) values (o, m1, 'Extend 60 days', 1), (o, m1, 'Widen to adjacent industries', 2);
  insert into tasks (owner_id, title, due_date, milestone_id, initiative_id, priority) values (o, 'Draft IOI template', current_date, m1, init_acq, 1) returning id into t1;
  insert into tasks (owner_id, title, due_date, initiative_id) values (o, 'Call Lender A about early repayment', current_date - 1, init_pf), (o, 'Cancel unused storage unit', current_date + 3, init_pf);
  insert into commitments (owner_id, title, record_type, record_id, due_date, original_due_date) values (o, 'Draft IOI template', 'tasks', t1, current_date, current_date);

  insert into decision_conditions (owner_id, initiative_id, name, metric_key, metric_params, operator, threshold, check_from, actions)
  values (o, init_acq, 'No signed LOI by June 30, 2027', 'pipeline_items_at_or_past_stage', '{"pipeline":"Acquisitions","stage":"LOI signed"}', 'lt', 1, '2027-06-30',
          '[{"type":"open_decision","title":"Continue the search or accept a job","options":["Continue the search","Accept a job"]}]');

  insert into partners (owner_id, name, is_pseudonym, contact_id, email, sections, schedule, delivery_methods, next_report_on, funding_source_ids)
  values (o, 'Partner One (pseudonym)', true, c_partner, 'partner-one@example.com', '{runway,milestones,commitments,savings,loans}', 'weekly', '{email,phone}', current_date + 3, array[fund]) returning id into partner;

  insert into scenarios (owner_id, name, kind, horizon_months) values (o, 'Cut dining and storage', 'general', 36) returning id into sc;
  insert into scenario_input_changes (owner_id, scenario_id, key, value_number) values (o, sc, 'monthly_spending', 4600);
  insert into scenarios (owner_id, name, kind, horizon_months) values (o, 'Job offer vs HVAC deal', 'job_vs_acquisition', 60) returning id into sc;
  insert into scenario_input_changes (owner_id, scenario_id, key, value_number) values (o, sc, 'acquisition_value_growth_pct', 5);

  insert into reduction_actions (owner_id, title, category_id, chosen_suggestion, deadline, projected_monthly_savings, actual_monthly_savings, status, completed_on)
  values (o, 'Cancel Sample Project App', cat_software, 'Cancel the unused subscription.', current_date - 10, 29, 29, 'completed', current_date - 12),
         (o, 'Move storage items and close the unit', cat_storage, 'Sell or move items, then close the unit.', current_date + 20, 219, null, 'chosen', null);

  insert into communications (owner_id, occurred_at, method, direction, contact_id, organization_id, subject, summary)
  values (o, now() - interval '2 days', 'call', 'outgoing', c_broker, org_broker, 'Intro call about Demo HVAC Services Co', 'Broker shared the teaser. CIM to follow after NDA.');
end $$;

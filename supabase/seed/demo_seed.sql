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
  -- Acquisition stages as database update 0020 names them (Interested, NDA signed, Broker call, CIM review, ...).
  select id into s from pipeline_stages where pipeline_id = p_acq and name = 'CIM review';
  insert into pipeline_items (owner_id, pipeline_id, stage_id, name, organization_id, primary_contact_id, next_action, next_action_due)
  values (o, p_acq, s, 'Demo HVAC Services Co', org_broker, c_broker, 'Send IOI draft to broker', current_date + 1) returning id into item;
  insert into deal_financials (owner_id, item_id, asking_price, revenue, ebitda, sde, financing_structure, salary, equity_pct, vesting_terms)
  values (o, item, 3800000, 6200000, 950000, 1100000, 'SBA 7(a) loan plus seller note (example)', 130000, 25, '4 years, 1 year cliff (example)');
  insert into diligence_items (owner_id, item_id, title, is_done, sort_order) values (o, item, 'Quality of earnings review', false, 1), (o, item, 'Customer concentration check', true, 2), (o, item, 'Lease review', false, 3);
  select id into s from pipeline_stages where pipeline_id = p_acq and name = 'Interested';
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
  values (o, init_acq, 'No signed LOI by June 30, 2027', 'pipeline_items_at_or_past_stage', '{"pipeline":"Acquisitions","stage":"IOI or LOI"}', 'lt', 1, '2027-06-30',
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

-- Daily Targets and Outreach Queue demo data (needs migration 0008).
do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
  t_out uuid;
  t_calls uuid;
  t_week uuid;
  p_acq uuid;
  c record;
  d date;
  n int;
  i int;
  names text[] := array['Jordan Sample (pseudonym)', 'Casey Demo', 'Morgan Example', 'Riley Test', 'Taylor Placeholder', 'Sam Mockup', 'Jamie Fictional', 'Drew Specimen'];
  groups text[] := array['close', 'warm', 'professional', 'warm', 'close', 'professional', 'warm', null];
  last_days int[] := array[45, 70, 20, null, 31, 120, 10, 5];
  outcomes text[] := array['replied', 'no_response', 'meeting_booked', 'no_response', 'referral', 'replied', null, 'no_response'];
  cid uuid;
begin
  if o is null then raise exception 'Create the owner account first'; end if;
  if to_regclass('public.targets') is null then
    raise notice 'Skipping Daily Targets demo data: database update 0008 is not applied.';
    return;
  end if;
  select id into t_out from targets where owner_id = o and name = 'Network outreach';
  -- Count the demo history from 8 weeks ago.
  update targets set start_date = current_date - 56 where id = t_out;
  select id into p_acq from pipelines where owner_id = o and name = 'Acquisitions';
  insert into targets (owner_id, name, period, minimum_count, active_weekdays, count_source, is_commitment, show_to_partners, sort_order, start_date)
  values (o, 'Broker calls', 'day', 1, '{1,2,3,4,5}', 'manual', false, false, 2, current_date - 56) returning id into t_calls;
  insert into targets (owner_id, name, period, minimum_count, active_weekdays, count_source, pipeline_id, is_commitment, show_to_partners, sort_order, start_date)
  values (o, 'New deals sourced', 'week', 2, '{1,2,3,4,5}', 'pipeline_items_created', p_acq, true, true, 3, current_date - 84) returning id into t_week;
  update targets set show_to_partners = true where id = t_out;
  update partners set sections = array_append(sections, 'targets') where owner_id = o and not ('targets' = any (sections));

  -- Contacts with relationship groups, each with one earlier outreach message.
  for i in 1..array_length(names, 1) loop
    insert into contacts (owner_id, name, roles, email, relationship_group, notes)
    values (o, names[i], '{advisor}', lower(replace(split_part(names[i], ' ', 1), ' ', '')) || '@example.com', groups[i], 'Demo contact for the Outreach Queue.')
    returning id into cid;
    if last_days[i] is not null then
      insert into communications (owner_id, occurred_at, method, direction, contact_id, subject, summary, is_outreach, outcome)
      values (o, now() - (last_days[i] || ' days')::interval, 'email', 'outgoing', cid, 'Outreach email: ' || names[i], 'Checked in about acquisition search progress.', true, outcomes[i]);
    end if;
  end loop;
  update contacts set relationship_group = 'warm' where owner_id = o and name = 'Alex Example';

  -- Outreach history for the last 8 weeks on weekdays (varying counts so the grid shows met and missed days).
  for i in 1..55 loop
    d := current_date - i;
    if extract(dow from d) between 1 and 5 then
      n := (array[3, 4, 1, 3, 0, 3, 5, 2, 3, 3])[1 + (i % 10)];
      for c in select generate_series(1, n) as k loop
        insert into communications (owner_id, occurred_at, method, direction, subject, is_outreach, outcome)
        values (o, d + time '15:00' + (c.k || ' minutes')::interval, (array['email', 'call', 'text'])[1 + (c.k % 3)], 'outgoing', 'Outreach', true,
                (array['replied', 'no_response', 'no_response', 'meeting_booked', null])[1 + ((i + c.k) % 5)]);
      end loop;
      if i % 3 <> 0 then
        insert into target_entries (owner_id, target_id, entry_date, count) values (o, t_calls, d, 1);
      end if;
    end if;
  end loop;
  -- Today so far: 1 outreach logged.
  insert into communications (owner_id, occurred_at, method, direction, subject, is_outreach) values (o, now() - interval '1 minute', 'email', 'outgoing', 'Outreach', true);
  insert into target_misses (owner_id, target_id, period_start, period_end, actual_count, required_count, reason)
  select o, t_out, x.day, x.day, 1, 3, 'Diligence calls took the afternoon.'
  from (select current_date - g as day from generate_series(1, 14) g) x
  where extract(dow from x.day) between 1 and 5 and (select count(*) from communications cm where cm.owner_id = o and cm.is_outreach and cm.occurred_at::date = x.day) between 1 and 2
  limit 1;
end $$;

-- Pipeline accountability and deal source demo data (needs migration 0009).
do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
  p_acq uuid;
  st record;
  c_cpa uuid; c_banker uuid; c_broker uuid; org_broker uuid;
  it uuid;
begin
  if o is null then raise exception 'Create the owner account first'; end if;
  if to_regclass('public.stage_tasks') is null then
    raise notice 'Skipping pipeline accountability demo data: database update 0009 is not applied.';
    return;
  end if;
  select id into p_acq from pipelines where owner_id = o and kind = 'acquisition' limit 1;
  select id into c_broker from contacts where owner_id = o and name = 'Alex Example';
  select id into org_broker from organizations where owner_id = o and name = 'Example Business Brokers';

  -- Deal-source contacts (people who can refer off-market deals).
  insert into contacts (owner_id, name, roles, title, email, relationship_group, is_deal_source, notes)
  values (o, 'Pat Example, CPA', '{advisor}', 'Partner, small business accounting (demo)', 'pat@example.com', 'professional', true, 'Works with many owner-operators near retirement.')
  returning id into c_cpa;
  insert into contacts (owner_id, name, roles, title, email, relationship_group, is_deal_source, notes)
  values (o, 'Quinn Demo', '{advisor}', 'Commercial banker (demo)', 'quinn@example.com', 'warm', true, 'Knows owners refinancing before a sale.')
  returning id into c_banker;
  update contacts set is_deal_source = true where owner_id = o and name = 'Morgan Example';
  insert into communications (owner_id, occurred_at, method, direction, contact_id, subject, summary, is_outreach, purpose)
  values (o, now() - interval '70 days', 'email', 'outgoing', c_banker, 'Outreach email: Quinn Demo', 'Asked about clients thinking about selling.', true, 'deal_sourcing');
  update communications set purpose = 'deal_sourcing'
   where owner_id = o and is_outreach and subject = 'Outreach' and extract(day from occurred_at)::int % 3 = 0;

  -- Existing demo deals: source type.
  update pipeline_items set deal_source_type = 'brokered', source_contact_id = c_broker, source_notes = 'Listed by Example Business Brokers.'
   where owner_id = o and name = 'Demo HVAC Services Co';
  update pipeline_items set deal_source_type = 'proprietary', source_contact_id = c_cpa, source_notes = 'Owner introduced by Pat Example, CPA.'
   where owner_id = o and name = 'Demo Landscaping LLC';

  -- New deals. Inserting an item creates its stage tasks and next action (database triggers).
  for st in
    select * from (values
      ('Demo Plumbing Supply', 'Interested', 'proprietary', 0, 'Owner referral from Quinn Demo.'),
      ('Demo Bookkeeping Firm', 'Interested', 'brokered', 0, 'Broker listing.'),
      ('Demo Machine Shop', 'Interested', 'proprietary', 1, 'Direct letter to the owner.'),
      ('Demo Sign Shop', 'NDA signed', 'proprietary', 12, 'Owner referral from Pat Example, CPA.'),
      ('Demo Pest Control', 'Interested', 'brokered', 20, 'Broker listing.'),
      ('Demo Car Wash Co', 'Interested', 'brokered', 3, 'Broker listing.')
    ) as v (name, stage, source_type, days_ago, notes)
  loop
    insert into pipeline_items (owner_id, pipeline_id, stage_id, name, deal_source_type, source_contact_id, source_notes)
    select o, p_acq, s.id, st.name, st.source_type, case when st.source_type = 'brokered' then c_broker else c_cpa end, st.notes
      from pipeline_stages s where s.pipeline_id = p_acq and s.name = st.stage
    returning id into it;
    insert into deal_financials (owner_id, item_id) values (o, it);
    if st.days_ago > 0 then
      update pipeline_items set created_at = now() - (st.days_ago || ' days')::interval, stage_entered_at = now() - (st.days_ago || ' days')::interval where id = it;
      update stage_history set entered_at = now() - (st.days_ago || ' days')::interval where item_id = it;
    end if;
  end loop;
  -- One item with no next action (the morning job adds an alert and a "Set next action" task).
  update pipeline_items set next_action = null, next_action_due = null where owner_id = o and name = 'Demo Car Wash Co';
  -- Today: a CIM request on Demo Sign Shop (counts toward Deals advanced).
  select id into it from pipeline_items where owner_id = o and name = 'Demo Sign Shop';
  insert into communications (owner_id, occurred_at, method, direction, contact_id, subject, purpose, pipeline_item_id)
  values (o, now() - interval '5 minutes', 'email', 'outgoing', c_cpa, 'CIM requested: Demo Sign Shop', 'cim_request', it);
  insert into record_links (owner_id, from_type, from_id, to_type, to_id, relation)
  select o, 'communications', id, 'pipeline_items', it, 'concerns' from communications where owner_id = o and subject = 'CIM requested: Demo Sign Shop';
  -- Count the deal targets from 1 week ago in the demo.
  update targets set start_date = current_date - 7 where owner_id = o and name in ('Deals sourced', 'Deals advanced');
end $$;

-- Commitment rule demo data (needs migration 0010): several commitments due today for the daily close,
-- and regular tasks that already moved to the next day several times.
do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'times_moved') then
    raise notice 'Skipping commitment rule demo data: database update 0010 is not applied.';
    return;
  end if;
  -- Two pipeline next actions due today (commitments).
  update tasks set due_date = current_date where owner_id = o and title in ('Demo Plumbing Supply: Request teaser or CIM', 'Demo Machine Shop: Sign NDA');
  update commitments set due_date = current_date, original_due_date = current_date
   where owner_id = o and title in ('Demo Plumbing Supply: Request teaser or CIM', 'Demo Machine Shop: Sign NDA');
  -- Regular tasks that moved to the next day (one is due for the weekly review list).
  update tasks set times_moved = 6 where owner_id = o and title = 'Call Lender A about early repayment';
  insert into tasks (owner_id, title, due_date, times_moved) values
    (o, 'File the receipts from last month', current_date, 2),
    (o, 'Update the LinkedIn headline', current_date, 5);
end $$;

-- Deal source chain and Consulting demo data (needs migration 0011).
do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
  p_con uuid;
  c_friend uuid; c_cpa uuid; c_lead uuid; c_client uuid;
  org_client uuid; org_client2 uuid;
  it uuid;
  st record;
begin
  if o is null then raise exception 'Create the owner account first'; end if;
  if to_regclass('public.consulting_details') is null then
    raise notice 'Skipping consulting demo data: database update 0011 is not applied.';
    return;
  end if;
  select id into p_con from pipelines where owner_id = o and kind = 'consulting' limit 1;
  select id into c_cpa from contacts where owner_id = o and name = 'Pat Example, CPA';
  select id into c_friend from contacts where owner_id = o and name = 'Jamie Fictional';
  select id into c_lead from contacts where owner_id = o and name = 'Casey Demo';

  -- Source chain: Jamie Fictional (a friend) started the chain for two deals and one consulting lead.
  update pipeline_items set introduced_by_contact_id = c_friend
   where owner_id = o and name in ('Demo HVAC Services Co', 'Demo Plumbing Supply');
  update pipeline_items set introduced_by_contact_id = c_cpa where owner_id = o and name = 'Demo Machine Shop';
  update contacts set is_consulting_lead = true, title = 'Operations director (demo)' where id = c_lead;

  insert into organizations (owner_id, name, kind) values (o, 'Demo Retail Group', 'business') returning id into org_client;
  insert into organizations (owner_id, name, kind) values (o, 'Sample Clinic Partners', 'business') returning id into org_client2;
  insert into contacts (owner_id, name, roles, organization_id, email, relationship_group, notes)
  values (o, 'Robin Client (demo)', '{other}', org_client, 'robin@example.com', 'professional', 'Consulting client: monthly operations retainer.')
  returning id into c_client;

  -- Consulting items. Inserting an item creates its stage tasks and next action (database triggers).
  for st in
    select * from (values
      ('Demo Retail Group: operations retainer', 'Active', org_client, c_client, c_friend, 'monthly_retainer', 4200::numeric, null::numeric, null::numeric, current_date - 120, null::date, null::int),
      ('Sample Clinic Partners: pricing project', 'Proposal sent', org_client2, c_lead, c_friend, 'project', 18000::numeric, null::numeric, 3::numeric, current_date + 21, current_date + 111, null::int),
      ('Demo Logistics: hourly advisory', 'Discovery call', null::uuid, c_lead, null::uuid, 'hourly', 175::numeric, 20::numeric, null::numeric, null::date, null::date, 40),
      ('Demo Bakery: process review', 'Identified', null::uuid, null::uuid, null::uuid, null::text, null::numeric, null::numeric, null::numeric, null::date, null::date, null::int),
      -- Signed this week, no payment yet: counted in runway when the runway setting is on (until its first payment).
      ('Demo Dental Group: monthly retainer', 'Signed', null::uuid, c_client, null::uuid, 'monthly_retainer', 2500::numeric, null::numeric, null::numeric, current_date - 3, null::date, null::int)
    ) as v (name, stage, org, lead_from, intro, rate_type, rate, hours, months, start_d, end_d, prob)
  loop
    insert into pipeline_items (owner_id, pipeline_id, stage_id, name, organization_id, primary_contact_id, source_contact_id, introduced_by_contact_id)
    select o, p_con, s.id, st.name, st.org, st.lead_from, st.lead_from, st.intro from pipeline_stages s where s.pipeline_id = p_con and s.name = st.stage
    returning id into it;
    insert into consulting_details (owner_id, item_id, rate_type, rate, expected_hours_per_month, project_months, start_date, end_date, probability_pct)
    values (o, it, st.rate_type, st.rate, st.hours, st.months, st.start_d, st.end_d, st.prob);
  end loop;

  -- The demo consulting payments are linked to the retainer engagement.
  select id into it from pipeline_items where owner_id = o and name = 'Demo Retail Group: operations retainer';
  update transactions set pipeline_item_id = it where owner_id = o and description = 'CONSULTING CLIENT DEMO PAYMENT';
end $$;

-- Contact options demo data (needs migration 0012): a friend, an Other contact, and a deal with a typed source.
do $$
declare
  o uuid := (select id from auth.users order by created_at limit 1);
begin
  if to_regprocedure('public.schema_has_0012()') is null then
    raise notice 'Skipping contact options demo data: database update 0012 is not applied.';
    return;
  end if;
  update contacts set relationship_group = 'friend', roles = array_append(roles, 'friend') where owner_id = o and name = 'Jamie Fictional' and not ('friend' = any (roles));
  insert into contacts (owner_id, name, roles, email, relationship_group, notes)
  values (o, 'Quinn Other (demo)', '{other}', 'quinn@example.com', 'other', 'Other group: no set schedule, not in the Outreach Queue.');
  update pipeline_items set source = 'BizBuySell listing', source_contact_id = null
   where owner_id = o and name = 'Demo Car Wash Co';
end $$;

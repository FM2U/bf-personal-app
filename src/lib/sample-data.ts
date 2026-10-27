/**
 * "Load sample data" (Settings, Sample data and reset): realistic, clearly fake records for testing. Every name
 * starts with "Sample" (example: "Sample Storage Co. Unit A", "Sample Friend A"), every email ends in example.com,
 * and every row is recorded in sample_records (public.insert_record_batch with a batch id), so
 * "Remove sample data" deletes only these rows. Pure function: unit tested in src/lib/sample-data.test.ts.
 */
import { addDaysISO, addMonthsISO } from "@/lib/calc/dates";
import type { Batch } from "@/lib/initiative/proposal";

export type SampleSetup = {
  today: string;
  personalEntityId: string | null;
  llcEntityId: string | null;
  /** Category id by name (the default categories). */
  categories: Record<string, string>;
  budgetId: string | null;
  /** Category ids that already have a budget line (sample lines are added only for the others). */
  budgetedCategoryIds: string[];
  acquisitions: { pipelineId: string; stages: Record<string, string> } | null;
  consulting: { pipelineId: string; stages: Record<string, string> } | null;
};

/** Tables sample data writes to, in insert order. Removal deletes in the reverse dependency order (SQL). */
export const SAMPLE_TABLES = [
  "accounts", "account_balances", "organizations", "contacts", "income_sources", "pipeline_items", "deal_financials",
  "consulting_details", "transactions", "debts", "partners", "communications", "budget_lines",
] as const;

/** Software subscriptions in the sample: the last two are never confirmed as used (unused-subscription flags). */
export const SAMPLE_SOFTWARE = [
  { name: "Sample Cloud Storage", amount: 11.99, used: true },
  { name: "Sample Music Service", amount: 10.99, used: true },
  { name: "Sample Project Tool", amount: 29, used: true },
  { name: "Sample Design App", amount: 54.99, used: false },
  { name: "Sample Video Streaming", amount: 22.99, used: false },
];

/** Small fixed-seed number generator, so the same day always gives the same sample amounts. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSampleData(s: SampleSetup, newId: () => string): { batches: Batch[]; counts: Record<string, number> } {
  const rand = rng(`sample:${s.today.slice(0, 7)}`);
  const vary = (base: number, pct: number) => Math.round(base * (1 + (rand() * 2 - 1) * pct) * 100) / 100;
  const cat = (name: string) => s.categories[name] ?? null;
  const today = s.today;

  // Accounts: 2 checking/savings and 2 cards (Personal), 1 Cyan Arc LLC account
  const acc = { checking: newId(), savings: newId(), card1: newId(), card2: newId(), llc: newId() };
  const accounts = [
    { id: acc.checking, entity_id: s.personalEntityId, name: "Sample Checking", institution: "Sample Bank", kind: "checking", last4: "0101", include_in_runway: true },
    { id: acc.savings, entity_id: s.personalEntityId, name: "Sample Savings", institution: "Sample Bank", kind: "savings", last4: "0202", include_in_runway: true, is_emergency_fund: true },
    { id: acc.card1, entity_id: s.personalEntityId, name: "Sample Rewards Card", institution: "Sample Card Co.", kind: "credit_card", last4: "0303", include_in_runway: true },
    { id: acc.card2, entity_id: s.personalEntityId, name: "Sample Travel Card", institution: "Sample Card Co.", kind: "credit_card", last4: "0404", include_in_runway: true },
    { id: acc.llc, entity_id: s.llcEntityId, name: "Sample LLC Operating", institution: "Sample Bank", kind: "checking", last4: "0505", include_in_runway: false },
  ];
  const balances: Record<string, unknown>[] = [];
  for (let m = 3; m >= 1; m--) {
    const asOf = addDaysISO(addMonthsISO(today, -m), 0);
    balances.push(
      { id: newId(), account_id: acc.checking, as_of: asOf, balance: 21800 - (3 - m) * 1200, source: "manual" },
      { id: newId(), account_id: acc.savings, as_of: asOf, balance: 38000 + (3 - m) * 500, source: "manual" },
      { id: newId(), account_id: acc.card1, as_of: asOf, balance: 5600 + (3 - m) * 200, source: "manual" },
      { id: newId(), account_id: acc.card2, as_of: asOf, balance: 2600 + (3 - m) * 100, source: "manual" },
      { id: newId(), account_id: acc.llc, as_of: asOf, balance: 7400 + (3 - m) * 600, source: "manual" },
    );
  }
  balances.push(
    { id: newId(), account_id: acc.checking, as_of: today, balance: 18350, source: "manual" },
    { id: newId(), account_id: acc.savings, as_of: today, balance: 39200, source: "manual" },
    { id: newId(), account_id: acc.card1, as_of: today, balance: 6150, source: "manual" },
    { id: newId(), account_id: acc.card2, as_of: today, balance: 2890, source: "manual" },
    { id: newId(), account_id: acc.llc, as_of: today, balance: 9200, source: "manual" },
  );

  // Organizations and contacts (deal sources, friends, a broker, a client, a partner)
  const org = { brokers: newId(), hvac: newId(), bakery: newId(), client: newId() };
  const organizations = [
    { id: org.brokers, name: "Sample Business Brokers Inc.", kind: "broker" },
    { id: org.hvac, name: "Sample HVAC Services Co.", kind: "business" },
    { id: org.bakery, name: "Sample Bakery Group", kind: "business" },
    { id: org.client, name: "Sample Retail Client LLC", kind: "business" },
  ];
  const c = { broker: newId(), friendA: newId(), friendB: newId(), accountant: newId(), owner: newId(), client: newId(), partner: newId() };
  const contacts = [
    { id: c.broker, name: "Sample Broker A", roles: ["broker"], organization_id: org.brokers, email: "broker-a@example.com", relationship_group: "professional", is_deal_source: true, title: "Business broker" },
    { id: c.friendA, name: "Sample Friend A", roles: ["friend"], email: "friend-a@example.com", relationship_group: "friend", is_deal_source: true },
    { id: c.friendB, name: "Sample Friend B", roles: ["friend"], email: "friend-b@example.com", relationship_group: "friend", is_deal_source: false },
    { id: c.accountant, name: "Sample Accountant A", roles: ["advisor"], email: "accountant-a@example.com", relationship_group: "warm", is_deal_source: true, title: "CPA" },
    { id: c.owner, name: "Sample Business Owner A", roles: ["other"], organization_id: org.hvac, email: "owner-a@example.com", relationship_group: "warm", title: "Owner" },
    { id: c.client, name: "Sample Client Contact A", roles: ["other"], organization_id: org.client, email: "client-a@example.com", relationship_group: "professional", is_consulting_lead: true, title: "COO" },
    { id: c.partner, name: "Sample Partner A", roles: ["accountability_partner"], email: "partner-a@example.com", relationship_group: "close" },
  ];

  const income = { consulting: newId() };
  const incomeSources = [{ id: income.consulting, entity_id: s.personalEntityId, name: "Sample consulting retainer", kind: "consulting", expected_monthly: 4500, contact_id: c.client }];

  // Pipeline items: proprietary and brokered acquisitions, and one consulting engagement
  const items: Record<string, unknown>[] = [];
  const financials: Record<string, unknown>[] = [];
  const consultingRows: Record<string, unknown>[] = [];
  let consultingItem: string | null = null;
  const stage = (p: SampleSetup["acquisitions"], ...names: string[]) => {
    for (const n of names) if (p?.stages[n]) return p.stages[n];
    return p ? Object.values(p.stages)[0] ?? null : null;
  };
  if (s.acquisitions) {
    const hvac = newId();
    const bakery = newId();
    const land = newId();
    items.push(
      { id: hvac, pipeline_id: s.acquisitions.pipelineId, stage_id: stage(s.acquisitions, "Screened"), name: "Sample HVAC Services Co.", organization_id: org.hvac, primary_contact_id: c.owner, deal_source_type: "proprietary", source_contact_id: c.owner, introduced_by_contact_id: c.friendA, source_notes: "Sample Friend A knows the owner.", next_action: "Request the last 3 years of financials", next_action_due: addDaysISO(today, 2) },
      { id: bakery, pipeline_id: s.acquisitions.pipelineId, stage_id: stage(s.acquisitions, "NDA signed", "Screened"), name: "Sample Bakery Group", organization_id: org.bakery, primary_contact_id: c.broker, deal_source_type: "brokered", source_contact_id: c.broker, next_action: "Review the CIM", next_action_due: addDaysISO(today, 1) },
      { id: land, pipeline_id: s.acquisitions.pipelineId, stage_id: stage(s.acquisitions, "Sourced"), name: "Sample Landscaping LLC", deal_source_type: "brokered", source: "Sample listing website", next_action: "Screen the listing", next_action_due: today },
    );
    financials.push(
      { id: newId(), item_id: hvac, asking_price: 2400000, revenue: 3100000, ebitda: 610000, sde: 720000 },
      { id: newId(), item_id: bakery, asking_price: 1800000, revenue: 2600000, ebitda: 420000 },
    );
  }
  if (s.consulting) {
    consultingItem = newId();
    items.push({ id: consultingItem, pipeline_id: s.consulting.pipelineId, stage_id: stage(s.consulting, "Active", "Signed"), name: "Sample Retail Client: operations retainer", organization_id: org.client, primary_contact_id: c.client, source_contact_id: c.client, introduced_by_contact_id: c.friendB, next_action: "Send the monthly operations report", next_action_due: addDaysISO(today, 5) });
    consultingRows.push({ id: newId(), item_id: consultingItem, rate_type: "monthly_retainer", rate: 4500, start_date: addMonthsISO(today, -6), end_date: addMonthsISO(today, 6), scope_notes: "Sample engagement for testing." });
  }

  // 12 months of transactions
  const tx: Record<string, unknown>[] = [];
  const t = (account: string, date: string, amount: number, merchant: string, category: string | null, extra: Record<string, unknown> = {}) => {
    if (date > today) return;
    tx.push({ id: newId(), account_id: account, date, amount, description: merchant.toUpperCase(), merchant_name: merchant, category_id: category ? cat(category) : null, category_source: category ? "manual" : null, source: "manual", ...extra });
  };
  const monthStartOf = (m: number) => `${addMonthsISO(`${today.slice(0, 7)}-01`, -m).slice(0, 7)}-01`;
  const day = (m: number, d: number) => addDaysISO(monthStartOf(m), d - 1);
  for (let m = 11; m >= 0; m--) {
    t(acc.checking, day(m, 1), -2450, "Sample Property Management", "Housing");
    t(acc.card1, day(m, 3), -385, "Sample Storage Co. Unit A", "Storage");
    t(acc.card1, day(m, 3), -340, "Sample Storage Co. Unit B", "Storage");
    t(acc.card2, day(m, 8), -275, "Sample Self Storage", "Storage");
    t(acc.card1, day(m, 12), -95, "Sample Wireless", "Phone and Internet");
    t(acc.checking, day(m, 14), -70, "Sample Internet Co.", "Phone and Internet");
    t(acc.checking, day(m, 6), -vary(135, 0.25), "Sample Power Co.", "Utilities");
    t(acc.checking, day(m, 19), -vary(48, 0.15), "Sample Water Utility", "Utilities");
    SAMPLE_SOFTWARE.forEach((sw, i) => t(acc.card1, day(m, 4 + i * 3), -sw.amount, sw.name, "Software and Subscriptions"));
    t(acc.card2, day(m, 20), -142, "Sample Auto Insurance", "Insurance");
    t(acc.card1, day(m, 2), -59, "Sample Fitness Gym", "Health");
    t(acc.llc, day(m, 10), -35, "Sample Accounting Software", "Software and Subscriptions");
    // Food, about $1,500 per month: weekly groceries, a second grocer, dining, delivery
    for (const d of [2, 9, 16, 23]) t(acc.card1, day(m, d), -vary(195, 0.2), "Sample Grocery Market", "Groceries");
    for (const d of [12, 26]) t(acc.card2, day(m, d), -vary(110, 0.2), "Sample Organic Grocer", "Groceries");
    for (const d of [5, 11, 17, 24]) t(acc.card1, day(m, d), -vary(16, 0.3), "Sample Corner Cafe", "Dining");
    for (const d of [7, 21]) t(acc.card2, day(m, d), -vary(68, 0.25), "Sample Thai Kitchen", "Dining");
    for (const d of [4, 10, 13, 18, 27]) t(acc.card1, day(m, d), -vary(48, 0.25), "Sample Food Delivery", "Dining");
    for (const d of [9, 25]) t(acc.card2, day(m, d), -vary(42, 0.2), "Sample Pizza Place", "Dining");
    // Transportation and shopping
    for (const d of [6, 18, 28]) t(acc.card2, day(m, d), -vary(47, 0.2), "Sample Gas Station", "Transportation");
    t(acc.card1, day(m, 22), -vary(85, 0.6), "Sample Online Store", "Shopping");
    // Income: consulting retainer (linked to the consulting engagement) and occasional other income
    t(acc.checking, day(m, 15), 4500, "Sample Retail Client LLC", "Consulting Income", { income_source_id: income.consulting, pipeline_item_id: consultingItem });
    if (m % 3 === 0) t(acc.checking, day(m, 25), vary(900, 0.3), "Sample Side Project Payment", "Other Income");
    if (m % 4 === 1) t(acc.llc, day(m, 20), 2500, "Sample Advisory Client", "Consulting Income");
  }

  // Debts on the cards
  const debts = [
    { id: newId(), entity_id: s.personalEntityId, name: "Sample Rewards Card", kind: "credit_card", account_id: acc.card1, current_balance: 6150, balance_as_of: today, apr: 24.99, minimum_payment: 185, due_day: 12 },
    { id: newId(), entity_id: s.personalEntityId, name: "Sample Travel Card", kind: "credit_card", account_id: acc.card2, current_balance: 2890, balance_as_of: today, apr: 21.49, minimum_payment: 90, due_day: 22 },
  ];

  const partners = [{ id: newId(), name: "Sample Partner A", is_pseudonym: true, contact_id: c.partner, email: "partner-a@example.com", schedule: "weekly", delivery_methods: ["email"], next_report_on: addDaysISO(today, 7), is_active: true, notes: "Sample accountability partner for testing." }];

  const comms = [
    { id: newId(), occurred_at: `${addDaysISO(today, -12)}T15:00:00Z`, method: "call", direction: "outgoing", contact_id: c.friendA, subject: "Sample call: off-market deals", summary: "Asked about owners thinking of selling.", is_outreach: true, outcome: "referral", purpose: "deal_sourcing" },
    { id: newId(), occurred_at: `${addDaysISO(today, -6)}T14:00:00Z`, method: "email", direction: "outgoing", contact_id: c.broker, organization_id: org.brokers, subject: "Sample email: new listings", summary: "Asked for listings in home services.", is_outreach: true, outcome: "replied", purpose: "deal_sourcing" },
    { id: newId(), occurred_at: `${addDaysISO(today, -3)}T16:30:00Z`, method: "meeting", direction: "outgoing", contact_id: c.client, organization_id: org.client, subject: "Sample monthly review meeting", summary: "Reviewed the operations report.", is_outreach: false },
  ];

  const budgetLines: Record<string, unknown>[] = [];
  if (s.budgetId) {
    const plan: [string, number, number][] = [["Housing", 2450, 2450], ["Groceries", 900, 700], ["Dining", 600, 350], ["Storage", 1000, 385], ["Software and Subscriptions", 130, 55], ["Utilities", 185, 175], ["Transportation", 150, 150]];
    for (const [name, current, target] of plan) {
      const id = cat(name);
      if (id && !s.budgetedCategoryIds.includes(id)) budgetLines.push({ id: newId(), budget_id: s.budgetId, category_id: id, current_monthly: current, target_monthly: target });
    }
  }

  const batches: Batch[] = [
    { table: "accounts", rows: accounts },
    { table: "account_balances", rows: balances },
    { table: "organizations", rows: organizations },
    { table: "contacts", rows: contacts },
    { table: "income_sources", rows: incomeSources },
    { table: "pipeline_items", rows: items },
    { table: "deal_financials", rows: financials },
    { table: "consulting_details", rows: consultingRows },
    { table: "transactions", rows: tx },
    { table: "debts", rows: debts },
    { table: "partners", rows: partners },
    { table: "communications", rows: comms },
    { table: "budget_lines", rows: budgetLines },
  ].filter((b) => b.rows.length);
  const counts = Object.fromEntries(batches.map((b) => [b.table, b.rows.length]));
  return { batches, counts };
}

/** Fields that hold a display name in sample rows (each must start with "Sample"). */
export const SAMPLE_NAME_FIELDS: Record<string, string> = {
  accounts: "name",
  organizations: "name",
  contacts: "name",
  income_sources: "name",
  pipeline_items: "name",
  debts: "name",
  partners: "name",
  transactions: "merchant_name",
  communications: "subject",
};

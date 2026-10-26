import { describe, expect, it } from "vitest";
import { effectiveProbability, expectedIncomeGap, expectedMonthlyIncome, hasFirstPayment, paymentSummary, pipelineValue, projectMonths, runwaySignedIncome, signedMonthlyIncome, withinDates } from "./consulting";
import { monthlyAverages } from "./runway";
import { computeRunway, runwayExplanation } from "./runway";
import { bridgeComparison, projectScenario, type Baseline } from "./scenario";
import { creditByContact, describeSource, initialSourceMode, introducedNote, isBroker, resolveSourceFields, suggestDealSourceType, suggestForSource, topIntroducers } from "./source-chain";
import { effectiveEveryDays, outreachStatus, sortQueue, type OutreachStatus } from "./outreach";
import { getResource } from "../resources";
import { cleanDraft, isBlankPerson, newContactRows, parseOrgPeople, planOrgPeople, type NewPerson } from "../org-people";
import { pipelineClosedCookie, resolveShowClosed } from "../pipeline-view";
import { EMPTY_LAYOUT, fileHeaders, layoutFits, layoutSaveNames, missingColumns, pickLayout, type SavedLayout } from "./import-layout";
import { fieldTextForKind, hiddenForKind } from "../pipeline-labels";

describe("consulting expected monthly income", () => {
  it("hourly = rate x expected hours per month", () => {
    expect(expectedMonthlyIncome({ rate_type: "hourly", rate: 150, expected_hours_per_month: 20 })).toBe(3000);
    expect(expectedMonthlyIncome({ rate_type: "hourly", rate: "175", expected_hours_per_month: "10.5" })).toBe(1837.5);
  });
  it("monthly retainer = rate", () => {
    expect(expectedMonthlyIncome({ rate_type: "monthly_retainer", rate: 4200 })).toBe(4200);
  });
  it("project = fee / project months, or / months from start to end date", () => {
    expect(expectedMonthlyIncome({ rate_type: "project", rate: 18000, project_months: 3 })).toBe(6000);
    // Jan 1 to Jun 30 is 181 days, about 5.95 months.
    expect(projectMonths({ start_date: "2027-01-01", end_date: "2027-06-30" })).toBe(5.95);
    expect(expectedMonthlyIncome({ rate_type: "project", rate: 11900, start_date: "2027-01-01", end_date: "2027-06-30" })).toBe(2000);
    // A short project counts as at least 1 month.
    expect(projectMonths({ start_date: "2027-01-01", end_date: "2027-01-10" })).toBe(1);
  });
  it("is not calculated when a needed number is missing, and says what is missing", () => {
    expect(expectedMonthlyIncome({ rate_type: "hourly", rate: 150 })).toBeNull();
    expect(expectedMonthlyIncome({ rate_type: "project", rate: 10000 })).toBeNull();
    expect(expectedMonthlyIncome({ rate_type: null, rate: 10000 })).toBeNull();
    expect(expectedMonthlyIncome(null)).toBeNull();
    expect(expectedIncomeGap({ rate_type: "hourly", rate: 150 })).toBe("Add expected hours per month");
    expect(expectedIncomeGap({ rate_type: "project" })).toBe("Add the project fee");
    expect(expectedIncomeGap({})).toBe("Choose the rate type");
    expect(expectedIncomeGap({ rate_type: "monthly_retainer", rate: 1 })).toBeNull();
  });
});

describe("consulting probability and pipeline value", () => {
  it("uses the item probability, then the stage default, then 0", () => {
    expect(effectiveProbability(80, 50)).toBe(80);
    expect(effectiveProbability(null, 50)).toBe(50);
    expect(effectiveProbability(undefined, null)).toBe(0);
    expect(effectiveProbability(0, 50)).toBe(0);
    expect(effectiveProbability(140, null)).toBe(100);
  });
  it("sums expected monthly income x probability over open items only", () => {
    expect(
      pipelineValue([
        { status: "open", expectedMonthly: 3000, probabilityPct: 50 },
        { status: "open", expectedMonthly: 4200, probabilityPct: 100 },
        { status: "open", expectedMonthly: null, probabilityPct: 30 },
        { status: "won", expectedMonthly: 9000, probabilityPct: 100 },
        { status: "lost", expectedMonthly: 9000, probabilityPct: 0 },
      ]),
    ).toBe(5700);
    expect(pipelineValue([])).toBe(0);
  });
});

describe("signed consulting income and runway", () => {
  const items = [
    { status: "open", signedStage: true, terms: { rate_type: "monthly_retainer", rate: 4000, start_date: "2026-09-01", end_date: null } },
    { status: "open", signedStage: true, terms: { rate_type: "hourly", rate: 100, expected_hours_per_month: 10, start_date: "2026-12-01" } }, // starts later
    { status: "open", signedStage: true, terms: { rate_type: "monthly_retainer", rate: 2000, start_date: "2026-01-01", end_date: "2026-09-30" } }, // ended
    { status: "open", signedStage: false, terms: { rate_type: "monthly_retainer", rate: 9000 } }, // proposal, not signed
    { status: "won", signedStage: true, terms: { rate_type: "monthly_retainer", rate: 9000 } }, // completed
  ];
  it("counts open signed work between its start and end dates", () => {
    expect(withinDates({ start_date: "2026-10-26", end_date: "2026-10-26" }, "2026-10-26")).toBe(true);
    expect(signedMonthlyIncome(items, "2026-10-26")).toBe(4000);
    expect(signedMonthlyIncome(items, "2026-12-15")).toBe(5000);
  });
  it("runway with the setting off ignores signed consulting; on adds it to income", () => {
    const off = computeRunway({ cash: 60000, avgSpending: 8000, avgIncome: 2000 });
    expect(off.months).toBe(10);
    expect(off.signedConsultingMonthly).toBe(0);
    const on = computeRunway({ cash: 60000, avgSpending: 8000, avgIncome: 2000, signedConsultingMonthly: signedMonthlyIncome(items, "2026-10-26") });
    expect(on.netMonthlyBurn).toBe(2000);
    expect(on.months).toBe(30);
    expect(computeRunway({ cash: 60000, avgSpending: 8000, avgIncome: 2000, signedConsultingMonthly: 7000 }).months).toBeNull();
  });
  it("the explanation names the mode in use", () => {
    const base = { lookbackMonths: 3, subtractIncome: true, signedConsultingMonthly: 4000 };
    expect(runwayExplanation({ ...base, includeSignedConsulting: false })).toContain("is not counted");
    expect(runwayExplanation({ ...base, includeSignedConsulting: true })).toContain("$4,000 per month expected from Signed and Active consulting work with no payment received yet is added to income");
    expect(runwayExplanation({ ...base, includeSignedConsulting: true })).toContain("After an engagement's first payment, its payments count in average income instead.");
    expect(runwayExplanation({ ...base, includeSignedConsulting: false, settingAvailable: false })).not.toContain("consulting");
    expect(runwayExplanation({ ...base, subtractIncome: false, includeSignedConsulting: false })).toContain("income not subtracted");
  });
  it("runway: a signed engagement counts as future income until its first payment is received", () => {
    const retainer = { status: "open", signedStage: true, terms: { rate_type: "monthly_retainer", rate: 4000, start_date: "2026-10-01" } };
    // Before the first payment: counted.
    expect(runwaySignedIncome([{ ...retainer, firstPaymentDate: null }], "2026-10-26")).toBe(4000);
    // A payment dated later than today is not received yet: still counted.
    expect(runwaySignedIncome([{ ...retainer, firstPaymentDate: "2026-11-01" }], "2026-10-26")).toBe(4000);
    expect(hasFirstPayment({ firstPaymentDate: "2026-11-01" }, "2026-10-26")).toBe(false);
    // After the first payment: not counted (its payments are in average income).
    expect(runwaySignedIncome([{ ...retainer, firstPaymentDate: "2026-10-15" }], "2026-10-26")).toBe(0);
    expect(hasFirstPayment({ firstPaymentDate: "2026-10-26" }, "2026-10-26")).toBe(true);
    // "Signed work per month" still shows every signed engagement.
    expect(signedMonthlyIncome([{ ...retainer, firstPaymentDate: "2026-10-15" }], "2026-10-26")).toBe(4000);
    // Mixed: only the unpaid engagement is added.
    const unpaid = { status: "open", signedStage: true, terms: { rate_type: "hourly", rate: 150, expected_hours_per_month: 10, start_date: "2026-10-20" }, firstPaymentDate: null };
    expect(runwaySignedIncome([{ ...retainer, firstPaymentDate: "2026-10-15" }, unpaid], "2026-10-26")).toBe(1500);
  });

  it("runway: a paid retainer is not counted twice (payments in average income, nothing added)", () => {
    // Three months of spending 8,000 and a 4,000 retainer paid each month.
    const txns = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [
      { date: `${m}-05`, amount: -8000 },
      { date: `${m}-15`, amount: 4000 },
    ]);
    const avg = monthlyAverages(txns, "2026-10-26", 3);
    expect(avg.avgIncome).toBe(4000);
    const items = [{ status: "open", signedStage: true, terms: { rate_type: "monthly_retainer", rate: 4000, start_date: "2026-07-01" }, firstPaymentDate: "2026-07-15" }];
    const r = computeRunway({ cash: 40000, avgSpending: avg.avgSpending, avgIncome: avg.avgIncome, signedConsultingMonthly: runwaySignedIncome(items, "2026-10-26") });
    expect(r.signedConsultingMonthly).toBe(0);
    expect(r.netMonthlyBurn).toBe(4000);
    expect(r.months).toBe(10);
  });

  it("payments: count, total, last date (money in only)", () => {
    expect(paymentSummary([{ date: "2026-09-15", amount: 4200 }, { date: "2026-10-15", amount: "4200" }, { date: "2026-10-20", amount: -50 }])).toEqual({ count: 2, total: 8400, lastDate: "2026-10-15" });
    expect(paymentSummary([])).toEqual({ count: 0, total: 0, lastDate: null });
  });
});

describe("bridge scenario", () => {
  const inputs = {
    job_salary: 120000,
    job_bonus: 0,
    acquisition_salary: 120000,
    acquisition_equity_pct: 10,
    acquisition_business_value: 1000000,
    acquisition_debt: 1000000,
    acquisition_debt_years: 10,
    acquisition_value_growth_pct: 0,
    effective_tax_rate_pct: 0,
    comparison_years: 3,
    acquisition_search_months_allowed: 12,
    consulting_monthly_income: 5000,
    consulting_months: 12,
  };
  it("pays no salary during the search, consulting for consulting_months, then the acquisition salary and equity", () => {
    const r = bridgeComparison(inputs);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(4);
    expect(r.rows[1].jobCumulative).toBe(120000);
    expect(r.rows[1].consultingCumulative).toBe(60000);
    expect(r.rows[1].acquisitionSalaryCumulative).toBe(0);
    expect(r.rows[1].acquisitionEquityValue).toBe(0);
    expect(r.rows[1].bridgeTotal).toBe(60000);
    expect(r.rows[1].withoutConsultingTotal).toBe(0);
    // Year 2: one year after the acquisition. Equity = 10% x (1,000,000 - 900,000 remaining debt).
    expect(r.rows[2].acquisitionSalaryCumulative).toBe(120000);
    expect(r.rows[2].acquisitionEquityValue).toBe(10000);
    expect(r.rows[2].bridgeTotal).toBe(190000);
    expect(r.rows[2].difference).toBe(190000 - 240000);
    expect(r.crossoverYear).toBeNull();
  });
  it("crosses over when consulting covers the search", () => {
    const r = bridgeComparison({ ...inputs, consulting_monthly_income: 12000, consulting_months: 24, acquisition_salary: 150000 });
    expect(r.rows[1].bridgeTotal).toBe(144000);
    expect(r.crossoverYear).toBe(1);
  });
  it("with no consulting income the bridge is the search alone, and missing inputs are listed", () => {
    const r = bridgeComparison({ ...inputs, consulting_monthly_income: 0 });
    expect(r.rows.every((x) => x.bridgeTotal === x.withoutConsultingTotal)).toBe(true);
    expect(bridgeComparison({ job_salary: null }).missing).toContain("job_salary");
  });
  it("scenario projections add consulting income for consulting_months", () => {
    const base: Baseline = {
      startDate: "2026-10-26",
      cash: 10000,
      monthlySpending: 5000,
      monthlyIncome: 0,
      debts: [],
      investmentBalance: 0,
      otherAssets: 0,
      emergencyFundBalance: 0,
      inputs: { expected_annual_return_pct: 0, consulting_monthly_income: 3000, consulting_months: 2 },
    };
    const r = projectScenario(base, {}, 4);
    expect(r.rows.map((x) => x.cash)).toEqual([8000, 6000, 1000, -4000]);
    expect(projectScenario({ ...base, inputs: { expected_annual_return_pct: 0 } }, {}, 1).rows[0].cash).toBe(5000);
  });
});

describe("deal source chain", () => {
  it("suggests Brokered for a broker contact, otherwise Proprietary", () => {
    expect(suggestDealSourceType({ roles: ["broker"] })).toBe("brokered");
    expect(suggestDealSourceType({ roles: ["Broker", "advisor"] })).toBe("brokered");
    expect(suggestDealSourceType({ roles: [], organizationKind: "broker" })).toBe("brokered");
    expect(suggestDealSourceType({ roles: ["advisor"], organizationKind: "business" })).toBe("proprietary");
    expect(suggestDealSourceType({ roles: null })).toBe("proprietary");
    expect(suggestDealSourceType(null)).toBeNull();
    expect(isBroker(undefined)).toBe(false);
  });
  const items = [
    { id: "d1", kind: "acquisition", source_contact_id: "broker", introduced_by_contact_id: "friend", created_at: "2026-10-20" },
    { id: "d2", kind: "acquisition", source_contact_id: "owner", introduced_by_contact_id: "friend", created_at: "2026-09-01" },
    { id: "d3", kind: "acquisition", source_contact_id: "friend", introduced_by_contact_id: "friend", created_at: "2026-10-21" },
    { id: "c1", kind: "consulting", source_contact_id: "client", introduced_by_contact_id: "friend", created_at: "2026-10-22" },
    { id: "j1", kind: "job", source_contact_id: "friend", introduced_by_contact_id: null, created_at: "2026-10-22" },
  ];
  it("counts deals introduced per contact, each item once", () => {
    const c = creditByContact(items);
    expect(c.friend).toEqual({ deals: 3, dealsCameFrom: 1, dealsIntroduced: 3, consultingLeads: 1 });
    expect(c.broker).toEqual({ deals: 1, dealsCameFrom: 1, dealsIntroduced: 0, consultingLeads: 0 });
    expect(c.client).toEqual({ deals: 0, dealsCameFrom: 0, dealsIntroduced: 0, consultingLeads: 1 });
    expect(c.nobody).toBeUndefined();
  });
  it("writes the Outreach Queue note", () => {
    expect(introducedNote({ deals: 1, dealsCameFrom: 1, dealsIntroduced: 0, consultingLeads: 0 })).toBe("Introduced 1 deal");
    expect(introducedNote({ deals: 3, dealsCameFrom: 1, dealsIntroduced: 3, consultingLeads: 2 })).toBe("Introduced 3 deals and 2 consulting leads");
    expect(introducedNote({ deals: 0, dealsCameFrom: 0, dealsIntroduced: 0, consultingLeads: 0 })).toBeNull();
    expect(introducedNote(null)).toBeNull();
  });
  it("lists the top contacts by deals introduced, with the count for the period", () => {
    const top = topIntroducers(items, { friend: "Friend", broker: "Broker", owner: "Owner", client: "Client" }, { from: "2026-10-19", to: "2026-10-25" });
    expect(top.map((t) => t.name)).toEqual(["Friend", "Broker", "Owner", "Client"]);
    expect(top[0]).toMatchObject({ deals: 3, consulting_leads: 1, deals_this_period: 2 });
    expect(topIntroducers(items, {}, { limit: 1 })).toHaveLength(1);
  });
  it("Outreach Queue: contacts who introduced deals sort above others of equal due status", () => {
    const st = (neverContacted: boolean, daysOverdue: number | null): OutreachStatus => ({ everyDays: 30, dueDate: null, due: true, daysOverdue, neverContacted });
    const rows = [
      { name: "A overdue 20", status: st(false, 20) },
      { name: "B introduced 2", status: st(false, 3), introducedCount: 2 },
      { name: "C deal source", status: st(false, 1), isDealSource: true },
      { name: "D introduced 1", status: st(false, 10), introducedCount: 1 },
      { name: "E never contacted", status: st(true, null) },
    ];
    expect(sortQueue(rows).map((r) => r.name)).toEqual(["C deal source", "E never contacted", "B introduced 2", "D introduced 1", "A overdue 20"]);
  });
});

describe("pipeline labels per kind", () => {
  it("renames Organization per pipeline kind", () => {
    expect(fieldTextForKind("acquisition").organization_id?.label).toBe("Company being acquired");
    expect(fieldTextForKind("job").organization_id?.label).toBe("Employer");
    expect(fieldTextForKind("cofounder").organization_id?.label).toBe("Current company");
    expect(fieldTextForKind("investor").organization_id?.label).toBe("Investor firm");
    expect(fieldTextForKind("other").organization_id?.label).toBe("Organization");
    expect(fieldTextForKind("consulting").organization_id?.label).toBe("Client");
    expect(fieldTextForKind("unknown")).toEqual({});
  });
  it("source fields: Deal came from on acquisitions, Lead came from on consulting, none elsewhere", () => {
    expect(fieldTextForKind("acquisition").source_contact_id?.label).toBe("Deal came from");
    expect(fieldTextForKind("consulting").source_contact_id?.label).toBe("Lead came from");
    expect(hiddenForKind("acquisition")).toEqual([]);
    expect(hiddenForKind("consulting").sort()).toEqual(["deal_source_type", "source_notes"]);
    expect(hiddenForKind("job").sort()).toEqual(["deal_source_type", "introduced_by_contact_id", "source_contact_id", "source_notes"]);
  });
});

describe("Deal came from: a contact, or Not a person with a typed source", () => {
  it("opens as Not a person when there is only a typed source", () => {
    expect(initialSourceMode(null, "BizBuySell listing")).toBe("text");
    expect(initialSourceMode("c1", "BizBuySell listing")).toBe("contact");
    expect(initialSourceMode(null, "  ")).toBe("contact");
    expect(initialSourceMode(null, null)).toBe("contact");
  });
  it("Not a person saves the text and no contact", () => {
    expect(resolveSourceFields({ mode: "text", contactId: "c1", text: "  Cold email campaign ", initialMode: "contact", initialText: "" })).toEqual({ source_contact_id: null, source: "Cold email campaign" });
    expect(resolveSourceFields({ mode: "text", contactId: "", text: "", initialMode: "text", initialText: "Old" })).toEqual({ source_contact_id: null, source: null });
  });
  it("switching to a contact clears the typed source; an item that had both keeps its text", () => {
    expect(resolveSourceFields({ mode: "contact", contactId: "c2", text: "BizBuySell listing", initialMode: "text", initialText: "BizBuySell listing" })).toEqual({ source_contact_id: "c2", source: null });
    expect(resolveSourceFields({ mode: "contact", contactId: "c2", text: "", initialMode: "contact", initialText: "Referral at a conference" })).toEqual({ source_contact_id: "c2", source: "Referral at a conference" });
    expect(resolveSourceFields({ mode: "contact", contactId: "", text: "", initialMode: "contact", initialText: "" })).toEqual({ source_contact_id: null, source: null });
  });
  it("a typed source suggests no deal type; a contact still does", () => {
    expect(suggestForSource("text", { roles: ["broker"] })).toBeNull();
    expect(suggestForSource("contact", { roles: ["broker"] })).toBe("brokered");
    expect(suggestForSource("contact", { roles: ["friend"] })).toBe("proprietary");
  });
  it("the item page shows the contact, the typed source, or both", () => {
    expect(describeSource("Pat Example", null)).toBe("Pat Example");
    expect(describeSource(null, "BizBuySell listing")).toBe("BizBuySell listing (not a person)");
    expect(describeSource("Pat Example", "Conference")).toBe("Pat Example (also noted: Conference)");
    expect(describeSource(null, "")).toBeNull();
  });
});

describe("relationship groups: friend and other", () => {
  it("friend is every 30 days; other has no set schedule unless the contact sets days", () => {
    expect(effectiveEveryDays("friend", null)).toBe(30);
    expect(effectiveEveryDays("close", null)).toBe(30);
    expect(effectiveEveryDays("warm", null)).toBe(60);
    expect(effectiveEveryDays("professional", null)).toBe(90);
    expect(effectiveEveryDays("other", null)).toBeNull();
    expect(effectiveEveryDays("other", 45)).toBe(45);
    expect(effectiveEveryDays("friend", 14)).toBe(14);
  });
  it("other is not due (never contacted or long ago) unless Reach out every (days) is set", () => {
    expect(outreachStatus({ relationship_group: "other" }, null, "2026-10-26").due).toBe(false);
    expect(outreachStatus({ relationship_group: "other" }, "2025-01-01", "2026-10-26").due).toBe(false);
    expect(outreachStatus({ relationship_group: "other", outreach_every_days: 45 }, "2026-09-01", "2026-10-26")).toMatchObject({ due: true, daysOverdue: 10 });
    expect(outreachStatus({ relationship_group: "friend" }, "2026-09-26", "2026-10-26")).toMatchObject({ due: true, daysOverdue: 0 });
    expect(outreachStatus({ relationship_group: "friend" }, null, "2026-10-26")).toMatchObject({ due: true, neverContacted: true });
  });
  it("the contact form offers Friend and Other, and the Friend role", () => {
    const c = getResource("contacts")!;
    expect(c.fields.find((f) => f.name === "relationship_group")?.options?.map((o) => o.value)).toEqual(["close", "friend", "warm", "professional", "other"]);
    expect(c.fields.find((f) => f.name === "relationship_group")?.options?.find((o) => o.value === "other")?.label).toBe("Other (no set schedule)");
    expect(c.fields.find((f) => f.name === "roles")?.options?.map((o) => o.value)).toContain("friend");
  });
  it("the contact form keeps identity first, then relationship and outreach, follow-up, labels, notes", () => {
    const c = getResource("contacts")!;
    const sections = [...new Set(c.fields.map((f) => f.section))];
    expect(sections).toEqual(["Name and contact details", "Relationship and outreach", "Follow-up", "Labels in the Outreach Queue", "Notes"]);
    expect(c.fields.slice(0, 6).map((f) => f.name)).toEqual(["name", "is_pseudonym", "organization_id", "title", "email", "phone"]);
  });
});

describe("people at an organization", () => {
  const draft = (linked: string[], added: NewPerson[] = []) => ({ linked, added });
  it("links new choices, unlinks removed ones (never deletes), and adds new people", () => {
    const plan = planOrgPeople(["a", "b"], draft(["b", "c"], [{ name: "Robin New", email: "robin@example.com" }, { name: "Sam New", relationship_group: "friend" }]));
    expect(plan).toEqual({ link: ["c"], unlink: ["a"], create: [
      { name: "Robin New", email: "robin@example.com", phone: "", title: "", relationship_group: "" },
      { name: "Sam New", email: "", phone: "", title: "", relationship_group: "friend" },
    ] });
  });
  it("skips empty rows and needs a name on a row with anything typed", () => {
    expect(planOrgPeople([], draft([], [{ name: "", email: "" }, { name: " " }]))).toEqual({ link: [], unlink: [], create: [] });
    expect(planOrgPeople([], draft([], [{ name: "", email: "x@example.com" }]))).toEqual({ error: "Add a name for each new person, or remove the row." });
    expect(planOrgPeople([], draft([], [{ name: "A", email: "not-an-email" }]))).toEqual({ error: "not-an-email is not an email address." });
    expect(planOrgPeople([], draft([], [{ name: "A", relationship_group: "best" }]))).toEqual({ error: "Choose a relationship group from the list." });
  });
  it("the organization page only adds (nothing is unlinked)", () => {
    expect(planOrgPeople(["a"], draft(["c"]), { addOnly: true })).toEqual({ link: ["c"], unlink: [], create: [] });
  });
  it("two new people become two contact rows at the organization", () => {
    const rows = newContactRows([{ name: "One", email: "one@example.com" }, { name: "Two", phone: "555-0100", title: "CFO" }], "org1", "owner1");
    expect(rows).toEqual([
      { owner_id: "owner1", organization_id: "org1", name: "One", email: "one@example.com", phone: null, title: null, relationship_group: null },
      { owner_id: "owner1", organization_id: "org1", name: "Two", email: null, phone: "555-0100", title: "CFO", relationship_group: null },
    ]);
  });
  it("reads the editor's field and ignores bad input", () => {
    expect(parseOrgPeople(JSON.stringify({ linked: ["a", "a"], added: [{ name: "X" }, { name: "" }] }))).toEqual({ linked: ["a"], added: [{ name: "X", email: "", phone: "", title: "", relationship_group: "" }] });
    expect(parseOrgPeople("not json")).toBeNull();
    expect(parseOrgPeople("")).toBeNull();
    expect(isBlankPerson({ name: " ", email: "" })).toBe(true);
    expect(JSON.stringify(cleanDraft({ linked: [], added: [{ name: "" }] }))).toBe(JSON.stringify(cleanDraft({ linked: [], added: [] })));
  });
});

describe("pipeline board: closed stages shown by default and remembered", () => {
  it("address first, then the remembered choice, then shown", () => {
    expect(resolveShowClosed(undefined, undefined)).toBe(true);
    expect(resolveShowClosed(undefined, "hide")).toBe(false);
    expect(resolveShowClosed(undefined, "show")).toBe(true);
    expect(resolveShowClosed("0", "show")).toBe(false);
    expect(resolveShowClosed("1", "hide")).toBe(true);
    expect(pipelineClosedCookie("abc-123")).toBe("pipeline_closed_abc-123");
  });
});

describe("CSV import: column choices filled for a restarted import", () => {
  const headers = ["Posted Date", "Description", "Amount", "Reference"];
  const chase: SavedLayout = { ...EMPTY_LAYOUT, id: "l1", name: "Chase checking CSV", institution: "Chase", date_column: "Posted Date", description_column: "Description", amount_column: "Amount" };
  const other: SavedLayout = { ...EMPTY_LAYOUT, id: "l2", name: "Amex CSV", institution: "Amex", date_column: "Date", description_column: "Payee", amount_column: "Amt" };
  const account = { name: "Checking", institution: "chase" };
  it("uses the unfinished choices for the account first, then the last layout used, then the bank's layout", () => {
    const draft = { layout: { ...chase, external_id_column: "Reference" }, institution: "Chase", layoutName: "Mine" };
    expect(pickLayout({ headers, account, layouts: [chase, other], draft }).source).toBe("draft");
    expect(pickLayout({ headers, account, layouts: [chase, other], lastLayoutId: "l1" }).source).toBe("last_used");
    const bank = pickLayout({ headers, account, layouts: [other, chase] });
    expect(bank.source).toBe("bank");
    expect(bank.layout.date_column).toBe("Posted Date");
    expect(bank.name).toBe("Chase checking CSV");
  });
  it("a saved layout whose columns are not in the file is not used", () => {
    const pick = pickLayout({ headers: ["When", "What", "How much"], account, layouts: [chase] });
    expect(pick.source).toBe("guess");
    expect(pick.note).toContain("does not match");
    expect(pickLayout({ headers, account: { name: "Card", institution: null }, layouts: [other, chase] }).source).toBe("matching");
  });
  it("guesses from column names and names the layout after the bank or account", () => {
    const pick = pickLayout({ headers, account: { name: "Card", institution: null }, layouts: [] });
    expect(pick.layout).toMatchObject({ date_column: "Posted Date", description_column: "Description", amount_column: "Amount" });
    expect(pick.name).toBe("Card CSV");
    expect(layoutSaveNames({ layoutName: "", institution: "", account: { name: "Card", institution: null } })).toEqual({ layoutName: "Card CSV", institution: "Card" });
  });
  it("names each required column that is not chosen", () => {
    expect(missingColumns({ ...EMPTY_LAYOUT })).toEqual(["Date", "Description", "Amount (or the Money out and Money in columns)"]);
    expect(missingColumns({ ...EMPTY_LAYOUT, date_column: "D", description_column: "X", debit_column: "Out" })).toEqual([]);
    expect(fileHeaders(["Date", ""], true)).toEqual(["Date", "Column 2"]);
    expect(layoutFits(chase, headers)).toBe(true);
  });
});

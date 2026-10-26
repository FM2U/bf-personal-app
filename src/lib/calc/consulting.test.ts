import { describe, expect, it } from "vitest";
import { effectiveProbability, expectedIncomeGap, expectedMonthlyIncome, paymentSummary, pipelineValue, projectMonths, signedMonthlyIncome, withinDates } from "./consulting";
import { computeRunway, runwayExplanation } from "./runway";
import { bridgeComparison, projectScenario, type Baseline } from "./scenario";
import { creditByContact, introducedNote, isBroker, suggestDealSourceType, topIntroducers } from "./source-chain";
import { sortQueue, type OutreachStatus } from "./outreach";
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
    expect(runwayExplanation({ ...base, includeSignedConsulting: true })).toContain("$4,000 per month expected from Signed and Active consulting work is added to income");
    expect(runwayExplanation({ ...base, includeSignedConsulting: false, settingAvailable: false })).not.toContain("consulting");
    expect(runwayExplanation({ ...base, subtractIncome: false, includeSignedConsulting: false })).toContain("income not subtracted");
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

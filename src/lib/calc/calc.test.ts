import { describe, expect, it } from "vitest";
import { computeRunway, monthlyAverages } from "./runway";
import { debtPayoff, payoffOrder } from "./debt";
import { budgetVariance, emergencyFundProgress, futureValue, netWorth, repaymentSchedule, requiredMonthlySavings, retirementTarget } from "./savings";
import { jobVsAcquisition, projectScenario, type Baseline } from "./scenario";
import { evaluateCondition, compare, parseActions } from "./conditions";
import { classifyRows, dedupeHash, normalizeDescription, parseAmount, parseCsvDate, parseRow, plaidMergeTarget } from "./csv";
import { detectRecurring, seriesStatus } from "./recurring";
import { completionScore, consecutiveCompleteDays, repeatedMisses } from "./scores";
import { previousMonthKeys, weekBounds, quarterBounds, todayInTz } from "./dates";

describe("dates", () => {
  it("lists previous full months", () => {
    expect(previousMonthKeys("2026-10-25", 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
  it("week and quarter bounds", () => {
    expect(weekBounds("2026-10-25")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(quarterBounds("2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });
  it("today in a time zone", () => {
    expect(todayInTz("America/New_York", new Date("2026-10-26T02:00:00Z"))).toBe("2026-10-25");
  });
});

describe("runway", () => {
  it("uses the default formula cash / (spending - income)", () => {
    const r = computeRunway({ cash: 30000, avgSpending: 6000, avgIncome: 1000 });
    expect(r.months).toBe(6);
    expect(r.netMonthlyBurn).toBe(5000);
  });
  it("returns null when income covers spending", () => {
    expect(computeRunway({ cash: 1000, avgSpending: 500, avgIncome: 800 }).months).toBeNull();
  });
  it("can ignore income", () => {
    expect(computeRunway({ cash: 12000, avgSpending: 4000, avgIncome: 1000, subtractIncome: false }).months).toBe(3);
  });
  it("averages the last full months and ignores transfers and the current month", () => {
    const txns = [
      { date: "2026-07-05", amount: -3000 },
      { date: "2026-08-05", amount: -6000 },
      { date: "2026-09-05", amount: -3000 },
      { date: "2026-09-15", amount: 1500 },
      { date: "2026-09-20", amount: -9999, is_transfer: true },
      { date: "2026-10-02", amount: -50000 },
    ];
    const a = monthlyAverages(txns, "2026-10-25", 3);
    expect(a.avgSpending).toBe(4000);
    expect(a.avgIncome).toBe(500);
    expect(a.monthsUsed).toBe(3);
  });
  it("does not dilute a short history", () => {
    const a = monthlyAverages([{ date: "2026-09-03", amount: -2000 }], "2026-10-25", 3);
    expect(a.monthsUsed).toBe(1);
    expect(a.avgSpending).toBe(2000);
  });
});

describe("debt payoff", () => {
  const debts = [
    { id: "a", name: "Card A", balance: 5000, apr: 24, minPayment: 150 },
    { id: "b", name: "Card B", balance: 1000, apr: 12, minPayment: 50 },
    { id: "c", name: "Loan C", balance: 8000, apr: 6, minPayment: 200 },
  ];
  it("orders by interest (avalanche) or by balance (snowball)", () => {
    expect(payoffOrder(debts, "avalanche")).toEqual(["a", "b", "c"]);
    expect(payoffOrder(debts, "snowball")).toEqual(["b", "a", "c"]);
  });
  it("pays off all debts and avalanche costs no more interest than snowball", () => {
    const av = debtPayoff(debts, "avalanche", 300);
    const sn = debtPayoff(debts, "snowball", 300);
    expect(av.feasible).toBe(true);
    expect(sn.feasible).toBe(true);
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
    expect(sn.payoffMonthByDebt.b).toBeLessThan(av.payoffMonthByDebt.b!);
    expect(av.schedule[av.schedule.length - 1].totalBalance).toBe(0);
  });
  it("a single zero-interest debt takes balance / payment months", () => {
    const r = debtPayoff([{ id: "x", name: "X", balance: 1200, apr: 0, minPayment: 100 }], "avalanche", 0);
    expect(r.months).toBe(12);
    expect(r.totalInterest).toBe(0);
  });
  it("reports infeasible when payments do not cover interest", () => {
    const r = debtPayoff([{ id: "x", name: "X", balance: 10000, apr: 30, minPayment: 100 }], "avalanche", 0);
    expect(r.feasible).toBe(false);
  });
});

describe("savings and financial security", () => {
  it("retirement target = spending / withdrawal rate", () => {
    expect(retirementTarget(80000, 4)).toBe(2000000);
    expect(retirementTarget(80000, 0)).toBeNull();
  });
  it("required monthly savings reaches the target", () => {
    const pmt = requiredMonthlySavings({ target: 1000000, currentBalance: 100000, annualReturnPct: 6, years: 25 })!;
    expect(pmt).toBeGreaterThan(0);
    expect(Math.abs(futureValue(100000, pmt, 6, 300) - 1000000)).toBeLessThan(5);
  });
  it("required savings is 0 when already on track, and works at 0% return", () => {
    expect(requiredMonthlySavings({ target: 100, currentBalance: 1000, annualReturnPct: 5, years: 10 })).toBe(0);
    expect(requiredMonthlySavings({ target: 12000, currentBalance: 0, annualReturnPct: 0, years: 1 })).toBe(1000);
  });
  it("emergency fund progress", () => {
    const e = emergencyFundProgress(9000, 3000, 6);
    expect(e.target).toBe(18000);
    expect(e.pct).toBe(50);
    expect(e.monthsCovered).toBe(3);
  });
  it("net worth does not count a linked debt twice", () => {
    const nw = netWorth(
      [
        { id: "chk", kind: "checking", balance: 10000 },
        { id: "card", kind: "credit_card", balance: 2000 },
        { id: "ira", kind: "retirement", balance: 50000 },
      ],
      [
        { account_id: "card", balance: 2000 },
        { account_id: null, balance: 5000 },
      ],
    );
    expect(nw).toEqual({ assets: 60000, liabilities: 7000, netWorth: 53000 });
  });
  it("budget variance", () => {
    const v = budgetVariance([{ category_id: "dining", current_monthly: 400, target_monthly: 250 }], { dining: 520 });
    expect(v.rows[0].variance).toBe(120);
    expect(v.rows[0].gapToTarget).toBe(150);
    expect(v.rows[0].overBudget).toBe(true);
  });
  it("loan repayment schedule pays back principal", () => {
    const rows = repaymentSchedule({ amount: 12000, annualRatePct: 5, termMonths: 12, frequency: "monthly", startDate: "2026-01-31" });
    expect(rows).toHaveLength(12);
    expect(rows[0].due_date).toBe("2026-02-28");
    expect(Math.round(rows.reduce((s, r) => s + r.principal, 0))).toBe(12000);
    const lump = repaymentSchedule({ amount: 10000, annualRatePct: 6, termMonths: 24, frequency: "lump_sum", startDate: "2026-01-01" });
    expect(lump[0].amount_due).toBe(11200);
  });
});

describe("scenario projection", () => {
  const base: Baseline = {
    startDate: "2026-10-25",
    cash: 20000,
    monthlySpending: 5000,
    monthlyIncome: 1000,
    debts: [{ id: "d1", name: "Card", balance: 2000, apr: 0, minPayment: 500 }],
    investmentBalance: 10000,
    otherAssets: 0,
    emergencyFundBalance: 5000,
    inputs: {
      expected_annual_return_pct: 0,
      emergency_fund_months: 6,
      retirement_annual_spending: 80000,
      withdrawal_rate_pct: 4,
      current_age: 40,
      retirement_age: 65,
      debt_extra_monthly_payment: 0,
    },
  };
  it("projects monthly cash including debt payments", () => {
    const r = projectScenario(base, {}, 12);
    expect(r.rows[0].cash).toBe(20000 + 1000 - 5000 - 500);
    expect(r.debtPayoffMonths).toBe(4);
    expect(r.rows[4].cash).toBe(20000 - 4 * 4500 - 4000); // month 5 has no debt payment
    expect(r.cashRunsOutMonth).toBe(5);
    expect(r.runwayFormulaMonths).toBe(5);
    expect(r.retirementTarget).toBe(2000000);
    expect(r.requiredMonthlyRetirementSavings).toBeGreaterThan(0);
  });
  it("applies overrides to baseline figures, inputs, and single debts", () => {
    const r = projectScenario(base, { monthly_spending: 3000, "debt.d1.min_payment": 1000, emergency_fund_months: 3 }, 12);
    expect(r.monthlySpending).toBe(3000);
    expect(r.debtPayoffMonths).toBe(2);
    expect(r.emergencyFund.target).toBe(9000);
    expect(r.runwayFormulaMonths).toBe(10);
  });
  it("job vs acquisition compares salary against salary plus equity", () => {
    const r = jobVsAcquisition({
      job_salary: 200000,
      job_bonus: 0,
      acquisition_salary: 150000,
      acquisition_equity_pct: 20,
      acquisition_business_value: 5000000,
      acquisition_debt: 4000000,
      acquisition_debt_years: 10,
      acquisition_value_growth_pct: 0,
      effective_tax_rate_pct: 0,
      comparison_years: 10,
    });
    expect(r.missing).toEqual([]);
    expect(r.rows[0].acquisitionEquityValue).toBe(200000); // 20% of (5M - 4M)
    expect(r.rows[10].acquisitionEquityValue).toBe(1000000); // debt repaid
    expect(r.rows[10].jobCumulative).toBe(2000000);
    expect(r.rows[10].acquisitionTotal).toBe(2500000);
    expect(r.crossoverYear).toBe(1);
  });
  it("lists missing inputs for job vs acquisition", () => {
    expect(jobVsAcquisition({ job_salary: null }).missing).toContain("job_salary");
  });
});

describe("decision conditions", () => {
  const cond = { id: "c", metric_key: "runway_months", operator: "lt" as const, threshold: 6, check_from: null, is_active: true, currently_met: false };
  it("compares with each operator", () => {
    expect(compare(5, "lt", 6)).toBe(true);
    expect(compare(6, "lte", 6)).toBe(true);
    expect(compare(7, "gt", 6)).toBe(true);
    expect(compare(6, "gte", 6)).toBe(true);
    expect(compare(6, "eq", 6)).toBe(true);
    expect(compare(5, "neq", 6)).toBe(true);
  });
  it("triggers once when the rule becomes true", () => {
    expect(evaluateCondition(cond, { runway_months: 5 }, "2026-10-25").transition).toBe("trigger");
    expect(evaluateCondition({ ...cond, currently_met: true }, { runway_months: 5 }, "2026-10-25").transition).toBe("none");
    expect(evaluateCondition({ ...cond, currently_met: true }, { runway_months: 8 }, "2026-10-25").transition).toBe("rearm");
  });
  it("treats a missing metric as not met and respects check_from and inactive rules", () => {
    expect(evaluateCondition(cond, { runway_months: null }, "2026-10-25").met).toBe(false);
    expect(evaluateCondition({ ...cond, check_from: "2027-06-30" }, { runway_months: 1 }, "2026-10-25").applicable).toBe(false);
    expect(evaluateCondition({ ...cond, is_active: false }, { runway_months: 1 }, "2026-10-25").transition).toBe("none");
  });
  it("parses only valid actions", () => {
    const a = parseActions([{ type: "create_task", title: "X" }, { type: "bad" }, { type: "open_decision", title: "D", options: ["a"] }]);
    expect(a).toHaveLength(2);
  });
});

describe("CSV import and duplicate checks", () => {
  it("parses amounts and dates", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("-5")).toBe(-5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseCsvDate("10/05/2026")).toBe("2026-10-05");
    expect(parseCsvDate("05/10/2026", "DD/MM/YYYY")).toBe("2026-10-05");
    expect(parseCsvDate("2026-10-05")).toBe("2026-10-05");
    expect(parseCsvDate("not a date")).toBeNull();
  });
  it("applies the saved column layout", () => {
    const layout = { date_column: "Date", description_column: "Desc", debit_column: "Debit", credit_column: "Credit", amount_sign: "negative_is_outflow" as const, date_format: "auto" as const };
    expect(parseRow({ Date: "10/01/2026", Desc: "NETFLIX", Debit: "15.99", Credit: "" }, layout, 1).amount).toBe(-15.99);
    expect(parseRow({ Date: "10/01/2026", Desc: "PAY", Debit: "", Credit: "100" }, layout, 2).amount).toBe(100);
    const pos = { date_column: "d", description_column: "x", amount_column: "a", amount_sign: "positive_is_outflow" as const, date_format: "auto" as const };
    expect(parseRow({ d: "2026-10-01", x: "Coffee", a: "4.50" }, pos, 1).amount).toBe(-4.5);
    expect(parseRow({ d: "", x: "Coffee", a: "4.50" }, pos, 1).error).toBe("Date could not be read");
  });
  it("normalizes descriptions so the same merchant matches", () => {
    expect(normalizeDescription("POS PURCHASE NETFLIX.COM #12345 10/01")).toBe(normalizeDescription("NETFLIX.COM 99887"));
  });
  it("gives the same key to the same purchase and finds duplicates", () => {
    const h1 = dedupeHash("acc", "2026-10-01", -15.99, "NETFLIX.COM 1234");
    const h2 = dedupeHash("acc", "2026-10-01", -15.99, "Netflix.com 5678");
    const h3 = dedupeHash("acc", "2026-10-02", -15.99, "NETFLIX.COM");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    const rows = classifyRows(
      [
        { externalId: null, hash: h1 },
        { externalId: null, hash: h3 },
        { externalId: null, hash: h3 },
        { externalId: "T9", hash: "zzz" },
      ],
      [
        { id: "e1", external_id: null, dedupe_hash: h1, source: "csv" },
        { id: "e2", external_id: "T9", dedupe_hash: "other", source: "plaid" },
      ],
    );
    expect(rows.map((r) => r.status)).toEqual(["duplicate", "new", "duplicate", "duplicate"]);
  });
  it("merges a Plaid row into a matching CSV row", () => {
    const existing = [
      { id: "csv1", external_id: null, dedupe_hash: "h", source: "csv" },
      { id: "p1", external_id: "plaid-1", dedupe_hash: "h2", source: "plaid" },
    ];
    expect(plaidMergeTarget("plaid-1", "x", existing)).toEqual({ action: "update", id: "p1" });
    expect(plaidMergeTarget("plaid-2", "h", existing)).toEqual({ action: "merge", id: "csv1" });
    expect(plaidMergeTarget("plaid-3", "new", existing)).toEqual({ action: "insert" });
  });
});

describe("recurring detection", () => {
  const monthly = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-04", "2026-09-03"].map((d, i) => ({
    id: `n${i}`,
    date: d,
    amount: -15.99,
    description: `NETFLIX.COM ${1000 + i}`,
  }));
  const weekly = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].map((d, i) => ({ id: `w${i}`, date: d, amount: -40, description: "FARMERS MARKET" }));
  const random = [
    { id: "r1", date: "2026-09-01", amount: -80, description: "HARDWARE STORE" },
    { id: "r2", date: "2026-09-19", amount: -12, description: "HARDWARE STORE" },
    { id: "r3", date: "2026-09-21", amount: -300, description: "HARDWARE STORE" },
  ];
  const yearly = [
    { id: "y1", date: "2025-03-10", amount: -99, description: "DOMAIN RENEWAL" },
    { id: "y2", date: "2026-03-11", amount: -99, description: "DOMAIN RENEWAL" },
  ];
  it("finds monthly, weekly, and yearly charges and ignores irregular ones", () => {
    const s = detectRecurring([...monthly, ...weekly, ...random, ...yearly, { id: "inc", date: "2026-09-01", amount: 5000, description: "PAYROLL" }]);
    const byName = Object.fromEntries(s.map((x) => [x.normalizedName, x]));
    expect(byName[normalizeDescription("NETFLIX.COM")].frequency).toBe("monthly");
    expect(byName[normalizeDescription("NETFLIX.COM")].monthlyCost).toBe(15.99);
    expect(byName[normalizeDescription("FARMERS MARKET")].frequency).toBe("weekly");
    expect(byName[normalizeDescription("DOMAIN RENEWAL")].frequency).toBe("yearly");
    expect(byName[normalizeDescription("HARDWARE STORE")]).toBeUndefined();
    expect(s.find((x) => x.normalizedName.includes("payroll"))).toBeUndefined();
  });
  it("marks a series ended after a missed cycle", () => {
    expect(seriesStatus("2026-08-01", "monthly", "2026-10-25")).toBe("ended");
    expect(seriesStatus("2026-10-20", "monthly", "2026-10-25")).toBe("active");
  });
});

describe("completion scores", () => {
  it("scores decided commitments in the period", () => {
    const s = completionScore(
      [
        { due_date: "2026-10-20", status: "met" },
        { due_date: "2026-10-21", status: "missed" },
        { due_date: "2026-10-22", status: "met" },
        { due_date: "2026-10-30", status: "open" },
        { due_date: "2026-09-01", status: "missed" },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(s).toEqual({ met: 2, missed: 1, total: 4, pct: 67 });
  });
  it("counts consecutive complete days", () => {
    const tasks = [
      { due_date: "2026-10-24", status: "done" },
      { due_date: "2026-10-24", status: "done" },
      { due_date: "2026-10-23", status: "done" },
      { due_date: "2026-10-21", status: "done" }, // 22nd had no tasks
      { due_date: "2026-10-20", status: "todo" },
      { due_date: "2026-10-25", status: "todo" },
    ];
    expect(consecutiveCompleteDays(tasks, "2026-10-25")).toBe(3);
  });
  it("lists repeated misses", () => {
    expect(repeatedMisses([{ commitment_id: "a" }, { commitment_id: "a" }, { commitment_id: "b" }])).toEqual({ a: 2 });
  });
});

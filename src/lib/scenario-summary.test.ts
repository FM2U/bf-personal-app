import { describe, expect, it } from "vitest";
import { bridgeComparison, jobVsAcquisition, projectScenario, type Baseline } from "./calc/scenario";
import { money } from "./format";
import { buildScenarioSummary, cashAt12, type SummaryColumn } from "./scenario-summary";

const ID = "3f2b8c1e-1234-4abc-9def-0123456789ab";
const ID2 = "9a8b7c6d-1234-4abc-9def-0123456789ab";
const INPUT_ID = "11111111-1111-4111-8111-111111111111";

const base: Baseline = {
  startDate: "2026-10-25",
  cash: 20000,
  monthlySpending: 5000,
  monthlyIncome: 1000,
  debts: [{ id: "d1", name: "Card", balance: 2000, apr: 0, minPayment: 500 }],
  investmentBalance: 10000,
  otherAssets: 0,
  emergencyFundBalance: 5000,
  inputs: { expected_annual_return_pct: 0, emergency_fund_months: 6, retirement_annual_spending: 80000, withdrawal_rate_pct: 4, current_age: 40, retirement_age: 65, debt_extra_monthly_payment: 0, job_salary: 150000, acquisition_salary: 130000, acquisition_equity_pct: 25, acquisition_business_value: 4000000, comparison_years: 5 },
};

function col(id: string | null, name: string, overrides: Record<string, number>, horizon = 24): SummaryColumn {
  const inputs = { ...base.inputs, ...overrides };
  return { id, name, overrides, horizon, result: projectScenario(base, overrides, horizon), jva: jobVsAcquisition(inputs), bridge: bridgeComparison(inputs) };
}

const inputs = { job_salary: { id: INPUT_ID, label: "Job: yearly salary", unit: "usd", value: 150000 } };
const baseline = { starting_cash: 20000, monthly_spending: 5000, monthly_income: 1000, monthly_investment_contribution: 0, one_time_amount: 0, one_time_month: 0 };
const debts = [{ id: "d1", name: "Card", apr: 0, minPayment: 500 }];

describe("scenario summary", () => {
  const current = col(null, "Current numbers", {});
  const sc = col(ID, "Cut spending", { monthly_spending: 3000, job_salary: 180000, "debt.d1.min_payment": 1000 });
  const s = buildScenarioSummary({ columns: [sc], current, inputs, baseline, debts });

  it("lists the numbers changed with the current value and the scenario value", () => {
    expect(s.changed).toHaveLength(1);
    const lines = s.changed[0].lines;
    expect(lines.find((l) => l.label === "Monthly spending")).toMatchObject({ from: "$5,000", to: "$3,000" });
    expect(lines.find((l) => l.label === "Card: monthly payment")).toMatchObject({ from: "$500", to: "$1,000" });
  });
  it("every line drills down: an input opens its quick view in the window, the rest open the full page section", () => {
    expect(s.changed[0].lines.find((l) => l.label === "Job: yearly salary")?.window).toBe(`r/inputs/${INPUT_ID}`);
    expect(s.changed[0].lines.find((l) => l.label === "Monthly spending")?.href).toBe(`/plan/scenarios/${ID}#overrides`);
    for (const l of [...s.results, ...s.savings, ...s.paths]) expect(l.href || l.window).toBeTruthy();
    expect(s.results.find((l) => l.label === "Cash at 12 months")?.href).toBe(`/plan/scenarios/${ID}#cash`);
    expect(s.paths[0].href).toBe(`/plan/scenarios/${ID}#job-vs-acquisition`);
  });
  it("results: runway, cash at 12 months, debt payoff, net worth, savings targets, job vs acquisition and the bridge, one value per column", () => {
    const labels = [...s.results, ...s.savings, ...s.paths].map((l) => l.label);
    for (const want of ["Runway", "Cash at 12 months", "Debt payoff date", "Net worth at the end", "Emergency fund target", "Required monthly retirement savings", "Acquisition ahead from", "Bridge ahead from"]) expect(labels).toContain(want);
    for (const l of [...s.results, ...s.savings, ...s.paths]) expect(l.values).toHaveLength(2);
    expect(cashAt12(sc.result)).toBe(sc.result.rows[11].cash);
    expect(s.results.find((l) => l.label === "Cash at 12 months")?.values[1]).toBe(money(sc.result.rows[11].cash));
  });
  it("charts: cash per month and acquisition minus job per year, one series per column", () => {
    expect(s.cash).toHaveLength(24);
    expect(Object.keys(s.cash[0])).toEqual(["month", "c0", "c1"]);
    expect(s.pathGap).toHaveLength(6);
  });
  it("compares several scenarios, each with its own changed numbers, and opens the comparison page", () => {
    const two = buildScenarioSummary({ columns: [sc, col(ID2, "Job offer", { job_salary: 200000 })], current, inputs, baseline, debts });
    expect(two.columns).toEqual(["Current numbers", "Cut spending", "Job offer"]);
    expect(two.changed.map((c) => c.scenario)).toEqual(["Cut spending", "Job offer"]);
    expect(two.fullHref).toBe(`/plan/scenarios/compare?ids=${ID},${ID2}`);
    expect(two.results[0].values).toHaveLength(3);
  });
});

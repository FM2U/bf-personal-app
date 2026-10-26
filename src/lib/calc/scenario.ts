import { addMonthsISO } from "./dates";
import { debtPayoff, type DebtInput, type PayoffMethod } from "./debt";
import { round2 } from "./runway";
import { emergencyFundProgress, requiredMonthlySavings, retirementTarget } from "./savings";

export type Baseline = {
  startDate: string;
  cash: number;
  monthlySpending: number;
  monthlyIncome: number;
  debts: DebtInput[];
  investmentBalance: number;
  otherAssets: number;
  emergencyFundBalance: number;
  /** Values from Inputs and Assumptions, keyed by input key */
  inputs: Record<string, number | null>;
  /** Text inputs (example: debt_payoff_method) */
  textInputs?: Record<string, string | null>;
};

/** Keys a scenario can change besides any input key. */
export const BASELINE_OVERRIDE_KEYS: { key: string; label: string }[] = [
  { key: "starting_cash", label: "Starting cash" },
  { key: "monthly_spending", label: "Monthly spending" },
  { key: "monthly_income", label: "Monthly income" },
  { key: "monthly_investment_contribution", label: "Monthly retirement and investment contribution" },
  { key: "one_time_amount", label: "One-time expense (negative) or income (positive)" },
  { key: "one_time_month", label: "Month number of the one-time amount" },
];

export type ScenarioOverrides = Record<string, number>;

export type ProjectionRow = {
  month: number;
  date: string;
  cash: number;
  debtBalance: number;
  investments: number;
  netWorth: number;
};

export type ScenarioResult = {
  rows: ProjectionRow[];
  runwayFormulaMonths: number | null;
  /** First month in which projected cash falls below zero, or null if it never does within the horizon */
  cashRunsOutMonth: number | null;
  debtPayoffMonths: number | null;
  debtPayoffDate: string | null;
  debtFeasible: boolean;
  totalInterest: number;
  netWorthStart: number;
  netWorthEnd: number;
  emergencyFund: ReturnType<typeof emergencyFundProgress>;
  retirementTarget: number | null;
  requiredMonthlyRetirementSavings: number | null;
  monthlySpending: number;
  monthlyIncome: number;
};

/** Apply overrides: input keys change inputs; debt.<id>.<field> changes one debt; other keys change baseline figures. */
export function applyOverrides(base: Baseline, o: ScenarioOverrides) {
  const inputs = { ...base.inputs };
  const debts = base.debts.map((d) => ({ ...d }));
  for (const [key, value] of Object.entries(o)) {
    if (key.startsWith("debt.")) {
      const [, id, field] = key.split(".");
      const d = debts.find((x) => x.id === id);
      if (!d) continue;
      if (field === "apr") d.apr = value;
      if (field === "min_payment") d.minPayment = value;
      if (field === "balance") d.balance = value;
    } else if (key in inputs || !BASELINE_OVERRIDE_KEYS.some((b) => b.key === key)) {
      inputs[key] = value;
    }
  }
  return {
    inputs,
    debts,
    cash: o.starting_cash ?? base.cash,
    spending: o.monthly_spending ?? base.monthlySpending,
    income: o.monthly_income ?? base.monthlyIncome,
    contribution: o.monthly_investment_contribution ?? 0,
    oneTimeAmount: o.one_time_amount ?? 0,
    oneTimeMonth: o.one_time_month ?? 0,
    consultingMonthly: Math.max(0, inputs.consulting_monthly_income ?? 0),
    consultingMonths: Math.max(0, Math.round(inputs.consulting_months ?? 0)),
  };
}

export function projectScenario(base: Baseline, overrides: ScenarioOverrides, horizonMonths: number): ScenarioResult {
  const s = applyOverrides(base, overrides);
  const method = (base.textInputs?.debt_payoff_method === "snowball" ? "snowball" : "avalanche") as PayoffMethod;
  const extra = s.inputs.debt_extra_monthly_payment ?? 0;
  const payoff = debtPayoff(s.debts, method, extra, Math.max(horizonMonths, 600));
  const startDebt = s.debts.reduce((t, d) => t + Math.max(0, d.balance), 0);
  const r = (s.inputs.expected_annual_return_pct ?? 0) / 100 / 12;

  const rows: ProjectionRow[] = [];
  let cash = s.cash;
  let investments = base.investmentBalance;
  let cashRunsOutMonth: number | null = null;
  for (let m = 1; m <= horizonMonths; m++) {
    const debtRow = payoff.schedule[m - 1];
    const debtPayment = debtRow ? debtRow.payment : 0;
    const debtBalance = debtRow ? debtRow.totalBalance : payoff.feasible ? 0 : startDebt;
    cash += s.income - s.spending - debtPayment - s.contribution;
    // Consulting income (Inputs: consulting_monthly_income for consulting_months months, starting next month).
    if (m <= s.consultingMonths) cash += s.consultingMonthly;
    if (m === Math.round(s.oneTimeMonth)) cash += s.oneTimeAmount;
    investments = investments * (1 + r) + s.contribution;
    if (cash < 0 && cashRunsOutMonth === null) cashRunsOutMonth = m;
    rows.push({
      month: m,
      date: addMonthsISO(base.startDate, m),
      cash: round2(cash),
      debtBalance: round2(debtBalance),
      investments: round2(investments),
      netWorth: round2(cash + investments + base.otherAssets - debtBalance),
    });
  }

  const burn = s.spending - s.income;
  const target = retirementTarget(s.inputs.retirement_annual_spending ?? 0, s.inputs.withdrawal_rate_pct ?? 0);
  const years = (s.inputs.retirement_age ?? 0) - (s.inputs.current_age ?? NaN);
  const required =
    target !== null && Number.isFinite(years) && years > 0
      ? requiredMonthlySavings({
          target,
          currentBalance: base.investmentBalance,
          annualReturnPct: s.inputs.expected_annual_return_pct ?? 0,
          years,
        })
      : null;
  const debtPayoffMonths = payoff.feasible ? payoff.months : null;
  return {
    rows,
    runwayFormulaMonths: burn > 0 ? round2(Math.max(0, s.cash) / burn) : null,
    cashRunsOutMonth,
    debtPayoffMonths,
    debtPayoffDate: debtPayoffMonths !== null ? addMonthsISO(base.startDate, debtPayoffMonths) : null,
    debtFeasible: payoff.feasible,
    totalInterest: payoff.totalInterest,
    netWorthStart: round2(s.cash + base.investmentBalance + base.otherAssets - startDebt),
    netWorthEnd: rows.length ? rows[rows.length - 1].netWorth : round2(s.cash + base.investmentBalance + base.otherAssets - startDebt),
    emergencyFund: emergencyFundProgress(base.emergencyFundBalance, s.spending, s.inputs.emergency_fund_months ?? 6),
    retirementTarget: target,
    requiredMonthlyRetirementSavings: required,
    monthlySpending: s.spending,
    monthlyIncome: s.income,
  };
}

export type JobVsAcqRow = {
  year: number;
  jobCumulative: number;
  acquisitionSalaryCumulative: number;
  acquisitionEquityValue: number;
  acquisitionTotal: number;
  difference: number;
};

/**
 * Job vs acquisition: salary-only take-home pay versus acquisition take-home salary plus the value of your equity.
 * Equity value in year y = equity share x max(0, business value x (1 + growth)^y - remaining purchase debt).
 * Purchase debt is repaid in equal yearly amounts over the repayment years.
 */
export function jobVsAcquisition(inputs: Record<string, number | null>): {
  rows: JobVsAcqRow[];
  crossoverYear: number | null;
  missing: string[];
} {
  const required = ["job_salary", "acquisition_salary", "acquisition_equity_pct", "acquisition_business_value"];
  const missing = required.filter((k) => inputs[k] === null || inputs[k] === undefined);
  const tax = (inputs.effective_tax_rate_pct ?? 0) / 100;
  const years = Math.max(1, Math.round(inputs.comparison_years ?? 10));
  const jobAnnual = ((inputs.job_salary ?? 0) + (inputs.job_bonus ?? 0)) * (1 - tax);
  const acqAnnual = (inputs.acquisition_salary ?? 0) * (1 - tax);
  const equity = (inputs.acquisition_equity_pct ?? 0) / 100;
  const value0 = inputs.acquisition_business_value ?? 0;
  const debt0 = inputs.acquisition_debt ?? 0;
  const debtYears = Math.max(1, inputs.acquisition_debt_years ?? 10);
  const g = (inputs.acquisition_value_growth_pct ?? 0) / 100;
  const rows: JobVsAcqRow[] = [];
  let crossoverYear: number | null = null;
  for (let y = 0; y <= years; y++) {
    const remainingDebt = Math.max(0, debt0 - (debt0 / debtYears) * y);
    const equityValue = equity * Math.max(0, value0 * Math.pow(1 + g, y) - remainingDebt);
    const jobCum = jobAnnual * y;
    const acqSal = acqAnnual * y;
    const total = acqSal + equityValue;
    if (crossoverYear === null && y > 0 && total > jobCum) crossoverYear = y;
    rows.push({
      year: y,
      jobCumulative: round2(jobCum),
      acquisitionSalaryCumulative: round2(acqSal),
      acquisitionEquityValue: round2(equityValue),
      acquisitionTotal: round2(total),
      difference: round2(total - jobCum),
    });
  }
  return { rows, crossoverYear, missing };
}

export type BridgeRow = {
  year: number;
  jobCumulative: number;
  /** Take-home consulting income received so far (during the search and after, for consulting_months). */
  consultingCumulative: number;
  /** Take-home acquisition salary received so far (starts after the search). */
  acquisitionSalaryCumulative: number;
  acquisitionEquityValue: number;
  /** Consulting + acquisition salary + equity value. */
  bridgeTotal: number;
  /** The same path without consulting income: acquisition salary + equity value. */
  withoutConsultingTotal: number;
  difference: number;
};

/**
 * Bridge comparison: a job, versus an acquisition search with consulting income during the search.
 * Month by month over comparison_years:
 *   Job: (job salary + bonus) / 12 after tax, every month.
 *   Bridge: no salary during the search (acquisition_search_months_allowed months), then acquisition salary / 12 after tax;
 *           plus consulting_monthly_income after tax for the first consulting_months months;
 *           plus equity value from the acquisition on (same equity formula as jobVsAcquisition, years counted from the acquisition).
 * Rows are given at the end of each year (year 0 = today).
 */
export function bridgeComparison(inputs: Record<string, number | null>): { rows: BridgeRow[]; crossoverYear: number | null; missing: string[]; searchMonths: number; consultingMonths: number; consultingMonthly: number } {
  const required = ["job_salary", "acquisition_salary", "acquisition_equity_pct", "acquisition_business_value"];
  const missing = required.filter((k) => inputs[k] === null || inputs[k] === undefined);
  const tax = (inputs.effective_tax_rate_pct ?? 0) / 100;
  const years = Math.max(1, Math.round(inputs.comparison_years ?? 10));
  const searchMonths = Math.max(0, Math.round(inputs.acquisition_search_months_allowed ?? 12));
  const consultingMonthly = Math.max(0, inputs.consulting_monthly_income ?? 0);
  const consultingMonths = Math.max(0, Math.round(inputs.consulting_months ?? 12));
  const jobMonthly = (((inputs.job_salary ?? 0) + (inputs.job_bonus ?? 0)) * (1 - tax)) / 12;
  const acqMonthly = ((inputs.acquisition_salary ?? 0) * (1 - tax)) / 12;
  const consultingNet = consultingMonthly * (1 - tax);
  const equity = (inputs.acquisition_equity_pct ?? 0) / 100;
  const value0 = inputs.acquisition_business_value ?? 0;
  const debt0 = inputs.acquisition_debt ?? 0;
  const debtYears = Math.max(1, inputs.acquisition_debt_years ?? 10);
  const g = (inputs.acquisition_value_growth_pct ?? 0) / 100;
  const equityAt = (month: number) => {
    if (month <= searchMonths) return 0;
    const ys = (month - searchMonths) / 12;
    const remainingDebt = Math.max(0, debt0 - (debt0 / debtYears) * ys);
    return equity * Math.max(0, value0 * Math.pow(1 + g, ys) - remainingDebt);
  };
  const rows: BridgeRow[] = [];
  let job = 0;
  let consulting = 0;
  let salary = 0;
  let crossoverYear: number | null = null;
  const push = (y: number, month: number) => {
    const eq = equityAt(month);
    const total = consulting + salary + eq;
    if (crossoverYear === null && y > 0 && total > job) crossoverYear = y;
    rows.push({
      year: y,
      jobCumulative: round2(job),
      consultingCumulative: round2(consulting),
      acquisitionSalaryCumulative: round2(salary),
      acquisitionEquityValue: round2(eq),
      bridgeTotal: round2(total),
      withoutConsultingTotal: round2(salary + eq),
      difference: round2(total - job),
    });
  };
  push(0, 0);
  for (let m = 1; m <= years * 12; m++) {
    job += jobMonthly;
    if (m <= consultingMonths) consulting += consultingNet;
    if (m > searchMonths) salary += acqMonthly;
    if (m % 12 === 0) push(m / 12, m);
  }
  return { rows, crossoverYear, missing, searchMonths, consultingMonths, consultingMonthly };
}

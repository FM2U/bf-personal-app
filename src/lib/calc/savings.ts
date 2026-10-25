import { round2 } from "./runway";

/** Retirement target = yearly spending in retirement / withdrawal rate. Example: 80,000 / 4% = 2,000,000. */
export function retirementTarget(annualSpending: number, withdrawalRatePct: number): number | null {
  if (!withdrawalRatePct || withdrawalRatePct <= 0) return null;
  return round2(annualSpending / (withdrawalRatePct / 100));
}

/**
 * Monthly amount needed to reach `target` in `years`, starting from `currentBalance`,
 * with monthly compounding at `annualReturnPct`.
 * Formula: PMT = (FV - PV(1+r)^n) * r / ((1+r)^n - 1). Returns 0 when the current balance is already enough.
 */
export function requiredMonthlySavings(params: {
  target: number;
  currentBalance: number;
  annualReturnPct: number;
  years: number;
}): number | null {
  const { target, currentBalance, annualReturnPct, years } = params;
  if (!(years > 0)) return null;
  const n = Math.round(years * 12);
  const r = annualReturnPct / 100 / 12;
  const growth = Math.pow(1 + r, n);
  const fvOfCurrent = currentBalance * growth;
  const gap = target - fvOfCurrent;
  if (gap <= 0) return 0;
  const pmt = r === 0 ? gap / n : (gap * r) / (growth - 1);
  return round2(pmt);
}

/** Future value of a balance plus monthly contributions. */
export function futureValue(currentBalance: number, monthly: number, annualReturnPct: number, months: number): number {
  const r = annualReturnPct / 100 / 12;
  if (r === 0) return round2(currentBalance + monthly * months);
  const g = Math.pow(1 + r, months);
  return round2(currentBalance * g + (monthly * (g - 1)) / r);
}

/** Emergency fund target = months x average monthly spending. */
export function emergencyFundProgress(balance: number, avgMonthlySpending: number, months: number) {
  const target = round2(avgMonthlySpending * months);
  const pct = target > 0 ? Math.min(100, round2((balance / target) * 100)) : null;
  const monthsCovered = avgMonthlySpending > 0 ? round2(balance / avgMonthlySpending) : null;
  return { target, balance: round2(balance), pct, monthsCovered, remaining: round2(Math.max(0, target - balance)) };
}

export type AccountKind = "checking" | "savings" | "cash" | "credit_card" | "loan" | "investment" | "retirement" | "other_asset";

export const ASSET_KINDS: AccountKind[] = ["checking", "savings", "cash", "investment", "retirement", "other_asset"];
export const CASH_KINDS: AccountKind[] = ["checking", "savings", "cash"];
export const LIABILITY_KINDS: AccountKind[] = ["credit_card", "loan"];

/**
 * Net worth = assets - debts. Liability account balances are treated as positive amounts owed.
 * Debts not linked to an account are added from their recorded balance.
 */
export function netWorth(
  accounts: { id: string; kind: AccountKind; balance: number }[],
  debts: { account_id: string | null; balance: number }[],
) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (ASSET_KINDS.includes(a.kind)) assets += a.balance;
    else if (LIABILITY_KINDS.includes(a.kind)) liabilities += Math.abs(a.balance);
  }
  const accountIds = new Set(accounts.map((a) => a.id));
  for (const d of debts) {
    if (d.account_id && accountIds.has(d.account_id)) continue;
    liabilities += Math.abs(d.balance);
  }
  return { assets: round2(assets), liabilities: round2(liabilities), netWorth: round2(assets - liabilities) };
}

/** Budget variance per category: actual - current budget. Gap to target = current budget - target budget. */
export function budgetVariance(
  lines: { category_id: string; current_monthly: number; target_monthly: number }[],
  actualByCategory: Record<string, number>,
) {
  const rows = lines.map((l) => {
    const actual = round2(actualByCategory[l.category_id] ?? 0);
    return {
      category_id: l.category_id,
      current: l.current_monthly,
      target: l.target_monthly,
      actual,
      variance: round2(actual - l.current_monthly),
      gapToTarget: round2(l.current_monthly - l.target_monthly),
      overBudget: actual > l.current_monthly,
    };
  });
  const totals = rows.reduce(
    (t, r) => ({ current: t.current + r.current, target: t.target + r.target, actual: t.actual + r.actual }),
    { current: 0, target: 0, actual: 0 },
  );
  return {
    rows,
    totals: {
      current: round2(totals.current),
      target: round2(totals.target),
      actual: round2(totals.actual),
      variance: round2(totals.actual - totals.current),
      gapToTarget: round2(totals.current - totals.target),
    },
  };
}

/** Repayment schedule for a loan received (equal payments; interest-only rate 0 handled). */
export function repaymentSchedule(params: {
  amount: number;
  annualRatePct: number;
  termMonths: number;
  frequency: "monthly" | "quarterly" | "annually" | "lump_sum" | "none";
  startDate: string; // first payment is one period after this date
}): { due_date: string; amount_due: number; principal: number; interest: number }[] {
  const { amount, annualRatePct, termMonths, frequency, startDate } = params;
  if (frequency === "none" || !(amount > 0) || !(termMonths > 0)) return [];
  const addMonths = (s: string, m: number) => {
    const [y, mo, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1 + m, 1));
    const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, lastDay));
    return dt.toISOString().slice(0, 10);
  };
  if (frequency === "lump_sum") {
    const interest = round2(amount * (annualRatePct / 100) * (termMonths / 12));
    return [{ due_date: addMonths(startDate, termMonths), amount_due: round2(amount + interest), principal: amount, interest }];
  }
  const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const n = Math.max(1, Math.ceil(termMonths / step));
  const r = annualRatePct / 100 / (12 / step);
  const payment = r === 0 ? amount / n : (amount * r) / (1 - Math.pow(1 + r, -n));
  const rows = [];
  let balance = amount;
  for (let i = 1; i <= n; i++) {
    const interest = balance * r;
    let principal = payment - interest;
    if (i === n) principal = balance;
    balance -= principal;
    rows.push({
      due_date: addMonths(startDate, i * step),
      amount_due: round2(principal + interest),
      principal: round2(principal),
      interest: round2(interest),
    });
  }
  return rows;
}

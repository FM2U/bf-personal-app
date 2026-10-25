import { round2 } from "./runway";

export type DebtInput = { id: string; name: string; balance: number; apr: number; minPayment: number };
export type PayoffMethod = "avalanche" | "snowball";

export type PayoffResult = {
  method: PayoffMethod;
  /** false when payments never cover interest within the month limit */
  feasible: boolean;
  months: number;
  totalInterest: number;
  totalPaid: number;
  order: string[];
  payoffMonthByDebt: Record<string, number | null>;
  /** Balance per debt after each month (index 0 = after month 1) */
  schedule: { month: number; totalBalance: number; interest: number; payment: number; balances: Record<string, number> }[];
};

/** Payoff order: avalanche = highest interest first; snowball = smallest balance first. */
export function payoffOrder(debts: DebtInput[], method: PayoffMethod): string[] {
  const sorted = [...debts].filter((d) => d.balance > 0);
  if (method === "avalanche") sorted.sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  else sorted.sort((a, b) => a.balance - b.balance || b.apr - a.apr);
  return sorted.map((d) => d.id);
}

/**
 * Month-by-month payoff. Each month: interest is added (APR / 12), every debt gets its minimum payment,
 * then the extra payment plus minimums freed by paid-off debts go to the first unpaid debt in the order.
 */
export function debtPayoff(debts: DebtInput[], method: PayoffMethod, extraMonthly = 0, maxMonths = 600): PayoffResult {
  const order = payoffOrder(debts, method);
  const bal: Record<string, number> = {};
  const byId: Record<string, DebtInput> = {};
  for (const d of debts) {
    bal[d.id] = Math.max(0, d.balance);
    byId[d.id] = d;
  }
  const payoffMonthByDebt: Record<string, number | null> = {};
  for (const d of debts) payoffMonthByDebt[d.id] = d.balance > 0 ? null : 0;
  const totalBudget = debts.reduce((s, d) => s + (d.balance > 0 ? d.minPayment : 0), 0) + Math.max(0, extraMonthly);
  const schedule: PayoffResult["schedule"] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const remaining = () => order.reduce((s, id) => s + bal[id], 0);

  while (remaining() > 0.005 && month < maxMonths) {
    month++;
    let interestThisMonth = 0;
    for (const id of order) {
      if (bal[id] <= 0) continue;
      const i = (bal[id] * byId[id].apr) / 100 / 12;
      bal[id] += i;
      interestThisMonth += i;
    }
    let budget = totalBudget;
    let paidThisMonth = 0;
    // Minimum payments first
    for (const id of order) {
      if (bal[id] <= 0) continue;
      const pay = Math.min(byId[id].minPayment, bal[id], budget);
      bal[id] -= pay;
      budget -= pay;
      paidThisMonth += pay;
    }
    // Remaining budget to debts in order
    for (const id of order) {
      if (budget <= 0) break;
      if (bal[id] <= 0) continue;
      const pay = Math.min(bal[id], budget);
      bal[id] -= pay;
      budget -= pay;
      paidThisMonth += pay;
    }
    for (const id of order) {
      if (bal[id] < 0.005) bal[id] = 0;
      if (bal[id] === 0 && payoffMonthByDebt[id] === null) payoffMonthByDebt[id] = month;
    }
    totalInterest += interestThisMonth;
    totalPaid += paidThisMonth;
    schedule.push({
      month,
      totalBalance: round2(remaining()),
      interest: round2(interestThisMonth),
      payment: round2(paidThisMonth),
      balances: Object.fromEntries(order.map((id) => [id, round2(bal[id])])),
    });
    // Stop early when balances grow (payments do not cover interest)
    if (month > 24 && schedule[month - 1].totalBalance >= schedule[month - 13].totalBalance) {
      return { method, feasible: false, months: month, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid), order, payoffMonthByDebt, schedule };
    }
  }
  return {
    method,
    feasible: remaining() <= 0.005,
    months: month,
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid),
    order,
    payoffMonthByDebt,
    schedule,
  };
}

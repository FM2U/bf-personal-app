import { previousMonthKeys } from "./dates";

export type CashTxn = { date: string; amount: number; is_transfer?: boolean };

/**
 * Average monthly spending and income over the last `lookbackMonths` full calendar months.
 * Months before the first transaction are not counted, so a short history is not diluted.
 * Spending is money out (amount < 0); income is money in (amount > 0). Transfers are ignored.
 */
export function monthlyAverages(
  txns: CashTxn[],
  today: string,
  lookbackMonths: number,
): { avgSpending: number; avgIncome: number; monthsUsed: number; byMonth: { month: string; spending: number; income: number }[] } {
  const keys = previousMonthKeys(today, Math.max(1, Math.round(lookbackMonths)));
  const totals = new Map(keys.map((k) => [k, { spending: 0, income: 0 }]));
  let earliest: string | null = null;
  for (const t of txns) {
    if (t.is_transfer) continue;
    if (!earliest || t.date < earliest) earliest = t.date;
    const k = t.date.slice(0, 7);
    const m = totals.get(k);
    if (!m) continue;
    if (t.amount < 0) m.spending += -t.amount;
    else m.income += t.amount;
  }
  const earliestKey = earliest ? earliest.slice(0, 7) : null;
  const used = keys.filter((k) => earliestKey !== null && k >= earliestKey);
  const n = used.length;
  const byMonth = keys.map((k) => ({ month: k, ...totals.get(k)! }));
  if (n === 0) return { avgSpending: 0, avgIncome: 0, monthsUsed: 0, byMonth };
  const sum = used.reduce(
    (acc, k) => {
      const m = totals.get(k)!;
      return { s: acc.s + m.spending, i: acc.i + m.income };
    },
    { s: 0, i: 0 },
  );
  return { avgSpending: round2(sum.s / n), avgIncome: round2(sum.i / n), monthsUsed: n, byMonth };
}

export type RunwayResult = {
  /** Months of cash remaining. null means cash is not decreasing (income covers spending). */
  months: number | null;
  cash: number;
  avgSpending: number;
  avgIncome: number;
  /** Signed consulting income added to income (0 when the runway setting is off). */
  signedConsultingMonthly: number;
  netMonthlyBurn: number;
};

/**
 * Default formula: available cash / (average monthly spending - average monthly income).
 * `signedConsultingMonthly` (input runway_include_signed_consulting = 1): expected monthly income from signed consulting
 * work, added to average monthly income (it is added even when average income is not subtracted).
 */
export function computeRunway(params: {
  cash: number;
  avgSpending: number;
  avgIncome: number;
  subtractIncome?: boolean;
  signedConsultingMonthly?: number;
}): RunwayResult {
  const subtract = params.subtractIncome ?? true;
  const consulting = Math.max(0, params.signedConsultingMonthly ?? 0);
  const burn = params.avgSpending - (subtract ? params.avgIncome : 0) - consulting;
  const months = burn > 0 ? round1(Math.max(0, params.cash) / burn) : null;
  return {
    months,
    cash: round2(params.cash),
    avgSpending: params.avgSpending,
    avgIncome: params.avgIncome,
    signedConsultingMonthly: round2(consulting),
    netMonthlyBurn: round2(burn),
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/**
 * Plain explanation of the runway formula in use, including whether signed consulting income is counted
 * (input runway_include_signed_consulting). Shown under the runway figure.
 */
export function runwayExplanation(p: { lookbackMonths: number; subtractIncome: boolean; includeSignedConsulting: boolean; signedConsultingMonthly: number; settingAvailable?: boolean }): string {
  const months = Math.max(1, Math.round(p.lookbackMonths));
  const base = p.subtractIncome
    ? `Cash divided by (average monthly spending minus average monthly income), last ${months} months.`
    : `Cash divided by average monthly spending, last ${months} months (income not subtracted).`;
  const usd = `$${Math.round(p.signedConsultingMonthly).toLocaleString("en-US")}`;
  const consulting = p.includeSignedConsulting
    ? ` Signed consulting income is counted: ${usd} per month expected from Signed and Active consulting work is added to income.`
    : p.settingAvailable === false
      ? ""
      : " Signed consulting income is not counted (Inputs: Count signed consulting income in runway = 0).";
  return base + consulting;
}

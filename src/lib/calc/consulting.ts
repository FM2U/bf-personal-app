import { daysBetween } from "./dates";
import { round2 } from "./runway";

/**
 * Consulting engagements: expected monthly income, probability, pipeline value, and signed income for runway.
 * Pure functions (tested). The loader is src/lib/consulting.ts.
 *
 * Model (database update 0011, table consulting_details): `rate` is the price for the rate type:
 *   hourly            rate per hour; expected monthly income = rate x expected hours per month
 *   monthly_retainer  rate per month; expected monthly income = rate
 *   project           the whole project fee; expected monthly income = rate / project months
 *                     (project months empty: the months from start date to end date)
 * Expected monthly income is always calculated, never typed.
 */

export type RateType = "hourly" | "project" | "monthly_retainer";

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  hourly: "Hourly",
  project: "Project (fixed fee)",
  monthly_retainer: "Monthly retainer",
};

export type ConsultingTerms = {
  rate_type?: string | null;
  rate?: number | string | null;
  expected_hours_per_month?: number | string | null;
  project_months?: number | string | null;
  start_date?: string | null;
  end_date?: string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Months a project runs: project months when set, otherwise start to end date (30.44 days a month, at least 1). */
export function projectMonths(d: ConsultingTerms): number | null {
  const m = num(d.project_months);
  if (m !== null && m > 0) return m;
  if (d.start_date && d.end_date && d.end_date >= d.start_date) {
    return Math.max(1, round2((daysBetween(d.start_date, d.end_date) + 1) / 30.44));
  }
  return null;
}

/** Expected monthly income for the rate type, or null when a number it needs is missing. */
export function expectedMonthlyIncome(d: ConsultingTerms | null | undefined): number | null {
  if (!d) return null;
  const rate = num(d.rate);
  if (rate === null) return null;
  if (d.rate_type === "monthly_retainer") return round2(rate);
  if (d.rate_type === "hourly") {
    const hours = num(d.expected_hours_per_month);
    return hours === null ? null : round2(rate * hours);
  }
  if (d.rate_type === "project") {
    const months = projectMonths(d);
    return months === null ? null : round2(rate / months);
  }
  return null;
}

/** What is missing for the calculation, in plain words (shown where the income would be). */
export function expectedIncomeGap(d: ConsultingTerms | null | undefined): string | null {
  if (!d || !d.rate_type) return "Choose the rate type";
  if (num(d.rate) === null) return d.rate_type === "project" ? "Add the project fee" : "Add the rate";
  if (d.rate_type === "hourly" && num(d.expected_hours_per_month) === null) return "Add expected hours per month";
  if (d.rate_type === "project" && projectMonths(d) === null) return "Add project months, or start and end dates";
  return null;
}

/** The item's own probability when set, otherwise the stage default, otherwise 0. Kept between 0 and 100. */
export function effectiveProbability(itemPct: number | string | null | undefined, stagePct: number | string | null | undefined): number {
  const v = num(itemPct) ?? num(stagePct) ?? 0;
  return Math.min(100, Math.max(0, v));
}

export type PipelineValueItem = { status: string; expectedMonthly: number | null; probabilityPct: number };

/** Pipeline value = sum over open items of expected monthly income x probability. Items without income count 0. */
export function pipelineValue(items: PipelineValueItem[]): number {
  return round2(items.filter((i) => i.status === "open").reduce((s, i) => s + (i.expectedMonthly ?? 0) * (i.probabilityPct / 100), 0));
}

/** True when today is between the start and end dates (an empty date does not limit). */
export function withinDates(d: { start_date?: string | null; end_date?: string | null }, today: string): boolean {
  if (d.start_date && d.start_date > today) return false;
  if (d.end_date && d.end_date < today) return false;
  return true;
}

export type SignedItem = { status: string; signedStage: boolean; terms: ConsultingTerms | null };

/**
 * Expected monthly income from signed work: open items in a stage marked as signed work (Signed, Active)
 * that are between their start and end dates today. Used by runway when runway_include_signed_consulting = 1.
 */
export function signedMonthlyIncome(items: SignedItem[], today: string): number {
  return round2(
    items
      .filter((i) => i.status === "open" && i.signedStage && i.terms && withinDates(i.terms, today))
      .reduce((s, i) => s + (expectedMonthlyIncome(i.terms) ?? 0), 0),
  );
}

export type Payment = { date: string; amount: number | string };

/** Payments received on an engagement: count, total, and last payment date (money in only). */
export function paymentSummary(payments: Payment[]): { count: number; total: number; lastDate: string | null } {
  const inflows = payments.filter((p) => Number(p.amount) > 0);
  return {
    count: inflows.length,
    total: round2(inflows.reduce((s, p) => s + Number(p.amount), 0)),
    lastDate: inflows.reduce<string | null>((d, p) => (!d || p.date > d ? p.date : d), null),
  };
}

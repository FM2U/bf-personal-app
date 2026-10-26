import { addDaysISO, parseDate, weekBounds } from "./dates";

/**
 * Daily Targets: a minimum count of an activity per day or per week (example: 3 outreach messages per weekday).
 * Counts come from source records (outreach communications, pipeline items created, or manual taps).
 * These functions are pure: they take counts by date and return met or missed per period.
 */

export type TargetPeriod = "day" | "week";

export type TargetDef = {
  id: string;
  period: TargetPeriod;
  minimum_count: number;
  /** 0 = Sunday ... 6 = Saturday. Used by day targets only. */
  active_weekdays: number[];
  /** Periods that end before this date are not counted. */
  start_date: string;
};

/** Count per date (YYYY-MM-DD). */
export type DayCounts = Record<string, number>;

export type PeriodStatus = "met" | "missed" | "open" | "off";

export type PeriodResult = {
  start: string;
  end: string;
  count: number;
  required: number;
  /**
   * met: count reached the minimum.
   * missed: the period is over and the count is below the minimum.
   * open: the period is not over yet and the minimum is not reached yet.
   * off: not an active day (or before the target started); not counted.
   */
  status: PeriodStatus;
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Adds up items into counts per date. */
export function countByDay(items: { date: string; count?: number }[]): DayCounts {
  const out: DayCounts = {};
  for (const it of items) {
    if (!it.date) continue;
    out[it.date] = (out[it.date] ?? 0) + (it.count ?? 1);
  }
  return out;
}

/** Total count from start to end (both included). */
export function countInRange(counts: DayCounts, start: string, end: string): number {
  let total = 0;
  for (const [d, n] of Object.entries(counts)) if (d >= start && d <= end) total += n;
  return total;
}

export function weekdayOf(date: string): number {
  return parseDate(date).getDay();
}

/** The day or week that contains the date. Weeks run Monday to Sunday. */
export function periodFor(period: TargetPeriod, date: string): { start: string; end: string } {
  return period === "week" ? weekBounds(date) : { start: date, end: date };
}

/** True when a day target counts on this date (an active weekday on or after the start date). */
export function isActiveDay(t: TargetDef, date: string): boolean {
  if (date < t.start_date) return false;
  if (t.period === "week") return true;
  const days = t.active_weekdays?.length ? t.active_weekdays.map(Number) : [1, 2, 3, 4, 5];
  return days.includes(weekdayOf(date));
}

/**
 * Result for the period containing `date`.
 * `closedThrough`: periods that end on or before this date are final (met or missed).
 * The page shows today as open; the daily close passes today so today becomes final.
 */
export function periodResult(t: TargetDef, counts: DayCounts, date: string, closedThrough: string): PeriodResult {
  const { start, end } = periodFor(t.period, date);
  const required = Math.max(1, Number(t.minimum_count) || 1);
  const count = countInRange(counts, start, end);
  const off = t.period === "day" ? !isActiveDay(t, date) : end < t.start_date;
  let status: PeriodStatus;
  if (off) status = "off";
  else if (count >= required) status = "met";
  else if (end <= closedThrough) status = "missed";
  else status = "open";
  return { start, end, count, required, status };
}

/** Results for every period from `from` to `to`, oldest first. */
export function periodHistory(t: TargetDef, counts: DayCounts, from: string, to: string, closedThrough: string): PeriodResult[] {
  const out: PeriodResult[] = [];
  const seen = new Set<string>();
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const key = periodFor(t.period, d).start;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(periodResult(t, counts, d, closedThrough));
  }
  return out;
}

/** Share of decided periods (met or missed) that were met. Open and off periods are not counted. */
export function completionRate(results: PeriodResult[]): { met: number; missed: number; pct: number | null } {
  const met = results.filter((r) => r.status === "met").length;
  const missed = results.filter((r) => r.status === "missed").length;
  return { met, missed, pct: met + missed > 0 ? Math.round((met / (met + missed)) * 100) : null };
}

/**
 * Consecutive periods with the given status, counting back from the latest period.
 * Off periods are skipped. An open period at the end is skipped (it does not break the count).
 */
export function consecutive(results: PeriodResult[], status: "met" | "missed"): number {
  let n = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r.status === "off") continue;
    if (r.status === "open" && n === 0) continue;
    if (r.status === status) n++;
    else break;
  }
  return n;
}

/** Totals for a date range: actual count, required count over active periods, and periods met or missed. */
export function rangeTotals(t: TargetDef, counts: DayCounts, from: string, to: string, closedThrough: string) {
  const results = periodHistory(t, counts, from, to, closedThrough).filter((r) => r.status !== "off");
  const rate = completionRate(results);
  return {
    total: countInRange(counts, from, to),
    required: results.reduce((s, r) => s + r.required, 0),
    periods: results.length,
    met: rate.met,
    missed: rate.missed,
    pct: rate.pct,
  };
}

/** Plain description of a target, for example "3 per weekday (Mon to Fri)". */
export function describeTarget(t: Pick<TargetDef, "period" | "minimum_count" | "active_weekdays">): string {
  if (t.period === "week") return `${t.minimum_count} per week`;
  const days = [...(t.active_weekdays ?? [])].map(Number).sort((a, b) => a - b);
  const key = days.join(",");
  if (key === "1,2,3,4,5") return `${t.minimum_count} per weekday (Mon to Fri)`;
  if (key === "0,1,2,3,4,5,6") return `${t.minimum_count} per day (every day)`;
  return `${t.minimum_count} per day (${days.map((d) => WEEKDAY_LABELS[d]).join(", ")})`;
}

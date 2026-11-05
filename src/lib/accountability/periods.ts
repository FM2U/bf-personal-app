/**
 * The periods Reports shows on "The week" (batch C; Edit batch C, item 7): This week, Last week, the three weeks
 * before it (opened from the Past weeks line on Targets or a Past weeks tile on Reports), and the month. Pure and
 * tested in src/lib/accountability/periods.test.ts; the URL carries the key (/work/reports?period=w2).
 */
import { date as fmtDate } from "@/lib/format";

const PERIOD_KEYS = ["this", "last", "w2", "w3", "w4", "month"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** The weeks before this one that Reports can open: Last week is 1, then 2 to 4 weeks back. */
export const PAST_WEEKS = 4;

/** The key of the week `weeksBack` weeks before this one (1 is "last", 2 is "w2"). */
export function pastWeekPeriodKey(weeksBack: number): PeriodKey {
  if (weeksBack <= 1) return "last";
  const k = `w${Math.min(PAST_WEEKS, Math.round(weeksBack))}`;
  return k as PeriodKey;
}

/** A key from the URL; anything else is This week. */
export function parsePeriodKey(v: unknown): PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(String(v)) ? (v as PeriodKey) : "this";
}

/** The period pills: This week, Last week, and the month always; an older week only while it is the one shown. */
export function periodPills<T extends { key: PeriodKey }>(periods: readonly T[], active: PeriodKey): T[] {
  return periods.filter((p) => p.key === "this" || p.key === "last" || p.key === "month" || p.key === active);
}

/** "Nov 2 to 6", or "Sep 29 to Oct 3" when the week runs into the next month. */
export function weekSpan(start: string, end: string): string {
  return `${fmtDate(start, "MMM d")} to ${fmtDate(end, start.slice(0, 7) === end.slice(0, 7) ? "d" : "MMM d")}`;
}

/**
 * The line at the right of "How the week went" (edits of Nov 5, item 3). This week before Friday's End of day:
 * "This week, Nov 2 to 6 · partial, through today, Thu Nov 5"; once it is done: "This week, Nov 2 to 6"; a past week:
 * "Week of Oct 12 to 16". When the per-week targets are judged is on the Targets card, not here.
 */
export function weekLine(week: { start: string; end: string }, i: { thisWeek: boolean; open?: boolean; today?: string }): string {
  if (!i.thisWeek) return `Week of ${weekSpan(week.start, week.end)}`;
  return `This week, ${weekSpan(week.start, week.end)}${i.open && i.today ? ` · partial, through today, ${fmtDate(i.today, "EEE MMM d")}` : ""}`;
}

/**
 * The periods Reports shows on "The week" (batch C; Edit batch C, item 7): This week, Last week, the three weeks
 * before it (opened from the Past weeks line on Targets or a Past weeks tile on Reports), and the month. Pure and
 * tested in src/lib/accountability/periods.test.ts; the URL carries the key (/work/reports?period=w2).
 */
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

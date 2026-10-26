import { addDaysISO } from "./dates";

export type CommitmentLike = { due_date: string; status: "open" | "met" | "missed" | "closed_by_decision" };

/**
 * Completion score for a period: commitments due in the period that were met, divided by those
 * that are decided (met or missed). Open commitments that are not yet due are not counted.
 */
export function completionScore(commitments: CommitmentLike[], start: string, end: string) {
  const inPeriod = commitments.filter((c) => c.due_date >= start && c.due_date <= end);
  const met = inPeriod.filter((c) => c.status === "met").length;
  const missed = inPeriod.filter((c) => c.status === "missed" || c.status === "closed_by_decision").length;
  const decided = met + missed;
  return { met, missed, total: inPeriod.length, pct: decided > 0 ? Math.round((met / decided) * 100) : null };
}

export type DayTask = { due_date: string; status: string };

/**
 * Consecutive days, ending yesterday (or today when today is already complete), on which every task
 * due that day was done. Days with no tasks due do not break the count and do not add to it.
 */
export function consecutiveCompleteDays(tasks: DayTask[], today: string, maxDays = 365): number {
  const byDay = new Map<string, { total: number; done: number }>();
  for (const t of tasks) {
    const d = byDay.get(t.due_date) ?? { total: 0, done: 0 };
    d.total++;
    if (t.status === "done") d.done++;
    byDay.set(t.due_date, d);
  }
  let streak = 0;
  const todayStats = byDay.get(today);
  let day = todayStats && todayStats.total > 0 && todayStats.done === todayStats.total ? today : addDaysISO(today, -1);
  for (let i = 0; i < maxDays; i++) {
    const s = byDay.get(day);
    if (s && s.total > 0) {
      if (s.done === s.total) streak++;
      else break;
    }
    day = addDaysISO(day, -1);
  }
  return streak;
}

/** Number of misses per commitment record, used to show repeated misses. */
export function repeatedMisses(misses: { commitment_id: string }[], minimum = 2): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of misses) counts[m.commitment_id] = (counts[m.commitment_id] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n >= minimum));
}

export type ScheduledReview = { kind: "weekly" | "monthly" | "quarterly"; date: string };

/**
 * The next weekly, monthly, or quarterly review date on or after today.
 * Weekly reviews fall on the chosen weekday (0 = Sunday); monthly on the 1st; quarterly on Jan, Apr, Jul, Oct 1.
 * When two fall on the same date, the larger review is named (quarterly, then monthly).
 */
export function nextScheduledReview(today: string, weeklyWeekday: number): ScheduledReview {
  const d = new Date(`${today}T12:00:00`);
  const toWeekly = (weeklyWeekday - d.getDay() + 7) % 7;
  const weekly = addDaysISO(today, toWeekly);
  const monthly = today.slice(8, 10) === "01" ? today : nextFirstOfMonth(today, () => true);
  const isQuarterMonth = (m: number) => [1, 4, 7, 10].includes(m);
  const quarterly = today.slice(8, 10) === "01" && isQuarterMonth(Number(today.slice(5, 7))) ? today : nextFirstOfMonth(today, isQuarterMonth);
  const options: ScheduledReview[] = [
    { kind: "quarterly", date: quarterly },
    { kind: "monthly", date: monthly },
    { kind: "weekly", date: weekly },
  ];
  return options.reduce((best, o) => (o.date < best.date ? o : best));
}

function nextFirstOfMonth(today: string, ok: (month: number) => boolean): string {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  for (let i = 0; i < 13; i++) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (ok(m)) return `${y}-${String(m).padStart(2, "0")}-01`;
  }
  return today;
}

/** Combines a commitment score with target periods marked as commitments (met and missed counts are added). */
export function combineScores(a: { met: number; missed: number }, b: { met: number; missed: number }) {
  const met = a.met + b.met;
  const missed = a.missed + b.missed;
  return { met, missed, pct: met + missed > 0 ? Math.round((met / (met + missed)) * 100) : null };
}

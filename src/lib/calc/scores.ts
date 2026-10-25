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

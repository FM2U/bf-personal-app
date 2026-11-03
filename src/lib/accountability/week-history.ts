/**
 * The last 4 weeks under each tile of "How the week went" on Reports (Push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/week-history.test.ts: for each tile, one value per week (oldest first) drawn as small bars
 * to scale, marked red when that week fell short of its target; for the Most missed tile, whether that target was
 * met (done) each week.
 */
import { addDaysISO, daysBetween } from "@/lib/calc/dates";
import { countable, judgeWeek, weekNumbers, type Facts, type Target } from "@/lib/accountability/targets";

export type HistoryWeek = { weekStart: string; /** Bar height share, 0 to 1. */ share: number; value: string; red: boolean };
export type TileHistory = { kind: "bars"; weeks: HistoryWeek[] } | { kind: "marks"; weeks: { weekStart: string; done: boolean; word: string }[] };

/** The Monday of each of the 4 weeks before `weekStart`, oldest first. */
export function fourWeeksBefore(weekStart: string): string[] {
  return [4, 3, 2, 1].map((n) => addDaysISO(weekStart, -7 * n));
}

const bars = (rows: { weekStart: string; v: number | null; label: string; red: boolean }[]): TileHistory => {
  const max = Math.max(1, ...rows.map((r) => r.v ?? 0));
  return { kind: "bars", weeks: rows.map((r) => ({ weekStart: r.weekStart, share: r.v === null ? 0 : Math.max(0.04, r.v / max), value: r.label, red: r.red })) };
};

/**
 * The history of each tile by its label: Deals moved, Listings screened, Network outreach (red below its target),
 * Follow-ups on time (red below 100%), Days waiting on brokers (the waits open at each week's end, counted from the
 * waits open now), and the Most missed tile (`mostLabel`) with `mostName`'s target met or not each week.
 */
export function tileHistories(i: { targets: readonly Target[]; facts: Facts; weekStart: string; waits: readonly { sinceDate: string | null }[]; skipped?: readonly string[]; mostLabel: string; mostName: string | null }): Record<string, TileHistory> {
  const weeks = fourWeeksBefore(i.weekStart);
  const nums = weeks.map((s) => ({ s, w: weekNumbers(i.targets, i.facts, { start: s, end: addDaysISO(s, 4) }, [], i.skipped ?? []) }));
  const out: Record<string, TileHistory> = {
    "Deals moved": bars(nums.map(({ s, w }) => ({ weekStart: s, v: w.deals.value, label: String(w.deals.value), red: false }))),
    "Listings screened": bars(nums.map(({ s, w }) => ({ weekStart: s, v: w.screened.value, label: String(w.screened.value), red: false }))),
    "Network outreach": bars(nums.map(({ s, w }) => ({ weekStart: s, v: w.outreach.value, label: String(w.outreach.value), red: !!w.outreach.target && w.outreach.value < w.outreach.target }))),
    "Follow-ups on time": bars(nums.map(({ s, w }) => (w.followUps.parts?.done ? { weekStart: s, v: w.followUps.value, label: `${w.followUps.value}%`, red: w.followUps.value < 100 } : { weekStart: s, v: null, label: "none", red: false }))),
    "Days waiting on brokers": bars(
      weeks.map((s) => {
        const end = addDaysISO(s, 4);
        const open = i.waits.filter((w) => w.sinceDate && w.sinceDate <= end).map((w) => daysBetween(w.sinceDate!, end));
        const avg = open.length ? Math.round((open.reduce((a, b) => a + b, 0) / open.length) * 10) / 10 : 0;
        return { weekStart: s, v: avg, label: avg.toFixed(1), red: false };
      }),
    ),
  };
  const t = i.mostName ? i.targets.find((x) => x.name === i.mostName) : null;
  if (t) {
    const yesno = countable(t.key).unit === "yesno";
    out[i.mostLabel] = { kind: "marks", weeks: weeks.map((s) => {
      const done = !judgeWeek([t], i.facts, s, i.skipped ?? []).missed.length;
      return { weekStart: s, done, word: yesno ? (done ? "done" : "not done") : done ? "met" : "missed" };
    }) };
  }
  return out;
}

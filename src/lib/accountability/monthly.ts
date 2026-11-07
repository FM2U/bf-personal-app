/**
 * The monthly review (push D, approved 2026-11-04), pure and tested in src/lib/accountability/monthly.test.ts.
 *
 * A review covers one month and opens on the first workday of the next month (Mon to Fri): from then until it is
 * finished, Work on now shows the row "Monthly review: October" under Due today. The review page shows how the month
 * went (each target: the full work weeks of the month it was met in, and its average), next month's targets with
 * their Commitment switches, and Export; "Finish the review" saves the targets and keeps a copy of both lists on the
 * review, which then opens read only. Only the latest month's review can be finished; an older one left unfinished
 * stays listed under Reports, Monthly reviews.
 *
 * A month's weeks are its full work weeks: Monday to Friday all inside the month (October 2026 has 4). A per-week
 * target is met in a week when the week's count reaches its number; a per-weekday target when the week's count
 * reaches its number times the weekdays counted that week (a skipped End of day is not counted). Averages are taken
 * over the same weeks: per counted weekday for a per-weekday target, per week otherwise; a percent target averages
 * its weekly percentages.
 */
import { addDaysISO } from "@/lib/calc/dates";
import { isWorkDay, weekOf, weekStartOf } from "@/lib/work-week";
import { countable, countIn, type Cadence, type Facts, type Target } from "@/lib/accountability/targets";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The first day of the month of a date: "2026-10-01". */
export function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the month before: "2026-10-01" for any day in November 2026. */
export function previousMonthStart(day: string): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** The first day of the month after. */
export function nextMonthStart(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The last day of a month. */
export function monthEnd(month: string): string {
  return addDaysISO(nextMonthStart(month), -1);
}

/** "October". */
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? "";
}

/** "October 2026". */
export function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** The address part of a month: "2026-10". */
export function monthSlug(month: string): string {
  return month.slice(0, 7);
}

/** "2026-10" (or "2026-10-01") as the month's first day; null for anything else. */
export function parseMonthSlug(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** The first work day of a month (Monday to Friday unless changed in Settings). */
export function firstWorkday(month: string): string {
  let d = month;
  for (let i = 0; i < 7 && !isWorkDay(d); i++) d = addDaysISO(d, 1);
  return d;
}

/** The review open on a day: the month before, from the first workday of this month. Null before that day. */
export function reviewMonthFor(today: string): { month: string; opensOn: string } | null {
  const opensOn = firstWorkday(monthStartOf(today));
  return today >= opensOn ? { month: previousMonthStart(today), opensOn } : null;
}

/** The full work weeks of a month (from the week's start day to its last work day, all inside it), in order. */
export function fullWeeks(month: string): { start: string; end: string }[] {
  const end = monthEnd(month);
  let d = weekStartOf(month);
  if (d < month) d = addDaysISO(d, 7);
  const out: { start: string; end: string }[] = [];
  for (; weekOf(d).end <= end; d = addDaysISO(d, 7)) out.push(weekOf(d));
  return out;
}

/** One target in the review: how the month went. Kept on a finished review as it was shown. */
export type MonthResult = {
  targetId: string;
  name: string;
  cadence: Cadence;
  number: number;
  commitment: boolean;
  unit: "count" | "percent" | "yesno";
  weeks: number;
  weeksMet: number;
  /** "4.6 a day", "7.5 a week", "92%". */
  average: string;
};

/** "Per weekday · target 5", "Per week · target 100%". */
export function targetLineOf(r: Pick<MonthResult, "cadence" | "number" | "unit">): string {
  return `${r.cadence === "day" ? "Per weekday" : "Per week"} · target ${r.unit === "percent" ? `${r.number}%` : r.number}`;
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** How each target went over the month's full weeks. */
export function monthResults(targets: readonly Target[], facts: Facts, month: string, skipped: readonly string[] = []): MonthResult[] {
  const weeks = fullWeeks(month);
  return targets.map((t) => {
    const unit = countable(t.key).unit;
    let met = 0;
    let total = 0;
    let days = 0;
    for (const w of weeks) {
      let counted = 0;
      let perDay = 0;
      for (let d = w.start; d <= w.end; d = addDaysISO(d, 1)) {
        if (skipped.includes(d)) continue;
        counted++;
        if (t.cadence === "day") perDay += countIn(t.key, facts, d, d).value;
      }
      // A per-weekday target counts only the days counted; a per-week one counts the whole week.
      const value = t.cadence === "day" && unit === "count" ? perDay : countIn(t.key, facts, w.start, w.end).value;
      const need = t.cadence === "day" && unit === "count" ? t.number * counted : t.number;
      if (value >= need && (t.cadence !== "day" || counted > 0)) met++;
      total += value;
      days += counted;
    }
    const n = weeks.length;
    const average = !n ? "None" : unit === "percent" ? `${Math.round(total / n)}%` : t.cadence === "day" ? `${one(days ? total / days : 0)} a day` : `${one(total / n)} a week`;
    return { targetId: t.id, name: t.name, cadence: t.cadence, number: t.number, commitment: t.commitment, unit, weeks: n, weeksMet: met, average };
  });
}

/** "Most missed: Network outreach, 3 of 4 weeks. Best: Deals moved a stage, every week." */
export function monthSummary(results: readonly MonthResult[]): string {
  if (!results.length || !results[0].weeks) return "No full work week in this month to judge.";
  const missed = [...results].map((r) => ({ r, miss: r.weeks - r.weeksMet })).filter((x) => x.miss > 0).sort((a, b) => b.miss - a.miss);
  const best = [...results].sort((a, b) => b.weeksMet - a.weeksMet)[0];
  const parts: string[] = [];
  if (missed.length) parts.push(`Most missed: ${missed[0].r.name}, ${missed[0].miss} of ${missed[0].r.weeks} ${missed[0].r.weeks === 1 ? "week" : "weeks"}.`);
  else parts.push("Every target was met every week.");
  if (missed.length && best && best.weeksMet > 0) parts.push(`Best: ${best.name}, ${best.weeksMet === best.weeks ? "every week" : `${best.weeksMet} of ${best.weeks} weeks`}.`);
  return parts.join(" ");
}

/** One row of next month's targets as set when the review was finished. */
export type NextTarget = { targetId: string; name: string; cadence: Cadence; number: number; commitment: boolean; unit: "count" | "percent" | "yesno"; /** The number the month under review had. */ before: number };

/** "5 / weekday", "100% on time", "1 / week". */
export function nextTargetText(t: Pick<NextTarget, "cadence" | "number" | "unit">): string {
  return t.unit === "percent" ? `${t.number}%` : String(t.number);
}

/**
 * Next month's targets from the Finish click: one entry per current target (others are ignored), the number a whole
 * number from 1 to 1000 (a percent target at most 100), the commitment as ticked. Null with the reason when a number
 * is not valid.
 */
export function cleanNextTargets(input: unknown, targets: readonly Target[]): { ok: true; rows: NextTarget[] } | { ok: false; error: string } {
  const list = Array.isArray(input) ? (input as { id?: unknown; number?: unknown; commitment?: unknown }[]) : [];
  const rows: NextTarget[] = [];
  for (const t of targets) {
    const hit = list.find((x) => String(x?.id ?? "") === t.id);
    const unit = countable(t.key).unit;
    const raw = hit ? Number(hit.number) : t.number;
    const n = Math.round(raw);
    const max = unit === "percent" ? 100 : 1000;
    if (!Number.isFinite(raw) || n < 1 || n > max) return { ok: false, error: `The number for ${t.name} must be between 1 and ${max}.` };
    rows.push({ targetId: t.id, name: t.name, cadence: t.cadence, number: n, commitment: hit ? !!hit.commitment : t.commitment, unit, before: t.number });
  }
  return { ok: true, rows };
}

/** Reads results and next targets kept on a finished review (unknown shapes are left out). */
export function readResults(v: unknown): MonthResult[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object" && typeof (x as MonthResult).name === "string")
    .map((x) => {
      const r = x as MonthResult;
      return { targetId: String(r.targetId ?? ""), name: r.name, cadence: r.cadence === "day" ? "day" : "week", number: Number(r.number) || 0, commitment: !!r.commitment, unit: r.unit === "percent" || r.unit === "yesno" ? r.unit : "count", weeks: Number(r.weeks) || 0, weeksMet: Number(r.weeksMet) || 0, average: String(r.average ?? "") };
    });
}

export function readNextTargets(v: unknown): NextTarget[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object" && typeof (x as NextTarget).name === "string")
    .map((x) => {
      const r = x as NextTarget;
      return { targetId: String(r.targetId ?? ""), name: r.name, cadence: r.cadence === "day" ? "day" : "week", number: Number(r.number) || 0, commitment: !!r.commitment, unit: r.unit === "percent" || r.unit === "yesno" ? r.unit : "count", before: Number(r.before) || 0 };
    });
}

/** The quiet line under a review in the list: "Not finished yet · also on Work on now", "Finished Nov 4", "Finished Oct 1 without the export". */
export function reviewListLine(r: { finishedOn: string | null; exported: boolean; current: boolean }, fmt: (d: string) => string): string {
  if (r.finishedOn) return `Finished ${fmt(r.finishedOn)}${r.exported ? "" : " without the export"} · read only`;
  return r.current ? "Not finished yet · also on Work on now" : "Not finished · read only";
}

/**
 * The work week (Bram, 2026-11-07; claude/2026-11-07-part-b-fix-list.md, design B). Settings, Work settings: the work
 * days (Monday to Friday unless changed), the day the week starts (Monday or Sunday), and the weekly review day (its own
 * setting, Friday unless changed; it does not follow the work days).
 *
 * What follows the work days: daily targets count and are judged on work days; a per-week target is judged on the
 * week's last work day; a week runs from the week's start day to its last work day (Targets, Reports, End of day); the
 * next working day ("What matters Monday"); a partner saved without days gets the work days. The weekly review (the
 * Weekly review questions and The week section of the report) is on the review day.
 *
 * Days are ISO weekday numbers: 1 Monday to 7 Sunday. The setting is read with the owner's other settings (loadCtx)
 * and held here for the rules below, so they keep their simple date-only calls. One owner, so every request of the app
 * holds the same setting.
 */
export type WorkWeek = { days: number[]; start: 1 | 7; review: number };

export const DEFAULT_WORK_WEEK: WorkWeek = { days: [1, 2, 3, 4, 5], start: 1, review: 5 };

export const WEEK_DAYS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
  { n: 7, short: "Sun", long: "Sunday" },
] as const;

const isDay = (n: number) => Number.isInteger(n) && n >= 1 && n <= 7;

/** A clean work week from saved values (unknown or empty parts fall back to the defaults). */
export function cleanWorkWeek(w: { days?: unknown; start?: unknown; review?: unknown } | null | undefined): WorkWeek {
  const days = Array.isArray(w?.days) ? [...new Set(w.days.map(Number).filter(isDay))].sort((a, b) => a - b) : [];
  const start = Number(w?.start) === 7 ? 7 : 1;
  const review = isDay(Number(w?.review)) ? Number(w?.review) : DEFAULT_WORK_WEEK.review;
  return { days: days.length ? days : [...DEFAULT_WORK_WEEK.days], start, review };
}

/** The work week from the owner_profile row (work_days and week_start are ISO; weekly_review_weekday is 0 Sunday to 6 Saturday). */
export function workWeekFromProfile(p: { work_days?: unknown; week_start?: unknown; weekly_review_weekday?: unknown } | null | undefined): WorkWeek {
  // Before the database update (push H) the review day column was unused (0, Sunday) and the app reviewed on Friday:
  // without work_days, the review day stays Friday.
  if (!p || !("work_days" in p)) return { ...DEFAULT_WORK_WEEK, days: [...DEFAULT_WORK_WEEK.days] };
  const js = Number(p?.weekly_review_weekday);
  return cleanWorkWeek({ days: p?.work_days, start: p?.week_start, review: Number.isInteger(js) && js >= 0 && js <= 6 ? (js === 0 ? 7 : js) : undefined });
}

let current: WorkWeek = DEFAULT_WORK_WEEK;

/** Sets the work week the rules use (loadCtx, from the profile or the settings kept in the browser). */
export function setWorkWeek(w: WorkWeek | null | undefined): void {
  current = w ? cleanWorkWeek(w) : DEFAULT_WORK_WEEK;
}

export function workWeekNow(): WorkWeek {
  return current;
}

/** The ISO weekday of a date (YYYY-MM-DD): 1 Monday to 7 Sunday. */
export function isoDayOf(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWorkDay(date: string, w: WorkWeek = current): boolean {
  return w.days.includes(isoDayOf(date));
}

/** The first day of the week that holds the date (the Monday or the Sunday on or before it). */
export function weekStartOf(date: string, w: WorkWeek = current): string {
  const back = (isoDayOf(date) - w.start + 7) % 7;
  return addDays(date, -back);
}

/** The week that holds the date: from its start day to its last work day (Monday to Friday by default). */
export function weekOf(date: string, w: WorkWeek = current): { start: string; end: string } {
  const start = weekStartOf(date, w);
  let end = addDays(start, 6);
  while (end > start && !isWorkDay(end, w)) end = addDays(end, -1);
  return { start, end };
}

/**
 * The first day counted toward a week's totals (Bram, 2026-11-09): the day after the previous week's last work day, so
 * work done on the days off between two weeks (Saturday and Sunday for Mon to Fri) counts toward the coming week. With
 * every day a work day it is the week's start day. `weekStart` is the week's start day.
 */
export function weekCountFrom(weekStart: string, w: WorkWeek = current): string {
  return addDays(weekOf(addDays(weekStart, -1), w).end, 1);
}

/**
 * "This week" for a day (Bram, 2026-11-09): the week that holds it, or, on a day off after that week's last work day
 * (Saturday and Sunday for Mon to Fri), the coming week, since that day's work counts toward it.
 */
export function thisWeekOf(date: string, w: WorkWeek = current): { start: string; end: string } {
  const week = weekOf(date, w);
  return date > week.end ? weekOf(nextWorkDay(date, w), w) : week;
}

/** The work days from start to end (both included). */
export function workDaysIn(start: string, end: string, w: WorkWeek = current): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkDay(d, w)) out.push(d);
  return out;
}

/** The week's last work day: a per-week target is judged on it. */
export function isWeekJudgedOn(date: string, w: WorkWeek = current): boolean {
  return isWorkDay(date, w) && weekOf(date, w).end === date;
}

/** The weekly review day (Friday unless changed). */
export function isReviewDay(date: string, w: WorkWeek = current): boolean {
  return isoDayOf(date) === w.review;
}

/** The next work day after the date (the day after, when no day is a work day). */
export function nextWorkDay(date: string, w: WorkWeek = current): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, i);
    if (isWorkDay(d, w)) return d;
  }
  return addDays(date, 1);
}

export function dayLong(date: string): string {
  return WEEK_DAYS[isoDayOf(date) - 1].long;
}

export function dayShort(date: string): string {
  return WEEK_DAYS[isoDayOf(date) - 1].short;
}

/** "Mon to Fri", "Mon to Sat", "Sun to Thu": the first and last work day of the week, for a strip of days. */
export function workDaysLabel(w: WorkWeek = current): string {
  const order = [...w.days].sort((a, b) => ((a - w.start + 7) % 7) - ((b - w.start + 7) % 7));
  if (!order.length) return "";
  if (order.length === 1) return WEEK_DAYS[order[0] - 1].short;
  return `${WEEK_DAYS[order[0] - 1].short} to ${WEEK_DAYS[order[order.length - 1] - 1].short}`;
}

/** The kept form for the browser cookie: [days, start, review]. */
export type KeptWorkWeek = [number[], number, number];
export const keepWorkWeek = (w: WorkWeek): KeptWorkWeek => [w.days, w.start, w.review];
export const fromKept = (k: unknown): WorkWeek | null => (Array.isArray(k) && k.length === 3 ? cleanWorkWeek({ days: k[0], start: k[1], review: k[2] }) : null);

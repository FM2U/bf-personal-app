import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

/** Date string (YYYY-MM-DD) for "today" in the given IANA time zone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parseDate(s: string): Date {
  return parseISO(s.length === 10 ? `${s}T00:00:00` : s);
}

export function addDaysISO(s: string, n: number): string {
  return toISODate(addDays(parseDate(s), n));
}

export function addMonthsISO(s: string, n: number): string {
  return toISODate(addMonths(parseDate(s), n));
}

export function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseDate(b), parseDate(a));
}

/** First day of the month (YYYY-MM-01) for a date string. */
export function monthStart(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

/** Last N full calendar months before the month of `today`, oldest first, as YYYY-MM keys. */
export function previousMonthKeys(today: string, n: number): string[] {
  const keys: string[] = [];
  const start = parseDate(monthStart(today));
  for (let i = n; i >= 1; i--) keys.push(format(addMonths(start, -i), "yyyy-MM"));
  return keys;
}

/** Start (Monday) and end (Sunday) of the week containing the date. */
export function weekBounds(s: string): { start: string; end: string } {
  const d = parseDate(s);
  const dow = d.getDay(); // 0 Sunday
  const offset = dow === 0 ? -6 : 1 - dow;
  const start = addDays(d, offset);
  return { start: toISODate(start), end: toISODate(addDays(start, 6)) };
}

export function monthBounds(s: string): { start: string; end: string } {
  const start = parseDate(monthStart(s));
  return { start: toISODate(start), end: toISODate(addDays(addMonths(start, 1), -1)) };
}

export function quarterBounds(s: string): { start: string; end: string } {
  const d = parseDate(s);
  const qMonth = Math.floor(d.getMonth() / 3) * 3;
  const start = new Date(d.getFullYear(), qMonth, 1);
  return { start: toISODate(start), end: toISODate(addDays(addMonths(start, 3), -1)) };
}

/** True for Monday to Friday (the date is read as a calendar date, no time zone). */
export function isWeekday(s: string): boolean {
  const d = new Date(`${s}T12:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

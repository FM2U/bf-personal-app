/**
 * Repeat on to-dos and record tasks (push C, approved 2026-11-02): Does not repeat, Every day, Every weekday, Every
 * week, Every month. Checking off a repeating item adds the next one; its date is counted from the due date (from
 * today when the item had no date) and is always after today, so an overdue item never adds another overdue copy.
 * A monthly item keeps its day of the month (Jan 31, Feb 28, Mar 31), so a short month never moves it for good.
 * Push D (approved 2026-11-04): an optional end date ("Ends"). A copy whose date would fall after it is not added;
 * blank repeats with no end. The Repeat chip shows it: "Every weekday, until Dec 19".
 * Pure and tested in src/lib/work/repeat.test.ts.
 */
import { addDaysISO, addMonthsISO, isWeekday } from "@/lib/calc/dates";

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly";

export const REPEAT_CHOICES: readonly { value: Repeat | ""; label: string }[] = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export function parseRepeat(v: unknown): Repeat | null {
  return v === "daily" || v === "weekdays" || v === "weekly" || v === "monthly" ? v : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 19" (with the year when it is not the year of `today`: "Jan 8, 2028"). */
export function untilLabel(until: string, today?: string | null): string {
  const [y, m, d] = until.slice(0, 10).split("-").map(Number);
  const base = `${MONTHS[(m || 1) - 1]} ${d}`;
  return today && today.slice(0, 4) !== String(y) ? `${base}, ${y}` : base;
}

/** "Every week", "Every weekday, until Dec 19", or "Does not repeat". */
export function repeatLabel(r: Repeat | null | undefined, until?: string | null, today?: string | null): string {
  const label = REPEAT_CHOICES.find((c) => c.value === (r ?? ""))?.label ?? "Does not repeat";
  return r && until ? `${label}, until ${untilLabel(until, today)}` : label;
}

/** The end date as saved: a valid date, only for a repeating item; anything else is blank (repeats with no end). */
export function cleanRepeatUntil(repeat: Repeat | null | undefined, until: unknown): string | null {
  if (!repeat) return null;
  const v = String(until ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) ? v : null;
}

/** The k-th date after `from` (k >= 1) for a repeat. */
function stepFrom(from: string, repeat: Repeat, k: number): string {
  if (repeat === "daily") return addDaysISO(from, k);
  if (repeat === "weekly") return addDaysISO(from, 7 * k);
  if (repeat === "monthly") return addMonthsISO(from, k);
  let d = from;
  for (let i = 0; i < k; i++) {
    d = addDaysISO(d, 1);
    while (!isWeekday(d)) d = addDaysISO(d, 1);
  }
  return d;
}

/**
 * The date of the next copy when a repeating item is checked off, or null when its end date has passed: the next
 * date (nextRepeatDate) must be on or before the end date. Blank end date: always the next date.
 */
export function nextCopyDate(due: string | null | undefined, repeat: Repeat, today: string, until?: string | null): string | null {
  const next = nextRepeatDate(due, repeat, today);
  return until && next > until.slice(0, 10) ? null : next;
}

/** The date of the next copy: the first step after the due date (or after today with no date) that is after today. */
export function nextRepeatDate(due: string | null | undefined, repeat: Repeat, today: string): string {
  const from = due ? due.slice(0, 10) : today;
  for (let k = 1; k < 5000; k++) {
    const d = stepFrom(from, repeat, k);
    if (d > today) return d;
  }
  return addDaysISO(today, 1);
}

/**
 * What checking off a repeating item adds, for the line after Done: " The next one is on Tue Nov 10." or, once the end
 * date is past (push D), " That was the last one; it repeated until Dec 19." Empty for an item that does not repeat.
 */
export function repeatDoneLine(r: { next?: string | null; ended?: string | null }, fmt: (d: string) => string): string {
  if (r.next) return ` The next one is on ${fmt(r.next)}.`;
  if (r.ended) return ` That was the last one; it repeated until ${untilLabel(r.ended)}.`;
  return "";
}

/**
 * Repeat on to-dos and record tasks (push C, approved 2026-11-02): Does not repeat, Every day, Every weekday, Every
 * week, Every month. Checking off a repeating item adds the next one; its date is counted from the due date (from
 * today when the item had no date) and is always after today, so an overdue item never adds another overdue copy.
 * A monthly item keeps its day of the month (Jan 31, Feb 28, Mar 31), so a short month never moves it for good.
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

/** "Every week", or "Does not repeat". */
export function repeatLabel(r: Repeat | null | undefined): string {
  return REPEAT_CHOICES.find((c) => c.value === (r ?? ""))?.label ?? "Does not repeat";
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

/** The date of the next copy: the first step after the due date (or after today with no date) that is after today. */
export function nextRepeatDate(due: string | null | undefined, repeat: Repeat, today: string): string {
  const from = due ? due.slice(0, 10) : today;
  for (let k = 1; k < 5000; k++) {
    const d = stepFrom(from, repeat, k);
    if (d > today) return d;
  }
  return addDaysISO(today, 1);
}

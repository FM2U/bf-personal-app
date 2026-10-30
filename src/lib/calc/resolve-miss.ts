import { format, parseISO } from "date-fns";

/**
 * Resolving a missed commitment: the four choices, the check on the "Done late" date, and the label shown for a
 * resolved miss (Misses tables, the task window). Pure, tested in src/lib/calc/resolve-miss.test.ts.
 */

export type MissResolution = "done_late" | "new_date" | "decision" | "released";

export const RESOLVE_CHOICES: { value: MissResolution; label: string; help: string }[] = [
  { value: "done_late", label: "Done late", help: "It was done after the due date. The task is marked done on that date. It still counts as a miss in the commitment score." },
  { value: "new_date", label: "New date", help: "The commitment is open again with this due date." },
  { value: "decision", label: "Open a decision", help: "Creates a decision record with three options: set a new date, change the commitment, or drop it." },
  { value: "released", label: "No longer a commitment", help: "The task stays a task but stops counting as a commitment. Nothing is deleted." },
];

export const isResolution = (v: string): v is MissResolution => RESOLVE_CHOICES.some((c) => c.value === v);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The problem with a "Done late" date in plain words, or null: a date, not before the due date, not in the future. */
export function doneLateProblem(date: string, due: string, today: string): string | null {
  if (!ISO.test(date)) return "Choose the date it was done.";
  if (date < due) return "The date it was done cannot be before the due date.";
  if (date > today) return "The date it was done cannot be in the future.";
  return null;
}

/** The default "Done late" date: today (never before the due date). */
export function defaultDoneOn(due: string, today: string): string {
  return today < due ? due : today;
}

/**
 * When a task done on a past date is marked done: noon UTC of that date is the same calendar date in New York
 * (and in every US time zone). Today uses the current time.
 */
export function completedAtFor(date: string, today: string, now = new Date()): string {
  return date === today ? now.toISOString() : `${date}T16:00:00.000Z`;
}

function short(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return format(parseISO(d), "MMM d");
  } catch {
    return d;
  }
}

/** "Done late, Oct 30", "New date, Nov 3", "Decision opened", "No longer a commitment", "Reason needed". */
export function resolutionLabel(m: { resolution: string; done_on?: string | null; new_due_date?: string | null }): string {
  switch (m.resolution) {
    case "done_late":
      return m.done_on ? `Done late, ${short(m.done_on)}` : "Done late";
    case "new_date":
      return m.new_due_date ? `New date, ${short(m.new_due_date)}` : "New date set";
    case "decision":
      return "Decision opened";
    case "released":
      return "No longer a commitment";
    case "pending":
      return "Reason needed";
    default:
      return m.resolution.replace(/_/g, " ");
  }
}

/** Commitment status in words ("done_late" as "Done late"). */
export function commitmentStatusWord(s: string): string {
  const w = s === "closed_by_decision" ? "closed by a decision" : s === "released" ? "no longer a commitment" : s === "done_late" ? "done late" : s.replace(/_/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

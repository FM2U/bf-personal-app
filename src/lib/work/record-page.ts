/**
 * The record-page rule (batch B, approved 2026-10-31, decisions on v5): every record page (deal, person, and later
 * opportunity, consulting, project) has the same layout. Header: title, type pill, one status line, labeled figures
 * at the right (next action due or next follow-up, open tasks, last contact or waiting). Left column: one
 * type-specific card, then Next action, then Tasks. Right column: Facts, Timeline, Decision. Pure and tested in
 * src/lib/work/record-page.test.ts: the three header figures from a record's dates and counts.
 */
import { dueLabel } from "@/lib/work/stages";
import { lastContactLabel } from "@/lib/work/outreach";

export type HeaderFigure = { key: "next" | "tasks" | "last" | "waiting"; value: string; label: string; tone: "today" | "over" | "later" | "none" | "amber" | "red" };

export type RecordHeaderInput = {
  /** The next action's or next follow-up's date (YYYY-MM-DD), or null. */
  nextDue: string | null;
  /** True when there is a next action or follow-up at all (a date without text still counts for a person). */
  hasNext: boolean;
  nextLabel: "Next action" | "Next follow-up";
  openTasks: number;
  /** The last contact's date in the owner's time zone (YYYY-MM-DD). */
  lastContactAt: string | null;
  lastContactKind: string | null;
  /** A deal waiting on someone: shown instead of the last contact when set. */
  waitingOn?: string | null;
  waitDays?: number;
  waitTone?: "none" | "quiet" | "amber" | "red";
};

/** The three figures, left to right: NEXT ACTION or NEXT FOLLOW-UP, OPEN TASKS, LAST CONTACT (or WAITING). */
export function headerFigures(i: RecordHeaderInput, today: string, fmt: (d: string) => string): HeaderFigure[] {
  const due = i.hasNext ? dueLabel(i.nextDue, today, fmt) : { text: "None", tone: "none" as const };
  const next: HeaderFigure = { key: "next", value: i.hasNext && !i.nextDue ? "No date" : due.text, label: i.nextLabel, tone: due.tone };
  const tasks: HeaderFigure = { key: "tasks", value: String(i.openTasks), label: i.openTasks === 1 ? "Open task" : "Open tasks", tone: "none" };
  const waiting = i.waitingOn && i.waitTone && i.waitTone !== "none";
  const last: HeaderFigure = waiting
    ? { key: "waiting", value: `${i.waitDays ?? 0} ${i.waitDays === 1 ? "day" : "days"}`, label: `Waiting on ${i.waitingOn}`, tone: i.waitTone === "red" ? "red" : i.waitTone === "amber" ? "amber" : "none" }
    : { key: "last", value: lastContactLabel(i.lastContactAt, i.lastContactKind, today, fmt), label: "Last contact", tone: "none" };
  return [next, tasks, last];
}

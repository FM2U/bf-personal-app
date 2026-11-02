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

/**
 * The deal page in its two states (Edit batch C round 3): a listing (screened = false, no stage) opens the same page at
 * /work/deals/[id] in the "Listing" state, and after Interested the same row, at the same address, shows the deal state.
 * Nothing is copied between the two. The listing state: the breadcrumb "Screen listings › name", the "Listing" type pill
 * and the buy box pill instead of the stage mark and the stage pill, the Next action optional, no Documents card, and
 * the Decision card with Pass and Interested. Pure and tested in record-page.test.ts.
 */
export type DealPageState = {
  kind: "listing" | "deal";
  crumb: { label: "Screen listings" | "Deals"; href: "/work/listings" | "/work/deals"; tail: string };
  /** "Listing" on a listing (the type pill); null on a deal, which shows the stage mark and the stage pill. */
  typePill: "Listing" | null;
  /** The Next action card's hint when there is none: optional on a listing, needed on an open deal. */
  noActionHint: string;
  /** The Decision card: Pass and Interested on a listing, Advance, Pass, and Lost on an open deal, the outcome on a closed one. */
  decision: "listing" | "open" | "closed";
  /** The Documents card shows from Interested on. */
  documents: boolean;
  /** Suggest questions and Email these questions show from Interested on (the AI drafts the questions at Interested). */
  questionsTools: boolean;
};

export function dealPageState(d: { screened: boolean; status: string; stageName: string | null; name: string }): DealPageState {
  if (!d.screened) {
    return { kind: "listing", crumb: { label: "Screen listings", href: "/work/listings", tail: d.name }, typePill: "Listing", noActionHint: "Optional for a listing", decision: "listing", documents: false, questionsTools: false };
  }
  return { kind: "deal", crumb: { label: "Deals", href: "/work/deals", tail: d.stageName ?? "No stage" }, typePill: null, noActionHint: "Needs a next action", decision: d.status === "open" ? "open" : "closed", documents: true, questionsTools: true };
}

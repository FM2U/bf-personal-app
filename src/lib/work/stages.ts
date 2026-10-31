/**
 * The acquisition stages of the Work module (pure, tested in src/lib/work/stages.test.ts): the nine working stages in
 * order, the progress mark, the wait thresholds, what Done means for a deal, and the Chase email draft. The stage rows
 * themselves live in the database (pipeline_stages, set by database update 0020); these helpers read them by name.
 */
import { daysBetween } from "@/lib/calc/dates";

/** The nine working stages, in order. Passed, Lost, and Closed come after them and are not part of the progress mark. */
export const WORK_STAGES = ["Interested", "NDA signed", "Broker call", "CIM review", "Seller call", "Model", "Partner presentation", "IOI or LOI", "Diligence"] as const;
export type WorkStageName = (typeof WORK_STAGES)[number];

/** The default next action per stage (also in database update 0020; shown as the hint on the Deals stage headings). */
export const STAGE_DEFAULTS: Record<WorkStageName, { title: string; dueInDays: number; hint: string }> = {
  Interested: { title: "Sign the NDA and ask the broker for a call", dueInDays: 1, hint: "sign the NDA and ask the broker for a call" },
  "NDA signed": { title: "Chase the broker for the CIM and the call", dueInDays: 3, hint: "chase the broker for the CIM and the call in 3 days" },
  "Broker call": { title: "Ask for the seller call", dueInDays: 2, hint: "ask for the seller call" },
  "CIM review": { title: "Write the key finding, research the market if interested, request 3 years of financials and unit economics", dueInDays: 3, hint: "key finding, market research, request 3 years of financials and unit economics" },
  "Seller call": { title: "Ask for tax returns and start the model", dueInDays: 3, hint: "ask for tax returns, start the model" },
  Model: { title: "Book the partner meeting", dueInDays: 5, hint: "book the partner meeting" },
  "Partner presentation": { title: "Submit the IOI or LOI", dueInDays: 5, hint: "submit the IOI or LOI" },
  "IOI or LOI": { title: "Wait for the broker, chase in 7 days", dueInDays: 7, hint: "wait for the broker, chase in 7 days" },
  Diligence: { title: "Data room, quality of earnings, lawyer review", dueInDays: 14, hint: "data room, quality of earnings, lawyer review" },
};

export const DEFAULT_WAIT_THRESHOLD_DAYS = 5;

/** 0-based index of a stage name in the nine working stages, or -1 (Passed, Lost, Closed, unknown). */
export function stageIndex(name: string | null | undefined): number {
  return (WORK_STAGES as readonly string[]).indexOf(String(name ?? ""));
}

/** The nine segments of the progress mark: "done" (cobalt) before the current stage, "current" (gold), "todo" (gray). */
export function progressSegments(stageName: string | null | undefined): ("done" | "current" | "todo")[] {
  const i = stageIndex(stageName);
  return WORK_STAGES.map((_, n) => (i < 0 ? "todo" : n < i ? "done" : n === i ? "current" : "todo"));
}

/** The stage after this one in the nine, or null at Diligence and for any other stage. */
export function nextStageName(stageName: string | null | undefined): WorkStageName | null {
  const i = stageIndex(stageName);
  return i >= 0 && i < WORK_STAGES.length - 1 ? WORK_STAGES[i + 1] : null;
}

export type WaitLevel = "none" | "quiet" | "amber" | "red";

/** Days waited so far (0 when since is today or empty). */
export function daysWaiting(since: string | null | undefined, today: string): number {
  if (!since) return 0;
  return Math.max(0, daysBetween(since.slice(0, 10), today));
}

/**
 * The color of a wait: amber from the threshold on, red from double the threshold on, quiet (gray) below, none when
 * nobody is waited on.
 */
export function waitLevel(waitingOn: string | null | undefined, days: number, threshold = DEFAULT_WAIT_THRESHOLD_DAYS): WaitLevel {
  if (!String(waitingOn ?? "").trim()) return "none";
  const t = Math.max(1, Math.round(threshold));
  if (days >= t * 2) return "red";
  if (days >= t) return "amber";
  return "quiet";
}

/** "11 days", "1 day", "Today" (for 0). */
export function daysLabel(days: number): string {
  if (days <= 0) return "Today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "11 d", "1 d", "Today" (for 0): the wait on the small deal cards. */
export function daysShort(days: number): string {
  if (days <= 0) return "Today";
  return `${days} d`;
}

/**
 * What Done does on a deal: when the action just done is the stage's default next action, the app asks to move the
 * deal to the next stage ("ask"); otherwise the action is simply cleared and the deal stays where it is ("clear").
 * At Diligence (no next stage) Done clears too.
 */
export function doneOutcome(i: { stageName: string | null; nextAction: string | null; defaultTitle: string | null }): { kind: "ask"; nextStage: WorkStageName } | { kind: "clear" } {
  const next = nextStageName(i.stageName);
  const isDefault = !!i.defaultTitle && String(i.nextAction ?? "").trim().toLowerCase() === i.defaultTitle.trim().toLowerCase();
  if (next && isDefault) return { kind: "ask", nextStage: next };
  return { kind: "clear" };
}

/** "Today", "Yesterday", "3 days late", "Tomorrow", "Nov 3": how a due date reads next to an action. */
export function dueLabel(due: string | null | undefined, today: string, fmt: (d: string) => string): { text: string; tone: "today" | "over" | "later" | "none" } {
  if (!due) return { text: "No date", tone: "none" };
  const d = due.slice(0, 10);
  const diff = daysBetween(today, d);
  if (diff === 0) return { text: "Today", tone: "today" };
  if (diff === -1) return { text: "Yesterday", tone: "over" };
  if (diff < 0) return { text: `${-diff} days late`, tone: "over" };
  if (diff === 1) return { text: "Tomorrow", tone: "later" };
  return { text: fmt(d), tone: "later" };
}

/** The follow-up email the Chase button opens, ready to edit. */
export function chaseDraft(i: { dealName: string; waitingOn: string | null; contactName: string | null; days: number }): { subject: string; body: string } {
  const first = String(i.contactName ?? "").trim().split(/\s+/)[0] || "there";
  const what = String(i.waitingOn ?? "").trim();
  const since = i.days >= 2 ? ` It has been ${i.days} days, so I wanted to make sure it did not get lost.` : "";
  const topic = what ? `${what.charAt(0).toLowerCase()}${what.slice(1)}` : "the next step";
  return {
    subject: `Following up on ${i.dealName}`,
    body: `Hi ${first},\n\nQuick follow-up on ${i.dealName}: I am still waiting on ${topic}.${since}\n\nIs there an update on timing? Happy to jump on a call if that is easier.\n\nThanks,\nBram`,
  };
}

/** "day 4" from the stage entry timestamp (the first day is day 1). */
export function dayInStage(enteredAt: string | null | undefined, today: string, localDate: (ts: string) => string): number {
  if (!enteredAt) return 1;
  return Math.max(1, daysBetween(localDate(enteredAt), today) + 1);
}

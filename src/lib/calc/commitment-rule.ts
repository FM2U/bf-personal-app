/**
 * Commitment rule (approved 2026-10-26).
 *
 * Commitments are only: pipeline next-action tasks (the stage task marked as the next action, and an item's
 * current next action task), milestones, daily targets, and the scheduled reviews (daily close, weekly, monthly,
 * quarterly). Everything else is a regular task.
 *
 * A regular task that is not done by its due date moves to the next day automatically (no reason needed) and
 * counts how many times it moved. Commitments keep their date and go through the missed-commitment flow.
 */

/** Recurring templates that are the scheduled reviews themselves. Same test as is_review_template_title() in 0010. */
const REVIEW_TITLE = /(daily close|weekly review|monthly review|quarterly review)/i;

export function isReviewTemplateTitle(title: string | null | undefined): boolean {
  return REVIEW_TITLE.test(title ?? "");
}

/** Default "Counts as a commitment" for a new recurring template. */
export function templateIsCommitmentByDefault(title: string | null | undefined): boolean {
  return isReviewTemplateTitle(title);
}

/** Default "Counts as a commitment" for a stage task: only the next-action task. */
export function stageTaskIsCommitmentByDefault(isNextActionDefault: boolean | null | undefined): boolean {
  return Boolean(isNextActionDefault);
}

export type TaskForRule = {
  source?: string | null;
  source_key?: string | null;
  title?: string | null;
};

export type RuleLookups = {
  /** Template flag (task_templates.is_commitment) for template tasks. */
  templateIsCommitment?: boolean | null;
  /** Stage task flag (stage_tasks.is_commitment) for stage tasks. */
  stageTaskIsCommitment?: boolean | null;
  /** The owner checked "This is a commitment" (or pressed Mark as commitment). */
  markedByOwner?: boolean;
};

/**
 * Whether a task is a commitment under the rule.
 *   - Pipeline next action task ("pipeline:<item>:<date>"): yes.
 *   - Stage task ("stage-task:<item>:<stage task>"): when the stage task says so (by default only the next-action task).
 *   - Recurring template task: when the template says so (by default only the review templates).
 *   - "Set next action", follow-up, connection, review top-3, AI, partner report, decision condition, and
 *     missed-commitment tasks: regular tasks.
 *   - Manual tasks: regular unless the owner marked them.
 */
export function isCommitmentTask(task: TaskForRule, lookups: RuleLookups = {}): boolean {
  if (lookups.markedByOwner) return true;
  const key = task.source_key ?? "";
  switch (task.source) {
    case "pipeline":
      if (key.startsWith("set-next-action:")) return false;
      if (key.startsWith("stage-task:")) return Boolean(lookups.stageTaskIsCommitment);
      return key.startsWith("pipeline:");
    case "template":
      return lookups.templateIsCommitment ?? isReviewTemplateTitle(task.title);
    default:
      return false;
  }
}

export type RolloverTask = { id: string; status: string; due_date: string | null; times_moved?: number | null };

export type RolloverMove = { id: string; from: string; times_moved: number };

/**
 * Regular tasks that are not done and past their due date move to `today`, one more time moved each.
 * Tasks with an open or missed commitment (`commitmentTaskIds`) keep their date.
 */
export function planRollover(tasks: RolloverTask[], commitmentTaskIds: Set<string>, today: string): RolloverMove[] {
  return tasks
    .filter((t) => t.status === "todo" && t.due_date && t.due_date < today && !commitmentTaskIds.has(t.id))
    .map((t) => ({ id: t.id, from: t.due_date as string, times_moved: Number(t.times_moved ?? 0) + 1 }));
}

/** Groups moves by their new times_moved value so each group is one database update. */
export function groupMovesByCount(moves: RolloverMove[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const m of moves) out.set(m.times_moved, [...(out.get(m.times_moved) ?? []), m.id]);
  return out;
}

/** Plain note shown on a task that moved. Empty when it never moved. */
export function movedNote(timesMoved: number | null | undefined): string {
  const n = Number(timesMoved ?? 0);
  if (!n) return "";
  return n === 1 ? "Moved 1 time" : `Moved ${n} times`;
}

/** Regular tasks to list in the weekly review: still open and moved at least `threshold` times. */
export function tasksToReview<T extends { status: string; times_moved?: number | null }>(tasks: T[], threshold: number): T[] {
  const min = Number.isFinite(threshold) && threshold > 0 ? Math.round(threshold) : 5;
  return tasks.filter((t) => t.status === "todo" && Number(t.times_moved ?? 0) >= min).sort((a, b) => Number(b.times_moved ?? 0) - Number(a.times_moved ?? 0));
}

// Grouped Home alerts: one alert per kind, updated in place, resolved when the count reaches 0.

export type GroupedAlertKind = "next_action" | "stalled" | "stage_limit";

export const GROUPED_ALERTS: Record<GroupedAlertKind, { dedupeKey: string; href: string; message: (n: number) => string; perItemPrefix: string | null }> = {
  next_action: {
    dedupeKey: "group:pipeline-next-action",
    href: "/opportunities?filter=needs-next-action",
    message: (n) => (n === 1 ? "1 pipeline item needs a next action." : `${n} pipeline items need a next action.`),
    perItemPrefix: "pipeline-next-action:",
  },
  stalled: {
    dedupeKey: "group:pipeline-stalled",
    href: "/opportunities?filter=stalled",
    message: (n) => (n === 1 ? "1 pipeline item is stalled." : `${n} pipeline items are stalled.`),
    perItemPrefix: "pipeline-stalled:",
  },
  stage_limit: {
    dedupeKey: "group:stage-time-limit",
    href: "/plan/decisions",
    message: (n) => (n === 1 ? "1 stage time limit passed. Choose Advance, Pass, or Extend." : `${n} stage time limits passed. Choose Advance, Pass, or Extend for each.`),
    perItemPrefix: null,
  },
};

export type GroupedAlertStep =
  | { action: "none" }
  | { action: "insert"; message: string }
  | { action: "update"; id: string; message: string }
  | { action: "resolve"; id: string };

/** What to do with the grouped alert for a kind, given the open alert (if any) and the current count. */
export function groupedAlertStep(kind: GroupedAlertKind, open: { id: string; message: string } | null, count: number): GroupedAlertStep {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return open ? { action: "resolve", id: open.id } : { action: "none" };
  const message = GROUPED_ALERTS[kind].message(n);
  if (!open) return { action: "insert", message };
  return open.message === message ? { action: "none" } : { action: "update", id: open.id, message };
}

/** True for a per-item alert that the grouped alerts replace (dismissed when grouping runs). */
export function isReplacedPerItemAlert(a: { dedupe_key?: string | null; related_type?: string | null; related_id?: string | null }, stageLimitDecisionIds: Set<string>): boolean {
  const key = a.dedupe_key ?? "";
  if (key.startsWith("group:")) return false;
  if (key.startsWith("pipeline-next-action:") || key.startsWith("pipeline-stalled:")) return true;
  return key.startsWith("decision:") && a.related_type === "decisions" && !!a.related_id && stageLimitDecisionIds.has(a.related_id);
}

// Daily close: one reason can cover several misses.

export type CloseMiss = { key: string; label: string; existingReason?: string | null };

/**
 * Reason for each missed item in the daily close: its own reason when given, otherwise the shared reason when the
 * item is checked, otherwise a reason saved earlier. Returns the reasons and the items still without one.
 * Answers use the keys `shared_reason`, `use_shared_<key>` ("yes" when checked), and `reason_<key>`.
 */
export function resolveCloseReasons(items: CloseMiss[], answers: Record<string, unknown>): { reasons: Record<string, string>; missing: CloseMiss[] } {
  const shared = String(answers.shared_reason ?? "").trim();
  const reasons: Record<string, string> = {};
  const missing: CloseMiss[] = [];
  for (const it of items) {
    const own = String(answers[`reason_${it.key}`] ?? "").trim();
    const useShared = answers[`use_shared_${it.key}`] === "yes";
    const reason = own || (useShared ? shared : "") || String(it.existingReason ?? "").trim();
    if (reason) reasons[it.key] = reason.slice(0, 200);
    else missing.push(it);
  }
  return { reasons, missing };
}

/** Score text: "No commitments" when nothing was decided, otherwise the percentage. */
export function scoreText(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? "No commitments" : `${pct}%`;
}

/**
 * Calendar time blocks as suggestions with approval (Productivity, Calendar time blocks).
 *
 * Each morning (and on "Suggest blocks now") the app suggests time blocks for today's priority tasks. Nothing goes to
 * Google Calendar until the owner presses Approve (or Approve all). Delete removes a suggestion; a deleted suggestion
 * is not suggested again for the same task on the same day.
 *
 * No database update: the state of a time block is kept in `calendar_events.dedupe_key` (one key per task and day):
 *   suggest:<task id>:<date>     suggested, waiting for approval (no Google event yet)
 *   block:<task id>:<date>       approved, created in Google Calendar (the key time blocks always had)
 *   dismissed:<task id>:<date>   deleted by the owner (kept hidden, so it is not suggested again that day)
 * A time block with no key (added by hand with "Add a block manually") is "manual".
 * Pure functions, tested in src/lib/time-blocks.test.ts; database work in src/lib/engine/time-blocks.ts.
 */
export type BlockState = "suggested" | "approved" | "dismissed" | "manual";

export const suggestKey = (taskId: string, date: string) => `suggest:${taskId}:${date}`;
export const approvedKey = (taskId: string, date: string) => `block:${taskId}:${date}`;
export const dismissedKey = (taskId: string, date: string) => `dismissed:${taskId}:${date}`;

/** The state of a calendar_events row of kind time_block. */
export function blockState(row: { dedupe_key?: string | null; google_event_id?: string | null }): BlockState {
  const key = row.dedupe_key ?? "";
  if (key.startsWith("suggest:")) return "suggested";
  if (key.startsWith("dismissed:")) return "dismissed";
  if (key.startsWith("block:") || row.google_event_id) return "approved";
  return "manual";
}

/** The task and date in a time block key (null for a block with no key). */
export function parseBlockKey(key: string | null | undefined): { state: BlockState; taskId: string; date: string } | null {
  const m = String(key ?? "").match(/^(suggest|block|dismissed):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i);
  if (!m) return null;
  const state: BlockState = m[1] === "suggest" ? "suggested" : m[1] === "block" ? "approved" : "dismissed";
  return { state, taskId: m[2], date: m[3] };
}

export type PlannedBlock = { taskId: string; title: string; startMin: number; endMin: number };

/**
 * Today's suggestions: the first `count` open priority tasks (already in priority order) that have no approved or
 * deleted block today, minus the blocks already approved today. Blocks start `startMin` minutes after midnight (the
 * morning hour plus 2 hours), or 15 minutes after the last approved block when that is later, each `minutes` long with
 * 15 minutes between them, and never past 22:00.
 */
export function planBlocks(p: {
  tasks: { id: string; title: string }[];
  count: number;
  minutes: number;
  startMin: number;
  /** Today's time blocks that are approved or deleted (their tasks are skipped). */
  taken: { taskId: string; state: BlockState; endMin?: number | null }[];
}): PlannedBlock[] {
  const minutes = Math.max(15, Math.round(p.minutes));
  const approved = p.taken.filter((t) => t.state === "approved");
  const room = Math.max(0, Math.round(p.count) - approved.length);
  const skip = new Set(p.taken.filter((t) => t.state === "approved" || t.state === "dismissed").map((t) => t.taskId));
  const lastEnd = Math.max(0, ...approved.map((a) => Number(a.endMin ?? 0)));
  let start = Math.max(p.startMin, lastEnd ? lastEnd + 15 : 0);
  const out: PlannedBlock[] = [];
  for (const t of p.tasks) {
    if (out.length >= room) break;
    if (skip.has(t.id)) continue;
    const end = start + minutes;
    if (end > 22 * 60) break;
    out.push({ taskId: t.id, title: t.title, startMin: start, endMin: end });
    start = end + 15;
  }
  return out;
}

/** The title shown in Google Calendar for a task's block. */
export const blockTitle = (taskTitle: string) => `Focus: ${taskTitle}`;

/** What changes on the row when a suggestion is approved and Google returned the event id. */
export function approvalPatch(row: { dedupe_key?: string | null; task_id?: string | null }, googleEventId: string, today: string): { google_event_id: string; dedupe_key: string | null } {
  const parsed = parseBlockKey(row.dedupe_key);
  const taskId = parsed?.taskId ?? row.task_id ?? null;
  return { google_event_id: googleEventId, dedupe_key: taskId ? approvedKey(taskId, parsed?.date ?? today) : row.dedupe_key ?? null };
}

/** What changes on the row when a suggestion is deleted (kept hidden; null means delete the row). */
export function dismissalPatch(row: { dedupe_key?: string | null; task_id?: string | null }): { dedupe_key: string } | null {
  const parsed = parseBlockKey(row.dedupe_key);
  return parsed ? { dedupe_key: dismissedKey(parsed.taskId, parsed.date) } : null;
}

/** "9:00 AM" from minutes after midnight. */
export function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Block lengths offered by Edit (minutes). */
export const BLOCK_LENGTHS = [15, 30, 45, 60, 90, 120];

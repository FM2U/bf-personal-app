/**
 * Today and Close the day (the focused version, batch 1): the planned outcomes, what can be picked as an outcome,
 * the close steps, and the daily report content (the "day detail" saved in a daily partner report).
 * Pure functions, tested in src/lib/calc/today.test.ts. Loading is in src/lib/today.ts and src/lib/engine/day-detail.ts.
 */

export type OutcomeStatus = "planned" | "complete" | "partial" | "incomplete";

export const OUTCOME_STATUSES: OutcomeStatus[] = ["planned", "complete", "partial", "incomplete"];
export const isOutcomeStatus = (s: string): s is OutcomeStatus => (OUTCOME_STATUSES as string[]).includes(s);

/** The three choices at the close, in the order of the segmented control. */
export const CLOSE_CHOICES: { value: Exclude<OutcomeStatus, "planned">; label: string }[] = [
  { value: "complete", label: "Complete" },
  { value: "partial", label: "Partial" },
  { value: "incomplete", label: "Incomplete" },
];

export const OUTCOME_STATUS_LABEL: Record<OutcomeStatus, string> = { planned: "Planned", complete: "Complete", partial: "Partial", incomplete: "Incomplete" };

/** Up to 3 outcomes a day. */
export const OUTCOME_SLOTS = [1, 2, 3] as const;
export const DEFAULT_BLOCK_MINUTES = 60;

/** One planned outcome, as Today and the close show it. */
export type Outcome = {
  id: string | null;
  position: number;
  title: string;
  initiativeId: string | null;
  pipelineItemId: string | null;
  taskId: string | null;
  blockMinutes: number | null;
  status: OutcomeStatus;
  resultNote: string;
  actualMinutes: number | null;
};

export function emptyOutcome(position: number, initiativeId: string | null = null): Outcome {
  return { id: null, position, title: "", initiativeId, pipelineItemId: null, taskId: null, blockMinutes: DEFAULT_BLOCK_MINUTES, status: "planned", resultNote: "", actualMinutes: null };
}

/** The three slots: saved rows in their positions, empty rows for the rest. */
export function outcomeSlots(rows: Outcome[], lastInitiativeId: string | null = null): Outcome[] {
  return OUTCOME_SLOTS.map((p) => rows.find((r) => r.position === p) ?? emptyOutcome(p, lastInitiativeId));
}

/** The first slot without a title, or null when all three are used. */
export function nextEmptyPosition(rows: Outcome[]): number | null {
  const used = new Set(rows.filter((r) => r.title.trim()).map((r) => r.position));
  return OUTCOME_SLOTS.find((p) => !used.has(p)) ?? null;
}

/** "90 min", or "" when no block is set. */
export function blockText(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined ? "" : `${minutes} min`;
}

/** A typed block: "90", "90 min", "1.5 h", or "1h30" become minutes (0 to 1440); anything else is null. */
export function parseBlockMinutes(s: string | null | undefined): number | null {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return null;
  const hm = t.match(/^(\d+(?:[.,]\d+)?)\s*h(?:ours?)?\s*(\d+)?\s*(?:m|min)?$/);
  let minutes: number;
  if (hm) minutes = Math.round(Number(hm[1].replace(",", ".")) * 60 + Number(hm[2] ?? 0));
  else {
    const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(m|min|minutes?)?$/);
    if (!m) return null;
    minutes = Math.round(Number(m[1].replace(",", ".")));
  }
  if (!Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(1440, minutes));
}

/** Focused hours typed on Today: 0 to 24 with one decimal, or null when empty or not a number. */
export function parseFocusedHours(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined || String(s).trim() === "") return null;
  const n = Number(String(s).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(24, Math.round(n * 10) / 10));
}

/** "Focused hours today: 4" shows "4", "2.5" shows "2.5". */
export function focusedHoursText(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(Number(n)).replace(/\.0$/, "");
}

// ---------- Pick from next actions ----------

export type PickTask = { id: string; title: string; due_date: string | null; initiative_id: string | null; pipeline_item_id: string | null; priority?: number | null };
export type PickItem = { id: string; name: string; next_action: string | null; next_action_due: string | null; initiative_id: string | null };

export type NextActionPick = {
  key: string;
  title: string;
  /** The item the action is for ("Demo HVAC Services Co"), shown small after the title. */
  forName: string | null;
  initiativeId: string | null;
  pipelineItemId: string | null;
  taskId: string | null;
  due: string | null;
  overdue: boolean;
};

/**
 * What "Pick from next actions" offers: open tasks due today or earlier (overdue first, then by priority), then the
 * next actions of open pipeline items due today or earlier that have no task of their own. Tasks and items already
 * used by an outcome are left out, as is the daily close task (the Close the day button covers it).
 */
export function pickableActions(tasks: PickTask[], items: PickItem[], outcomes: Outcome[], today: string, limit = 8): NextActionPick[] {
  const usedTasks = new Set(outcomes.map((o) => o.taskId).filter(Boolean));
  const usedItems = new Set(outcomes.map((o) => o.pipelineItemId).filter(Boolean));
  const taskItems = new Set(tasks.map((t) => t.pipeline_item_id).filter(Boolean));
  const out: NextActionPick[] = [];
  const sortedTasks = [...tasks]
    .filter((t) => !!t.due_date && t.due_date <= today && !usedTasks.has(t.id) && !isCloseTask(t.title))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : Number(a.priority ?? 2) - Number(b.priority ?? 2) || a.title.localeCompare(b.title)));
  for (const t of sortedTasks) {
    if (t.pipeline_item_id && usedItems.has(t.pipeline_item_id)) continue;
    out.push({ key: `task:${t.id}`, title: t.title, forName: null, initiativeId: t.initiative_id ?? null, pipelineItemId: t.pipeline_item_id ?? null, taskId: t.id, due: t.due_date, overdue: t.due_date! < today });
  }
  const sortedItems = [...items]
    .filter((i) => !!i.next_action && !!i.next_action_due && i.next_action_due <= today && !usedItems.has(i.id) && !taskItems.has(i.id))
    .sort((a, b) => (a.next_action_due! < b.next_action_due! ? -1 : a.next_action_due! > b.next_action_due! ? 1 : a.name.localeCompare(b.name)));
  for (const i of sortedItems) out.push({ key: `item:${i.id}`, title: String(i.next_action), forName: i.name, initiativeId: i.initiative_id ?? null, pipelineItemId: i.id, taskId: null, due: i.next_action_due, overdue: i.next_action_due! < today });
  return out.slice(0, limit);
}

/** The scheduled daily close task ("Complete the daily close"): the Close the day button covers it. */
export function isCloseTask(title: string | null | undefined): boolean {
  return /^complete the daily close$/i.test(String(title ?? "").trim());
}

/** Next actions on Today: open tasks due today or earlier, overdue first, then high priority, without the daily close task. */
export function nextActionTasks<T extends PickTask>(tasks: T[], today: string): T[] {
  return [...tasks]
    .filter((t) => !!t.due_date && t.due_date <= today && !isCloseTask(t.title))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : Number(a.priority ?? 2) - Number(b.priority ?? 2) || a.title.localeCompare(b.title)));
}

// ---------- Waiting on someone ----------

export type WaitingRow = { id: string; title: string; who: string; since: string | null };

/** Tasks that wait on someone, the longest wait first. */
export function waitingRows(tasks: { id: string; title: string; status?: string | null; waiting_on?: string | null; waiting_since?: string | null }[]): WaitingRow[] {
  return tasks
    .filter((t) => (t.status ?? "todo") === "todo" && String(t.waiting_on ?? "").trim())
    .map((t) => ({ id: t.id, title: t.title, who: String(t.waiting_on).trim(), since: t.waiting_since ?? null }))
    .sort((a, b) => (a.since ?? "9999") < (b.since ?? "9999") ? -1 : (a.since ?? "9999") > (b.since ?? "9999") ? 1 : a.title.localeCompare(b.title));
}

// ---------- Close the day ----------

export type CloseStep = 1 | 2 | 3;
export const CLOSE_STEPS: { step: CloseStep; label: string }[] = [
  { step: 1, label: "Outcomes" },
  { step: 2, label: "Changes" },
  { step: 3, label: "Report" },
];

/** The step to show: the one in the address when valid, otherwise the saved one (1 when none). */
export function closeStep(fromAddress: string | null | undefined, saved: unknown): CloseStep {
  const n = Number(fromAddress);
  if (n === 1 || n === 2 || n === 3) return n;
  const s = Number(saved);
  return s === 2 || s === 3 ? s : 1;
}

/** The problem with step 2 in plain words, or null. */
export function changesStepProblem(tomorrow: string): string | null {
  return tomorrow.trim() ? null : "Write tomorrow's top priority (one line).";
}

/** The state of the day on Today: open (the Close the day button), closed (Day closed, Reopen), or a weekend. */
export function dayState(review: { status: string } | null, weekday: boolean): "open" | "closed" | "weekend" {
  if (review?.status === "completed") return "closed";
  return weekday ? "open" : "weekend";
}

// ---------- The daily report content (saved with a daily partner report as snapshot.day) ----------

export type DayOutcome = { title: string; status: OutcomeStatus; result: string | null; initiative: string | null; block: number | null; actual: number | null };
export type DayTarget = { name: string; count: number; required: number; met: boolean; period: "day" | "week" };
export type DayInitiative = {
  name: string;
  targets: DayTarget[];
  tasksDone: number;
  /** Pipeline items that moved stage today (the stage they moved to). */
  moved: { item: string; stage: string }[];
  /** Pipeline items passed today, with the reason when one was given. */
  passes: { item: string; reason: string | null }[];
  outreach: number;
};
export type DayDetail = {
  date: string;
  focusedHours: number | null;
  outcomes: DayOutcome[];
  initiatives: DayInitiative[];
  changes: string | null;
  tomorrow: string | null;
};

export type DayDetailInput = {
  date: string;
  focusedHours: number | null;
  changes: string | null;
  tomorrow: string | null;
  initiatives: { id: string; name: string }[];
  outcomes: Outcome[];
  /** Active targets with today's count (day targets today, week targets this week), each with its initiative. */
  targets: { name: string; initiativeId: string | null; count: number; required: number; met: boolean; off: boolean; period: "day" | "week" }[];
  /** Tasks marked done today: the initiative directly, or through the pipeline item. */
  tasksDone: { initiativeId: string | null; pipelineItemId: string | null }[];
  /** Pipeline items: which initiative (through the pipeline). */
  items: { id: string; name: string; initiativeId: string | null }[];
  /** Stage moves today (not the entry made when the item was created): the stage moved to and whether it is a pass. */
  moves: { itemId: string; stage: string; pass: boolean; reason: string | null }[];
  /** Outreach logged today: the pipeline item when linked. */
  outreach: { pipelineItemId: string | null }[];
  /** The initiative unlinked outreach counts for (the Network outreach target's initiative), if any. */
  outreachInitiativeId: string | null;
};

const OTHER = "Other";

/**
 * The daily report content: the planned outcomes with their status, and progress by initiative (activity counts
 * against targets, tasks done, pipeline items moved stage, passes, outreach). Initiatives with nothing to report
 * are left out; activity that belongs to no initiative is grouped under "Other".
 */
export function buildDayDetail(input: DayDetailInput): DayDetail {
  const name = new Map(input.initiatives.map((i) => [i.id, i.name]));
  const itemInitiative = new Map(input.items.map((i) => [i.id, i.initiativeId]));
  const itemName = new Map(input.items.map((i) => [i.id, i.name]));
  const groups = new Map<string, DayInitiative>();
  const group = (initiativeId: string | null | undefined) => {
    const key = (initiativeId && name.has(initiativeId) ? initiativeId : OTHER) as string;
    let g = groups.get(key);
    if (!g) {
      g = { name: key === OTHER ? OTHER : name.get(key)!, targets: [], tasksDone: 0, moved: [], passes: [], outreach: 0 };
      groups.set(key, g);
    }
    return g;
  };
  for (const t of input.targets) {
    if (t.off) continue;
    group(t.initiativeId).targets.push({ name: t.name, count: t.count, required: t.required, met: t.met, period: t.period });
  }
  for (const t of input.tasksDone) group(t.initiativeId ?? (t.pipelineItemId ? itemInitiative.get(t.pipelineItemId) : null)).tasksDone++;
  for (const m of input.moves) {
    const g = group(itemInitiative.get(m.itemId));
    const item = itemName.get(m.itemId) ?? "Pipeline item";
    if (m.pass) g.passes.push({ item, reason: m.reason });
    else g.moved.push({ item, stage: m.stage });
  }
  for (const o of input.outreach) group(o.pipelineItemId ? itemInitiative.get(o.pipelineItemId) : input.outreachInitiativeId).outreach++;
  // In the order of the initiatives list, then Other; only groups with something to show.
  const ordered = [...input.initiatives.map((i) => i.id), OTHER].map((k) => groups.get(k)).filter((g): g is DayInitiative => !!g && (g.targets.length > 0 || g.tasksDone > 0 || g.moved.length > 0 || g.passes.length > 0 || g.outreach > 0));
  return {
    date: input.date,
    focusedHours: input.focusedHours,
    outcomes: input.outcomes
      .filter((o) => o.title.trim())
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ title: o.title.trim(), status: o.status, result: o.resultNote.trim() || null, initiative: (o.initiativeId && name.get(o.initiativeId)) || null, block: o.blockMinutes, actual: o.actualMinutes })),
    initiatives: ordered,
    changes: input.changes?.trim() || null,
    tomorrow: input.tomorrow?.trim() || null,
  };
}

/** One line per initiative for plain text: "Acquisition Search: Listings screened 12 of 20; tasks done 2; moved: X to CIM review; passed: Y". */
export function initiativeLine(g: DayInitiative): string {
  const parts: string[] = [];
  for (const t of g.targets) parts.push(`${t.name} ${t.count} of ${t.required}${t.period === "week" ? " this week" : ""}`);
  if (g.tasksDone) parts.push(`${g.tasksDone} ${g.tasksDone === 1 ? "task" : "tasks"} done`);
  for (const m of g.moved) parts.push(`moved: ${m.item} to ${m.stage}`);
  for (const p of g.passes) parts.push(`passed: ${p.item}${p.reason ? ` (${p.reason})` : ""}`);
  if (g.outreach && !g.targets.some((t) => /outreach/i.test(t.name))) parts.push(`${g.outreach} outreach ${g.outreach === 1 ? "message" : "messages"} sent`);
  return `${g.name}: ${parts.join("; ")}`;
}

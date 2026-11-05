/**
 * The areas of Work on now (batch B2, approved 2026-10-31; "lanes" in the code): Next actions merges every area
 * into one list. A deal row has no pill; outreach follow-ups, Rosara project actions, Job search opportunities,
 * Consulting items, and (Edit batch C round 2) personal to-dos due today or earlier carry an area pill ("To-do").
 * Pure and tested in src/lib/work/lanes.test.ts: the row key per lane, the sections (Overdue, Due today, Needs a next
 * action), the Area filter, the AI order (the reply's check, the cache, how a cached order is applied to the rows on
 * the page, and the day-start rule), and the prompt the AI gets.
 */
import { daysBetween } from "@/lib/calc/dates";

export type Lane = "Deals" | "People" | "Rosara" | "Job search" | "Consulting" | "To-dos";
/** One row of Next actions, whichever lane it comes from (a subset of what the row component shows). */
export type HomeAction = {
  /** "deal:<id>", "person:<id>", "project:<id>", "job:<id>", "consulting:<id>" (the AI order and the cache use it). */
  key: string;
  lane: Lane;
  id: string;
  name: string;
  /** The next action or what the follow-up is for. */
  action: string | null;
  /** YYYY-MM-DD or null. */
  due: string | null;
  minutes: number | null;
  /** The small gray context (stage and what it does, organization and role, milestone). */
  meta: string;
  /** A deal waiting on someone and for how long (the AI reads it). */
  waitingOn?: string | null;
  waitDays?: number;
  /** "day 6" in a stage (the AI reads it). */
  dayInStage?: number | null;
};

const PREFIX: Record<Lane, string> = { Deals: "deal", People: "person", Rosara: "project", "Job search": "job", Consulting: "consulting", "To-dos": "todo" };

export function actionKey(lane: Lane, id: string): string {
  return `${PREFIX[lane]}:${id}`;
}

export type LaneSectionKey = "overdue" | "today" | "needs";

/** Overdue: due before today. Due today: due today. Needs a next action: no action (deals, projects, opportunities, consulting). */
export function laneSectionOf(a: Pick<HomeAction, "action" | "due">, today: string): LaneSectionKey | null {
  if (!String(a.action ?? "").trim()) return "needs";
  if (!a.due) return null;
  const d = a.due.slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  return null;
}

/** Within a section: soonest due first (overdue: the oldest first), then by lane order (deals first), then by name. */
const LANE_ORDER: Lane[] = ["Deals", "People", "Rosara", "Job search", "Consulting", "To-dos"];

export function compareActions(a: HomeAction, b: HomeAction): number {
  const da = a.due ?? "9999";
  const db = b.due ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  const la = LANE_ORDER.indexOf(a.lane);
  const lb = LANE_ORDER.indexOf(b.lane);
  if (la !== lb) return la - lb;
  return a.name.localeCompare(b.name);
}

/** The three sections of Next actions over every lane, each sorted ("Soonest first"). Rows due later are left out. */
export function mergeLanes<T extends HomeAction>(actions: readonly T[], today: string): Record<LaneSectionKey, T[]> {
  const out: Record<LaneSectionKey, T[]> = { overdue: [], today: [], needs: [] };
  for (const a of actions) {
    const s = laneSectionOf(a, today);
    if (s) out[s].push(a);
  }
  out.overdue.sort(compareActions);
  out.today.sort(compareActions);
  out.needs.sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || a.name.localeCompare(b.name));
  return out;
}

/** "Find": the name or the context line (stage, organization, milestone) holds the typed text, any letter case. */
export function matchesActionSearch(a: Pick<HomeAction, "name" | "meta">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || a.name.toLowerCase().includes(q) || a.meta.toLowerCase().includes(q);
}

// ---------- The Area filter (2026-11-04) ----------

/**
 * The Filter window on Work on now has one column, Area: Deals, Contacts, Rosara, Job search, Consulting, To-dos, and
 * Tasks (a dated task on a record). Ticking areas narrows Next actions and its tile numbers; Waiting on someone is not
 * filtered. Several ticks mean either one; none ticked shows every area.
 */
export const AREAS = [
  { value: "deals", label: "Deals" },
  { value: "contacts", label: "Contacts" },
  { value: "rosara", label: "Rosara" },
  { value: "job-search", label: "Job search" },
  { value: "consulting", label: "Consulting" },
  { value: "todos", label: "To-dos" },
  { value: "tasks", label: "Tasks" },
] as const;
export type AreaKey = (typeof AREAS)[number]["value"];

/** The ticked areas are remembered in this browser under this key. */
export const AREA_STORAGE_KEY = "work-home-areas";

/** The area of a row: its lane, with a to-do on a record counted as a Task. */
export function areaOf(lane: Lane, onRecord = false): AreaKey {
  if (lane === "To-dos") return onRecord ? "tasks" : "todos";
  return ({ Deals: "deals", People: "contacts", Rosara: "rosara", "Job search": "job-search", Consulting: "consulting" } as const)[lane];
}

/**
 * The Area filter on To-dos (2026-11-04): the same areas without Tasks, since a task on a record counts by its record's
 * area there (a deal or listing is Deals, a person or organization Contacts, a project Rosara, a job Job search, a
 * consulting item Consulting) and a personal to-do with no record is To-dos.
 */
export const TODO_AREAS = AREAS.filter((a) => a.value !== "tasks");

export function todoAreaOf(record: { kind: string } | null): AreaKey {
  if (!record) return "todos";
  switch (record.kind) {
    case "person":
    case "organization":
      return "contacts";
    case "project":
      return "rosara";
    case "job":
      return "job-search";
    case "consulting":
      return "consulting";
    default:
      return "deals";
  }
}

/** The ticked areas on To-dos are remembered in this browser under this key. */
export const TODO_AREA_STORAGE_KEY = "work-todos-areas";

/** "Showing: Deals or Contacts", or "Showing every area". */
export function areaSummary(ticked: readonly string[]): string {
  const labels = AREAS.filter((a) => ticked.includes(a.value)).map((a) => a.label);
  return labels.length ? `Showing: ${labels.join(" or ")}` : "Showing every area";
}

// ---------- The AI order ----------

export type OrderChoice = "soonest" | "ai";

/** The choice is remembered in this browser under this key, with the day it was made. */
export const ORDER_STORAGE_KEY = "work-home-order";

/**
 * Each new day starts on Soonest first (approved 2026-11-04): By the AI is remembered for the rest of the day it was
 * picked only. The saved value is {"choice":"ai","day":"YYYY-MM-DD"}; anything else (an older plain "ai", another
 * day, nothing saved) is Soonest first.
 */
export function parseOrderChoice(raw: string | null | undefined, today: string): OrderChoice {
  if (!raw) return "soonest";
  try {
    const v = JSON.parse(raw) as { choice?: unknown; day?: unknown } | null;
    return v && v.choice === "ai" && v.day === today ? "ai" : "soonest";
  } catch {
    return "soonest";
  }
}

/** What is saved for a choice made today. */
export function orderToStore(choice: OrderChoice, today: string): string {
  return JSON.stringify({ choice, day: today });
}

/** The AI's order of the day: the row keys in the order to do them, and one reason per key. */
export type AiOrder = { order: string[]; reasons: Record<string, string>; forDate: string; createdAt: string };

const AI_REASON_MAX_LENGTH = 160;

/**
 * Checks the AI's reply: {"order": [{"key": "deal:...", "reason": "..."}, ...]}. Keys that are not on the page are
 * dropped, a key given twice counts once, and every row the AI left out goes to the end in its "Soonest first" order,
 * so nothing disappears. Fails only when nothing usable came back.
 */
export function validateAiOrderReply(value: unknown, keys: readonly string[]): { ok: true; value: { order: string[]; reasons: Record<string, string> } } | { ok: false; error: string } {
  const v = value as { order?: unknown; items?: unknown } | null;
  const raw = Array.isArray(v) ? v : Array.isArray(v?.order) ? v!.order : Array.isArray(v?.items) ? v!.items : null;
  if (!raw) return { ok: false, error: 'the reply needs an "order" array of {key, reason}' };
  const known = new Set(keys);
  const order: string[] = [];
  const reasons: Record<string, string> = {};
  for (const item of raw as unknown[]) {
    // A plain-text line (the reader's {items}, Edit batch B) names its key somewhere; the rest of the line is the reason.
    const line = typeof item === "string" ? item : "";
    const inLine = line ? keys.find((k) => line.includes(k)) : undefined;
    const key = inLine ?? (typeof (item as { key?: unknown })?.key === "string" ? String((item as { key: string }).key) : line);
    if (!known.has(key) || order.includes(key)) continue;
    order.push(key);
    const lineReason = inLine
      ? line
          .replace(inLine, "")
          .replace(/^\s*(?:\d+[.)])?\s*(?:key=)?[\s:|,.)-]*/i, "")
          .replace(/^(?:reason:?)\s*/i, "")
          .replace(/[\s:|,.-]+$/g, "")
      : "";
    const reason = (typeof (item as { reason?: unknown })?.reason === "string" ? String((item as { reason: string }).reason) : lineReason).replace(/\s+/g, " ").trim().slice(0, AI_REASON_MAX_LENGTH);
    if (reason) reasons[key] = reason;
  }
  if (!order.length) return { ok: false, error: "no key in the reply matches a row on the page" };
  for (const k of keys) if (!order.includes(k)) order.push(k);
  return { ok: true, value: { order, reasons } };
}

/** The rows in the AI's order; a row the cache does not know (added since the order was made) goes to the end. */
export function applyAiOrder<T extends { key: string }>(rows: readonly T[], order: readonly string[]): T[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: T[] = [];
  for (const k of order) {
    const r = byKey.get(k);
    if (r && !out.includes(r)) out.push(r);
  }
  for (const r of rows) if (!out.includes(r)) out.push(r);
  return out;
}

/** "Ordered by the AI this morning", "this afternoon", "this evening", "yesterday" (older orders are made again). */
export function orderedAtLabel(createdAt: string, today: string, hourLocal: number): string {
  const day = createdAt.slice(0, 10);
  if (day !== today) return daysBetween(day, today) === 1 ? "Ordered by the AI yesterday" : `Ordered by the AI on ${day}`;
  return `Ordered by the AI this ${hourLocal < 12 ? "morning" : hourLocal < 17 ? "afternoon" : "evening"}`;
}

/**
 * The prompt for the order: the day's next actions (due today or earlier) with what the AI should weigh (the due time,
 * how long a broker has been quiet, the stage, the minutes), and the strict JSON it must return.
 */
export function aiOrderPrompt(actions: readonly HomeAction[], today: string): string {
  const lines = actions.map((a) => {
    const parts = [`key=${a.key}`, `area=${a.lane === "People" ? "Contacts" : a.lane}`, `name=${a.name}`, `action=${a.action ?? "(none)"}`, `due=${a.due ?? "no date"}`];
    if (a.minutes) parts.push(`minutes=${a.minutes}`);
    if (a.meta) parts.push(`context=${a.meta}`);
    if (a.waitingOn) parts.push(`waiting_on=${a.waitingOn} for ${a.waitDays ?? 0} days`);
    if (a.dayInStage) parts.push(`day_in_stage=${a.dayInStage}`);
    return `- ${parts.join(" | ")}`;
  });
  return [
    "TASK: ai_order",
    `Today is ${today}. Put Bram's next actions for today in the order he should do them.`,
    "Weigh: what is due earliest (overdue first), how long a broker or contact has been quiet (a long wait goes early), the stage (a deal late in its stages matters more), and the minutes needed (short items that unblock others go before long blocks).",
    "Give one short reason per row (at most 15 words, plain English, name the specific thing that decides it).",
    "",
    "The rows (one per line):",
    ...lines,
    "",
    'Return only JSON: {"order": [{"key": "<key exactly as given>", "reason": "<one line>"}, ...]} with every key once.',
  ].join("\n");
}

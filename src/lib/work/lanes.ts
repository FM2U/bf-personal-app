/**
 * The lanes of Home (batch B2, approved 2026-10-31): Next actions merges every lane into one list. A deal row has no
 * pill; outreach follow-ups, Rosara project actions, Job search opportunities, Consulting items, and (Edit batch C
 * round 2) personal to-dos due today or earlier carry a lane pill ("To-do"). Pure and tested in src/lib/work/lanes.test.ts: the row key per lane, the sections (Overdue, Due today, Needs
 * a next action), the filter counts, the AI order (the reply's check, the cache, and how a cached order is applied
 * to the rows on the page), and the prompt the AI gets.
 */
import { daysBetween } from "@/lib/calc/dates";

export type Lane = "Deals" | "Outreach" | "Rosara" | "Job search" | "Consulting" | "To-dos";

/** The lanes with a pill (deals have none). */
export type LanePillName = Exclude<Lane, "Deals">;

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

const PREFIX: Record<Lane, string> = { Deals: "deal", Outreach: "person", Rosara: "project", "Job search": "job", Consulting: "consulting", "To-dos": "todo" };

export function actionKey(lane: Lane, id: string): string {
  return `${PREFIX[lane]}:${id}`;
}

export function laneOfKey(key: string): Lane | null {
  const p = key.split(":")[0];
  return (Object.keys(PREFIX) as Lane[]).find((l) => PREFIX[l] === p) ?? null;
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
const LANE_ORDER: Lane[] = ["Deals", "Outreach", "Rosara", "Job search", "Consulting", "To-dos"];

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

// ---------- The Show filter (Edit batch C, item 2) ----------

/**
 * "Show: All" after the filter pills on Home: a checklist of the lanes (several allowed, Reset at the bottom). It
 * narrows Next actions and Waiting on someone, and the counts on the other pills follow it. To-dos narrows the personal
 * to-dos due today or earlier that sit on Next actions (Edit batch C round 2).
 */
export const SHOW_LANES = ["Deals", "Outreach", "Rosara", "Job search", "Consulting", "To-dos"] as const;
export type ShowLane = (typeof SHOW_LANES)[number];

/** The choice is remembered in this browser under this key. */
export const SHOW_STORAGE_KEY = "work-home-show";

/** The chosen lanes, or null for All (nothing saved, nothing valid saved, none chosen, or every lane chosen). */
export function parseShowChoice(raw: string | null | undefined): ShowLane[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  return normalizeShow(v.filter((x): x is ShowLane => (SHOW_LANES as readonly string[]).includes(String(x))));
}

/** In the menu's order, each lane once; none or all of them is All (null). */
export function normalizeShow(lanes: readonly ShowLane[] | null): ShowLane[] | null {
  if (!lanes) return null;
  const out = SHOW_LANES.filter((l) => lanes.includes(l));
  return out.length === 0 || out.length === SHOW_LANES.length ? null : out;
}

/** Ticks or unticks one lane. From All, ticking a lane shows only that lane. */
export function toggleShow(choice: readonly ShowLane[] | null, lane: ShowLane): ShowLane[] | null {
  if (!choice) return normalizeShow([lane]);
  return normalizeShow(choice.includes(lane) ? choice.filter((l) => l !== lane) : [...choice, lane]);
}

/** "Show: All" or "Show: 2" (how many lanes are chosen). */
export function showLabel(choice: readonly ShowLane[] | null): string {
  return choice ? `Show: ${choice.length}` : "Show: All";
}

/** Is a lane on the page under the choice? */
export function laneShown(lane: ShowLane, choice: readonly ShowLane[] | null): boolean {
  return !choice || choice.includes(lane);
}

// ---------- The AI order ----------

export type OrderChoice = "soonest" | "ai";

/** The choice is remembered in this browser under this key. */
export const ORDER_STORAGE_KEY = "work-home-order";

export function parseOrderChoice(v: unknown): OrderChoice {
  return v === "ai" ? "ai" : "soonest";
}

/** The AI's order of the day: the row keys in the order to do them, and one reason per key. */
export type AiOrder = { order: string[]; reasons: Record<string, string>; forDate: string; createdAt: string };

export const AI_REASON_MAX_LENGTH = 160;

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
    const parts = [`key=${a.key}`, `lane=${a.lane}`, `name=${a.name}`, `action=${a.action ?? "(none)"}`, `due=${a.due ?? "no date"}`];
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

import { daysBetween } from "./dates";
import type { DayCounts } from "./targets";

/**
 * Pipeline accountability: required details before a stage, stage time limits, stalled items,
 * deal source priority (proprietary first), and the counts behind the deal targets.
 * These functions are pure: the loaders in src/lib/pipeline.ts and src/lib/targets.ts pass the records in.
 */

// ---------- Required details before entering a stage ----------

export type RequiredFieldDef = {
  key: string;
  label: string;
  /** Where the value is stored: the item itself, or its detail record. */
  table: "pipeline_items" | "deal_financials" | "job_details" | "investor_details";
  /** Pipeline kinds the field applies to. Empty = every pipeline. */
  kinds: string[];
};

export const REQUIRED_FIELD_DEFS: RequiredFieldDef[] = [
  { key: "revenue", label: "Revenue", table: "deal_financials", kinds: ["acquisition"] },
  { key: "ebitda", label: "EBITDA", table: "deal_financials", kinds: ["acquisition"] },
  { key: "asking_price", label: "Asking price", table: "deal_financials", kinds: ["acquisition"] },
  { key: "sde", label: "SDE", table: "deal_financials", kinds: ["acquisition"] },
  { key: "financing_structure", label: "Financing structure", table: "deal_financials", kinds: ["acquisition"] },
  { key: "deal_source_type", label: "Deal source (proprietary or brokered)", table: "pipeline_items", kinds: ["acquisition"] },
  { key: "salary", label: "Salary", table: "job_details", kinds: ["job"] },
  { key: "bonus", label: "Bonus", table: "job_details", kinds: ["job"] },
  { key: "amount_discussed", label: "Amount discussed", table: "investor_details", kinds: ["investor"] },
  { key: "amount_committed", label: "Amount committed", table: "investor_details", kinds: ["investor"] },
  { key: "primary_contact_id", label: "Main contact", table: "pipeline_items", kinds: [] },
  { key: "organization_id", label: "Organization", table: "pipeline_items", kinds: [] },
];

export function requiredFieldLabel(key: string): string {
  return REQUIRED_FIELD_DEFS.find((d) => d.key === key)?.label ?? key.replace(/_/g, " ");
}

export type StageLite = { id: string; position: number; outcome: string; name?: string; required_fields?: string[] | null; max_days_in_stage?: number | null };

/**
 * Details required to enter a stage: the stage's own required fields plus those of every earlier stage
 * in the pipeline (so skipping a stage never skips its requirements). Moving to a lost stage needs nothing.
 */
export function requiredFieldsForStage(stages: StageLite[], targetStageId: string): string[] {
  const target = stages.find((s) => s.id === targetStageId);
  if (!target || target.outcome === "lost") return [];
  const out: string[] = [];
  for (const s of [...stages].sort((a, b) => a.position - b.position)) {
    if (s.position > target.position || s.outcome === "lost") continue;
    for (const k of s.required_fields ?? []) if (!out.includes(k)) out.push(k);
  }
  return out;
}

function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

/** Required fields that are empty. `values` merges the item and its detail record. */
export function missingRequiredFields(required: string[], values: Record<string, unknown>): { key: string; label: string }[] {
  return required.filter((k) => !isFilled(values[k])).map((k) => ({ key: k, label: requiredFieldLabel(k) }));
}

// ---------- Stage time limits ----------

export type StageLimitStatus = {
  daysInStage: number;
  /** Stage limit plus extensions; null when the stage has no limit. */
  limit: number | null;
  extensionDays: number;
  over: boolean;
  overBy: number;
};

/**
 * Days in stage = calendar days from the date the item entered the stage to today.
 * The item is over the limit when days in stage is greater than (stage limit + extension days).
 */
export function stageLimitStatus(p: { enteredDate: string; today: string; maxDays: number | null | undefined; extensionDays?: number }): StageLimitStatus {
  const daysInStage = Math.max(0, daysBetween(p.enteredDate, p.today));
  const ext = Math.max(0, Number(p.extensionDays ?? 0) || 0);
  if (p.maxDays === null || p.maxDays === undefined || !(Number(p.maxDays) > 0)) return { daysInStage, limit: null, extensionDays: ext, over: false, overBy: 0 };
  const limit = Number(p.maxDays) + ext;
  return { daysInStage, limit, extensionDays: ext, over: daysInStage > limit, overBy: Math.max(0, daysInStage - limit) };
}

/** One decision per item, stage stay, and limit. A new limit (after an extension) can open a new decision. */
export function stageLimitDedupeKey(itemId: string, stageId: string, enteredDate: string, extensionDays: number): string {
  return `stage-limit:${itemId}:${stageId}:${enteredDate}:${extensionDays}`;
}

// ---------- Stalled items ----------

/** Latest of the given dates (YYYY-MM-DD), or null. */
export function latestDate(dates: (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const d of dates) if (d && (!out || d > out)) out = d;
  return out;
}

/**
 * An open item is stalled when there has been no stage change and no linked activity
 * (communication, completed task, note, document) for `stallDays` days or more.
 */
export function stallStatus(p: { status: string; lastActivityDate: string | null; today: string; stallDays: number }): { stalled: boolean; daysSince: number | null } {
  if (p.status !== "open" || !p.lastActivityDate) return { stalled: false, daysSince: p.lastActivityDate ? daysBetween(p.lastActivityDate, p.today) : null };
  const daysSince = daysBetween(p.lastActivityDate, p.today);
  const days = Math.max(1, Number(p.stallDays) || 7);
  return { stalled: daysSince >= days, daysSince };
}

// ---------- Deal source priority ----------

export type DealSourceType = "proprietary" | "brokered";

export const DEAL_SOURCE_LABELS: Record<DealSourceType, string> = { proprietary: "Proprietary", brokered: "Brokered" };

/** Proprietary (off-market) first, then brokered, then not set. Items that are not deals rank with "not set". */
export function sourceRank(type: string | null | undefined): number {
  return type === "proprietary" ? 0 : type === "brokered" ? 1 : 2;
}

/** Board order inside a stage: proprietary first, then by next action due date (empty last), then name. */
export function compareDeals(a: { deal_source_type?: string | null; next_action_due?: string | null; name?: string }, b: typeof a): number {
  const r = sourceRank(a.deal_source_type) - sourceRank(b.deal_source_type);
  if (r) return r;
  const ad = a.next_action_due ?? "9999-12-31";
  const bd = b.next_action_due ?? "9999-12-31";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return String(a.name ?? "").localeCompare(String(b.name ?? ""));
}

/**
 * Task order: priority (1 high first), then due date, then tasks for proprietary deals above brokered ones.
 * `rankOf` gives the deal source rank of a task's pipeline item (2 when the task is not about a deal).
 * The sort is stable, so equal tasks keep their original order.
 */
export function sortTasksProprietaryFirst<T extends { priority?: number | null; due_date?: string | null; pipeline_item_id?: string | null }>(
  tasks: T[],
  rankOf: (itemId: string | null | undefined) => number,
  opts: { doneLast?: boolean; status?: (t: T) => string } = {},
): T[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (opts.doneLast && opts.status) {
        const ad = opts.status(a.t) === "done" ? 1 : 0;
        const bd = opts.status(b.t) === "done" ? 1 : 0;
        if (ad !== bd) return ad - bd;
      }
      const p = (a.t.priority ?? 2) - (b.t.priority ?? 2);
      if (p) return p;
      const ad = a.t.due_date ?? "9999-12-31";
      const bd = b.t.due_date ?? "9999-12-31";
      if (ad !== bd) return ad < bd ? -1 : 1;
      const r = rankOf(a.t.pipeline_item_id) - rankOf(b.t.pipeline_item_id);
      return r || a.i - b.i;
    })
    .map((x) => x.t);
}

// ---------- Deal targets ----------

export type SourcedItem = { id: string; date: string; deal_source_type?: string | null };
export type SourceBreakdown = { proprietary: number; brokered: number; notSet: number };

/** Deals sourced: one count per acquisition item created, on its local creation date. */
export function countDealsSourced(items: SourcedItem[]): DayCounts {
  const out: DayCounts = {};
  for (const it of items) if (it.date) out[it.date] = (out[it.date] ?? 0) + 1;
  return out;
}

/** Proprietary, brokered, and not set per date. */
export function sourcedBreakdownByDay(items: SourcedItem[]): Record<string, SourceBreakdown> {
  const out: Record<string, SourceBreakdown> = {};
  for (const it of items) {
    if (!it.date) continue;
    const b = (out[it.date] ??= { proprietary: 0, brokered: 0, notSet: 0 });
    if (it.deal_source_type === "proprietary") b.proprietary++;
    else if (it.deal_source_type === "brokered") b.brokered++;
    else b.notSet++;
  }
  return out;
}

export function sumBreakdown(byDay: Record<string, SourceBreakdown>, from: string, to: string): SourceBreakdown & { total: number; proprietarySharePct: number | null } {
  const s: SourceBreakdown = { proprietary: 0, brokered: 0, notSet: 0 };
  for (const [d, b] of Object.entries(byDay)) {
    if (d < from || d > to) continue;
    s.proprietary += b.proprietary;
    s.brokered += b.brokered;
    s.notSet += b.notSet;
  }
  const total = s.proprietary + s.brokered + s.notSet;
  return { ...s, total, proprietarySharePct: total ? Math.round((s.proprietary / total) * 100) : null };
}

export const ADVANCE_PURPOSES = ["cim_request", "source_contact"];

/**
 * Deals advanced: each acquisition item counts at most once per day when, that day, it
 * (a) entered a stage at or past the threshold stage (by position; passed or lost stages never count), or
 * (b) had a communication with purpose cim_request or source_contact.
 */
export function countDealsAdvanced(p: {
  moves: { item_id: string; date: string; position: number | null; outcome: string | null }[];
  comms: { item_id: string | null; date: string; purpose: string | null }[];
  minPosition: number;
}): DayCounts {
  const seen: Record<string, Set<string>> = {};
  const add = (date: string, item: string) => (seen[date] ??= new Set()).add(item);
  for (const m of p.moves) {
    if (!m.item_id || !m.date || m.position === null || m.outcome === "lost") continue;
    if (m.position >= p.minPosition) add(m.date, m.item_id);
  }
  for (const c of p.comms) {
    if (!c.item_id || !c.date || !ADVANCE_PURPOSES.includes(String(c.purpose))) continue;
    add(c.date, c.item_id);
  }
  return Object.fromEntries(Object.entries(seen).map(([d, s]) => [d, s.size]));
}

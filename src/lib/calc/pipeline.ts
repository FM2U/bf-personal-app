import type { DayCounts } from "./targets";

/**
 * Pipeline accountability: required details before a stage, stage time limits, stalled items,
 * deal source priority (proprietary first), and the counts behind the deal targets.
 * These functions are pure: the loaders in src/lib/pipeline.ts and src/lib/targets.ts pass the records in.
 */

// ---------- Required details before entering a stage ----------

type RequiredFieldDef = {
  key: string;
  label: string;
  /** Where the value is stored: the item itself, or its detail record. */
  table: "pipeline_items" | "deal_financials" | "job_details" | "investor_details" | "consulting_details";
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
  { key: "rate_type", label: "Rate type (hourly, project, or monthly retainer)", table: "consulting_details", kinds: ["consulting"] },
  { key: "rate", label: "Rate", table: "consulting_details", kinds: ["consulting"] },
  { key: "start_date", label: "Start date", table: "consulting_details", kinds: ["consulting"] },
  { key: "primary_contact_id", label: "Main contact", table: "pipeline_items", kinds: [] },
  { key: "organization_id", label: "Organization", table: "pipeline_items", kinds: [] },
];

function requiredFieldLabel(key: string): string {
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
// ---------- Stalled items ----------
// ---------- Deal targets ----------

type SourcedItem = { id: string; date: string; deal_source_type?: string | null };
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

const ADVANCE_PURPOSES = ["cim_request", "source_contact"];

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

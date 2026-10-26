import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  effectiveProbability,
  expectedIncomeGap,
  expectedMonthlyIncome,
  pipelineValue,
  signedMonthlyIncome,
  withinDates,
} from "@/lib/calc/consulting";
import { fetchAll } from "@/lib/data";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Consulting data (database update 0011): consulting items with their terms, expected monthly income, probability,
 * pipeline value, signed income for runway, and money received linked to engagements.
 * Never throws for a missing table or column: before the update everything is reported as unavailable.
 */

const scoped = <Q,>(q: Q, ownerId?: string): Q => (ownerId ? (q as unknown as { eq: (c: string, v: string) => Q }).eq("owner_id", ownerId) : q);

/** True when database update 0011 is applied (the consulting details table exists). */
export async function hasConsultingUpdate(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from("consulting_details").select("id").limit(1);
  return !error || !isMissingSchemaError(error);
}

export type ConsultingItem = {
  item: Row;
  stage: Row | null;
  terms: Row | null;
  expectedMonthly: number | null;
  /** What is missing to calculate the expected monthly income, or null. */
  gap: string | null;
  probabilityPct: number;
  /** The stage counts as signed work (Signed, Active). */
  signedStage: boolean;
  /** Signed work that is between its start and end dates today. */
  activeToday: boolean;
};

export type ConsultingData = {
  available: boolean;
  pipelines: Row[];
  stages: Row[];
  items: ConsultingItem[];
  /** Sum over open items of expected monthly income x probability. */
  pipelineValue: number;
  /** Expected monthly income of signed work active today (used by runway when the setting is on). */
  signedMonthly: number;
  /** Open items in a signed-work stage. */
  activeEngagements: number;
  /** Open items per open stage, in stage order. */
  byStage: { stage_id: string; name: string; count: number }[];
};

const EMPTY: ConsultingData = { available: false, pipelines: [], stages: [], items: [], pipelineValue: 0, signedMonthly: 0, activeEngagements: 0, byStage: [] };

export async function loadConsulting(sb: SupabaseClient, opts: { ownerId?: string; today: string }): Promise<ConsultingData> {
  if (!(await hasConsultingUpdate(sb))) return EMPTY;
  const { data: pipes, error } = await scoped(sb.from("pipelines").select("*"), opts.ownerId).eq("kind", "consulting").order("sort_order");
  if (error) return EMPTY;
  const pipelines = (pipes ?? []) as Row[];
  if (!pipelines.length) return { ...EMPTY, available: true };
  const ids = pipelines.map((p) => p.id);
  const [{ data: stageRows }, { data: itemRows }] = await Promise.all([
    sb.from("pipeline_stages").select("*").in("pipeline_id", ids).order("position"),
    sb.from("pipeline_items").select("*").in("pipeline_id", ids),
  ]);
  const stages = (stageRows ?? []) as Row[];
  const rows = (itemRows ?? []) as Row[];
  let details: Row[] = [];
  if (rows.length) {
    try {
      details = await fetchAll((a, b) => sb.from("consulting_details").select("*").in("item_id", rows.map((r) => r.id)).range(a, b));
    } catch {
      details = [];
    }
  }
  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const termsByItem = Object.fromEntries(details.map((d) => [d.item_id, d]));
  const items: ConsultingItem[] = rows.map((item) => {
    const stage = stageById[item.stage_id] ?? null;
    const terms = termsByItem[item.id] ?? null;
    const signedStage = !!stage?.counts_as_signed;
    return {
      item,
      stage,
      terms,
      expectedMonthly: expectedMonthlyIncome(terms),
      gap: expectedIncomeGap(terms),
      probabilityPct: effectiveProbability(terms?.probability_pct, stage?.default_probability_pct),
      signedStage,
      activeToday: item.status === "open" && signedStage && !!terms && withinDates(terms, opts.today),
    };
  });
  const open = items.filter((i) => i.item.status === "open");
  return {
    available: true,
    pipelines,
    stages,
    items,
    pipelineValue: pipelineValue(items.map((i) => ({ status: i.item.status, expectedMonthly: i.expectedMonthly, probabilityPct: i.probabilityPct }))),
    signedMonthly: signedMonthlyIncome(items.map((i) => ({ status: i.item.status, signedStage: i.signedStage, terms: i.terms })), opts.today),
    activeEngagements: open.filter((i) => i.signedStage).length,
    byStage: stages.filter((s) => s.outcome === "open").map((s) => ({ stage_id: s.id, name: s.name, count: open.filter((i) => i.item.stage_id === s.id).length })),
  };
}

/**
 * Consulting income received between two dates: money in (not transfers) linked to a consulting engagement
 * (transactions.pipeline_item_id, update 0011), or assigned to an income source of kind consulting.
 * Each transaction is counted once. Empty before update 0011 for the engagement link (income sources still count).
 */
export async function loadConsultingIncome(
  sb: SupabaseClient,
  opts: { ownerId?: string; from: string; to: string; itemIds?: string[] },
): Promise<{ total: number; transactions: Row[]; byItem: Record<string, number> }> {
  const { data: sources } = await scoped(sb.from("income_sources").select("id"), opts.ownerId).eq("kind", "consulting");
  const sourceIds = new Set(((sources ?? []) as Row[]).map((s) => s.id));
  const itemIds = new Set(opts.itemIds ?? []);
  const base = "id,date,amount,description,merchant_name,income_source_id,is_transfer";
  const read = (cols: string) =>
    fetchAll((a, b) => scoped(sb.from("transactions").select(cols), opts.ownerId).gt("amount", 0).gte("date", opts.from).lte("date", opts.to).order("date").range(a, b));
  let txns: Row[];
  try {
    txns = await read(`${base},pipeline_item_id`);
  } catch {
    txns = await read(base).catch(() => []);
  }
  const counted = txns.filter((t) => !t.is_transfer && ((t.pipeline_item_id && (!opts.itemIds || itemIds.has(t.pipeline_item_id))) || (t.income_source_id && sourceIds.has(t.income_source_id))));
  const byItem: Record<string, number> = {};
  for (const t of counted) if (t.pipeline_item_id) byItem[t.pipeline_item_id] = (byItem[t.pipeline_item_id] ?? 0) + Number(t.amount);
  return { total: Math.round(counted.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100, transactions: counted, byItem };
}

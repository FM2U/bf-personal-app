import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import {
  latestDate,
  missingRequiredFields,
  requiredFieldsForStage,
  sourceRank,
  stageLimitStatus,
  stallStatus,
  type StageLimitStatus,
  type StageLite,
} from "@/lib/calc/pipeline";
import { fetchAll } from "@/lib/data";
import { scoped } from "@/lib/finance";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Pipeline accountability data: last activity per item, stalled items, stage time limits with extensions,
 * deal source ranks, and required details before a stage.
 * Never throws for a missing table or column: features from database update 0009 are reported as unavailable.
 */

/** True when database update 0009 is applied (the stage task table exists). */
export async function hasPipelineUpdate(sb: SupabaseClient): Promise<boolean> {
  // A normal one-row read (not a HEAD request): a HEAD response has no body, so the error code would be missing.
  const { error } = await sb.from("stage_tasks").select("id").limit(1);
  return !error || !isMissingSchemaError(error);
}

const localDate = (ts: string | null | undefined, tz: string) => (ts ? todayInTz(tz, new Date(ts)) : null);

const chunk = <T,>(arr: T[], n = 100): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Latest activity date per item: stage change, linked communication, completed task, note, or document. */
export async function loadItemActivity(sb: SupabaseClient, items: Row[], tz: string, ownerId?: string): Promise<Record<string, string | null>> {
  const ids = items.map((i) => i.id);
  const out: Record<string, (string | null)[]> = Object.fromEntries(items.map((i) => [i.id, [localDate(i.stage_entered_at, tz), localDate(i.created_at, tz)]]));
  if (!ids.length) return {};
  const idSet = new Set(ids);
  const push = (id: string | null | undefined, d: string | null) => {
    if (id && idSet.has(id)) out[id].push(d);
  };
  const safe = async (p: () => Promise<Row[]>) => {
    try {
      return await p();
    } catch {
      return [] as Row[];
    }
  };
  const [linksFrom, linksTo, tasks, notes, docs, direct] = await Promise.all([
    safe(() => fetchAll((a, b) => scoped(sb.from("record_links").select("from_id,to_id"), ownerId).eq("from_type", "communications").eq("to_type", "pipeline_items").range(a, b))),
    safe(() => fetchAll((a, b) => scoped(sb.from("record_links").select("from_id,to_id"), ownerId).eq("from_type", "pipeline_items").eq("to_type", "communications").range(a, b))),
    safe(() => fetchAll((a, b) => scoped(sb.from("tasks").select("pipeline_item_id,completed_at"), ownerId).eq("status", "done").not("pipeline_item_id", "is", null).range(a, b))),
    safe(() => fetchAll((a, b) => scoped(sb.from("notes").select("record_id,created_at"), ownerId).eq("record_type", "pipeline_items").range(a, b))),
    safe(() => fetchAll((a, b) => scoped(sb.from("documents").select("record_id,created_at"), ownerId).eq("record_type", "pipeline_items").range(a, b))),
    // Communications saved with the item directly (update 0009). Empty before the update.
    safe(() => fetchAll((a, b) => scoped(sb.from("communications").select("pipeline_item_id,occurred_at"), ownerId).not("pipeline_item_id", "is", null).range(a, b))),
  ]);
  for (const t of tasks) push(t.pipeline_item_id, localDate(t.completed_at, tz));
  for (const n of notes) push(n.record_id, localDate(n.created_at, tz));
  for (const d of docs) push(d.record_id, localDate(d.created_at, tz));
  for (const c of direct) push(c.pipeline_item_id, localDate(c.occurred_at, tz));
  const commToItems: Record<string, string[]> = {};
  for (const l of linksFrom) if (idSet.has(l.to_id)) (commToItems[l.from_id] ??= []).push(l.to_id);
  for (const l of linksTo) if (idSet.has(l.from_id)) (commToItems[l.to_id] ??= []).push(l.from_id);
  const commIds = Object.keys(commToItems);
  for (const part of chunk(commIds)) {
    const { data } = await sb.from("communications").select("id,occurred_at").in("id", part);
    for (const c of (data ?? []) as Row[]) for (const itemId of commToItems[c.id] ?? []) push(itemId, localDate(c.occurred_at, tz));
  }
  return Object.fromEntries(Object.entries(out).map(([id, dates]) => [id, latestDate(dates)]));
}

export type ItemStatus = {
  lastActivity: string | null;
  stalled: boolean;
  daysSinceActivity: number | null;
  limit: StageLimitStatus | null;
  enteredDate: string | null;
};

export type PipelineStatus = {
  /** Database update 0009 applied (time limits, stage tasks, extensions, deal source). */
  available: boolean;
  stallDays: number;
  extensionDays: number;
  stages: Row[];
  byItem: Record<string, ItemStatus>;
};

async function inputNumber(sb: SupabaseClient, key: string, fallback: number, ownerId?: string): Promise<number> {
  const { data } = await scoped(sb.from("inputs").select("value_number"), ownerId).eq("key", key).maybeSingle();
  const v = (data as Row | null)?.value_number;
  return v === null || v === undefined || !(Number(v) > 0) ? fallback : Number(v);
}

/** Stalled status and stage time limit status for the given items (any pipelines). */
export async function loadPipelineStatus(
  sb: SupabaseClient,
  items: Row[],
  opts: { ownerId?: string; tz: string; today: string; stages?: Row[] },
): Promise<PipelineStatus> {
  const [available, stallDays, extensionDays, stagesRes, activity] = await Promise.all([
    hasPipelineUpdate(sb),
    inputNumber(sb, "pipeline_stall_days", 7, opts.ownerId),
    inputNumber(sb, "stage_extension_days", 7, opts.ownerId),
    opts.stages ? Promise.resolve({ data: opts.stages }) : scoped(sb.from("pipeline_stages").select("*"), opts.ownerId),
    loadItemActivity(sb, items, opts.tz, opts.ownerId),
  ]);
  const stages = ((stagesRes.data ?? []) as Row[]);
  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
  let extensions: Row[] = [];
  if (available && items.length) {
    try {
      extensions = await fetchAll((a, b) => scoped(sb.from("pipeline_item_stage_extensions").select("item_id,stage_id,stage_entered_at,extra_days"), opts.ownerId).range(a, b));
    } catch {
      extensions = [];
    }
  }
  const byItem: Record<string, ItemStatus> = {};
  for (const it of items) {
    const entered = localDate(it.stage_entered_at, opts.tz);
    const stall = stallStatus({ status: it.status, lastActivityDate: activity[it.id] ?? null, today: opts.today, stallDays });
    const enteredMs = it.stage_entered_at ? new Date(it.stage_entered_at).getTime() : NaN;
    const ext = extensions
      .filter((e) => e.item_id === it.id && e.stage_id === it.stage_id && new Date(e.stage_entered_at).getTime() === enteredMs)
      .reduce((s, e) => s + Number(e.extra_days || 0), 0);
    const st = stageById[it.stage_id];
    const limit =
      it.status === "open" && entered && st && st.max_days_in_stage !== undefined
        ? stageLimitStatus({ enteredDate: entered, today: opts.today, maxDays: st.max_days_in_stage, extensionDays: ext })
        : null;
    byItem[it.id] = { lastActivity: activity[it.id] ?? null, stalled: stall.stalled, daysSinceActivity: stall.daysSince, limit, enteredDate: entered };
  }
  return { available, stallDays, extensionDays, stages, byItem };
}

/** Deal source rank per pipeline item (0 proprietary, 1 brokered, 2 not set). All 2 before update 0009. */
export async function loadDealRanks(sb: SupabaseClient, ownerId?: string): Promise<(itemId: string | null | undefined) => number> {
  const { data, error } = await scoped(sb.from("pipeline_items").select("id,deal_source_type"), ownerId).not("deal_source_type", "is", null);
  if (error) return () => 2;
  const rank = Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.id, sourceRank(r.deal_source_type)]));
  return (id) => (id ? rank[id] ?? 2 : 2);
}

/** Deal source type per item id (only items that have one). Empty before update 0009. */
export async function loadDealTypes(sb: SupabaseClient, ownerId?: string): Promise<Record<string, string>> {
  const { data, error } = await scoped(sb.from("pipeline_items").select("id,deal_source_type"), ownerId).not("deal_source_type", "is", null);
  if (error) return {};
  return Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.id, r.deal_source_type]));
}

export const DETAIL_TABLE: Record<string, string> = { acquisition: "deal_financials", job: "job_details", investor: "investor_details", consulting: "consulting_details" };

/**
 * Details missing before the item can enter the stage. Empty when nothing is missing,
 * or when update 0009 is not applied yet (no required details are stored then).
 */
export async function missingForStage(sb: SupabaseClient, item: Row, targetStageId: string): Promise<{ key: string; label: string }[]> {
  const [{ data: stages }, { data: pipe }] = await Promise.all([
    sb.from("pipeline_stages").select("*").eq("pipeline_id", item.pipeline_id),
    sb.from("pipelines").select("kind").eq("id", item.pipeline_id).maybeSingle(),
  ]);
  const list = ((stages ?? []) as Row[]).map((s) => ({ id: s.id, position: Number(s.position), outcome: s.outcome, required_fields: Array.isArray(s.required_fields) ? s.required_fields : [] })) as StageLite[];
  const required = requiredFieldsForStage(list, targetStageId);
  if (!required.length) return [];
  let detail: Row = {};
  const table = DETAIL_TABLE[(pipe as Row | null)?.kind ?? ""];
  if (table) detail = ((await sb.from(table).select("*").eq("item_id", item.id).maybeSingle()).data as Row | null) ?? {};
  // The item's own fields win over detail fields with the same name.
  return missingRequiredFields(required, { ...detail, ...item });
}

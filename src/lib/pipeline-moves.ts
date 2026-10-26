import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { missingForStage } from "@/lib/pipeline";
import { DB_UPDATE_NOTICE, isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

type Sb = SupabaseClient;

const itemHref = (id: string, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `/records/pipeline_items/${id}${qs ? `?${qs}` : ""}`;
};

/**
 * Moves an item to a stage after checking the required details.
 * Returns the missing details (nothing is changed), or an empty list when the move was saved.
 */
export async function moveItemToStage(sb: Sb, item: Row, stageId: string): Promise<{ missing: { key: string; label: string }[] }> {
  const missing = await missingForStage(sb, item, stageId);
  if (missing.length) return { missing };
  const { error } = await sb.from("pipeline_items").update({ stage_id: stageId }).eq("id", item.id);
  if (error) throw new Error(error.message);
  return { missing: [] };
}

/**
 * Choosing an option on a stage time limit decision:
 *   "Advance to next stage" moves the item to the next open stage (blocked when required details are missing),
 *   "Pass" moves it to the pipeline's passed or lost stage,
 *   "Extend N days" adds N days to the limit for this item's current stay in the stage.
 * Returns true when the decision was handled here.
 */
export async function applyStageLimitChoice(sb: Sb, ownerId: string, decision: Row, option: Row): Promise<{ handled: boolean; redirectTo?: string }> {
  if (decision.source !== "pipeline_stage" || !decision.source_id) return { handled: false };
  const { data: item } = await sb.from("pipeline_items").select("*").eq("id", decision.source_id).maybeSingle();
  if (!item) return { handled: false };
  const label = String(option.label ?? "");
  const { data: stagesData } = await sb.from("pipeline_stages").select("*").eq("pipeline_id", item.pipeline_id).order("position");
  const stages = (stagesData ?? []) as Row[];
  const current = stages.find((s) => s.id === item.stage_id);
  if (label.startsWith("Advance")) {
    const next = stages.find((s) => s.outcome !== "lost" && Number(s.position) > Number(current?.position ?? 0));
    if (!next) return { handled: true, redirectTo: itemHref(item.id) };
    const { missing } = await moveItemToStage(sb, item as Row, next.id);
    if (missing.length) return { handled: true, redirectTo: itemHref(item.id, { blocked: next.id }) };
    return { handled: true };
  }
  if (label === "Pass") {
    const lost = stages.find((s) => s.outcome === "lost");
    if (lost) await moveItemToStage(sb, item as Row, lost.id);
    return { handled: true };
  }
  const m = label.match(/^Extend (\d+) days?$/);
  if (m) {
    const { error } = await sb.from("pipeline_item_stage_extensions").insert({
      owner_id: ownerId,
      item_id: item.id,
      stage_id: item.stage_id,
      stage_entered_at: item.stage_entered_at,
      extra_days: Number(m[1]),
      decision_id: decision.id,
      note: `Chosen on the decision "${decision.title}".`,
    });
    if (error) throw new Error(isMissingSchemaError(error) ? DB_UPDATE_NOTICE : error.message);
    return { handled: true };
  }
  return { handled: false };
}


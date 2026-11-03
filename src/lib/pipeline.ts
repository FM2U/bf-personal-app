import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  missingRequiredFields,
  requiredFieldsForStage,
  type StageLite,
} from "@/lib/calc/pipeline";
import type { Row } from "@/lib/types";








const DETAIL_TABLE: Record<string, string> = { acquisition: "deal_financials", job: "job_details", investor: "investor_details", consulting: "consulting_details" };

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

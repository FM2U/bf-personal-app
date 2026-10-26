import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/calc/dates";
import { hasPipelineUpdate } from "@/lib/pipeline";
import { hasConsultingUpdate } from "@/lib/consulting";
import { fieldTextForKind, hiddenForKind, type FieldText } from "@/lib/pipeline-labels";
import { COLUMNS_0009, COLUMNS_0011 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Which fields a record form shows and requires, and the labels that depend on the record (pipeline kind),
 * based on whether database updates 0009 and 0011 are applied. Used by the new-record page and the record page.
 * `updateNeeded` names the update that is missing: "0009" (supabase/UPDATE_RUN_ONCE.sql) or "0011"
 * (supabase/UPDATE_0011_RUN_ONCE.sql), or false.
 */
export async function formRules(
  sb: SupabaseClient,
  table: string,
  row: Row,
): Promise<{ hide: string[]; require: string[]; updateNeeded: false | "0009" | "0011"; kind: string | null; text: Record<string, FieldText> }> {
  const watched9 = COLUMNS_0009[table];
  const watched11 = COLUMNS_0011[table];
  if (!watched9 && !watched11) return { hide: [], require: [], updateNeeded: false, kind: null, text: {} };
  const [available9, available11] = await Promise.all([watched9 ? hasPipelineUpdate(sb) : Promise.resolve(true), watched11 ? hasConsultingUpdate(sb) : Promise.resolve(true)]);
  const hide = [...(available9 ? [] : watched9 ?? []), ...(available11 ? [] : watched11 ?? [])];
  const require: string[] = [];
  let kind: string | null = null;
  let text: Record<string, FieldText> = {};
  if (table === "pipeline_items" && row.pipeline_id) {
    const { data } = await sb.from("pipelines").select("kind").eq("id", row.pipeline_id).maybeSingle();
    kind = (data as Row | null)?.kind ?? null;
    hide.push(...hiddenForKind(kind));
    if (kind === "acquisition" && available9) require.push("deal_source_type");
    text = fieldTextForKind(kind);
  }
  return { hide: [...new Set(hide)], require, updateNeeded: !available9 ? "0009" : !available11 ? "0011" : false, kind, text };
}

/** The stage's default next action (title and due date), or null. Null before update 0009. */
export async function stageDefaultNextAction(sb: SupabaseClient, stageId: string | null | undefined, today: string): Promise<{ title: string; due: string } | null> {
  if (!stageId) return null;
  const { data, error } = await sb
    .from("stage_tasks")
    .select("title,due_in_days")
    .eq("pipeline_stage_id", stageId)
    .eq("is_next_action_default", true)
    .order("sort_order")
    .limit(1);
  if (error || !data?.length) return null;
  const t = data[0] as Row;
  return { title: t.title, due: addDaysISO(today, Number(t.due_in_days) || 0) };
}

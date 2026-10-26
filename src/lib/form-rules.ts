import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/calc/dates";
import { hasPipelineUpdate } from "@/lib/pipeline";
import { ACQUISITION_ONLY_FIELDS } from "@/lib/resources";
import { COLUMNS_0009 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Which fields a record form shows and requires, based on the record (pipeline kind) and on whether
 * database update 0009 is applied. Used by the new-record page and the record page.
 */
export async function formRules(sb: SupabaseClient, table: string, row: Row): Promise<{ hide: string[]; require: string[]; updateNeeded: boolean; kind: string | null }> {
  const watched = COLUMNS_0009[table];
  if (!watched) return { hide: [], require: [], updateNeeded: false, kind: null };
  const available = await hasPipelineUpdate(sb);
  const hide = available ? [] : [...watched];
  const require: string[] = [];
  let kind: string | null = null;
  if (table === "pipeline_items" && row.pipeline_id) {
    const { data } = await sb.from("pipelines").select("kind").eq("id", row.pipeline_id).maybeSingle();
    kind = (data as Row | null)?.kind ?? null;
    if (kind !== "acquisition") hide.push(...ACQUISITION_ONLY_FIELDS);
    else if (available) require.push("deal_source_type");
  }
  return { hide: [...new Set(hide)], require, updateNeeded: !available, kind };
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

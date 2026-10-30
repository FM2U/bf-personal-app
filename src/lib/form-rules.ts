import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/calc/dates";
import { hasPipelineUpdate } from "@/lib/pipeline";
import { hasConsultingUpdate } from "@/lib/consulting";
import { fieldTextForKind, hiddenForKind, type FieldText } from "@/lib/pipeline-labels";
import { COLUMNS_0009, COLUMNS_0011, COLUMNS_0014, COLUMNS_0018, OPTIONS_0012, PROBE_0012 } from "@/lib/schema-guard";
import { hasUpdate0014 } from "@/lib/update-0014";
import { hasUpdate0018 } from "@/lib/update-0018";
import type { Row } from "@/lib/types";

/**
 * Which fields a record form shows and requires, and the labels that depend on the record (pipeline kind),
 * based on whether database updates 0009 and 0011 are applied. Used by the new-record page and the record page.
 * `updateNeeded` names the update that is missing: "0009" (supabase/UPDATE_RUN_ONCE.sql), "0011" or "0012"
 * (supabase/UPDATE_0011_0012_RUN_ONCE.sql), or false.
 */
export async function formRules(
  sb: SupabaseClient,
  table: string,
  row: Row,
): Promise<{ hide: string[]; require: string[]; updateNeeded: false | "0009" | "0011" | "0012"; kind: string | null; text: Record<string, FieldText> }> {
  const watched9 = COLUMNS_0009[table];
  const watched11 = COLUMNS_0011[table];
  const watched14 = COLUMNS_0014[table];
  const watched18 = COLUMNS_0018[table];
  // Columns from update 0018 (partner report frequency) are left out until it is applied.
  if (watched18 && !watched9 && !watched11 && !watched14) {
    return { hide: (await hasUpdate0018(sb)) ? [] : watched18, require: [], updateNeeded: false, kind: null, text: {} };
  }
  // Columns from update 0014 (parent initiative, goal measured number details) are left out until it is applied.
  if (watched14 && !watched9 && !watched11) {
    return { hide: (await hasUpdate0014(sb)) ? [] : watched14, require: [], updateNeeded: false, kind: null, text: {} };
  }
  if (!watched9 && !watched11) return { hide: [], require: [], updateNeeded: false, kind: null, text: {} };
  const missing12 = OPTIONS_0012[table] ? !(await hasContactOptionsUpdate(sb)) : false;
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
  return { hide: [...new Set(hide)], require, updateNeeded: !available9 ? "0009" : !available11 ? "0011" : missing12 ? "0012" : false, kind, text };
}

/**
 * True when database update 0012 is applied (its check function answers). Any error counts as not applied:
 * the only effect is that Friend and Other stay out of the forms, which always saves safely.
 */
export async function hasContactOptionsUpdate(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0012);
  return !error && data === true;
}

/**
 * Option values to leave out of every form on the page until the update that allows them is applied,
 * keyed "table.field" (example: "contacts.relationship_group": Friend and Other before update 0012).
 */
export async function optionExclusions(sb: SupabaseClient): Promise<Record<string, string[]>> {
  if (await hasContactOptionsUpdate(sb)) return {};
  const out: Record<string, string[]> = {};
  for (const [table, fields] of Object.entries(OPTIONS_0012)) for (const [field, values] of Object.entries(fields)) out[`${table}.${field}`] = values;
  return out;
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

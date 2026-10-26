"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { DB_UPDATE_NOTICE, isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

const itemHref = (id: string, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `/records/pipeline_items/${id}${qs ? `?${qs}` : ""}`;
};

/**
 * Quick log on an acquisition item: "CIM requested" or "Contacted the broker or referral source".
 * Saves one communication with the item and its purpose (counted by the Deals advanced target).
 */
export async function logDealActivity(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const itemId = String(fd.get("item_id"));
  const purpose = String(fd.get("purpose")) === "cim_request" ? "cim_request" : "source_contact";
  const method = ["email", "call", "text", "meeting", "other"].includes(String(fd.get("method"))) ? String(fd.get("method")) : "email";
  const summary = String(fd.get("summary") ?? "").trim().slice(0, 2000) || null;
  const { data: item } = await supabase.from("pipeline_items").select("*").eq("id", itemId).maybeSingle();
  if (!item) return;
  const contactId = (item.source_contact_id as string | null) ?? (item.primary_contact_id as string | null) ?? null;
  const subject = purpose === "cim_request" ? `CIM requested: ${item.name}` : `Contacted the deal source: ${item.name}`;
  const { data: created, error } = await supabase
    .from("communications")
    .insert({
      owner_id: ownerId,
      occurred_at: new Date().toISOString(),
      method,
      direction: "outgoing",
      contact_id: contactId,
      organization_id: item.organization_id ?? null,
      subject,
      summary,
      purpose,
      pipeline_item_id: item.id,
    })
    .select("id")
    .single();
  if (error) redirect(itemHref(itemId, { notice: isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}` }));
  if (created) {
    await supabase.from("record_links").insert({ owner_id: ownerId, from_type: "communications", from_id: created.id, to_type: "pipeline_items", to_id: item.id, relation: "concerns" });
  }
  await evaluateConditions(await loadCtx(supabase, ownerId));
  revalidatePath("/", "layout");
  redirect(itemHref(itemId, { notice: purpose === "cim_request" ? "CIM request logged." : "Contact with the deal source logged." }));
}

// ---------- Settings: stage task lists ----------

const back = (fd: FormData, notice?: string) => {
  const path = String(fd.get("back") ?? "/settings/initiatives");
  revalidatePath("/", "layout");
  redirect(notice ? `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}` : path);
};

/** Moves a stage task up or down in its stage's list (swaps order with the neighbor). */
export async function moveStageTask(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("id"));
  const dir = String(fd.get("dir")) === "up" ? -1 : 1;
  const { data: task } = await supabase.from("stage_tasks").select("*").eq("id", id).maybeSingle();
  if (!task) back(fd);
  const { data: list } = await supabase.from("stage_tasks").select("id,sort_order,title").eq("pipeline_stage_id", task!.pipeline_stage_id).order("sort_order").order("title");
  const rows = (list ?? []) as Row[];
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) back(fd);
  // Renumber 1..n with the two rows swapped, so equal numbers never block a move.
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (const [k, r] of rows.entries()) if (Number(r.sort_order) !== k + 1) await supabase.from("stage_tasks").update({ sort_order: k + 1 }).eq("id", r.id);
  back(fd);
}

export async function deleteStageTask(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("stage_tasks").delete().eq("id", String(fd.get("id")));
  back(fd, "Stage task deleted.");
}

/** Saves a stage's time limit (days). Empty = no limit. */
export async function saveStageLimit(fd: FormData) {
  const { supabase } = await requireOwner();
  const raw = String(fd.get("max_days_in_stage") ?? "").trim();
  const n = raw === "" ? null : Math.round(Number(raw));
  if (n !== null && (!Number.isFinite(n) || n < 1 || n > 365)) back(fd, "Not saved: the time limit must be 1 to 365 days, or empty for no limit.");
  const { error } = await supabase.from("pipeline_stages").update({ max_days_in_stage: n }).eq("id", String(fd.get("id")));
  if (error) back(fd, isMissingSchemaError(error) ? DB_UPDATE_NOTICE : `Not saved: ${error.message}`);
  back(fd, "Time limit saved.");
}

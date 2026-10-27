"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { AIInvalidReply, AIUnavailable } from "@/lib/ai/claude";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { approveInitiativeDraft, createInitiativeDraft, UpdateNeeded } from "@/lib/initiative/server";
import { describeCounts, IncludeSchema, validateForApproval } from "@/lib/initiative/proposal";
import { ideaToReductionAction } from "@/lib/savings/ideas";
import { money } from "@/lib/format";
import type { Row } from "@/lib/types";

function back(path: string, notice: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}notice=${encodeURIComponent(notice)}`);
}

function safeBack(fd: FormData, fallback: string): string {
  const b = String(fd.get("back") ?? "");
  return b.startsWith("/") && !b.startsWith("//") ? b : fallback;
}

/** Plain message for an AI failure (cap reached, not set up, unusable reply, database update needed). */
function aiMessage(e: unknown): string {
  if (e instanceof AIUnavailable || e instanceof AIInvalidReply || e instanceof UpdateNeeded) return e.message;
  return `The AI request failed: ${e instanceof Error ? e.message : String(e)}`;
}

/** "Start an initiative": the AI drafts the plan from a few sentences; the review screen opens. Nothing is saved but the draft. */
export async function startInitiative(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const description = String(fd.get("description") ?? "").trim();
  const from = safeBack(fd, "/plan/start");
  if (description.length < 8) back(from, "Describe the initiative in a sentence or more first.");
  let id: string;
  try {
    id = await createInitiativeDraft(supabase, ownerId, description, "typed");
  } catch (e) {
    back(from, aiMessage(e));
  }
  revalidatePath("/plan");
  redirect(`/plan/initiatives/drafts/${id}`);
}

/** Saves the review screen's edits (without approving), so a reload keeps them. */
export async function saveDraftEdits(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await requireOwner();
  const id = String(fd.get("draft_id") ?? "");
  const parsed = parseState(String(fd.get("state") ?? ""));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { error } = await supabase.from("initiative_drafts").update({ proposal: parsed.state }).eq("id", id).eq("status", "draft");
  return error ? { ok: false, error: error.message } : { ok: true };
}

function parseState(raw: string): { ok: true; state: { proposal: never; include: never } } | { ok: false; error: string } {
  let v: Row;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The review screen sent no readable data. Reload the page and try again." };
  }
  const p = validateForApproval(v.proposal);
  if (!p.ok) return { ok: false, error: `Some fields need a fix: ${p.error}` };
  const inc = IncludeSchema.safeParse(v.include);
  if (!inc.success) return { ok: false, error: "The include choices could not be read. Reload the page and try again." };
  return { ok: true, state: { proposal: p.proposal as never, include: inc.data as never } };
}

/** "Approve selected": creates every selected record, linked together and to the new initiative, in one transaction. */
export async function approveDraft(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("draft_id") ?? "");
  const parsed = parseState(String(fd.get("state") ?? ""));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  let mapped;
  try {
    mapped = await approveInitiativeDraft(supabase, ownerId, id, parsed.state);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await evaluateConditions(await loadCtx(supabase, ownerId)).catch(() => null);
  revalidatePath("/", "layout");
  const savings = mapped.estimatedMonthlySavings ? ` Estimated savings: ${money(mapped.estimatedMonthlySavings)} per month.` : "";
  const warn = mapped.warnings.length ? ` Note: ${mapped.warnings.join(" ")}` : "";
  back(`/records/initiatives/${mapped.initiativeId}`, `Approved and saved: ${mapped.initiativeName} with ${describeCounts(mapped.counts)}.${savings}${warn}`);
}

/** Savings idea drafts: approve as a reduction action on the expense instead of an initiative. */
export async function approveDraftAsReduction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("draft_id") ?? "");
  const { data: draft } = await supabase.from("initiative_drafts").select("*").eq("id", id).maybeSingle();
  if (!draft || draft.status !== "draft" || !draft.savings_idea_id) return { ok: false, error: "This draft is not an open savings idea." };
  const { data: idea } = await supabase.from("savings_ideas").select("*").eq("id", draft.savings_idea_id).maybeSingle();
  if (!idea) return { ok: false, error: "The savings idea was not found." };
  const ctx = await loadCtx(supabase, ownerId);
  const savingsRaw = String(fd.get("projected_monthly_savings") ?? "").trim();
  const row = ideaToReductionAction(
    { title: idea.title, steps: (idea.steps ?? []) as string[], estimated_monthly_savings: Number(idea.estimated_monthly_savings), estimate_basis: idea.estimate_basis ?? "", recurring_series_id: idea.recurring_series_id, category_id: idea.category_id },
    { title: String(fd.get("title") ?? ""), deadline: String(fd.get("deadline") ?? ""), projected_monthly_savings: savingsRaw === "" ? undefined : Number(savingsRaw), steps: String(fd.get("steps") ?? "") },
    ctx.today,
  );
  const actionId = randomUUID();
  const links = idea.recurring_series_id ? [{ id: randomUUID(), from_type: "recurring_series", from_id: idea.recurring_series_id, to_type: "reduction_actions", to_id: actionId, relation: "savings idea" }] : [];
  const { error } = await supabase.rpc("insert_record_batch", {
    p_batches: [{ table: "reduction_actions", rows: [{ id: actionId, ...row }] }, ...(links.length ? [{ table: "record_links", rows: links }] : [])],
    p_actor: "ai",
    p_sample_batch: null,
  });
  if (error) return { ok: false, error: `Nothing was saved: ${error.message}` };
  const now = new Date().toISOString();
  await supabase.from("savings_ideas").update({ status: "approved", decided_at: now, result_table: "reduction_actions", result_id: actionId }).eq("id", idea.id);
  await supabase.from("initiative_drafts").update({ status: "approved", decided_at: now, result_summary: { reduction_action_id: actionId } }).eq("id", id);
  revalidatePath("/", "layout");
  back(`/records/reduction_actions/${actionId}`, `Approved and saved as a reduction action: about ${money(Number(row.projected_monthly_savings))} per month.`);
}

export async function discardDraft(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("draft_id") ?? "");
  await supabase.from("initiative_drafts").update({ status: "discarded", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
  revalidatePath("/plan");
  back("/plan/start", "Draft discarded. Nothing was saved.");
}

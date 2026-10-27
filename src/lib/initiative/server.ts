import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callForJson, cleanDeep } from "@/lib/ai/claude";
import { addMonthsISO, monthBounds } from "@/lib/calc/dates";
import { fetchAll } from "@/lib/data";
import { loadCtx } from "@/lib/engine/helpers";
import { hasUpdate0014 } from "@/lib/update-0014";
import { DB_UPDATE_NOTICE_0014 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";
import {
  includeAll,
  IncludeSchema,
  mapProposalToBatches,
  proposalPrompt,
  validateProposal,
  type Include,
  type MappedPlan,
  type Proposal,
  type Setup,
} from "@/lib/initiative/proposal";

export class UpdateNeeded extends Error {
  constructor() {
    super(DB_UPDATE_NOTICE_0014);
  }
}

/** Average monthly spending per category over the last 3 full months. */
export async function categorySpendAverages(sb: SupabaseClient, ownerId: string, today: string): Promise<Record<string, number>> {
  const thisMonth = monthBounds(today).start;
  const start = addMonthsISO(thisMonth, -3);
  const txns = await fetchAll((from, to) =>
    sb.from("transactions").select("amount,category_id,is_transfer,date").eq("owner_id", ownerId).lt("amount", 0).gte("date", start).lt("date", thisMonth).range(from, to),
  );
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (t.is_transfer || !t.category_id) continue;
    out[t.category_id] = (out[t.category_id] ?? 0) - Number(t.amount);
  }
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] / 3) * 100) / 100;
  return out;
}

/** Everything the mapping needs from the database (initiatives, categories, budget, spending, target names). */
export async function loadPlanSetup(sb: SupabaseClient, ownerId: string, today: string): Promise<Setup> {
  const [{ data: inits }, { data: cats }, { data: budgets }, { data: lines }, { data: targets }, spend] = await Promise.all([
    sb.from("initiatives").select("id,name").eq("owner_id", ownerId),
    sb.from("categories").select("id,name,kind").eq("owner_id", ownerId),
    sb.from("budgets").select("id").eq("owner_id", ownerId).eq("is_active", true).order("created_at").limit(1),
    sb.from("budget_lines").select("id,budget_id,category_id,current_monthly,target_monthly").eq("owner_id", ownerId),
    sb.from("targets").select("name").eq("owner_id", ownerId),
    categorySpendAverages(sb, ownerId, today),
  ]);
  const budgetId = ((budgets ?? []) as Row[])[0]?.id ?? null;
  return {
    today,
    initiatives: ((inits ?? []) as Row[]).map((i) => ({ id: i.id, name: i.name })),
    categories: ((cats ?? []) as Row[]).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    budgetId,
    budgetLines: ((lines ?? []) as Row[])
      .filter((l) => l.budget_id === budgetId)
      .map((l) => ({ id: l.id, category_id: l.category_id, current_monthly: Number(l.current_monthly), target_monthly: Number(l.target_monthly) })),
    categorySpend: spend,
    existingTargetNames: ((targets ?? []) as Row[]).map((t) => t.name),
  };
}

export type DraftState = { proposal: Proposal; include: Include };

/** Asks the AI for a structured initiative proposal and saves it as a draft (nothing else is saved). Returns the draft id. */
export async function createInitiativeDraft(sb: SupabaseClient, ownerId: string, description: string, source: "typed" | "chat"): Promise<string> {
  if (!(await hasUpdate0014(sb))) throw new UpdateNeeded();
  const ctx = await loadCtx(sb, ownerId);
  const setup = await loadPlanSetup(sb, ownerId, ctx.today);
  const prompt = proposalPrompt({
    description,
    today: ctx.today,
    initiatives: setup.initiatives.map((i) => i.name),
    categories: setup.categories.filter((c) => c.kind === "expense").map((c) => ({ name: c.name, monthly: setup.categorySpend[c.id] ?? null })),
    weeklyReviewDay: Number(ctx.profile.weekly_review_weekday ?? 0),
  });
  const proposal = await callForJson<Proposal>({
    sb,
    ownerId,
    purpose: "initiative_proposal",
    prompt,
    maxTokens: 6000,
    validate: (v) => {
      const r = validateProposal(cleanDeep(v));
      return r.ok ? { ok: true, value: r.proposal } : r;
    },
  });
  const state: DraftState = { proposal, include: includeAll(proposal) };
  const { data, error } = await sb.from("initiative_drafts").insert({ owner_id: ownerId, prompt: description.slice(0, 4000), proposal: state, source, status: "draft" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "The draft could not be saved.");
  return data.id as string;
}

/** Reads and checks a draft's saved state (proposal and which items are included). */
export function readDraftState(value: unknown): DraftState | null {
  const v = (value ?? {}) as Row;
  const p = validateProposal(v.proposal);
  if (!p.ok) return null;
  const inc = IncludeSchema.safeParse(v.include);
  return { proposal: p.proposal, include: inc.success ? inc.data : includeAll(p.proposal) };
}

/**
 * Saves the approved items: every record in one transaction (public.insert_record_batch), linked to the new
 * initiative, with the change log showing "AI (approved)". Marks the draft approved (and its savings idea).
 */
export async function approveInitiativeDraft(sb: SupabaseClient, ownerId: string, draftId: string, state: DraftState): Promise<MappedPlan> {
  const { data: draft } = await sb.from("initiative_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!draft) throw new Error("The draft was not found.");
  if (draft.status !== "draft") throw new Error("This draft was already approved or discarded.");
  const ctx = await loadCtx(sb, ownerId);
  const setup = await loadPlanSetup(sb, ownerId, ctx.today);
  const mapped = mapProposalToBatches(state.proposal, state.include, setup, () => randomUUID());
  const { error } = await sb.rpc("insert_record_batch", { p_batches: mapped.batches, p_actor: "ai", p_sample_batch: null });
  if (error) throw new Error(`Nothing was saved: ${error.message}`);
  const now = new Date().toISOString();
  await sb
    .from("initiative_drafts")
    .update({ status: "approved", decided_at: now, result_initiative_id: mapped.initiativeId, proposal: state, result_summary: { counts: mapped.counts, warnings: mapped.warnings, estimated_monthly_savings: mapped.estimatedMonthlySavings } })
    .eq("id", draftId);
  if (draft.savings_idea_id) {
    await sb.from("savings_ideas").update({ status: "approved", decided_at: now, result_table: "initiatives", result_id: mapped.initiativeId }).eq("id", draft.savings_idea_id);
  }
  return mapped;
}

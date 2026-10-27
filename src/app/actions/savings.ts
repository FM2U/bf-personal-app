"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { AIInvalidReply, AIUnavailable } from "@/lib/ai/claude";
import { loadCtx } from "@/lib/engine/helpers";
import { proposeSavingsIdeas } from "@/lib/engine/savings-ideas";
import { includeAll } from "@/lib/initiative/proposal";
import { ideaToProposal } from "@/lib/savings/ideas";


function back(fd: FormData, notice: string): never {
  const b = String(fd.get("back") ?? "");
  const path = b.startsWith("/") && !b.startsWith("//") ? b : "/finance/expenses";
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}notice=${encodeURIComponent(notice)}${hash ? `#${hash}` : "#savings-ideas"}`);
}

/** "Propose savings ideas now" (Finance, Expenses). Respects the AI monthly cap. */
export async function proposeSavingsNow(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  let message: string;
  try {
    message = (await proposeSavingsIdeas(ctx, "manual")).message;
  } catch (e) {
    message = e instanceof AIUnavailable || e instanceof AIInvalidReply ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath("/", "layout");
  back(fd, message);
}

/** Approve: opens the review screen (the same one as Start an initiative), prefilled from the idea. */
export async function approveSavingsIdea(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const { data: idea } = await supabase.from("savings_ideas").select("*").eq("id", id).maybeSingle();
  if (!idea || !["pending", "later"].includes(idea.status)) back(fd, "This idea was already decided.");
  const { data: open } = await supabase.from("initiative_drafts").select("id").eq("savings_idea_id", id).eq("status", "draft").limit(1);
  if (open?.length) redirect(`/plan/initiatives/drafts/${open[0].id}`);
  const ctx = await loadCtx(supabase, ownerId);
  let categoryName: string | null = null;
  if (idea.category_id) categoryName = (await supabase.from("categories").select("name").eq("id", idea.category_id).maybeSingle()).data?.name ?? null;
  const proposal = ideaToProposal(
    {
      title: idea.title,
      target_label: idea.target_label,
      target_type: idea.target_type,
      category_name: categoryName,
      current_monthly_cost: Number(idea.current_monthly_cost ?? 0),
      estimated_monthly_savings: Number(idea.estimated_monthly_savings ?? 0),
      estimate_basis: idea.estimate_basis ?? "",
      steps: (idea.steps ?? []) as string[],
    },
    ctx.today,
  );
  const { data, error } = await supabase
    .from("initiative_drafts")
    .insert({ owner_id: ownerId, prompt: `Savings idea: ${idea.title}`, proposal: { proposal, include: includeAll(proposal) }, source: "savings_idea", savings_idea_id: id, status: "draft" })
    .select("id")
    .single();
  if (error || !data) back(fd, `The review screen could not be opened: ${error?.message ?? "unknown error"}`);
  redirect(`/plan/initiatives/drafts/${data.id}`);
}

/** Edit: title, estimated monthly savings, effort, and steps. */
export async function editSavingsIdea(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const title = String(fd.get("title") ?? "").trim();
  const savings = Number(String(fd.get("estimated_monthly_savings") ?? "").replace(/[$,]/g, ""));
  const effort = String(fd.get("effort") ?? "medium");
  const steps = String(fd.get("steps") ?? "")
    .split("\n")
    .map((s) => s.replace(/^\s*(\d+[.)]|-)\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!title) back(fd, "The idea needs a title.");
  if (!Number.isFinite(savings) || savings < 0) back(fd, "Estimated monthly savings must be a number.");
  const update: Record<string, unknown> = { title: title.slice(0, 200), estimated_monthly_savings: Math.round(savings * 100) / 100, effort: ["low", "medium", "high"].includes(effort) ? effort : "medium", steps };
  const { data: before } = await supabase.from("savings_ideas").select("estimated_monthly_savings,estimate_basis").eq("id", id).maybeSingle();
  if (before && Number(before.estimated_monthly_savings) !== update.estimated_monthly_savings) {
    update.estimate_basis = `Changed by you to $${Math.round(Number(update.estimated_monthly_savings))} per month. AI estimate: ${before.estimate_basis ?? ""}`.slice(0, 500);
  }
  const { error } = await supabase.from("savings_ideas").update(update).eq("id", id).in("status", ["pending", "later"]);
  revalidatePath("/", "layout");
  back(fd, error ? `Not saved: ${error.message}` : "Savings idea saved.");
}

/** Decline (optional one-line reason). The same expense is not proposed again for 90 days. */
export async function declineSavingsIdea(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 200) || null;
  await supabase.from("savings_ideas").update({ status: "declined", decline_reason: reason, decided_at: new Date().toISOString() }).eq("id", id).in("status", ["pending", "later"]);
  revalidatePath("/", "layout");
  back(fd, "Declined. Ideas for this expense are not proposed again for 90 days.");
}

/** Later: kept in "Saved for later" (not counted on Home); no new idea is proposed for the same expense meanwhile. */
export async function laterSavingsIdea(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const to = String(fd.get("to") ?? "later") === "pending" ? "pending" : "later";
  await supabase.from("savings_ideas").update({ status: to }).eq("id", id).in("status", ["pending", "later"]);
  revalidatePath("/", "layout");
  back(fd, to === "later" ? "Saved for later." : "Moved back to the ideas waiting for a decision.");
}


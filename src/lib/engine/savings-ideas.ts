import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiBudget, AIUnavailable, callForJson, cleanDeep } from "@/lib/ai/claude";
import { addDaysISO } from "@/lib/calc/dates";
import { fetchAll } from "@/lib/data";
import { hasUpdate0014 } from "@/lib/update-0014";
import { analyzeSpending, ANALYSIS_DAYS, buildIdeas, IdeaReplySchema, ideasPrompt, suppressedTargets, type IdeaReply } from "@/lib/savings/ideas";
import type { Row } from "@/lib/types";
import type { Ctx } from "./helpers";

export type ProposeResult = { created: number; skipped?: string; message: string };

export const CAP_MESSAGE = "The AI monthly cap is reached, so no savings ideas were proposed. AI requests resume next month, or raise the cap in Settings.";

/**
 * Up to 3 AI savings ideas from the last 90 days of spending. Runs each week on the weekly review day (morning job)
 * and from "Propose savings ideas now" (Finance, Expenses). Skips when the monthly AI cap is reached. Saves ideas
 * only; nothing changes until the owner approves an idea.
 */
export async function proposeSavingsIdeas(ctx: Pick<Ctx, "sb" | "ownerId" | "today">, source: "weekly" | "manual"): Promise<ProposeResult> {
  const { sb, ownerId, today } = ctx;
  if (!(await hasUpdate0014(sb))) return { created: 0, skipped: "update", message: "Database update 0014 is not applied yet." };
  if (source === "weekly") {
    const { count } = await sb.from("savings_ideas").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("source", "weekly").gte("batch_date", addDaysISO(today, -6));
    if (count) return { created: 0, skipped: "done", message: "This week's savings ideas were already proposed." };
  }
  const budget = await aiBudget(sb, ownerId);
  if (budget.blocked) return { created: 0, skipped: "cap", message: CAP_MESSAGE };

  const [txns, { data: cats }, { data: series }, { data: history }] = await Promise.all([
    fetchAll((from, to) =>
      sb
        .from("transactions")
        .select("id,date,amount,category_id,merchant_name,description,recurring_series_id,is_transfer")
        .eq("owner_id", ownerId)
        .lt("amount", 0)
        .gte("date", addDaysISO(today, -ANALYSIS_DAYS))
        .range(from, to),
    ),
    sb.from("categories").select("id,name,kind,is_software").eq("owner_id", ownerId),
    sb.from("recurring_series").select("id,merchant_name,frequency,monthly_cost,category_id,review_flag,review_status,status").eq("owner_id", ownerId),
    sb.from("savings_ideas").select("target_key,status,decided_at,created_at").eq("owner_id", ownerId),
  ]);
  const analysis = analyzeSpending({
    txns: txns.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
    categories: (cats ?? []) as never,
    series: ((series ?? []) as Row[]).map((s) => ({ ...s, monthly_cost: Number(s.monthly_cost ?? 0) })) as never,
    today,
  });
  const suppressed = suppressedTargets((history ?? []) as never, today);
  const open = analysis.candidates.filter((c) => !suppressed.has(c.key) && c.monthly > 0);
  if (!open.length) return { created: 0, skipped: "no_data", message: "No spending in the last 90 days to propose savings ideas for (or every expense already has an open or recently declined idea)." };

  let reply: IdeaReply;
  try {
    reply = await callForJson<IdeaReply>({
      sb,
      ownerId,
      purpose: "savings_ideas",
      prompt: ideasPrompt(analysis, suppressed),
      maxTokens: 1500,
      validate: (v) => {
        const r = IdeaReplySchema.safeParse(cleanDeep(v));
        return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      },
    });
  } catch (e) {
    if (e instanceof AIUnavailable && e.reason === "cap_reached") return { created: 0, skipped: "cap", message: CAP_MESSAGE };
    throw e;
  }
  const ideas = buildIdeas(reply, analysis.candidates, suppressed);
  if (!ideas.length) return { created: 0, skipped: "none", message: "The AI found no new savings ideas this time." };
  const { error } = await sb.from("savings_ideas").insert(ideas.map((i) => ({ ...i, owner_id: ownerId, source, batch_date: today, status: "pending" })));
  if (error) throw new Error(error.message);
  return { created: ideas.length, message: `${ideas.length} savings ${ideas.length === 1 ? "idea is" : "ideas are"} ready. Approve, edit, decline, or keep for later.` };
}

/** Open ideas (pending first, then Later), newest first. Empty before update 0014. */
export async function loadSavingsIdeas(sb: SupabaseClient): Promise<{ available: boolean; pending: Row[]; later: Row[] }> {
  const { data, error } = await sb.from("savings_ideas").select("*").in("status", ["pending", "later"]).order("estimated_monthly_savings", { ascending: false });
  if (error) return { available: false, pending: [], later: [] };
  const rows = (data ?? []) as Row[];
  return { available: true, pending: rows.filter((r) => r.status === "pending"), later: rows.filter((r) => r.status === "later") };
}

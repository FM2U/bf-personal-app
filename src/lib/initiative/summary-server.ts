import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { byDate, goalTargetText, planPreview, targetRuleText, type InitiativeSummary } from "@/lib/initiative/summary";
import { hasUpdate0014 } from "@/lib/update-0014";
import type { Row } from "@/lib/types";

/**
 * The summary of a saved initiative (initiative page, "View summary"): its goals, milestones, recurring tasks,
 * targets, budget targets, checklists, and plan document. Each line opens its record in the quick view.
 * Estimated monthly savings: the estimate saved when the initiative was approved from a draft, otherwise the
 * linked budget targets (budget now minus the target, when lower).
 */
export async function loadInitiativeSummary(sb: SupabaseClient, initiative: Row): Promise<InitiativeSummary> {
  const id = initiative.id as string;
  const has14 = await hasUpdate0014(sb);
  const rec = (table: string, rid: string) => ({ kind: "record" as const, table, id: rid });
  const [{ data: goals }, { data: templates }, { data: targets }, parentRes, docsRes, listsRes, linksRes, draftRes] = await Promise.all([
    sb.from("goals").select("id,title,metric_key,comparison,target_value,deadline,status").eq("initiative_id", id).order("deadline"),
    sb.from("task_templates").select("id,title,cadence,weekday,day_of_month,is_active").eq("initiative_id", id),
    sb.from("targets").select("id,name,period,minimum_count,active_weekdays,active").eq("initiative_id", id),
    initiative.parent_initiative_id ? sb.from("initiatives").select("name").eq("id", initiative.parent_initiative_id).maybeSingle() : Promise.resolve({ data: null }),
    has14 ? sb.from("plan_documents").select("id,title,body").eq("initiative_id", id).order("created_at").limit(1) : Promise.resolve({ data: [] }),
    has14 ? sb.from("checklists").select("id,name").eq("initiative_id", id).order("created_at") : Promise.resolve({ data: [] }),
    sb.from("record_links").select("to_id").eq("from_type", "initiatives").eq("from_id", id).eq("to_type", "budget_lines"),
    has14 ? sb.from("initiative_drafts").select("result_summary").eq("result_initiative_id", id).eq("status", "approved").order("decided_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const goalRows = (goals ?? []) as Row[];
  const goalIds = goalRows.map((g) => g.id);
  const { data: ms } = goalIds.length ? await sb.from("milestones").select("id,title,due_date,status").in("goal_id", goalIds) : { data: [] };
  const lists = (listsRes.data ?? []) as Row[];
  const { data: items } = lists.length ? await sb.from("checklist_items").select("checklist_id").in("checklist_id", lists.map((l) => l.id)) : { data: [] };
  const lineIds = ((linksRes.data ?? []) as Row[]).map((l) => l.to_id);
  const { data: lines } = lineIds.length ? await sb.from("budget_lines").select("id,category_id,current_monthly,target_monthly").in("id", lineIds) : { data: [] };
  const catIds = ((lines ?? []) as Row[]).map((l) => l.category_id);
  const { data: cats } = catIds.length ? await sb.from("categories").select("id,name").in("id", catIds) : { data: [] };
  const catName = Object.fromEntries(((cats ?? []) as Row[]).map((c) => [c.id, c.name]));
  const doc = ((docsRes.data ?? []) as Row[])[0];
  const budget = ((lines ?? []) as Row[]).map((l) => ({ category: catName[l.category_id] ?? "Budget", amount: Number(l.target_monthly ?? 0), current: l.current_monthly === null ? null : Number(l.current_monthly), ref: rec("budget_lines", l.id) }));
  const saved = ((draftRes.data ?? []) as Row[])[0]?.result_summary?.estimated_monthly_savings;
  const fromBudget = budget.reduce((s, b) => s + (b.current !== null && b.current > b.amount ? b.current - b.amount : 0), 0);
  const savings = typeof saved === "number" ? saved : fromBudget > 0 ? fromBudget : null;
  return {
    name: initiative.name,
    purpose: initiative.description ?? null,
    parent: (parentRes.data as Row | null)?.name ?? null,
    ref: { kind: "none" },
    purposeRef: { kind: "none" },
    savings,
    savingsBasis: savings === null ? null : typeof saved === "number" ? "Estimated when the plan was approved" : "Budget now minus the budget targets",
    goals: goalRows.map((g) => ({ title: g.title, target: goalTargetText(g.metric_key, g.comparison, g.target_value), deadline: g.deadline, ref: rec("goals", g.id) })),
    milestones: byDate(((ms ?? []) as Row[]).map((m) => ({ title: m.title, due: m.due_date, ref: rec("milestones", m.id) }))),
    recurring: ((templates ?? []) as Row[])
      .filter((t) => t.is_active !== false)
      .map((t) => ({ title: t.title, cadence: t.cadence, weekday: t.weekday === null || t.weekday === undefined ? null : Number(t.weekday), dayOfMonth: t.day_of_month ?? null, ref: rec("task_templates", t.id) })),
    targets: ((targets ?? []) as Row[]).filter((t) => t.active !== false).map((t) => ({ name: t.name, rule: targetRuleText(t.period, Number(t.minimum_count), t.active_weekdays), ref: rec("targets", t.id) })),
    budget,
    checklists: lists.map((l) => ({ name: l.name, count: ((items ?? []) as Row[]).filter((i) => i.checklist_id === l.id).length, ref: rec("checklists", l.id) })),
    plan: doc ? { title: doc.title, preview: planPreview(String(doc.body ?? "")), body: String(doc.body ?? ""), ref: { kind: "plan" } } : null,
  };
}

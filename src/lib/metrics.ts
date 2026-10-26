import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, addMonthsISO, daysBetween, monthBounds, weekBounds } from "@/lib/calc/dates";
import { budgetVariance } from "@/lib/calc/savings";
import { combineScores, completionScore } from "@/lib/calc/scores";
import { round2 } from "@/lib/calc/runway";
import { loadFinanceSnapshot, scoped, type FinanceSnapshot } from "@/lib/finance";
import { loadTargets, targetCommitmentTally, targetMetric, type TargetsData } from "@/lib/targets";
import type { Row } from "@/lib/types";

export type MetricContext = {
  values: Record<string, number | null>;
  snapshot: FinanceSnapshot;
  pipelineMetric: (key: string, params: Row) => number | null;
  /** Daily Targets data (available = false until database update 0008 is applied). */
  targets: TargetsData;
  targetMetric: (key: string, params: Row) => number | null;
};

/** Calculates every measured number used by decision conditions, goals, Home, and partner reports. */
export async function computeMetrics(sb: SupabaseClient, today: string, ownerId?: string): Promise<MetricContext> {
  const snapshot = await loadFinanceSnapshot(sb, today, ownerId);
  const s = <Q,>(q: Q): Q => scoped(q, ownerId);
  const lastMonth = monthBounds(addDaysISO(monthBounds(today).start, -1));
  const week = weekBounds(today);

  const tz = await ownerTimezone(sb, ownerId);
  const [targets, budgetsRes, linesRes, reductionsRes, commitmentsRes, missesRes, overdueRes, pipesRes, stagesRes, itemsRes] = await Promise.all([
    loadTargets(sb, { ownerId, tz, from: addDaysISO(today, -182), to: today }),
    s(sb.from("budgets").select("id").eq("is_active", true)),
    s(sb.from("budget_lines").select("*")),
    s(sb.from("reduction_actions").select("actual_monthly_savings,projected_monthly_savings,status")),
    s(sb.from("commitments").select("due_date,status")),
    s(sb.from("missed_commitments").select("id").gte("missed_on", addDaysISO(today, -30))),
    s(sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "todo").lt("due_date", today)),
    s(sb.from("pipelines").select("id,name")),
    s(sb.from("pipeline_stages").select("id,pipeline_id,name,position,outcome")),
    s(sb.from("pipeline_items").select("id,pipeline_id,stage_id,status")),
  ]);

  const activeBudgetIds = new Set(((budgetsRes.data ?? []) as Row[]).map((b) => b.id));
  const lines = ((linesRes.data ?? []) as Row[])
    .filter((l) => activeBudgetIds.has(l.budget_id))
    .map((l) => ({ category_id: l.category_id, current_monthly: Number(l.current_monthly), target_monthly: Number(l.target_monthly) }));
  const actualLastMonth: Record<string, number> = {};
  for (const t of snapshot.transactions) {
    if (t.is_transfer || Number(t.amount) >= 0 || !t.category_id) continue;
    if (t.date < lastMonth.start || t.date > lastMonth.end) continue;
    actualLastMonth[t.category_id] = (actualLastMonth[t.category_id] ?? 0) - Number(t.amount);
  }
  const variance = lines.length ? budgetVariance(lines, actualLastMonth).totals.variance : null;

  const savings = round2(
    ((reductionsRes.data ?? []) as Row[])
      .filter((r) => r.status === "completed")
      .reduce((sum, r) => sum + Number(r.actual_monthly_savings ?? r.projected_monthly_savings ?? 0), 0),
  );
  // Commitment score this week: commitments plus target periods marked as commitments (today stays open).
  const score = combineScores(
    completionScore((commitmentsRes.data ?? []) as { due_date: string; status: "open" }[], week.start, week.end),
    targetCommitmentTally(targets, week.start, week.end, addDaysISO(today, -1)),
  );

  let daysUntilDecision: number | null = null;
  const start = snapshot.inputs.text.acquisition_search_start_date;
  const allowed = snapshot.inputs.num.acquisition_search_months_allowed;
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start) && allowed !== null && allowed !== undefined) {
    daysUntilDecision = daysBetween(today, addMonthsISO(start, Math.round(allowed)));
  }

  const values: Record<string, number | null> = {
    runway_months: snapshot.runway.months,
    cash_available: snapshot.cash,
    avg_monthly_spending: snapshot.averages.avgSpending,
    avg_monthly_income: snapshot.averages.avgIncome,
    month_spending: snapshot.monthSpending,
    last_month_spending: snapshot.lastMonthSpending,
    budget_variance_last_month: variance,
    net_worth: snapshot.netWorth.netWorth,
    total_debt: round2(snapshot.debts.reduce((sum, d) => sum + d.effective_balance, 0)),
    emergency_fund_pct: snapshot.emergencyFund.pct,
    retirement_progress_pct: snapshot.retirement.pct,
    savings_achieved_monthly: savings,
    commitment_score_week: score.pct,
    missed_commitments_30d: (missesRes.data ?? []).length,
    overdue_tasks: overdueRes.count ?? 0,
    days_until_acquisition_decision: daysUntilDecision,
  };
  // When the runway is not decreasing, condition checks such as "runway under 6 months" must be false.
  if (values.runway_months === null && snapshot.cash > 0) values.runway_months = 9999;

  const pipes = (pipesRes.data ?? []) as Row[];
  const stages = (stagesRes.data ?? []) as Row[];
  const items = (itemsRes.data ?? []) as Row[];
  const pipelineMetric = (key: string, params: Row): number | null => {
    const pipe = pipes.find((p) => p.name?.toLowerCase() === String(params.pipeline ?? "").toLowerCase() || p.id === params.pipeline);
    if (!pipe) return null;
    const pItems = items.filter((i) => i.pipeline_id === pipe.id);
    if (key === "pipeline_open_items") return pItems.filter((i) => i.status === "open").length;
    if (key === "pipeline_items_at_or_past_stage") {
      const stage = stages.find((st) => st.pipeline_id === pipe.id && st.name?.toLowerCase() === String(params.stage ?? "").toLowerCase());
      if (!stage) return null;
      const pos = Object.fromEntries(stages.map((st) => [st.id, st]));
      return pItems.filter((i) => {
        const st = pos[i.stage_id];
        return st && st.outcome !== "lost" && st.position >= stage.position;
      }).length;
    }
    return null;
  };

  return { values, snapshot, pipelineMetric, targets, targetMetric: (key: string, params: Row) => targetMetric(targets, today, key, params) };
}

async function ownerTimezone(sb: SupabaseClient, ownerId?: string): Promise<string> {
  const { data } = await scoped(sb.from("owner_profile").select("timezone"), ownerId).limit(1).maybeSingle();
  return (data as Row | null)?.timezone || "America/New_York";
}

/** Value of one metric for a rule or goal, including pipeline and target metrics with parameters. */
export function metricValue(ctx: MetricContext, key: string, params: Row | null | undefined): number | null {
  if (key.startsWith("pipeline_")) return ctx.pipelineMetric(key, params ?? {});
  if (key.startsWith("target_")) return ctx.targetMetric(key, params ?? {});
  return ctx.values[key] ?? null;
}

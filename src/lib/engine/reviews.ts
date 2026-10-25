import "server-only";
import { addDaysISO, monthBounds, quarterBounds, weekBounds } from "@/lib/calc/dates";
import { budgetVariance } from "@/lib/calc/savings";
import { completionScore, repeatedMisses } from "@/lib/calc/scores";
import { computeMetrics } from "@/lib/metrics";
import { netWorthByMonth } from "@/lib/finance";
import { tryDraft } from "@/lib/ai/claude";
import { money, months as fmtMonths } from "@/lib/format";
import { metricLabel } from "@/lib/metrics-list";
import type { Row } from "@/lib/types";
import type { Ctx } from "./helpers";

export type ReviewKind = "daily" | "weekly" | "monthly" | "quarterly";

/** Period a review covers when created on `today`. Daily = today. Others = the period that just ended. */
export function reviewPeriod(kind: ReviewKind, today: string): { start: string; end: string } {
  if (kind === "daily") return { start: today, end: today };
  if (kind === "weekly") return weekBounds(addDaysISO(today, -1));
  if (kind === "monthly") return monthBounds(addDaysISO(monthBounds(today).start, -1));
  return quarterBounds(addDaysISO(quarterBounds(today).start, -1));
}

/** Collects the numbers each review needs. Saved with the review so it does not change later. */
export async function reviewData(ctx: Ctx, kind: ReviewKind, start: string, end: string): Promise<Row> {
  const { sb, ownerId } = ctx;
  const metrics = await computeMetrics(sb, ctx.today, ownerId);
  const snap = metrics.snapshot;
  const base: Row = {
    runway_months: snap.runway.months,
    runway_target: snap.inputs.num.runway_target_months,
    cash: snap.cash,
    avg_spending: snap.averages.avgSpending,
    avg_income: snap.averages.avgIncome,
  };
  if (kind === "daily") {
    const [{ data: due }, { data: tomorrow }] = await Promise.all([
      sb.from("tasks").select("id,title,status,priority").eq("owner_id", ownerId).eq("due_date", start).order("priority"),
      sb.from("tasks").select("id,title,priority,due_date").eq("owner_id", ownerId).eq("status", "todo").lte("due_date", addDaysISO(start, 1)).order("priority").order("due_date").limit(10),
    ]);
    return { ...base, tasks: due ?? [], tomorrow_candidates: tomorrow ?? [] };
  }
  const [changes, misses, commitments, conditions, moves, stages, items, budgets, lines, cats] = await Promise.all([
    sb.from("change_log").select("table_name,action,actor").eq("owner_id", ownerId).gte("created_at", `${start}T00:00:00`).lte("created_at", `${end}T23:59:59`).limit(1000),
    sb.from("missed_commitments").select("id,commitment_id,missed_on,reason,resolution").eq("owner_id", ownerId).gte("missed_on", start).lte("missed_on", end),
    sb.from("commitments").select("id,title,due_date,status,miss_count").eq("owner_id", ownerId),
    sb.from("decision_conditions").select("id,name,metric_key,last_value,last_triggered_at,check_from,currently_met").eq("owner_id", ownerId),
    sb.from("stage_history").select("item_id,stage_id,entered_at").eq("owner_id", ownerId).gte("entered_at", `${start}T00:00:00`).lte("entered_at", `${end}T23:59:59`),
    sb.from("pipeline_stages").select("id,name"),
    sb.from("pipeline_items").select("id,name"),
    sb.from("budgets").select("id").eq("owner_id", ownerId).eq("is_active", true),
    sb.from("budget_lines").select("*").eq("owner_id", ownerId),
    sb.from("categories").select("id,name").eq("owner_id", ownerId),
  ]);
  const stageName = Object.fromEntries(((stages.data ?? []) as Row[]).map((s) => [s.id, s.name]));
  const itemName = Object.fromEntries(((items.data ?? []) as Row[]).map((s) => [s.id, s.name]));
  const catName = Object.fromEntries(((cats.data ?? []) as Row[]).map((s) => [s.id, s.name]));
  const changeCounts: Record<string, number> = {};
  for (const c of (changes.data ?? []) as Row[]) changeCounts[c.table_name] = (changeCounts[c.table_name] ?? 0) + 1;
  const allCommitments = (commitments.data ?? []) as Row[];
  const commitmentTitle = Object.fromEntries(allCommitments.map((c) => [c.id, c.title]));
  const missList = ((misses.data ?? []) as Row[]).map((m) => ({ ...m, title: commitmentTitle[m.commitment_id] ?? "Commitment" }));
  const repeated = Object.entries(repeatedMisses(((await sb.from("missed_commitments").select("commitment_id").eq("owner_id", ownerId)).data ?? []) as { commitment_id: string }[])).map(([id, n]) => ({
    title: commitmentTitle[id] ?? id,
    misses: n,
  }));
  const activeBudgets = new Set(((budgets.data ?? []) as Row[]).map((b) => b.id));
  const actual: Record<string, number> = {};
  for (const t of snap.transactions) {
    if (t.is_transfer || Number(t.amount) >= 0 || !t.category_id || t.date < start || t.date > end) continue;
    actual[t.category_id] = (actual[t.category_id] ?? 0) - Number(t.amount);
  }
  const periodMonths = kind === "weekly" ? 7 / 30.4 : kind === "monthly" ? 1 : 3;
  const bv = budgetVariance(
    ((lines.data ?? []) as Row[])
      .filter((l) => activeBudgets.has(l.budget_id))
      .map((l) => ({ category_id: l.category_id, current_monthly: Number(l.current_monthly) * periodMonths, target_monthly: Number(l.target_monthly) * periodMonths })),
    actual,
  );
  const data: Row = {
    ...base,
    changes: changeCounts,
    missed_commitments: missList,
    repeated_misses: repeated,
    score: completionScore(allCommitments as { due_date: string; status: "open" }[], start, end),
    conditions_met: ((conditions.data ?? []) as Row[])
      .filter((c) => c.last_triggered_at && c.last_triggered_at.slice(0, 10) >= start && c.last_triggered_at.slice(0, 10) <= end)
      .map((c) => ({ name: c.name, value: c.last_value, metric: metricLabel(c.metric_key) })),
    pipeline_moves: ((moves.data ?? []) as Row[]).map((m) => ({ item: itemName[m.item_id] ?? "Item", stage: stageName[m.stage_id] ?? "Stage", date: m.entered_at.slice(0, 10) })),
    budget: { totals: bv.totals, over: bv.rows.filter((r) => r.overBudget).map((r) => ({ category: catName[r.category_id] ?? "Category", actual: r.actual, budget: r.current })) },
    savings_achieved_monthly: metrics.values.savings_achieved_monthly,
  };
  if (kind === "weekly") {
    const [{ data: next }, { data: drafts }] = await Promise.all([
      sb.from("tasks").select("title,due_date,priority").eq("owner_id", ownerId).eq("status", "todo").gt("due_date", end).lte("due_date", addDaysISO(end, 7)).order("priority").limit(15),
      sb.from("partner_reports").select("id,partner_id,period_end").eq("owner_id", ownerId).eq("status", "draft"),
    ]);
    data.next_week_tasks = next ?? [];
    data.partner_report_drafts = (drafts ?? []).length;
  }
  if (kind === "monthly" || kind === "quarterly") {
    const nw = await netWorthByMonth(sb, ctx.today, 4, ownerId);
    const [{ data: payments }, { data: ms }, { data: google }, { data: plaid }, { data: exportTasks }] = await Promise.all([
      sb.from("debt_payments").select("debt_id,amount,paid_on").eq("owner_id", ownerId).gte("paid_on", start).lte("paid_on", end),
      sb.from("milestones").select("title,status,due_date,met_on").eq("owner_id", ownerId).order("due_date"),
      sb.from("google_connections").select("status,last_checked_at,last_error").eq("owner_id", ownerId).maybeSingle(),
      sb.from("plaid_items").select("institution_name,status,last_synced_at,last_error").eq("owner_id", ownerId),
      sb.from("tasks").select("title,status,due_date").eq("owner_id", ownerId).ilike("title", "%full data export%").gte("due_date", start).lte("due_date", end),
    ]);
    data.net_worth_by_month = nw;
    data.debt_payments = payments ?? [];
    data.debts = snap.debts.map((d) => ({ id: d.id, name: d.name, balance: d.effective_balance, minimum: Number(d.minimum_payment) }));
    data.emergency_fund = snap.emergencyFund;
    data.retirement = snap.retirement;
    data.milestones = ms ?? [];
    data.connections = { google: google ?? { status: "disconnected" }, plaid: plaid ?? [] };
    data.export_tasks = exportTasks ?? [];
  }
  if (kind === "quarterly") {
    const next = quarterBounds(addDaysISO(end, 1));
    const [{ data: goals }, { data: inits }, { data: inputs }, { data: nextMs }, { data: dueConds }] = await Promise.all([
      sb.from("goals").select("id,title,initiative_id,metric_key,target_value,comparison,deadline,status").eq("owner_id", ownerId),
      sb.from("initiatives").select("id,name").eq("owner_id", ownerId),
      sb.from("inputs").select("label,value_number,value_text,updated_at").eq("owner_id", ownerId).order("sort_order"),
      sb.from("milestones").select("title,due_date,status").eq("owner_id", ownerId).gte("due_date", next.start).lte("due_date", next.end),
      sb.from("decision_conditions").select("name,check_from").eq("owner_id", ownerId).gte("check_from", next.start).lte("check_from", next.end),
    ]);
    const initName = Object.fromEntries(((inits ?? []) as Row[]).map((i) => [i.id, i.name]));
    data.goals = ((goals ?? []) as Row[]).map((g) => ({
      ...g,
      initiative: initName[g.initiative_id] ?? "No initiative",
      current: g.metric_key ? metrics.values[g.metric_key] ?? null : null,
    }));
    data.inputs = inputs ?? [];
    data.next_quarter = next;
    data.next_quarter_milestones = nextMs ?? [];
    data.conditions_due_next_quarter = dueConds ?? [];
  }
  return data;
}

function list(items: string[], none: string): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${none}`;
}

/** Plain draft used when the AI is not available. */
export function templateReviewDraft(kind: ReviewKind, d: Row): string {
  const lines: string[] = [];
  lines.push(`Runway: ${fmtMonths(d.runway_months)} (target ${d.runway_target ?? "not set"} months). Cash ${money(d.cash)}.`);
  if (kind === "daily") {
    const tasks = (d.tasks ?? []) as Row[];
    const done = tasks.filter((t) => t.status === "done");
    lines.push(`Tasks due today: ${tasks.length}. Done: ${done.length}. Not done: ${tasks.length - done.length}.`);
    lines.push("Not done (give a reason for each):");
    lines.push(list(tasks.filter((t) => t.status !== "done").map((t) => t.title), "None"));
    lines.push("Suggested top 3 for tomorrow:");
    lines.push(list(((d.tomorrow_candidates ?? []) as Row[]).slice(0, 3).map((t) => t.title), "Add tasks for tomorrow"));
    return lines.join("\n");
  }
  lines.push(`Commitments: ${d.score?.met ?? 0} met, ${d.score?.missed ?? 0} missed (score ${d.score?.pct ?? "not available"}${d.score?.pct !== null && d.score?.pct !== undefined ? "%" : ""}).`);
  lines.push("Missed commitments:");
  lines.push(list(((d.missed_commitments ?? []) as Row[]).map((m) => `${m.title} (${m.missed_on})${m.reason ? `: ${m.reason}` : ""}`), "None"));
  if ((d.repeated_misses ?? []).length) {
    lines.push("Repeated misses:");
    lines.push(list((d.repeated_misses as Row[]).map((r) => `${r.title}: missed ${r.misses} times`), "None"));
  }
  lines.push("Decision conditions met:");
  lines.push(list(((d.conditions_met ?? []) as Row[]).map((c) => `${c.name} (${c.metric}: ${c.value})`), "None"));
  lines.push("Pipeline movement:");
  lines.push(list(((d.pipeline_moves ?? []) as Row[]).map((m) => `${m.item} moved to ${m.stage} on ${m.date}`), "No stage changes"));
  if (d.budget) {
    lines.push(`Spending vs budget: ${money(d.budget.totals.actual)} spent vs ${money(d.budget.totals.current)} budgeted (difference ${money(d.budget.totals.variance)}).`);
    if ((d.budget.over ?? []).length) lines.push(list((d.budget.over as Row[]).map((o) => `${o.category}: ${money(o.actual)} vs ${money(o.budget)}`), ""));
  }
  if (kind === "weekly") {
    lines.push("Next week's priorities (from due tasks):");
    lines.push(list(((d.next_week_tasks ?? []) as Row[]).slice(0, 5).map((t) => `${t.title} (due ${t.due_date})`), "Add next week's tasks"));
    lines.push(`Partner report drafts waiting: ${d.partner_report_drafts ?? 0}.`);
  }
  if (kind === "monthly" || kind === "quarterly") {
    const nw = (d.net_worth_by_month ?? []) as Row[];
    if (nw.length >= 2) lines.push(`Net worth: ${money(nw[nw.length - 2].netWorth)} to ${money(nw[nw.length - 1].netWorth)}.`);
    lines.push(`Emergency fund: ${d.emergency_fund?.pct ?? "not available"}% of target. Retirement: ${d.retirement?.pct ?? "not available"}% of target.`);
    lines.push(`Debt payments recorded: ${(d.debt_payments ?? []).length} for ${(d.debts ?? []).length} debts. Confirm each one below.`);
    lines.push(`Google connection: ${d.connections?.google?.status ?? "disconnected"}. Plaid connections: ${(d.connections?.plaid ?? []).length}.`);
    lines.push("Download the full data export: Settings, Export.");
  }
  if (kind === "quarterly") {
    lines.push("Goal progress per initiative:");
    lines.push(list(((d.goals ?? []) as Row[]).map((g) => `${g.initiative}: ${g.title} (current ${g.current ?? "not measured"}, target ${g.target_value ?? "not set"}, ${g.status})`), "No goals"));
    lines.push("Decision conditions due next quarter:");
    lines.push(list(((d.conditions_due_next_quarter ?? []) as Row[]).map((c) => `${c.name} (from ${c.check_from})`), "None"));
    lines.push("Review and update Inputs and Assumptions, then set next quarter's milestones.");
  }
  return lines.join("\n");
}

/** Creates the review for the period if it does not exist, with an AI draft (or a plain draft when the AI is unavailable). */
export async function ensureReview(ctx: Ctx, kind: ReviewKind, forceDate?: string): Promise<string | null> {
  const { sb, ownerId } = ctx;
  const p = reviewPeriod(kind, forceDate ?? ctx.today);
  const { data: existing } = await sb.from("reviews").select("id").eq("owner_id", ownerId).eq("kind", kind).eq("period_start", p.start).maybeSingle();
  if (existing) return existing.id;
  const data = await reviewData(ctx, kind, p.start, p.end);
  const prompt = `Draft Bram's ${kind} review for ${p.start} to ${p.end}. ${
    kind === "daily"
      ? "This is the evening daily close check: list tasks done and not done, ask for a reason for each not done, and suggest tomorrow's top 3 tasks."
      : "Cover each required section in order. Flag missed commitments, slipping milestones, and spending over budget. End with recommended priorities."
  } Keep it under 300 words. Data (JSON):\n${JSON.stringify(data).slice(0, 15000)}`;
  const ai = await tryDraft({ sb, ownerId, purpose: `review_${kind}`, prompt });
  const { data: created } = await sb
    .from("reviews")
    .insert({
      owner_id: ownerId,
      kind,
      period_start: p.start,
      period_end: p.end,
      status: "draft",
      ai_draft: ai ?? templateReviewDraft(kind, data),
      draft_source: ai ? "ai" : "template",
      data_snapshot: data,
    })
    .select("id")
    .single();
  return created?.id ?? null;
}

import "server-only";
import { addDaysISO, monthBounds, quarterBounds, todayInTz, weekBounds } from "@/lib/calc/dates";
import { budgetVariance } from "@/lib/calc/savings";
import { completionScore, repeatedMisses } from "@/lib/calc/scores";
import { computeMetrics, metricValue } from "@/lib/metrics";
import { netWorthByMonth } from "@/lib/finance";
import { tryDraft } from "@/lib/ai/claude";
import { money, months as fmtMonths } from "@/lib/format";
import { metricLabel } from "@/lib/metrics-list";
import { periodResult } from "@/lib/calc/targets";
import { loadOutreachStats, loadTargets, targetTotals } from "@/lib/targets";
import type { Row } from "@/lib/types";

import { sourcedBreakdownByDay, sumBreakdown } from "@/lib/calc/pipeline";
import { loadPipelineStatus } from "@/lib/pipeline";
import { tasksToReview } from "@/lib/calc/commitment-rule";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { loadConsulting, loadConsultingIncome } from "@/lib/consulting";
import { topIntroducers } from "@/lib/calc/source-chain";
import type { Ctx } from "./helpers";

/** Daily targets for one day of the daily close: count, required, and met or missed (the day is final). */
export async function dailyCloseTargets(ctx: Ctx, day: string): Promise<{ available: boolean; targets: Row[] }> {
  const data = await loadTargets(ctx.sb, { ownerId: ctx.ownerId, tz: ctx.tz, from: weekBounds(day).start, to: day });
  if (!data.available) return { available: false, targets: [] };
  const isWeekEnd = weekBounds(day).end === day;
  const targets = data.targets
    .map((t) => {
      const r = periodResult(t.def, data.counts[t.id] ?? {}, day, day);
      const miss = data.misses.find((m) => m.target_id === t.id && m.period_start === r.start);
      return { id: t.id, name: t.name, period: t.period, is_commitment: t.is_commitment, ...r, reason: miss?.reason ?? null };
    })
    // Day targets on their active days; week targets on the last day of the week.
    .filter((r) => r.status !== "off" && (r.period === "day" || isWeekEnd));
  return { available: true, targets };
}

/**
 * Commitments due on `day` that were not met (open or already marked missed), for the daily close.
 * Each has the reason given so far (from the missed commitment record), if any.
 */
export async function dailyCloseCommitments(ctx: Pick<Ctx, "sb" | "ownerId">, day: string): Promise<Row[]> {
  const { sb, ownerId } = ctx;
  const { data } = await sb.from("commitments").select("*").eq("owner_id", ownerId).eq("due_date", day).in("status", ["open", "missed"]);
  const list = (data ?? []) as Row[];
  if (!list.length) return [];
  const ids = (type: string) => list.filter((c) => c.record_type === type).map((c) => c.record_id);
  const [tasks, milestones, goals, misses] = await Promise.all([
    ids("tasks").length ? sb.from("tasks").select("id,status").in("id", ids("tasks")) : Promise.resolve({ data: [] }),
    ids("milestones").length ? sb.from("milestones").select("id,status").in("id", ids("milestones")) : Promise.resolve({ data: [] }),
    ids("goals").length ? sb.from("goals").select("id,status").in("id", ids("goals")) : Promise.resolve({ data: [] }),
    sb.from("missed_commitments").select("commitment_id,reason").eq("owner_id", ownerId).eq("missed_on", day).in("commitment_id", list.map((c) => c.id)),
  ]);
  const status: Record<string, string> = {};
  for (const r of [...((tasks.data ?? []) as Row[]), ...((milestones.data ?? []) as Row[]), ...((goals.data ?? []) as Row[])]) status[r.id] = r.status;
  const reason = Object.fromEntries(((misses.data ?? []) as Row[]).map((m) => [m.commitment_id, m.reason]));
  return list
    .filter((c) => {
      // The daily close task is met by completing the close itself.
      if (/daily close/i.test(String(c.title ?? ""))) return false;
      const s = status[c.record_id];
      return c.record_type === "tasks" ? s !== "done" : s !== "met";
    })
    .map((c) => ({ id: c.id, title: c.title, record_type: c.record_type, record_id: c.record_id, status: c.status, reason: reason[c.id] ?? null }));
}

/** Regular tasks moved to the next day at least the set number of times (Inputs: task_moved_review_threshold). */
export async function movedTasksForReview(ctx: Pick<Ctx, "sb" | "ownerId">): Promise<{ available: boolean; threshold: number; tasks: Row[] }> {
  const { sb, ownerId } = ctx;
  const { data: input } = await sb.from("inputs").select("value_number").eq("owner_id", ownerId).eq("key", "task_moved_review_threshold").maybeSingle();
  const raw = Number((input as Row | null)?.value_number);
  const threshold = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 5;
  const { data, error } = await sb.from("tasks").select("id,title,status,due_date,times_moved,priority").eq("owner_id", ownerId).eq("status", "todo").gte("times_moved", threshold).limit(200);
  if (error) {
    if (isMissingSchemaError(error)) return { available: false, threshold, tasks: [] };
    throw new Error(error.message);
  }
  return { available: true, threshold, tasks: tasksToReview((data ?? []) as { status: string; times_moved: number }[], threshold) as Row[] };
}

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
    const targets = await dailyCloseTargets(ctx, start);
    const commitmentsDue = await dailyCloseCommitments(ctx, start);
    return {
      ...base,
      tasks: due ?? [],
      tomorrow_candidates: tomorrow ?? [],
      targets: targets.targets,
      targets_available: targets.available,
      commitments_not_met: commitmentsDue.map((c) => ({ title: c.title })),
    };
  }
  const [changes, misses, commitments, conditions, moves, stages, items, budgets, lines, cats] = await Promise.all([
    sb.from("change_log").select("table_name,action,actor").eq("owner_id", ownerId).gte("created_at", `${start}T00:00:00`).lte("created_at", `${end}T23:59:59`).limit(1000),
    sb.from("missed_commitments").select("id,commitment_id,missed_on,reason,resolution").eq("owner_id", ownerId).neq("resolution", "released").gte("missed_on", start).lte("missed_on", end),
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
  const repeated = Object.entries(repeatedMisses(((await sb.from("missed_commitments").select("commitment_id").eq("owner_id", ownerId).neq("resolution", "released")).data ?? []) as { commitment_id: string }[])).map(([id, n]) => ({
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
  // Daily targets: totals vs required for the period, and outreach results (empty until update 0008 is applied).
  const targetData = await loadTargets(sb, { ownerId, tz: ctx.tz, from: addDaysISO(start, -120), to: end });
  data.targets = targetData.available ? targetTotals(targetData, start, end, end) : [];
  data.outreach = await loadOutreachStats(sb, { ownerId, tz: ctx.tz, from: start, to: end });
  data.deal_sourcing = await dealSourcing(ctx, start, end);
  if (kind === "weekly" || kind === "monthly") {
    data.stalled_items = await stalledItems(ctx);
    data.consulting = await consultingSummary(ctx, start, end);
    data.top_introducers = await introducers(ctx, start, end);
  }
  if (kind === "weekly") {
    const [{ data: next }, { data: drafts }] = await Promise.all([
      sb.from("tasks").select("title,due_date,priority").eq("owner_id", ownerId).eq("status", "todo").gt("due_date", end).lte("due_date", addDaysISO(end, 7)).order("priority").limit(15),
      sb.from("partner_reports").select("id,partner_id,period_end").eq("owner_id", ownerId).eq("status", "draft"),
    ]);
    data.next_week_tasks = next ?? [];
    data.partner_report_drafts = (drafts ?? []).length;
    // Regular tasks moved to the next day many times: do, reschedule, or delete (no reasons needed).
    const moved = await movedTasksForReview(ctx);
    data.moved_tasks_threshold = moved.threshold;
    data.moved_tasks = moved.tasks.map((t) => ({ title: t.title, times_moved: t.times_moved }));
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
      sb.from("goals").select("*").eq("owner_id", ownerId),
      sb.from("initiatives").select("id,name").eq("owner_id", ownerId),
      sb.from("inputs").select("label,value_number,value_text,updated_at").eq("owner_id", ownerId).order("sort_order"),
      sb.from("milestones").select("title,due_date,status").eq("owner_id", ownerId).gte("due_date", next.start).lte("due_date", next.end),
      sb.from("decision_conditions").select("name,check_from").eq("owner_id", ownerId).gte("check_from", next.start).lte("check_from", next.end),
    ]);
    const initName = Object.fromEntries(((inits ?? []) as Row[]).map((i) => [i.id, i.name]));
    data.goals = ((goals ?? []) as Row[]).map((g) => ({
      id: g.id,
      title: g.title,
      initiative_id: g.initiative_id,
      metric_key: g.metric_key,
      target_value: g.target_value,
      comparison: g.comparison,
      deadline: g.deadline,
      status: g.status,
      initiative: initName[g.initiative_id] ?? "No initiative",
      current: g.metric_key ? metricValue(metrics, g.metric_key, g.metric_params) : null,
    }));
    data.inputs = inputs ?? [];
    data.next_quarter = next;
    data.next_quarter_milestones = nextMs ?? [];
    data.conditions_due_next_quarter = dueConds ?? [];
  }
  return data;
}

/** Acquisition deals sourced in the period, split proprietary (off-market) vs brokered, with the proprietary share. */
async function dealSourcing(ctx: Ctx, start: string, end: string): Promise<Row | null> {
  const { sb, ownerId, tz } = ctx;
  const { data: pipes } = await sb.from("pipelines").select("id").eq("owner_id", ownerId).eq("kind", "acquisition");
  const ids = ((pipes ?? []) as Row[]).map((p) => p.id);
  if (!ids.length) return null;
  const { data, error } = await sb
    .from("pipeline_items")
    .select("id,created_at,deal_source_type")
    .eq("owner_id", ownerId)
    .in("pipeline_id", ids)
    .gte("created_at", `${addDaysISO(start, -1)}T00:00:00Z`)
    .lte("created_at", `${addDaysISO(end, 1)}T23:59:59Z`);
  if (error) return null; // Database update 0009 not applied yet.
  const items = ((data ?? []) as Row[]).map((i) => ({ id: i.id, date: todayInTz(tz, new Date(i.created_at)), deal_source_type: i.deal_source_type }));
  const s = sumBreakdown(sourcedBreakdownByDay(items), start, end);
  return { sourced: s.total, proprietary: s.proprietary, brokered: s.brokered, not_set: s.notSet, proprietary_share_pct: s.proprietarySharePct };
}

/**
 * Consulting for the review period (database update 0011): signed or active engagements, consulting income received,
 * pipeline value, expected monthly income from signed work, and open items by stage. Null before the update.
 */
async function consultingSummary(ctx: Ctx, start: string, end: string): Promise<Row | null> {
  try {
    const c = await loadConsulting(ctx.sb, { ownerId: ctx.ownerId, today: ctx.today });
    if (!c.available || !c.pipelines.length) return null;
    const income = await loadConsultingIncome(ctx.sb, { ownerId: ctx.ownerId, from: start, to: end, itemIds: c.items.map((i) => i.item.id) });
    return {
      active_engagements: c.items.filter((i) => i.item.status === "open" && i.signedStage).map((i) => ({ name: i.item.name, stage: i.stage?.name ?? "", expected_monthly: i.expectedMonthly })),
      income_received: income.total,
      pipeline_value: c.pipelineValue,
      signed_monthly: c.signedMonthly,
      by_stage: c.byStage.map((s) => ({ stage: s.name, count: s.count })),
    };
  } catch {
    return null;
  }
}

/** Top 5 contacts by deals introduced ("Deal came from" or "Introduced by"), all time, with the count for the period. */
async function introducers(ctx: Ctx, start: string, end: string): Promise<Row[]> {
  const { sb, ownerId, tz } = ctx;
  const [{ data: items, error }, { data: pipes }, { data: contacts }] = await Promise.all([
    sb.from("pipeline_items").select("*").eq("owner_id", ownerId),
    sb.from("pipelines").select("id,kind").eq("owner_id", ownerId),
    sb.from("contacts").select("id,name").eq("owner_id", ownerId),
  ]);
  if (error) return [];
  const kindOf = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p.kind]));
  const names = Object.fromEntries(((contacts ?? []) as Row[]).map((c) => [c.id, c.name]));
  return topIntroducers(
    ((items ?? []) as Row[]).map((i) => ({
      id: i.id,
      kind: kindOf[i.pipeline_id],
      source_contact_id: i.source_contact_id,
      introduced_by_contact_id: i.introduced_by_contact_id,
      created_at: i.created_at ? todayInTz(tz, new Date(i.created_at)) : null,
    })),
    names,
    { limit: 5, from: start, to: end },
  );
}

/** Open pipeline items with no stage change and no activity for the set number of days. */
async function stalledItems(ctx: Ctx): Promise<Row[]> {
  const { sb, ownerId } = ctx;
  const [{ data: items }, { data: pipes }] = await Promise.all([
    sb.from("pipeline_items").select("*").eq("owner_id", ownerId).eq("status", "open"),
    sb.from("pipelines").select("id,name").eq("owner_id", ownerId),
  ]);
  const list = (items ?? []) as Row[];
  if (!list.length) return [];
  const pipeName = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p.name]));
  const status = await loadPipelineStatus(sb, list, { ownerId, tz: ctx.tz, today: ctx.today });
  return list
    .filter((i) => status.byItem[i.id]?.stalled)
    .map((i) => ({ name: i.name, pipeline: pipeName[i.pipeline_id] ?? "Pipeline", days_without_activity: status.byItem[i.id].daysSinceActivity, last_activity: status.byItem[i.id].lastActivity }));
}

const bullet = (lead: string, text: string, depth = 0) => `${"  ".repeat(depth)}- **${lead}:** ${text}`;

function section(lines: string[], label: string, items: string[], none: string) {
  lines.push("", `**${label}**`);
  if (items.length) lines.push(...items);
  else lines.push(bullet("None", none));
}

function pctText(p: number | null | undefined): string {
  return p === null || p === undefined ? "not available" : `${p}%`;
}

/** Plain draft used when the AI is not available, in the same bulleted format the AI uses. */
export function templateReviewDraft(kind: ReviewKind, d: Row): string {
  const lines: string[] = ["**Summary**"];
  lines.push(bullet("Runway", `${fmtMonths(d.runway_months)} (target ${d.runway_target ?? "not set"} months).`));
  lines.push(bullet("Cash", money(d.cash), 1));
  if (kind === "daily") {
    const tasks = (d.tasks ?? []) as Row[];
    const done = tasks.filter((t) => t.status === "done");
    lines.push(bullet("Tasks due today", `${tasks.length}. Done ${done.length}. Not done ${tasks.length - done.length}.`));
    section(lines, "Not done (regular tasks move to tomorrow, no reason needed)", tasks.filter((t) => t.status !== "done").map((t) => bullet("Task", t.title)), "every task due today is done.");
    const notMet = (d.commitments_not_met ?? []) as Row[];
    if (notMet.length) section(lines, "Commitments not met today (a reason is needed)", notMet.map((c) => bullet("Commitment", c.title)), "");
    const targets = (d.targets ?? []) as Row[];
    if (targets.length) {
      section(
        lines,
        "Daily targets",
        targets.map((t) => bullet(t.name, `${t.count} of ${t.required}. ${t.status === "met" ? "Met." : "Missed. Give a one-line reason."}`)),
        "no targets today.",
      );
    }
    section(lines, "Suggested top 3 for tomorrow", ((d.tomorrow_candidates ?? []) as Row[]).slice(0, 3).map((t, i) => bullet(`Task ${i + 1}`, t.title)), "add tasks for tomorrow.");
    return lines.join("\n");
  }
  lines.push(bullet("Commitments", `${d.score?.met ?? 0} met, ${d.score?.missed ?? 0} missed (score ${pctText(d.score?.pct)}).`));
  section(lines, "Missed commitments", ((d.missed_commitments ?? []) as Row[]).map((m) => bullet(m.title, `missed ${m.missed_on}${m.reason ? `. Reason: ${m.reason}` : ""}`)), "no commitments missed.");
  if ((d.repeated_misses ?? []).length) section(lines, "Repeated misses", (d.repeated_misses as Row[]).map((r) => bullet(r.title, `missed ${r.misses} times`)), "");
  const targets = (d.targets ?? []) as Row[];
  if (targets.length) {
    const items: string[] = [];
    for (const t of targets) {
      items.push(bullet(t.name, `${t.total} done of ${t.required} required.`));
      items.push(bullet(t.period === "week" ? "Weeks" : "Days", `${t.met} met, ${t.missed} missed (${pctText(t.pct)}).`, 1));
      for (const r of (t.miss_reasons ?? []) as Row[]) items.push(bullet(`Missed ${r.date}`, r.reason, 1));
    }
    section(lines, "Daily targets", items, "");
  }
  if (d.outreach) {
    section(
      lines,
      "Outreach",
      [
        bullet("Sent", String(d.outreach.sent)),
        bullet("Reply rate", `${pctText(d.outreach.replyRatePct)} (replied, meeting booked, or referral).`),
        bullet("Meetings booked", String(d.outreach.meetings)),
        bullet("Referrals", String(d.outreach.referrals)),
      ],
      "",
    );
  }
  if (d.deal_sourcing) {
    const ds = d.deal_sourcing as Row;
    section(
      lines,
      "Deal sourcing",
      [
        bullet("Sourced", `${ds.sourced} acquisition deals.`),
        bullet("Proprietary", `${ds.proprietary} (off-market).`, 1),
        bullet("Brokered", String(ds.brokered), 1),
        ...(ds.not_set ? [bullet("Source not set", String(ds.not_set), 1)] : []),
        bullet("Proprietary share", pctText(ds.proprietary_share_pct)),
      ],
      "",
    );
  }
  if (d.stalled_items) {
    section(
      lines,
      "Stalled pipeline items",
      ((d.stalled_items ?? []) as Row[]).map((i) => bullet(i.name, `${i.pipeline}, no activity for ${i.days_without_activity} days.`)),
      "no stalled items.",
    );
  }
  if (d.top_introducers && (d.top_introducers as Row[]).length) {
    section(
      lines,
      "Top contacts by deals introduced",
      (d.top_introducers as Row[]).map((t) => bullet(t.name, `${t.deals} deals${t.consulting_leads ? `, ${t.consulting_leads} consulting leads` : ""} (${t.deals_this_period} this period).`)),
      "",
    );
  }
  if (d.consulting) {
    const c = d.consulting as Row;
    section(
      lines,
      "Consulting",
      [
        bullet("Signed or active engagements", String((c.active_engagements ?? []).length)),
        ...((c.active_engagements ?? []) as Row[]).map((e) => bullet(e.name, `${e.stage}, ${e.expected_monthly === null ? "income not set" : `${money(e.expected_monthly)} per month`}`, 1)),
        bullet("Consulting income received", money(c.income_received)),
        bullet("Pipeline value", `${money(c.pipeline_value)} per month (expected x probability).`),
        bullet("Open items by stage", ((c.by_stage ?? []) as Row[]).map((s) => `${s.stage} ${s.count}`).join(", ") || "none"),
      ],
      "",
    );
  }
  section(lines, "Decision conditions met", ((d.conditions_met ?? []) as Row[]).map((c) => bullet(c.name, `${c.metric}: ${c.value}`)), "no conditions met.");
  section(lines, "Pipeline movement", ((d.pipeline_moves ?? []) as Row[]).map((m) => bullet(m.item, `moved to ${m.stage} on ${m.date}`)), "no stage changes.");
  if (d.budget) {
    const items = [bullet("Spent", `${money(d.budget.totals.actual)} vs ${money(d.budget.totals.current)} budgeted (difference ${money(d.budget.totals.variance)}).`)];
    for (const o of (d.budget.over ?? []) as Row[]) items.push(bullet(o.category, `${money(o.actual)} vs ${money(o.budget)}`, 1));
    section(lines, "Spending vs budget", items, "");
  }
  if (kind === "weekly") {
    section(lines, "Next week's priorities (from due tasks)", ((d.next_week_tasks ?? []) as Row[]).slice(0, 5).map((t) => bullet(t.title, `due ${t.due_date}`)), "add next week's tasks.");
    lines.push(bullet("Partner report drafts waiting", String(d.partner_report_drafts ?? 0)));
    section(
      lines,
      `Tasks moved ${d.moved_tasks_threshold ?? 5} or more times (do, reschedule, or delete)`,
      ((d.moved_tasks ?? []) as Row[]).map((t) => bullet(t.title, `moved ${t.times_moved} times`)),
      "no task moved that often.",
    );
  }
  if (kind === "monthly" || kind === "quarterly") {
    const nw = (d.net_worth_by_month ?? []) as Row[];
    const items: string[] = [];
    if (nw.length >= 2) items.push(bullet("Net worth", `${money(nw[nw.length - 2].netWorth)} to ${money(nw[nw.length - 1].netWorth)}.`));
    items.push(bullet("Emergency fund", `${d.emergency_fund?.pct ?? "not available"}% of target.`));
    items.push(bullet("Retirement", `${d.retirement?.pct ?? "not available"}% of target.`));
    items.push(bullet("Debt payments", `${(d.debt_payments ?? []).length} recorded for ${(d.debts ?? []).length} debts. Confirm each one.`));
    items.push(bullet("Connections", `Google ${d.connections?.google?.status ?? "disconnected"}. Plaid institutions: ${(d.connections?.plaid ?? []).length}.`));
    items.push(bullet("Export", "download the full data export in Settings, Export."));
    section(lines, kind === "monthly" ? "This month" : "This quarter", items, "");
  }
  if (kind === "quarterly") {
    section(lines, "Goal progress per initiative", ((d.goals ?? []) as Row[]).map((g) => bullet(g.initiative, `${g.title} (current ${g.current ?? "not measured"}, target ${g.target_value ?? "not set"}, ${g.status})`)), "no goals.");
    section(lines, "Decision conditions due next quarter", ((d.conditions_due_next_quarter ?? []) as Row[]).map((c) => bullet(c.name, `from ${c.check_from}`)), "none.");
    lines.push(bullet("Next step", "review Inputs and Assumptions, then set next quarter's milestones."));
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
      ? "This is the evening daily close check: list tasks done and not done (regular tasks not done move to tomorrow automatically and need no reason), list commitments not met today (each needs a reason; one reason can cover several), show each daily target as met or missed (a missed target needs a reason), and suggest tomorrow's top 3 tasks."
      : "Cover each required section in order, each under a short bold label. Flag missed commitments, slipping milestones, and spending over budget. Include daily target totals vs required, the outreach reply rate, and meetings booked. Report deals sourced split proprietary vs brokered with the proprietary share, list stalled pipeline items, list the top contacts by deals introduced (top_introducers), and report consulting (signed or active engagements, consulting income received, pipeline value, items by stage) when present. In the weekly review, list regular tasks moved to the next day many times (moved_tasks) so they can be done, rescheduled, or deleted. End with recommended priorities."
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

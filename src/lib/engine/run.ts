import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, parseDate } from "@/lib/calc/dates";
import { checkGoogle, listEventsForDay, type MeetingItem } from "@/lib/google";
import { checkPlaidItem, syncPlaidItem } from "@/lib/plaid";
import { isPlaidConfigured } from "@/lib/env";
import { tryDraft } from "@/lib/ai/claude";
import { computeMetrics } from "@/lib/metrics";
import { money, months as fmtMonths } from "@/lib/format";
import type { Row } from "@/lib/types";
import { createAlert, createTask, loadCtx, type Ctx } from "./helpers";
import { checkMilestones, evaluateConditions } from "./rules";
import { checkCommitments, createTimeBlocks, generateFollowUps, generatePipelineTasks, generateRecurringTasks, scheduleReviewEvents } from "./tasks";
import { applyCategoryRules, detectAndSaveRecurring } from "./finance-jobs";
import { ensureReview } from "./reviews";
import { schedulePartnerReports } from "./partners";

type StepResult = { step: string; ok: boolean; result?: unknown; error?: string };

async function step(name: string, fn: () => Promise<unknown>, log: StepResult[]) {
  try {
    log.push({ step: name, ok: true, result: await fn() });
  } catch (e) {
    log.push({ step: name, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Daily Plaid sync for every connected institution. */
export async function plaidSyncAll(ctx: Ctx) {
  if (!isPlaidConfigured()) return { skipped: "Plaid is not set up yet" };
  const { data } = await ctx.sb.from("plaid_items").select("*").eq("owner_id", ctx.ownerId).neq("status", "disconnected");
  const results: Row[] = [];
  for (const item of (data ?? []) as Row[]) {
    try {
      results.push({ institution: item.institution_name, ...(await syncPlaidItem(ctx.sb, ctx.ownerId, item)) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.sb.from("plaid_items").update({ status: "error", last_error: msg }).eq("id", item.id);
      results.push({ institution: item.institution_name, error: msg });
    }
  }
  return results;
}

async function reconnectTask(ctx: Ctx, service: "Google" | "Plaid", detail: string) {
  const { data: open } = await ctx.sb.from("tasks").select("id").eq("owner_id", ctx.ownerId).eq("source", "connection").eq("status", "todo").ilike("title", `Reconnect ${service}%`).limit(1);
  if (!open?.length) {
    await createTask(ctx, {
      title: `Reconnect ${service} (2 minutes)`,
      due_date: ctx.today,
      source: "connection",
      source_key: `reconnect:${service.toLowerCase()}:${ctx.today}`,
      priority: 1,
      description: `${detail} Open Settings, Connections, and press Connect ${service}.`,
    });
  }
  await createAlert(ctx, {
    kind: "connection",
    severity: "critical",
    message: `The ${service} connection failed. Reconnect it in Settings (2 minutes).`,
    href: "/settings",
    dedupe_key: `connection:${service.toLowerCase()}`,
  });
}

/** Daily check of the Google and Plaid connections. A failure creates an alert and a reconnect task. */
export async function connectionChecks(ctx: Ctx) {
  const out: Row = {};
  const g = await checkGoogle(ctx.sb, ctx.ownerId);
  out.google = g;
  if (!g.skipped) {
    await ctx.sb
      .from("google_connections")
      .update({ status: g.ok ? "connected" : "error", last_checked_at: new Date().toISOString(), last_error: g.ok ? null : g.error ?? null })
      .eq("owner_id", ctx.ownerId);
    if (!g.ok) await reconnectTask(ctx, "Google", `Google reported: ${g.error}.`);
  }
  if (isPlaidConfigured()) {
    const { data } = await ctx.sb.from("plaid_items").select("*").eq("owner_id", ctx.ownerId).neq("status", "disconnected");
    const plaid: Row[] = [];
    for (const item of (data ?? []) as Row[]) {
      const r = await checkPlaidItem(item);
      plaid.push({ institution: item.institution_name, ...r });
      await ctx.sb.from("plaid_items").update({ status: r.ok ? "connected" : "error", last_checked_at: new Date().toISOString(), last_error: r.ok ? null : r.error ?? null }).eq("id", item.id);
      if (!r.ok) await reconnectTask(ctx, "Plaid", `${item.institution_name ?? "An institution"}: ${r.error}.`);
    }
    out.plaid = plaid;
  }
  return out;
}

export async function todaysMeetings(ctx: Ctx): Promise<MeetingItem[] | null> {
  try {
    return await listEventsForDay(ctx.sb, ctx.ownerId, ctx.today, ctx.tz);
  } catch {
    return null;
  }
}

/** The AI's morning plan, built from due tasks, pipeline next actions, milestone tasks, meetings, and alerts. */
export async function buildMorningPlan(ctx: Ctx, force = false): Promise<string> {
  const { sb, ownerId, today } = ctx;
  if (!force) {
    const { data: existing } = await sb.from("daily_plans").select("content").eq("owner_id", ownerId).eq("plan_date", today).maybeSingle();
    if (existing) return existing.content;
  }
  const [{ data: tasks }, { data: alerts }, { data: milestones }, { data: decisions }, metrics, meetings] = await Promise.all([
    sb.from("tasks").select("title,due_date,priority,source").eq("owner_id", ownerId).eq("status", "todo").lte("due_date", today).order("priority").order("due_date").limit(40),
    sb.from("alerts").select("message,kind").eq("owner_id", ownerId).eq("status", "open").limit(20),
    sb.from("milestones").select("title,due_date,status").eq("owner_id", ownerId).in("status", ["planned", "active"]).lte("due_date", addDaysISO(today, 14)),
    sb.from("decisions").select("title,due_date").eq("owner_id", ownerId).eq("status", "open"),
    computeMetrics(sb, today, ownerId),
    todaysMeetings(ctx),
  ]);
  const taskList = (tasks ?? []) as Row[];
  const overdue = taskList.filter((t) => t.due_date < today);
  const dueToday = taskList.filter((t) => t.due_date === today);
  const data = {
    date: today,
    runway: fmtMonths(metrics.snapshot.runway.months),
    runway_target: metrics.snapshot.inputs.num.runway_target_months,
    month_spending: metrics.values.month_spending,
    due_today: dueToday,
    overdue,
    alerts: alerts ?? [],
    milestones_due_14_days: milestones ?? [],
    open_decisions: decisions ?? [],
    meetings: (meetings ?? []).map((m) => ({ title: m.title, start: m.start })),
  };
  const ai = await tryDraft({
    sb,
    ownerId,
    purpose: "morning_plan",
    prompt: `Write today's morning plan for Bram (${today}). Format: "Top 3" (numbered), then "Also today" (bullets), then "Watch" (alerts, overdue items, milestones due soon, open decisions). Mention any change in runway or spending that needs action. Under 220 words. Data (JSON): ${JSON.stringify(data).slice(0, 12000)}`,
    maxTokens: 700,
  });
  const content = ai ?? templatePlan(data, metrics.snapshot.cash);
  await sb.from("daily_plans").upsert({ owner_id: ownerId, plan_date: today, content, generated_by: ai ? "ai" : "template" }, { onConflict: "owner_id,plan_date" });
  return content;
}

function templatePlan(d: Row, cash: number): string {
  const top = [...d.overdue, ...d.due_today].slice(0, 3) as Row[];
  const lines = ["Top 3"];
  if (top.length) top.forEach((t, i) => lines.push(`${i + 1}. ${t.title}${t.due_date < d.date ? " (overdue)" : ""}`));
  else lines.push("1. No tasks due. Add today's priorities in Productivity.");
  const rest = [...d.overdue, ...d.due_today].slice(3) as Row[];
  if (rest.length) {
    lines.push("", "Also today");
    rest.slice(0, 10).forEach((t) => lines.push(`- ${t.title}`));
  }
  if ((d.meetings ?? []).length) {
    lines.push("", "Meetings");
    (d.meetings as Row[]).forEach((m) => lines.push(`- ${m.title}`));
  }
  lines.push("", "Watch");
  lines.push(`- Runway: ${d.runway} (target ${d.runway_target ?? "not set"} months). Cash ${money(cash)}.`);
  (d.alerts as Row[]).slice(0, 5).forEach((a) => lines.push(`- ${a.message}`));
  (d.milestones_due_14_days as Row[]).forEach((m) => lines.push(`- Milestone due ${m.due_date}: ${m.title}`));
  (d.open_decisions as Row[]).forEach((x) => lines.push(`- Open decision: ${x.title}`));
  return lines.join("\n");
}

/** Morning job: sync, checks, task generation, reviews due, partner reports, time blocks, then the morning plan. */
export async function runMorning(sb: SupabaseClient, ownerId: string) {
  const ctx = await loadCtx(sb, ownerId);
  const log: StepResult[] = [];
  const d = parseDate(ctx.today);
  await step("plaid_sync", () => plaidSyncAll(ctx), log);
  await step("category_rules", () => applyCategoryRules(sb, ownerId), log);
  await step("recurring_detection", () => detectAndSaveRecurring(sb, ownerId, ctx.today), log);
  await step("connection_checks", () => connectionChecks(ctx), log);
  await step("recurring_tasks", () => generateRecurringTasks(ctx), log);
  await step("pipeline_tasks", () => generatePipelineTasks(ctx), log);
  await step("follow_ups", () => generateFollowUps(ctx), log);
  await step("commitments", () => checkCommitments(ctx, false), log);
  await step("milestones", () => checkMilestones(ctx), log);
  await step("decision_conditions", () => evaluateConditions(ctx), log);
  if (d.getDay() === Number(ctx.profile.weekly_review_weekday ?? 0)) await step("weekly_review", () => ensureReview(ctx, "weekly"), log);
  if (d.getDate() === 1) await step("monthly_review", () => ensureReview(ctx, "monthly"), log);
  if (d.getDate() === 1 && [0, 3, 6, 9].includes(d.getMonth())) await step("quarterly_review", () => ensureReview(ctx, "quarterly"), log);
  await step("partner_reports", () => schedulePartnerReports(ctx), log);
  const { data: inputs } = await sb.from("inputs").select("key,value_number").eq("owner_id", ownerId);
  const num = Object.fromEntries(((inputs ?? []) as Row[]).map((i) => [i.key, i.value_number === null ? null : Number(i.value_number)]));
  await step("time_blocks", () => createTimeBlocks(ctx, num), log);
  await step("review_events", () => scheduleReviewEvents(ctx), log);
  await step("morning_plan", () => buildMorningPlan(ctx, true), log);
  return { date: ctx.today, log };
}

/** Evening job: commitment check for the day, the daily close draft (the AI's evening check), and a condition check. */
export async function runEvening(sb: SupabaseClient, ownerId: string) {
  const ctx = await loadCtx(sb, ownerId);
  const log: StepResult[] = [];
  await step("daily_close", () => ensureReview(ctx, "daily"), log);
  await step("commitments", () => checkCommitments(ctx, true), log);
  await step("decision_conditions", () => evaluateConditions(ctx), log);
  return { date: ctx.today, log };
}

export async function ownerIds(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from("owner_profile").select("owner_id");
  return ((data ?? []) as Row[]).map((r) => r.owner_id);
}

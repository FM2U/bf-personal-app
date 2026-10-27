import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, parseDate } from "@/lib/calc/dates";
import { checkGoogle, listEventsForDay, type MeetingItem } from "@/lib/google";
import { checkPlaidItem, syncPlaidItem } from "@/lib/plaid";
import { env, isAIConfigured, isPlaidConfigured } from "@/lib/env";
import { anthropicBaseUrl, tryDraft } from "@/lib/ai/claude";
import { computeMetrics } from "@/lib/metrics";
import { money, months as fmtMonths } from "@/lib/format";
import { describeTarget } from "@/lib/calc/targets";
import { summarizeTargets } from "@/lib/targets";
import { loadOutreachQueue } from "@/lib/outreach";
import type { Row } from "@/lib/types";
import { createAlert, createTask, loadCtx, type Ctx } from "./helpers";
import { checkMilestones, evaluateConditions } from "./rules";
import { checkCommitments, createTimeBlocks, generateFollowUps, generatePipelineTasks, generateRecurringTasks, releaseSupersededNextActions, rolloverRegularTasks, scheduleReviewEvents } from "./tasks";
import { applyCategoryRules, detectAndSaveRecurring } from "./finance-jobs";
import { ensureReview } from "./reviews";
import { schedulePartnerReports } from "./partners";
import { checkPipelineAccountability } from "./pipeline-jobs";
import { proposeSavingsIdeas } from "./savings-ideas";
import { sortTasksProprietaryFirst } from "@/lib/calc/pipeline";
import { loadDealRanks, loadDealTypes } from "@/lib/pipeline";

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

const KEY_EXPIRY_INPUT = "anthropic_key_expiry_date";
const KEY_EXPIRY_WARNING_DAYS = 14;

/** Makes sure the "Anthropic API key expiry date" input exists (added after first install). */
async function ensureKeyExpiryInput(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.sb.from("inputs").select("value_text").eq("owner_id", ctx.ownerId).eq("key", KEY_EXPIRY_INPUT).maybeSingle();
  if (data) return (data as Row).value_text ?? null;
  await ctx.sb.from("inputs").upsert(
    {
      owner_id: ctx.ownerId,
      key: KEY_EXPIRY_INPUT,
      label: "Anthropic API key expiry date",
      category: "AI",
      unit: "date",
      value_number: null,
      value_text: null,
      description: `Date the Anthropic API key stops working (shown in the Anthropic Console). The app warns ${KEY_EXPIRY_WARNING_DAYS} days before this date.`,
      sort_order: 265,
    },
    { onConflict: "owner_id,key", ignoreDuplicates: true },
  );
  return null;
}

/** Confirms the Anthropic API key is accepted. Listing models is free. */
async function checkAnthropicKey(): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!isAIConfigured()) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${anthropicBaseUrl()}/v1/models?limit=1`, {
      headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" },
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `the key was rejected (HTTP ${res.status})` };
    return { ok: true, error: `Anthropic returned HTTP ${res.status}; not treated as a key problem` };
  } catch (e) {
    return { ok: true, error: `Anthropic could not be reached (${e instanceof Error ? e.message : String(e)}); not treated as a key problem` };
  }
}

/** Daily check of the Anthropic API key: rejected key, and expiry within 14 days. */
export async function anthropicKeyCheck(ctx: Ctx) {
  const expiry = await ensureKeyExpiryInput(ctx);
  const check = await checkAnthropicKey();
  if (check.skipped) return { skipped: "AI is not set up yet" };
  if (!check.ok) {
    await createTask(ctx, {
      title: "Replace the Anthropic API key (5 minutes)",
      due_date: ctx.today,
      source: "connection",
      source_key: `anthropic:rejected:${ctx.today}`,
      priority: 1,
      description: `Anthropic reported that ${check.error}. Create a new key at console.anthropic.com/settings/keys, paste it into Vercel as ANTHROPIC_API_KEY, redeploy, then update the expiry date in Plan, Inputs and Assumptions.`,
    });
    await createAlert(ctx, {
      kind: "connection",
      severity: "critical",
      message: "The Anthropic API key was rejected. AI features are not working until the key is replaced.",
      href: "/settings",
      dedupe_key: "connection:anthropic",
    });
  }
  let daysLeft: number | null = null;
  const expiryDate = expiry ? parseDate(expiry) : null;
  if (expiryDate) {
    const todayDate = parseDate(ctx.today);
    if (todayDate) daysLeft = Math.round((expiryDate.getTime() - todayDate.getTime()) / 86_400_000);
    if (daysLeft !== null && daysLeft <= KEY_EXPIRY_WARNING_DAYS) {
      const when = daysLeft < 0 ? `expired on ${expiry}` : daysLeft === 0 ? "expires today" : `expires in ${daysLeft} days (${expiry})`;
      await createTask(ctx, {
        title: "Replace the Anthropic API key before it expires (5 minutes)",
        due_date: daysLeft <= 0 ? ctx.today : addDaysISO(ctx.today, Math.max(0, daysLeft - 3)),
        source: "connection",
        source_key: `anthropic:expiry:${expiry}`,
        priority: 1,
        description: `The Anthropic API key ${when}. Create a new key at console.anthropic.com/settings/keys, paste it into Vercel as ANTHROPIC_API_KEY, redeploy, then enter the new expiry date in Plan, Inputs and Assumptions.`,
      });
      await createAlert(ctx, {
        kind: "connection",
        severity: daysLeft <= 3 ? "critical" : "warning",
        message: `The Anthropic API key ${when}. Replace it to keep AI features working.`,
        href: "/plan/inputs",
        dedupe_key: `anthropic:expiry:${expiry}`,
      });
    }
  }
  return { ok: check.ok, note: check.error ?? null, expiry: expiry ?? "not set", daysLeft };
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
  out.anthropic = await anthropicKeyCheck(ctx);
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
    sb.from("tasks").select("title,due_date,priority,source,pipeline_item_id").eq("owner_id", ownerId).eq("status", "todo").lte("due_date", today).order("priority").order("due_date").limit(40),
    sb.from("alerts").select("message,kind").eq("owner_id", ownerId).eq("status", "open").limit(20),
    sb.from("milestones").select("title,due_date,status").eq("owner_id", ownerId).in("status", ["planned", "active"]).lte("due_date", addDaysISO(today, 14)),
    sb.from("decisions").select("title,due_date").eq("owner_id", ownerId).eq("status", "open"),
    computeMetrics(sb, today, ownerId),
    todaysMeetings(ctx),
  ]);
  // Tasks for proprietary (off-market) deals come before brokered ones at equal priority and due date.
  const [rankOf, dealTypes] = await Promise.all([loadDealRanks(sb, ownerId), loadDealTypes(sb, ownerId)]);
  const taskList = sortTasksProprietaryFirst((tasks ?? []) as Row[], rankOf).map(({ pipeline_item_id, ...t }) =>
    dealTypes[pipeline_item_id] ? { ...t, deal: dealTypes[pipeline_item_id] } : t,
  );
  const overdue = taskList.filter((t) => t.due_date < today);
  const dueToday = taskList.filter((t) => t.due_date === today);
  // Daily targets and the outreach queue (empty until database update 0008 is applied)
  const targetsToday = summarizeTargets(metrics.targets, today)
    .filter((s) => s.today.status !== "off")
    .map((s) => ({ name: s.target.name, rule: describeTarget(s.target.def), done_so_far: s.today.count, required: s.today.required, period: s.target.period, missed_in_a_row: s.missedInARow }));
  const queue = await loadOutreachQueue(sb, { ownerId, today, tz: ctx.tz }).catch(() => null);
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
    targets_today: targetsToday,
    outreach_due: queue?.available ? queue.due.slice(0, 5).map((r) => ({ name: r.name, days_overdue: r.status.daysOverdue, never_contacted: r.status.neverContacted })) : [],
    outreach_due_count: queue?.available ? queue.due.length : 0,
  };
  const ai = await tryDraft({
    sb,
    ownerId,
    purpose: "morning_plan",
    prompt: `Write today's morning plan for Bram (${today}). Tasks are already in priority order; tasks marked deal "proprietary" (off-market deals) come before "brokered" ones, so keep that order. Sections, each a short bold label on its own line followed by bullets: **Top 3** (exactly 3 bullets), **Daily targets** (each target: count needed today, and who in the outreach queue to contact first), **Also today**, **Watch** (alerts, overdue items, milestones due soon, open decisions, any change in runway or spending that needs action). Leave out a section with nothing in it. Under 220 words. Data (JSON): ${JSON.stringify(data).slice(0, 12000)}`,
    maxTokens: 700,
  });
  const content = ai ?? templatePlan(data, metrics.snapshot.cash);
  await sb.from("daily_plans").upsert({ owner_id: ownerId, plan_date: today, content, generated_by: ai ? "ai" : "template" }, { onConflict: "owner_id,plan_date" });
  return content;
}

function templatePlan(d: Row, cash: number): string {
  const top = [...d.overdue, ...d.due_today].slice(0, 3) as Row[];
  const lines = ["**Top 3**"];
  if (top.length) top.forEach((t, i) => lines.push(`- **Task ${i + 1}:** ${t.title}${t.deal === "proprietary" ? " (proprietary deal)" : ""}${t.due_date < d.date ? " (overdue)" : ""}`));
  else lines.push("- **No tasks due:** add today's priorities in Productivity.");
  const targets = (d.targets_today ?? []) as Row[];
  if (targets.length) {
    lines.push("", "**Daily targets**");
    targets.forEach((t) => lines.push(`- **${t.name}:** ${t.done_so_far} of ${t.required} done${t.period === "week" ? " this week" : " today"}.`));
    const due = (d.outreach_due ?? []) as Row[];
    if (due.length) {
      lines.push(`- **Outreach queue:** ${d.outreach_due_count} contacts due.`);
      due.slice(0, 3).forEach((c) => lines.push(`  - **${c.name}:** ${c.never_contacted ? "never contacted" : `${c.days_overdue} days overdue`}`));
    }
  }
  const rest = [...d.overdue, ...d.due_today].slice(3) as Row[];
  if (rest.length) {
    lines.push("", "**Also today**");
    rest.slice(0, 10).forEach((t) => lines.push(`- **Task:** ${t.title}`));
  }
  if ((d.meetings ?? []).length) {
    lines.push("", "**Meetings**");
    (d.meetings as Row[]).forEach((m) => lines.push(`- **Meeting:** ${m.title}`));
  }
  lines.push("", "**Watch**");
  lines.push(`- **Runway:** ${d.runway} (target ${d.runway_target ?? "not set"} months).`);
  lines.push(`  - **Cash:** ${money(cash)}`);
  (d.alerts as Row[]).slice(0, 5).forEach((a) => lines.push(`- **Alert:** ${a.message}`));
  (d.milestones_due_14_days as Row[]).forEach((m) => lines.push(`- **Milestone due ${m.due_date}:** ${m.title}`));
  (d.open_decisions as Row[]).forEach((x) => lines.push(`- **Open decision:** ${x.title}`));
  return lines.join("\n");
}

/** Morning job: sync, checks, task generation, missed regular tasks moved to today, reviews due, partner reports, time blocks, then the morning plan. */
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
  await step("pipeline_accountability", () => checkPipelineAccountability(ctx), log);
  await step("follow_ups", () => generateFollowUps(ctx), log);
  await step("commitments", () => checkCommitments(ctx, false), log);
  await step("task_rollover", () => rolloverRegularTasks(ctx), log);
  await step("milestones", () => checkMilestones(ctx), log);
  await step("decision_conditions", () => evaluateConditions(ctx), log);
  if (d.getDay() === Number(ctx.profile.weekly_review_weekday ?? 0)) {
    await step("weekly_review", () => ensureReview(ctx, "weekly"), log);
    // Up to 3 AI savings ideas from the last 90 days (skipped before update 0014 and when the AI cap is reached)
    await step("savings_ideas", () => proposeSavingsIdeas(ctx, "weekly"), log);
  }
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
  await step("next_actions", () => releaseSupersededNextActions(ctx), log);
  await step("commitments", () => checkCommitments(ctx, true), log);
  await step("decision_conditions", () => evaluateConditions(ctx), log);
  return { date: ctx.today, log };
}

export async function ownerIds(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from("owner_profile").select("owner_id");
  return ((data ?? []) as Row[]).map((r) => r.owner_id);
}

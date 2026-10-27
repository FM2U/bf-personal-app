"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx, refreshNextActionAlert, refreshStageLimitAlert } from "@/lib/engine/helpers";
import { evaluateConditions, markMilestoneMet } from "@/lib/engine/rules";
import { checkCommitments, generateFollowUps, generatePipelineTasks, generateRecurringTasks, createTimeBlocks, releaseSupersededNextActions, rolloverRegularTasks, scheduleReviewEvents } from "@/lib/engine/tasks";
import { applyCategoryRules, detectAndSaveRecurring } from "@/lib/engine/finance-jobs";
import { buildMorningPlan } from "@/lib/engine/run";
import { dailyCloseCommitments, dailyCloseTargets, ensureReview, type ReviewKind } from "@/lib/engine/reviews";
import { resolveCloseReasons, type CloseMiss } from "@/lib/calc/commitment-rule";
import { createPartnerReport, reportText, activeLinkFor } from "@/lib/engine/partners";
import { repaymentSchedule } from "@/lib/calc/savings";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { createGmailDraft } from "@/lib/google";
import { loadInputs } from "@/lib/finance";
import { env } from "@/lib/env";
import type { Row } from "@/lib/types";
import { applyStageLimitChoice, moveItemToStage } from "@/lib/pipeline-moves";

const done = (path?: string) => {
  revalidatePath("/", "layout");
  if (path) redirect(path);
};

/** "Move to stage" on the item page. A move with missing required details is blocked; the item page lists them. */
export async function moveStage(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("item_id"));
  const stageId = String(fd.get("stage_id"));
  const { data: item } = await supabase.from("pipeline_items").select("*").eq("id", id).maybeSingle();
  if (!item || item.stage_id === stageId) return done();
  const { missing } = await moveItemToStage(supabase, item as Row, stageId);
  if (missing.length) return done(`/records/pipeline_items/${id}?blocked=${stageId}`);
  const ctx = await loadCtx(supabase, ownerId);
  await releaseSupersededNextActions(ctx, id);
  await refreshNextActionAlert(ctx);
  await evaluateConditions(ctx);
  done(`/records/pipeline_items/${id}`);
}

export async function completeMilestone(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  await markMilestoneMet(ctx, String(fd.get("id")), String(fd.get("proof") ?? ""));
  await evaluateConditions(ctx);
  done();
}

export async function generateRepayments(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const { data: f } = await supabase.from("funding_sources").select("*").eq("id", id).single();
  if (!f) return;
  if (!f.term_months || !f.start_date) throw new Error("Set the term (months) and start date first.");
  const rows = repaymentSchedule({
    amount: Number(f.amount),
    annualRatePct: Number(f.interest_rate ?? 0),
    termMonths: Number(f.term_months),
    frequency: f.repayment_frequency,
    startDate: f.start_date,
  });
  await supabase.from("repayment_schedules").delete().eq("funding_source_id", id).eq("paid_amount", 0);
  if (rows.length) await supabase.from("repayment_schedules").insert(rows.map((r) => ({ ...r, owner_id: ownerId, funding_source_id: id })));
  done();
}

export async function chooseOption(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  // Stage time limit decisions act on the pipeline item (advance, pass, or extend).
  const [{ data: decision }, { data: option }] = await Promise.all([
    supabase.from("decisions").select("*").eq("id", String(fd.get("decision_id"))).maybeSingle(),
    supabase.from("decision_options").select("*").eq("id", String(fd.get("option_id"))).maybeSingle(),
  ]);
  if (decision && option) {
    const r = await applyStageLimitChoice(supabase, ownerId, decision as Row, option as Row);
    // Blocked by missing details: the decision stays open and the item page lists what to fill.
    if (r.handled && r.redirectTo?.includes("blocked=")) return done(r.redirectTo);
  }
  await supabase
    .from("decisions")
    .update({ status: "decided", chosen_option_id: String(fd.get("option_id")), decided_on: ctx.today, outcome: String(fd.get("outcome") ?? "") || null })
    .eq("id", String(fd.get("decision_id")));
  await supabase.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("related_id", String(fd.get("decision_id"))).eq("status", "open");
  // The grouped "stage time limits passed" alert on Home shows the new count (resolved at 0).
  if (decision?.source === "pipeline_stage") await refreshStageLimitAlert(ctx);
  done();
}

export async function setRecurringReview(fd: FormData) {
  const { supabase } = await requireOwner();
  const status = String(fd.get("review_status"));
  await supabase
    .from("recurring_series")
    .update({ review_status: status, review_flag: status === "unreviewed", status: status === "cancelled" ? "cancelled" : undefined })
    .eq("id", String(fd.get("id")));
  done();
}

export async function toggleDiligence(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("diligence_items").update({ is_done: fd.get("is_done") === "true" }).eq("id", String(fd.get("id")));
  done();
}

export async function checkConditionsNow() {
  const { supabase, ownerId } = await requireOwner();
  await evaluateConditions(await loadCtx(supabase, ownerId));
  done();
}

/** Runs the morning job steps that do not need outside services, for testing or catching up. */
export async function runTodaysJobs() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  await applyCategoryRules(supabase, ownerId);
  await detectAndSaveRecurring(supabase, ownerId, ctx.today);
  await generateRecurringTasks(ctx);
  await generatePipelineTasks(ctx);
  await generateFollowUps(ctx);
  await checkCommitments(ctx, false);
  await rolloverRegularTasks(ctx);
  await evaluateConditions(ctx);
  done();
}

export async function regeneratePlan() {
  const { supabase, ownerId } = await requireOwner();
  await buildMorningPlan(await loadCtx(supabase, ownerId), true);
  done();
}

export async function addTimeBlocks() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const inputs = await loadInputs(supabase);
  await createTimeBlocks(ctx, inputs.num);
  await scheduleReviewEvents(ctx);
  done();
}

export async function detectRecurringNow() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  await applyCategoryRules(supabase, ownerId);
  await detectAndSaveRecurring(supabase, ownerId, ctx.today);
  done();
}

export async function startReview(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const id = await ensureReview(ctx, String(fd.get("kind")) as ReviewKind);
  done(id ? `/accountability/reviews/${id}` : "/accountability/reviews");
}

/** The review to open for a kind (today's daily close, the latest weekly review, ...), drafted now when there is none. */
export async function openReviewId(kind: string): Promise<string | null> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return (await ensureReview(ctx, kind as ReviewKind)) ?? null;
}

export async function saveReview(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const answers: Row = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("a_")) continue;
    const key = k.slice(2);
    if (answers[key] !== undefined) answers[key] = [].concat(answers[key], v as never);
    else answers[key] = String(v);
  }
  const complete = fd.get("complete") === "1";
  const { data: review } = await supabase.from("reviews").select("*").eq("id", id).single();
  if (!review) return;
  if (complete && review.kind === "daily") {
    // Regular tasks not done need no reason (they move to tomorrow). Each missed commitment and each missed
    // daily target needs a reason: its own, or the shared reason when it is checked.
    const ctx = await loadCtx(supabase, ownerId);
    const day = review.period_start as string;
    const [commitmentsDue, targets] = await Promise.all([dailyCloseCommitments(ctx, day), dailyCloseTargets(ctx, day)]);
    const missedTargets = targets.targets.filter((t) => t.status === "missed");
    const items: CloseMiss[] = [
      ...commitmentsDue.map((c) => ({ key: `c_${c.id}`, label: c.title, existingReason: c.reason })),
      ...missedTargets.map((t) => ({ key: `t_${t.id}`, label: t.name, existingReason: answers[`target_reason_${t.id}`] ?? t.reason })),
    ];
    const { reasons, missing } = resolveCloseReasons(items, answers);
    if (missing.length) {
      // Keep what was typed, and show which items still need a reason.
      await supabase.from("reviews").update({ answers }).eq("id", id);
      revalidatePath("/", "layout");
      // The form (ReviewForm) keeps what was typed and shows ?missing= on the same page or in the same window.
      return { ok: false as const, error: "A reason is missing.", missing: missing.map((m) => m.label).join("|") };
    }
    // Completing the close completes its own task first, so it is never counted as missed.
    await supabase.from("tasks").update({ status: "done" }).eq("owner_id", ownerId).eq("title", "Complete the daily close").eq("status", "todo").lte("due_date", day);
    // The day is over: commitments still open are recorded as missed, then each miss gets its reason.
    if (commitmentsDue.some((c) => c.status === "open")) await checkCommitments(ctx, day >= ctx.today);
    for (const c of commitmentsDue) {
      const reason = reasons[`c_${c.id}`];
      const { data: updated } = await supabase.from("missed_commitments").update({ reason }).eq("commitment_id", c.id).eq("missed_on", day).select("id");
      if (!updated?.length) await supabase.from("missed_commitments").insert({ owner_id: ownerId, commitment_id: c.id, missed_on: day, reason, resolution: "pending" });
    }
    if (missedTargets.length) {
      await supabase.from("target_misses").upsert(
        missedTargets.map((t) => ({
          owner_id: ownerId,
          target_id: t.id,
          period_start: t.start,
          period_end: t.end,
          actual_count: t.count,
          required_count: t.required,
          reason: reasons[`t_${t.id}`],
        })),
        { onConflict: "target_id,period_start" },
      );
    }
    answers.misses_at_close = JSON.stringify(items.map((i) => ({ item: i.label, reason: reasons[i.key] })));
    answers.targets_at_close = JSON.stringify(targets.targets.map((t) => ({ name: t.name, count: t.count, required: t.required, status: t.status })));
    // Tomorrow's top 3 become high priority tasks due tomorrow
    const tomorrow = new Date(`${ctx.today}T12:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const t = tomorrow.toISOString().slice(0, 10);
    for (const k of ["top_1", "top_2", "top_3"]) {
      const title = String(answers[k] ?? "").trim();
      if (title) await supabase.from("tasks").insert({ owner_id: ownerId, title, due_date: t, priority: 1, source: "review", source_key: `review:${id}:${k}` });
    }
  }
  await supabase
    .from("reviews")
    .update({ answers, status: complete ? "completed" : review.status, completed_at: complete ? new Date().toISOString() : review.completed_at })
    .eq("id", id);
  if (complete) {
    const kindTitle: Record<string, string> = { daily: "Complete the daily close", weekly: "Complete the weekly review", monthly: "Complete the monthly review", quarterly: "Complete the quarterly review" };
    await supabase.from("tasks").update({ status: "done" }).eq("title", kindTitle[review.kind]).eq("status", "todo").lte("due_date", review.period_end > review.period_start ? new Date().toISOString().slice(0, 10) : review.period_end);
    await checkCommitments(await loadCtx(supabase, ownerId), false);
  }
  done();
}

/**
 * Weekly review: a regular task moved to the next day many times is done, rescheduled (times moved starts
 * again from 0), or deleted. No reason is needed.
 */
export async function handleMovedTask(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("task_id"));
  const op = String(fd.get("op"));
  if (op === "done") await supabase.from("tasks").update({ status: "done" }).eq("id", id);
  else if (op === "delete") await supabase.from("tasks").delete().eq("id", id);
  else if (op === "reschedule") {
    const date = String(fd.get("due_date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a new date.");
    await supabase.from("tasks").update({ due_date: date, times_moved: 0 }).eq("id", id);
  }
  if (op === "done") await checkCommitments(await loadCtx(supabase, ownerId), false);
  done();
}

// Partners
export async function createPartnerLink(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const partnerId = String(fd.get("partner_id"));
  const days = Number(fd.get("expires_days") ?? 0);
  const token = randomToken(24);
  await supabase.from("partner_links").insert({
    owner_id: ownerId,
    partner_id: partnerId,
    token_hash: sha256(token),
    token_encrypted: env.tokenEncryptionKey ? encrypt(token) : null,
    label: String(fd.get("label") ?? "") || null,
    expires_at: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
  });
  revalidatePath("/", "layout");
  redirect(`${String(fd.get("back") ?? `/records/partners/${partnerId}`)}?new_link=${encodeURIComponent(token)}`);
}

export async function revokePartnerLink(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("partner_links").update({ revoked_at: new Date().toISOString() }).eq("id", String(fd.get("id")));
  done();
}

export async function createReportNow(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const { data: partner } = await supabase.from("partners").select("*").eq("id", String(fd.get("partner_id"))).single();
  if (!partner) return;
  const id = await createPartnerReport(ctx, partner);
  done(id ? `/accountability/reports/${id}` : undefined);
}

export async function saveReportSummary(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("partner_reports").update({ summary: String(fd.get("summary") ?? ""), summary_source: "owner" }).eq("id", String(fd.get("id"))).eq("status", "draft");
  done();
}

/** Finalizes the report (it never changes after this) and creates the Gmail draft when email delivery is chosen. */
export async function finalizeReport(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const summary = String(fd.get("summary") ?? "");
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", id).single();
  if (!report || report.status !== "draft") return;
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).single();
  await supabase.from("partner_reports").update({ summary, summary_source: summary === report.summary ? report.summary_source : "owner" }).eq("id", id);
  await supabase.from("partner_reports").update({ status: "finalized", finalized_at: new Date().toISOString() }).eq("id", id);
  const delivered: string[] = [];
  let gmailId: string | null = null;
  if (partner?.delivery_methods?.includes("email") && partner.email) {
    const link = await activeLinkFor({ sb: supabase }, partner.id);
    const text = reportText(partner, { ...report, summary }, link, "email");
    try {
      gmailId = await createGmailDraft(supabase, ownerId, { to: partner.email, subject: text.subject, body: text.body });
      if (gmailId) delivered.push("gmail_draft");
    } catch {
      gmailId = null;
    }
  }
  await supabase.from("partner_reports").update({ delivered_via: delivered, gmail_draft_id: gmailId }).eq("id", id);
  await supabase.from("tasks").update({ status: "done" }).eq("source_key", `partner-report:${id}`);
  done();
}

export async function createGmailDraftForReport(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", id).single();
  if (!report) return;
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).single();
  if (!partner?.email) throw new Error("Add an email address to the accountability partner first.");
  const link = await activeLinkFor({ sb: supabase }, partner.id);
  const text = reportText(partner, report, link, "email");
  const gmailId = await createGmailDraft(supabase, ownerId, { to: partner.email, subject: text.subject, body: text.body });
  if (!gmailId) throw new Error("Google is not connected. Connect Google in Settings.");
  await supabase.from("partner_reports").update({ gmail_draft_id: gmailId, delivered_via: [...new Set([...(report.delivered_via ?? []), "gmail_draft"])] }).eq("id", id);
  done();
}

export async function updateInput(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("id"));
  const raw = String(fd.get("value") ?? "").trim();
  const { data: input } = await supabase.from("inputs").select("unit").eq("id", id).single();
  if (!input) return;
  const isText = input.unit === "text" || input.unit === "date";
  if (!isText && raw !== "" && !Number.isFinite(Number(raw))) throw new Error("Enter a number.");
  await supabase
    .from("inputs")
    .update(isText ? { value_text: raw || null } : { value_number: raw === "" ? null : Number(raw) })
    .eq("id", id);
  await evaluateConditions(await loadCtx(supabase, ownerId));
  done();
}

/** Saves the numbers a scenario changes. Empty fields mean "use the current number". */
export async function saveScenarioOverrides(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const scenarioId = String(fd.get("scenario_id"));
  const rows: Row[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("ov:")) continue;
    const s = String(v).trim();
    if (s === "" || !Number.isFinite(Number(s))) continue;
    rows.push({ owner_id: ownerId, scenario_id: scenarioId, key: k.slice(3), value_number: Number(s) });
  }
  await supabase.from("scenario_input_changes").delete().eq("scenario_id", scenarioId);
  if (rows.length) await supabase.from("scenario_input_changes").insert(rows);
  done();
}

/** Copies the current inputs into a new scenario (no changes yet) and opens it. */
export async function createScenario(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const name = String(fd.get("name") ?? "").trim() || "New scenario";
  const kind = String(fd.get("kind") ?? "general");
  const { data } = await supabase.from("scenarios").insert({ owner_id: ownerId, name, kind, horizon_months: Number(fd.get("horizon_months") ?? 60) || 60 }).select("id").single();
  done(data ? `/plan/scenarios/${data.id}` : "/plan/scenarios");
}

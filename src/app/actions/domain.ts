"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions, markMilestoneMet } from "@/lib/engine/rules";
import { checkCommitments, generateFollowUps, generatePipelineTasks, generateRecurringTasks, createTimeBlocks, scheduleReviewEvents } from "@/lib/engine/tasks";
import { applyCategoryRules, detectAndSaveRecurring } from "@/lib/engine/finance-jobs";
import { buildMorningPlan } from "@/lib/engine/run";
import { dailyCloseTargets, ensureReview, type ReviewKind } from "@/lib/engine/reviews";
import { createPartnerReport, reportText, activeLinkFor } from "@/lib/engine/partners";
import { repaymentSchedule } from "@/lib/calc/savings";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { createGmailDraft } from "@/lib/google";
import { loadInputs } from "@/lib/finance";
import { env } from "@/lib/env";
import type { Row } from "@/lib/types";

const done = (path?: string) => {
  revalidatePath("/", "layout");
  if (path) redirect(path);
};

export async function moveStage(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const id = String(fd.get("item_id"));
  await supabase.from("pipeline_items").update({ stage_id: String(fd.get("stage_id")) }).eq("id", id);
  await evaluateConditions(await loadCtx(supabase, ownerId));
  done();
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
  await supabase
    .from("decisions")
    .update({ status: "decided", chosen_option_id: String(fd.get("option_id")), decided_on: ctx.today, outcome: String(fd.get("outcome") ?? "") || null })
    .eq("id", String(fd.get("decision_id")));
  await supabase.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("related_id", String(fd.get("decision_id"))).eq("status", "open");
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
    // Each task not done needs a reason
    const tasks = ((review.data_snapshot?.tasks ?? []) as Row[]).filter((t) => t.status !== "done");
    const { data: current } = tasks.length ? await supabase.from("tasks").select("id,status").in("id", tasks.map((t) => t.id)) : { data: [] };
    const stillOpen = ((current ?? []) as Row[]).filter((t) => t.status !== "done");
    const missing = stillOpen.filter((t) => !String(answers[`reason_${t.id}`] ?? "").trim());
    if (missing.length) throw new Error("Give a reason for each task not done before completing the daily close.");
    // Each daily target missed that day needs a one-line reason, saved on the missed period record.
    const tctx = await loadCtx(supabase, ownerId);
    const targets = await dailyCloseTargets(tctx, review.period_start);
    const missedTargets = targets.targets.filter((t) => t.status === "missed");
    const noReason = missedTargets.filter((t) => !String(answers[`target_reason_${t.id}`] ?? t.reason ?? "").trim());
    if (noReason.length) throw new Error("Give a one-line reason for each daily target missed before completing the daily close.");
    if (missedTargets.length) {
      await supabase.from("target_misses").upsert(
        missedTargets.map((t) => ({
          owner_id: ownerId,
          target_id: t.id,
          period_start: t.start,
          period_end: t.end,
          actual_count: t.count,
          required_count: t.required,
          reason: String(answers[`target_reason_${t.id}`] ?? t.reason ?? "").trim().slice(0, 200),
        })),
        { onConflict: "target_id,period_start" },
      );
    }
    answers.targets_at_close = JSON.stringify(targets.targets.map((t) => ({ name: t.name, count: t.count, required: t.required, status: t.status })));
    // Tomorrow's top 3 become high priority tasks due tomorrow
    const ctx = await loadCtx(supabase, ownerId);
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

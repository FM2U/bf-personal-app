"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { checkCommitments } from "@/lib/engine/tasks";
import { ensureReview } from "@/lib/engine/reviews";
import { draftDailyPartnerReports, refreshDailyPartnerReports } from "@/lib/engine/partners";
import { addDaysISO, isWeekday } from "@/lib/calc/dates";
import { changesStepProblem, isOutcomeStatus, OUTCOME_SLOTS, parseBlockMinutes, parseFocusedHours, type CloseStep, type OutcomeStatus } from "@/lib/calc/today";
import { DB_UPDATE_NOTICE_0019, isMissingSchemaError } from "@/lib/schema-guard";
import { hasUpdate0019 } from "@/lib/update-0019";
import type { Row } from "@/lib/types";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0019 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

/**
 * Today: the outcomes, the focused hours, the +1 on activity (src/app/actions/targets.ts), and Close the day
 * (a 3-step flow at /today/close that stores into reviews, kind daily, so the partner report and the old review page
 * keep working). Everything saves as it goes. Nothing here revalidates while the owner types: the Today page
 * re-reads on the next load, and the outcomes keep their own state in the browser.
 */

export type OutcomeInput = { position: number; title: string; initiativeId: string | null; pipelineItemId: string | null; taskId: string | null; blockMinutes: number | string | null };

/** Saves one outcome row for today (insert or update by position). An empty title deletes the row. */
export async function saveOutcome(input: OutcomeInput): Promise<{ ok: true; id: string | null } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const position = Number(input.position);
  if (!(OUTCOME_SLOTS as readonly number[]).includes(position)) return fail("Choose outcome 1, 2, or 3.");
  const ctx = await loadCtx(supabase, ownerId);
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const { data: existing } = await supabase.from("daily_outcomes").select("id").eq("owner_id", ownerId).eq("plan_date", ctx.today).eq("position", position).maybeSingle();
  if (!title) {
    if (existing) {
      const { error } = await supabase.from("daily_outcomes").delete().eq("id", existing.id);
      if (error) return notSaved(error);
    }
    return { ok: true, id: null };
  }
  const row: Row = {
    owner_id: ownerId,
    plan_date: ctx.today,
    position,
    title,
    initiative_id: idOrNull(input.initiativeId),
    pipeline_item_id: idOrNull(input.pipelineItemId),
    task_id: idOrNull(input.taskId),
    block_minutes: typeof input.blockMinutes === "number" ? Math.max(0, Math.min(1440, Math.round(input.blockMinutes))) : parseBlockMinutes(input.blockMinutes),
  };
  const { data, error } = await supabase.from("daily_outcomes").upsert(row, { onConflict: "owner_id,plan_date,position" }).select("id").single();
  if (error) return notSaved(error);
  return { ok: true, id: String(data.id) };
}

/** Saves the focused hours for today (an empty value clears them). The daily plan row is created when there is none. */
export async function saveFocusedHours(value: string): Promise<{ ok: true; hours: number | null } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const hours = parseFocusedHours(value);
  const r = await upsertPlan(supabase, ownerId, ctx.today, { focused_hours: hours });
  if (!r.ok) return r;
  return { ok: true, hours };
}

/** Writes fields on today's daily plan (daily_plans has one row per day; the morning plan text stays). */
async function upsertPlan(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], ownerId: string, day: string, fields: Row): Promise<{ ok: true } | Fail> {
  const { data: plan } = await sb.from("daily_plans").select("id").eq("owner_id", ownerId).eq("plan_date", day).maybeSingle();
  const { error } = plan
    ? await sb.from("daily_plans").update(fields).eq("id", plan.id)
    : await sb.from("daily_plans").insert({ owner_id: ownerId, plan_date: day, content: "", generated_by: "template", ...fields });
  if (error) return notSaved(error);
  return { ok: true };
}

/** Who a task waits on, and since when. Empty clears both. */
export async function setTaskWaiting(taskId: string, who: string, since: string): Promise<{ ok: true } | Fail> {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0019(supabase))) return fail(DB_UPDATE_NOTICE_0019);
  const w = String(who ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const s = /^\d{4}-\d{2}-\d{2}$/.test(String(since ?? "")) ? String(since) : null;
  const { error } = await supabase.from("tasks").update({ waiting_on: w || null, waiting_since: w ? s : null }).eq("id", taskId);
  if (error) return notSaved(error);
  return { ok: true };
}

// ---------- Close the day ----------

/** Today's daily close review (drafted when there is none), with the saved step. */
async function todaysReview(ctx: Awaited<ReturnType<typeof loadCtx>>): Promise<Row | null> {
  const id = await ensureReview(ctx, "daily");
  if (!id) return null;
  const { data } = await ctx.sb.from("reviews").select("*").eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

async function saveStep(ctx: Awaited<ReturnType<typeof loadCtx>>, review: Row, step: CloseStep, extra: Row = {}) {
  const answers = { ...((review.answers ?? {}) as Row), ...extra, close_version: "focused", close_step: step };
  await ctx.sb.from("reviews").update({ answers }).eq("id", review.id);
}

/** Opens Close the day at the saved step (the review is drafted first when there is none). */
export async function startClose(): Promise<never> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const review = await todaysReview(ctx);
  const step = Number((review?.answers as Row | undefined)?.close_step);
  redirect(`/today/close?step=${step === 2 || step === 3 ? step : 1}`);
}

/** Step 1: one outcome's status, result line, and actual minutes (saved as they change). */
export async function saveOutcomeClose(input: { id: string; status: string; resultNote: string; actualMinutes: string | number | null }): Promise<{ ok: true } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const status: OutcomeStatus = isOutcomeStatus(input.status) ? input.status : "planned";
  const actual = input.actualMinutes === null || input.actualMinutes === undefined || input.actualMinutes === "" ? null : typeof input.actualMinutes === "number" ? Math.max(0, Math.min(1440, Math.round(input.actualMinutes))) : parseBlockMinutes(String(input.actualMinutes));
  const { error } = await supabase
    .from("daily_outcomes")
    .update({ status, result_note: String(input.resultNote ?? "").trim().slice(0, 300) || null, actual_minutes: actual })
    .eq("id", String(input.id))
    .eq("owner_id", ownerId);
  if (error) return notSaved(error);
  return { ok: true };
}

/**
 * Step 1, Next: the day's commitments are checked now (a commitment due today that is not done becomes a miss, so
 * step 2 can resolve it), the daily close task is done, and the close moves to step 2.
 */
export async function finishOutcomesStep(): Promise<never> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const review = await todaysReview(ctx);
  if (!review) redirect("/today");
  // Completing the close completes its own task first, so it is never counted as missed.
  await supabase.from("tasks").update({ status: "done" }).eq("owner_id", ownerId).eq("title", "Complete the daily close").eq("status", "todo").lte("due_date", ctx.today);
  await checkCommitments(ctx, true);
  await saveStep(ctx, review, 2);
  revalidatePath("/", "layout");
  redirect("/today/close?step=2");
}

/** Step 2 fields, saved as they change (both are also saved by Next). */
export async function saveChangesStep(input: { changes: string; tomorrow: string }): Promise<{ ok: true } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return upsertPlan(supabase, ownerId, ctx.today, { changes_note: String(input.changes ?? "").trim().slice(0, 2000) || null, tomorrow_priority: String(input.tomorrow ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null });
}

/** Step 2, Next: tomorrow's priority is required; the daily reports are drafted (or refreshed) for step 3. */
export async function finishChangesStep(input: { changes: string; tomorrow: string }): Promise<Fail> {
  const problem = changesStepProblem(String(input.tomorrow ?? ""));
  if (problem) return fail(problem);
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const review = await todaysReview(ctx);
  if (!review) redirect("/today");
  const saved = await saveChangesStep(input);
  if (!saved.ok) return saved;
  await saveStep(ctx, review, 3, { changes: String(input.changes ?? "").trim(), tomorrow_priority: String(input.tomorrow ?? "").trim() });
  await draftDailyPartnerReports(ctx, ctx.today);
  await refreshDailyPartnerReports(ctx, ctx.today);
  revalidatePath("/", "layout");
  redirect("/today/close?step=3");
}

/** Back to an earlier step (the saved step moves back too, so returning later resumes there). */
export async function goToCloseStep(step: number): Promise<never> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const review = await todaysReview(ctx);
  const s: CloseStep = step === 2 ? 2 : step === 3 ? 3 : 1;
  if (review) await saveStep(ctx, review, s);
  redirect(`/today/close?step=${s}`);
}

/**
 * Step 3, Finish: the review is completed (status completed, as the old daily close did), tomorrow's top priority
 * becomes a high-priority task due tomorrow, commitments are checked again, and Today shows "Day closed".
 */
export async function finishClose(): Promise<never> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const review = await todaysReview(ctx);
  if (!review) redirect("/today");
  const { data: plan } = await supabase.from("daily_plans").select("tomorrow_priority").eq("owner_id", ownerId).eq("plan_date", ctx.today).maybeSingle();
  const tomorrow = String((plan as Row | null)?.tomorrow_priority ?? "").trim();
  if (tomorrow) {
    const key = `review:${review.id}:tomorrow`;
    const { data: existing } = await supabase.from("tasks").select("id,status").eq("owner_id", ownerId).eq("source_key", key).maybeSingle();
    if (existing) await supabase.from("tasks").update({ title: tomorrow, due_date: addDaysISO(ctx.today, 1) }).eq("id", existing.id);
    else await supabase.from("tasks").insert({ owner_id: ownerId, title: tomorrow, due_date: addDaysISO(ctx.today, 1), priority: 1, source: "review", source_key: key });
  }
  await supabase.from("tasks").update({ status: "done" }).eq("owner_id", ownerId).eq("title", "Complete the daily close").eq("status", "todo").lte("due_date", ctx.today);
  const answers = { ...((review.answers ?? {}) as Row), close_version: "focused", close_step: 3 };
  await supabase.from("reviews").update({ answers, status: "completed", completed_at: new Date().toISOString() }).eq("id", review.id);
  await checkCommitments(ctx, false);
  if (isWeekday(ctx.today)) await draftDailyPartnerReports(ctx, ctx.today);
  revalidatePath("/", "layout");
  redirect("/today?closed=1");
}

/** Reopen: the day is open again (the review goes back to draft at step 1). Nothing else changes. */
export async function reopenDay(): Promise<never> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const { data: review } = await supabase.from("reviews").select("*").eq("owner_id", ownerId).eq("kind", "daily").eq("period_start", ctx.today).maybeSingle();
  if (review) {
    const answers = { ...((review.answers ?? {}) as Row), close_version: "focused", close_step: 1 };
    await supabase.from("reviews").update({ answers, status: "draft", completed_at: null }).eq("id", review.id);
  }
  revalidatePath("/", "layout");
  redirect("/today");
}

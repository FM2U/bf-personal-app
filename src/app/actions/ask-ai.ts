"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, aiBudget, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { env, isAIConfigured } from "@/lib/env";
import { loadCtx, refreshNextActionAlert, type Ctx } from "@/lib/engine/helpers";
import { releaseSupersededNextActions } from "@/lib/engine/tasks";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { addPersonTask } from "@/app/actions/outreach";
import { addItemTask } from "@/app/actions/pipelines";
import { addProjectTask } from "@/app/actions/projects";
import { addTodo, suggestQuestions } from "@/app/actions/work";
import { answerPrompt, estimateCents, estimateLabel, fieldPrompt, isRecordPage, nextStepsPrompt, panelSpec, recordNoun, tasksPrompt, validateAnswerReply, validateFieldReply, validateNextStepsReply, type Answer, type AskContext, type NextStep } from "@/lib/work/ask-ai";
import { buildPageContext } from "@/lib/work/ask-ai-context";
import { loadWorkCtx, loadWorkNow, workUpdateNotice } from "@/lib/work/data";
import { loadAiOrder } from "@/lib/work/home-data";
import { actionKey, aiOrderPrompt, mergeLanes, validateAiOrderReply, type AiOrder, type HomeAction } from "@/lib/work/lanes";
import { orgRoleLine } from "@/lib/work/outreach";
import { loadPipelinesHome } from "@/lib/work/pipelines-data";
import { loadRosaraHome } from "@/lib/work/projects-data";
import { nextPersonalTodoPosition } from "@/lib/work/personal-todos";
import type { Row } from "@/lib/types";

/**
 * The Ask AI panel and the AI order on Home (batch B2). Every call goes through callForJson (callClaude with the
 * monthly cap) with a purpose per call: ask_next_steps, ask_page, ask_field, ai_order. The context sent is only the
 * page's records (src/lib/work/ask-ai-context.ts). Every action returns { ok: false, error } instead of throwing.
 */

type Fail = { ok: false; error: string; /** The AI's reply (first 300 characters) when it could not be used (shown with Try again). */ reply?: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const notice = await workUpdateNotice(supabase);
  if (notice) return fail(notice);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function aiError(e: unknown): Fail {
  if (e instanceof AIInvalidReply) return e.cutOff ? fail(AI_REPLY_CUT_OFF) : { ok: false, error: `${AI_REPLY_UNUSABLE} Try again.`, reply: replySnippet(e.reply) };
  return fail(e instanceof AIUnavailable ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
}

/** The app's price figures (per million tokens), or null when it has none (then no estimate is shown). */
function prices(): { input: number; output: number } | null {
  const input = Number(env.aiInputPricePerMTok);
  const output = Number(env.aiOutputPricePerMTok);
  return Number.isFinite(input) && Number.isFinite(output) && input > 0 && output > 0 ? { input, output } : null;
}

export type AskSetup = {
  ok: true;
  questions: string[];
  /** "about 1 cent" for one call with this page as context, or null when the app has no cost figures. */
  estimate: string | null;
  /** The panel offers suggestions (next steps on a record page, tasks or questions from a card star). */
  suggests: boolean;
  /** The AI is set up and under its cap (otherwise the reason). */
  ready: boolean;
  notReady: string | null;
};

/**
 * What the panel checks before any call: the cost estimate and whether the AI can be called. The panel's title,
 * questions, and sections come from panelSpec in the browser, so the panel opens at once and this fills in.
 */
export async function askAiSetup(c: AskContext): Promise<AskSetup | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  let notReady: string | null = null;
  if (!isAIConfigured()) notReady = "The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.";
  else {
    const budget = await aiBudget(sb, ctx.ownerId);
    if (budget.blocked) notReady = `The AI monthly cap of $${budget.cap.toFixed(2)} is reached. AI requests resume next month, or raise the cap in Settings.`;
  }
  const p = prices();
  let estimate: string | null = null;
  if (p) {
    const context = await buildPageContext(sb, ctx.ownerId, c).catch(() => ({ title: c.label, lines: [] as string[] }));
    const chars = context.title.length + context.lines.reduce((n, l) => n + l.length + 2, 0) + 600;
    estimate = estimateLabel(estimateCents(chars, 500, p.input, p.output));
  }
  const spec = panelSpec(c);
  return { ok: true, questions: spec.questions, estimate, suggests: !!spec.suggest, ready: !notReady, notReady };
}

/** Suggested next steps: up to three with a one-line reason, for a record page or for the card a star was pressed on. */
export async function suggestNextSteps(c: AskContext): Promise<{ ok: true; steps: NextStep[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const record = isRecordPage(c.page) && !!c.recordId && UUID.test(c.recordId);
  if (!record && !c.card) return fail("Suggested next steps are for one record (a deal, a person, a project, an opportunity, or a consulting item) or one card.");
  try {
    const context = await buildPageContext(sb, ctx.ownerId, c);
    if (!context.lines.length) return fail(record ? "This record was not found." : "Nothing on this card to read.");
    const steps = await callForJson<NextStep[]>({ sb, ownerId: ctx.ownerId, purpose: "ask_next_steps", prompt: nextStepsPrompt(context), maxTokens: 1500, shape: "items", validate: (v) => validateNextStepsReply(cleanDeep(v)) });
    return { ok: true, steps };
  } catch (e) {
    return aiError(e);
  }
}

/** "Suggest tasks for this deal" (the Tasks card star): up to three small tasks with a reason each; "Add as a task" adds one. */
export async function suggestTasks(c: AskContext): Promise<{ ok: true; steps: NextStep[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!isRecordPage(c.page) || !c.recordId || !UUID.test(c.recordId)) return fail("Suggested tasks are for one record (a deal, a person, a project, an opportunity, or a consulting item).");
  try {
    const context = await buildPageContext(sb, ctx.ownerId, { ...c, card: "Tasks" });
    if (!context.lines.length) return fail("This record was not found.");
    const steps = await callForJson<NextStep[]>({ sb, ownerId: ctx.ownerId, purpose: "ask_tasks", prompt: tasksPrompt(context, recordNoun(c.page)), maxTokens: 1200, shape: "items", validate: (v) => validateNextStepsReply(cleanDeep(v)) });
    return { ok: true, steps };
  } catch (e) {
    return aiError(e);
  }
}

/** "Add as a task" in the panel: the suggested line joins the record's Tasks card. */
export async function addTaskFromAi(c: AskContext, text: string): Promise<{ ok: true } | Fail> {
  const line = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const id = c.recordId ?? "";
  if (!line) return fail("Nothing to add.");
  if (!isRecordPage(c.page) || !UUID.test(id)) return fail("Tasks live on one record.");
  const r = c.page === "deal" ? await addTodo(id, line) : c.page === "person" ? await addPersonTask(id, line) : c.page === "project" ? await addProjectTask(id, line) : await addItemTask(c.page === "opportunity" ? "job" : "consulting", id, line);
  if (!r.ok) return fail(r.error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Suggest questions" in the panel (the Open questions card star): the deal's open questions grow by what the AI adds. */
export async function suggestQuestionsFromAi(c: AskContext): Promise<{ ok: true; added: number } | Fail> {
  const id = c.recordId ?? "";
  if (c.page !== "deal" || !UUID.test(id)) return fail("Open questions live on a deal.");
  const r = await suggestQuestions(id);
  if (!r.ok) return r;
  return { ok: true, added: r.added };
}

/** Ask about this page: the answer in short bullets, with an optional next action and an optional email draft. */
export async function askAboutPage(c: AskContext, question: string): Promise<{ ok: true; answer: Answer } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const q = String(question ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 3) return fail("Type a question first.");
  try {
    const context = await buildPageContext(sb, ctx.ownerId, c);
    const canEmail = ["deal", "person", "opportunity", "consulting_item", "outreach", "home"].includes(c.page);
    const answer = await callForJson<Answer>({ sb, ownerId: ctx.ownerId, purpose: "ask_page", prompt: answerPrompt(context, q, canEmail), maxTokens: 1800, shape: "items", validate: (v) => validateAnswerReply(cleanDeep(v)) });
    return { ok: true, answer };
  } catch (e) {
    return aiError(e);
  }
}

/** A field star: the AI writes the field's text ("Use this" fills the field). */
export async function draftField(c: AskContext): Promise<{ ok: true; text: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!c.field) return fail("No field to fill.");
  try {
    const context = await buildPageContext(sb, ctx.ownerId, c);
    const text = await callForJson<string>({ sb, ownerId: ctx.ownerId, purpose: "ask_field", prompt: fieldPrompt(context, c.field), maxTokens: c.field.key === "email_body" ? 1500 : 600, shape: "text", validate: (v) => validateFieldReply(cleanDeep(v)) });
    return { ok: true, text };
  } catch (e) {
    return aiError(e);
  }
}

/**
 * "Set as next action" and "Make this the next action": on a record page the text becomes that record's next action
 * (a person: what the next follow-up is for), due tomorrow unless the record already has a later date. On any other
 * page it becomes a personal to-do for today.
 */
export async function setNextActionFromAi(c: AskContext, text: string): Promise<{ ok: true; where: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const line = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!line) return fail("Nothing to set.");
  const id = c.recordId ?? "";
  const tomorrow = addDaysISO(ctx.today, 1);
  const notSaved = (e: { message?: string | null } | null) => fail(isMissingSchemaError(e) ? "Database update needed." : `Not saved: ${e?.message ?? "try again."}`);
  if (isRecordPage(c.page) && UUID.test(id)) {
    if (c.page === "person") {
      const { data } = await sb.from("contacts").select("id,follow_up_date").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
      if (!data) return fail("This person was not found.");
      const current = (data as Row).follow_up_date ? String((data as Row).follow_up_date).slice(0, 10) : null;
      const { error } = await sb.from("contacts").update({ follow_up_note: line, follow_up_date: current && current > ctx.today ? current : tomorrow }).eq("id", id);
      if (error) return notSaved(error);
      revalidatePath("/", "layout");
      return { ok: true, where: "the next follow-up" };
    }
    if (c.page === "project") {
      const { data } = await sb.from("projects").select("id,next_action_due").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
      if (!data) return fail("This project was not found.");
      const current = (data as Row).next_action_due ? String((data as Row).next_action_due).slice(0, 10) : null;
      const { error } = await sb.from("projects").update({ next_action: line, next_action_due: current && current > ctx.today ? current : tomorrow, next_action_minutes: null }).eq("id", id);
      if (error) return notSaved(error);
      revalidatePath("/", "layout");
      return { ok: true, where: "the next action" };
    }
    const { data } = await sb.from("pipeline_items").select("id,next_action_due").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
    if (!data) return fail("This record was not found.");
    const current = (data as Row).next_action_due ? String((data as Row).next_action_due).slice(0, 10) : null;
    const { error } = await sb.from("pipeline_items").update({ next_action: line, next_action_due: current && current > ctx.today ? current : tomorrow, next_action_minutes: null }).eq("id", id);
    if (error) return notSaved(error);
    await releaseSupersededNextActions(ctx, id).catch(() => null);
    await refreshNextActionAlert(ctx).catch(() => null);
    revalidatePath("/", "layout");
    return { ok: true, where: "the next action" };
  }
  const { data: rows } = await sb.from("todos").select("position").eq("owner_id", ctx.ownerId).is("done_at", null).limit(1000);
  const position = nextPersonalTodoPosition(((rows ?? []) as Row[]).map((r) => ({ position: Number(r.position ?? 0) })));
  const { error } = await sb.from("todos").insert({ owner_id: ctx.ownerId, text: line, due_on: ctx.today, position });
  if (error) return notSaved(error);
  revalidatePath("/", "layout");
  return { ok: true, where: "a to-do for today" };
}

// ---------- The AI order on Home ----------

/** The day's next actions (due today or earlier) across every lane, as the AI and the cache see them. */
async function todaysActions(sb: SupabaseClient, ownerId: string): Promise<{ actions: HomeAction[]; today: string }> {
  const wctx = await loadWorkCtx(sb, ownerId);
  const [now, rosara, pipes] = await Promise.all([loadWorkNow(sb, ownerId), loadRosaraHome(sb, wctx), loadPipelinesHome(sb, wctx)]);
  const all: HomeAction[] = [
    ...now.deals.map((d) => ({ key: actionKey("Deals", d.id), lane: "Deals" as const, id: d.id, name: d.name, action: d.nextAction, due: d.nextActionDue, minutes: d.nextActionMinutes, meta: [d.stageName, d.whatItDoes, d.location].filter(Boolean).join(", "), waitingOn: d.waitLevel !== "none" ? d.waitingOn : null, waitDays: d.waitDays, dayInStage: d.dayInStage })),
    ...now.outreach.due.map((p) => ({ key: actionKey("Outreach", p.id), lane: "Outreach" as const, id: p.id, name: p.name, action: p.followUpFor ?? "Follow up", due: p.nextFollowUp, minutes: null, meta: orgRoleLine(p) })),
    ...rosara.actions.map((p) => ({ key: actionKey("Rosara", p.id), lane: "Rosara" as const, id: p.id, name: p.name, action: p.nextAction, due: p.nextActionDue, minutes: p.nextActionMinutes, meta: p.milestone ?? "" })),
    ...pipes.jobs.map((i) => ({ key: actionKey("Job search", i.id), lane: "Job search" as const, id: i.id, name: i.name, action: i.nextAction, due: i.nextActionDue, minutes: i.nextActionMinutes, meta: [i.stageName, i.title, i.location].filter(Boolean).join(", "), waitingOn: i.waitLevel !== "none" ? i.waitingOn : null, waitDays: i.waitDays, dayInStage: i.dayInStage })),
    ...pipes.consulting.map((i) => ({ key: actionKey("Consulting", i.id), lane: "Consulting" as const, id: i.id, name: i.name, action: i.nextAction, due: i.nextActionDue, minutes: i.nextActionMinutes, meta: [i.stageName, i.title].filter(Boolean).join(", "), waitingOn: i.waitLevel !== "none" ? i.waitingOn : null, waitDays: i.waitDays, dayInStage: i.dayInStage })),
  ];
  const s = mergeLanes(all, wctx.today);
  return { actions: [...s.overdue, ...s.today], today: wctx.today };
}

/**
 * By the AI: the order of today's next actions with one reason per row. Asked once per day and kept in
 * ai_order_cache; "Order again" (force) asks again and replaces today's row.
 */
export async function aiOrderToday(force = false): Promise<{ ok: true; order: AiOrder; fresh: boolean } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!force) {
    const cached = await loadAiOrder(sb, ctx.ownerId, ctx.today);
    if (cached && cached.order.length) return { ok: true, order: cached, fresh: false };
  }
  const { actions, today } = await todaysActions(sb, ctx.ownerId);
  if (!actions.length) return fail("Nothing is due today, so there is nothing to order.");
  const keys = actions.map((a) => a.key);
  try {
    const result = await callForJson<{ order: string[]; reasons: Record<string, string> }>({ sb, ownerId: ctx.ownerId, purpose: "ai_order", prompt: aiOrderPrompt(actions, today), maxTokens: 2500, shape: "items", validate: (v) => validateAiOrderReply(cleanDeep(v), keys) });
    const createdAt = new Date().toISOString();
    const { error } = await sb.from("ai_order_cache").upsert({ owner_id: ctx.ownerId, for_date: today, ordered_ids: result.order, reasons: result.reasons, created_at: createdAt }, { onConflict: "owner_id,for_date" });
    if (error) return fail(`The order came back but was not saved: ${error.message}`);
    return { ok: true, order: { order: result.order, reasons: result.reasons, forDate: today, createdAt }, fresh: true };
  } catch (e) {
    return aiError(e);
  }
}

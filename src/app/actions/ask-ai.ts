"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, aiBudget, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { capWarning } from "@/lib/ai/spend";
import { isAIConfigured } from "@/lib/env";
import { loadCtx, refreshNextActionAlert, type Ctx } from "@/lib/engine/helpers";
import { releaseSupersededNextActions } from "@/lib/engine/tasks";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { addPersonTask } from "@/app/actions/outreach";
import { addItemTask } from "@/app/actions/pipelines";
import { addProjectTask } from "@/app/actions/projects";
import { addTodo, suggestQuestions } from "@/app/actions/work";
import { answerDueDate, answerPrompt, fieldPrompt, isRecordPage, keyFindingPrompt, nextActionPrompt, nextStepsPrompt, panelSpec, recordNoun, setNextActionNote, tasksPrompt, validateAnswerReply, validateFieldReply, validateKeyFindingReply, validateNextActionReply, validateNextStepsReply, type Answer, type AskContext, type KeyFindingDraft, type NextActionSuggestion, type NextStep } from "@/lib/work/ask-ai";
import { buildPageContext } from "@/lib/work/ask-ai-context";
import { loadWorkCtx, loadWorkNow, workUpdateNotice } from "@/lib/work/data";
import { loadAiOrder } from "@/lib/work/home-data";
import { actionKey, aiOrderPrompt, mergeLanes, validateAiOrderReply, type AiOrder, type HomeAction } from "@/lib/work/lanes";
import { orgRoleLine } from "@/lib/work/outreach";
import { loadPipelinesHome } from "@/lib/work/pipelines-data";
import { loadRosaraHome } from "@/lib/work/projects-data";
import { nextPersonalTodoPosition } from "@/lib/work/personal-todos";
import { loadHomeTodos } from "@/lib/work/personal-todos-data";
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

export type AskSetup = {
  ok: true;
  questions: string[];
  /** The quiet amber line when the month's AI spend is within 10% of the cap (Edit batch C, item 13), or null. */
  capWarning: string | null;
  /** The panel offers suggestions (next steps on a record page, tasks or questions from a card star). */
  suggests: boolean;
  /** The AI is set up and under its cap (otherwise the reason). */
  ready: boolean;
  notReady: string | null;
};

/**
 * What the panel checks before any call: whether the AI can be called, and the spend warning near the monthly cap
 * (Edit batch C: no cost line per call; the month's spend is in Settings). The panel's title, questions, and sections
 * come from panelSpec in the browser, so the panel opens at once and this fills in.
 */
export async function askAiSetup(c: AskContext): Promise<AskSetup | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  let notReady: string | null = null;
  let warning: string | null = null;
  if (!isAIConfigured()) notReady = "The AI is not set up yet. Add ANTHROPIC_API_KEY in Vercel.";
  else {
    const budget = await aiBudget(sb, ctx.ownerId);
    if (budget.blocked) notReady = `The AI monthly cap of $${budget.cap.toFixed(2)} is reached. AI requests resume next month, or raise the cap in Settings.`;
    else warning = capWarning(budget.spent, budget.cap);
  }
  const spec = panelSpec(c);
  return { ok: true, questions: spec.questions, capWarning: warning, suggests: !!spec.suggest, ready: !notReady, notReady };
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

/**
 * The next action star (Edit batch C round 2, item 3): one next action and its due date (minutes when it is a block of
 * work) for a deal, a project, an opportunity, or a consulting item; for a person, what the next follow-up is for and
 * its date. Read from the stage, the stage's default, the recent timeline, and the open tasks; "Use this" fills the
 * card's fields in the browser (nothing is saved until Save). Through callForJson, so a reply cut off by the length
 * limit is asked again with double the limit.
 */
export async function suggestNextAction(c: AskContext): Promise<{ ok: true; suggestion: NextActionSuggestion } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!isRecordPage(c.page) || !c.recordId || !UUID.test(c.recordId)) return fail("A suggested next action is for one record (a deal, a person, a project, an opportunity, or a consulting item).");
  const kind = c.page === "person" ? "follow_up" : "action";
  try {
    const context = await buildPageContext(sb, ctx.ownerId, { ...c, card: kind === "follow_up" ? "Next follow-up" : "Next action" });
    if (!context.lines.length) return fail("This record was not found.");
    const suggestion = await callForJson<NextActionSuggestion>({ sb, ownerId: ctx.ownerId, purpose: "ask_next_action", prompt: nextActionPrompt(context, ctx.today, kind, recordNoun(c.page)), maxTokens: 800, shape: "none", validate: (v) => validateNextActionReply(cleanDeep(v), ctx.today, kind) });
    return { ok: true, suggestion };
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
 * The Key finding star (AI instructions, approved 2026-11-02): Strengths, Risks, the Key finding, and Check with the
 * broker in one reply, from the buyer instructions with the deal's stage line and every fact. Through callForJson
 * (a reply cut off by the length limit is asked again with double the limit; a reply that fails the check is asked
 * again once). "Use this" fills the Findings card in the browser; nothing is saved until the card's Save.
 */
export async function draftKeyFinding(c: AskContext): Promise<{ ok: true; draft: KeyFindingDraft } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (c.page !== "deal" || !c.recordId || !UUID.test(c.recordId)) return fail("The key finding is written on one deal or listing.");
  try {
    const context = await buildPageContext(sb, ctx.ownerId, { ...c, card: null, field: { key: "key_finding", label: "Key finding", current: c.field?.current ?? null } });
    if (!context.lines.length) return fail("This deal was not found.");
    const draft = await callForJson<KeyFindingDraft>({ sb, ownerId: ctx.ownerId, purpose: "ask_key_finding", prompt: keyFindingPrompt(context), maxTokens: 1500, shape: "none", validate: (v) => validateKeyFindingReply(cleanDeep(v)) });
    return { ok: true, draft };
  } catch (e) {
    return aiError(e);
  }
}

/**
 * "Set next action: <action>" under an answer (AI instructions, 2026-11-02): on a record page the action becomes that
 * record's next action (a person: what the next follow-up is for), due on the date the answer gives (today or later)
 * or tomorrow; "Next action set". On any other page it becomes a to-do for today; "Added to To-dos for today".
 */
export async function setNextActionFromAnswer(c: AskContext, text: string, due: string | null): Promise<{ ok: true; note: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const r = await setNextActionFromAi(c, text, { due: answerDueDate(due, s.ctx.today) });
  if (!r.ok) return r;
  return { ok: true, note: setNextActionNote(r.where === "a to-do for today" ? "todo" : r.where === "the next follow-up" ? "person" : "record") };
}

/**
 * "Set as next action" and "Make this the next action": on a record page the text becomes that record's next action
 * (a person: what the next follow-up is for), due tomorrow unless the record already has a later date. On any other
 * page it becomes a personal to-do for today.
 */
export async function setNextActionFromAi(c: AskContext, text: string, opts?: { /** The due date to use (an answer's date or tomorrow) in place of the rule above. */ due?: string | null }): Promise<{ ok: true; where: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const line = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!line) return fail("Nothing to set.");
  const id = c.recordId ?? "";
  const tomorrow = addDaysISO(ctx.today, 1);
  const forced = opts?.due && /^\d{4}-\d{2}-\d{2}$/.test(opts.due) ? opts.due : null;
  const dueFor = (current: string | null) => forced ?? (current && current > ctx.today ? current : tomorrow);
  const notSaved = (e: { message?: string | null } | null) => fail(isMissingSchemaError(e) ? "Database update needed." : `Not saved: ${e?.message ?? "try again."}`);
  if (isRecordPage(c.page) && UUID.test(id)) {
    if (c.page === "person") {
      const { data } = await sb.from("contacts").select("id,follow_up_date").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
      if (!data) return fail("This person was not found.");
      const current = (data as Row).follow_up_date ? String((data as Row).follow_up_date).slice(0, 10) : null;
      const { error } = await sb.from("contacts").update({ follow_up_note: line, follow_up_date: dueFor(current) }).eq("id", id);
      if (error) return notSaved(error);
      revalidatePath("/", "layout");
      return { ok: true, where: "the next follow-up" };
    }
    if (c.page === "project") {
      const { data } = await sb.from("projects").select("id,next_action_due").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
      if (!data) return fail("This project was not found.");
      const current = (data as Row).next_action_due ? String((data as Row).next_action_due).slice(0, 10) : null;
      const { error } = await sb.from("projects").update({ next_action: line, next_action_due: dueFor(current), next_action_minutes: null }).eq("id", id);
      if (error) return notSaved(error);
      revalidatePath("/", "layout");
      return { ok: true, where: "the next action" };
    }
    const { data } = await sb.from("pipeline_items").select("id,next_action_due").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
    if (!data) return fail("This record was not found.");
    const current = (data as Row).next_action_due ? String((data as Row).next_action_due).slice(0, 10) : null;
    const { error } = await sb.from("pipeline_items").update({ next_action: line, next_action_due: dueFor(current), next_action_minutes: null }).eq("id", id);
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
  const [now, rosara, pipes, todos] = await Promise.all([loadWorkNow(sb, ownerId), loadRosaraHome(sb, wctx), loadPipelinesHome(sb, wctx), loadHomeTodos(sb, wctx)]);
  const all: HomeAction[] = [
    ...now.deals.map((d) => ({ key: actionKey("Deals", d.id), lane: "Deals" as const, id: d.id, name: d.name, action: d.nextAction, due: d.nextActionDue, minutes: d.nextActionMinutes, meta: [d.stageName, d.whatItDoes, d.location].filter(Boolean).join(", "), waitingOn: d.waitLevel !== "none" ? d.waitingOn : null, waitDays: d.waitDays, dayInStage: d.dayInStage })),
    ...now.outreach.due.map((p) => ({ key: actionKey("Outreach", p.id), lane: "Outreach" as const, id: p.id, name: p.name, action: p.followUpFor ?? "Follow up", due: p.nextFollowUp, minutes: null, meta: orgRoleLine(p) })),
    ...rosara.actions.map((p) => ({ key: actionKey("Rosara", p.id), lane: "Rosara" as const, id: p.id, name: p.name, action: p.nextAction, due: p.nextActionDue, minutes: p.nextActionMinutes, meta: p.milestone ?? "" })),
    ...pipes.jobs.map((i) => ({ key: actionKey("Job search", i.id), lane: "Job search" as const, id: i.id, name: i.name, action: i.nextAction, due: i.nextActionDue, minutes: i.nextActionMinutes, meta: [i.stageName, i.title, i.location].filter(Boolean).join(", "), waitingOn: i.waitLevel !== "none" ? i.waitingOn : null, waitDays: i.waitDays, dayInStage: i.dayInStage })),
    // Edit batch C round 2: the personal to-dos due today or earlier, like any other row.
    ...todos.map((t) => ({ key: actionKey("To-dos", t.id), lane: "To-dos" as const, id: t.id, name: t.text, action: t.text, due: t.dueOn, minutes: null, meta: "Personal to-do" })),
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

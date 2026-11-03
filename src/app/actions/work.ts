"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { recordWorkEvent } from "@/lib/accountability/events";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { date as fmtDate } from "@/lib/format";
import { missingForStage } from "@/lib/pipeline";
import { DB_UPDATE_NOTICE_0021, DB_UPDATE_NOTICE_0027, DB_UPDATE_NOTICE_0028, DB_UPDATE_NOTICE_0029, isMissingSchemaError } from "@/lib/schema-guard";
import { isDealFinancing, type DealFinancing } from "@/lib/ai/instructions";
import { checkBuyBox, dealSourceTypeFor, isPassReason, LISTING_SOURCES, parseMoneyText } from "@/lib/work/buy-box";
import { firstUrl, listingNumbers, listingTextToSave, listingPrompt, validateListingReply, withListingUrl, yearOf, type ListingFields } from "@/lib/work/listing-text";
import { loadWorkPipeline, type WorkPipeline } from "@/lib/work/data";
import { dealFactsFromRow, parseFindingList } from "@/lib/work/deal-facts";
import { loadBuyBoxSettings } from "@/lib/work/buy-box-data";
import { cleanQuestions, countQuestions, mergeQuestions, parseOpenQuestions, questionsPrompt, TODO_MAX_LENGTH, todosPrompt, validateQuestionsReply, validateTodosReply, type DealContext, type QuestionGroups } from "@/lib/work/questions";
import { nextTodoPosition, openTodos, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * The Work module's saves (batch A and Edit batch A). Every action returns { ok: false, error } instead of throwing,
 * so what the owner typed stays on the screen with the message. Pages re-read on the next load (router.refresh in
 * the component). The AI parts (Fill from text, Suggest questions, Suggest tasks) go through callForJson with the
 * shared reply reader (Edit batch B): a plain-text reply is read as one text or as lines; when the reply still
 * cannot be used after one retry, the action returns the error with the reply's first 300 characters (`reply`) so
 * the screen can show it with Try again.
 */

type Fail = { ok: false; error: string; /** The AI's reply (first 300 characters) when it could not be used. */ reply?: string };
const fail = (error: string): Fail => ({ ok: false, error });
/** The error of an AI call: the cap or setup message, or the unusable reply with its text. */
const aiFail = (e: unknown): Fail => {
  if (e instanceof AIInvalidReply) return e.cutOff ? { ok: false, error: AI_REPLY_CUT_OFF } : { ok: false, error: `${AI_REPLY_UNUSABLE} Try again.`, reply: replySnippet(e.reply) };
  return fail(e instanceof AIUnavailable ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
};
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0021 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx; pipe: WorkPipeline } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const notice = null;
  if (notice) return fail(notice);
  const pipe = await loadWorkPipeline(supabase, ownerId);
  if (!pipe) return fail("There is no acquisition pipeline. Add one under More, Pipelines.");
  const ctx = await loadCtx(supabase, ownerId);
  return { sb: supabase, ctx, pipe };
}

async function dealOf(sb: SupabaseClient, ctx: Ctx, pipe: WorkPipeline, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This deal was not found.");
  const { data } = await sb.from("pipeline_items").select("*").eq("owner_id", ctx.ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  return (data as Row | null) ?? fail("This deal was not found. It may have been deleted.");
}

const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

/** True when a pipeline_items row read with "*" has the columns of database update 0027 (listing_text, year_established, employees). */
const has0027 = (item: Row) => Object.prototype.hasOwnProperty.call(item, "listing_text");

/** True when a pipeline_items row read with "*" has the columns of database update 0028 (strengths, risks). */
const has0028 = (item: Row) => Object.prototype.hasOwnProperty.call(item, "strengths");

/** True when a pipeline_items row read with "*" has the columns of database update 0029 (growth_paths, financing). */
const has0029 = (item: Row) => Object.prototype.hasOwnProperty.call(item, "growth_paths");

function done() {
  revalidatePath("/", "layout");
}

/**
 * The inline actions (Pass, Interested, Done, Later, Follow up) do not revalidate here: a revalidation would re-render
 * the list in the same round trip and remove the row before its confirmation line is seen. The row shows the line,
 * then refreshes the page itself (router.refresh).
 */
function doneQuietly() {}

// ---------- Screen listings ----------

/**
 * "Fill from text": the pasted listing text goes to the AI; the fields come back for the owner to correct. When the
 * reply is not the expected JSON the AI is asked once more with the problems listed; when it still fails, the first
 * 300 characters of its reply come back with the error so the owner sees why.
 */
export async function fillListingFromText(text: string): Promise<{ ok: true; fields: ListingFields } | (Fail & { reply?: string })> {
  const { supabase, ownerId } = await requireOwner();
  const body = String(text ?? "").trim();
  if (body.length < 20) return fail("Paste the listing text first (the broker email or the page), then press Fill from text.");
  try {
    const fields = await callForJson<ListingFields>({ sb: supabase, ownerId, purpose: "listing_fields", prompt: listingPrompt(body), maxTokens: 1000, validate: (v) => validateListingReply(cleanDeep(v)) });
    // Edit batch C round 3: the first web address in the text goes into the link when the AI left it empty.
    return { ok: true, fields: withListingUrl(fields, body) };
  } catch (e) {
    if (e instanceof AIInvalidReply) return e.cutOff ? { ok: false, error: AI_REPLY_CUT_OFF } : { ok: false, error: "The AI answered, but not with the fields. Fill them in by hand, or try again.", reply: replySnippet(e.reply) };
    const why = e instanceof AIUnavailable ? e.message : "The AI request failed.";
    return fail(`${why} Fill the fields in by hand.`);
  }
}

/**
 * Save to the list: a new listing (a pipeline item with screened = false and no stage) and its numbers. Fix 2026-11-02:
 * the pasted text (when the paste box holds any at save) is kept on the record as its original listing text, with why
 * selling, year established, and employees. Before database update 0027 the listing saves without the text, the year,
 * and the employees, and `notice` says so.
 */
export async function createListing(input: ListingFields, pastedText = ""): Promise<{ ok: true; id: string; notice?: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const name = clean(input.name, 200);
  if (!name) return fail("Give the listing a name.");
  const source = (LISTING_SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : "Other";
  const numbers = listingNumbers(input);
  const row: Row = {
    owner_id: ctx.ownerId,
    pipeline_id: pipe.id,
    stage_id: null,
    name,
    company_name: clean(input.company_name, 200),
    screened: false,
    source,
    deal_source_type: dealSourceTypeFor(source),
    what_it_does: clean(input.what_it_does, 300),
    broker_name: clean(input.broker_name, 200),
    location: clean(input.location, 120),
    industry: clean(input.industry, 120),
    listing_url: clean(input.listing_url, 500),
    why_selling: clean(input.why_selling, 300),
  };
  // The note keeps the check as it was when the listing was saved (the pill itself reads the Buy box settings on every load).
  row.buy_box_note = checkBuyBox({ name, whatItDoes: row.what_it_does, industry: row.industry, location: row.location, ebitda: numbers.ebitda, sde: numbers.sde }, await loadBuyBoxSettings(sb, ctx.ownerId)).label;
  const text = listingTextToSave(pastedText);
  const year = yearOf(input.year_established);
  const extra: Row = { listing_text: text, year_established: year ? Number(year) : null, employees: clean(input.employees, 120) };
  let notice: string | undefined;
  let { data, error } = await sb.from("pipeline_items").insert({ ...row, ...extra }).select("id").single();
  if (error && isMissingSchemaError(error)) {
    // Before database update 0027: saved without the text, the year, and the employees.
    ({ data, error } = await sb.from("pipeline_items").insert(row).select("id").single());
    if (!error && (text || year || extra.employees)) notice = DB_UPDATE_NOTICE_0027;
  }
  if (error || !data) return notSaved(error);
  const id = String(data.id);
  if (numbers.revenue !== null || numbers.ebitda !== null || numbers.sde !== null || numbers.asking_price !== null) {
    const { error: e2 } = await sb.from("deal_financials").insert({ owner_id: ctx.ownerId, item_id: id, revenue: numbers.revenue, ebitda: numbers.ebitda, sde: numbers.sde, asking_price: numbers.asking_price });
    if (e2) return fail(`The listing was saved, but its numbers were not: ${e2.message}. Open the deal to add them.`);
  }
  done();
  return notice ? { ok: true, id, notice } : { ok: true, id };
}

/** Pass (a listing or a deal): the reason is kept, the item goes to Passed and counts as screened. */
export async function passDeal(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!isPassReason(reason)) return fail("Choose one of the pass reasons.");
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const passed = pipe.byName.Passed;
  if (!passed) return fail('The acquisition pipeline has no "Passed" stage. Run the database update again.');
  const { error } = await sb.from("pipeline_items").update({ stage_id: passed.id, pass_reason: reason, screened: true, waiting_on: null, waiting_since: null }).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true };
}

/**
 * Interested: the listing becomes a deal at Interested; the stage's default next action is set, due tomorrow. Then
 * the AI fills the open questions (silently: when that fails the card shows "Suggest questions" to try again).
 */
export async function markInterested(id: string): Promise<{ ok: true; nextAction: string | null; due: string | null; questions: number } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const stage = pipe.byName.Interested;
  if (!stage) return fail('The acquisition pipeline has no "Interested" stage. Run the database update again.');
  const title = stage.defaultTitle ?? "Sign the NDA and ask the broker for a call";
  const due = addDaysISO(ctx.today, stage.defaultDueInDays ?? 1);
  // The next action is written here too (the stage trigger sets the same values when it is empty).
  const { error } = await sb.from("pipeline_items").update({ stage_id: stage.id, screened: true, pass_reason: null, next_action: title, next_action_due: due, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  const questions = await suggestQuestionsFor(sb, ctx, pipe, item.id).catch(() => 0);
  doneQuietly();
  return { ok: true, nextAction: title, due, questions };
}

// ---------- The AI on a deal: open questions and to-dos ----------

/** What the AI reads about a deal: every fact, the original listing text, stage, key finding, notes, emails, calls, and document names. */
async function dealContext(sb: SupabaseClient, pipe: WorkPipeline, item: Row): Promise<DealContext> {
  const stage = item.stage_id ? pipe.byId[item.stage_id] : null;
  const [{ data: fin }, { data: notes }, { data: comms }, { data: docs }, buyBox] = await Promise.all([
    sb.from("deal_financials").select("revenue,ebitda,sde,asking_price").eq("item_id", item.id).maybeSingle(),
    sb.from("notes").select("body,created_at").eq("record_type", "pipeline_items").eq("record_id", item.id).order("created_at", { ascending: false }).limit(20),
    sb.from("communications").select("occurred_at,method,direction,subject,summary").eq("pipeline_item_id", item.id).order("occurred_at", { ascending: false }).limit(20),
    sb.from("documents").select("file_name,kind").eq("record_type", "pipeline_items").eq("record_id", item.id).order("created_at", { ascending: false }).limit(20),
    // AI instructions (2026-11-02): the buy box is read on every click, so the instructions follow any change.
    loadBuyBoxSettings(sb, String(item.owner_id ?? "")),
  ]);
  const timeline = [
    ...((notes ?? []) as Row[]).map((n) => ({ when: String(n.created_at), text: `note: ${String(n.body ?? "").slice(0, 300)}` })),
    ...((comms ?? []) as Row[]).map((c) => ({ when: String(c.occurred_at), text: `${c.method === "email" ? (c.direction === "incoming" ? "email received" : "email sent") : String(c.method)}: ${[c.subject, c.summary].filter(Boolean).join(". ")}` })),
  ]
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .map((e) => `${fmtDate(e.when, "MMM d")}, ${e.text}`);
  const existing = parseOpenQuestions(item.open_questions_json, item.open_questions as string | null);
  return {
    // Fix 2026-11-02: every fact (money, multiple, source, link, year, employees) and the original listing text.
    facts: dealFactsFromRow(item, (fin ?? null) as Row | null, stage?.name ?? null, existing),
    nextAction: item.next_action ?? null,
    timeline,
    documentNames: ((docs ?? []) as Row[]).map((d) => String(d.file_name)),
    existing,
    buyBox,
  };
}

/** Asks the AI for open questions and adds the new ones to the deal's groups. Returns how many were added. Throws when the AI fails. */
async function suggestQuestionsFor(sb: SupabaseClient, ctx: Ctx, pipe: WorkPipeline, id: string): Promise<number> {
  const { data } = await sb.from("pipeline_items").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  const item = data as Row | null;
  if (!item) return 0;
  const context = await dealContext(sb, pipe, item);
  const next = await callForJson<QuestionGroups>({ sb, ownerId: ctx.ownerId, purpose: "open_questions", prompt: questionsPrompt(context), maxTokens: 1500, shape: "items", validate: (v) => validateQuestionsReply(cleanDeep(v)) });
  const { merged, added } = mergeQuestions(context.existing, next);
  if (!added) return 0;
  const { error } = await sb.from("pipeline_items").update({ open_questions_json: merged }).eq("id", item.id);
  if (error) throw new Error(error.message);
  return added;
}

/** "Suggest questions" on the Findings card: the AI adds questions it has not asked yet; the groups come back. */
export async function suggestQuestions(id: string): Promise<{ ok: true; questions: QuestionGroups; added: number } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  try {
    const added = await suggestQuestionsFor(sb, ctx, pipe, item.id);
    const { data } = await sb.from("pipeline_items").select("open_questions,open_questions_json").eq("id", item.id).maybeSingle();
    const row = data as Row | null;
    done();
    return { ok: true, questions: parseOpenQuestions(row?.open_questions_json, row?.open_questions as string | null), added };
  } catch (e) {
    return aiFail(e);
  }
}

/** "Suggest tasks" on the Tasks card: up to 5 items from the deal's facts, questions, and timeline. */
export async function suggestTodos(id: string): Promise<{ ok: true; added: number } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  try {
    const [context, existing] = await Promise.all([dealContext(sb, pipe, item), loadTodos(sb, ctx, item.id)]);
    const open = openTodos(existing);
    const items = await callForJson<string[]>({ sb, ownerId: ctx.ownerId, purpose: "deal_todos", prompt: todosPrompt(context, open.map((t) => t.text)), maxTokens: 1200, shape: "items", validate: (v) => validateTodosReply(cleanDeep(v)) });
    const seen = new Set(existing.map((t) => t.text.toLowerCase()));
    const fresh = items.filter((t) => !seen.has(t.toLowerCase()));
    if (!fresh.length) return { ok: true, added: 0 };
    let position = nextTodoPosition(existing);
    const { error } = await sb.from("deal_todos").insert(fresh.map((text) => ({ owner_id: ctx.ownerId, deal_id: item.id, text, position: position++ })));
    if (error) return notSaved(error);
    done();
    return { ok: true, added: fresh.length };
  } catch (e) {
    return aiFail(e);
  }
}

async function loadTodos(sb: SupabaseClient, ctx: Ctx, dealId: string): Promise<DealTodo[]> {
  const { data } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("deal_id", dealId).limit(500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
}

// ---------- Also to do ----------

export async function addTodo(id: string, text: string): Promise<{ ok: true; todoId: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const line = clean(text, TODO_MAX_LENGTH);
  if (!line) return fail("Type the item first.");
  const existing = await loadTodos(sb, ctx, item.id);
  const { data, error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, deal_id: item.id, text: line, position: nextTodoPosition(existing) }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, todoId: String(data.id) };
}

async function todoOf(sb: SupabaseClient, ctx: Ctx, todoId: string): Promise<Row | Fail> {
  if (!UUID.test(todoId)) return fail("This item was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", todoId).maybeSingle();
  return (data as Row | null) ?? fail("This item was not found. It may have been deleted.");
}

/** The checkbox: done (now) or open again. */
export async function setTodoDone(todoId: string, isDone: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const todo = await todoOf(sb, ctx, todoId);
  if (isFail(todo)) return todo;
  const { error } = await sb.from("deal_todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", todo.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function deleteTodo(todoId: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const todo = await todoOf(sb, ctx, todoId);
  if (isFail(todo)) return todo;
  const { error } = await sb.from("deal_todos").delete().eq("id", todo.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/**
 * "Make this the next action": the item's text becomes the deal's next action (due tomorrow) and the item leaves the
 * list. A next action that was there before is kept as a to-do at the top of the list, so nothing typed is lost.
 */
export async function makeTodoNextAction(todoId: string): Promise<{ ok: true; nextAction: string; due: string; kept: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const todo = await todoOf(sb, ctx, todoId);
  if (isFail(todo)) return todo;
  const item = await dealOf(sb, ctx, pipe, String(todo.deal_id));
  if (isFail(item)) return item;
  const r = await setNextActionFromTodo(sb, ctx, item, todo, false);
  if (isFail(r)) return r;
  done();
  return { ok: true, ...r };
}

/** Shared by "Make this the next action" and Done: the to-do becomes the next action due tomorrow; the old action is kept as a to-do unless it was just done. */
async function setNextActionFromTodo(sb: SupabaseClient, ctx: Ctx, item: Row, todo: Row, oldActionDone: boolean): Promise<{ nextAction: string; due: string; kept: string | null } | Fail> {
  const text = String(todo.text ?? "").trim();
  if (!text) return fail("This item is empty.");
  const due = addDaysISO(ctx.today, 1);
  const old = oldActionDone ? null : clean(item.next_action, TODO_MAX_LENGTH);
  const keep = old && old.toLowerCase() !== text.toLowerCase() ? old : null;
  const { error } = await sb.from("pipeline_items").update({ next_action: text, next_action_due: due, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await sb.from("deal_todos").delete().eq("id", todo.id);
  if (keep) await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, deal_id: item.id, text: keep, position: 0 });
  return { nextAction: text, due, kept: keep };
}

// ---------- Next actions (Work on now and the deal page) ----------

/** Marks the task that mirrors the deal's next action done (so its commitment counts as kept). */
async function completeActionTask(sb: SupabaseClient, ctx: Ctx, item: Row) {
  if (!item.next_action) return;
}

/**
 * Done. With `move`, the deal goes to the next stage and gets that stage's default next action and due date; with
 * `todoId`, that Also to do item becomes the next action (due tomorrow) and leaves the list; otherwise the action is
 * cleared and the deal stays where it is ("Needs a next action").
 */
export async function completeNextAction(id: string, move: boolean, todoId: string | null = null): Promise<{ ok: true; movedTo: string | null; nextAction: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  await completeActionTask(sb, ctx, item);
  // Counted on Targets (batch C): a next action marked Done.
  if (item.next_action) await recordWorkEvent(sb, ctx.ownerId, { kind: "next_action_done", recordType: "pipeline_items", recordId: String(item.id), label: String(item.company_name || item.name), on: ctx.today, meta: { action: String(item.next_action) } });
  if (todoId) {
    const todo = await todoOf(sb, ctx, todoId);
    if (isFail(todo)) return todo;
    if (String(todo.deal_id) !== String(item.id)) return fail("This item belongs to another deal.");
    const r = await setNextActionFromTodo(sb, ctx, item, todo, true);
    if (isFail(r)) return r;
    doneQuietly();
    return { ok: true, movedTo: null, nextAction: r.nextAction };
  }
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = move && current ? pipe.stages.find((st) => st.outcome === "open" && st.position > current.position) ?? null : null;
  let update: Row;
  if (move && next) {
    update = { stage_id: next.id, next_action: next.defaultTitle, next_action_due: next.defaultTitle ? addDaysISO(ctx.today, next.defaultDueInDays ?? 0) : null, next_action_minutes: null, waiting_on: null, waiting_since: null };
  } else {
    update = { next_action: null, next_action_due: null, next_action_minutes: null };
  }
  const { error } = await sb.from("pipeline_items").update(update).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true, movedTo: move && next ? next.name : null, nextAction: move && next ? next.defaultTitle : null };
}

/** Later: the next action's due date moves to the chosen date (tomorrow by default); the mirrored task moves with it. */
export async function deferNextAction(id: string, date: string): Promise<{ ok: true; due: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("pipeline_items").update({ next_action_due: due }).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true, due };
}


type NextActionInput = { action: string; due: string; minutes: string | number | null; waitingOn: string; waitingSince: string };

/** The Next action card on the deal page: action, due date, block minutes, waiting on, waiting since. */
export async function saveNextAction(id: string, input: NextActionInput): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const action = clean(input.action, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const minutesRaw = input.minutes === null || input.minutes === undefined || input.minutes === "" ? null : Number(String(input.minutes).replace(/[^\d.]/g, ""));
  const minutes = minutesRaw === null || !Number.isFinite(minutesRaw) ? null : Math.max(0, Math.min(1440, Math.round(minutesRaw)));
  const waitingOn = clean(input.waitingOn, 120);
  const since = DATE.test(String(input.waitingSince ?? "")) ? String(input.waitingSince) : ctx.today;
  if (action && !due) return fail("Give the next action a due date.");
  const { error } = await sb.from("pipeline_items").update({ next_action: action, next_action_due: action ? due : null, next_action_minutes: minutes, waiting_on: waitingOn, waiting_since: waitingOn ? since : null }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Follow up sent: the wait starts again today (the email itself is logged by the send). */
export async function resetWaiting(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  if (!item.waiting_on) return { ok: true };
  const { error } = await sb.from("pipeline_items").update({ waiting_since: ctx.today }).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true };
}

// ---------- The deal page ----------

/** What the Findings card saves: any of its fields (a field left out stays as it is). */
export type FindingsInput = { keyFinding?: string; questions?: QuestionGroups; strengths?: string[]; risks?: string[]; growthPaths?: string[] };

/** The saved values the Findings card compares with (cleaned as the database keeps them). */
type SavedFindings = { keyFinding: string; questions: QuestionGroups; strengths: string[]; risks: string[]; growthPaths: string[] };

/**
 * The Findings card (AI instructions revision 1, approved 2026-11-02): saves only the fields given, so a field saved
 * when it loses focus never overwrites another one. The key finding (several lines), the Strengths, Risks, and Growth
 * paths lists (up to 3 each, the first growth path is the main one), and the open questions as three groups of lines.
 * "Use this" on the Key finding star saves all of them at once, and Undo saves the values from before.
 * Before database update 0028 (or 0029 for growth paths) lists with lines in them return the update line and nothing
 * is saved. Returns the saved values, cleaned.
 */
export async function saveFindings(id: string, input: FindingsInput): Promise<{ ok: true; saved: SavedFindings } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const patch: Row = {};
  if (input.keyFinding !== undefined) patch.key_finding = cleanText(input.keyFinding, 2000);
  if (input.questions !== undefined) {
    const questions = cleanQuestions(input.questions);
    patch.open_questions_json = countQuestions(questions) ? questions : null;
  }
  for (const [key, column, ready, notice] of [["strengths", "strengths", has0028(item), DB_UPDATE_NOTICE_0028], ["risks", "risks", has0028(item), DB_UPDATE_NOTICE_0028], ["growthPaths", "growth_paths", has0029(item), DB_UPDATE_NOTICE_0029]] as const) {
    const value = input[key];
    if (value === undefined) continue;
    const lines = parseFindingList(value);
    if (!ready) {
      if (lines.length) return fail(notice);
      continue;
    }
    patch[column] = lines.length ? lines : null;
  }
  if (Object.keys(patch).length) {
    const { error } = await sb.from("pipeline_items").update(patch).eq("id", item.id);
    if (error) return isMissingSchemaError(error) ? fail(DB_UPDATE_NOTICE_0029) : notSaved(error);
  }
  const row = { ...item, ...patch };
  done();
  return {
    ok: true,
    saved: {
      keyFinding: typeof row.key_finding === "string" ? row.key_finding : "",
      questions: parseOpenQuestions(row.open_questions_json, row.open_questions as string | null),
      strengths: parseFindingList(row.strengths),
      risks: parseFindingList(row.risks),
      growthPaths: parseFindingList(row.growth_paths),
    },
  };
}

export type FactsInput = { name: string; companyName: string; whatItDoes: string; location: string; revenue: string; ebitda: string; sde: string; askingPrice: string; industry: string; brokerName: string; source: string; whySelling: string; listingUrl: string; /** Database update 0027; left as it is when not given. */ yearEstablished?: string; /** Database update 0027; left as it is when not given. */ employees?: string; /** Database update 0029 (all equity or equity plus debt); left as it is when not given. */ financing?: DealFinancing };

/** The Facts card: the deal's text facts and its numbers (deal_financials). */
export async function saveFacts(id: string, input: FactsInput): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const name = clean(input.name, 200);
  if (!name) return fail("The deal needs a listing name.");
  const source = (LISTING_SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : clean(input.source, 80);
  const { error } = await sb
    .from("pipeline_items")
    .update({
      name,
      company_name: clean(input.companyName, 200),
      what_it_does: clean(input.whatItDoes, 300),
      location: clean(input.location, 120),
      industry: clean(input.industry, 120),
      broker_name: clean(input.brokerName, 200),
      source,
      why_selling: clean(input.whySelling, 300),
      listing_url: clean(input.listingUrl, 500),
      // Database update 0027: the two Facts fields are saved once the columns exist (the row read with "*" shows them).
      ...(has0027(item) && input.yearEstablished !== undefined ? { year_established: yearOf(input.yearEstablished) ? Number(yearOf(input.yearEstablished)) : null } : {}),
      ...(has0027(item) && input.employees !== undefined ? { employees: clean(input.employees, 120) } : {}),
      // AI instructions revision 1 (database update 0029): how the deal is financed.
      ...(has0029(item) && isDealFinancing(input.financing) ? { financing: input.financing } : {}),
    })
    .eq("id", item.id);
  if (error) return notSaved(error);
  const numbers = { revenue: parseMoneyText(input.revenue), ebitda: parseMoneyText(input.ebitda), sde: parseMoneyText(input.sde), asking_price: parseMoneyText(input.askingPrice) };
  const { data: fin } = await sb.from("deal_financials").select("id").eq("item_id", item.id).maybeSingle();
  const { error: e2 } = fin ? await sb.from("deal_financials").update(numbers).eq("id", fin.id) : await sb.from("deal_financials").insert({ owner_id: ctx.ownerId, item_id: item.id, ...numbers });
  if (e2) return fail(`The facts were saved, but the numbers were not: ${e2.message}`);
  // The old task titles follow the name.
  done();
  return { ok: true };
}

/** Advance to the next stage (the Decision card). Blocked when the stage's required details are missing. */
export async function advanceDeal(id: string): Promise<{ ok: true; stage: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = pipe.stages.find((st) => st.outcome === "open" && st.position > (current?.position ?? 0));
  if (!next) return fail("This deal is at the last stage.");
  const missing = await missingForStage(sb, item, next.id);
  if (missing.length) return fail(`Not moved to ${next.name}: add ${missing.map((m) => m.label).join(", ")} in Facts first.`);
  // The stage trigger sets the default next action when the current one was the old stage's default or empty.
  const { error } = await sb.from("pipeline_items").update({ stage_id: next.id, waiting_on: null, waiting_since: null, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, stage: next.name };
}

/** Lost: the seller chose someone else or withdrew (a stage, separate from Passed). */
export async function markLost(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const lost = pipe.byName.Lost;
  if (!lost) return fail('The acquisition pipeline has no "Lost" stage. Run the database update again.');
  const { error } = await sb.from("pipeline_items").update({ stage_id: lost.id, waiting_on: null, waiting_since: null }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Add a note (the Timeline card). */
export async function addDealNote(id: string, body: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const text = cleanText(body, 4000);
  if (!text) return fail("Type the note first.");
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "pipeline_items", record_id: item.id, body: text });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/**
 * "Add link" (Edit batch C round 3): the link to the original listing, typed in the listing popup or in the Facts card
 * when there is none yet. Only the link is saved; an address typed without http is saved with https:// in front.
 */
export async function saveListingLink(id: string, url: string): Promise<{ ok: true; url: string } | Fail> {
  const typed = String(url ?? "").trim();
  if (!typed) return fail("Paste or type the link first.");
  const link = /\s/.test(typed) ? null : firstUrl(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
  if (!link) return fail("That does not look like a web address. Paste the address of the original listing.");
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const { error } = await sb.from("pipeline_items").update({ listing_url: link }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, url: link };
}

/**
 * The Original listing text card (Fix 2026-11-02): "Paste the listing text" on a listing or a deal that has none, and
 * "Replace" on one that has it. One text per record: the new text takes the place of the old one (kept on
 * pipeline_items.listing_text, never in the Timeline). Before database update 0027 the card shows the update line.
 */
export async function saveListingText(id: string, text: string): Promise<{ ok: true } | Fail> {
  const body = listingTextToSave(text, 20);
  if (!body) return fail("Paste the listing text first (the broker email or the page).");
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  if (!has0027(item)) return fail(DB_UPDATE_NOTICE_0027);
  const { error } = await sb.from("pipeline_items").update({ listing_text: body }).eq("id", item.id);
  if (error) return isMissingSchemaError(error) ? fail(DB_UPDATE_NOTICE_0027) : notSaved(error);
  done();
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, refreshNextActionAlert, type Ctx } from "@/lib/engine/helpers";
import { checkCommitments, releaseSupersededNextActions } from "@/lib/engine/tasks";
import { evaluateConditions } from "@/lib/engine/rules";
import { DB_UPDATE_NOTICE_0023, isMissingSchemaError } from "@/lib/schema-guard";
import { parseMoneyText } from "@/lib/work/buy-box";
import { loadPipelineOfKind, workUpdateNotice, type WorkPipeline } from "@/lib/work/data";
import { CONSULTING_CLOSED, JOB_CLOSED } from "@/lib/work/pipelines";
import { cleanQuestions, QUESTION_MAX_PER_GROUP, TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * The saves of Job search and Consulting (batch B2, database updates 0022 and 0023): Add an opportunity, Add a lead,
 * the next action (Save, Done, Later), Advance and Close, the facts, What to find out, tasks, and notes. An
 * opportunity or a consulting item is a pipeline item of its pipeline (kind job or consulting). Every action returns
 * { ok: false, error } instead of throwing, so what the owner typed stays on the screen with the message.
 */

export type ItemKind = "job" | "consulting";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0023 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const isKind = (k: unknown): k is ItemKind => k === "job" || k === "consulting";
const noun = (kind: ItemKind) => (kind === "job" ? "opportunity" : "consulting item");

async function setup(kind: ItemKind): Promise<{ sb: SupabaseClient; ctx: Ctx; pipe: WorkPipeline } | Fail> {
  if (!isKind(kind)) return fail("Unknown pipeline.");
  const { supabase, ownerId } = await requireOwner();
  const notice = await workUpdateNotice(supabase);
  if (notice) return fail(notice);
  const pipe = await loadPipelineOfKind(supabase, ownerId, kind);
  if (!pipe) return fail(kind === "job" ? "There is no Job search pipeline. Run the database update again." : "There is no Consulting pipeline. Run the database update again.");
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId), pipe };
}

async function itemOf(sb: SupabaseClient, ctx: Ctx, pipe: WorkPipeline, kind: ItemKind, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail(`This ${noun(kind)} was not found.`);
  const { data } = await sb.from("pipeline_items").select("*").eq("owner_id", ctx.ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  return (data as Row | null) ?? fail(`This ${noun(kind)} was not found. It may have been deleted.`);
}

function done() {
  revalidatePath("/", "layout");
}

/** The row buttons (Done, Later) refresh the page themselves after the confirmation line shows. */
function doneQuietly() {}

function minutesOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : null;
}

// ---------- Add an opportunity, Add a lead ----------

export type OpportunityInput = { company: string; role: string; contact: string; location: string; whatItDoes: string; source: string; link: string; payRange: string; nextAction: string; due: string; note?: string };

/** Add an opportunity: a new item at Contact (the stage's default next action when none is typed). */
export async function createOpportunity(input: OpportunityInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup("job");
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const name = clean(input.company, 200);
  if (!name) return fail("Give the opportunity a company name.");
  const stage = pipe.byName.Contact ?? pipe.stages.find((st) => st.outcome === "open");
  if (!stage) return fail("The Job search pipeline has no Contact stage. Run the database update again.");
  const action = clean(input.nextAction, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const row: Row = {
    owner_id: ctx.ownerId,
    pipeline_id: pipe.id,
    stage_id: stage.id,
    name,
    role_title: clean(input.role, 160),
    contact_name: clean(input.contact, 160),
    location: clean(input.location, 120),
    what_it_does: clean(input.whatItDoes, 300),
    source: clean(input.source, 80),
    listing_url: clean(input.link, 500),
    pay_range: clean(input.payRange, 80),
    notes: cleanText(input.note, 2000),
    screened: true,
  };
  if (action) {
    row.next_action = action;
    row.next_action_due = due ?? addDaysISO(ctx.today, 1);
  }
  const { data, error } = await sb.from("pipeline_items").insert(row).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

export type LeadInput = { client: string; project: string; contact: string; fee: string; scope: string; startDate: string; nextAction: string; due: string; note?: string };

/** Add a lead: a new consulting item at Lead with its fee, scope, and start date. */
export async function createLead(input: LeadInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup("consulting");
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const name = clean(input.client, 200);
  if (!name) return fail("Give the lead a client name.");
  const stage = pipe.byName.Lead ?? pipe.stages.find((st) => st.outcome === "open");
  if (!stage) return fail("The Consulting pipeline has no Lead stage. Run the database update again.");
  const action = clean(input.nextAction, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const row: Row = {
    owner_id: ctx.ownerId,
    pipeline_id: pipe.id,
    stage_id: stage.id,
    name,
    what_it_does: clean(input.project, 200),
    contact_name: clean(input.contact, 160),
    fee: parseMoneyText(input.fee),
    notes: cleanText(input.note, 2000),
    screened: true,
  };
  if (action) {
    row.next_action = action;
    row.next_action_due = due ?? addDaysISO(ctx.today, 1);
  }
  const { data, error } = await sb.from("pipeline_items").insert(row).select("id").single();
  if (error) return notSaved(error);
  const scope = cleanText(input.scope, 2000);
  const start = DATE.test(String(input.startDate ?? "")) ? String(input.startDate) : null;
  if (scope || start) {
    const { error: e2 } = await sb.from("consulting_details").insert({ owner_id: ctx.ownerId, item_id: data.id, scope_notes: scope, start_date: start, rate_type: "project", rate: parseMoneyText(input.fee) });
    if (e2) return fail(`The lead was saved, but its scope was not: ${e2.message}. Open it to add the scope.`);
  }
  done();
  return { ok: true, id: String(data.id) };
}

// ---------- The next action ----------

export type ItemNextActionInput = { action: string; due: string; minutes: string | number | null; waitingOn: string; waitingSince: string };

export async function saveItemNextAction(kind: ItemKind, id: string, input: ItemNextActionInput): Promise<{ ok: true } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const action = clean(input.action, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const waitingOn = clean(input.waitingOn, 120);
  const since = DATE.test(String(input.waitingSince ?? "")) ? String(input.waitingSince) : ctx.today;
  if (action && !due) return fail("Give the next action a due date.");
  const { error } = await sb.from("pipeline_items").update({ next_action: action, next_action_due: action ? due : null, next_action_minutes: action ? minutesOf(input.minutes) : null, waiting_on: waitingOn, waiting_since: waitingOn ? since : null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, String(item.id)).catch(() => null);
  await refreshNextActionAlert(ctx).catch(() => null);
  done();
  return { ok: true };
}

async function itemTasks(sb: SupabaseClient, ctx: Ctx, id: string): Promise<DealTodo[]> {
  const { data } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "pipeline_items").eq("record_id", id).limit(500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
}

async function itemTaskOf(sb: SupabaseClient, ctx: Ctx, taskId: string): Promise<Row | Fail> {
  if (!UUID.test(taskId)) return fail("This task was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", taskId).eq("record_type", "pipeline_items").maybeSingle();
  return (data as Row | null) ?? fail("This task was not found. It may have been deleted.");
}

/** Marks the task that mirrors the next action done (so its commitment counts as kept). */
async function completeActionTask(sb: SupabaseClient, ctx: Ctx, item: Row) {
  if (!item.next_action) return;
  await sb.from("tasks").update({ status: "done" }).eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  await checkCommitments(ctx, false).catch(() => null);
}

async function nextActionFromTask(sb: SupabaseClient, ctx: Ctx, item: Row, task: Row, oldActionDone: boolean): Promise<{ nextAction: string; due: string; kept: string | null } | Fail> {
  const text = String(task.text ?? "").trim();
  if (!text) return fail("This task is empty.");
  const due = addDaysISO(ctx.today, 1);
  const old = oldActionDone ? null : clean(item.next_action, TODO_MAX_LENGTH);
  const keep = old && old.toLowerCase() !== text.toLowerCase() ? old : null;
  const { error } = await sb.from("pipeline_items").update({ next_action: text, next_action_due: due, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await sb.from("deal_todos").delete().eq("id", task.id);
  if (keep) await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "pipeline_items", record_id: item.id, deal_id: item.id, text: keep, position: 0 });
  await releaseSupersededNextActions(ctx, String(item.id)).catch(() => null);
  await refreshNextActionAlert(ctx).catch(() => null);
  return { nextAction: text, due, kept: keep };
}

/**
 * Done. With `move`, the item goes to the next open stage and gets that stage's default next action; with `taskId`,
 * that task becomes the next action (due tomorrow); otherwise the action is cleared ("Needs a next action").
 */
export async function completeItemAction(kind: ItemKind, id: string, move: boolean, taskId: string | null = null): Promise<{ ok: true; movedTo: string | null; nextAction: string | null } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  await completeActionTask(sb, ctx, item);
  if (taskId) {
    const task = await itemTaskOf(sb, ctx, taskId);
    if (isFail(task)) return task;
    if (String(task.record_id) !== String(item.id)) return fail("This task belongs to another record.");
    const r = await nextActionFromTask(sb, ctx, item, task, true);
    if (isFail(r)) return r;
    doneQuietly();
    return { ok: true, movedTo: null, nextAction: r.nextAction };
  }
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = move && current ? pipe.stages.find((st) => st.outcome === "open" && st.position > current.position) ?? null : null;
  const update: Row = move && next ? { stage_id: next.id, next_action: next.defaultTitle, next_action_due: next.defaultTitle ? addDaysISO(ctx.today, next.defaultDueInDays ?? 0) : null, next_action_minutes: null, waiting_on: null, waiting_since: null } : { next_action: null, next_action_due: null, next_action_minutes: null };
  const { error } = await sb.from("pipeline_items").update(update).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, String(item.id)).catch(() => null);
  await refreshNextActionAlert(ctx).catch(() => null);
  await evaluateConditions(ctx).catch(() => null);
  doneQuietly();
  return { ok: true, movedTo: move && next ? next.name : null, nextAction: move && next ? next.defaultTitle : null };
}

/** Later: the next action's due date moves to the chosen date (tomorrow by default). */
export async function deferItemAction(kind: ItemKind, id: string, date: string): Promise<{ ok: true; due: string } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("pipeline_items").update({ next_action_due: due }).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true, due };
}

// ---------- Advance and Close ----------

/** Advance to the next open stage; the stage trigger sets the default next action when the current one was the old stage's default. */
export async function advanceItem(kind: ItemKind, id: string): Promise<{ ok: true; stage: string } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = pipe.stages.find((st) => st.outcome === "open" && st.position > (current?.position ?? 0));
  if (!next) return fail(`This ${noun(kind)} is at the last stage.`);
  const { error } = await sb.from("pipeline_items").update({ stage_id: next.id, waiting_on: null, waiting_since: null, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, String(item.id)).catch(() => null);
  await refreshNextActionAlert(ctx).catch(() => null);
  await evaluateConditions(ctx).catch(() => null);
  done();
  return { ok: true, stage: next.name };
}

/** Close: Declined, Not chosen, or Accepted (Job search); Lost or Done (Consulting). The item leaves the columns and joins the closed bar. */
export async function closeItem(kind: ItemKind, id: string, outcome: string): Promise<{ ok: true; stage: string } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const allowed = (kind === "job" ? JOB_CLOSED : CONSULTING_CLOSED).map((c) => c.name as string);
  if (!allowed.includes(outcome)) return fail(`Choose one of ${allowed.join(", ")}.`);
  const stage = pipe.byName[outcome];
  if (!stage) return fail(`The pipeline has no "${outcome}" stage. Run the database update again.`);
  const { error } = await sb.from("pipeline_items").update({ stage_id: stage.id, waiting_on: null, waiting_since: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, String(item.id)).catch(() => null);
  await refreshNextActionAlert(ctx).catch(() => null);
  done();
  return { ok: true, stage: stage.name };
}

/** Reopen a closed item: back to the first open stage (Contact or Lead). */
export async function reopenItem(kind: ItemKind, id: string): Promise<{ ok: true; stage: string } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const first = pipe.stages.find((st) => st.outcome === "open");
  if (!first) return fail("The pipeline has no open stage.");
  const { error } = await sb.from("pipeline_items").update({ stage_id: first.id, status: "open" }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, stage: first.name };
}

// ---------- Facts ----------

export type OpportunityFactsInput = { company: string; role: string; contact: string; source: string; payRange: string; location: string; whatItDoes: string; link: string };

export async function saveOpportunityFacts(id: string, input: OpportunityFactsInput): Promise<{ ok: true } | Fail> {
  const s = await setup("job");
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, "job", id);
  if (isFail(item)) return item;
  const name = clean(input.company, 200);
  if (!name) return fail("The opportunity needs a company name.");
  const { error } = await sb
    .from("pipeline_items")
    .update({ name, role_title: clean(input.role, 160), contact_name: clean(input.contact, 160), source: clean(input.source, 80), pay_range: clean(input.payRange, 80), location: clean(input.location, 120), what_it_does: clean(input.whatItDoes, 300), listing_url: clean(input.link, 500) })
    .eq("id", item.id);
  if (error) return notSaved(error);
  if (name !== item.name && item.next_action) await sb.from("tasks").update({ title: `${name}: ${item.next_action}` }).eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  done();
  return { ok: true };
}

export type ConsultingFactsInput = { client: string; project: string; contact: string; fee: string; scope: string; startDate: string };

export async function saveConsultingFacts(id: string, input: ConsultingFactsInput): Promise<{ ok: true } | Fail> {
  const s = await setup("consulting");
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, "consulting", id);
  if (isFail(item)) return item;
  const name = clean(input.client, 200);
  if (!name) return fail("The consulting item needs a client name.");
  const fee = parseMoneyText(input.fee);
  const { error } = await sb.from("pipeline_items").update({ name, what_it_does: clean(input.project, 200), contact_name: clean(input.contact, 160), fee }).eq("id", item.id);
  if (error) return notSaved(error);
  const scope = cleanText(input.scope, 2000);
  const start = DATE.test(String(input.startDate ?? "")) ? String(input.startDate) : null;
  const { data: det } = await sb.from("consulting_details").select("id").eq("item_id", item.id).maybeSingle();
  const { error: e2 } = det ? await sb.from("consulting_details").update({ scope_notes: scope, start_date: start, rate: fee }).eq("id", (det as Row).id) : await sb.from("consulting_details").insert({ owner_id: ctx.ownerId, item_id: item.id, scope_notes: scope, start_date: start, rate_type: "project", rate: fee });
  if (e2) return fail(`The facts were saved, but the scope was not: ${e2.message}`);
  if (name !== item.name && item.next_action) await sb.from("tasks").update({ title: `${name}: ${item.next_action}` }).eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  done();
  return { ok: true };
}

/** "What to find out" on an opportunity: one group of lines (stored as the "self" group of open_questions_json). */
export async function saveFindOut(id: string, lines: string[]): Promise<{ ok: true; lines: string[] } | Fail> {
  const s = await setup("job");
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, "job", id);
  if (isFail(item)) return item;
  const q = cleanQuestions({ self: (Array.isArray(lines) ? lines : []).slice(0, QUESTION_MAX_PER_GROUP) });
  const { error } = await sb.from("pipeline_items").update({ open_questions_json: q.self.length ? q : null }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, lines: q.self };
}

// ---------- Tasks and notes ----------

export async function addItemTask(kind: ItemKind, id: string, text: string): Promise<{ ok: true; taskId: string } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const line = clean(text, TODO_MAX_LENGTH);
  if (!line) return fail("Type the task first.");
  const existing = await itemTasks(sb, ctx, String(item.id));
  const { data, error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "pipeline_items", record_id: item.id, deal_id: item.id, text: line, position: nextTodoPosition(existing) }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, taskId: String(data.id) };
}

export async function setItemTaskDone(kind: ItemKind, taskId: string, isDone: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await itemTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function deleteItemTask(kind: ItemKind, taskId: string): Promise<{ ok: true } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await itemTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").delete().eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function makeItemTaskNext(kind: ItemKind, taskId: string): Promise<{ ok: true; nextAction: string; due: string; kept: string | null } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const task = await itemTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const item = await itemOf(sb, ctx, pipe, kind, String(task.record_id));
  if (isFail(item)) return item;
  const r = await nextActionFromTask(sb, ctx, item, task, false);
  if (isFail(r)) return r;
  done();
  return { ok: true, ...r };
}

/** Add a note (the Timeline card). */
export async function addItemNote(kind: ItemKind, id: string, body: string): Promise<{ ok: true } | Fail> {
  const s = await setup(kind);
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await itemOf(sb, ctx, pipe, kind, id);
  if (isFail(item)) return item;
  const text = cleanText(body, 4000);
  if (!text) return fail("Type the note first.");
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "pipeline_items", record_id: item.id, body: text });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

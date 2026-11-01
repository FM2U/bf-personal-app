"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { DB_UPDATE_NOTICE_0023, isMissingSchemaError } from "@/lib/schema-guard";
import { workUpdateNotice } from "@/lib/work/data";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * The saves of Rosara and the project page (batch B2, database updates 0022 and 0023): the weekly focus, Add a
 * project, the goal and milestone, the next action (Save, Done, Later), the tasks, notes and findings, Close and
 * Reopen. Every action returns { ok: false, error } instead of throwing, so what the owner typed stays on the screen
 * with the message. The pages re-read on the next load (router.refresh in the component).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0023 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const notice = await workUpdateNotice(supabase);
  if (notice) return fail(notice);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

async function projectOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This project was not found.");
  const { data } = await sb.from("projects").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This project was not found. It may have been deleted.");
}

function done() {
  revalidatePath("/", "layout");
}

/** The row buttons (Done, Later) refresh the page themselves after the confirmation line shows. */
function doneQuietly() {}

// ---------- Weekly focus ----------

/** The Weekly focus bar: the setting rosara_weekly_focus (text). An empty box clears it. */
export async function saveWeeklyFocus(text: string): Promise<{ ok: true; focus: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const focus = clean(text, 300) ?? "";
  const { data } = await sb.from("inputs").select("id").eq("owner_id", ctx.ownerId).eq("key", "rosara_weekly_focus").maybeSingle();
  const { error } = data
    ? await sb.from("inputs").update({ value_text: focus || null }).eq("id", (data as Row).id)
    : await sb.from("inputs").insert({ owner_id: ctx.ownerId, key: "rosara_weekly_focus", label: "Rosara weekly focus", category: "Rosara", unit: "text", value_text: focus || null, description: "The one thing Rosara gets this week. Edited at the top of the Rosara page and shown on Home.", sort_order: 91 });
  if (error) return notSaved(error);
  done();
  return { ok: true, focus };
}

// ---------- Add a project, goal and milestone, facts ----------

export type ProjectInput = { name: string; goal: string; milestone: string; nextAction: string; due: string; minutes?: string | number | null };

export async function createProject(input: ProjectInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const name = clean(input.name, 120);
  if (!name) return fail("Give the project a name.");
  const action = clean(input.nextAction, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  if (action && !due) return fail("Give the first next action a due date.");
  const { data: rows } = await sb.from("projects").select("position").eq("owner_id", ctx.ownerId).limit(1000);
  const position = ((rows ?? []) as Row[]).reduce((m, r) => Math.max(m, Number(r.position ?? 0)), 0) + 1;
  const { data, error } = await sb
    .from("projects")
    .insert({ owner_id: ctx.ownerId, name, goal: clean(input.goal, 300), milestone: clean(input.milestone, 200), next_action: action, next_action_due: action ? due : null, next_action_minutes: minutesOf(input.minutes), position })
    .select("id")
    .single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

function minutesOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : null;
}

/** The Goal and milestone card. */
export async function saveProjectGoal(id: string, input: { goal: string; milestone: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const { error } = await sb.from("projects").update({ goal: clean(input.goal, 300), milestone: clean(input.milestone, 200) }).eq("id", p.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** The Facts card: the name. */
export async function saveProjectFacts(id: string, input: { name: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const name = clean(input.name, 120);
  if (!name) return fail("The project needs a name.");
  const { error } = await sb.from("projects").update({ name }).eq("id", p.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- The next action ----------

/** The Next action card: action, due date, minutes. */
export async function saveProjectNextAction(id: string, input: { action: string; due: string; minutes: string | number | null }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const action = clean(input.action, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  if (action && !due) return fail("Give the next action a due date.");
  const { error } = await sb.from("projects").update({ next_action: action, next_action_due: action ? due : null, next_action_minutes: action ? minutesOf(input.minutes) : null }).eq("id", p.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

async function projectTasks(sb: SupabaseClient, ctx: Ctx, id: string): Promise<DealTodo[]> {
  const { data } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "projects").eq("record_id", id).limit(500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
}

async function projectTaskOf(sb: SupabaseClient, ctx: Ctx, taskId: string): Promise<Row | Fail> {
  if (!UUID.test(taskId)) return fail("This task was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", taskId).eq("record_type", "projects").maybeSingle();
  return (data as Row | null) ?? fail("This task was not found. It may have been deleted.");
}

/** Shared by Done (with a task) and "Make this the next action": the task becomes the next action due tomorrow; the old action is kept as a task unless it was just done. */
async function nextActionFromTask(sb: SupabaseClient, ctx: Ctx, p: Row, task: Row, oldActionDone: boolean): Promise<{ nextAction: string; due: string; kept: string | null } | Fail> {
  const text = String(task.text ?? "").trim();
  if (!text) return fail("This task is empty.");
  const due = addDaysISO(ctx.today, 1);
  const old = oldActionDone ? null : clean(p.next_action, TODO_MAX_LENGTH);
  const keep = old && old.toLowerCase() !== text.toLowerCase() ? old : null;
  const { error } = await sb.from("projects").update({ next_action: text, next_action_due: due, next_action_minutes: null }).eq("id", p.id);
  if (error) return notSaved(error);
  await sb.from("deal_todos").delete().eq("id", task.id);
  if (keep) await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "projects", record_id: p.id, text: keep, position: 0 });
  return { nextAction: text, due, kept: keep };
}

/**
 * Done on a project's next action (the Rosara row, the Home row, the project page): the action is cleared and the
 * project moves to "No next action" (approved 2026-10-31, decisions on v5); with `taskId`, that task becomes the
 * next action (due tomorrow) and leaves the list.
 */
export async function completeProjectAction(id: string, taskId: string | null = null): Promise<{ ok: true; nextAction: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  if (taskId) {
    const task = await projectTaskOf(sb, ctx, taskId);
    if (isFail(task)) return task;
    if (String(task.record_id) !== String(p.id)) return fail("This task belongs to another project.");
    const r = await nextActionFromTask(sb, ctx, p, task, true);
    if (isFail(r)) return r;
    doneQuietly();
    return { ok: true, nextAction: r.nextAction };
  }
  const { error } = await sb.from("projects").update({ next_action: null, next_action_due: null, next_action_minutes: null }).eq("id", p.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true, nextAction: null };
}

/** Later: the next action's due date moves to the chosen date (tomorrow by default). */
export async function deferProjectAction(id: string, date: string): Promise<{ ok: true; due: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  if (!p.next_action) return fail("This project has no next action to move.");
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("projects").update({ next_action_due: due }).eq("id", p.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true, due };
}

// ---------- Tasks ----------

export async function addProjectTask(id: string, text: string): Promise<{ ok: true; taskId: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const line = clean(text, TODO_MAX_LENGTH);
  if (!line) return fail("Type the task first.");
  const existing = await projectTasks(sb, ctx, String(p.id));
  const { data, error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "projects", record_id: p.id, text: line, position: nextTodoPosition(existing) }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, taskId: String(data.id) };
}

export async function setProjectTaskDone(taskId: string, isDone: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await projectTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function deleteProjectTask(taskId: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await projectTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").delete().eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** "Make this the next action": the task becomes the project's next action (due tomorrow); the old one is kept as a task. */
export async function makeProjectTaskNext(taskId: string): Promise<{ ok: true; nextAction: string; due: string; kept: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await projectTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const p = await projectOf(sb, ctx, String(task.record_id));
  if (isFail(p)) return p;
  const r = await nextActionFromTask(sb, ctx, p, task, false);
  if (isFail(r)) return r;
  done();
  return { ok: true, ...r };
}

// ---------- Notes and findings ----------

/** Add a note (the Timeline card); marked as a Finding it carries a source link and shows a Finding pill. */
export async function addProjectNote(id: string, input: { body: string; finding: boolean; source: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const text = cleanText(input.body, 4000);
  if (!text) return fail("Type the note first.");
  const source = clean(input.source, 500);
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "projects", record_id: p.id, body: text, kind: input.finding ? "finding" : "note", source_url: input.finding ? source : null });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- Decision: Close and Reopen ----------

export async function closeProject(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const { error } = await sb.from("projects").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", p.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function reopenProject(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const p = await projectOf(sb, ctx, id);
  if (isFail(p)) return p;
  const { error } = await sb.from("projects").update({ status: "open", closed_at: null }).eq("id", p.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

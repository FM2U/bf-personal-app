"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { DB_UPDATE_NOTICE_PUSH_C, DB_UPDATE_NOTICE_PUSH_D, isMissingSchemaError } from "@/lib/schema-guard";
import { nextPersonalTodoPosition } from "@/lib/work/personal-todos";
import { cleanRepeatUntil, nextCopyDate, parseRepeat, type Repeat } from "@/lib/work/repeat";
import { parseRecordKind, recordTable, type RecordKind } from "@/lib/work/task-records";
import type { Row } from "@/lib/types";

/**
 * Tasks and to-dos (push C, merge approved 2026-11-03): one kind of item, the rows of deal_todos. A row with no record
 * is a personal to-do; a row with a record is one of that record's tasks and shows on its Tasks card. These actions
 * serve the To-dos page, Home's Next actions, Work through, and every record page's Tasks card: add (text, an
 * optional date, Repeat, Link to), check off (a repeating item adds the next one; unticking removes that copy),
 * edit (text, date, Repeat, Link to; unlinking makes it a plain personal to-do), Later, delete. Every action returns
 * { ok: false, error } instead of throwing. Push D: Repeat can have an end date (Ends); checking off adds no new copy
 * once the next date would be after it.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const notSaved = (e: { message?: string | null; code?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? (/repeat_until/.test(String(e?.message ?? "")) ? DB_UPDATE_NOTICE_PUSH_D : DB_UPDATE_NOTICE_PUSH_C) : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 300;

/** The record a task is linked to, as the page or the picker sends it; null for no record. */
export type TaskLink = { kind: RecordKind; id: string } | null;

const cleanText = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
const cleanDate = (v: unknown) => (DATE.test(String(v ?? "")) ? String(v) : null);

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx }> {
  const { supabase, ownerId } = await requireOwner();
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function done() {
  // Tasks show on To-dos, Home, Work through, and the record pages.
  revalidatePath("/work", "layout");
}

async function taskOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This item was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This item was not found. It may have been deleted.");
}

/** The record columns for a link (checked: the record exists and is the owner's), or all null for no record. */
async function linkColumns(sb: SupabaseClient, ctx: Ctx, link: TaskLink | undefined): Promise<{ record_type: string | null; record_id: string | null; deal_id: string | null } | Fail> {
  if (!link) return { record_type: null, record_id: null, deal_id: null };
  const kind = parseRecordKind(link.kind);
  if (!kind || !UUID.test(String(link.id))) return fail("That record was not found.");
  const table = recordTable(kind);
  const { data } = await sb.from(table).select("id").eq("owner_id", ctx.ownerId).eq("id", link.id).maybeSingle();
  if (!data) return fail("That record was not found. It may have been deleted.");
  return { record_type: table, record_id: link.id, deal_id: table === "pipeline_items" ? link.id : null };
}

async function nextPosition(sb: SupabaseClient, ctx: Ctx, cols: { record_type: string | null; record_id: string | null }): Promise<number> {
  let q = sb.from("deal_todos").select("position").eq("owner_id", ctx.ownerId).is("done_at", null);
  q = cols.record_id ? q.eq("record_type", cols.record_type!).eq("record_id", cols.record_id) : q.is("record_id", null);
  const { data } = await q.limit(1000);
  return nextPersonalTodoPosition(((data ?? []) as Row[]).map((r) => ({ position: Number(r.position ?? 0) })));
}

/** Add a to-do or a record task: the text, an optional date, Repeat with its optional end date, and the record (Link to, or the record page). */
export async function addTask(input: { text: string; due?: string | null; repeat?: Repeat | "" | null; until?: string | null; link?: TaskLink }): Promise<{ ok: true; id: string } | Fail> {
  const { sb, ctx } = await setup();
  const text = cleanText(input.text);
  if (!text) return fail("Type it first.");
  const cols = await linkColumns(sb, ctx, input.link ?? null);
  if (isFail(cols)) return cols;
  const position = await nextPosition(sb, ctx, cols);
  const repeat = parseRepeat(input.repeat);
  const row: Row = { owner_id: ctx.ownerId, text, due_on: cleanDate(input.due), position, ...cols };
  if (repeat) row.repeat = repeat;
  const until = cleanRepeatUntil(repeat, input.until);
  if (until) row.repeat_until = until;
  const { data, error } = await sb.from("deal_todos").insert(row).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

/**
 * The checkbox, anywhere (To-dos, Home, Work through, a record's Tasks card): done now, or open again. Checking off a
 * repeating item adds the next one (its date counted from the due date, always after today) unless that date is after
 * the end date (`ended` is then the end date); unticking it removes that copy again while the copy is still open.
 */
export async function setTaskDone(id: string, isDone: boolean): Promise<{ ok: true; next: string | null; ended?: string | null } | Fail> {
  const { sb, ctx } = await setup();
  const task = await taskOf(sb, ctx, id);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", task.id);
  if (error) return notSaved(error);
  let next: string | null = null;
  let ended: string | null = null;
  const repeat = parseRepeat(task.repeat);
  const until = cleanRepeatUntil(repeat, task.repeat_until);
  if (repeat) {
    const { data: copies } = await sb.from("deal_todos").select("id,done_at,due_on").eq("owner_id", ctx.ownerId).eq("repeat_from", task.id).limit(20);
    const open = ((copies ?? []) as Row[]).filter((c) => !c.done_at);
    if (isDone && !open.length) {
      next = nextCopyDate(task.due_on ? String(task.due_on) : null, repeat, ctx.today, until);
      if (next) {
        const copy: Row = { owner_id: ctx.ownerId, text: task.text, due_on: next, repeat, repeat_from: task.id, position: Number(task.position ?? 0), record_type: task.record_type ?? null, record_id: task.record_id ?? null, deal_id: task.deal_id ?? null };
        // The copy keeps the end date, so the series stops on the same day however many copies come before it.
        if (until) copy.repeat_until = until;
        const { error: e2 } = await sb.from("deal_todos").insert(copy);
        if (e2) return notSaved(e2);
      } else ended = until;
    } else if (isDone) {
      next = open[0].due_on ? String(open[0].due_on).slice(0, 10) : null;
    } else if (open.length) {
      await sb.from("deal_todos").delete().in("id", open.map((c) => String(c.id)));
    }
  }
  done();
  return { ok: true, next, ended };
}

/**
 * The edit box (To-dos, Work through, a record's Tasks card): the text, the date, Repeat with its end date, and (where
 * given) Link to. `link: null` unlinks: the item becomes a plain personal to-do again. `link` left out keeps the
 * record. "Does not repeat" clears the end date.
 */
export async function editTask(id: string, input: { text?: string; due?: string | null; repeat?: Repeat | "" | null; until?: string | null; link?: TaskLink }): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const task = await taskOf(sb, ctx, id);
  if (isFail(task)) return task;
  const update: Row = {};
  if (input.text !== undefined) {
    const text = cleanText(input.text);
    if (!text) return fail("It needs some text. Use the x to delete it.");
    update.text = text;
  }
  if (input.due !== undefined) update.due_on = cleanDate(input.due);
  if (input.repeat !== undefined) update.repeat = parseRepeat(input.repeat);
  if (input.repeat !== undefined || input.until !== undefined) {
    const repeat = input.repeat !== undefined ? parseRepeat(input.repeat) : parseRepeat(task.repeat);
    const until = cleanRepeatUntil(repeat, input.until !== undefined ? input.until : task.repeat_until);
    // Before the push D database update the column is missing; nothing to change then unless an end date was set.
    if (until !== ((task.repeat_until as string | null | undefined) ?? null) && ("repeat_until" in task || until)) update.repeat_until = until;
  }
  if (input.link !== undefined) {
    const cols = await linkColumns(sb, ctx, input.link);
    if (isFail(cols)) return cols;
    const moved = cols.record_id !== (task.record_id ?? null) || cols.record_type !== (task.record_type ?? null);
    Object.assign(update, cols);
    if (moved) update.position = await nextPosition(sb, ctx, cols);
  }
  if (!Object.keys(update).length) return { ok: true };
  const { error } = await sb.from("deal_todos").update(update).eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Later on a Home row or in Work through: tomorrow (the owner's date), or the date picked. */
export async function deferTask(id: string, date?: string | null): Promise<{ ok: true; due: string } | Fail> {
  const { sb, ctx } = await setup();
  const task = await taskOf(sb, ctx, id);
  if (isFail(task)) return task;
  const due = cleanDate(date) ?? addDaysISO(ctx.today, 1);
  const { error } = await sb.from("deal_todos").update({ due_on: due }).eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, due };
}

export async function deleteTask(id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const task = await taskOf(sb, ctx, id);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").delete().eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

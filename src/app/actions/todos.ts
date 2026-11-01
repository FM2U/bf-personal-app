"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { DB_UPDATE_NOTICE_0022, isMissingSchemaError } from "@/lib/schema-guard";
import { hasUpdate0022 } from "@/lib/update-0022";
import { nextPersonalTodoPosition } from "@/lib/work/personal-todos";
import type { Row } from "@/lib/types";

/**
 * The personal To-dos page (batch B, table todos, database update 0022): add, check off, edit the text, delete.
 * Not tied to records. Every action returns { ok: false, error } instead of throwing.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0022 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TODO_MAX = 300;
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

async function setup(): Promise<{ sb: SupabaseClient; ownerId: string } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  if (!(await hasUpdate0022(supabase))) return fail(DB_UPDATE_NOTICE_0022);
  return { sb: supabase, ownerId };
}

async function todoOf(sb: SupabaseClient, ownerId: string, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This to-do was not found.");
  const { data } = await sb.from("todos").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This to-do was not found. It may have been deleted.");
}

function done() {
  revalidatePath("/work/todos");
}

export async function addPersonalTodo(input: { text: string; due: string }): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ownerId } = s;
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, TODO_MAX);
  if (!text) return fail("Type the to-do first.");
  const { data: rows } = await sb.from("todos").select("position").eq("owner_id", ownerId).is("done_at", null).limit(1000);
  const position = nextPersonalTodoPosition(((rows ?? []) as Row[]).map((r) => ({ position: Number(r.position ?? 0) })));
  const { data, error } = await sb.from("todos").insert({ owner_id: ownerId, text, due_on: DATE.test(String(input.due ?? "")) ? String(input.due) : null, position }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

/** The checkbox: done (now) or open again. */
export async function setPersonalTodoDone(id: string, isDone: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ownerId } = s;
  const todo = await todoOf(sb, ownerId, id);
  if (isFail(todo)) return todo;
  const { error } = await sb.from("todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", todo.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Edit the text inline (and the date when given). */
export async function editPersonalTodo(id: string, input: { text: string; due?: string | null }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ownerId } = s;
  const todo = await todoOf(sb, ownerId, id);
  if (isFail(todo)) return todo;
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, TODO_MAX);
  if (!text) return fail("A to-do needs some text. Use the x to delete it.");
  const update: Row = { text };
  if (input.due !== undefined) update.due_on = input.due && DATE.test(input.due) ? input.due : null;
  const { error } = await sb.from("todos").update(update).eq("id", todo.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function deletePersonalTodo(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ownerId } = s;
  const todo = await todoOf(sb, ownerId, id);
  if (isFail(todo)) return todo;
  const { error } = await sb.from("todos").delete().eq("id", todo.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

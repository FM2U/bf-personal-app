"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { parseOrgKind } from "@/lib/work/people";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * The saves of Organizations and the organization page (push B, 2026-11-03): add, edit the facts, the next action
 * (Save, Done, Later), tasks, notes, people at the firm, Archive and Reopen. Every action returns { ok: false, error }
 * instead of throwing, so what was typed stays on the screen with the message.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(`Not saved: ${e?.message ?? "try again."}`);
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx }> {
  const { supabase, ownerId } = await requireOwner();
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function done() {
  revalidatePath("/", "layout");
}

async function orgOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(String(id ?? ""))) return fail("This organization was not found.");
  const { data } = await sb.from("organizations").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This organization was not found. It may have been deleted.");
}

export type OrgInput = { name: string; kind: string; region: string; website: string; phone: string; dealSize: string; note: string };

function orgRow(input: OrgInput, existingNotes: string | null): Row {
  const note = clean(input.note, 300);
  // The one-line description is the first line of the notes; the rest of the notes is kept.
  const rest = String(existingNotes ?? "").split("\n").slice(1).join("\n").trim();
  return {
    kind: parseOrgKind(input.kind),
    region: clean(input.region, 160),
    website: clean(input.website, 300),
    phone: clean(input.phone, 60),
    deal_size: clean(input.dealSize, 120),
    notes: note ? (rest ? `${note}\n${rest}` : note) : rest || null,
  };
}

/** Add an organization: a name is enough to start. A name already on the list opens that one instead. */
export async function createOrganization(input: OrgInput): Promise<{ ok: true; id: string; existed: boolean } | Fail> {
  const { sb, ctx } = await setup();
  const name = clean(input.name, 200);
  if (!name) return fail("Give the organization a name.");
  const { data: same } = await sb.from("organizations").select("id").eq("owner_id", ctx.ownerId).ilike("name", name).limit(1);
  const hit = ((same ?? []) as Row[])[0];
  if (hit) return { ok: true, id: String(hit.id), existed: true };
  const { data, error } = await sb.from("organizations").insert({ owner_id: ctx.ownerId, name, ...orgRow(input, null) }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id), existed: false };
}

/** The Facts card: name, kind, region, website, phone, deal size, the one-line description. */
export async function saveOrganizationFacts(id: string, input: OrgInput): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const name = clean(input.name, 200);
  if (!name) return fail("The organization needs a name.");
  const { error } = await sb.from("organizations").update({ name, ...orgRow(input, org.notes as string | null) }).eq("id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- The next action ----------

export async function saveOrgNextAction(id: string, input: { action: string; due: string }): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const action = clean(input.action, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const { error } = await sb.from("organizations").update({ next_action: action, next_action_due: action ? due ?? addDaysISO(ctx.today, 1) : null }).eq("id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Done: the next action is done (the card is empty until a new one is set). */
export async function orgNextActionDone(id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const { error } = await sb.from("organizations").update({ next_action: null, next_action_due: null }).eq("id", org.id);
  if (error) return notSaved(error);
  if (org.next_action) await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "organizations", record_id: org.id, body: `Done: ${String(org.next_action)}` });
  done();
  return { ok: true };
}

/** Later: the next action moves to the chosen date (tomorrow by default). */
export async function orgNextActionLater(id: string, date: string): Promise<{ ok: true; date: string } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("organizations").update({ next_action_due: due }).eq("id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, date: due };
}

// ---------- People at the firm ----------

/** "+ Add a person" on the organization page: an existing person moves to this firm, or a new person is added with a name. */
export async function addPersonToOrg(id: string, input: { contactId?: string | null; name?: string | null }): Promise<{ ok: true; contactId: string } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  if (input.contactId) {
    if (!UUID.test(input.contactId)) return fail("This person was not found.");
    const { data } = await sb.from("contacts").select("id").eq("owner_id", ctx.ownerId).eq("id", input.contactId).maybeSingle();
    if (!data) return fail("This person was not found.");
    const { error } = await sb.from("contacts").update({ organization_id: org.id }).eq("id", input.contactId);
    if (error) return notSaved(error);
    done();
    return { ok: true, contactId: input.contactId };
  }
  const name = clean(input.name, 200);
  if (!name) return fail("Pick a person or type a name.");
  const role = org.kind === "broker" ? "broker" : org.kind === "lender" ? "lender" : org.kind === "investor" ? "investor" : org.kind === "consulting_client" ? "consulting_client" : "other";
  const { data, error } = await sb.from("contacts").insert({ owner_id: ctx.ownerId, name, organization_id: org.id, outreach_role: role }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, contactId: String(data.id) };
}

/** Takes a person off this firm (the person stays on People). */
export async function removePersonFromOrg(id: string, contactId: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  if (!UUID.test(String(contactId ?? ""))) return fail("This person was not found.");
  const { error } = await sb.from("contacts").update({ organization_id: null }).eq("owner_id", ctx.ownerId).eq("id", contactId).eq("organization_id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- Notes, Archive, Reopen ----------

export async function addOrgNote(id: string, body: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const text = cleanText(body, 4000);
  if (!text) return fail("Type the note first.");
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "organizations", record_id: org.id, body: text });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Archive: the firm leaves Organizations (its people and deals stay; Reopen brings it back). */
export async function archiveOrganization(id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const { error } = await sb.from("organizations").update({ archived_at: new Date().toISOString() }).eq("id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function reopenOrganization(id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const { error } = await sb.from("organizations").update({ archived_at: null }).eq("id", org.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- Tasks on an organization (deal_todos, record_type organizations) ----------

async function orgTasks(sb: SupabaseClient, ctx: Ctx, id: string): Promise<DealTodo[]> {
  const { data } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "organizations").eq("record_id", id).limit(500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
}

async function taskOf(sb: SupabaseClient, ctx: Ctx, taskId: string): Promise<Row | Fail> {
  if (!UUID.test(String(taskId ?? ""))) return fail("This task was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", taskId).eq("record_type", "organizations").maybeSingle();
  return (data as Row | null) ?? fail("This task was not found. It may have been deleted.");
}

export async function addOrgTask(id: string, text: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const org = await orgOf(sb, ctx, id);
  if (isFail(org)) return org;
  const line = clean(text, TODO_MAX_LENGTH);
  if (!line) return fail("Type the task first.");
  const existing = await orgTasks(sb, ctx, String(org.id));
  const { error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "organizations", record_id: org.id, text: line, position: nextTodoPosition(existing) });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** "Make this the next action": the task becomes the firm's next action (due tomorrow unless a later date is set); the old one is kept as a task. */
export async function makeOrgTaskNext(taskId: string): Promise<{ ok: true; nextAction: string } | Fail> {
  const { sb, ctx } = await setup();
  const task = await taskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const org = await orgOf(sb, ctx, String(task.record_id));
  if (isFail(org)) return org;
  const text = String(task.text ?? "").trim();
  if (!text) return fail("This task is empty.");
  const current = org.next_action_due ? String(org.next_action_due).slice(0, 10) : null;
  const due = current && current > ctx.today ? current : addDaysISO(ctx.today, 1);
  const old = clean(org.next_action, TODO_MAX_LENGTH);
  const { error } = await sb.from("organizations").update({ next_action: text, next_action_due: due }).eq("id", org.id);
  if (error) return notSaved(error);
  await sb.from("deal_todos").delete().eq("id", task.id);
  if (old && old.toLowerCase() !== text.toLowerCase()) await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "organizations", record_id: org.id, text: old, position: 0 });
  done();
  return { ok: true, nextAction: text };
}

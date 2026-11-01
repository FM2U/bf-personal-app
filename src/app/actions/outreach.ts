"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { recordWorkEvent } from "@/lib/accountability/events";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, refreshNextActionAlert, type Ctx } from "@/lib/engine/helpers";
import { checkCommitments, releaseSupersededNextActions } from "@/lib/engine/tasks";
import { emailAddressProblem } from "@/lib/email-address";
import { DB_UPDATE_NOTICE_0022, isMissingSchemaError } from "@/lib/schema-guard";
import { hasUpdate0022 } from "@/lib/update-0022";
import { isRole, parsePurposes } from "@/lib/work/outreach";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * The saves of Outreach, the person page, Log a call, Log it, and the tasks on a person (batch B, database update
 * 0022). Every action returns { ok: false, error } instead of throwing, so what the owner typed stays on the screen
 * with the message. The pages re-read on the next load (router.refresh in the component). A person is a row of the
 * contacts table: the next follow-up is follow_up_date and follow_up_note, the one-line note is the first line of
 * notes.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0022 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  if (!(await hasUpdate0022(supabase))) return fail(DB_UPDATE_NOTICE_0022);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

async function personOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This person was not found.");
  const { data } = await sb.from("contacts").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This person was not found. They may have been deleted.");
}

function done() {
  revalidatePath("/", "layout");
}

/** The row buttons (Done, Later, Log a call, Log it) refresh the page themselves after the confirmation line shows. */
function doneQuietly() {}

/** The organization by name: an existing one of the owner's (any letter case), or a new row. Empty: none. */
async function organizationByName(sb: SupabaseClient, ctx: Ctx, name: string | null): Promise<string | null | Fail> {
  if (!name) return null;
  const { data } = await sb.from("organizations").select("id,name").eq("owner_id", ctx.ownerId).ilike("name", name).limit(1);
  const hit = ((data ?? []) as Row[])[0];
  if (hit) return String(hit.id);
  const { data: made, error } = await sb.from("organizations").insert({ owner_id: ctx.ownerId, name, kind: "other" }).select("id").single();
  if (error) return notSaved(error);
  return String(made.id);
}

export type PersonInput = { name: string; organization: string; role: string; purposes: string[]; email: string; phone: string; linkedin: string; nextFollowUp: string; note: string; title?: string; followUpFor?: string };

function personRow(input: PersonInput, existingNotes: string | null): Row {
  const email = clean(input.email, 200);
  const linkedin = clean(input.linkedin, 300);
  const note = clean(input.note, 300);
  // The one-line note is the first line of the contact's notes; the rest of the notes is kept.
  const rest = String(existingNotes ?? "").split("\n").slice(1).join("\n").trim();
  return {
    outreach_role: isRole(input.role) ? input.role : null,
    purposes: parsePurposes(input.purposes),
    email,
    phone: clean(input.phone, 60),
    linkedin_url: linkedin ? (linkedin.startsWith("http") || !linkedin.includes("linkedin.com") ? linkedin : `https://${linkedin}`) : null,
    follow_up_date: DATE.test(String(input.nextFollowUp ?? "")) ? String(input.nextFollowUp) : null,
    notes: note ? (rest ? `${note}\n${rest}` : note) : rest || null,
    ...(input.title !== undefined ? { title: clean(input.title, 120) } : {}),
    ...(input.followUpFor !== undefined ? { follow_up_note: clean(input.followUpFor, 300) } : {}),
  };
}

// ---------- Add a person and the Facts card ----------

/** Add a person: a new contact record with the Outreach fields. Name is enough to start. */
export async function createPerson(input: PersonInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const name = clean(input.name, 200);
  if (!name) return fail("Give the person a name.");
  if (clean(input.email, 200)) {
    const bad = emailAddressProblem(String(input.email).trim());
    if (bad) return fail(bad);
  }
  const orgId = await organizationByName(sb, ctx, clean(input.organization, 200));
  if (isFail(orgId)) return orgId;
  const row = { owner_id: ctx.ownerId, name, organization_id: orgId, ...personRow(input, null) };
  const { data, error } = await sb.from("contacts").insert(row).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

/** The Facts card on the person page: name, organization, role, title, purpose, email, phone, LinkedIn, the note. */
export async function savePersonFacts(id: string, input: PersonInput): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const name = clean(input.name, 200);
  if (!name) return fail("The person needs a name.");
  if (clean(input.email, 200)) {
    const bad = emailAddressProblem(String(input.email).trim());
    if (bad) return fail(bad);
  }
  const orgId = await organizationByName(sb, ctx, clean(input.organization, 200));
  if (isFail(orgId)) return orgId;
  const row = personRow({ ...input, nextFollowUp: person.follow_up_date ? String(person.follow_up_date) : "" }, person.notes as string | null);
  delete row.follow_up_date;
  const { error } = await sb.from("contacts").update({ name, organization_id: orgId, ...row }).eq("id", person.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- The next follow-up (the person page card, Done, Later) ----------

/** The task the morning job made for the follow-up date (source_key followup:<id>:<date>) follows the follow-up. */
async function settleFollowUpTask(sb: SupabaseClient, ctx: Ctx, person: Row, how: "done" | "moved", newDate: string | null) {
  if (!person.follow_up_date) return;
  const key = `followup:${person.id}:${String(person.follow_up_date).slice(0, 10)}`;
  const { data: tasks } = await sb.from("tasks").select("id").eq("owner_id", ctx.ownerId).eq("source_key", key).eq("status", "todo");
  for (const t of (tasks ?? []) as Row[]) {
    if (how === "done") await sb.from("tasks").update({ status: "done" }).eq("id", t.id);
    else if (newDate) await sb.from("tasks").update({ due_date: newDate, source_key: `followup:${person.id}:${newDate}` }).eq("id", t.id);
    else await sb.from("tasks").delete().eq("id", t.id);
  }
  if (how === "done") await checkCommitments(ctx, false).catch(() => null);
}

/** The Next follow-up card: the date and what the follow-up is for (Save). */
export async function saveFollowUp(id: string, input: { date: string; what: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const date = DATE.test(String(input.date ?? "")) ? String(input.date) : null;
  const { error } = await sb.from("contacts").update({ follow_up_date: date, follow_up_note: clean(input.what, 300) }).eq("id", person.id);
  if (error) return notSaved(error);
  if (date !== (person.follow_up_date ? String(person.follow_up_date).slice(0, 10) : null)) await settleFollowUpTask(sb, ctx, person, "moved", date);
  done();
  return { ok: true };
}

/**
 * Done on a person (Outreach row or the person page): the follow-up is done; the next date (or no date) and what
 * it is for are set. Done only sets the next date (approved 2026-10-31); nothing is logged.
 */
export async function completeFollowUp(id: string, input: { date: string | null; what: string }): Promise<{ ok: true; date: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const date = input.date && DATE.test(input.date) ? input.date : null;
  if (date && date <= ctx.today) return fail("Choose a date after today.");
  const what = clean(input.what, 300);
  const { error } = await sb.from("contacts").update({ follow_up_date: date, follow_up_note: what ?? (date ? (person.follow_up_note as string | null) : null) }).eq("id", person.id);
  if (error) return notSaved(error);
  await settleFollowUpTask(sb, ctx, person, "done", null);
  // Counted on Targets (batch C): a follow-up done, on time when done on or before its date (no date: on time).
  const due = person.follow_up_date ? String(person.follow_up_date).slice(0, 10) : null;
  await recordWorkEvent(sb, ctx.ownerId, { kind: "follow_up_done", recordType: "contacts", recordId: String(person.id), label: String(person.name), on: ctx.today, onTime: !due || ctx.today <= due, meta: { due, what: person.follow_up_note ?? null } });
  doneQuietly();
  return { ok: true, date };
}

/** Later: the next follow-up moves to the chosen date (tomorrow by default). */
export async function deferFollowUp(id: string, date: string): Promise<{ ok: true; date: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("contacts").update({ follow_up_date: due }).eq("id", person.id);
  if (error) return notSaved(error);
  await settleFollowUpTask(sb, ctx, person, "moved", due);
  doneQuietly();
  return { ok: true, date: due };
}

// ---------- Log a call ----------

export type LogCallInput = {
  /** The person called (prefilled on a person; chosen or typed on a deal). */
  contactId: string | null;
  /** The deal the call was about (prefilled on a deal page). */
  dealId: string | null;
  /** Who, as typed, when there is no contact record. */
  who: string;
  /** Local date and time from the form (YYYY-MM-DDTHH:MM). */
  when: string;
  minutes: string | number;
  said: string;
  /** Outcome: the next action or what the next follow-up is for. */
  nextAction: string;
  /** Outcome: the next follow-up date: "keep", "none", or YYYY-MM-DD. */
  nextDate: string;
};

/**
 * Log a call (the drawer): one communication of kind call on the record's timeline. The database keeps the
 * contact's last contact current; the weekly counter reads the same row. The outcome sets the person's next
 * follow-up (what for, date) or the deal's next action (text, due date).
 */
export async function logCall(input: LogCallInput): Promise<{ ok: true; commId: string; when: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = input.contactId ? await personOf(sb, ctx, input.contactId) : null;
  if (isFail(person)) return person;
  let deal: Row | null = null;
  if (input.dealId) {
    if (!UUID.test(input.dealId)) return fail("This deal was not found.");
    const { data } = await sb.from("pipeline_items").select("id,name,company_name,organization_id,primary_contact_id,next_action,next_action_due").eq("owner_id", ctx.ownerId).eq("id", input.dealId).maybeSingle();
    deal = (data as Row | null) ?? null;
    if (!deal) return fail("This deal was not found.");
  }
  const who = person ? String(person.name) : clean(input.who, 120);
  if (!who) return fail("Say who the call was with.");
  const minutesRaw = Number(String(input.minutes ?? "").replace(/[^\d.]/g, ""));
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.min(1440, Math.round(minutesRaw)) : null;
  // The drawer's time is to the minute. A call logged in the current minute is logged as of now (to the second), so it
  // comes after an email sent moments earlier and the last contact reads as the call.
  const typedWhen = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(input.when ?? "")) ? localToInstant(String(input.when), ctx.tz) : null;
  const nowIso = new Date().toISOString();
  const when = typedWhen && typedWhen.slice(0, 16) !== nowIso.slice(0, 16) ? typedWhen : nowIso;
  const said = cleanText(input.said, 4000);
  const next = clean(input.nextAction, 300);
  const row: Row = {
    owner_id: ctx.ownerId,
    occurred_at: when,
    method: "call",
    direction: "outgoing",
    contact_id: person ? person.id : (deal?.primary_contact_id ?? null),
    organization_id: person?.organization_id ?? deal?.organization_id ?? null,
    subject: `Call with ${who}`,
    summary: said,
    is_outreach: !!person,
    purpose: deal ? "general" : person?.is_consulting_lead ? "consulting" : person?.is_deal_source ? "deal_sourcing" : "general",
    pipeline_item_id: deal?.id ?? null,
    call_minutes: minutes,
    call_outcome: next,
  };
  const { data, error } = await sb.from("communications").insert(row).select("id").single();
  if (error) return notSaved(error);
  if (deal) await sb.from("record_links").insert({ owner_id: ctx.ownerId, from_type: "communications", from_id: data.id, to_type: "pipeline_items", to_id: deal.id, relation: "concerns" });
  const date = input.nextDate === "none" ? null : DATE.test(String(input.nextDate ?? "")) ? String(input.nextDate) : "keep";
  // The outcome on a person: the next follow-up. On a deal: the next action.
  if (person && !deal) {
    const update: Row = {};
    if (next) update.follow_up_note = next;
    if (date !== "keep") update.follow_up_date = date;
    if (Object.keys(update).length) {
      const { error: e2 } = await sb.from("contacts").update(update).eq("id", person.id);
      if (e2) return fail(`The call was logged, but the follow-up was not saved: ${e2.message}`);
      if (date !== "keep" && date !== (person.follow_up_date ? String(person.follow_up_date).slice(0, 10) : null)) await settleFollowUpTask(sb, ctx, person, "moved", date);
    }
  } else if (deal) {
    const update: Row = {};
    if (next) {
      update.next_action = next;
      update.next_action_due = date && date !== "keep" ? date : (deal.next_action_due ?? addDaysISO(ctx.today, 1));
      update.next_action_minutes = null;
    } else if (date !== "keep" && deal.next_action) update.next_action_due = date;
    if (Object.keys(update).length) {
      const { error: e2 } = await sb.from("pipeline_items").update(update).eq("id", deal.id);
      if (e2) return fail(`The call was logged, but the next action was not saved: ${e2.message}`);
      await releaseSupersededNextActions(ctx, String(deal.id)).catch(() => null);
      await refreshNextActionAlert(ctx).catch(() => null);
    }
  }
  doneQuietly();
  return { ok: true, commId: String(data.id), when };
}

/** "2026-11-03T10:40" in the owner's time zone as an instant (ISO). */
function localToInstant(local: string, tz: string): string {
  const guess = new Date(`${local}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (utc.getTime() - shown.getTime())).toISOString();
}

// ---------- Incoming replies and notes ----------

/** Log it: the incoming reply joins the timeline (and the last contact). */
export async function logIncoming(commId: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(commId)) return fail("This reply was not found.");
  const { data } = await sb.from("communications").select("id,awaiting_log").eq("owner_id", ctx.ownerId).eq("id", commId).maybeSingle();
  if (!data) return fail("This reply was not found.");
  const { error } = await sb.from("communications").update({ awaiting_log: false }).eq("id", commId);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true };
}

/** Add a note (the Timeline card on the person page). */
export async function addPersonNote(id: string, body: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const text = cleanText(body, 4000);
  if (!text) return fail("Type the note first.");
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "contacts", record_id: person.id, body: text });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- Decision: Archive and Reopen ----------

/** Archive: the person leaves Outreach (the record stays; Reopen brings them back). */
export async function archivePerson(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const { error } = await sb.from("contacts").update({ archived_at: new Date().toISOString() }).eq("id", person.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function reopenPerson(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const { error } = await sb.from("contacts").update({ archived_at: null }).eq("id", person.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- Tasks on a person (the same deal_todos table, record_type contacts) ----------

async function personTasks(sb: SupabaseClient, ctx: Ctx, id: string): Promise<DealTodo[]> {
  const { data } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "contacts").eq("record_id", id).limit(500);
  return ((data ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
}

async function personTaskOf(sb: SupabaseClient, ctx: Ctx, taskId: string): Promise<Row | Fail> {
  if (!UUID.test(taskId)) return fail("This task was not found.");
  const { data } = await sb.from("deal_todos").select("*").eq("owner_id", ctx.ownerId).eq("id", taskId).eq("record_type", "contacts").maybeSingle();
  return (data as Row | null) ?? fail("This task was not found. It may have been deleted.");
}

export async function addPersonTask(id: string, text: string): Promise<{ ok: true; taskId: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const person = await personOf(sb, ctx, id);
  if (isFail(person)) return person;
  const line = clean(text, TODO_MAX_LENGTH);
  if (!line) return fail("Type the task first.");
  const existing = await personTasks(sb, ctx, String(person.id));
  const { data, error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "contacts", record_id: person.id, text: line, position: nextTodoPosition(existing) }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, taskId: String(data.id) };
}

export async function setPersonTaskDone(taskId: string, isDone: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await personTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").update({ done_at: isDone ? new Date().toISOString() : null }).eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export async function deletePersonTask(taskId: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await personTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const { error } = await sb.from("deal_todos").delete().eq("id", task.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/**
 * "Make this the next action" on a person: the task becomes what the next follow-up is for, due tomorrow when there
 * is no date yet or the date is past; the task leaves the list. What the follow-up was for before is kept as a task.
 */
export async function makePersonTaskNext(taskId: string): Promise<{ ok: true; nextAction: string; due: string; kept: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const task = await personTaskOf(sb, ctx, taskId);
  if (isFail(task)) return task;
  const person = await personOf(sb, ctx, String(task.record_id));
  if (isFail(person)) return person;
  const text = String(task.text ?? "").trim();
  if (!text) return fail("This task is empty.");
  const current = person.follow_up_date ? String(person.follow_up_date).slice(0, 10) : null;
  const due = current && current > ctx.today ? current : addDaysISO(ctx.today, 1);
  const old = clean(person.follow_up_note, TODO_MAX_LENGTH);
  const keep = old && old.toLowerCase() !== text.toLowerCase() ? old : null;
  const { error } = await sb.from("contacts").update({ follow_up_note: text, follow_up_date: due }).eq("id", person.id);
  if (error) return notSaved(error);
  await sb.from("deal_todos").delete().eq("id", task.id);
  if (keep) await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "contacts", record_id: person.id, text: keep, position: 0 });
  if (due !== current) await settleFollowUpTask(sb, ctx, person, "moved", due);
  done();
  return { ok: true, nextAction: text, due, kept: keep };
}

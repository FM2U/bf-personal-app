"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { todayInTz } from "@/lib/calc/dates";
import { DB_UPDATE_NOTICE_PUSH_E2, isMissingSchemaError } from "@/lib/schema-guard";
import { loadWorkCtx, loadWorkPipeline, type WorkCtx } from "@/lib/work/data";
import { stageIndex } from "@/lib/work/stages";
import { replyWaitText, waitTarget } from "@/lib/work/waiting";
import { deleteWaits, followedUpWait, insertWait, WAIT_MAX, type WaitTarget } from "@/lib/work/waits-data";
import type { Row } from "@/lib/types";

/**
 * The saves of waiting (push E, push E2 approved 2026-11-05): Add to Waiting and Dismiss on a No reply yet row, Clear
 * on a Replied line, the restart after Follow up, and "+ Add" and × in the waits list of a deal, a job or consulting
 * item, or a person. A deal or person can hold several waits; each is one row of the waits table. Every action
 * returns { ok: false, error } instead of throwing. The card refreshes the page itself after a save (router.refresh).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_PUSH_E2 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

async function setup(): Promise<{ sb: SupabaseClient; ctx: WorkCtx }> {
  const { supabase, ownerId } = await requireOwner();
  return { sb: supabase, ctx: await loadWorkCtx(supabase, ownerId) };
}

/** An email the app sent (outgoing, by email), or a Fail. */
async function sentEmail(sb: SupabaseClient, ownerId: string, id: string): Promise<Row | Fail> {
  if (!UUID.test(String(id ?? ""))) return fail("This email was not found.");
  const { data } = await sb.from("communications").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  const c = data as Row | null;
  if (!c || c.direction !== "outgoing" || c.method !== "email") return fail("This email was not found. It may have been deleted.");
  return c;
}

/**
 * Add to Waiting: an email on an open deal adds the line "<Name>'s reply to your email "<subject>"" to the deal's waits, since the day it
 * was sent, and remembers the email; any other email (from a person or organization page, or about a job or
 * consulting item) adds the same line to the person it went to. It never replaces a wait already there (push E2).
 */
export async function addToWaiting(commId: string): Promise<{ ok: true; target: "deal" | "person"; name: string } | Fail> {
  const { sb, ctx } = await setup();
  const c = await sentEmail(sb, ctx.ownerId, commId);
  if (isFail(c)) return c;
  let item: { status: string; isDeal: boolean; name: string } | null = null;
  if (c.pipeline_item_id) {
    const [{ data: row }, pipe] = await Promise.all([sb.from("pipeline_items").select("id,name,company_name,status,screened,pipeline_id,stage_id").eq("owner_id", ctx.ownerId).eq("id", c.pipeline_item_id).maybeSingle(), loadWorkPipeline(sb, ctx.ownerId)]);
    const i = row as Row | null;
    if (i) {
      const stage = pipe && i.stage_id ? pipe.byId[String(i.stage_id)] : undefined;
      const isDeal = !!pipe && i.pipeline_id === pipe.id && i.screened !== false && stageIndex(stage?.name) >= 0;
      item = { status: String(i.status ?? "open"), isDeal, name: String(i.company_name || i.name) };
    }
  }
  const target = waitTarget(item ? { name: item.name, kind: "", status: item.status, isDeal: item.isDeal } : null, c.contact_id ? String(c.contact_id) : null);
  if (!target) return fail("This email has no open deal or person to wait on.");
  const table = target === "deal" ? "pipeline_items" : "contacts";
  const id = String(target === "deal" ? c.pipeline_item_id : c.contact_id);
  const { data: before, error: readError } = await sb.from(table).select("id,name").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (readError) return notSaved(readError);
  if (!before) return fail(target === "deal" ? "This deal was not found." : "This person was not found.");
  // Already waiting on this email (added twice from two tabs): nothing to add.
  const { data: dup, error: dupError } = await sb.from("waits").select("id").eq("owner_id", ctx.ownerId).eq("comm_id", String(c.id)).limit(1);
  if (dupError) return notSaved(dupError);
  if (!((dup ?? []) as Row[]).length) {
    const sentOn = todayInTz(ctx.tz, new Date(String(c.occurred_at)));
    // Item 3 of 2026-11-05: the wait names the person the email went to ("Dana Whitfield's reply to your email "...").
    let to: Row | null = null;
    if (target === "person") to = before as Row;
    else if (c.contact_id) to = (await sb.from("contacts").select("name").eq("owner_id", ctx.ownerId).eq("id", String(c.contact_id)).maybeSingle()).data as Row | null;
    const { error } = await insertWait(sb, ctx.ownerId, { table, id }, { text: replyWaitText(c.subject as string | null, to?.name ? String(to.name) : null), since: sentOn, commId: String(c.id) });
    if (error) return notSaved(error);
  }
  return { ok: true, target, name: target === "deal" ? (item?.name ?? "") : String((before as Row).name ?? "") };
}

/** Dismiss: the email stays off No reply yet. */
export async function dismissNoReply(commId: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const c = await sentEmail(sb, ctx.ownerId, commId);
  if (isFail(c)) return c;
  const { error } = await sb.from("communications").update({ no_reply_dismissed_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("id", c.id);
  if (error) return fail(`Not saved: ${error.message}`);
  return { ok: true };
}

/**
 * Clear on a Replied line, and × on a wait in a record's waits list: that one wait goes (the deal's or person's other
 * waits stay). The emails it watched stay off No reply yet.
 */
export async function removeWait(waitId: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  if (!UUID.test(String(waitId ?? ""))) return fail("This wait was not found.");
  const { error, count } = await deleteWaits(sb, ctx.ownerId, { waitId });
  if (error) return notSaved(error);
  if (!count) return fail("This wait was not found. It may have been removed already.");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "+ Add" in a record's waits list: a new line with what is waited on and since when (today when left empty). */
export async function addWait(kind: "deal" | "item" | "person", id: string, input: { text: string; since: string }): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  if (!UUID.test(String(id ?? ""))) return fail("This record was not found.");
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim().slice(0, WAIT_MAX);
  if (!text) return fail("Write what you are waiting on.");
  const since = DATE.test(String(input.since ?? "")) ? String(input.since) : ctx.today;
  if (since > ctx.today) return fail("Since cannot be after today.");
  const target: WaitTarget = { table: kind === "person" ? "contacts" : "pipeline_items", id };
  const { data, error: readError } = await sb.from(target.table).select("id").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (readError) return notSaved(readError);
  if (!data) return fail("This record was not found.");
  const { error } = await insertWait(sb, ctx.ownerId, target, { text, since });
  if (error) return notSaved(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Follow up sent from a line of the Waiting card: that wait starts again today and also watches the follow-up email,
 * so a reply to the original email or to the follow-up shows Replied (push E2, item 3).
 */
export async function followedUp(waitId: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  if (!UUID.test(String(waitId ?? ""))) return fail("This wait was not found.");
  const { error, found } = await followedUpWait(sb, ctx.ownerId, waitId, ctx.today);
  if (error) return notSaved(error);
  if (!found) return fail("This wait was not found.");
  return { ok: true };
}

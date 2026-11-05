"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { todayInTz } from "@/lib/calc/dates";
import { DB_UPDATE_NOTICE_PUSH_E, isMissingSchemaError } from "@/lib/schema-guard";
import { loadWorkCtx, loadWorkPipeline, type WorkCtx } from "@/lib/work/data";
import { stageIndex } from "@/lib/work/stages";
import { replyWaitText, waitTarget } from "@/lib/work/waiting";
import { dismissNoReplyEmail, moveWaitToNewestEmail } from "@/lib/work/waiting-data";
import type { Row } from "@/lib/types";

/**
 * The saves of the Waiting on someone card (push E, approved 2026-11-05): Add to Waiting and Dismiss on a No reply yet
 * row, Clear on a Replied row, and the restart after Follow up on a person. Every action returns { ok: false, error }
 * instead of throwing. The card refreshes the page itself after a save (router.refresh).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_PUSH_E : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
 * Add to Waiting: an email on an open deal sets the deal's Waiting on to "A reply to: <subject>", since the day it was
 * sent, and remembers the email; any other email (from a person or organization page, or about a job or consulting
 * item) sets the same on the person it went to. A wait that came from another email before is replaced, and that
 * email stays off No reply yet.
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
  const { data: before, error: readError } = await sb.from(table).select("id,name,waiting_comm_id").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (readError) return notSaved(readError);
  if (!before) return fail(target === "deal" ? "This deal was not found." : "This person was not found.");
  const sentOn = todayInTz(ctx.tz, new Date(String(c.occurred_at)));
  const { error } = await sb.from(table).update({ waiting_on: replyWaitText(c.subject as string | null), waiting_since: sentOn, waiting_comm_id: String(c.id) }).eq("owner_id", ctx.ownerId).eq("id", id);
  if (error) return notSaved(error);
  const old = (before as Row).waiting_comm_id ? String((before as Row).waiting_comm_id) : null;
  if (old && old !== String(c.id)) await dismissNoReplyEmail(sb, ctx.ownerId, old);
  return { ok: true, target, name: target === "deal" ? (item?.name ?? "") : String((before as Row).name ?? "") };
}

/** Dismiss: the email stays off No reply yet. */
export async function dismissNoReply(commId: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  const c = await sentEmail(sb, ctx.ownerId, commId);
  if (isFail(c)) return c;
  const { error } = await sb.from("communications").update({ no_reply_dismissed_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("id", c.id);
  if (error) return notSaved(error);
  return { ok: true };
}

/** Clear on a Replied row: Waiting on is emptied (and the email it came from is forgotten). */
export async function clearWaiting(kind: "deal" | "person", id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  if (!UUID.test(String(id ?? ""))) return fail("This record was not found.");
  const table = kind === "deal" ? "pipeline_items" : "contacts";
  const { data, error } = await sb.from(table).update({ waiting_on: null, waiting_since: null, waiting_comm_id: null }).eq("owner_id", ctx.ownerId).eq("id", id).select("id");
  if (error) return notSaved(error);
  if (!((data ?? []) as Row[]).length) return fail("This record was not found.");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Follow up sent to a person being waited on: the wait starts again today and moves to the follow-up email. */
export async function resetPersonWaiting(id: string): Promise<{ ok: true } | Fail> {
  const { sb, ctx } = await setup();
  if (!UUID.test(String(id ?? ""))) return fail("This person was not found.");
  const { data, error: readError } = await sb.from("contacts").select("id,waiting_on,waiting_comm_id").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  if (readError) return notSaved(readError);
  const p = data as Row | null;
  if (!p) return fail("This person was not found.");
  if (!p.waiting_on) return { ok: true };
  const { error } = await sb.from("contacts").update({ waiting_since: ctx.today }).eq("id", id);
  if (error) return notSaved(error);
  await moveWaitToNewestEmail(sb, ctx.ownerId, { table: "contacts", id, commId: p.waiting_comm_id ? String(p.waiting_comm_id) : null });
  return { ok: true };
}

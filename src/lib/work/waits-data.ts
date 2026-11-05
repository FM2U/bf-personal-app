import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { SavedWait } from "@/lib/work/waiting";
import type { Row } from "@/lib/types";

/**
 * The waits (push E2, approved 2026-11-05): table waits, one row per thing waited on, on a deal, a job or consulting
 * item (pipeline_item_id) or a person (contact_id). Every screen that shows waiting reads them through loadWaitsFor;
 * every save that adds, removes, or clears them goes through the helpers below. Before UPDATE_PREVIEW_PUSH_E2.sql runs
 * the table is missing: the loaders read no waits (`available` false) and the saves return DB_UPDATE_NOTICE_PUSH_E2.
 */

export const WAIT_COLUMNS = "id,pipeline_item_id,contact_id,text,since,comm_id,follow_up_comm_id,created_at";

/** The most characters a wait keeps (as Waiting on did). */
export const WAIT_MAX = 120;

export type WaitTarget = { table: "pipeline_items" | "contacts"; id: string };

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

export function toSavedWait(r: Row): SavedWait {
  return { id: String(r.id), text: String(r.text ?? ""), since: r.since ? String(r.since).slice(0, 10) : null, commId: str(r.comm_id), followUpCommId: str(r.follow_up_comm_id), createdAt: String(r.created_at ?? "") };
}

export type WaitsByRecord = { available: boolean; byItem: Record<string, SavedWait[]>; byContact: Record<string, SavedWait[]>; rows: Row[] };

/**
 * The waits of the given deals or items and people (both left out: every wait of the owner). Missing table: none,
 * with `available` false.
 */
export async function loadWaitsFor(sb: SupabaseClient, ownerId: string, ids: { itemIds?: readonly string[]; contactIds?: readonly string[] } = {}): Promise<WaitsByRecord> {
  const out: WaitsByRecord = { available: true, byItem: {}, byContact: {}, rows: [] };
  const reads: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>[] = [];
  const base = () => sb.from("waits").select(WAIT_COLUMNS).eq("owner_id", ownerId);
  if (!ids.itemIds && !ids.contactIds) reads.push(base().order("created_at").limit(5000));
  const chunks = (list: readonly string[]) => Array.from({ length: Math.ceil(list.length / 200) }, (_, n) => list.slice(n * 200, n * 200 + 200));
  for (const c of chunks([...new Set(ids.itemIds ?? [])])) reads.push(base().in("pipeline_item_id", c).order("created_at").limit(2000));
  for (const c of chunks([...new Set(ids.contactIds ?? [])])) reads.push(base().in("contact_id", c).order("created_at").limit(2000));
  for (const r of await Promise.all(reads)) {
    if (r.error) {
      if (isMissingSchemaError(r.error)) return { available: false, byItem: {}, byContact: {}, rows: [] };
      throw new Error(r.error.message);
    }
    out.rows.push(...((r.data ?? []) as Row[]));
  }
  for (const r of out.rows) {
    const w = toSavedWait(r);
    if (r.pipeline_item_id) (out.byItem[String(r.pipeline_item_id)] ??= []).push(w);
    else if (r.contact_id) (out.byContact[String(r.contact_id)] ??= []).push(w);
  }
  return out;
}

/** Marks emails so they stay off No reply yet (the wait that watched them was cleared, removed, or moved to a newer email). */
export async function dismissNoReplyEmails(sb: SupabaseClient, ownerId: string, commIds: readonly (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(commIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await sb.from("communications").update({ no_reply_dismissed_at: new Date().toISOString() }).eq("owner_id", ownerId).in("id", ids).is("no_reply_dismissed_at", null);
}

/** Adds one wait line. Returns the error from the database, if any. */
export async function insertWait(sb: SupabaseClient, ownerId: string, target: WaitTarget, w: { text: string; since: string; commId?: string | null }): Promise<{ error: { message: string; code?: string } | null; id: string | null }> {
  const row = { owner_id: ownerId, [target.table === "pipeline_items" ? "pipeline_item_id" : "contact_id"]: target.id, text: w.text.slice(0, WAIT_MAX), since: w.since, comm_id: w.commId ?? null };
  const { data, error } = await sb.from("waits").insert(row).select("id").maybeSingle();
  return { error, id: data ? String((data as Row).id) : null };
}

/**
 * Removes waits (× on a record page, Clear on the card, Advance, Pass, and Lost): the emails they watched stay off No
 * reply yet, since Bram already decided about them. `where` picks one wait or every wait of a record.
 */
export async function deleteWaits(sb: SupabaseClient, ownerId: string, where: { waitId: string } | WaitTarget): Promise<{ error: { message: string; code?: string } | null; count: number }> {
  const sel = sb.from("waits").select("id,comm_id,follow_up_comm_id").eq("owner_id", ownerId);
  const { data, error } = "waitId" in where ? await sel.eq("id", where.waitId) : await sel.eq(where.table === "pipeline_items" ? "pipeline_item_id" : "contact_id", where.id);
  if (error) return { error: isMissingSchemaError(error) && !("waitId" in where) ? null : error, count: 0 };
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { error: null, count: 0 };
  const { error: delError } = await sb.from("waits").delete().eq("owner_id", ownerId).in("id", rows.map((r) => String(r.id)));
  if (delError) return { error: delError, count: 0 };
  await dismissNoReplyEmails(sb, ownerId, rows.flatMap((r) => [str(r.comm_id), str(r.follow_up_comm_id)]));
  return { error: null, count: rows.length };
}

/**
 * After Follow up from the Waiting card: the wait starts again today and remembers the follow-up email just sent (the
 * newest email the app sent on this deal or to this person in the last 15 minutes). The email the wait came from stays
 * remembered, so a reply to either shows Replied (push E2, item 3). A follow-up remembered before (an earlier Follow
 * up) is replaced and stays off No reply yet.
 */
export async function followedUpWait(sb: SupabaseClient, ownerId: string, waitId: string, today: string): Promise<{ error: { message: string; code?: string } | null; found: boolean }> {
  const { data, error } = await sb.from("waits").select("id,pipeline_item_id,contact_id,comm_id,follow_up_comm_id").eq("owner_id", ownerId).eq("id", waitId).maybeSingle();
  if (error) return { error, found: false };
  const w = data as Row | null;
  if (!w) return { error: null, found: false };
  const recent = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: sent } = await sb
    .from("communications")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("direction", "outgoing")
    .eq("method", "email")
    .eq(w.pipeline_item_id ? "pipeline_item_id" : "contact_id", String(w.pipeline_item_id ?? w.contact_id))
    .not("gmail_thread_id", "is", null)
    .gte("occurred_at", recent)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const newest = ((sent ?? []) as Row[])[0];
  const newId = newest && String(newest.id) !== str(w.comm_id) ? String(newest.id) : str(w.follow_up_comm_id);
  const { error: upError } = await sb.from("waits").update({ since: today, follow_up_comm_id: newId }).eq("owner_id", ownerId).eq("id", waitId);
  if (upError) return { error: upError, found: true };
  const before = str(w.follow_up_comm_id);
  if (before && before !== newId) await dismissNoReplyEmails(sb, ownerId, [before]);
  return { error: null, found: true };
}

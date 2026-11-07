import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { oncePerPage } from "@/lib/request-once";
import type { Row } from "@/lib/types";

/**
 * Speed plan (Bram, 2026-11-07; claude/2026-11-07-speed-plan.md): reads shared by several parts of a page, read once
 * per page build for the whole owner instead of "the rows of these ids". A read by ids has to wait for the read that
 * found the ids; a read of the owner's rows can start at once, in the page's one trip, and each part keeps the rows it
 * needs. These tables stay small for one person (hundreds of rows), and each read has a limit well above that.
 */

/** `full`: the read reached its limit, so some rows may be missing; callers then read their rows by id (pickOrRead). */
export type SharedRows = { data: Row[] | null; error: { message: string; code?: string } | null; full: boolean };
type Read = Promise<SharedRows>;
/** A shared read: its rows, error, and whether it reached `limit`. */
export const rowsOf = (p: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, limit = Infinity): Read => rows(p, limit);
const rows = (p: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, limit = Infinity): Read =>
  Promise.resolve(p).then((r) => ({ data: (r.data ?? null) as Row[] | null, error: r.error, full: Array.isArray(r.data) && r.data.length >= limit }));

/** Every open task and to-do of the owner (deal_todos with no done date), every column. */
export function ownerOpenTasks(sb: SupabaseClient, ownerId: string): Read {
  return oncePerPage(`open_tasks:${ownerId}`, () => rows(sb.from("deal_todos").select("*").eq("owner_id", ownerId).is("done_at", null).limit(5000), 5000));
}

/** The financials of every deal and listing of the owner. */
export function ownerFinancials(sb: SupabaseClient, ownerId: string): Read {
  return oncePerPage(`deal_financials:${ownerId}`, () => rows(sb.from("deal_financials").select("item_id,revenue,ebitda,sde,asking_price").eq("owner_id", ownerId).limit(20000), 20000));
}

/** Every contact of the owner (archived ones too), with the few columns rows show beside a deal or item. */
export function ownerContactsLite(sb: SupabaseClient, ownerId: string): Read {
  return oncePerPage(`contacts_lite:${ownerId}`, () => rows(sb.from("contacts").select("id,name,email,organization_id,outreach_role,archived_at").eq("owner_id", ownerId).limit(5000), 5000));
}

/**
 * The rows of `ids` from a shared read; when that read reached its limit (rows may be missing), the rows are read by
 * id instead, as before the speed plan, so nothing is ever left out.
 */
export async function pickOrRead(shared: Read, col: string, ids: readonly string[], byId: (ids: string[]) => PromiseLike<{ data: unknown }>): Promise<Row[]> {
  if (!ids.length) return [];
  const r = await shared;
  if (!r.full && !r.error) return pick(r.data, col, ids);
  const out: Row[] = [];
  for (let n = 0; n < ids.length; n += 200) out.push(...(((await byId(ids.slice(n, n + 200))).data ?? []) as Row[]));
  return out;
}

/** Keeps the rows whose `col` is one of `ids`. */
export function pick(list: Row[] | null | undefined, col: string, ids: Iterable<unknown>): Row[] {
  const want = new Set([...ids].map(String));
  return (list ?? []).filter((r) => r[col] !== null && r[col] !== undefined && want.has(String(r[col])));
}

/**
 * The names and states of the records a task can belong to (deals, listings, items, people, organizations, projects),
 * read for the whole owner at the start of a page that lists tasks, so the names come in the same trip as the tasks.
 */
export function ownerRecordNames(sb: SupabaseClient, ownerId: string) {
  return {
    items: oncePerPage(`names_items:${ownerId}`, () => rows(sb.from("pipeline_items").select("id,name,company_name,status,screened,pipeline_id").eq("owner_id", ownerId).limit(5000), 5000)),
    people: ownerContactsLite(sb, ownerId),
    orgs: oncePerPage(`names_orgs:${ownerId}`, () => rows(sb.from("organizations").select("id,name,archived_at").eq("owner_id", ownerId).limit(5000), 5000)),
    projects: oncePerPage(`names_projects:${ownerId}`, () => rows(sb.from("projects").select("id,name,status").eq("owner_id", ownerId).limit(1000), 1000)),
    pipes: oncePerPage(`names_pipes:${ownerId}`, () => rows(sb.from("pipelines").select("id,kind").eq("owner_id", ownerId))),
  };
}

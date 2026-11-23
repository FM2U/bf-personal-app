"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { cleanSource, parseReviewed, sourceChoices, toEntry, type ReviewedEntry } from "@/lib/accountability/listings-reviewed";
import { DB_UPDATE_NOTICE_PUSH_J, isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Listings reviewed (push J, Bram 2026-11-23): the entries of a day, adding one, changing one, removing one. The panel
 * that calls these (src/components/app/work/listings-reviewed.tsx) refreshes the page after a save, so End of day's
 * checklist, Today's activity and the report read the new total.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_PUSH_J : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS = "id,day,reviewed,source,created_at";

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

/** The day asked for when it is a real date not after today; otherwise today. */
function dayOf(ctx: Ctx, day: unknown): string {
  const d = String(day ?? "");
  return DATE.test(d) && d <= ctx.today ? d : ctx.today;
}

/** The day's entries (oldest first) and the sources to offer (from the last 90 days). */
export async function listReviewed(day?: string | null): Promise<{ ok: true; day: string; entries: ReviewedEntry[]; sources: string[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const d = dayOf(ctx, day);
  const { data, error } = await sb.from("listings_reviewed").select(COLUMNS).eq("owner_id", ctx.ownerId).gte("day", addDaysISO(ctx.today, -90)).order("created_at").limit(2000);
  if (error) return isMissingSchemaError(error) ? fail(DB_UPDATE_NOTICE_PUSH_J) : fail(`Could not read the entries: ${error.message}`);
  const all = ((data ?? []) as Row[]).map(toEntry).filter((e): e is ReviewedEntry => !!e);
  return { ok: true, day: d, entries: all.filter((e) => e.day === d), sources: sourceChoices(all) };
}

export async function addReviewed(input: { day?: string | null; reviewed: string | number; source?: string | null }): Promise<{ ok: true; entry: ReviewedEntry } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const n = parseReviewed(input.reviewed);
  if (!n.ok) return fail(n.error);
  const { data, error } = await sb.from("listings_reviewed").insert({ owner_id: ctx.ownerId, day: dayOf(ctx, input.day), reviewed: n.value, source: cleanSource(input.source) }).select(COLUMNS).single();
  if (error) return notSaved(error);
  const entry = toEntry(data as Row);
  return entry ? { ok: true, entry } : fail("Not saved: try again.");
}

export async function editReviewed(id: string, input: { reviewed: string | number; source?: string | null }): Promise<{ ok: true; entry: ReviewedEntry } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(id))) return fail("This entry was not found.");
  const n = parseReviewed(input.reviewed);
  if (!n.ok) return fail(n.error);
  const { data, error } = await sb.from("listings_reviewed").update({ reviewed: n.value, source: cleanSource(input.source) }).eq("owner_id", ctx.ownerId).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) return notSaved(error);
  const entry = data ? toEntry(data as Row) : null;
  return entry ? { ok: true, entry } : fail("This entry was not found. It may have been removed.");
}

export async function removeReviewed(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(id))) return fail("This entry was not found.");
  const { error } = await sb.from("listings_reviewed").delete().eq("owner_id", ctx.ownerId).eq("id", id);
  if (error) return notSaved(error);
  return { ok: true };
}

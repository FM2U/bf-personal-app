"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { isStrength, MAX_PICKS, pickName, planRanks, type PriorityKind, type PriorityTable } from "@/lib/work/priorities";
import { PRIORITY_UPDATE_NOTICE } from "@/lib/work/priorities-data";
import type { Row } from "@/lib/types";

/**
 * Top priorities (Bram, 2026-11-15): put a record in a track's top three or take it off, its Why it fits, How strong
 * and Next decision, Mark decided, and the records a "+ Choose" slot offers. Every action returns { ok: false, error }
 * instead of throwing, so what was typed stays on the screen with the message.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const notSaved = (e: { message?: string | null; code?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? PRIORITY_UPDATE_NOTICE : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

type Rec = { sb: SupabaseClient; ctx: Ctx; table: PriorityTable; row: Row; kind: PriorityKind; open: boolean };

async function recordOf(table: unknown, id: unknown): Promise<Rec | Fail> {
  if ((table !== "pipeline_items" && table !== "projects") || !UUID.test(String(id))) return fail("This record was not found.");
  const { supabase: sb, ownerId } = await requireOwner();
  const ctx = await loadCtx(sb, ownerId);
  if (table === "projects") {
    const { data, error } = await sb.from("projects").select("id,name,status,priority_rank").eq("owner_id", ownerId).eq("id", String(id)).maybeSingle();
    if (error) return notSaved(error);
    if (!data) return fail("This project was not found. It may have been deleted.");
    return { sb, ctx, table, row: data as Row, kind: "startup", open: (data as Row).status === "open" };
  }
  const { data, error } = await sb.from("pipeline_items").select("id,name,status,screened,pipeline_id,priority_rank").eq("owner_id", ownerId).eq("id", String(id)).maybeSingle();
  if (error) return notSaved(error);
  if (!data) return fail("This record was not found. It may have been deleted.");
  const row = data as Row;
  const { data: pipe } = await sb.from("pipelines").select("kind").eq("owner_id", ownerId).eq("id", String(row.pipeline_id)).maybeSingle();
  const kind = String((pipe as Row | null)?.kind ?? "");
  if (kind !== "acquisition" && kind !== "job" && kind !== "consulting") return fail("Only deals, jobs, consulting items and Rosara projects can be top priorities.");
  return { sb, ctx, table, row, kind, open: row.status === "open" && !(kind === "acquisition" && row.screened === false) };
}

function done() {
  revalidatePath("/", "layout");
}

/**
 * Put a record at place `to` (1 to 3) of its track, or take it off (null). The others keep their order, close up, and
 * move down one place from `to`; a fourth falls off. Ranks left on closed records of the track are cleared first.
 */
export async function setPriorityRank(input: { table: PriorityTable; id: string; to: number | null }): Promise<{ ok: true } | Fail> {
  const rec = await recordOf(input.table, input.id);
  if (isFail(rec)) return rec;
  const to = input.to === null ? null : Number(input.to);
  if (to !== null && !(Number.isInteger(to) && to >= 1 && to <= MAX_PICKS)) return fail("Pick a place from 1 to 3.");
  if (to !== null && !rec.open) return fail("Only an open record can be a top priority.");
  const { sb, ctx, table } = rec;
  const scope =
    table === "projects"
      ? sb.from("projects").select("id,status,priority_rank").eq("owner_id", ctx.ownerId).not("priority_rank", "is", null)
      : sb.from("pipeline_items").select("id,status,screened,priority_rank").eq("owner_id", ctx.ownerId).eq("pipeline_id", String(rec.row.pipeline_id)).not("priority_rank", "is", null);
  const { data, error } = await scope.limit(100);
  if (error) return notSaved(error);
  const ranked = (data ?? []) as Row[];
  const isOpen = (r: Row) => r.status === "open" && !(rec.kind === "acquisition" && r.screened === false);
  const stale = ranked.filter((r) => !isOpen(r) && String(r.id) !== String(input.id)).map((r) => String(r.id));
  const current = ranked.filter(isOpen).sort((a, b) => Number(a.priority_rank) - Number(b.priority_rank)).map((r) => String(r.id));
  const plan = planRanks(current, String(input.id), to);
  const was = new Map(ranked.map((r) => [String(r.id), r.priority_rank === null ? null : Number(r.priority_rank)]));
  const changed = [...plan].filter(([id, rank]) => (was.get(id) ?? null) !== rank).map(([id]) => id);
  // One place holds one record (a unique rank per track): clear every record that moves, then set the new places.
  const clear = [...new Set([...stale, ...changed])];
  if (clear.length) {
    const { error: e1 } = await sb.from(table).update({ priority_rank: null }).eq("owner_id", ctx.ownerId).in("id", clear);
    if (e1) return notSaved(e1);
  }
  const setNow: string[] = [];
  for (const id of changed) {
    const rank = plan.get(id) ?? null;
    if (rank === null) continue;
    const { error: e2 } = await sb.from(table).update({ priority_rank: rank }).eq("owner_id", ctx.ownerId).eq("id", id);
    if (e2) {
      // Put the track back the way it was, so a failed save never leaves picks cleared.
      if (setNow.length) await sb.from(table).update({ priority_rank: null }).eq("owner_id", ctx.ownerId).in("id", setNow);
      for (const back of clear) {
        const r = was.get(back) ?? null;
        if (r !== null) await sb.from(table).update({ priority_rank: r }).eq("owner_id", ctx.ownerId).eq("id", back);
      }
      return notSaved(e2);
    }
    setNow.push(id);
  }
  done();
  return { ok: true };
}

/** Why it fits, How strong, Next decision and its date; only the fields sent are saved (an empty one clears). */
export async function savePriorityFields(input: { table: PriorityTable; id: string; whyFits?: string; strength?: string | null; nextDecision?: string; nextDecisionOn?: string | null }): Promise<{ ok: true } | Fail> {
  const rec = await recordOf(input.table, input.id);
  if (isFail(rec)) return rec;
  const patch: Row = {};
  if (input.whyFits !== undefined) patch.why_fits = String(input.whyFits ?? "").replace(/\r\n/g, "\n").trim().slice(0, 400) || null;
  if (input.strength !== undefined) {
    if (input.strength !== null && !isStrength(input.strength)) return fail("How strong is Hot, Warm or Cold.");
    patch.strength = input.strength;
  }
  if (input.nextDecision !== undefined) patch.next_decision = oneLine(input.nextDecision, 200);
  if (input.nextDecisionOn !== undefined) {
    const d = input.nextDecisionOn ? String(input.nextDecisionOn) : null;
    if (d !== null && !DATE.test(d)) return fail("The decision date is not a date.");
    patch.next_decision_on = d;
  }
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await rec.sb.from(rec.table).update(patch).eq("owner_id", rec.ctx.ownerId).eq("id", String(input.id));
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Mark decided: one line in the decisions list (dated today), and the Next decision and its date are cleared. */
export async function markDecided(input: { table: PriorityTable; id: string; outcome: "go" | "no_go"; line?: string }): Promise<{ ok: true } | Fail> {
  const rec = await recordOf(input.table, input.id);
  if (isFail(rec)) return rec;
  if (input.outcome !== "go" && input.outcome !== "no_go") return fail("Pick Go or No-go.");
  const { sb, ctx, table } = rec;
  const { error } = await sb.from("decisions").insert({ owner_id: ctx.ownerId, [table === "projects" ? "project_id" : "pipeline_item_id"]: String(input.id), decided_on: ctx.today, outcome: input.outcome, line: oneLine(input.line, 300) });
  if (error) return notSaved(error);
  const { error: e2 } = await sb.from(table).update({ next_decision: null, next_decision_on: null }).eq("owner_id", ctx.ownerId).eq("id", String(input.id));
  if (e2) return notSaved(e2);
  done();
  return { ok: true };
}

export type PriorityCandidate = { id: string; table: PriorityTable; name: string; stage: string | null };

/** The open records of a track that are not picks yet, for a "+ Choose" slot (at most 200, by name). */
export async function priorityCandidates(kind: PriorityKind): Promise<{ ok: true; list: PriorityCandidate[] } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  if (kind === "startup") {
    const { data, error } = await sb.from("projects").select("id,name,milestone").eq("owner_id", ownerId).eq("status", "open").is("priority_rank", null).order("name").limit(200);
    if (error) return notSaved(error);
    return { ok: true, list: ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), table: "projects", name: String(r.name ?? "Untitled"), stage: r.milestone ? String(r.milestone) : null })) };
  }
  if (kind !== "acquisition" && kind !== "job" && kind !== "consulting") return fail("Unknown track.");
  const { data: pipes, error: pe } = await sb.from("pipelines").select("id").eq("owner_id", ownerId).eq("kind", kind);
  if (pe) return notSaved(pe);
  const ids = ((pipes ?? []) as Row[]).map((p) => String(p.id));
  if (!ids.length) return { ok: true, list: [] };
  let q = sb.from("pipeline_items").select("id,name,company_name,role_title,what_it_does,stage_id").eq("owner_id", ownerId).in("pipeline_id", ids).eq("status", "open").is("priority_rank", null);
  if (kind === "acquisition") q = q.eq("screened", true);
  const [{ data, error }, { data: stages }] = await Promise.all([q.order("name").limit(200), sb.from("pipeline_stages").select("id,name").eq("owner_id", ownerId).in("pipeline_id", ids)]);
  if (error) return notSaved(error);
  const stageOf = new Map(((stages ?? []) as Row[]).map((s) => [String(s.id), String(s.name)]));
  const list = ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), table: "pipeline_items" as const, name: pickName(kind, r), stage: stageOf.get(String(r.stage_id)) ?? null }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, list };
}

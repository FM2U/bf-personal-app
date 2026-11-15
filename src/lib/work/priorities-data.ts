import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadCtx } from "@/lib/engine/helpers";
import { oncePerPage } from "@/lib/request-once";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { rowsOf } from "@/lib/work/shared-reads";
import { buildPriorityColumns, isStrength, PRIORITY_KINDS, type PriorityColumns, type PriorityKind, type PriorityTable, type Strength } from "@/lib/work/priorities";
import type { Row } from "@/lib/types";

/**
 * Top priorities (Bram, 2026-11-15; rules in src/lib/work/priorities.ts). Every read starts at once, so on a page they
 * go in the page's one trip (speed plan): the ranked deals, jobs and consulting items, the ranked Rosara projects, the
 * pipelines, the stage names, and the recent changes of the next decision date (for "moved").
 */

export const PRIORITY_UPDATE_NOTICE = "Top priorities need the database update of Nov 15 (supabase/UPDATE_PREVIEW_PUSH_I.sql).";

const ITEM_COLS = "id,name,company_name,role_title,what_it_does,pipeline_id,stage_id,status,screened,created_at,stage_entered_at,priority_rank,why_fits,strength,next_decision,next_decision_on";
const PROJECT_COLS = "id,name,milestone,status,created_at,priority_rank,why_fits,strength,next_decision,next_decision_on";

export type PrioritiesData = { ready: true; columns: PriorityColumns; today: string } | { ready: false; notice: string };

function reads(sb: SupabaseClient, ownerId: string) {
  // Only recent changes matter for "moved" (a decision date is weeks out, not months).
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  return {
    items: oncePerPage(`prio_items:${ownerId}`, () => rowsOf(sb.from("pipeline_items").select(ITEM_COLS).eq("owner_id", ownerId).not("priority_rank", "is", null).limit(200))),
    projects: oncePerPage(`prio_projects:${ownerId}`, () => rowsOf(sb.from("projects").select(PROJECT_COLS).eq("owner_id", ownerId).not("priority_rank", "is", null).limit(50))),
    pipes: oncePerPage(`names_pipes:${ownerId}`, () => rowsOf(sb.from("pipelines").select("id,kind").eq("owner_id", ownerId))),
    stages: oncePerPage(`prio_stages:${ownerId}`, () => rowsOf(sb.from("pipeline_stages").select("id,name").eq("owner_id", ownerId).limit(500))),
    moves: oncePerPage(`prio_moves:${ownerId}`, () =>
      rowsOf(sb.from("change_log").select("record_id,old_value,new_value,created_at").eq("owner_id", ownerId).eq("field", "next_decision_on").in("table_name", ["pipeline_items", "projects"]).gte("created_at", since).order("created_at", { ascending: false }).limit(1000)),
    ),
  };
}

/** The picks of every track (Home) or of one (a track's page). */
export async function loadPriorities(sb: SupabaseClient, ownerId: string): Promise<PrioritiesData> {
  const r = reads(sb, ownerId);
  const [ctx, items, projects, pipes, stages, moves] = await Promise.all([loadCtx(sb, ownerId), r.items, r.projects, r.pipes, r.stages, r.moves]);
  const missing = [items, projects].find((x) => x.error);
  if (missing) return { ready: false, notice: isMissingSchemaError(missing.error) ? PRIORITY_UPDATE_NOTICE : `Top priorities could not be read: ${missing.error?.message}` };
  const localDate = (ts: string) => todayInTz(ctx.tz, new Date(ts));
  const columns = buildPriorityColumns({ items: items.data ?? [], projects: projects.data ?? [], pipelines: pipes.data ?? [], stages: stages.data ?? [], moves: moves.data ?? [], today: ctx.today, localDate });
  return { ready: true, columns, today: ctx.today };
}

export type RecordPriority =
  | {
      ready: true;
      table: PriorityTable;
      id: string;
      kind: PriorityKind;
      /** 1 to 3 among the open picks of its track, or null when not a pick. */
      number: number | null;
      /** The picks of its track now (for the place menu: "#2 now Meridian"). */
      track: { id: string; name: string; number: number }[];
      whyFits: string;
      strength: Strength | null;
      nextDecision: string;
      nextDecisionOn: string | null;
      /** The latest decision marked on this record. */
      lastDecision: { on: string; outcome: "go" | "no_go"; line: string | null } | null;
      today: string;
    }
  | { ready: false; notice: string };

/** The Top priority fields of one record page (started with the page's other reads, so they share its trip). */
export async function loadRecordPriority(sb: SupabaseClient, ownerId: string, table: PriorityTable, id: string, kind: PriorityKind): Promise<RecordPriority> {
  const own = sb.from(table).select("id,priority_rank,why_fits,strength,next_decision,next_decision_on").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  const decided = rowsOf(sb.from("decisions").select("decided_on,outcome,line,created_at").eq("owner_id", ownerId).eq(table === "projects" ? "project_id" : "pipeline_item_id", id).order("created_at", { ascending: false }).limit(1));
  const [all, mine, last] = await Promise.all([loadPriorities(sb, ownerId), own, decided]);
  if (!all.ready) return all;
  if (mine.error) return { ready: false, notice: isMissingSchemaError(mine.error) ? PRIORITY_UPDATE_NOTICE : `Not read: ${mine.error.message}` };
  const r = (mine.data ?? {}) as Row;
  const track = all.columns[kind].map((p) => ({ id: p.id, name: p.name, number: p.number }));
  const d = (last.data ?? [])[0] as Row | undefined;
  return {
    ready: true,
    table,
    id,
    kind,
    number: track.find((p) => p.id === id)?.number ?? null,
    track,
    whyFits: String(r.why_fits ?? ""),
    strength: isStrength(r.strength) ? r.strength : null,
    nextDecision: String(r.next_decision ?? ""),
    nextDecisionOn: r.next_decision_on ? String(r.next_decision_on).slice(0, 10) : null,
    lastDecision: d ? { on: String(d.decided_on).slice(0, 10), outcome: d.outcome === "go" ? "go" : "no_go", line: d.line ? String(d.line) : null } : null,
    today: all.today,
  };
}

export { PRIORITY_KINDS };

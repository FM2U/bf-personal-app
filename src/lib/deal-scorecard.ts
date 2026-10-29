import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dealScorecard, type Scorecard } from "@/lib/calc/deal-scorecard";
import type { StageLite } from "@/lib/calc/pipeline";
import { DETAIL_TABLE, type ItemStatus } from "@/lib/pipeline";
import type { Row } from "@/lib/types";

/**
 * Loads what the deal scorecard needs that the pages do not already have (the item's detail record) and computes it.
 * The checks themselves are in src/lib/calc/deal-scorecard.ts (tested).
 */

export function stageLites(stages: Row[]): StageLite[] {
  return stages.map((s) => ({
    id: String(s.id),
    position: Number(s.position),
    outcome: String(s.outcome ?? "open"),
    name: s.name,
    required_fields: Array.isArray(s.required_fields) ? s.required_fields : [],
  }));
}

/** Scorecard from data already loaded (pipeline list rows: the detail records are read once for the whole list). */
export function scorecardFrom(p: { item: Row; detail: Row | null | undefined; stages: StageLite[]; status: ItemStatus | null | undefined; stallDays: number; today: string }): Scorecard {
  const st = p.status;
  return dealScorecard({
    item: { status: String(p.item.status), stage_id: p.item.stage_id ?? null, next_action: p.item.next_action ?? null, next_action_due: p.item.next_action_due ?? null },
    stages: p.stages,
    // The item's own fields win over detail fields with the same name (the same rule as the stage move check).
    values: { ...(p.detail ?? {}), ...p.item },
    today: p.today,
    daysInStage: st?.limit?.daysInStage ?? (st?.enteredDate ? Math.max(0, Math.round((Date.parse(p.today) - Date.parse(st.enteredDate)) / 864e5)) : null),
    limitDays: st?.limit?.limit ?? null,
    lastActivity: st?.lastActivity ?? null,
    stallDays: p.stallDays,
  });
}

/** Scorecard for one item (window and full item page): reads its detail record. */
export async function loadScorecard(sb: SupabaseClient, p: { item: Row; pipelineKind: string | null; stages: Row[]; status: ItemStatus | null | undefined; stallDays: number; today: string }): Promise<Scorecard> {
  const table = DETAIL_TABLE[p.pipelineKind ?? ""];
  let detail: Row | null = null;
  if (table) detail = ((await sb.from(table).select("*").eq("item_id", p.item.id).maybeSingle()).data as Row | null) ?? null;
  return scorecardFrom({ item: p.item, detail, stages: stageLites(p.stages), status: p.status, stallDays: p.stallDays, today: p.today });
}

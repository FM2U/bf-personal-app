import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import {
  completionRate,
  consecutive,
  countByDay,
  countInRange,
  periodHistory,
  periodResult,
  rangeTotals,
  type DayCounts,
  type PeriodResult,
  type TargetDef,
} from "@/lib/calc/targets";
import { outreachStats, type OutreachStats } from "@/lib/calc/outreach";
import { countDealsAdvanced, countDealsSourced, sourcedBreakdownByDay, sumBreakdown, type SourceBreakdown } from "@/lib/calc/pipeline";
import { countDealCalls, countFirstReach, stagePosition, toStageEntries, CALL_METHODS } from "@/lib/calc/deal-funnel";
import { fetchAll } from "@/lib/data";
import { scoped } from "@/lib/finance";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Loads Daily Targets and the counts behind them. Counts for automatic sources are read from the source records:
 * outreach communications, pipeline items created, or manual taps (target_entries).
 * Never throws: when database update 0008 is not applied, `available` is false.
 */

export type TargetRow = Row & { def: TargetDef };

export type TargetsData = {
  available: boolean;
  error?: string;
  targets: TargetRow[];
  counts: Record<string, DayCounts>;
  /** Deals sourced targets: proprietary, brokered, and not set per date. */
  breakdown: Record<string, Record<string, SourceBreakdown>>;
  misses: Row[];
  from: string;
  to: string;
};

export function targetDef(t: Row): TargetDef {
  return {
    id: t.id,
    period: t.period === "week" ? "week" : "day",
    minimum_count: Number(t.minimum_count) || 1,
    active_weekdays: Array.isArray(t.active_weekdays) ? t.active_weekdays.map(Number) : [1, 2, 3, 4, 5],
    start_date: String(t.start_date ?? (t.created_at ? String(t.created_at).slice(0, 10) : "2000-01-01")),
  };
}

const empty = (from: string, to: string, available: boolean, error?: string): TargetsData => ({ available, error, targets: [], counts: {}, breakdown: {}, misses: [], from, to });

/** Local date (YYYY-MM-DD) of a timestamp in the owner's time zone. */
function localDate(ts: string, tz: string): string {
  return todayInTz(tz, new Date(ts));
}

export async function loadTargets(
  sb: SupabaseClient,
  opts: { ownerId?: string; tz: string; from: string; to: string; includeInactive?: boolean },
): Promise<TargetsData> {
  const { ownerId, tz, from, to } = opts;
  try {
    let q = scoped(sb.from("targets").select("*"), ownerId);
    if (!opts.includeInactive) q = q.eq("active", true);
    const { data, error } = await q.order("sort_order").order("name");
    if (error) return isMissingSchemaError(error) ? empty(from, to, false) : empty(from, to, true, error.message);
    const targets = ((data ?? []) as Row[]).map((t) => ({ ...t, def: targetDef(t) })) as TargetRow[];
    if (!targets.length) return { ...empty(from, to, true) };

    const sources = new Set(targets.map((t) => t.count_source));
    // Timestamps are stored in UTC; read one extra day on each side, then keep local dates in range.
    const tsFrom = `${addDaysISO(from, -1)}T00:00:00Z`;
    const tsTo = `${addDaysISO(to, 1)}T23:59:59Z`;
    const inRange = (d: string) => d >= from && d <= to;

    const needItems = sources.has("pipeline_items_created") || sources.has("deals_sourced");
    const needDeals = sources.has("deals_sourced") || sources.has("deals_advanced");
    const itemsQuery = (cols: string) =>
      fetchAll((a, b) => scoped(sb.from("pipeline_items").select(cols), ownerId).gte("created_at", tsFrom).lte("created_at", tsTo).order("created_at").range(a, b));
    const needFunnel = sources.has("cims_reviewed") || sources.has("deal_calls");
    const [outreach, items, entries, misses, deals, funnel] = await Promise.all([
      sources.has("communications_outreach")
        ? fetchAll((a, b) => scoped(sb.from("communications").select("occurred_at"), ownerId).eq("is_outreach", true).gte("occurred_at", tsFrom).lte("occurred_at", tsTo).order("occurred_at").range(a, b))
        : Promise.resolve([] as Row[]),
      needItems
        ? // deal_source_type exists after database update 0009; before it, read without it.
          itemsQuery("id,pipeline_id,created_at,deal_source_type").catch(() => itemsQuery("id,pipeline_id,created_at"))
        : Promise.resolve([] as Row[]),
      sources.has("manual")
        ? fetchAll((a, b) => scoped(sb.from("target_entries").select("target_id,entry_date,count"), ownerId).gte("entry_date", from).lte("entry_date", to).order("entry_date").range(a, b))
        : Promise.resolve([] as Row[]),
      scoped(sb.from("target_misses").select("*"), ownerId).gte("period_start", addDaysISO(from, -7)).lte("period_start", to),
      needDeals ? loadDealSources(sb, ownerId, tsFrom, tsTo, sources.has("deals_advanced")) : Promise.resolve(null),
      needFunnel ? loadFunnelSources(sb, ownerId, tsFrom, tsTo, sources) : Promise.resolve(null),
    ]);
    if (misses.error && isMissingSchemaError(misses.error)) return empty(from, to, false);

    const outreachCounts = countByDay(outreach.map((c) => ({ date: localDate(c.occurred_at, tz) })).filter((c) => inRange(c.date)));
    const counts: Record<string, DayCounts> = {};
    const breakdown: Record<string, Record<string, SourceBreakdown>> = {};
    for (const t of targets) {
      if (t.count_source === "communications_outreach") counts[t.id] = outreachCounts;
      else if (t.count_source === "pipeline_items_created") {
        counts[t.id] = countByDay(
          items
            .filter((i) => !t.pipeline_id || i.pipeline_id === t.pipeline_id)
            .map((i) => ({ date: localDate(i.created_at, tz) }))
            .filter((i) => inRange(i.date)),
        );
      } else if (t.count_source === "deals_sourced") {
        // New items in the target's pipeline, or in every acquisition pipeline when none is set.
        const inPipe = (pid: string) => (t.pipeline_id ? pid === t.pipeline_id : deals?.acquisitionPipelines.has(pid) ?? false);
        const list = items
          .filter((i) => inPipe(i.pipeline_id))
          .map((i) => ({ id: i.id, date: localDate(i.created_at, tz), deal_source_type: i.deal_source_type ?? null }))
          .filter((i) => inRange(i.date));
        counts[t.id] = countDealsSourced(list);
        breakdown[t.id] = sourcedBreakdownByDay(list);
      } else if (t.count_source === "deals_advanced") {
        counts[t.id] = deals ? dealsAdvancedCounts(t, deals, tz, inRange) : {};
      } else if (t.count_source === "cims_reviewed") {
        counts[t.id] = funnel ? cimsReviewedCounts(t, funnel, tz, inRange) : {};
      } else if (t.count_source === "deal_calls") {
        counts[t.id] = funnel ? dealCallsCounts(t, funnel, tz, inRange) : {};
      } else counts[t.id] = countByDay(entries.filter((e) => e.target_id === t.id).map((e) => ({ date: e.entry_date, count: Number(e.count) || 1 })));
    }
    return { available: true, targets, counts, breakdown, misses: (misses.data ?? []) as Row[], from, to };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (isMissingSchemaError(err)) return empty(from, to, false);
    return empty(from, to, true, err?.message ?? String(e));
  }
}

type DealSources = {
  acquisitionPipelines: Set<string>;
  stages: Row[];
  itemPipeline: Record<string, string>;
  /** Item creation time in milliseconds: the stage entered at creation is not a move. */
  itemCreated: Record<string, number>;
  moves: Row[];
  comms: Row[];
};

/** Records behind the deal targets: pipelines, stages, stage moves, and CIM request or source contact communications. */
async function loadDealSources(sb: SupabaseClient, ownerId: string | undefined, tsFrom: string, tsTo: string, advanced: boolean): Promise<DealSources> {
  const [pipes, stages, itemRows, moves, comms] = await Promise.all([
    scoped(sb.from("pipelines").select("id,kind"), ownerId),
    advanced ? scoped(sb.from("pipeline_stages").select("id,pipeline_id,name,position,outcome"), ownerId) : Promise.resolve({ data: [] }),
    advanced ? fetchAll((a, b) => scoped(sb.from("pipeline_items").select("id,pipeline_id,created_at"), ownerId).range(a, b)) : Promise.resolve([] as Row[]),
    advanced
      ? fetchAll((a, b) => scoped(sb.from("stage_history").select("item_id,stage_id,entered_at"), ownerId).gte("entered_at", tsFrom).lte("entered_at", tsTo).order("entered_at").range(a, b))
      : Promise.resolve([] as Row[]),
    advanced
      ? fetchAll((a, b) =>
          scoped(sb.from("communications").select("pipeline_item_id,occurred_at,purpose"), ownerId)
            .in("purpose", ["cim_request", "source_contact"])
            .gte("occurred_at", tsFrom)
            .lte("occurred_at", tsTo)
            .order("occurred_at")
            .range(a, b),
        ).catch(() => [] as Row[])
      : Promise.resolve([] as Row[]),
  ]);
  return {
    acquisitionPipelines: new Set(((pipes.data ?? []) as Row[]).filter((p) => p.kind === "acquisition").map((p) => p.id)),
    stages: (stages.data ?? []) as Row[],
    itemPipeline: Object.fromEntries(itemRows.map((i) => [i.id, i.pipeline_id])),
    itemCreated: Object.fromEntries(itemRows.map((i) => [i.id, new Date(i.created_at).getTime()])),
    moves,
    comms,
  };
}

/**
 * Deals advanced for one target. Threshold stage: the target's stage, otherwise "NDA signed" in the pipeline,
 * otherwise position 3. Only items in the target's pipeline (or every acquisition pipeline) count.
 */
function dealsAdvancedCounts(t: Row, d: DealSources, tz: string, inRange: (date: string) => boolean): DayCounts {
  const inPipe = (pid: string | undefined) => !!pid && (t.pipeline_id ? pid === t.pipeline_id : d.acquisitionPipelines.has(pid));
  const stageById = Object.fromEntries(d.stages.map((s) => [s.id, s]));
  const thresholdFor = (pid: string) => {
    const own = t.stage_id ? stageById[t.stage_id] : null;
    if (own && own.pipeline_id === pid) return Number(own.position);
    const nda = d.stages.find((s) => s.pipeline_id === pid && String(s.name).toLowerCase() === "nda signed");
    return nda ? Number(nda.position) : 3;
  };
  // The first stage an item is created in is not a move: it counts as sourced, not advanced.
  const moves = d.moves
    .filter((m) => new Date(m.entered_at).getTime() !== d.itemCreated[m.item_id])
    .map((m) => {
      const st = stageById[m.stage_id];
      const pid = st?.pipeline_id ?? d.itemPipeline[m.item_id];
      return { item_id: m.item_id, pid, date: localDate(m.entered_at, tz), position: st ? Number(st.position) : null, outcome: st?.outcome ?? null };
    })
    .filter((m) => inPipe(m.pid) && inRange(m.date));
  const comms = d.comms
    .map((c) => ({ item_id: c.pipeline_item_id, pid: d.itemPipeline[c.pipeline_item_id], date: localDate(c.occurred_at, tz), purpose: c.purpose }))
    .filter((c) => inPipe(c.pid) && inRange(c.date));
  // Positions are compared per pipeline; normalize each move to "at or past" its pipeline's threshold.
  const normalized = moves.map((m) => ({ ...m, position: m.position === null ? null : m.position >= thresholdFor(m.pid) ? 1 : 0 }));
  return countDealsAdvanced({ moves: normalized, comms, minPosition: 1 });
}

type FunnelSources = {
  acquisitionPipelines: Set<string>;
  stages: Row[];
  items: Record<string, { pipeline_id: string; created_at: string }>;
  /** Every stage entry of every item (not only the date range): CIMs reviewed counts each item once, ever. */
  history: Row[];
  calls: Row[];
};

/** Records behind the deal funnel targets (update 0016): pipelines, stages, items, all stage history, and calls. */
async function loadFunnelSources(sb: SupabaseClient, ownerId: string | undefined, tsFrom: string, tsTo: string, sources: Set<string>): Promise<FunnelSources> {
  const cims = sources.has("cims_reviewed");
  const [pipes, stages, itemRows, history, calls] = await Promise.all([
    scoped(sb.from("pipelines").select("id,kind"), ownerId),
    cims ? scoped(sb.from("pipeline_stages").select("id,pipeline_id,name,position,outcome"), ownerId) : Promise.resolve({ data: [] }),
    fetchAll((a, b) => scoped(sb.from("pipeline_items").select("id,pipeline_id,created_at"), ownerId).range(a, b)),
    cims ? fetchAll((a, b) => scoped(sb.from("stage_history").select("item_id,stage_id,entered_at"), ownerId).order("entered_at").range(a, b)) : Promise.resolve([] as Row[]),
    sources.has("deal_calls")
      ? fetchAll((a, b) =>
          scoped(sb.from("communications").select("pipeline_item_id,occurred_at,method"), ownerId)
            .in("method", CALL_METHODS)
            .not("pipeline_item_id", "is", null)
            .gte("occurred_at", tsFrom)
            .lte("occurred_at", tsTo)
            .order("occurred_at")
            .range(a, b),
        ).catch(() => [] as Row[])
      : Promise.resolve([] as Row[]),
  ]);
  return {
    acquisitionPipelines: new Set(((pipes.data ?? []) as Row[]).filter((p) => p.kind === "acquisition").map((p) => p.id)),
    stages: (stages.data ?? []) as Row[],
    items: Object.fromEntries(itemRows.map((i) => [i.id, { pipeline_id: i.pipeline_id, created_at: i.created_at }])),
    history,
    calls,
  };
}

/** Items in the target's pipeline, or in every acquisition pipeline when none is set. */
function funnelItems(t: Row, f: FunnelSources) {
  const inPipe = (pid: string) => (t.pipeline_id ? pid === t.pipeline_id : f.acquisitionPipelines.has(pid));
  return Object.fromEntries(Object.entries(f.items).filter(([, i]) => inPipe(i.pipeline_id)));
}

/** CIMs reviewed: each item once, on the local date it first moved into the target's stage (default CIM reviewed) or later. */
function cimsReviewedCounts(t: Row, f: FunnelSources, tz: string, inRange: (date: string) => boolean): DayCounts {
  const entries = toStageEntries(
    f.history as { item_id: string; stage_id: string | null; entered_at: string }[],
    f.stages as never,
    funnelItems(t, f),
    (pid) => stagePosition(f.stages as never, pid, "CIM reviewed", 4, t.stage_id),
    (ts) => localDate(ts, tz),
  );
  return Object.fromEntries(Object.entries(countFirstReach(entries)).filter(([d]) => inRange(d)));
}

/** Broker or owner calls: calls, meetings, and video calls on the target's items, one per item per local date. */
function dealCallsCounts(t: Row, f: FunnelSources, tz: string, inRange: (date: string) => boolean): DayCounts {
  const items = funnelItems(t, f);
  const comms = f.calls
    .filter((c) => items[c.pipeline_item_id])
    .map((c) => ({ item_id: c.pipeline_item_id as string, date: localDate(c.occurred_at, tz), method: c.method as string }))
    .filter((c) => inRange(c.date));
  return countDealCalls(comms);
}

/** Today's proprietary and brokered counts for a Deals sourced target (null for other targets). */
export function todayBreakdown(data: TargetsData, targetId: string, start: string, end: string) {
  const b = data.breakdown[targetId];
  return b ? sumBreakdown(b, start, end) : null;
}

export type TargetSummary = {
  target: TargetRow;
  today: PeriodResult;
  /** Deals sourced targets: proprietary and brokered counts in the current period. Null for other targets. */
  breakdown: ReturnType<typeof sumBreakdown> | null;
  history: PeriodResult[];
  rate: ReturnType<typeof completionRate>;
  metInARow: number;
  missedInARow: number;
};

/** Today's progress, history, completion rate, and consecutive periods met or missed. Today stays open. */
export function summarizeTargets(data: TargetsData, today: string): TargetSummary[] {
  const yesterday = addDaysISO(today, -1);
  return data.targets.map((t) => {
    const counts = data.counts[t.id] ?? {};
    const history = periodHistory(t.def, counts, data.from, today, yesterday);
    const current = periodResult(t.def, counts, today, yesterday);
    return {
      target: t,
      today: current,
      breakdown: todayBreakdown(data, t.id, current.start, current.end),
      history,
      rate: completionRate(history),
      metInARow: consecutive(history, "met"),
      missedInARow: consecutive(history, "missed"),
    };
  });
}

/** Target periods marked as commitments, decided between start and end (used in the commitment score). */
export function targetCommitmentTally(data: TargetsData, start: string, end: string, closedThrough: string): { met: number; missed: number } {
  let met = 0;
  let missed = 0;
  for (const t of data.targets) {
    if (!t.is_commitment) continue;
    const hist = periodHistory(t.def, data.counts[t.id] ?? {}, start, end, closedThrough).filter((r) => r.end <= end);
    met += hist.filter((r) => r.status === "met").length;
    missed += hist.filter((r) => r.status === "missed").length;
  }
  return { met, missed };
}

/** Per-target totals for a review or partner report period. */
export function targetTotals(data: TargetsData, start: string, end: string, closedThrough: string, filter?: (t: TargetRow) => boolean) {
  return data.targets.filter((t) => (filter ? filter(t) : true)).map((t) => {
    const totals = rangeTotals(t.def, data.counts[t.id] ?? {}, start, end, closedThrough);
    const history = periodHistory(t.def, data.counts[t.id] ?? {}, addDaysISO(end, -120) < data.from ? data.from : addDaysISO(end, -120), end, closedThrough);
    const missReasons = data.misses
      .filter((m) => m.target_id === t.id && m.period_start >= start && m.period_start <= end && m.reason)
      .map((m) => ({ date: m.period_start, reason: m.reason }));
    return {
      id: t.id,
      name: t.name,
      period: t.period,
      minimum: Number(t.minimum_count),
      ...totals,
      met_in_a_row: consecutive(history, "met"),
      miss_reasons: missReasons,
    };
  });
}

/** Value of a target measured number for decision conditions. Params: {"target": "<name>", "days": 7} or {"weeks": 4}. */
export function targetMetric(data: TargetsData | null, today: string, key: string, params: Row | null | undefined): number | null {
  if (!data?.available || !data.targets.length) return null;
  const p = params ?? {};
  const wanted = String(p.target ?? "").toLowerCase();
  const t = wanted ? data.targets.find((x) => String(x.name).toLowerCase() === wanted || x.id === p.target) : data.targets.length === 1 ? data.targets[0] : undefined;
  if (!t) return null;
  const counts = data.counts[t.id] ?? {};
  const yesterday = addDaysISO(today, -1);
  switch (key) {
    case "target_count_last_days": {
      const days = Math.max(1, Math.min(180, Number(p.days ?? 7) || 7));
      return countInRange(counts, addDaysISO(today, -(days - 1)), today);
    }
    case "target_count_last_weeks": {
      const weeks = Math.max(1, Math.min(26, Number(p.weeks ?? 4) || 4));
      return countInRange(counts, addDaysISO(today, -(weeks * 7 - 1)), today);
    }
    case "target_missed_in_a_row":
      return consecutive(periodHistory(t.def, counts, data.from, today, yesterday), "missed");
    case "target_met_in_a_row":
      return consecutive(periodHistory(t.def, counts, data.from, today, yesterday), "met");
    default:
      return null;
  }
}

/** Outreach totals for a date range (local dates). Null when update 0008 is not applied. */
export async function loadOutreachStats(sb: SupabaseClient, opts: { ownerId?: string; tz: string; from: string; to: string }): Promise<OutreachStats | null> {
  try {
    const read = (cols: string) =>
      fetchAll((a, b) =>
        scoped(sb.from("communications").select(cols), opts.ownerId)
          .eq("is_outreach", true)
          .gte("occurred_at", `${addDaysISO(opts.from, -1)}T00:00:00Z`)
          .lte("occurred_at", `${addDaysISO(opts.to, 1)}T23:59:59Z`)
          .order("occurred_at")
          .range(a, b),
      );
    // purpose exists after database update 0009 (deal-sourcing share); before it, read without it.
    const rows = await read("occurred_at,outcome,purpose").catch(() => read("occurred_at,outcome"));
    return outreachStats(rows.filter((r) => {
      const d = localDate(r.occurred_at, opts.tz);
      return d >= opts.from && d <= opts.to;
    }) as { outcome: string | null; purpose?: string | null }[]);
  } catch {
    // Update 0008 not applied yet (no is_outreach column), or the read failed: no outreach numbers.
    return null;
  }
}

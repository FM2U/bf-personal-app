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

const empty = (from: string, to: string, available: boolean, error?: string): TargetsData => ({ available, error, targets: [], counts: {}, misses: [], from, to });

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

    const [outreach, items, entries, misses] = await Promise.all([
      sources.has("communications_outreach")
        ? fetchAll((a, b) => scoped(sb.from("communications").select("occurred_at"), ownerId).eq("is_outreach", true).gte("occurred_at", tsFrom).lte("occurred_at", tsTo).order("occurred_at").range(a, b))
        : Promise.resolve([] as Row[]),
      sources.has("pipeline_items_created")
        ? fetchAll((a, b) => scoped(sb.from("pipeline_items").select("pipeline_id,created_at"), ownerId).gte("created_at", tsFrom).lte("created_at", tsTo).order("created_at").range(a, b))
        : Promise.resolve([] as Row[]),
      sources.has("manual")
        ? fetchAll((a, b) => scoped(sb.from("target_entries").select("target_id,entry_date,count"), ownerId).gte("entry_date", from).lte("entry_date", to).order("entry_date").range(a, b))
        : Promise.resolve([] as Row[]),
      scoped(sb.from("target_misses").select("*"), ownerId).gte("period_start", addDaysISO(from, -7)).lte("period_start", to),
    ]);
    if (misses.error && isMissingSchemaError(misses.error)) return empty(from, to, false);

    const outreachCounts = countByDay(outreach.map((c) => ({ date: localDate(c.occurred_at, tz) })).filter((c) => inRange(c.date)));
    const counts: Record<string, DayCounts> = {};
    for (const t of targets) {
      if (t.count_source === "communications_outreach") counts[t.id] = outreachCounts;
      else if (t.count_source === "pipeline_items_created") {
        counts[t.id] = countByDay(
          items
            .filter((i) => !t.pipeline_id || i.pipeline_id === t.pipeline_id)
            .map((i) => ({ date: localDate(i.created_at, tz) }))
            .filter((i) => inRange(i.date)),
        );
      } else counts[t.id] = countByDay(entries.filter((e) => e.target_id === t.id).map((e) => ({ date: e.entry_date, count: Number(e.count) || 1 })));
    }
    return { available: true, targets, counts, misses: (misses.data ?? []) as Row[], from, to };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (isMissingSchemaError(err)) return empty(from, to, false);
    return empty(from, to, true, err?.message ?? String(e));
  }
}

export type TargetSummary = {
  target: TargetRow;
  today: PeriodResult;
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
    return {
      target: t,
      today: periodResult(t.def, counts, today, yesterday),
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
    const rows = await fetchAll((a, b) =>
      scoped(sb.from("communications").select("occurred_at,outcome"), opts.ownerId)
        .eq("is_outreach", true)
        .gte("occurred_at", `${addDaysISO(opts.from, -1)}T00:00:00Z`)
        .lte("occurred_at", `${addDaysISO(opts.to, 1)}T23:59:59Z`)
        .order("occurred_at")
        .range(a, b),
    );
    return outreachStats(rows.filter((r) => {
      const d = localDate(r.occurred_at, opts.tz);
      return d >= opts.from && d <= opts.to;
    }) as { outcome: string | null }[]);
  } catch {
    // Update 0008 not applied yet (no is_outreach column), or the read failed: no outreach numbers.
    return null;
  }
}

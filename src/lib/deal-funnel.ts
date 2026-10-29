import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, daysBetween, todayInTz } from "@/lib/calc/dates";
import {
  buildFunnel,
  CALL_METHODS,
  conversionNotes,
  countedCalls,
  DEFAULT_DEAL_TARGETS,
  firstReachDates,
  stagePosition,
  suggestTargets,
  toStageEntries,
  type FunnelStep,
  type Suggestion,
} from "@/lib/calc/deal-funnel";
import { countInRange } from "@/lib/calc/targets";
import { fetchAll } from "@/lib/data";
import { scoped } from "@/lib/finance";
import { loadTargets, summarizeTargets, type TargetSummary, type TargetsData } from "@/lib/targets";
import { hasUpdate0016 } from "@/lib/update-0016";
import type { Row } from "@/lib/types";

/**
 * Loads the deal funnel for an acquisition pipeline (Acquisitions page) and the suggested deal targets (also on Targets).
 * Never throws: when database update 0016 is not applied, `available` is false, Listings screened is not counted,
 * and the suggestion uses the default hours, minutes, and targets.
 */

export const FUNNEL_WINDOWS = [30, 90] as const;
export type FunnelWindow = (typeof FUNNEL_WINDOWS)[number];

export function resolveFunnelWindow(v: string | undefined): FunnelWindow {
  return Number(v) === 90 ? 90 : 30;
}

const INPUT_KEYS = ["search_hours_per_day", "minutes_per_listing_screen", "minutes_per_cim_review", "minutes_per_nda_reply", "minutes_per_call"];

export type DealPlan = { available: boolean; suggestion: Suggestion; hours: number };

/** The deal targets used for the suggestion mix (active targets by count source; defaults where one is missing). */
function targetMix(data: TargetsData) {
  const active = data.targets.filter((t) => t.active);
  const find = (pred: (t: Row) => boolean) => active.find(pred);
  const listings = find((t) => t.count_source === "manual" && String(t.name).toLowerCase() === "listings screened");
  const sourced = find((t) => t.count_source === "deals_sourced");
  const cims = find((t) => t.count_source === "cims_reviewed");
  const calls = find((t) => t.count_source === "deal_calls");
  // A day target's minimum per weekday; a week target's minimum per week (and the other way round for calls).
  const perDay = (t: Row | undefined, d: number) => (!t ? d : t.period === "week" ? Number(t.minimum_count) / 5 : Number(t.minimum_count));
  const perWeek = (t: Row | undefined, d: number) => (!t ? d : t.period === "week" ? Number(t.minimum_count) : Number(t.minimum_count) * (t.active_weekdays?.length || 5));
  return {
    listings: perDay(listings, DEFAULT_DEAL_TARGETS.listings),
    replies: perDay(sourced, DEFAULT_DEAL_TARGETS.replies),
    cims: perDay(cims, DEFAULT_DEAL_TARGETS.cims),
    callsPerWeek: perWeek(calls, DEFAULT_DEAL_TARGETS.callsPerWeek),
  };
}

/** Suggested targets from the Inputs (search hours, minutes per step) and the current deal targets. */
export async function loadDealPlan(sb: SupabaseClient, opts: { ownerId?: string; targets: TargetsData; available?: boolean }): Promise<DealPlan> {
  const available = opts.available ?? (await hasUpdate0016(sb));
  const { data } = await scoped(sb.from("inputs").select("key,value_number"), opts.ownerId).in("key", INPUT_KEYS);
  const v = Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.key, r.value_number === null ? null : Number(r.value_number)]));
  const suggestion = suggestTargets({
    hours: v.search_hours_per_day ?? NaN,
    minutes: { listing: v.minutes_per_listing_screen ?? NaN, cim: v.minutes_per_cim_review ?? NaN, reply: v.minutes_per_nda_reply ?? NaN, call: v.minutes_per_call ?? NaN },
    targets: targetMix(opts.targets),
  });
  return { available, suggestion, hours: suggestion.hours };
}

/** The manual target whose +1 buttons show on this pipeline's page: linked to the pipeline, else named Listings screened. */
export function listingsTarget(summaries: TargetSummary[], pipelineId?: string): TargetSummary | null {
  const manual = summaries.filter((s) => s.target.count_source === "manual" && s.target.active);
  return (
    (pipelineId ? manual.find((s) => s.target.pipeline_id === pipelineId) : undefined) ??
    manual.find((s) => String(s.target.name).toLowerCase() === "listings screened") ??
    null
  );
}

export type FunnelData = {
  available: boolean;
  days: FunnelWindow;
  from: string;
  to: string;
  steps: FunnelStep[];
  /** Days with data in the window (from the first listing entry or deal, at most the window). */
  dataDays: number;
  /** Days of Listings screened counting in the window. */
  listingsDays: number;
  notes: string[];
  plan: DealPlan;
  listings: TargetSummary | null;
};

export async function loadDealFunnel(
  sb: SupabaseClient,
  opts: { ownerId?: string; tz: string; today: string; pipelineId: string; days: FunnelWindow },
): Promise<FunnelData> {
  const { ownerId, tz, today, pipelineId, days } = opts;
  const from = addDaysISO(today, -(days - 1));
  const local = (ts: string) => todayInTz(tz, new Date(ts));
  const tsFrom = `${addDaysISO(from, -1)}T00:00:00Z`;
  const tsTo = `${addDaysISO(today, 1)}T23:59:59Z`;
  const [available, targets, stagesRes, itemRows, history, comms] = await Promise.all([
    hasUpdate0016(sb),
    loadTargets(sb, { ownerId, tz, from, to: today }),
    scoped(sb.from("pipeline_stages").select("id,pipeline_id,name,position,outcome"), ownerId).eq("pipeline_id", pipelineId),
    fetchAll((a, b) => scoped(sb.from("pipeline_items").select("*"), ownerId).eq("pipeline_id", pipelineId).order("created_at").range(a, b)).catch(() => [] as Row[]),
    fetchAll((a, b) => scoped(sb.from("stage_history").select("item_id,stage_id,entered_at"), ownerId).order("entered_at").range(a, b)).catch(() => [] as Row[]),
    fetchAll((a, b) =>
      scoped(sb.from("communications").select("pipeline_item_id,occurred_at,method"), ownerId)
        .in("method", CALL_METHODS)
        .not("pipeline_item_id", "is", null)
        .gte("occurred_at", tsFrom)
        .lte("occurred_at", tsTo)
        .order("occurred_at")
        .range(a, b),
    ).catch(() => [] as Row[]),
  ]);
  const stages = (stagesRes.data ?? []) as Row[];
  const items = Object.fromEntries(itemRows.map((i) => [i.id, { pipeline_id: i.pipeline_id as string, created_at: i.created_at as string }]));
  const typeById = Object.fromEntries(itemRows.map((i) => [i.id, (i.deal_source_type as string | null) ?? null]));
  const inWin = (d: string) => d >= from && d <= today;
  const reached = (name: string, fallback: number) => {
    const entries = toStageEntries(history as never, stages as never, items, (pid) => stagePosition(stages as never, pid, name, fallback), local);
    return Object.entries(firstReachDates(entries))
      .filter(([, d]) => inWin(d))
      .map(([id]) => id);
  };
  const sourced = itemRows.filter((i) => inWin(local(i.created_at))).map((i) => i.id as string);
  const calls = countedCalls(
    comms.filter((c) => items[c.pipeline_item_id]).map((c) => ({ item_id: c.pipeline_item_id as string, date: local(c.occurred_at), method: c.method as string })).filter((c) => inWin(c.date)),
  ).map((c) => c.item_id as string);

  const summaries = summarizeTargets(targets, today);
  const listings = available ? listingsTarget(summaries, pipelineId) : null;
  const listingCount = listings ? countInRange(targets.counts[listings.target.id] ?? {}, from, today) : 0;
  const steps = buildFunnel({
    listings: listingCount,
    sourced,
    ndas: reached("NDA signed", 3),
    cims: reached("CIM reviewed", 4),
    calls,
    lois: reached("LOI signed", 6),
    typeOf: (id) => typeById[id],
  });

  // Days of data: deals from the first deal added (within the window); listings from the Listings screened start date.
  const days_ = (first: string | null) => (first ? Math.min(days, Math.max(0, daysBetween(first < from ? from : first, today) + 1)) : 0);
  const firstDeal = itemRows.length ? local(itemRows[0].created_at) : null;
  const listingsStart = listings ? listings.target.def.start_date : null;
  const dataDays = days_(firstDeal);
  const plan = await loadDealPlan(sb, { ownerId, targets, available });
  const mix = targetMix(targets);
  const step = (k: FunnelStep["key"]) => steps.find((s) => s.key === k)?.count ?? 0;
  const notes = conversionNotes({
    dealDays: dataDays,
    listingsDays: days_(listingsStart),
    listings: listings ? step("listings") : 0,
    sourcedSinceListings: listingsStart ? itemRows.filter((i) => { const d = local(i.created_at); return inWin(d) && d >= listingsStart; }).length : 0,
    sourced: step("sourced"),
    cims: step("cims"),
    targets: { listings: mix.listings, sourced: mix.replies, cims: mix.cims },
  });
  return { available, days, from, to: today, steps, dataDays, listingsDays: days_(listingsStart), notes, plan, listings };
}

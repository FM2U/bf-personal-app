import type { DayCounts } from "./targets";

/**
 * Deal funnel (database update 0016): the counts behind the "CIMs reviewed" and "Broker or owner calls" targets,
 * the funnel card on the Acquisitions page (Listings screened, Deals sourced, NDAs signed, CIMs reviewed, Calls, LOIs),
 * and the "Suggested targets" line made from the Inputs (search hours per day and minutes per step).
 * Every function here is pure: the loaders in src/lib/targets.ts and src/lib/deal-funnel.ts pass the records in,
 * with dates already turned into the owner's local (New York) date.
 */

// ---------- Stage steps: the first time an item reached a stage (by a move) ----------

/** One stage_history row, with the stage's position in its pipeline and the threshold position for that pipeline. */
export type StageEntry = {
  item_id: string;
  /** entered_at in milliseconds (orders the entries of one item). */
  ts: number;
  /** entered_at as the owner's local date (YYYY-MM-DD). */
  date: string;
  position: number | null;
  outcome: string | null;
  /** True for the stage the item was created in (entered_at equals the item's created_at). */
  isCreation: boolean;
  /** Position of the step's stage (for example "CIM reviewed") in this item's pipeline. */
  threshold: number;
};

const reaches = (e: StageEntry) => e.position !== null && e.outcome !== "lost" && e.position >= e.threshold;

/**
 * The local date each item first moved into the threshold stage or a later one (once per item, ever).
 * - The stage an item was created in is not a move. An item created at the threshold stage or later never counts
 *   (the step happened before the item was added).
 * - Moving straight to a later stage (skipping the threshold stage) counts on that day.
 * - Passed or lost stages never count. Moving back and forward again does not count a second time.
 * `entries` must include every stage entry of each item (not only the ones in the date range), so "once per item"
 * holds across periods.
 */
export function firstReachDates(entries: StageEntry[]): Record<string, string> {
  const byItem: Record<string, StageEntry[]> = {};
  for (const e of entries) if (e.item_id) (byItem[e.item_id] ??= []).push(e);
  const out: Record<string, string> = {};
  for (const [item, list] of Object.entries(byItem)) {
    list.sort((a, b) => a.ts - b.ts);
    // The creation entry: marked by its time, otherwise the item's earliest entry (the full history is passed in).
    const created = list.find((e) => e.isCreation) ?? list[0];
    if (created && reaches(created)) continue;
    const first = list.find((e) => e !== created && reaches(e));
    if (first?.date) out[item] = first.date;
  }
  return out;
}

/** Counts per local date of the dates from firstReachDates (each item once). */
export function countFirstReach(entries: StageEntry[]): DayCounts {
  const out: DayCounts = {};
  for (const d of Object.values(firstReachDates(entries))) out[d] = (out[d] ?? 0) + 1;
  return out;
}

// ---------- Calls with a broker or owner ----------

/** Communication methods that count as a call: phone calls, meetings, and video calls. */
export const CALL_METHODS = ["call", "meeting", "video"];

export type CallComm = { item_id: string | null; date: string; method: string | null };

/** The calls that count: a call, meeting, or video call linked to an acquisition item, at most one per item per day. */
export function countedCalls<T extends CallComm>(comms: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of comms) {
    if (!c.item_id || !c.date || !CALL_METHODS.includes(String(c.method))) continue;
    const key = `${c.item_id}:${c.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Broker or owner calls per local date (a weekly target adds the days of the week). */
export function countDealCalls(comms: CallComm[]): DayCounts {
  const out: DayCounts = {};
  for (const c of countedCalls(comms)) out[c.date] = (out[c.date] ?? 0) + 1;
  return out;
}

// ---------- Funnel card ----------

export type Split = { proprietary: number; brokered: number; notSet: number };

export type FunnelStep = {
  key: "listings" | "sourced" | "ndas" | "cims" | "calls" | "lois";
  label: string;
  count: number;
  /** Proprietary and brokered counts; null for Listings screened (listings have no deal source). */
  split: Split | null;
  /** This step's count as a percentage of the previous step's count; null for the first step or when the previous is 0. */
  conversionPct: number | null;
};

export const FUNNEL_LABELS: Record<FunnelStep["key"], string> = {
  listings: "Listings screened",
  sourced: "Deals sourced",
  ndas: "NDAs signed",
  cims: "CIMs reviewed",
  calls: "Calls (broker or owner)",
  lois: "LOIs",
};

/** Whole-number percentage of cur over prev; null when prev is 0. Can be above 100 (for example more calls than CIMs). */
export function conversionPct(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round((cur / prev) * 100);
}

/** Proprietary, brokered, and not set counts for a list of item ids. */
export function splitOf(itemIds: string[], typeOf: (id: string) => string | null | undefined): Split {
  const s: Split = { proprietary: 0, brokered: 0, notSet: 0 };
  for (const id of itemIds) {
    const t = typeOf(id);
    if (t === "proprietary") s.proprietary++;
    else if (t === "brokered") s.brokered++;
    else s.notSet++;
  }
  return s;
}

/**
 * The six funnel steps in order, each with its count, its proprietary and brokered split, and the conversion from the
 * previous step. Each list holds one entry per counted event: item ids (a call lists its item id once per counted day).
 */
export function buildFunnel(p: {
  listings: number;
  sourced: string[];
  ndas: string[];
  cims: string[];
  calls: string[];
  lois: string[];
  typeOf: (id: string) => string | null | undefined;
}): FunnelStep[] {
  const raw: { key: FunnelStep["key"]; count: number; ids: string[] | null }[] = [
    { key: "listings", count: Math.max(0, Math.round(p.listings) || 0), ids: null },
    { key: "sourced", count: p.sourced.length, ids: p.sourced },
    { key: "ndas", count: p.ndas.length, ids: p.ndas },
    { key: "cims", count: p.cims.length, ids: p.cims },
    { key: "calls", count: p.calls.length, ids: p.calls },
    { key: "lois", count: p.lois.length, ids: p.lois },
  ];
  return raw.map((r, i) => ({
    key: r.key,
    label: FUNNEL_LABELS[r.key],
    count: r.count,
    split: r.ids ? splitOf(r.ids, p.typeOf) : null,
    conversionPct: i === 0 ? null : conversionPct(r.count, raw[i - 1].count),
  }));
}

/** "1 in 8" for 2 out of 16 (rounded to a whole number); null when there is nothing to compare. */
export function oneIn(part: number, whole: number): string | null {
  if (!(part > 0) || !(whole > 0)) return null;
  return `1 in ${Math.max(1, Math.round(whole / part))}`;
}

/**
 * After 14 or more days of data: actual conversion compared with what the targets plan for, in plain sentences.
 * Example: "You reach a CIM from 1 in 8 sourced deals (your targets plan for 1 in 5)."
 * - Deals to CIMs needs 14 days with deals in the window (`dealDays`).
 * - Listings to deals needs 14 days of Listings screened counting (`listingsDays`), and compares only deals sourced
 *   since that counting started (`sourcedSinceListings`), so both numbers cover the same days.
 */
export function conversionNotes(p: {
  dealDays: number;
  listingsDays: number;
  listings: number;
  sourcedSinceListings: number;
  sourced: number;
  cims: number;
  targets: { listings: number; sourced: number; cims: number };
}): string[] {
  const out: string[] = [];
  if (p.listingsDays >= 14 && p.listings > 0) {
    const plan = oneIn(p.targets.sourced, p.targets.listings);
    const tail = plan ? ` (your targets plan for ${plan})` : "";
    const actual = oneIn(p.sourcedSinceListings, p.listings);
    if (!actual) out.push(`No sourced deal yet from ${p.listings} listings screened${tail}.`);
    else if (p.sourcedSinceListings >= p.listings) out.push(`${p.sourcedSinceListings} sourced deals came from ${p.listings} listings screened${tail}.`);
    else out.push(`${actual[0].toUpperCase()}${actual.slice(1)} listings screened becomes a sourced deal${tail}.`);
  }
  if (p.dealDays >= 14 && p.sourced > 0) {
    const plan = oneIn(p.targets.cims, p.targets.sourced);
    const tail = plan ? ` (your targets plan for ${plan})` : "";
    const actual = oneIn(p.cims, p.sourced);
    if (!actual) out.push(`No CIM reviewed yet from ${p.sourced} sourced deals${tail}.`);
    else if (p.cims >= p.sourced) out.push(`${p.cims} CIMs reviewed from ${p.sourced} sourced deals${tail}.`);
    else out.push(`You reach a CIM from ${actual} sourced deals${tail}.`);
  }
  return out;
}

// ---------- Suggested targets from the Inputs ----------

export type MinutesPerStep = { listing: number; cim: number; reply: number; call: number };

export const DEFAULT_SEARCH_HOURS = 2;
export const DEFAULT_MINUTES: MinutesPerStep = { listing: 3, cim: 45, reply: 5, call: 30 };
/** The targets seeded by 0016 and 0009, used when a target is missing or inactive. */
export const DEFAULT_DEAL_TARGETS = { listings: 20, replies: 5, cims: 1, callsPerWeek: 2 };

export type DealTargetMix = { listings: number; replies: number; cims: number; callsPerWeek: number };

export type Suggestion = {
  hours: number;
  /** Minutes a weekday the current targets take (calls spread over 5 weekdays). */
  targetMinutes: number;
  listings: number;
  replies: number;
  cims: number;
  callsPerWeek: number;
  /** When fewer than 1 CIM a weekday fits: review 1 CIM every N weekdays. */
  cimEveryDays: number | null;
};

const pos = (n: unknown, fallback: number) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : fallback);

/**
 * What fits in the search hours per weekday, keeping the same mix as the current targets:
 * minutes the targets take = listings x listing minutes + replies x reply minutes + CIMs x CIM minutes
 * + (calls a week x call minutes) / 5. Each count is scaled by (hours x 60) / those minutes and rounded.
 * Replies = the Deals sourced target (each new deal gets a reply or an NDA).
 */
export function suggestTargets(p: { hours: number; minutes: Partial<MinutesPerStep>; targets: Partial<DealTargetMix> }): Suggestion {
  const hours = pos(p.hours, DEFAULT_SEARCH_HOURS);
  const m: MinutesPerStep = {
    listing: pos(p.minutes.listing, DEFAULT_MINUTES.listing),
    cim: pos(p.minutes.cim, DEFAULT_MINUTES.cim),
    reply: pos(p.minutes.reply, DEFAULT_MINUTES.reply),
    call: pos(p.minutes.call, DEFAULT_MINUTES.call),
  };
  const t: DealTargetMix = {
    listings: pos(p.targets.listings, DEFAULT_DEAL_TARGETS.listings),
    replies: pos(p.targets.replies, DEFAULT_DEAL_TARGETS.replies),
    cims: pos(p.targets.cims, DEFAULT_DEAL_TARGETS.cims),
    callsPerWeek: pos(p.targets.callsPerWeek, DEFAULT_DEAL_TARGETS.callsPerWeek),
  };
  const targetMinutes = t.listings * m.listing + t.replies * m.reply + t.cims * m.cim + (t.callsPerWeek * m.call) / 5;
  const scale = (hours * 60) / targetMinutes;
  const cimsRaw = t.cims * scale;
  return {
    hours,
    targetMinutes: Math.round(targetMinutes),
    listings: Math.round(t.listings * scale),
    replies: Math.round(t.replies * scale),
    cims: cimsRaw >= 0.5 ? Math.round(cimsRaw) : 0,
    callsPerWeek: Math.round(t.callsPerWeek * scale),
    cimEveryDays: cimsRaw < 0.5 && cimsRaw > 0 ? Math.round(1 / cimsRaw) : null,
  };
}

/** "2 hours", "1.5 hours", "1 hour", "2 hours 22 minutes" (minutes rounded). */
export function hoursText(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const min = total % 60;
  const hPart = h === 1 ? "1 hour" : `${h} hours`;
  if (!min) return hPart;
  if (!h) return `${min} minutes`;
  return `${hPart} ${min} minutes`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One plain line, for example "With 2 hours a day: screen 17 listings, reply to 4, review 1 CIM, 2 calls a week." */
export function suggestionText(s: Suggestion): string {
  const hrs = Number.isInteger(s.hours) ? plural(s.hours, "hour", "hours") : `${s.hours} hours`;
  const cim = s.cims > 0 ? `review ${plural(s.cims, "CIM", "CIMs")}` : s.cimEveryDays ? `review 1 CIM every ${s.cimEveryDays} weekdays` : "no time for CIM reviews";
  return `With ${hrs} a day: screen ${s.listings} listings, reply to ${s.replies}, ${cim}, ${plural(s.callsPerWeek, "call", "calls")} a week.`;
}

/** The second half of the line: how long the current targets take compared with the hours set. */
export function targetTimeText(s: Suggestion): string {
  const have = s.hours * 60;
  const diff = Math.abs(s.targetMinutes - have);
  if (diff < 5) return `Your current targets fit in that time (about ${hoursText(s.targetMinutes)} a day).`;
  return s.targetMinutes > have
    ? `Your current targets take about ${hoursText(s.targetMinutes)} a day, ${hoursText(diff)} more than the time set.`
    : `Your current targets take about ${hoursText(s.targetMinutes)} a day, ${hoursText(diff)} less than the time set.`;
}

// ---------- From database rows to stage entries ----------

export type StageRow = { id: string; pipeline_id: string; name?: string | null; position: number | string; outcome?: string | null };

/**
 * Position of the step's stage in a pipeline: the given stage when it belongs to that pipeline, otherwise the stage
 * with this name (any case), otherwise `fallback` (the default Acquisitions position).
 */
export function stagePosition(stages: StageRow[], pipelineId: string, name: string | string[], fallback: number, ownStageId?: string | null): number {
  const own = ownStageId ? stages.find((s) => s.id === ownStageId) : null;
  if (own && own.pipeline_id === pipelineId) return Number(own.position);
  // Several names: the first one found wins (the acquisition stages were renamed by database update 0020).
  for (const n of Array.isArray(name) ? name : [name]) {
    const byName = stages.find((s) => s.pipeline_id === pipelineId && String(s.name ?? "").toLowerCase() === n.toLowerCase());
    if (byName) return Number(byName.position);
  }
  return fallback;
}

/**
 * Stage history rows of the given items as StageEntry values. `localDate` turns a timestamp into the owner's local date.
 * `threshold` gives the step's stage position for a pipeline. Rows of items not in `items` are left out.
 */
export function toStageEntries(
  history: { item_id: string; stage_id: string | null; entered_at: string }[],
  stages: StageRow[],
  items: Record<string, { pipeline_id: string; created_at: string }>,
  threshold: (pipelineId: string) => number,
  localDate: (ts: string) => string,
): StageEntry[] {
  const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
  const out: StageEntry[] = [];
  for (const h of history) {
    const it = items[h.item_id];
    if (!it) continue;
    const st = h.stage_id ? byId[h.stage_id] : undefined;
    const ts = new Date(h.entered_at).getTime();
    out.push({
      item_id: h.item_id,
      ts,
      date: localDate(h.entered_at),
      position: st ? Number(st.position) : null,
      outcome: st?.outcome ?? null,
      isCreation: ts === new Date(it.created_at).getTime(),
      threshold: threshold(it.pipeline_id),
    });
  }
  return out;
}

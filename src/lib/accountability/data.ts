import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, monthStart, todayInTz } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import { date as fmtDate, formatInZone } from "@/lib/format";
import { displayName, signOffName } from "@/lib/work/names";
import { loadPipelineOfKind, loadWorkCtx, type WorkCtx, type WorkPipeline } from "@/lib/work/data";
import { weekdayShort } from "@/lib/work/outreach";
import { stalledAt } from "@/lib/work/stages";
import { isReviewDay, isWeekJudgedOn, isWorkDay, workWeekNow } from "@/lib/work-week";
import { waitLines, type SavedWait } from "@/lib/work/waiting";
import { recordHref } from "@/lib/work/task-records";
import { loadWaitsFor } from "@/lib/work/waits-data";
import { buildFacts } from "@/lib/accountability/facts";
import { pillOf, reportFor, reportInnerHtml, targetGroup, targetLine, type ReportData } from "@/lib/accountability/report-email";
import { cleanChoices, cleanNotes, cleanReview, hasChoices, NOTES_KEY, reviewAnswered, sendsNotes, type ReportChoices, type ReportNotes, type WeeklyReview } from "@/lib/accountability/report-sections";
import { brokerPerson, reportDeals, type DealRows } from "@/lib/accountability/report-deals";
import { firstName, partnerSettings, partnersDueOn, REPORT_SECTIONS, type ReportSectionKey } from "@/lib/accountability/partners";
import { PAST_WEEKS, pastWeekPeriodKey, weekLine, type PeriodKey } from "@/lib/accountability/periods";
import { tileHistories, type TileHistory } from "@/lib/accountability/week-history";
import {
  beforeCounting, countedDays, countIn, DEFAULT_TARGETS, dayNumbers, figure, isCountKey, judgeDay, listNames, metThisWeek, mostMissed, mostMissedIn, owedFromLastClosed, owedReasons, pastWeeks, shortName,
  targetView, tileEodLine, tileTargetLine, tileTargets, todayTiles, tomorrowLabel, reportTiles, weekNumbers, weekTiles, workWeekOf,
  type Cadence, type DayNumbers, type DayWait, type EodState, type Facts, type Judged, type Target, type TargetView, type WeekNumbers, type WeekTile,
} from "@/lib/accountability/targets";
import { DEFAULT_EOD_TIME, eodLong, eodShort, parseTime } from "@/lib/work/settings";
import type { Row } from "@/lib/types";
import { ownerContactsLite, pickOrRead, rowsOf } from "@/lib/work/shared-reads";

/**
 * Everything Targets, End of day, Reports, and the Targets today tile read (batch C, database update 0025). One
 * loader gathers the facts (listings screened and stage moves from stage_history, emails and calls from
 * communications, follow-ups and next actions done and the Rosara focus from work_events, the open waits from the
 * deals); src/lib/accountability/targets.ts counts them. Nothing here writes; the actions are in
 * src/app/actions/accountability.ts.
 */

// ---------- Targets ----------

function toTarget(r: Row): Target {
  return {
    id: String(r.id),
    name: String(r.name),
    key: isCountKey(r.counts_key) ? r.counts_key : "listings_screened",
    cadence: (r.period === "day" ? "day" : "week") as Cadence,
    number: Math.max(1, Number(r.minimum_count ?? 1)),
    commitment: !!r.is_commitment,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

const TARGET_COLS = "id,name,counts_key,period,minimum_count,is_commitment,sort_order,archived_at";

/**
 * The owner's targets (counts_key set, not archived), by order. Seeds the six defaults the first time (no target
 * counts yet). The read after seeding asks a different address on purpose: inside a page render Next.js returns the
 * answer of an identical GET from earlier in the same render, so asking the first address again gave back the empty
 * list and End of day showed "0 of 0 met" on its first visit (fixed 2026-11-05).
 */
export async function loadTargets(sb: SupabaseClient, ownerId: string): Promise<Target[]> {
  const read = async (fresh = false) => {
    let q = sb.from("targets").select(TARGET_COLS).eq("owner_id", ownerId).not("counts_key", "is", null).is("archived_at", null).order("sort_order").order("created_at");
    if (fresh) q = q.limit(1000);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  };
  let rows = await read();
  if (!rows.length && (await ensureDefaultTargets(sb, ownerId))) rows = await read(true);
  return rows.map(toTarget);
}

/**
 * The six default targets, made when no target counts yet (true when it made or updated any). Loading sample data
 * calls it, so every page that reads targets finds them; loadTargets calls it too for an account without the sample.
 */
export async function ensureDefaultTargets(sb: SupabaseClient, ownerId: string): Promise<boolean> {
  const { data: any, error } = await sb.from("targets").select("id,name,counts_key,archived_at").eq("owner_id", ownerId).limit(500);
  if (error) return false;
  const existing = (any ?? []) as Row[];
  if (existing.some((r) => r.counts_key)) return false;
  await seedDefaultTargets(sb, ownerId, existing);
  return true;
}

/** The six defaults: a target of the same name from an earlier update keeps its row and counts the batch C way; the others are added in one insert. */
async function seedDefaultTargets(sb: SupabaseClient, ownerId: string, existing: Row[]) {
  const fresh: Row[] = [];
  for (const d of DEFAULT_TARGETS) {
    const row = existing.find((r) => String(r.name) === d.name);
    if (row) await sb.from("targets").update({ counts_key: d.key, period: d.cadence, minimum_count: d.number, is_commitment: d.commitment, active: true, archived_at: null, sort_order: d.sortOrder }).eq("id", row.id);
    else fresh.push({ owner_id: ownerId, name: d.name, period: d.cadence, minimum_count: d.number, active_weekdays: workWeekNow().days.map((d) => d % 7), count_source: "manual", is_commitment: d.commitment, show_to_partners: false, active: true, sort_order: d.sortOrder, counts_key: d.key, notes: "Counted from what you do in the app (Targets, batch C)." });
  }
  if (fresh.length) await sb.from("targets").insert(fresh);
}

// ---------- The facts ----------

/** An open wait as Targets, End of day, and Reports count it: one per deal (or person), its longest wait. */
type Wait = { name: string; days: number; who: string | null; what: string | null; since: string | null; /** YYYY-MM-DD. */ sinceDate: string | null; dealId: string; kind: "deal" | "person" };

type FactsBundle = { facts: Facts; waits: Wait[]; /** Push E2, item 5: the people waited on (End of day's "waiting N+ days" counts them with the deals; the report's broker section does not). */ personWaits: Wait[]; /** Edits of Nov 5: every open wait of the deals and people, one entry each (End of day counts these). */ eachWait: DayWait[]; /** Days skipped on End of day (not counted). */ skippedDays: string[]; /** Passed listings by reason in the window (for Reports). */ passes: { on: string; name: string; reason: string | null }[]; /** The rows the report's deal sections read (push B edits), with the deal and job pipeline ids. */ raw: DealRows & { acqId: string | null; jobId: string | null } };

/** The facts from `since` (YYYY-MM-DD) to today: enough for the 8-week strips, the Past weeks, and This month. */
export async function loadFacts(sb: SupabaseClient, ctx: WorkCtx, since: string): Promise<FactsBundle> {
  const local = (ts: string) => todayInTz(ctx.tz, new Date(ts));
  // Page speed (2026-11-06): the pipelines and the activity below are read side by side (the activity never needed them).
  const pipesP = Promise.all([loadPipelineOfKind(sb, ctx.ownerId, "acquisition"), loadPipelineOfKind(sb, ctx.ownerId, "job"), loadPipelineOfKind(sb, ctx.ownerId, "consulting")]);
  pipesP.catch(() => {});
  const [[acq, job, con], { data: items }, { data: hist }, { data: comms }, { data: events }, { data: eods }, { data: people }, { data: notes }, waitRows, { data: doneTasks }] = await Promise.all([
    sb.from("pipeline_items").select("id,name,company_name,pipeline_id,status,stage_id,pass_reason,key_finding,next_action,next_action_due,screened,broker_name,primary_contact_id,updated_at,role_title").eq("owner_id", ctx.ownerId).limit(5000),
    sb.from("stage_history").select("id,item_id,stage_id,entered_at").eq("owner_id", ctx.ownerId).order("entered_at").limit(20000),
    sb.from("communications").select("id,occurred_at,method,direction,contact_id,awaiting_log,pipeline_item_id,subject,call_minutes").eq("owner_id", ctx.ownerId).gte("occurred_at", `${since}T00:00:00Z`).limit(5000),
    sb.from("work_events").select("kind,record_type,record_id,label,happened_on,happened_at,on_time,meta").eq("owner_id", ctx.ownerId).gte("happened_on", since).limit(5000),
    sb.from("end_of_day").select("day,status").eq("owner_id", ctx.ownerId).eq("status", "skipped").gte("day", since).limit(500),
    sb.from("contacts").select("id,name,outreach_role,organization_id,archived_at").eq("owner_id", ctx.ownerId).limit(5000),
    sb.from("notes").select("record_id,body,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "pipeline_items").gte("created_at", `${addDaysISO(since, 56)}T00:00:00Z`).limit(5000),
    // Push E2: the waits (several per deal or person).
    loadWaitsFor(sb, ctx.ownerId),
    // Push E2, item 5: tasks and to-dos checked off (record tasks count with their record's area; personal to-dos apart).
    sb.from("deal_todos").select("id,text,done_at,record_type,record_id,deal_id").eq("owner_id", ctx.ownerId).not("done_at", "is", null).gte("done_at", `${addDaysISO(since, -1)}T00:00:00Z`).limit(5000),
  ]).then((r) => Promise.all([pipesP, ...r] as const));
  const pipes = [acq, job, con].filter((p): p is WorkPipeline => !!p);
  const laneOf: Record<string, "Deals" | "Job search" | "Consulting"> = {};
  if (acq) laneOf[acq.id] = "Deals";
  if (job) laneOf[job.id] = "Job search";
  if (con) laneOf[con.id] = "Consulting";
  const stageById: Record<string, { name: string; outcome: string; position: number }> = {};
  for (const p of pipes) for (const s of p.stages) stageById[s.id] = { name: s.name, outcome: s.outcome, position: s.position };
  const personById = new Map(((people ?? []) as Row[]).map((p) => [String(p.id), p]));
  const nameOf = (i: Row) => displayName({ name: String(i.name), companyName: (i.company_name as string | null) ?? null });
  // The counting itself is pure and shared (src/lib/accountability/facts.ts).
  const { facts, passes } = buildFacts({ items: (items ?? []) as Row[], history: (hist ?? []) as Row[], comms: (comms ?? []) as Row[], events: (events ?? []) as Row[], people: (people ?? []) as Row[], tasks: (doneTasks ?? []) as Row[], stageById, laneOf, since, local });
  // One wait per deal or person: its longest; "what" names every wait ("The CIM; Luis Ortega's reply to your email "Oakline CIM"").
  const longest = (saved: readonly SavedWait[]) => {
    const lines = waitLines(saved, ctx.today, ctx.threshold);
    return lines.length ? { days: lines[0].days, what: lines.map((l) => l.text).join("; "), sinceDate: lines[0].since } : null;
  };
  const openDeals = ((items ?? []) as Row[]).filter((i) => i.status === "open" && laneOf[String(i.pipeline_id)] === "Deals" && i.stage_id && stageById[String(i.stage_id)]?.outcome === "open");
  const dealWho = (i: Row) => {
    const contact = i.primary_contact_id ? personById.get(String(i.primary_contact_id)) : null;
    return String(contact?.name ?? "").trim() || brokerPerson(i.broker_name as string | null) || null;
  };
  const openPeople = ((people ?? []) as Row[]).filter((p) => !p.archived_at);
  const waits: Wait[] = openDeals
    .flatMap((i): Wait[] => {
      const w = longest(waitRows.byItem[String(i.id)] ?? []);
      if (!w) return [];
      return [{ dealId: String(i.id), kind: "deal", name: nameOf(i), days: w.days, who: dealWho(i), what: w.what, since: w.sinceDate ? fmtDate(w.sinceDate, "MMM d") : null, sinceDate: w.sinceDate }];
    })
    .sort((a, b) => b.days - a.days);
  const personWaits: Wait[] = openPeople
    .flatMap((p): Wait[] => {
      const w = longest(waitRows.byContact[String(p.id)] ?? []);
      return w ? [{ dealId: String(p.id), kind: "person", name: String(p.name ?? ""), days: w.days, who: null, what: w.what, since: w.sinceDate ? fmtDate(w.sinceDate, "MMM d") : null, sinceDate: w.sinceDate }] : [];
    })
    .sort((a, b) => b.days - a.days);
  // Edits of Nov 5 (item 5): every wait on its own, for End of day's "N waiting 5+ days" and its panel (each a link).
  const each = (saved: readonly SavedWait[], base: Omit<DayWait, "days" | "what" | "since">): DayWait[] => waitLines(saved, ctx.today, ctx.threshold).map((l) => ({ ...base, days: l.days, what: l.text, since: l.since ? fmtDate(l.since, "MMM d") : null }));
  const eachWait: DayWait[] = [
    ...openDeals.flatMap((i) => each(waitRows.byItem[String(i.id)] ?? [], { kind: "deal", name: nameOf(i), who: dealWho(i), href: recordHref({ kind: "deal", id: String(i.id) }) })),
    ...openPeople.flatMap((p) => each(waitRows.byContact[String(p.id)] ?? [], { kind: "person", name: String(p.name ?? ""), who: null, href: recordHref({ kind: "person", id: String(p.id) }) })),
  ].sort((a, b) => b.days - a.days);
  // Counting starts on (Bram, 2026-11-09): the days before it count as not counted, like a skipped day.
  // Each day once, and only work days, as a skipped End of day day is (so no work-day count is lowered twice).
  const skippedDays = [...new Set([...((eods ?? []) as Row[]).map((e) => String(e.day).slice(0, 10)), ...daysBeforeCounting(since, ctx.countingStart)])];
  facts.from = ctx.countingStart;
  const raw = { items: (items ?? []) as Row[], history: (hist ?? []) as Row[], comms: (comms ?? []) as Row[], notes: (notes ?? []) as Row[], events: (events ?? []) as Row[], people: (people ?? []) as Row[], waits: waitRows.rows, stageById, acqId: acq?.id ?? null, jobId: job?.id ?? null };
  return { facts, waits, personWaits, eachWait, skippedDays, passes, raw };
}

/** The work days from `since` up to the day before Counting starts on (none when it is not set). */
export function daysBeforeCounting(since: string, start: string | null): string[] {
  const out: string[] = [];
  if (!start) return out;
  for (let d = since, i = 0; d < start && i < 800; d = addDaysISO(d, 1), i++) if (isWorkDay(d)) out.push(d);
  return out;
}

/** The window the screens read: 9 weeks back (the 8-week strips and four past weeks) or the start of the month, whichever is earlier. */
export function factsSince(today: string): string {
  const nineWeeks = addDaysISO(workWeekOf(today).start, -63);
  const month = monthStart(today);
  return nineWeeks < month ? nineWeeks : month;
}

// ---------- The partner and the End of day row ----------

/** An accountability partner (push B): the weekdays they get the report and the sections they get. */
export type Partner = { id: string; name: string; first: string; email: string | null; days: number[]; sections: ReportSectionKey[] };

export function toPartner(r: Row): Partner {
  const name = String(r.name ?? "");
  const s = partnerSettings(r);
  return { id: String(r.id), name, first: firstName(name), email: r.email ? String(r.email) : null, days: s.days, sections: s.sections };
}

/** Every accountability partner (a person with the role Accountability partner, not archived), oldest first. */
export async function loadPartners(sb: SupabaseClient, ownerId: string): Promise<Partner[]> {
  const { data } = await sb.from("contacts").select("id,name,email,created_at,report_days,report_sections").eq("owner_id", ownerId).eq("outreach_role", "accountability_partner").is("archived_at", null).order("created_at").limit(50);
  return ((data ?? []) as Row[]).map(toPartner);
}

/** The End of day reports already sent on a day, one per partner (push B: each partner gets their own copy). */
export type SentCopy = { reportId: string; contactId: string; sentAt: string; html: string | null; subject: string | null; /** Today's choices it was sent with (push B edits). */ choices: ReportChoices | null; /** The notes it was sent with (2026-11-05). */ notes: ReportNotes | null };

export async function loadSentCopies(sb: SupabaseClient, ownerId: string, day: string): Promise<SentCopy[]> {
  const { data } = await sb.from("partner_reports").select("id,contact_id,sent_at,snapshot").eq("owner_id", ownerId).eq("report_kind", "end_of_day").eq("period_start", day).not("contact_id", "is", null).not("sent_at", "is", null).order("sent_at").limit(20);
  // Send a report (2026-11-07): an earlier day sent again later is not one of that day's copies (the day stays as it was).
  const rows = ((data ?? []) as Row[]).filter((r) => !((r.snapshot ?? {}) as Row).resend);
  return rows.map((r) => {
    const snap = (r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {}) as Row;
    return { reportId: String(r.id), contactId: String(r.contact_id), sentAt: String(r.sent_at), html: typeof snap.html === "string" ? snap.html : null, subject: typeof snap.subject === "string" ? snap.subject : null, choices: snap.choices && typeof snap.choices === "object" ? cleanChoices(snap.choices) : null, notes: snap.notes && typeof snap.notes === "object" ? cleanNotes(snap.notes) : null };
  });
}

type EodRow = { id: string | null; day: string; status: EodState; reasons: Record<string, string>; tomorrow: string; skipReason: string | null; sentAt: string | null; reportId: string | null; reportSubject: string | null; reportHtml: string | null; reportEdited: boolean; /** Push B edits: each partner's choices for today's copy (include, Change, Edit), by contact id. */ reportEdits: Record<string, ReportChoices>; /** Today's notes by section, once for the day and shared by every copy (report_edits._notes, 2026-11-05). */ reportNotes: ReportNotes; judged: Judged[]; /** Push D: the Weekly review answers (Fridays). */ weeklyReview: WeeklyReview; /** Fix list item 1 (2026-11-06): the partners unticked for this day only (contact ids). */ skippedPartners: string[]; /** When each Edit and + Note was last saved (2026-11-08): "<copy id>:<section>" or "note:<section>". */ editedAt: Record<string, string>; /** Also send to and the note under the greeting (2026-11-08). */ extras: ReportExtras; /** The automatic send's record (2026-11-08). */ auto: ReportAuto };

export async function loadEodRow(sb: SupabaseClient, ownerId: string, day: string): Promise<EodRow> {
  const { data } = await sb.from("end_of_day").select("*").eq("owner_id", ownerId).eq("day", day).maybeSingle();
  const r = data as Row | null;
  const reasons = r?.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons) ? Object.fromEntries(Object.entries(r.reasons as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])) : {};
  return {
    id: r ? String(r.id) : null,
    day,
    status: (r?.status === "sent" ? "sent" : r?.status === "skipped" ? "skipped" : "open") as EodState,
    reasons,
    tomorrow: String(r?.tomorrow_line ?? ""),
    skipReason: (r?.skip_reason as string | null) ?? null,
    sentAt: (r?.sent_at as string | null) ?? null,
    reportId: (r?.report_id as string | null) ?? null,
    reportSubject: (r?.report_subject as string | null) ?? null,
    reportHtml: (r?.report_html as string | null) ?? null,
    reportEdited: !!r?.report_edited,
    // An edit saved before the push B edits (a whole email as HTML) is not a choice; the copy is built again.
    reportEdits: r?.report_edits && typeof r.report_edits === "object" && !Array.isArray(r.report_edits) ? Object.fromEntries(Object.entries(r.report_edits as Record<string, unknown>).filter(([k, v]) => (!k.startsWith("_") || k === GENERAL_COPY) && v && typeof v === "object" && !Array.isArray(v)).map(([k, v]) => [k, cleanChoices(v)])) : {},
    reportNotes: r?.report_edits && typeof r.report_edits === "object" && !Array.isArray(r.report_edits) ? cleanNotes((r.report_edits as Record<string, unknown>)[NOTES_KEY]) : {},
    judged: Array.isArray(r?.judged) ? (r!.judged as Judged[]) : [],
    weeklyReview: cleanReview(r?.weekly_review),
    skippedPartners: Array.isArray(r?.skipped_partners) ? (r!.skipped_partners as unknown[]).map(String) : [],
    editedAt: cleanEditedAt(r?.report_edits && typeof r.report_edits === "object" && !Array.isArray(r.report_edits) ? (r.report_edits as Record<string, unknown>)[EDITED_AT_KEY] : null),
    extras: cleanExtras(r?.report_edits && typeof r.report_edits === "object" && !Array.isArray(r.report_edits) ? (r.report_edits as Record<string, unknown>)[EXTRAS_KEY] : null),
    auto: cleanAuto(r?.report_edits && typeof r.report_edits === "object" && !Array.isArray(r.report_edits) ? (r.report_edits as Record<string, unknown>)[AUTO_KEY] : null),
  };
}

/**
 * Today's people under Also send to, the copy they get, and the note under the greeting (Bram, 2026-11-08): saved
 * with the day like the section notes, so closing the window keeps them and the 6:00 pm send includes them.
 */
export const EXTRAS_KEY = "_extras";
export type ReportExtras = { chosen: string[]; fresh: { email: string; name: string; save: boolean }[]; from: string | null; intro: string };
export const NO_EXTRAS: ReportExtras = { chosen: [], fresh: [], from: null, intro: "" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanExtras(v: unknown): ReportExtras {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...NO_EXTRAS };
  const o = v as Record<string, unknown>;
  const chosen = Array.isArray(o.chosen) ? [...new Set(o.chosen.map(String).filter((x) => UUID_RE.test(x)))].slice(0, 50) : [];
  const fresh = Array.isArray(o.fresh)
    ? (o.fresh as unknown[])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({ email: String(f.email ?? "").trim().slice(0, 200), name: String(f.name ?? "").trim().slice(0, 120), save: f.save !== false }))
        .filter((f) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
        .slice(0, 20)
    : [];
  const from = typeof o.from === "string" && (o.from === GENERAL_COPY || UUID_RE.test(o.from)) ? o.from : null;
  return { chosen, fresh, from, intro: String(o.intro ?? "").replace(/\r/g, "").slice(0, 1200) };
}

/** What the automatic send did today (2026-11-08): the two reminder emails, the send, a failure and its email. */
export const AUTO_KEY = "_auto";
export type ReportAuto = { reminded1?: string; reminded2?: string; sentAt?: string; failedAt?: string; failure?: string; failureMailed?: string };
export function cleanAuto(v: unknown): ReportAuto {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: ReportAuto = {};
  for (const k of ["reminded1", "reminded2", "sentAt", "failedAt", "failure", "failureMailed"] as const) if (typeof o[k] === "string") out[k] = String(o[k]).slice(0, 500);
  return out;
}

/** One report window (Bram, 2026-11-08): the copy reviewed when no partner gets the report today, its choices kept under this key. */
export const GENERAL_COPY = "_general";
/** When each Edit and + Note of the day was saved, kept in report_edits under this key (carried-over edits are marked). */
export const EDITED_AT_KEY = "_edited_at";

export function cleanEditedAt(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, t]) => k.length <= 80 && typeof t === "string" && !Number.isNaN(Date.parse(t))).map(([k, t]) => [k, String(t)]));
}

/**
 * The reasons a skipped day still owes, asked on the next End of day only: the last closed day (sent or skipped) in
 * the past week must be the skipped one. Once a later day was sent, its End of day already asked, so nothing carries on.
 */
export async function loadOwedFromSkipped(sb: SupabaseClient, ownerId: string, day: string, countingStart: string | null = null): Promise<{ day: string; items: Judged[]; reasons: Record<string, string> } | null> {
  const { data } = await sb.from("end_of_day").select("day,status,judged,reasons").eq("owner_id", ownerId).in("status", ["sent", "skipped"]).lt("day", day).gte("day", addDaysISO(day, -7)).order("day", { ascending: false }).limit(1).maybeSingle();
  const r = data as Row | null;
  if (!r) return null;
  // Counting starts on (2026-11-09): a day before it owes nothing.
  if (countingStart && String(r.day).slice(0, 10) < countingStart) return null;
  return owedFromLastClosed({ day: String(r.day).slice(0, 10), status: String(r.status), judged: Array.isArray(r.judged) ? (r.judged as Judged[]) : [], reasons: r.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons) ? (r.reasons as Record<string, string>) : {} });
}

// ---------- The screens ----------

export type TargetsPage = { today: string; weekLabel: string; targets: TargetView[]; commitments: number; past: WeekTile[]; mostMissed: { name: string; n: number; of: number } | null; skippedDays: string[] };

export async function loadTargetsPage(sb: SupabaseClient, ctx: Ctx): Promise<TargetsPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, eod] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(ctx.today)), loadEodRow(sb, ctx.ownerId, ctx.today)]);
  const opts = { skippedDays: bundle.skippedDays, judgedToday: eod.status !== "open" };
  const week = workWeekOf(ctx.today);
  return {
    today: ctx.today,
    weekLabel: `week of ${fmtDate(week.start, "MMM d")}`,
    targets: targets.map((t) => targetView(t, bundle.facts, ctx.today, opts)),
    commitments: targets.filter((t) => t.commitment).length,
    past: pastWeeks(targets, bundle.facts, ctx.today, bundle.skippedDays),
    mostMissed: mostMissed(targets, bundle.facts, ctx.today, bundle.skippedDays),
    skippedDays: bundle.skippedDays,
  };
}

/** One partner's copy of the day's report (push B): their sections, the edit or the email as sent. */
export type PartnerCopy = { partner: Partner; report: ReportData; html: string; edited: boolean; sentAt: string | null; sentTime: string | null; /** Fix list item 1 (2026-11-06): unticked, so this partner is skipped today only. */ skipped: boolean };

export type EndOfDayPage = {
  day: string;
  /** The copy reviewed and sent when no partner gets the report today (Also send to only; it does not close the day). */
  general: PartnerCopy;
  /** When each Edit and + Note was saved ("<copy id>:<section>", "note:<section>"), and the day's last send (2026-11-08). */
  editedAt: Record<string, string>;
  lastSentAt: string | null;
  /** Also send to and the note under the greeting, saved with the day; the automatic send's record and setting (2026-11-08). */
  extras: ReportExtras;
  auto: ReportAuto;
  autoSend: boolean;
  dateLabel: string;
  /** The weekly review day (Friday unless changed in Settings): the Weekly review and The week in the report. */
  friday: boolean;
  /** A work day (Settings, Work settings): daily targets are judged. */
  weekday: boolean;
  /** The week's last work day: the per-week targets are judged. */
  weekJudged: boolean;
  /** The name of the week's last work day ("Friday"). */
  weekEndName: string;
  /** The first partner on today's report (or the first partner), for the lines that name one. */
  partner: Partner | null;
  /** Every accountability partner. */
  partners: Partner[];
  /** The copies on today's report: each partner due today, and anyone it was already sent to today. */
  copies: PartnerCopy[];
  numbers: DayNumbers;
  threshold: number;
  judged: Judged[];
  /** The week sum of each per-weekday target ("this week 19 of 25"). */
  weekSums: Record<string, number>;
  reasons: Record<string, string>;
  tomorrow: string;
  tomorrowLabel: string;
  state: EodState;
  sentAt: string | null;
  sentTime: string | null;
  skipReason: string | null;
  /** Reasons still owed from a skipped day. */
  owed: { day: string; dayLabel: string; items: Judged[]; reasons: Record<string, string> } | null;
  /** The report with every section (the base each partner's copy is cut from; the AI reads it). */
  report: ReportData;
  /** The first copy as it will be sent (or as sent). */
  reportHtml: string;
  reportEdited: boolean;
  /** Targets met this week (the tile and the status). */
  metThisWeek: { met: number; total: number };
  /** Fridays (push D): the Weekly review answers and how many are written; null on other days. */
  review: (WeeklyReview & { answered: number }) | null;
  /** The End of day time (Settings, Work settings): "5:30" and "5:30 pm", and as saved ("17:30") for the countdown. */
  eodTime: { short: string; long: string; hhmm: string };
  /** The page title's date (2026-11-05): "Thu, Nov 5". */
  titleDate: string;
  /** The owner's time zone and the time the page was built (ms), so the countdown starts from the server's clock. */
  tz: string;
  now: number;
};

/** The End of day data for a day (today by default). */
export async function loadEndOfDay(sb: SupabaseClient, ctx: Ctx, day = ctx.today): Promise<EndOfDayPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, row, partners, owed, sent] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(day)), loadEodRow(sb, ctx.ownerId, day), loadPartners(sb, ctx.ownerId), loadOwedFromSkipped(sb, ctx.ownerId, day, wctx.countingStart), loadSentCopies(sb, ctx.ownerId, day)]);
  return buildEndOfDay({ targets, bundle, row, partners, sent, owed, day, tz: ctx.tz, threshold: wctx.threshold, eodTime: wctx.eodTime, signName: signOffName(wctx.profile?.display_name), autoSend: wctx.autoSend });
}

/** Builds the End of day page from loaded rows (shared with the send action, which judges the same way). */
export function buildEndOfDay(i: { targets: Target[]; bundle: FactsBundle; row: EodRow; partners: Partner[]; sent: SentCopy[]; owed: { day: string; items: Judged[]; reasons: Record<string, string> } | null; day: string; tz: string; threshold: number; eodTime?: string; /** Fix list item 10: the name under "Thank you," (Settings, Name). */ signName?: string | null; /** Send the report automatically (2026-11-08). */ autoSend?: boolean }): EndOfDayPage {
  const { targets, bundle, row, partners, day } = i;
  // The work week (Settings, Work settings; design B, 2026-11-07): the review day shows the week; a work day is judged.
  const friday = isReviewDay(day);
  const weekday = isWorkDay(day);
  const weekJudged = isWeekJudgedOn(day);
  // A sent or skipped day keeps the judgment it was closed with; an open day is judged live.
  const judged = row.status !== "open" && row.judged.length ? row.judged : judgeDay(targets, bundle.facts, day, bundle.skippedDays);
  const numbers = dayNumbers(bundle.facts, day, bundle.waits, i.threshold, bundle.personWaits, bundle.eachWait);
  const week = workWeekOf(day);
  const weekSums: Record<string, number> = {};
  for (const t of targets) if (t.cadence === "day") weekSums[t.id] = countIn(t.key, bundle.facts, week.start, day).value;
  const tl = tomorrowLabel(day);
  const thisWeek = weekNumbers(targets, bundle.facts, week, bundle.waits, bundle.skippedDays, day);
  const lastP = workWeekOf(addDaysISO(week.start, -7));
  // Counting starts on (2026-11-09): no "Last week" comparison for a week that ended before it.
  const lastWeek = beforeCounting(bundle.facts, lastP.end) ? null : weekNumbers(targets, bundle.facts, lastP, bundle.waits, bundle.skippedDays);
  const owedPrev = i.owed;
  const owed: ReportData["owed"] = owedPrev && owedPrev.items.length ? { dayWord: fmtDate(owedPrev.day, "EEEE"), items: owedPrev.items.map((j) => ({ id: j.targetId, text: `${j.name}: ${j.figure}`, reason: String(owedPrev.reasons[j.targetId] ?? row.reasons[`owed:${owedPrev.day}:${j.targetId}`] ?? "").trim() || null })) } : null;
  // The report's period: the day, or the week on Friday (Active this week).
  const period = friday ? { start: week.start, end: day } : { start: day, end: day };
  const local = (ts: string) => todayInTz(i.tz, new Date(ts));
  const dealArgs = { ...bundle.raw, period, today: day, local, fmt: (d: string) => fmtDate(d, "MMM d"), weekday: (d: string) => fmtDate(d, "EEEE") };
  const deals = bundle.raw.acqId ? reportDeals({ ...dealArgs, pipelineId: bundle.raw.acqId }) : [];
  const jobs = bundle.raw.jobId ? reportDeals({ ...dealArgs, pipelineId: bundle.raw.jobId }) : [];
  const report: ReportData = {
    signName: i.signName ?? null,
    partnerName: "Partner",
    partnerFirst: "there",
    dateLong: fmtDate(day, "EEEE, MMM d, yyyy"),
    dateShort: fmtDate(day, "EEEE, MMM d"),
    withWeek: friday,
    pill: pillOf(judged, friday),
    today: todayTiles(numbers, targets),
    targets: judged.map((j) => ({ id: j.targetId, group: targetGroup(j), text: targetLine(j, j.cadence === "day" ? (weekSums[j.targetId] ?? null) : null, countedDays(day, bundle.skippedDays)), commitment: j.commitment, asks: j.judged && !j.met && j.commitment, reason: j.judged && !j.met && j.commitment ? String(row.reasons[j.targetId] ?? "").trim() || null : null })),
    owed,
    waits: bundle.waits.filter((w) => w.days >= i.threshold).map((w) => ({ id: w.dealId, name: w.name, days: w.days, who: w.who })),
    threshold: i.threshold,
    stalledAt: stalledAt(i.threshold),
    deals,
    jobs,
    period: friday ? "this week" : "today",
    week: friday ? { label: `The week, ${fmtDate(week.start, "MMM d")} to ${fmtDate(week.end, "d")}`, tiles: weekTiles(thisWeek, lastWeek) } : null,
    review: friday ? row.weeklyReview : null,
    tomorrow: { label: tl, text: row.tomorrow.trim() || null },
    notes: row.reportNotes,
  };
  const met = metThisWeek(targets, bundle.facts, day, bundle.skippedDays);
  // Each partner's copy (push B): the partners due today while the day is open, plus anyone it already went to.
  const time = (ts: string) => formatInZone(ts, "h:mm a", i.tz).toLowerCase();
  const sentBy = new Map(i.sent.map((c) => [c.contactId, c]));
  const due = row.status === "open" ? partnersDueOn(partners, day) : [];
  const onReport = partners.filter((p) => sentBy.has(p.id) || due.includes(p));
  const copies: PartnerCopy[] = onReport.map((p) => {
    const s = sentBy.get(p.id);
    if (s) {
      const r = reportFor({ ...report, notes: s.notes }, p, s.choices);
      return { partner: p, report: r, html: s.html ?? reportInnerHtml(r), edited: hasChoices(s.choices) || sendsNotes(r), sentAt: s.sentAt, sentTime: time(s.sentAt), skipped: false };
    }
    // Today's choices for this partner (the review window): include, Change, Edit.
    const choices = row.reportEdits[p.id] ?? null;
    const r = reportFor(report, p, choices);
    return { partner: p, report: r, html: reportInnerHtml(r), edited: hasChoices(choices) || sendsNotes(r), sentAt: null, sentTime: null, skipped: row.skippedPartners.includes(p.id) };
  });
  const first = copies[0] ?? null;
  return {
    day,
    dateLabel: fmtDate(day, "EEEE, MMM d"),
    friday,
    weekday,
    weekJudged,
    weekEndName: fmtDate(workWeekOf(day).end, "EEEE"),
    partner: first?.partner ?? partners[0] ?? null,
    partners,
    copies,
    general: (() => {
      const r = reportFor(report, { name: "there", first: "there", sections: REPORT_SECTIONS.map((x) => x.key) }, row.reportEdits[GENERAL_COPY] ?? null);
      return { partner: { id: GENERAL_COPY, name: "there", first: "there", email: null, days: [], sections: REPORT_SECTIONS.map((x) => x.key) }, report: r, html: reportInnerHtml(r), edited: hasChoices(row.reportEdits[GENERAL_COPY]) || sendsNotes(r), sentAt: null, sentTime: null, skipped: false };
    })(),
    editedAt: row.editedAt,
    extras: row.extras,
    auto: row.auto,
    autoSend: i.autoSend ?? true,
    lastSentAt: i.sent.map((c) => c.sentAt).sort().slice(-1)[0] ?? null,
    numbers,
    threshold: i.threshold,
    judged,
    weekSums,
    reasons: row.reasons,
    tomorrow: row.tomorrow,
    tomorrowLabel: tl,
    state: row.status,
    sentAt: row.sentAt,
    sentTime: row.sentAt ? formatInZone(row.sentAt, "h:mm a", i.tz).toLowerCase() : null,
    skipReason: row.skipReason,
    owed: i.owed ? { ...i.owed, dayLabel: fmtDate(i.owed.day, "EEE MMM d") } : null,
    report,
    reportHtml: first ? first.html : row.reportHtml && row.status !== "open" ? row.reportHtml : reportInnerHtml(report),
    reportEdited: first ? first.edited : row.reportEdited,
    metThisWeek: { met: met.met, total: met.total },
    review: friday ? { ...row.weeklyReview, answered: reviewAnswered(row.weeklyReview) } : null,
    eodTime: { short: eodShort(i.eodTime), long: eodLong(i.eodTime), hhmm: parseTime(i.eodTime) ?? DEFAULT_EOD_TIME },
    titleDate: fmtDate(day, "EEE, MMM d"),
    tz: i.tz,
    now: Date.now(),
  };
}

// ---------- Reports ----------

export type { PeriodKey };

export type PeriodView = {
  key: PeriodKey;
  label: string;
  /** "This week, Nov 2 to 6 · partial, through today, Thu Nov 5", "This week, Nov 2 to 6", or "Week of Oct 12 to 16". */
  lead: string;
  tiles: ReturnType<typeof weekTiles>;
  /** The last 4 weeks under each tile, by the tile's label (push B edits). */
  history: Record<string, TileHistory>;
  /** Every target's row; the "What needs you" card lists only the ones not met (missed, or at risk while the week is open). */
  targets: { name: string; line: string; figure: string; met: boolean }[];
  /** How many targets are met in the period (the card's hint, since the Targets met tile gave way to Most missed). */
  met: number;
  /** The period is still being counted (this week before Friday's End of day): an unmet target is under way, not missed. */
  open: boolean;
  waits: Wait[];
  moves: { name: string; line: string; when: string }[];
  passed: { reason: string; line: string; count: number }[];
  /** "this week", "last week", "in October". */
  words: string;
};

/** A reply to a sent report, read from Gmail (push B), or the reply recorded before push B. */
export type SentReply = { id: string; reportId: string; contactId: string | null; name: string; first: string; at: string; dateLabel: string; time: string; text: string; subject: string | null; threadId: string | null };

/** One partner's copy of a sent report (push B). */
export type SentCopyView = { reportId: string; contactId: string | null; name: string; first: string; email: string | null; html: string | null; subject: string | null; threadId: string | null; reviewedTime: string | null };

export type SentRow = {
  id: string;
  day: string;
  /** "Daily, Thu Nov 5" (Find reads it). */
  title: string;
  /** "Thu Nov 5". */
  dayLabel: string;
  /** "Daily report" or "Daily and week report". */
  kind: string;
  summary: string;
  state: "sent" | "skipped";
  sentAt: string | null;
  sentTime: string | null;
  reviewedAt: string | null;
  reviewedTime: string | null;
  subject: string | null;
  html: string | null;
  skipReason: string | null;
  withWeek: boolean;
  /** Who got it, each with the copy as sent. */
  to: SentCopyView[];
  /** The replies, oldest first. */
  replies: SentReply[];
  /** What Find matches: the title, the summary, the replies, and the words of the report as sent (lower case). */
  searchText: string;
};

type SentSection = { key: string; label: string; hint: string; rows: SentRow[]; collapsed: boolean };

export type ReportsPage = { today: string; partner: Partner | null; partners: Partner[]; periods: PeriodView[]; sent: SentSection[]; /** The four full weeks before this one, newest first (the Past weeks tiles, Edit batch C item 7). */ past: WeekTile[]; mostMissed: { name: string; n: number; of: number } | null; /** The waiting threshold from Settings (days): a day count turns amber at it, red at stalledAt (Stalled after, 2026-11-08). */ threshold: number; stalledAt: number };

export async function loadReportsPage(sb: SupabaseClient, ctx: Ctx): Promise<ReportsPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, partners, sentRows, todayRow] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(ctx.today)), loadPartners(sb, ctx.ownerId), loadSentReports(sb, ctx), loadEodRow(sb, ctx.ownerId, ctx.today)]);
  const partner = partners[0] ?? null;
  const week = workWeekOf(ctx.today);
  // This week stays open until Friday's End of day is sent or skipped (the month too, since it holds this week).
  const weekOpen = ctx.today < week.end || (ctx.today === week.end && todayRow.status === "open");
  const last = workWeekOf(addDaysISO(week.start, -7));
  const month = { start: monthStart(ctx.today), end: ctx.today };
  const monthName = fmtDate(ctx.today, "MMMM");
  const defs: { key: PeriodKey; label: string; period: { start: string; end: string }; lead: string; words: string; last: { start: string; end: string } | null }[] = [
    { key: "this", label: "This week", period: week, lead: weekLine(week, { thisWeek: true, open: weekOpen, today: ctx.today }), words: "this week", last },
    { key: "last", label: "Last week", period: last, lead: weekLine(last, { thisWeek: false }), words: "last week", last: workWeekOf(addDaysISO(last.start, -7)) },
    // The older weeks of Past weeks (opened from Targets or a tile; their pill shows only while one is open).
    ...Array.from({ length: PAST_WEEKS - 1 }, (_, i) => {
      const start = addDaysISO(week.start, -7 * (i + 2));
      const period = workWeekOf(start);
      return { key: pastWeekPeriodKey(i + 2), label: `Week of ${fmtDate(start, "MMM d")}`, period, lead: weekLine(period, { thisWeek: false }), words: `the week of ${fmtDate(start, "MMM d")}`, last: workWeekOf(addDaysISO(start, -7)) };
    }),
    { key: "month", label: monthName, period: month, lead: `${monthName} · ${fmtDate(month.start, "MMM d")} to ${fmtDate(ctx.today, "MMM d")} · this week counted so far`, words: `in ${monthName}`, last: null },
  ];
  // Counting starts on (2026-11-09): a past week that ended before it is left out (no pill, no tiles), and nothing is
  // compared with such a week.
  const periods: PeriodView[] = defs.filter((d) => d.key === "this" || d.key === "month" || !beforeCounting(bundle.facts, d.period.end)).map((d) => {
    const w = weekNumbers(targets, bundle.facts, d.period, bundle.waits, bundle.skippedDays, ctx.today);
    const prev = d.last && !beforeCounting(bundle.facts, d.last.end) ? weekNumbers(targets, bundle.facts, d.last, bundle.waits, bundle.skippedDays) : null;
    const open = (d.key === "this" || d.key === "month") && weekOpen;
    // Edit batch C round 2 (item 6): the tiles of "How the week went", with Most missed in place of Targets met.
    const most = mostMissedIn(targets, bundle.facts, d.period, ctx.today, bundle.skippedDays, d.key === "month");
    const mostLabel = d.key === "this" ? "Most missed this week" : d.key === "last" ? "Most missed last week" : d.key === "month" ? `Most missed in ${monthName}` : "Most missed that week";
    const tiles = reportTiles(w, prev, most, { label: mostLabel, open, month: d.key === "month" });
    const history = tileHistories({ targets, facts: bundle.facts, weekStart: d.key === "month" ? week.start : workWeekOf(d.period.start).start, waits: bundle.waits, skipped: bundle.skippedDays, mostLabel, mostName: most?.name ?? null });
    const targetRows = targets.map((t) => targetRow(t, bundle, d.period, d.key, ctx.today));
    return {
      key: d.key,
      open,
      label: d.label,
      lead: d.lead,
      tiles,
      history,
      targets: targetRows,
      met: targetRows.filter((t) => t.met).length,
      waits: bundle.waits,
      moves: bundle.facts.moves
        .filter((m) => m.on >= d.period.start && m.on <= d.period.end)
        .sort((a, b) => (a.on < b.on ? 1 : -1))
        .map((m) => ({ name: m.name, line: `${m.from ?? "New"} to ${m.to}${m.keyFinding ? ` · ${m.keyFinding}` : ""}${m.lane !== "Deals" ? ` · ${m.lane}` : ""}`, when: d.key === "month" ? fmtDate(m.on, "MMM d") : weekdayShort(m.on) })),
      passed: passedByReason(bundle.passes.filter((x) => x.on >= d.period.start && x.on <= d.period.end)),
      words: d.words,
    };
  });
  return { today: ctx.today, partner, partners, periods, sent: groupSent(sentRows, ctx.today), past: pastWeeks(targets, bundle.facts, ctx.today, bundle.skippedDays, PAST_WEEKS), mostMissed: mostMissed(targets, bundle.facts, ctx.today, bundle.skippedDays), threshold: wctx.threshold, stalledAt: stalledAt(wctx.threshold) };
}

function targetRow(t: Target, bundle: FactsBundle, p: { start: string; end: string }, key: PeriodKey, today: string): PeriodView["targets"][number] {
  const c = countIn(t.key, bundle.facts, p.start, p.end);
  if (t.cadence === "day") {
    const days: string[] = [];
    let metDays = 0;
    let counted = 0;
    for (let d = p.start; d <= p.end && d <= today; d = addDaysISO(d, 1)) {
      if (!isWorkDay(d) || bundle.skippedDays.includes(d)) continue;
      counted++;
      const v = countIn(t.key, bundle.facts, d, d).value;
      if (v >= t.number) metDays++;
      if (key !== "month") days.push(`${weekdayShort(d)} ${v}`);
    }
    const required = t.number * Math.max(counted, 1);
    return { name: t.name, line: key === "month" ? `Met on ${metDays} of ${counted} days` : `Met on ${metDays} of ${counted} days${days.length ? ` · ${days.join(", ")}` : ""}`, figure: `${c.value} of ${required}`, met: counted > 0 && c.value >= required };
  }
  const prefix = t.commitment ? "Commitment · " : "";
  if (key === "month") {
    // A per-week target over a month: judged week by week ("Met in 2 of 4 weeks"); this week counts once it is judged.
    let weeks = 0;
    let metWeeks = 0;
    for (let s = workWeekOf(p.start).start; s <= today; s = addDaysISO(s, 7)) {
      const end = workWeekOf(s).end;
      if (end >= today || beforeCounting(bundle.facts, end)) continue;
      weeks++;
      if (countIn(t.key, bundle.facts, s, end).value >= t.number) metWeeks++;
    }
    return { name: t.name, line: `${prefix}Met in ${metWeeks} of ${weeks} ${weeks === 1 ? "week" : "weeks"}`, figure: `${metWeeks} of ${weeks}`, met: weeks > 0 && metWeeks === weeks };
  }
  return { name: t.name, line: `${prefix}${c.detail || "nothing counted yet"}`, figure: figure(t, c.value), met: c.value >= t.number };
}

function passedByReason(rows: FactsBundle["passes"]): PeriodView["passed"] {
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const k = r.reason ?? "No reason";
    groups.set(k, [...(groups.get(k) ?? []), r.name]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([reason, names]) => ({ reason, line: listNames(names, 2), count: names.length }));
}

/**
 * Every End of day report sent or skipped, newest first. A sent day lists each partner's copy (push B) and the
 * replies read from Gmail (linked to the copy they answer); a reply recorded before push B shows the same way.
 */
async function loadSentReports(sb: SupabaseClient, ctx: Ctx): Promise<SentRow[]> {
  // Speed plan (2026-11-07): the days, every partner report copy, the partners and the replies to reports are read at
  // the same moment (one trip), then matched here. A read that reaches its limit is read again by id (pickOrRead).
  const REPORT_COLUMNS = "id,contact_id,period_start,summary,reviewed_at,partner_comment,comment_at,sent_at,snapshot,gmail_thread_id,report_kind";
  const allReportsP = rowsOf(sb.from("partner_reports").select(REPORT_COLUMNS).eq("owner_id", ctx.ownerId).order("sent_at", { ascending: false }).limit(3000), 3000);
  const peopleP = ownerContactsLite(sb, ctx.ownerId);
  const repliesP = rowsOf(sb.from("communications").select("id,partner_report_id,contact_id,occurred_at,subject,summary,gmail_thread_id").eq("owner_id", ctx.ownerId).eq("direction", "incoming").not("partner_report_id", "is", null).order("occurred_at").limit(2000), 2000);
  for (const p of [allReportsP, peopleP, repliesP] as Promise<unknown>[]) p.catch(() => {});
  const { data } = await sb.from("end_of_day").select("id,day,status,sent_at,skip_reason,report_id,report_subject,report_html,judged").eq("owner_id", ctx.ownerId).neq("status", "open").order("day", { ascending: false }).limit(400);
  const rows = (data ?? []) as Row[];
  const days = new Set(rows.filter((r) => r.status === "sent").map((r) => String(r.day).slice(0, 10)));
  const ids = rows.map((r) => r.report_id).filter(Boolean).map(String);
  const all = await allReportsP;
  const byDay = all.full || all.error
    ? days.size ? (((await sb.from("partner_reports").select(REPORT_COLUMNS).eq("owner_id", ctx.ownerId).eq("report_kind", "end_of_day").in("period_start", [...days]).limit(2000)).data ?? []) as Row[]) : []
    : (all.data ?? []).filter((r) => r.report_kind === "end_of_day" && days.has(String(r.period_start).slice(0, 10)));
  const byId = await pickOrRead(allReportsP, "id", ids, (m) => sb.from("partner_reports").select(REPORT_COLUMNS).in("id", m));
  const reports = new Map<string, Row>();
  for (const r of [...byDay, ...byId]) reports.set(String(r.id), r);
  const reportIds = [...reports.keys()];
  const contactIds = [...new Set([...reports.values()].map((r) => r.contact_id).filter(Boolean).map(String))];
  const [people, replyRows] = await Promise.all([
    pickOrRead(peopleP, "id", contactIds, (m) => sb.from("contacts").select("id,name,email").in("id", m)),
    pickOrRead(repliesP, "partner_report_id", reportIds, (m) => sb.from("communications").select("id,partner_report_id,contact_id,occurred_at,subject,summary,gmail_thread_id").eq("owner_id", ctx.ownerId).eq("direction", "incoming").in("partner_report_id", m).order("occurred_at").limit(2000)),
  ]);
  const person = new Map(((people ?? []) as Row[]).map((p) => [String(p.id), p]));
  const nameOf = (id: unknown) => String(person.get(String(id ?? ""))?.name ?? "Your partner");
  const time = (ts: string | null) => (ts ? formatInZone(ts, "h:mm a", ctx.tz).toLowerCase() : null);
  const when = (ts: string | null) => {
    if (!ts) return null;
    const d = todayInTz(ctx.tz, new Date(ts));
    return d === ctx.today ? time(ts) : `${fmtDate(d, "EEE")} ${time(ts)}`;
  };
  const repliesOf = new Map<string, SentReply[]>();
  for (const c of (replyRows ?? []) as Row[]) {
    const rid = String(c.partner_report_id);
    const name = nameOf(c.contact_id ?? reports.get(rid)?.contact_id);
    const at = String(c.occurred_at);
    repliesOf.set(rid, [...(repliesOf.get(rid) ?? []), { id: String(c.id), reportId: rid, contactId: c.contact_id ? String(c.contact_id) : null, name, first: firstName(name), at, dateLabel: fmtDate(todayInTz(ctx.tz, new Date(at)), "MMM d"), time: when(at) ?? "", text: String(c.summary ?? "").trim(), subject: (c.subject as string | null) ?? null, threadId: (c.gmail_thread_id as string | null) ?? null }]);
  }
  return rows.map((r) => {
    const day = String(r.day).slice(0, 10);
    const withWeek = isReviewDay(day);
    const skipped = r.status === "skipped";
    const mine = [...reports.values()].filter((x) => String(x.period_start).slice(0, 10) === day || String(x.id) === String(r.report_id ?? "")).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
    mine.sort((a, b) => String(a.sent_at ?? "").localeCompare(String(b.sent_at ?? "")));
    const to: SentCopyView[] = skipped ? [] : mine.map((x) => {
      const snap = (x.snapshot && typeof x.snapshot === "object" ? x.snapshot : {}) as Row;
      const name = nameOf(x.contact_id);
      return { reportId: String(x.id), contactId: x.contact_id ? String(x.contact_id) : null, name, first: firstName(name), email: (person.get(String(x.contact_id ?? ""))?.email as string | null) ?? null, html: typeof snap.html === "string" ? snap.html : (String(x.id) === String(r.report_id ?? "") ? ((r.report_html as string | null) ?? null) : null), subject: typeof snap.subject === "string" ? snap.subject : ((r.report_subject as string | null) ?? null), threadId: (x.gmail_thread_id as string | null) ?? null, reviewedTime: when((x.reviewed_at as string | null) ?? null) };
    });
    const replies: SentReply[] = [];
    for (const x of mine) {
      const got = repliesOf.get(String(x.id)) ?? [];
      replies.push(...got);
      // The reply recorded on the report before push B (the sample data of batch C).
      if (!got.length && x.partner_comment) {
        const name = nameOf(x.contact_id);
        const at = String(x.comment_at ?? x.sent_at ?? "");
        replies.push({ id: `comment:${x.id}`, reportId: String(x.id), contactId: x.contact_id ? String(x.contact_id) : null, name, first: firstName(name), at, dateLabel: at ? fmtDate(todayInTz(ctx.tz, new Date(at)), "MMM d") : "", time: when(at) ?? "", text: String(x.partner_comment), subject: null, threadId: (x.gmail_thread_id as string | null) ?? null });
      }
    }
    replies.sort((a, b) => (a.at < b.at ? -1 : 1));
    const main = mine.find((x) => String(x.id) === String(r.report_id ?? "")) ?? mine[0] ?? null;
    const reviewed = mine.map((x) => (x.reviewed_at as string | null) ?? null).filter(Boolean).sort()[0] ?? null;
    return {
      id: String(r.id),
      day,
      title: `${skipped ? "Daily" : withWeek ? "Daily with the week" : "Daily"}, ${fmtDate(day, "EEE MMM d")}`,
      dayLabel: fmtDate(day, "EEE MMM d"),
      kind: skipped ? "Daily report" : withWeek ? "Daily and week report" : "Daily report",
      summary: skipped ? `Skipped: ${String(r.skip_reason ?? "no reason given")}` : String(main?.summary ?? ""),
      state: skipped ? "skipped" : "sent",
      sentAt: (r.sent_at as string | null) ?? null,
      sentTime: time((r.sent_at as string | null) ?? null),
      reviewedAt: reviewed,
      reviewedTime: when(reviewed),
      subject: (r.report_subject as string | null) ?? null,
      html: (r.report_html as string | null) ?? null,
      skipReason: (r.skip_reason as string | null) ?? null,
      withWeek,
      to,
      replies,
      searchText: [String(main?.summary ?? ""), String(r.skip_reason ?? ""), ...to.map((t) => t.name), ...replies.map((x) => x.text), htmlWords(String(r.report_html ?? ""))].join(" ").toLowerCase(),
    };
  });
}

/** The words of a report's HTML (tags and character references out), for Find. */
function htmlWords(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** The sent rows by week: This week, Last week, Earlier in <month>, Earlier (collapsed). */
function groupSent(rows: SentRow[], today: string): SentSection[] {
  const week = workWeekOf(today);
  const last = workWeekOf(addDaysISO(week.start, -7));
  const month = monthStart(today);
  const hint = (p: { start: string; end: string }) => `${fmtDate(p.start, "EEE MMM d")} to ${fmtDate(p.end, "EEE MMM d")}`;
  const sections: SentSection[] = [
    { key: "this", label: "This week", hint: hint(week), rows: [], collapsed: false },
    { key: "last", label: "Last week", hint: hint(last), rows: [], collapsed: false },
    { key: "month", label: `Earlier in ${fmtDate(today, "MMMM")}`, hint: `${fmtDate(month, "MMM d")} to ${fmtDate(addDaysISO(last.start, -1), "MMM d")}`, rows: [], collapsed: true },
    { key: "earlier", label: "Earlier", hint: "Before this month", rows: [], collapsed: true },
  ];
  for (const r of rows) {
    if (r.day >= week.start) sections[0].rows.push(r);
    else if (r.day >= last.start) sections[1].rows.push(r);
    else if (r.day >= month) sections[2].rows.push(r);
    else sections[3].rows.push(r);
  }
  return sections.filter((s) => s.rows.length || s.key === "this");
}

// ---------- The Home tile ----------

export type TargetsTile = { available: boolean; notice: string | null; today: string; lines: { id: string; name: string; sub: string; figure: string; label: string; tone: "plain" | "met" | "missed" }[]; met: { met: number; total: number; names: string }; eod: { state: EodState; badge: string; line: string } };

export async function loadTargetsTile(sb: SupabaseClient, ctx: Ctx): Promise<TargetsTile> {
  const empty: TargetsTile = { available: false, notice: null, today: ctx.today, lines: [], met: { met: 0, total: 0, names: "" }, eod: { state: "open", badge: "5:30", line: "" } };
  const notice = null;
  if (notice) return { ...empty, notice };
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, row, owedPrev] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, addDaysISO(workWeekOf(ctx.today).start, -7)), loadEodRow(sb, ctx.ownerId, ctx.today), loadOwedFromSkipped(sb, ctx.ownerId, ctx.today, wctx.countingStart)]);
  const judged = row.status !== "open" && row.judged.length ? row.judged : judgeDay(targets, bundle.facts, ctx.today, bundle.skippedDays);
  const owed = owedReasons(judged, row.reasons).length + (owedPrev?.items.filter((j) => !String(row.reasons[`owed:${owedPrev.day}:${j.targetId}`] ?? "").trim()).length ?? 0);
  const week = workWeekOf(ctx.today);
  const friday = isReviewDay(ctx.today);
  const weekJudged = isWeekJudgedOn(ctx.today);
  const lines = tileTargets(targets).map((t) => {
    const p = t.cadence === "day" ? { start: ctx.today, end: ctx.today } : week;
    const v = countIn(t.key, bundle.facts, p.start, p.end).value;
    return { id: t.id, name: t.name, sub: tileTargetLine(t, v, ctx.today, eodShort(wctx.eodTime)), figure: figure(t, v), label: t.cadence === "day" ? "Today" : "This week", tone: (v >= t.number ? "met" : t.cadence === "week" && weekJudged && !v ? "missed" : "plain") as "plain" | "met" | "missed" };
  });
  const met = metThisWeek(targets, bundle.facts, ctx.today, bundle.skippedDays);
  return {
    available: true,
    notice: null,
    today: ctx.today,
    lines,
    met: { met: met.met, total: met.total, names: listNames(met.names, 2) || "none yet" },
    eod: { state: row.status, badge: row.status === "sent" ? "Sent" : row.status === "skipped" ? "Skipped" : eodShort(wctx.eodTime), line: tileEodLine(owed, row.tomorrow, row.status, row.skipReason, tomorrowLabel(ctx.today), eodShort(wctx.eodTime)) },
  };
}

/** The End of day badge for the menu: "5:30" until the day is closed, then "Sent" or "Skipped". */
export async function loadEodBadge(sb: SupabaseClient, ownerId: string, today: string): Promise<string | null> {
  const [{ data, error }, time] = await Promise.all([sb.from("end_of_day").select("status").eq("owner_id", ownerId).eq("day", today).maybeSingle(), loadEodTime(sb, ownerId)]);
  if (error) return null;
  const s = (data as Row | null)?.status;
  return s === "sent" ? "Sent" : s === "skipped" ? "Skipped" : eodShort(time);
}

/** The End of day time from Settings, Work settings (push D): "17:30" unless changed. */
export async function loadEodTime(sb: SupabaseClient, ownerId: string): Promise<string> {
  const { data } = await sb.from("inputs").select("value_text").eq("owner_id", ownerId).eq("key", "end_of_day_time").maybeSingle();
  return parseTime((data as Row | null)?.value_text) ?? DEFAULT_EOD_TIME;
}

export type { DayNumbers, Judged, Target, TargetView, WeekNumbers, WeekTile };
export { shortName };

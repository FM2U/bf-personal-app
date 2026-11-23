/**
 * The new daily report (release 4, approved by Bram 2026-11-16; claude/2026-11-16-daily-report-rethink-proposal.md and
 * the mockup claude/2026-11-17-report-mockup.html, with the fit line above the pill line, labeled "Upside:"), pure and
 * tested in src/lib/accountability/report-worked.test.ts.
 *
 * Each track ("<Track> · worked on today") lists the records with at least one kept row in Today's activity that day
 * (src/lib/accountability/activity.ts). A track with no work is left out. Each record: its mark (1 to 3 when it is a
 * top priority, a green "+" when it is new today, a dot otherwise), the name and facts, the Upside line (the record's
 * "Why it fits"), the stage, Hot/Warm/Cold, "day N" (or "new today") and "moved from X today", the Today line (the
 * AI's or the owner's, else the kept rows in plain words) and the Next line (the next action and its date).
 *
 * The day counts (six since push J, 2026-11-23): Listings reviewed · Deals added · Deals moved · Brokers contacted ·
 * Calls and meetings · Network outreach.
 */
import type { ActivityRow } from "@/lib/accountability/activity";
import { money, nowLine, partnerName, pickMeta } from "@/lib/accountability/report-v8";
import { daysBetween } from "@/lib/calc/dates";
import { isStrength, pickName, type PriorityColumns, type PriorityKind, type Strength } from "@/lib/work/priorities";

type Row = Record<string, unknown>;

export type WorkedMark = number | "+" | "dot";

export type WorkedRecord = {
  id: string;
  /** 1 to 3 for a top priority, "+" when new today, "dot" otherwise. */
  mark: WorkedMark;
  name: string;
  /** "HVAC service, Columbus OH · $2.1M EBITDA", "$185K base", "$9K project", or null. */
  meta: string | null;
  /** The record's "Why it fits" (the Upside line), or null. */
  upside: string | null;
  stage: string | null;
  strength: Strength | null;
  /** "day 8 since first contact", "new today", or null. */
  since: string | null;
  /** "moved from Interested today", or null. */
  moved: string | null;
  /** What was done on it today: the saved line (AI or typed), else the kept rows in plain words. */
  today: string | null;
  /** The next action and its date ("ask the broker for the CIM, Thu, Nov 19"), or null. */
  next: string | null;
  /** Layout H (2026-11-23): the Size line, figures only ("Revenue" $4.0M, "EBITDA" $1.1M; a job's "Pay", a lead's "Fee"); empty hides the line. */
  size?: { label: string; value: string }[];
};

/** One count in the gray Today box. */
export type TodayCount = { label: string; value: number };

/** The day counts (push J, Bram 2026-11-23: six, in this order). */
export const TODAY_BOX_LABELS = ["Listings reviewed", "Deals added", "Deals moved", "Brokers contacted", "Calls and meetings", "Network outreach"] as const;

/** The day counts, always the same six, in this order. */
export function todayBox(n: { reviewed: number; added: number; moved: number; brokers: number; calls: number; outreach: number }): TodayCount[] {
  const v = [n.reviewed, n.added, n.moved, n.brokers, n.calls, n.outreach];
  return TODAY_BOX_LABELS.map((label, i) => ({ label, value: Math.max(0, Math.round(v[i] || 0)) }));
}

/** A kept Listing row that took the listing in ("Screened and marked Interested"), not a pass. */
const tookIn = (r: Pick<ActivityRow, "kind" | "text">) => r.kind === "listing" && /^Screened and marked Interested/.test(r.text);

/**
 * The counts from the day's facts less the rows dropped on End of day (release 4; six since push J): listings reviewed
 * from the hand-entered total, deals added from the kept Listing rows that marked a listing Interested, deals moved
 * from the kept Moved rows on acquisition deals, calls and meetings from the kept Call and Meeting rows, and brokers
 * and outreach from the day's emails and calls (the same rules as the targets) less the dropped ones. `comms` are the
 * day's counted contacts with their row id ("comm:<id>").
 */
export function keptBox(i: { kept: readonly ActivityRow[]; dropped: ReadonlySet<string>; comms: readonly { rowId: string; contactId: string | null; broker: boolean; method: string }[]; acquisitionIds: ReadonlySet<string>; reviewed?: number }): TodayCount[] {
  const isCall = (m: string) => m === "call" || m === "meeting" || m === "video";
  const counted = i.comms.filter((c) => !i.dropped.has(c.rowId) && !!c.contactId && (c.method === "email" || isCall(c.method)));
  return todayBox({
    reviewed: i.reviewed ?? 0,
    added: i.kept.filter(tookIn).length,
    moved: i.kept.filter((r) => r.kind === "move" && i.acquisitionIds.has(recordOfRow(r)?.id ?? "")).length,
    brokers: new Set(counted.filter((c) => c.broker).map((c) => c.contactId)).size,
    calls: i.kept.filter((r) => r.kind === "call" || r.kind === "meeting").length,
    outreach: counted.length,
  });
}

/** The counts after the date in the subject line: the counts above zero, in the box's order, at most three. */
export function subjectCounts(box: readonly TodayCount[]): string {
  const words: Record<string, [string, string]> = {
    "Listings reviewed": ["listing reviewed", "listings reviewed"],
    "Deals added": ["deal added", "deals added"],
    "Deals moved": ["deal moved", "deals moved"],
    "Brokers contacted": ["broker contacted", "brokers contacted"],
    "Calls and meetings": ["call or meeting", "calls and meetings"],
    "Network outreach": ["outreach contact", "outreach contacts"],
  };
  return box
    .filter((c) => c.value > 0 && words[c.label])
    .slice(0, 3)
    .map((c) => `${c.value} ${words[c.label][c.value === 1 ? 0 : 1]}`)
    .join(", ");
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RECORD_HREF = new RegExp(`^/work/(deals|jobs|consulting|rosara)/(${UUID})(?:[/?#]|$)`, "i");

/** The record a row of Today's activity is about, from its link: a deal, listing, job or consulting lead, or a Rosara project. People are not records here. */
export function recordOfRow(r: Pick<ActivityRow, "href" | "recordHref">): { table: "pipeline_items" | "projects"; id: string } | null {
  const m = RECORD_HREF.exec(String(r.recordHref || r.href || ""));
  if (!m) return null;
  return { table: m[1].toLowerCase() === "rosara" ? "projects" : "pipeline_items", id: m[2].toLowerCase() };
}

export const TODAY_LINE_MAX = 220;
/** The words the app starts its own rows with; only these are put in lower case inside a sentence (a calendar title or a name keeps its capitals). */
const APP_WORDS = /^(Moved|Screened|Call|Meeting|Email|Next action done|Work)\b/;
/** A listing's "00 " start is never shown to partners (2026-11-16). */
const no00 = (t: string) => t.replace(/(^|[\s(,;:])00 (?=\S)/g, "$1");

/** One kept row in the words of the fallback Today line; a note's text stays in the app (a private thought never goes out). */
export function rowWords(r: Pick<ActivityRow, "kind" | "text">): string {
  if (r.kind === "note") return "added notes";
  const t = no00(r.text.replace(/\s+/g, " ").trim());
  return APP_WORDS.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/** The kept rows of one record in plain words, when no Today line is saved: "moved from Interested to NDA signed; call with Mark Reed, 30 min". */
export function rowsLine(rows: readonly ActivityRow[]): string | null {
  const parts = [...new Set(rows.map(rowWords).filter(Boolean))];
  if (!parts.length) return null;
  const t = parts.join("; ");
  return t.length > TODAY_LINE_MAX ? `${t.slice(0, TODAY_LINE_MAX - 1).trimEnd()}…` : t;
}

export type WorkedTracks = Record<PriorityKind, WorkedRecord[]>;

/** The kept rows grouped by record id (rows about people only are left out). */
export function rowsByRecord(rows: readonly ActivityRow[]): Map<string, ActivityRow[]> {
  const out = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const rec = recordOfRow(r);
    if (!rec) continue;
    const list = out.get(rec.id) ?? [];
    list.push(r);
    out.set(rec.id, list);
  }
  return out;
}

/**
 * Every track's records worked on today. `rows` are the kept rows of Today's activity (dropped rows already left
 * out); `items` the pipeline items (with pipeline_id, status, stage_id, screened, created_at, stage_entered_at,
 * why_fits, strength, next_action, next_action_due and the facts fields); `projects` the Rosara projects; `history`
 * the stage history (item_id, stage_id, entered_at); `columns` the top priorities (for the numbers); `todayText` the
 * saved Today lines by record id. Only open records show.
 */
export function buildWorked(i: {
  rows: readonly ActivityRow[];
  items: Row[];
  projects: Row[];
  pipes: { acquisition: string | null; job: string | null; consulting: string | null };
  stageById: Record<string, { name: string; outcome: string }>;
  history: Row[];
  columns: PriorityColumns | null;
  ebitda: Map<string, number>;
  /** Layout H (2026-11-23): revenue by deal, for the Size line. */
  revenue?: Map<string, number>;
  day: string;
  local: (ts: string) => string;
  todayText: Record<string, string>;
}): WorkedTracks {
  const out: WorkedTracks = { acquisition: [], job: [], consulting: [], startup: [] };
  const byRecord = rowsByRecord(i.rows);
  if (!byRecord.size) return out;
  const itemById = new Map(i.items.map((r) => [String(r.id).toLowerCase(), r]));
  const projectById = new Map(i.projects.map((r) => [String(r.id).toLowerCase(), r]));
  const numberOf = new Map<string, number>();
  if (i.columns) for (const k of ["acquisition", "job", "consulting", "startup"] as const) for (const p of i.columns[k]) numberOf.set(p.id.toLowerCase(), p.number);
  const kindOfPipe = (pipe: string): PriorityKind | null => (pipe === i.pipes.acquisition ? "acquisition" : pipe === i.pipes.job ? "job" : pipe === i.pipes.consulting ? "consulting" : null);
  const historyOf = new Map<string, Row[]>();
  for (const h of i.history) {
    if (!h.entered_at || !h.stage_id) continue;
    const id = String(h.item_id).toLowerCase();
    if (!byRecord.has(id)) continue;
    const list = historyOf.get(id) ?? [];
    list.push(h);
    historyOf.set(id, list);
  }
  for (const list of historyOf.values()) list.sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at)));
  const stageName = (id: unknown) => i.stageById[String(id)]?.name ?? null;
  const dayOf = (ts: unknown) => (ts ? i.local(String(ts)) : null);
  const text = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };

  for (const [id, rows] of byRecord) {
    const savedToday = text(i.todayText[id]);
    const today = savedToday ?? rowsLine(rows);
    const item = itemById.get(id);
    if (item) {
      const kind = kindOfPipe(String(item.pipeline_id));
      if (!kind || String(item.status ?? "open") !== "open") continue;
      if (kind === "acquisition" && item.screened === false) continue;
      const hist = historyOf.get(id) ?? [];
      const created = dayOf(item.created_at);
      const firstStage = hist.length ? dayOf(hist[0].entered_at) : null;
      // New today: added today, or (a listing) screened today for the first time.
      const isNew = created === i.day || firstStage === i.day;
      const first = [created, firstStage, dayOf(item.stage_entered_at)].filter((d): d is string => !!d).sort()[0] ?? null;
      const stage = stageName(item.stage_id);
      // Moved today: the stage before today's first move (or, for a record new today, its first stage today).
      const before = hist.filter((h) => (dayOf(h.entered_at) ?? "") < i.day);
      const todays = hist.filter((h) => dayOf(h.entered_at) === i.day);
      const from = todays.length ? (before.length ? stageName(before[before.length - 1].stage_id) : todays.length > 1 ? stageName(todays[0].stage_id) : null) : null;
      const moved = from && stage && from !== stage ? `moved from ${from} today` : null;
      const num = numberOf.get(id);
      out[kind].push({
        id,
        mark: num ?? (isNew ? "+" : "dot"),
        name: partnerName(pickName(kind, item)),
        meta: pickMeta(kind, item, i.ebitda.get(String(item.id)) ?? null),
        upside: text(item.why_fits),
        stage,
        strength: isStrength(item.strength) ? item.strength : null,
        since: isNew ? "new today" : first ? `day ${Math.max(1, daysBetween(first, i.day) + 1)} since first contact` : null,
        moved,
        today,
        next: nowLine(item),
        size: sizeOf(kind, item, i.revenue?.get(String(item.id)) ?? null, i.ebitda.get(String(item.id)) ?? null),
      });
      continue;
    }
    const project = projectById.get(id);
    if (project) {
      if (String(project.status ?? "open") !== "open") continue;
      const created = dayOf(project.created_at);
      const isNew = created === i.day;
      const num = numberOf.get(id);
      out.startup.push({
        id,
        mark: num ?? (isNew ? "+" : "dot"),
        name: text(project.name) ?? "Untitled",
        meta: null,
        upside: text(project.why_fits),
        stage: text(project.milestone),
        strength: isStrength(project.strength) ? project.strength : null,
        since: isNew ? "new today" : created ? `day ${Math.max(1, daysBetween(created, i.day) + 1)} since start` : null,
        moved: null,
        today,
        next: nowLine(project),
      });
    }
  }
  // Top priorities first (1, 2, 3), then the records new today, then the rest, each by name.
  const rank = (m: WorkedMark) => (typeof m === "number" ? m : m === "+" ? 10 : 20);
  for (const k of ["acquisition", "job", "consulting", "startup"] as const) out[k].sort((a, b) => rank(a.mark) - rank(b.mark) || a.name.localeCompare(b.name));
  return out;
}

/** The Size line's figures (layout H, 2026-11-23): a deal's revenue and EBITDA, a job's pay, a lead's fee; missing ones left out. */
export function sizeOf(kind: PriorityKind, item: Row, revenue: number | null, ebitda: number | null): { label: string; value: string }[] {
  if (kind === "acquisition") return [revenue ? { label: "Revenue", value: money(revenue) } : null, ebitda ? { label: "EBITDA", value: money(ebitda) } : null].filter((x): x is { label: string; value: string } => !!x);
  if (kind === "job") {
    const pay = String(item.pay_range ?? "").trim();
    return pay ? [{ label: "Pay", value: pay }] : [];
  }
  if (kind === "consulting") return Number(item.fee) > 0 ? [{ label: "Fee", value: money(Number(item.fee)) }] : [];
  return [];
}

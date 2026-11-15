/**
 * The report's new layout (v8, approved by Bram 2026-11-15; claude/2026-11-15-report-redesign-decisions-log.md),
 * pure and tested in src/lib/accountability/report-v8.test.ts: per track (Acquisition, Job search, Consulting,
 * Startup) the top priorities as the report shows them, "Decided this week", and the Pipeline table ("Added this week"
 * and "In stage today" per column; a column can count several stages).
 */
import { shortDay, type PriorityColumns, type PriorityKind, type PriorityNext, type Strength } from "@/lib/work/priorities";

type Row = Record<string, unknown>;

export type ReportPick = {
  id: string;
  number: number;
  name: string;
  /** "HVAC service, Columbus OH · $2.1M EBITDA", "$185K base", "$9K project", or null. */
  meta: string | null;
  stage: string | null;
  strength: Strength | null;
  /** "day 23 since first contact". */
  since: string | null;
  /** "moved to Seller call today", or null. */
  moved: string | null;
  why: string | null;
  /** The next action and its due date ("call the owner, Thu, Nov 19"), or null. */
  now: string | null;
  /** "go or no-go on an LOI by Wed, Nov 25"; amber when moved later or passed. */
  next: { words: string; amber: boolean } | null;
};
export type PipelineCol = { label: string; added: number | null; inStage: number | null };
export type ReportTrack = { picks: ReportPick[]; decided: string | null; pipeline: PipelineCol[] | null };
export type ReportTracks = { acquisition: ReportTrack; job: ReportTrack; consulting: ReportTrack; startup: ReportTrack; /** Startup work in the report's period: the Startup section shows only then. */ startupActive: boolean };

/** The Pipeline table's columns (decided 2026-11-15): each counts the open records in its stages. */
export const PIPELINE_COLUMNS: Record<"acquisition" | "job" | "consulting", { label: string; stages: string[]; screened?: boolean }[]> = {
  acquisition: [
    { label: "Screened", stages: [], screened: true },
    { label: "CIM review", stages: ["Interested", "NDA signed", "CIM review"] },
    { label: "Seller call", stages: ["Broker call", "Seller call"] },
    { label: "Diligence", stages: ["Diligence"] },
    { label: "LOI", stages: ["Partner presentation", "IOI or LOI", "Confirmatory diligence"] },
  ],
  job: [
    { label: "Lead", stages: ["Lead"] },
    { label: "Applied", stages: ["Applied"] },
    { label: "Interview", stages: ["Interview"] },
    { label: "Offer", stages: ["Offer"] },
  ],
  consulting: [
    { label: "Lead", stages: ["Lead"] },
    { label: "Intro call", stages: ["Intro call"] },
    { label: "Proposal sent", stages: ["Proposal sent"] },
    { label: "Engagement", stages: ["Engagement", "Paid"] },
  ],
};

/** "Wed, Nov 25" from YYYY-MM-DD. */
export function dayWithWeekday(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The report's Next words: "go or no-go by Wed, Nov 25"; "go or no-go, moved from Nov 20 to Dec 1" and "… by Nov 14, passed" amber. */
export function reportNext(n: PriorityNext | null): ReportPick["next"] {
  if (!n) return null;
  const t = lower(n.text);
  if (!n.on) return { words: t, amber: false };
  if (n.passed) return { words: `${t} by ${shortDay(n.on)}, passed`, amber: true };
  if (n.movedFrom) return { words: `${t}, moved from ${shortDay(n.movedFrom)} to ${shortDay(n.on)}`, amber: true };
  return { words: `${t} by ${dayWithWeekday(n.on)}`, amber: false };
}

/** "$2.1M", "$850K", "$900". */
export function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

/** The line after a pick's name. */
export function pickMeta(kind: PriorityKind, r: Row | undefined, ebitda: number | null): string | null {
  if (!r) return null;
  const t = (v: unknown) => String(v ?? "").trim();
  if (kind === "acquisition") {
    const what = [t(r.what_it_does), t(r.location)].filter(Boolean).join(", ");
    return [what, ebitda ? `${money(ebitda)} EBITDA` : ""].filter(Boolean).join(" · ") || null;
  }
  if (kind === "job") return t(r.pay_range) || t(r.location) || null;
  if (kind === "consulting") return Number(r.fee) > 0 ? `${money(Number(r.fee))} project` : null;
  return null;
}

/** "call the owner, Thu, Nov 19" from the next action and its due date. */
export function nowLine(r: Row | undefined): string | null {
  const a = String(r?.next_action ?? "").trim();
  if (!a) return null;
  const due = String(r?.next_action_due ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${lower(a)}, ${dayWithWeekday(due)}` : lower(a);
}

/**
 * Every track of the report from the picks (loadPriorities), the records' rows (what_it_does, location, pay_range,
 * fee, next_action, next_action_due, pipeline_id, stage_id, status, screened), the EBITDA by deal, the stage history,
 * the stage names, the decisions of the week, the listings screened this week, and the week's first day.
 */
export function buildTracks(i: {
  columns: PriorityColumns;
  items: Row[];
  projects: Row[];
  ebitda: Map<string, number>;
  history: Row[];
  stageById: Record<string, { name: string; outcome: string }>;
  pipes: { acquisition: string | null; job: string | null; consulting: string | null };
  decisions: Row[];
  screenedThisWeek: number;
  weekStart: string;
  day: string;
  local: (ts: string) => string;
  startupActive: boolean;
}): ReportTracks {
  const itemById = new Map(i.items.map((r) => [String(r.id), r]));
  const projectById = new Map(i.projects.map((r) => [String(r.id), r]));
  const picksOf = (kind: PriorityKind): ReportPick[] =>
    i.columns[kind].map((p) => {
      const r = kind === "startup" ? projectById.get(p.id) : itemById.get(p.id);
      return {
        id: p.id,
        number: p.number,
        name: p.name,
        meta: pickMeta(kind, r, i.ebitda.get(p.id) ?? null),
        stage: p.stage,
        strength: p.strength,
        since: p.day ? `day ${p.day} since ${kind === "startup" ? "start" : "first contact"}` : null,
        moved: p.movedToday && p.stage ? `moved to ${p.stage} today` : null,
        why: p.why,
        now: nowLine(r),
        next: reportNext(p.next),
      };
    });
  const nameOf = (d: Row): string => {
    const r = d.project_id ? projectById.get(String(d.project_id)) : itemById.get(String(d.pipeline_item_id));
    return String((r?.company_name as string) || r?.name || "A record");
  };
  const kindOfDecision = (d: Row): PriorityKind | null => {
    if (d.project_id) return "startup";
    const r = itemById.get(String(d.pipeline_item_id));
    const pipe = String(r?.pipeline_id ?? "");
    return pipe === i.pipes.acquisition ? "acquisition" : pipe === i.pipes.job ? "job" : pipe === i.pipes.consulting ? "consulting" : null;
  };
  const decidedOf = (kind: PriorityKind): string | null => {
    const lines = i.decisions
      .filter((d) => kindOfDecision(d) === kind && String(d.decided_on).slice(0, 10) >= i.weekStart && String(d.decided_on).slice(0, 10) <= i.day)
      .sort((a, b) => String(a.decided_on).localeCompare(String(b.decided_on)))
      .map((d) => `${nameOf(d)}, ${d.outcome === "go" ? "go" : "no-go"} on ${shortDay(String(d.decided_on).slice(0, 10))}${d.line ? ` (${lower(String(d.line))})` : ""}`);
    return lines.length ? lines.join("; ") : null;
  };
  const pipelineOf = (kind: "acquisition" | "job" | "consulting"): PipelineCol[] | null => {
    const pipe = i.pipes[kind];
    if (!pipe) return null;
    const open = i.items.filter((r) => String(r.pipeline_id) === pipe && r.status === "open" && !(kind === "acquisition" && r.screened === false));
    const inPipe = new Set(i.items.filter((r) => String(r.pipeline_id) === pipe).map((r) => String(r.id)));
    // Each record's stage entries in order, so a move inside one column (Interested to CIM review) is not "added".
    const byItem = new Map<string, Row[]>();
    for (const h of i.history) {
      if (!inPipe.has(String(h.item_id)) || !h.entered_at) continue;
      const list = byItem.get(String(h.item_id)) ?? [];
      list.push(h);
      byItem.set(String(h.item_id), list);
    }
    for (const list of byItem.values()) list.sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at)));
    const inWeek = (h: Row) => {
      const d = i.local(String(h.entered_at));
      return d >= i.weekStart && d <= i.day;
    };
    return PIPELINE_COLUMNS[kind].map((c) => {
      if (c.screened) return { label: c.label, added: i.screenedThisWeek, inStage: null };
      const inCol = (stageId: unknown) => c.stages.includes(i.stageById[String(stageId)]?.name ?? "");
      // A record counts once per column for the week: it entered the column this week from outside it (or new).
      let added = 0;
      for (const list of byItem.values()) if (list.some((h, n) => inWeek(h) && inCol(h.stage_id) && (n === 0 || !inCol(list[n - 1].stage_id)))) added++;
      return { label: c.label, added, inStage: open.filter((r) => inCol(r.stage_id)).length };
    });
  };
  const track = (kind: PriorityKind): ReportTrack => ({ picks: picksOf(kind), decided: decidedOf(kind), pipeline: kind === "startup" ? null : pipelineOf(kind) });
  return { acquisition: track("acquisition"), job: track("job"), consulting: track("consulting"), startup: track("startup"), startupActive: i.startupActive };
}

/**
 * Top priorities (Bram, 2026-11-15; claude/2026-11-15-report-redesign-decisions-log.md and the approved mockup
 * 2026-11-15-top-priorities-app-mockup.png), pure and tested in src/lib/work/priorities.test.ts.
 *
 * Up to three picks per track: Acquisition (screened open deals), Job search and Consulting (open items), and Startup
 * (open Rosara projects). A pick is a record with priority_rank 1 to 3 (database update I). Closed records and
 * listings never show, even when they still carry a rank; the picks show numbered 1, 2, 3 in rank order.
 *
 * Each pick shows: its number, its name, the stage (a project's milestone), How strong (Hot, Warm, Cold), "day N" since
 * first contact (when the record was added, or its stage date when earlier), "moved today" when it entered its stage today, one Why line and one Next line.
 * The Next line is amber when its date has passed or was moved later (the latest change of next_decision_on in the
 * change log went from an earlier date to a later one).
 */
import { daysBetween } from "@/lib/calc/dates";

export type PriorityKind = "acquisition" | "job" | "consulting" | "startup";
export const PRIORITY_KINDS: readonly PriorityKind[] = ["acquisition", "job", "consulting", "startup"];
export type PriorityTable = "pipeline_items" | "projects";
export type Strength = "hot" | "warm" | "cold";
export const STRENGTHS: readonly { value: Strength; label: string }[] = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];
export const MAX_PICKS = 3;

/** The column heading and the empty slot's words per track. */
export const PRIORITY_TRACKS: Record<PriorityKind, { label: string; choose: string; none: string; noun: string }> = {
  acquisition: { label: "Acquisition", choose: "Choose a deal", none: "No open deals yet.", noun: "deal" },
  job: { label: "Job search", choose: "Choose a job", none: "No open jobs yet.", noun: "job" },
  consulting: { label: "Consulting", choose: "Choose a consulting lead", none: "No open consulting leads yet.", noun: "consulting lead" },
  startup: { label: "Startup", choose: "Choose a project", none: "No open Rosara projects yet.", noun: "project" },
};

export function isStrength(v: unknown): v is Strength {
  return v === "hot" || v === "warm" || v === "cold";
}

export function strengthLabel(v: Strength | null | undefined): string | null {
  return STRENGTHS.find((s) => s.value === v)?.label ?? null;
}

type Row = Record<string, unknown>;

export type PriorityNext = {
  text: string;
  /** YYYY-MM-DD or null. */
  on: string | null;
  /** The date it was moved from (the later date is `on`), when the latest change moved it later. */
  movedFrom: string | null;
  /** The date is before today. */
  passed: boolean;
};

export type PriorityPick = {
  id: string;
  table: PriorityTable;
  kind: PriorityKind;
  /** 1, 2 or 3, in rank order among the open picks. */
  number: number;
  /** The rank saved on the record (may differ from `number` after a pick closed). */
  rank: number;
  name: string;
  href: string;
  /** The stage name, or a project's milestone. */
  stage: string | null;
  strength: Strength | null;
  /** Days since the record was added, counting that day as day 1. */
  day: number | null;
  movedToday: boolean;
  why: string | null;
  next: PriorityNext | null;
};

export type PriorityColumns = Record<PriorityKind, PriorityPick[]>;

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const day10 = (v: unknown): string | null => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/** A change-log value: a JSON string "2026-11-20" (jsonb), or null. */
const logDay = (v: unknown): string | null => day10(typeof v === "string" ? v.replace(/^"|"$/g, "") : v);

/** The name a pick shows: a job is "Role, Company"; a consulting item is "Project, Client"; anything else its name. */
export function pickName(kind: PriorityKind, r: Row): string {
  const name = text(r.company_name) ?? text(r.name) ?? "Untitled";
  if (kind === "job") return [text(r.role_title), text(r.name)].filter(Boolean).join(", ") || name;
  if (kind === "consulting") return [text(r.what_it_does), text(r.name)].filter(Boolean).join(", ") || name;
  return name;
}

export function pickHref(kind: PriorityKind, id: string): string {
  return kind === "acquisition" ? `/work/deals/${id}` : kind === "job" ? `/work/jobs/${id}` : kind === "consulting" ? `/work/consulting/${id}` : `/work/rosara/${id}`;
}

/** The latest change of next_decision_on per record: moved later when that change went from an earlier date to a later one. */
export function movedFromByRecord(moves: Row[]): Map<string, string | null> {
  const latest = new Map<string, Row>();
  for (const m of moves) {
    const id = String(m.record_id ?? "");
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || String(m.created_at ?? "") > String(prev.created_at ?? "")) latest.set(id, m);
  }
  const out = new Map<string, string | null>();
  for (const [id, m] of latest) {
    const from = logDay(m.old_value);
    const to = logDay(m.new_value);
    out.set(id, from && to && to > from ? from : null);
  }
  return out;
}

/**
 * The picks per track from the ranked records (pipeline_items and projects with a priority_rank), the pipelines (id,
 * kind), the stages (id, name) and the change-log rows of next_decision_on. `localDate` turns a timestamp into the
 * owner's local YYYY-MM-DD.
 */
export function buildPriorityColumns(i: { items: Row[]; projects: Row[]; pipelines: Row[]; stages: Row[]; moves: Row[]; today: string; localDate: (ts: string) => string }): PriorityColumns {
  const kindOf = new Map(i.pipelines.map((p) => [String(p.id), String(p.kind)]));
  const stageOf = new Map(i.stages.map((s) => [String(s.id), text(s.name)]));
  const moved = movedFromByRecord(i.moves);
  const out: PriorityColumns = { acquisition: [], job: [], consulting: [], startup: [] };
  const nextOf = (r: Row): PriorityNext | null => {
    const t = text(r.next_decision);
    const on = day10(r.next_decision_on);
    if (!t && !on) return null;
    const from = moved.get(String(r.id)) ?? null;
    return { text: t ?? "Decide", on, movedFrom: from && on ? from : null, passed: !!on && on < i.today };
  };
  const dayOf = (created: unknown) => (text(created) ? Math.max(1, daysBetween(i.localDate(String(created)), i.today) + 1) : null);
  for (const r of i.items) {
    const kind = kindOf.get(String(r.pipeline_id));
    if (kind !== "acquisition" && kind !== "job" && kind !== "consulting") continue;
    if (String(r.status ?? "open") !== "open" || (kind === "acquisition" && r.screened === false)) continue;
    const rank = Number(r.priority_rank);
    if (!(rank >= 1 && rank <= MAX_PICKS)) continue;
    const created = text(r.created_at);
    const entered = text(r.stage_entered_at);
    out[kind].push({
      id: String(r.id),
      table: "pipeline_items",
      kind,
      number: 0,
      rank,
      name: pickName(kind, r),
      href: pickHref(kind, String(r.id)),
      stage: stageOf.get(String(r.stage_id)) ?? null,
      strength: isStrength(r.strength) ? r.strength : null,
      // First contact: when the record was added, or its stage date when that is earlier (a deal entered later with its history).
      day: dayOf([created, entered].filter((x): x is string => !!x).sort()[0] ?? null),
      movedToday: !!entered && !!created && i.localDate(entered) === i.today && i.localDate(created) !== i.today,
      why: text(r.why_fits),
      next: nextOf(r),
    });
  }
  for (const r of i.projects) {
    if (String(r.status ?? "open") !== "open") continue;
    const rank = Number(r.priority_rank);
    if (!(rank >= 1 && rank <= MAX_PICKS)) continue;
    out.startup.push({
      id: String(r.id),
      table: "projects",
      kind: "startup",
      number: 0,
      rank,
      name: text(r.name) ?? "Untitled",
      href: pickHref("startup", String(r.id)),
      stage: text(r.milestone),
      strength: isStrength(r.strength) ? r.strength : null,
      day: dayOf(r.created_at),
      movedToday: false,
      why: text(r.why_fits),
      next: nextOf(r),
    });
  }
  for (const k of PRIORITY_KINDS) {
    out[k].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    out[k] = out[k].slice(0, MAX_PICKS).map((p, n) => ({ ...p, number: n + 1 }));
  }
  return out;
}

/** "Nov 25" from YYYY-MM-DD. */
export function shortDay(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The Next line's words and tone: "go or no-go on an LOI by Nov 25"; "go or no-go, moved to Dec 1" (amber); "… by Nov 20, passed" (amber). */
export function nextWords(n: PriorityNext | null): { words: string; amber: boolean } | null {
  if (!n) return null;
  const t = n.text.charAt(0).toLowerCase() + n.text.slice(1);
  if (!n.on) return { words: t, amber: false };
  if (n.passed) return { words: `${t} by ${shortDay(n.on)}, passed`, amber: true };
  if (n.movedFrom) return { words: `${t}, moved to ${shortDay(n.on)}`, amber: true };
  return { words: `${t} by ${shortDay(n.on)}`, amber: false };
}

/**
 * Where every pick of one track goes when `id` is put at `to` (1 to 3) or taken off (null): the others keep their
 * order, close up, and move down one place from `to`; a fourth falls off. `current` lists the open picks of the track
 * in rank order. Returns the new rank of every record involved (null: no longer a pick).
 */
export function planRanks(current: readonly string[], id: string, to: number | null): Map<string, number | null> {
  const others = current.filter((x) => x !== id);
  const order = to === null ? others : [...others.slice(0, Math.max(0, Math.min(to, MAX_PICKS) - 1)), id, ...others.slice(Math.max(0, Math.min(to, MAX_PICKS) - 1))];
  const out = new Map<string, number | null>();
  for (const x of new Set([...current, id])) out.set(x, null);
  order.slice(0, MAX_PICKS).forEach((x, n) => out.set(x, n + 1));
  return out;
}

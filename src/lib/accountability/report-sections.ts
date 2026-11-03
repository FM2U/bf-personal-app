/**
 * The End of day report's sections (Push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/report-sections.test.ts. One builder makes every section from the day's data, a partner's
 * standing sections, and today's choices for that partner (include, Change, Edit); the email
 * (src/lib/accountability/report-email.ts) and the report window on End of day both draw from it, so the sent email
 * is exactly what the window shows.
 *
 * Sections, in order: Today (tiles), Targets, Top 3 deals, Active today (Friday: Active this week), Waiting on
 * brokers, Job search, The week (Fridays, tiles), Tomorrow (or Monday). A list section is parent lines with child
 * lines under them ("Waiting on brokers over 5 days" over "Summit Logistics Group: 11 days, Mark Reed").
 */
import type { ReportTile } from "@/lib/accountability/targets";
import type { TileStatus } from "@/lib/calc/partner-report";

export type SectionKey = "today" | "targets" | "top" | "active" | "waiting" | "jobs" | "week" | "tomorrow";
export const SECTION_ORDER: SectionKey[] = ["today", "targets", "top", "active", "waiting", "jobs", "week", "tomorrow"];

/** An open deal or job opportunity as the report shows it. */
export type ReportDeal = {
  id: string;
  name: string;
  stage: string;
  /** The stage's place in the pipeline (higher is further along). */
  position: number;
  /** The newest activity on it (ISO timestamp or date), for the order. */
  lastActivity: string;
  /** "Waiting on Mark Reed: a seller call to be scheduled, since Oct 23 (11 days)". */
  status: string;
  /** "Push Mark for the call, Nov 4", or null. */
  next: string | null;
  /** What happened in the report's period ("Moved to Broker call", "Rachel Kim emailed: CIM received"), oldest first. */
  activity: string[];
};

export type ReportTarget = { id: string; group: "missed" | "now" | "met"; /** "Listings screened: 3 of 5 today, 8 of 10 this week". */ text: string; commitment: boolean; /** A missed commitment asks a reason; null while not given. */ asks: boolean; reason: string | null };

export type ReportData = {
  partnerName: string;
  /** The partner's first name ("Jake"). */
  partnerFirst: string;
  /** "Friday, Oct 31, 2026". */
  dateLong: string;
  /** "Friday, Oct 31". */
  dateShort: string;
  /** The Friday report adds the week. */
  withWeek: boolean;
  pill: { text: string; status: TileStatus };
  today: ReportTile[];
  targets: ReportTarget[];
  /** The reasons owed from a skipped day ("Owed from Monday"). */
  owed: { dayWord: string; items: { id: string; text: string; reason: string | null }[] } | null;
  /** Open waits on brokers over the threshold, longest first. */
  waits: { id: string; name: string; days: number; who: string | null }[];
  threshold: number;
  /** Open acquisition deals (the Top 3 candidates), furthest along first. */
  deals: ReportDeal[];
  /** Open job opportunities, furthest along first. */
  jobs: ReportDeal[];
  /** "today" on a daily report, "this week" on Friday's. */
  period: "today" | "this week";
  week: { label: string; tiles: ReportTile[] } | null;
  tomorrow: { label: "Tomorrow" | "Monday"; text: string | null };
  /** The sections this partner gets as a standing choice (their page). Null or missing: every section. */
  sections?: readonly string[] | null;
  /** Today's choices for this partner (the review window). */
  choices?: ReportChoices | null;
};

/**
 * Today's choices for one partner's copy (the review window on End of day), saved with the day's End of day row:
 * which sections go (over the standing choice), what Change left out (by item id), the 3 deals picked for Top 3, and
 * each section's text as rewritten with Edit.
 */
export type ReportChoices = {
  include?: Partial<Record<SectionKey, boolean>>;
  hidden?: Partial<Record<SectionKey, string[]>>;
  top?: string[] | null;
  edits?: Partial<Record<SectionKey, string>>;
};

/** One line of a list: "**Summit Logistics Group:** 11 days" (lead), "Stage: CIM review" (label, muted), or plain. */
export type Line = { lead?: string; label?: string; text: string; todo?: string };
export type Item = { id: string; line: Line; sub?: Line[] };
/** A parent line with its children. A block with no items is a heading line ("Top 3 opportunities"). */
export type Block = { title?: string; tone?: "red" | "amber" | "green"; items: Item[] };

export type BuiltSection = {
  key: SectionKey;
  title: string;
  kind: "tiles" | "list" | "line";
  tiles: ReportTile[];
  blocks: Block[];
  line: string | null;
  /** In the email today (standing choice, or today's tick). */
  included: boolean;
  /** This partner gets the section as a standing choice. */
  standing: boolean;
  /** The text as rewritten today (Edit), or null for the app's text. */
  edited: string | null;
  /** The app's text of the section (what Edit starts from). */
  text: string;
  /** What Change can show or hide (null: no Change). Top 3 uses `pick` instead. */
  choices: { id: string; label: string; on: boolean }[] | null;
  /** Top 3: every candidate deal, with the picked ones on. */
  pick: { id: string; label: string; stage: string; on: boolean }[] | null;
  /** Nothing left to show after Change. */
  emptyAfterChange: boolean;
  /** A quiet line when the section has nothing to say ("No deal is waiting on a broker."). */
  quiet: string | null;
};

export const TOP_N = 3;

/** Furthest stage first, then the newest activity. */
export function byProgress(a: ReportDeal, b: ReportDeal): number {
  if (a.position !== b.position) return b.position - a.position;
  return a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0;
}

/** The Top 3: the picked ones (in the default order) when Change was used, otherwise the 3 furthest along. */
export function pickTop(deals: readonly ReportDeal[], picked?: readonly string[] | null, n = TOP_N): ReportDeal[] {
  const sorted = [...deals].sort(byProgress);
  if (picked && picked.length) {
    const chosen = sorted.filter((d) => picked.includes(d.id));
    if (chosen.length) return chosen.slice(0, n);
  }
  return sorted.slice(0, n);
}

/** Active: the deals worked on in the period that are not in the top 3 (nothing repeats), newest activity first. */
export function activeNotInTop(deals: readonly ReportDeal[], top: readonly ReportDeal[]): ReportDeal[] {
  const ids = new Set(top.map((d) => d.id));
  return deals.filter((d) => !ids.has(d.id) && d.activity.length).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
}

/** "Rachel Kim emailed: CIM received; moved to Broker call": a deal's activity on one line (up to three things). */
export function activityLine(d: ReportDeal): string {
  const parts = d.activity.slice(-3);
  const t = parts.join("; ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const dealBlock = (d: ReportDeal): Block => ({
  title: d.name,
  items: [
    { id: `${d.id}:stage`, line: { label: "Stage", text: d.stage } },
    { id: `${d.id}:status`, line: { label: "Status", text: d.status } },
    { id: `${d.id}:next`, line: { label: "Next step", text: d.next ?? "None set yet" } },
  ],
});

const TARGET_GROUPS: { key: ReportTarget["group"]; title: string; tone?: Block["tone"] }[] = [
  { key: "missed", title: "Missed", tone: "red" },
  { key: "now", title: "Under way" },
  { key: "met", title: "Met", tone: "green" },
];

const STILL_TO_GIVE = "(still to give)";

function targetSub(t: { commitment: boolean; asks: boolean; reason: string | null }): Line[] {
  if (!t.commitment) return [];
  if (!t.asks) return [{ text: "Commitment" }];
  const r = String(t.reason ?? "").trim();
  return [r ? { text: `Commitment. Reason: ${r}` } : { text: "Commitment. Reason: ", todo: STILL_TO_GIVE }];
}

const titles = (d: ReportData): Record<SectionKey, string> => ({
  today: "Today",
  targets: "Targets",
  top: "Top 3 deals",
  active: d.period === "today" ? "Active today" : "Active this week",
  waiting: "Waiting on brokers",
  jobs: "Job search",
  week: d.week?.label ?? "The week",
  tomorrow: d.tomorrow.label,
});

/** The plain text of a line, as Edit shows it. */
export function lineText(l: Line): string {
  return `${l.lead ? `${l.lead}: ` : ""}${l.label ? `${l.label}: ` : ""}${l.text}${l.todo ?? ""}`;
}

/** The plain text of blocks: the parent line, "  - child", "    - sub-line". */
export function blocksText(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.title) out.push(b.title);
    for (const it of b.items) {
      out.push(`${b.title ? "  " : ""}- ${lineText(it.line)}`);
      for (const s of it.sub ?? []) out.push(`${b.title ? "    " : "  "}- ${lineText(s)}`);
    }
  }
  return out.join("\n");
}

export function tilesText(tiles: readonly ReportTile[]): string {
  return tiles.map((t) => `${t.label}: ${t.value}${t.small ? ` ${t.small}` : ""}${t.note ? ` (${t.note})` : ""}`).join("\n");
}

/** Whether the partner gets a section as a standing choice. "moved" (before the push B edits) reads as Active. */
export function standingHas(sections: readonly string[] | null | undefined, key: SectionKey): boolean {
  if (!sections) return true;
  if (sections.includes(key)) return true;
  return key === "active" && sections.includes("moved");
}

/**
 * Every section of one partner's copy, in order, with today's choices applied. Sections with nothing to say are
 * left out (Top 3 with no open deal, Active with nothing worked on, Job search with no opportunity, The week on a
 * weekday); Waiting on brokers stays with a quiet line. Tomorrow has Edit only (no Change).
 */
export function buildSections(d: ReportData): BuiltSection[] {
  const c = d.choices ?? {};
  const hid = (k: SectionKey) => new Set(c.hidden?.[k] ?? []);
  const T = titles(d);
  const out: BuiltSection[] = [];
  const push = (s: Omit<BuiltSection, "included" | "standing" | "edited" | "title"> & { title?: string }) => {
    const standing = standingHas(d.sections, s.key);
    const inc = c.include?.[s.key];
    const edited = typeof c.edits?.[s.key] === "string" && c.edits[s.key]!.trim() ? c.edits[s.key]! : null;
    out.push({ ...s, title: s.title ?? T[s.key], standing, included: inc === undefined ? standing : inc, edited });
  };

  // Today: the tiles; Change ticks which tiles show.
  {
    const h = hid("today");
    const tiles = d.today.filter((t) => !h.has(t.label));
    push({ key: "today", kind: "tiles", tiles, blocks: [], line: null, text: tilesText(tiles), choices: d.today.map((t) => ({ id: t.label, label: t.label, on: !h.has(t.label) })), pick: null, emptyAfterChange: !tiles.length && d.today.length > 0, quiet: null });
  }

  // Targets: Missed, Under way, Met, then Owed from the skipped day; each target a child with its short sub-lines.
  {
    const h = hid("targets");
    const all: { id: string; label: string }[] = [];
    const blocks: Block[] = [];
    for (const g of TARGET_GROUPS) {
      const list = d.targets.filter((t) => t.group === g.key);
      for (const t of list) all.push({ id: t.id, label: `${g.title}: ${t.text.split(":")[0]}` });
      const shown = list.filter((t) => !h.has(t.id));
      if (shown.length) blocks.push({ title: g.title, tone: g.tone, items: shown.map((t) => ({ id: t.id, line: { text: t.text }, sub: targetSub(t) })) });
    }
    if (d.owed && d.owed.items.length) {
      const title = `Owed from ${d.owed.dayWord}`;
      for (const o of d.owed.items) all.push({ id: `owed:${o.id}`, label: `${title}: ${o.text.split(":")[0]}` });
      const shown = d.owed.items.filter((o) => !h.has(`owed:${o.id}`));
      if (shown.length) blocks.push({ title, tone: "red", items: shown.map((o) => ({ id: `owed:${o.id}`, line: { text: o.text }, sub: targetSub({ commitment: true, asks: true, reason: o.reason }) })) });
    }
    push({ key: "targets", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: all.map((x) => ({ ...x, on: !h.has(x.id) })), pick: null, emptyAfterChange: !blocks.length && all.length > 0, quiet: all.length ? null : "No targets yet." });
  }

  // Top 3 deals: Change swaps which 3. Active: worked on in the period, not in the top 3.
  const top = pickTop(d.deals, c.top);
  if (d.deals.length) {
    const blocks = top.map(dealBlock);
    const ids = new Set(top.map((x) => x.id));
    push({ key: "top", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: null, pick: [...d.deals].sort(byProgress).map((x) => ({ id: x.id, label: x.name, stage: x.stage, on: ids.has(x.id) })), emptyAfterChange: false, quiet: null });
  }
  const active = activeNotInTop(d.deals, top);
  if (active.length) {
    const h = hid("active");
    const shown = active.filter((x) => !h.has(x.id));
    const blocks: Block[] = shown.length ? [{ title: `Worked on ${d.period}, not in the top 3`, items: shown.map((x) => ({ id: x.id, line: { lead: x.name, text: activityLine(x) } })) }] : [];
    push({ key: "active", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: active.map((x) => ({ id: x.id, label: x.name, on: !h.has(x.id) })), pick: null, emptyAfterChange: !shown.length, quiet: null });
  }

  // Waiting on brokers over the threshold.
  {
    const h = hid("waiting");
    const shown = d.waits.filter((w) => !h.has(w.id));
    const red = shown.some((w) => w.days >= d.threshold * 2);
    const blocks: Block[] = shown.length ? [{ title: `Waiting on brokers over ${d.threshold} days`, tone: red ? "red" : "amber", items: shown.map((w) => ({ id: w.id, line: { lead: w.name, text: `${w.days} days${w.who ? `, ${w.who}` : ""}` } })) }] : [];
    push({ key: "waiting", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: d.waits.length ? d.waits.map((w) => ({ id: w.id, label: w.name, on: !h.has(w.id) })) : null, pick: null, emptyAfterChange: !shown.length && d.waits.length > 0, quiet: d.waits.length ? null : `No deal has been waiting on a broker over ${d.threshold} days.` });
  }

  // Job search: the top 3 opportunities the same way, then the others worked on in the period.
  if (d.jobs.length) {
    const h = hid("jobs");
    const jt = pickTop(d.jobs);
    const ja = activeNotInTop(d.jobs, jt);
    const tShown = jt.filter((x) => !h.has(x.id));
    const aShown = ja.filter((x) => !h.has(x.id));
    const blocks: Block[] = [];
    if (tShown.length) blocks.push({ title: `Top ${tShown.length} ${tShown.length === 1 ? "opportunity" : "opportunities"}`, items: [] }, ...tShown.map(dealBlock));
    if (aShown.length) blocks.push({ title: d.period === "today" ? "Active today" : "Active this week", items: aShown.map((x) => ({ id: x.id, line: { lead: x.name, text: activityLine(x) } })) });
    push({ key: "jobs", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: [...jt, ...ja].map((x) => ({ id: x.id, label: x.name, on: !h.has(x.id) })), pick: null, emptyAfterChange: !blocks.length, quiet: null });
  }

  // The week (Fridays): the tiles; Change ticks which show.
  if (d.week) {
    const h = hid("week");
    const tiles = d.week.tiles.filter((t) => !h.has(t.label));
    push({ key: "week", kind: "tiles", tiles, blocks: [], line: null, text: tilesText(tiles), choices: d.week.tiles.map((t) => ({ id: t.label, label: t.label, on: !h.has(t.label) })), pick: null, emptyAfterChange: !tiles.length, quiet: null });
  }

  // Tomorrow (or Monday): the line; Edit only.
  push({ key: "tomorrow", kind: "line", tiles: [], blocks: [], line: d.tomorrow.text, text: d.tomorrow.text ?? "", choices: null, pick: null, emptyAfterChange: false, quiet: d.tomorrow.text ? null : "(no line yet)" });
  return out;
}

/** The sections that go in the email (included today). */
export function sentSections(d: ReportData): BuiltSection[] {
  return buildSections(d).filter((s) => s.included);
}

/** "Today, Targets, Top 3 deals, ...": what a copy includes (the compact card on End of day). */
export function includesLine(d: ReportData): string {
  return sentSections(d)
    .map((s) => (s.key === "week" ? "The week" : s.title))
    .join(", ");
}

/**
 * An edited section's text as lines with their depth: "- " starts a bullet; two more spaces of indent, one level
 * deeper. A line without "- " is a parent line (bold when bullets follow it) or a plain paragraph.
 */
export function parseEdited(text: string): { depth: number; bullet: boolean; text: string }[] {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const t = l.trim();
      const bullet = /^[-*\u2022]\s+/.test(t);
      return { indent: l.match(/^\s*/)?.[0].length ?? 0, bullet, text: bullet ? t.replace(/^[-*\u2022]\s+/, "") : t };
    });
  // The depth of a bullet is the rank of its indent among the bullets' indents: the least indented are level 1.
  const levels = [...new Set(lines.filter((l) => l.bullet).map((l) => l.indent))].sort((a, b) => a - b);
  return lines.map((l) => ({ depth: l.bullet ? Math.min(3, levels.indexOf(l.indent) + 1) : 0, bullet: l.bullet, text: l.text }));
}

/** Today's choices cleaned for saving: known section keys, short text, ids as given. */
export function cleanChoices(v: unknown): ReportChoices {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const isKey = (k: string): k is SectionKey => (SECTION_ORDER as string[]).includes(k);
  const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
  const include: ReportChoices["include"] = {};
  for (const [k, val] of Object.entries(obj(o.include))) if (isKey(k) && typeof val === "boolean") include[k] = val;
  const hidden: ReportChoices["hidden"] = {};
  for (const [k, val] of Object.entries(obj(o.hidden))) if (isKey(k) && Array.isArray(val)) hidden[k] = [...new Set(val.map(String).filter((x) => x.length <= 200))].slice(0, 100);
  const edits: ReportChoices["edits"] = {};
  for (const [k, val] of Object.entries(obj(o.edits))) if (isKey(k) && typeof val === "string" && val.trim()) edits[k] = val.replace(/\r\n/g, "\n").slice(0, 6000);
  const top = Array.isArray(o.top) ? [...new Set(o.top.map(String))].slice(0, TOP_N) : null;
  const out: ReportChoices = {};
  if (Object.keys(include).length) out.include = include;
  if (Object.keys(hidden).length) out.hidden = hidden;
  if (Object.keys(edits).length) out.edits = edits;
  if (top && top.length) out.top = top;
  return out;
}

/** Whether a copy has any choice made today (the "Edited" mark). */
export function hasChoices(c: ReportChoices | null | undefined): boolean {
  return !!c && (!!c.top?.length || Object.keys(c.include ?? {}).length > 0 || Object.keys(c.hidden ?? {}).length > 0 || Object.keys(c.edits ?? {}).length > 0);
}

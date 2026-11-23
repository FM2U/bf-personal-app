/**
 * The End of day report's sections (Push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/report-sections.test.ts. One builder makes every section from the day's data, a partner's
 * standing sections, and today's choices for that partner (include, Change, Edit); the email
 * (src/lib/accountability/report-email.ts) and the report window on End of day both draw from it, so the sent email
 * is exactly what the window shows.
 *
 * Sections, in order: Today (tiles), Targets, Top 3 deals, Active today (Friday: Active this week), Waiting on
 * brokers, Job search, The week (Fridays, tiles), Weekly review (Fridays, push D: the three answers), Tomorrow (or
 * Monday). A list section is parent lines with child
 * lines under them ("Waiting on brokers 5+ days" over "Summit Logistics Group: 11 days, Mark Reed").
 */
import type { ReportTile } from "@/lib/accountability/targets";
import type { PipelineCol, ReportPick, ReportTracks } from "@/lib/accountability/report-v8";
import type { TodayCount, WorkedRecord, WorkedTracks } from "@/lib/accountability/report-worked";
import { stalledAt } from "@/lib/work/stages";
import type { TileStatus } from "@/lib/calc/partner-report";

export type SectionKey = "today" | "targets" | "top" | "active" | "waiting" | "jobs" | "week" | "review" | "tomorrow" | "opening" | "acquisition" | "consulting" | "startup";
/** The sections before the redesign (reports built before 2026-11-15 still show this way). */
export const SECTION_ORDER_OLD: SectionKey[] = ["today", "targets", "top", "active", "waiting", "jobs", "week", "review", "tomorrow"];
/** The report's sections since the redesign (v8, 2026-11-15): the opening, the four tracks, the week (Fridays), tomorrow. */
export const SECTION_ORDER: SectionKey[] = ["opening", "acquisition", "jobs", "consulting", "startup", "review", "tomorrow"];
/** Every key a saved note, choice, or partner setting can hold. */
const ALL_KEYS: SectionKey[] = [...new Set([...SECTION_ORDER_OLD, ...SECTION_ORDER])];
/** Keys only the new layout has, and keys only the old one had: a list tells which layout it was saved for. */
const V8_ONLY: SectionKey[] = ["opening", "acquisition", "consulting", "startup"];
const OLD_ONLY: string[] = ["today", "targets", "top", "active", "waiting", "week", "moved"];

/** The Weekly review answers (push D): typed on Friday's End of day; empty strings while not written. */
export type WeeklyReview = { well: string; slipped: string; focus: string };

/** The three questions, in order, with the short lead each answer has in the report. */
export const REVIEW_QUESTIONS: readonly { key: keyof WeeklyReview; question: string; lead: string }[] = [
  { key: "well", question: "What went well this week", lead: "Went well" },
  { key: "slipped", question: "What slipped", lead: "Slipped" },
  { key: "focus", question: "Next week's focus", lead: "Next week" },
];

/** The answers as saved (unknown keys out, text trimmed and cut at 600 characters). */
export function cleanReview(v: unknown): WeeklyReview {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const t = (x: unknown) => String(x ?? "").replace(/\r\n/g, "\n").trim().slice(0, 600);
  return { well: t(o.well), slipped: t(o.slipped), focus: t(o.focus) };
}

/** How many of the three are written: "2 of 3". */
export function reviewAnswered(r: WeeklyReview | null | undefined): number {
  return r ? REVIEW_QUESTIONS.filter((q) => r[q.key].trim()).length : 0;
}

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
  /** "v8": the layout since 2026-11-15 (opening, top priorities, pipeline); missing on reports built before it. */
  layout?: "v8";
  /** v8: the opening paragraph typed on End of day (a few lines on the day), or null. */
  opening?: string | null;
  /** v8: the four tracks (top priorities, decided this week, pipeline). */
  tracks?: ReportTracks | null;
  /**
   * Release 4 (2026-11-16): each track's records worked on today (from Today's activity, kept rows only). With it the
   * tracks read "<Track> · worked on today"; reports built before it keep the top priorities.
   */
  worked?: WorkedTracks | null;
  /** Release 4: the gray Today box under the opening (Listings reviewed · Deals added · Deals moved · Brokers contacted · Calls and meetings · Network outreach; six since push J). */
  box?: TodayCount[] | null;
  /** Send a report (Bram, 2026-11-07): a short note of your own under the greeting, for that send only. */
  intro?: string | null;
  /** Fix list item 10 (2026-11-06): the name under "Thank you," (the first word of the Name in Settings); none when not set. */
  signName?: string | null;
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
  /** Open waits on brokers at or past the threshold, longest first. */
  waits: { id: string; name: string; days: number; who: string | null }[];
  threshold: number;
  /** The day count at which a wait turns red (Stalled after, 2026-11-08); missing on older reports: double the threshold. */
  stalledAt?: number;
  /** Open acquisition deals (the Top 3 candidates), furthest along first. */
  deals: ReportDeal[];
  /** Open job opportunities, furthest along first. */
  jobs: ReportDeal[];
  /** "today" on a daily report, "this week" on Friday's. */
  period: "today" | "this week";
  week: { label: string; tiles: ReportTile[] } | null;
  /** Fridays (push D): the Weekly review answers; null on other days. */
  review?: WeeklyReview | null;
  tomorrow: { label: string; text: string | null };
  /** The sections this partner gets as a standing choice (their page). Null or missing: every section. */
  sections?: readonly string[] | null;
  /** Today's choices for this partner (the review window). */
  choices?: ReportChoices | null;
  /**
   * Today's notes ("+ Note", 2026-11-05): a few lines Bram adds under a section, by section key. One set for the day,
   * shared by every partner's copy that includes the section; a note on a left-out section is kept but not sent.
   */
  notes?: ReportNotes | null;
};

/** Today's notes by section key (the "+ Note" box on each section of the report window). */
export type ReportNotes = Partial<Record<SectionKey, string>>;

/** The longest note kept (characters). */
export const NOTE_MAX = 1000;

/**
 * Where today's notes are kept: the End of day row's report_edits holds each partner's choices by contact id (a
 * UUID), and the notes under this one extra key, once for the day (no database change).
 */
export const NOTES_KEY = "_notes";

/** Today's notes cleaned for saving and reading: known section keys, line breaks kept, end spaces trimmed, cut at NOTE_MAX. */
export function cleanNotes(v: unknown): ReportNotes {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const out: ReportNotes = {};
  for (const [k, val] of Object.entries(o)) {
    if (!(ALL_KEYS as string[]).includes(k) || typeof val !== "string") continue;
    const t = val
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, NOTE_MAX);
    if (t) out[k as SectionKey] = t;
  }
  return out;
}

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
  kind: "tiles" | "list" | "line" | "priorities" | "worked";
  /** v8 "priorities": the picks shown (after Change), the decided line, and the Pipeline table. */
  picks?: ReportPick[];
  /** Release 4 "worked": the records worked on today shown (after Change), and the Pipeline table. */
  worked?: WorkedRecord[];
  /** Release 4: the gray Today box, on the opening. */
  box?: TodayCount[] | null;
  decided?: string | null;
  pipeline?: PipelineCol[] | null;
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
  /** Today's note under the section (Bram's own words), or null. Sent only while the section is included. */
  note: string | null;
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
const STILL_TO_WRITE = "(still to write)";

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
  review: "Weekly review",
  tomorrow: d.tomorrow.label,
  opening: "Opening",
  acquisition: "Acquisition · top priorities",
  consulting: "Consulting · top priorities",
  startup: "Startup · initiatives",
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
  return tiles.map((t) => `${t.label}: ${t.value}${t.small ? ` ${t.small}` : ""}${t.note ? ` (${t.note})` : ""}${t.weekend !== undefined ? ` · Weekend ${t.weekend}` : ""}`).join("\n");
}

/** Whether the partner gets a section as a standing choice. "moved" (before the push B edits) reads as Active. */
export function standingHas(sections: readonly string[] | null | undefined, key: SectionKey, v8 = false): boolean {
  if (!sections) return true;
  // A list saved for the other layout (2026-11-15): every section of this layout goes (the review unless unticked).
  const oldList = sections.some((k) => OLD_ONLY.includes(k)) && !sections.some((k) => (V8_ONLY as string[]).includes(k));
  const newList = !sections.some((k) => OLD_ONLY.includes(k));
  if ((v8 && oldList) || (!v8 && newList)) return key !== "review" || !sections.includes("review_off");
  if (sections.includes(key)) return true;
  return key === "active" && sections.includes("moved");
}

/**
 * Every section of one partner's copy, in order, with today's choices applied. Sections with nothing to say are
 * left out (Top 3 with no open deal, Active with nothing worked on, Job search with no opportunity, The week on a
 * weekday); Waiting on brokers stays with a quiet line. Tomorrow has Edit only (no Change).
 */
export function buildSections(d: ReportData): BuiltSection[] {
  if (d.layout === "v8") return buildV8Sections(d);
  const c = d.choices ?? {};
  const hid = (k: SectionKey) => new Set(c.hidden?.[k] ?? []);
  const T = titles(d);
  const out: BuiltSection[] = [];
  const notes = cleanNotes(d.notes);
  const push = (s: Omit<BuiltSection, "included" | "standing" | "edited" | "title" | "note"> & { title?: string }) => {
    const standing = standingHas(d.sections, s.key);
    const inc = c.include?.[s.key];
    const edited = typeof c.edits?.[s.key] === "string" && c.edits[s.key]!.trim() ? c.edits[s.key]! : null;
    out.push({ ...s, title: s.title ?? T[s.key], standing, included: inc === undefined ? standing : inc, edited, note: notes[s.key] ?? null });
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

  // Waiting on brokers at or past the threshold.
  {
    const h = hid("waiting");
    const shown = d.waits.filter((w) => !h.has(w.id));
    const red = shown.some((w) => w.days >= (d.stalledAt ?? stalledAt(d.threshold)));
    const blocks: Block[] = shown.length ? [{ title: `Waiting on brokers ${d.threshold}+ days`, tone: red ? "red" : "amber", items: shown.map((w) => ({ id: w.id, line: { lead: w.name, text: `${w.days} days${w.who ? `, ${w.who}` : ""}` } })) }] : [];
    push({ key: "waiting", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: d.waits.length ? d.waits.map((w) => ({ id: w.id, label: w.name, on: !h.has(w.id) })) : null, pick: null, emptyAfterChange: !shown.length && d.waits.length > 0, quiet: d.waits.length ? null : `No deal has been waiting on a broker ${d.threshold}+ days.` });
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

  // Weekly review (Fridays, push D): the three answers, one line each; Change hides one, Edit rewrites them.
  if (d.review) {
    const h = hid("review");
    const r = d.review;
    const lines = REVIEW_QUESTIONS.map((q) => ({ id: q.key, line: r[q.key].trim() ? { lead: q.lead, text: r[q.key].trim() } : { lead: q.lead, text: "", todo: STILL_TO_WRITE } }));
    const shown = lines.filter((x) => !h.has(x.id));
    const blocks: Block[] = shown.length ? [{ items: shown }] : [];
    push({ key: "review", kind: "list", tiles: [], blocks, line: null, text: blocksText(blocks), choices: REVIEW_QUESTIONS.map((q) => ({ id: q.key, label: q.question, on: !h.has(q.key) })), pick: null, emptyAfterChange: !shown.length, quiet: null });
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
  const isKey = (k: string): k is SectionKey => (ALL_KEYS as string[]).includes(k);
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

/** Whether a copy sends any of today's notes (a note on a section it includes). */
export function sendsNotes(d: ReportData): boolean {
  return sentSections(d).some((s) => !!s.note);
}

/** Whether a copy has any choice made today (the "Edited" mark). */
export function hasChoices(c: ReportChoices | null | undefined): boolean {
  return !!c && (!!c.top?.length || Object.keys(c.include ?? {}).length > 0 || Object.keys(c.hidden ?? {}).length > 0 || Object.keys(c.edits ?? {}).length > 0);
}

// ---------- The new layout (v8, approved 2026-11-15) ----------

const TRACK_OF: Record<"acquisition" | "jobs" | "consulting" | "startup", keyof Omit<ReportTracks, "startupActive">> = { acquisition: "acquisition", jobs: "job", consulting: "consulting", startup: "startup" };

/** A pick as plain text (Edit starts from it): the name line, the facts line, then Why, Now, Next. */
export function pickText(p: ReportPick): string {
  const facts = [p.stage, p.strength ? p.strength[0].toUpperCase() + p.strength.slice(1) : null, p.since, p.moved].filter(Boolean).join(" · ");
  return [
    `${p.number}. ${p.name}${p.meta ? ` · ${p.meta}` : ""}`,
    facts ? `  ${facts}` : "",
    p.why ? `  Why: ${p.why}` : "",
    p.now ? `  Now: ${p.now}` : "",
    p.next ? `  Next: ${p.next.words}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A record worked on today as plain text (Edit starts from it): the name line, Upside, the facts line, Today, Next. */
export function workedText(w: WorkedRecord): string {
  const facts = [w.stage, w.strength ? w.strength[0].toUpperCase() + w.strength.slice(1) : null, w.since, w.moved ? `▲ ${w.moved}` : null].filter(Boolean).join(" · ");
  const mark = typeof w.mark === "number" ? `${w.mark}.` : w.mark === "+" ? "+" : "-";
  return [`${mark} ${w.name}${w.meta ? ` · ${w.meta}` : ""}`, w.upside ? `  Upside: ${w.upside}` : "", facts ? `  ${facts}` : "", w.today ? `  Today: ${w.today}` : "", w.next ? `  Next: ${w.next}` : ""].filter(Boolean).join("\n");
}

/** The gray Today box as plain text: "Today: Listings added 2 · Deals moved 3 · ...". */
export function boxText(box: readonly TodayCount[]): string {
  return `Today: ${box.map((c) => `${c.label} ${c.value}`).join(" · ")}`;
}

/** The Pipeline table as plain text: "Pipeline: Screened +14 · CIM review +2, 4 in stage · ...". */
export function pipelineText(cols: readonly PipelineCol[]): string {
  return `Pipeline: ${cols.map((c) => `${c.label} ${c.added ? `+${c.added}` : "–"}${c.inStage === null ? "" : `, ${c.inStage} in stage`}`).join(" · ")}`;
}

function buildV8Sections(d: ReportData): BuiltSection[] {
  const c = d.choices ?? {};
  const T = titles(d);
  const notes = cleanNotes(d.notes);
  const out: BuiltSection[] = [];
  const push = (s: Omit<BuiltSection, "included" | "standing" | "edited" | "title" | "note"> & { title?: string }) => {
    const standing = standingHas(d.sections, s.key, true);
    const inc = c.include?.[s.key];
    const edited = typeof c.edits?.[s.key] === "string" && c.edits[s.key]!.trim() ? c.edits[s.key]! : null;
    out.push({ ...s, title: s.title ?? T[s.key], standing, included: inc === undefined ? standing : inc, edited, note: notes[s.key] ?? null });
  };
  const base: Pick<BuiltSection, "tiles" | "blocks" | "pick"> = { tiles: [], blocks: [], pick: null };

  // The opening: the few lines typed on End of day (no heading in the email); release 4: the gray Today box under it.
  const opening = String(d.opening ?? "").trim() || null;
  push({ ...base, key: "opening", kind: "line", line: opening, text: opening ?? "", choices: null, emptyAfterChange: false, quiet: opening ? null : "(no opening yet)", box: d.worked && d.box ? d.box : null });

  // Release 4 (2026-11-16): "<Track> · worked on today", the records with kept activity today; a track with no work is left out.
  if (d.worked) {
    // Layout H (Bram, 2026-11-23): "Acquisition · 4 deals worked on today", the count of records shown.
    const titleOf = (key: "acquisition" | "jobs" | "consulting" | "startup", n: number) => {
      const [track, one, many] = { acquisition: ["Acquisition", "deal", "deals"], jobs: ["Job search", "job", "jobs"], consulting: ["Consulting", "lead", "leads"], startup: ["Startup", "project", "projects"] }[key];
      return `${track} · ${n} ${n === 1 ? one : many} worked on today`;
    };
    for (const key of ["acquisition", "jobs", "consulting", "startup"] as const) {
      const all = d.worked[TRACK_OF[key]] ?? [];
      if (!all.length) continue;
      const h = new Set(c.hidden?.[key] ?? []);
      const shown = all.filter((w) => !h.has(w.id));
      // Layout H (2026-11-23): the Job search section has its pipeline card too.
      const pipeline = key === "acquisition" ? (d.tracks?.acquisition.pipeline ?? null) : key === "jobs" ? (d.tracks?.job.pipeline ?? null) : null;
      push({
        ...base,
        key,
        title: titleOf(key, shown.length),
        kind: "worked",
        line: null,
        worked: shown,
        pipeline,
        text: [...shown.map(workedText), pipeline ? pipelineText(pipeline) : ""].filter(Boolean).join("\n"),
        choices: all.map((w) => ({ id: w.id, label: w.name, on: !h.has(w.id) })),
        emptyAfterChange: !shown.length,
        quiet: null,
      });
    }
  }

  // The tracks: the picks (Change hides one), Decided this week, the Pipeline table (reports built before release 4).
  for (const key of d.worked ? [] : (["acquisition", "jobs", "consulting", "startup"] as const)) {
    const t = d.tracks?.[TRACK_OF[key]];
    if (!t) continue;
    if (key === "startup" && (!t.picks.length || !d.tracks?.startupActive)) continue;
    if (key !== "startup" && !t.picks.length && !t.decided && !(t.pipeline ?? []).some((x) => x.added || x.inStage)) continue;
    const h = new Set(c.hidden?.[key] ?? []);
    // Numbered again after Change, so the email reads 1, 2, 3.
    const picks = t.picks.filter((p) => !h.has(p.id)).map((p, n) => ({ ...p, number: n + 1 }));
    const text = [...picks.map(pickText), t.decided ? `Decided this week: ${t.decided}` : "", t.pipeline ? pipelineText(t.pipeline) : ""].filter(Boolean).join("\n");
    push({
      ...base,
      key,
      title: key === "jobs" ? "Job search · top priorities" : undefined,
      kind: "priorities",
      line: null,
      picks,
      decided: t.decided,
      pipeline: t.pipeline,
      text,
      choices: t.picks.length ? t.picks.map((p) => ({ id: p.id, label: p.name, on: !h.has(p.id) })) : null,
      emptyAfterChange: !picks.length && t.picks.length > 0 && !t.decided && !t.pipeline,
      quiet: t.picks.length ? null : "No top priorities chosen.",
    });
  }

  // Fridays: "The week", the Weekly review's three answers.
  if (d.review) {
    const h = new Set(c.hidden?.review ?? []);
    const r = d.review;
    const lines = REVIEW_QUESTIONS.map((q) => ({ id: q.key, line: r[q.key].trim() ? { lead: q.lead, text: r[q.key].trim() } : { lead: q.lead, text: "", todo: STILL_TO_WRITE } }));
    const shown = lines.filter((x) => !h.has(x.id));
    const blocks: Block[] = shown.length ? [{ items: shown }] : [];
    push({ ...base, key: "review", title: "The week", kind: "list", blocks, line: null, text: blocksText(blocks), choices: REVIEW_QUESTIONS.map((q) => ({ id: q.key, label: q.question, on: !h.has(q.key) })), emptyAfterChange: !shown.length, quiet: null });
  }

  push({ ...base, key: "tomorrow", kind: "line", line: d.tomorrow.text, text: d.tomorrow.text ?? "", choices: null, emptyAfterChange: false, quiet: d.tomorrow.text ? null : "(no line yet)" });
  return out;
}

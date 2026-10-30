import { format, parseISO } from "date-fns";
import { initiativeLine, OUTCOME_STATUS_LABEL, type DayDetail, type DayInitiative, type DayOutcome } from "@/lib/calc/today";

/**
 * Partner report templates: which measures a report shows, the period, and an optional note. The numbers are saved in
 * the report (snapshot.measures) when the draft is made, for a week, two weeks, and a month ending on the report date,
 * so any template (or two together) can be chosen at send time and a finalized report never changes.
 * Pure: used by the report page, the "Send this email?" preview (browser), the email sent, the PDF, and the public page.
 */

// ---------- Measures and templates ----------

export type MeasureKey =
  | "commitments_met"
  | "commitments_missed"
  | "completion_pct"
  | "tasks_done"
  | "tasks_overdue"
  | "deals_sourced"
  | "outreach_done"
  | "targets_met_pct"
  | "listings_screened"
  | "cims_reviewed"
  | "deal_calls"
  | "network_outreach"
  | "reply_rate"
  | "meetings_booked"
  | "pipeline_moves"
  | "runway_months"
  | "milestones_due";

export type MeasureDef = { key: MeasureKey; label: string; level: "high" | "detailed"; help: string };

/** Every measure a template can include, high-level first, in the order tiles are shown. */
export const MEASURES: MeasureDef[] = [
  { key: "completion_pct", label: "Commitments completed (%)", level: "high", help: "Commitments met out of those due in the period." },
  { key: "commitments_met", label: "Commitments met", level: "high", help: "Count of commitments met in the period." },
  { key: "commitments_missed", label: "Commitments missed", level: "high", help: "Count of commitments missed in the period." },
  { key: "tasks_done", label: "Tasks done", level: "high", help: "Tasks marked done in the period." },
  { key: "tasks_overdue", label: "Tasks overdue", level: "high", help: "Open tasks past their due date on the report date." },
  { key: "deals_sourced", label: "Deals sourced", level: "high", help: "New Acquisitions items, against the Deals sourced target." },
  { key: "outreach_done", label: "Outreach done", level: "high", help: "Messages logged as outreach in the period." },
  { key: "targets_met_pct", label: "Daily targets met (%)", level: "high", help: "Target days and weeks met out of those decided, across every target." },
  { key: "listings_screened", label: "Listings screened", level: "detailed", help: "Count against the Listings screened target." },
  { key: "cims_reviewed", label: "CIMs reviewed", level: "detailed", help: "Count against the CIMs reviewed target." },
  { key: "deal_calls", label: "Broker or owner calls", level: "detailed", help: "Count against the Broker or owner calls target." },
  { key: "network_outreach", label: "Network outreach", level: "detailed", help: "Count against the Network outreach target." },
  { key: "reply_rate", label: "Reply rate", level: "detailed", help: "Outreach that got a reply, meeting, or referral." },
  { key: "meetings_booked", label: "Meetings booked", level: "detailed", help: "Outreach with the outcome Meeting booked." },
  { key: "pipeline_moves", label: "Pipeline moves (per pipeline)", level: "detailed", help: "Stage moves in each pipeline (one tile per pipeline)." },
  { key: "runway_months", label: "Runway (months)", level: "detailed", help: "Months of runway against the runway target." },
  { key: "milestones_due", label: "Milestones due", level: "detailed", help: "Milestones due in the period, met and missed." },
];

export const MEASURE_KEYS = MEASURES.map((m) => m.key);
export const isMeasureKey = (k: string): k is MeasureKey => (MEASURE_KEYS as string[]).includes(k);

export type TemplatePeriod = "day" | "week" | "two_weeks" | "month";
/** Every period a report saves numbers for. "day" (today's numbers) needs database update 0018 to be saved on a template. */
export const TEMPLATE_PERIODS: TemplatePeriod[] = ["day", "week", "two_weeks", "month"];
export const PERIOD_DAYS: Record<TemplatePeriod, number> = { day: 1, week: 7, two_weeks: 14, month: 30 };
export const PERIOD_LABEL: Record<TemplatePeriod, string> = { day: "Day (today)", week: "Week (7 days)", two_weeks: "Two weeks (14 days)", month: "Month (30 days)" };

/** Report frequency per accountability partner (database update 0018). Weekly before it. */
export type ReportFrequency = "daily" | "weekly" | "both";
export const REPORT_FREQUENCIES: { value: ReportFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "both", label: "Both" },
];
export const sendsDaily = (f: string | null | undefined) => f === "daily" || f === "both";
export const sendsScheduled = (f: string | null | undefined) => f !== "daily";

/** A daily report (drafted after the daily close): every template shows today's numbers. */
export function isDailyReport(report: { snapshot?: Record<string, unknown> | null; report_kind?: string | null } | null | undefined): boolean {
  return report?.report_kind === "daily" || report?.snapshot?.report_kind === "daily";
}
export const NOTE_MAX = 300;

export type ReportTemplate = { id: string; name: string; measures: MeasureKey[]; period: TemplatePeriod; note: string | null; starter_key: string | null };

/** The three starter templates (the same as database update 0017 creates). Used before the update is applied. */
export const STARTER_TEMPLATES: ReportTemplate[] = [
  { id: "starter:summary", name: "Summary", starter_key: "summary", period: "week", note: null, measures: ["completion_pct", "commitments_met", "commitments_missed", "targets_met_pct"] },
  {
    id: "starter:standard",
    name: "Standard",
    starter_key: "standard",
    period: "week",
    note: null,
    measures: ["completion_pct", "commitments_met", "commitments_missed", "tasks_done", "tasks_overdue", "deals_sourced", "outreach_done", "targets_met_pct"],
  },
  { id: "starter:detailed", name: "Detailed", starter_key: "detailed", period: "week", note: null, measures: [...MEASURE_KEYS] },
];

/** A template row from the database, cleaned: unknown measures are dropped, measures kept in the catalog order. */
export function toTemplate(row: { id: string; name: string; measures?: string[] | null; period?: string | null; note?: string | null; starter_key?: string | null }): ReportTemplate {
  const wanted = new Set((row.measures ?? []).filter(isMeasureKey));
  return {
    id: String(row.id),
    name: String(row.name ?? "Template"),
    measures: MEASURE_KEYS.filter((k) => wanted.has(k)),
    period: TEMPLATE_PERIODS.includes(row.period as TemplatePeriod) ? (row.period as TemplatePeriod) : "week",
    note: row.note ? String(row.note).slice(0, NOTE_MAX) : null,
    starter_key: row.starter_key ?? null,
  };
}

/** Checks a template typed in the editor. Returns the problems in plain words (empty when it can be saved). */
export function templateProblems(t: { name: string; measures: string[]; period: string; note?: string | null }): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push("Give the template a name.");
  if (t.name.trim().length > 60) out.push("Keep the name to 60 characters or fewer.");
  if (!t.measures.filter(isMeasureKey).length) out.push("Choose at least one measure.");
  if (!TEMPLATE_PERIODS.includes(t.period as TemplatePeriod)) out.push("Choose a period: day, week, two weeks, or month.");
  if ((t.note ?? "").length > NOTE_MAX) out.push(`Keep the note to ${NOTE_MAX} characters or fewer.`);
  return out;
}

/** The partner's default template: the chosen one, otherwise Standard, otherwise the first. */
export function defaultTemplateFor(templates: ReportTemplate[], chosenId: string | null | undefined): ReportTemplate {
  return templates.find((t) => t.id === chosenId) ?? templates.find((t) => t.starter_key === "standard") ?? templates[0] ?? STARTER_TEMPLATES[1];
}

// ---------- Saved numbers per period ----------

export type TargetNumbers = { name: string; source: string; period: "day" | "week"; total: number; required: number; met: number; missed: number; pct: number | null };

/** The numbers saved for one period (snapshot.measures[period]). Fields are missing in reports made before templates. */
export type PeriodData = {
  start: string;
  end: string;
  commitments?: { met: number; missed: number; pct: number | null; missedTitles: string[] };
  tasks?: { done: number; overdue: number };
  targets?: TargetNumbers[];
  outreach?: { sent: number; replyRatePct: number | null; meetings: number } | null;
  dealsSourced?: number | null;
  moves?: { pipeline: string; count: number }[];
  runway?: { months: number | null; target: number | null } | null;
  milestones?: { due: number; met: number; missed: number; missedTitles: string[] };
};

export type SavedMeasures = Partial<Record<TemplatePeriod, PeriodData>>;

/**
 * Numbers for a template's period. Reports made before templates (no snapshot.measures) use what the old report saved
 * (commitment score, shared targets, runway, milestones) for its own period; `exact` is false then.
 */
export function periodDataFor(snapshot: Record<string, unknown> | null | undefined, period: TemplatePeriod, report: { period_start: string; period_end: string }): { data: PeriodData; exact: boolean } {
  const saved = (snapshot?.measures ?? null) as SavedMeasures | null;
  const p = saved?.[period];
  if (p) return { data: p, exact: true };
  return { data: legacyPeriodData(snapshot ?? {}, report), exact: false };
}

type Loose = Record<string, unknown>;

export function legacyPeriodData(s: Loose, report: { period_start: string; period_end: string }): PeriodData {
  const out: PeriodData = { start: report.period_start, end: report.period_end };
  const c = s.commitments as Loose | undefined;
  const score = c?.score as Loose | undefined;
  if (score) out.commitments = { met: Number(score.met ?? 0), missed: Number(score.missed ?? 0), pct: score.pct === null || score.pct === undefined ? null : Number(score.pct), missedTitles: [] };
  if (Array.isArray(s.targets))
    out.targets = (s.targets as Loose[]).map((t) => ({
      name: String(t.name),
      source: "",
      period: t.period === "week" ? "week" : "day",
      total: Number(t.total ?? 0),
      required: Number(t.required ?? 0),
      met: Number(t.met ?? 0),
      missed: Number(t.missed ?? 0),
      pct: t.pct === null || t.pct === undefined ? null : Number(t.pct),
    }));
  const r = s.runway as Loose | undefined;
  if (r) out.runway = { months: r.months === null || r.months === undefined ? null : Number(r.months), target: r.target_months === null || r.target_months === undefined ? null : Number(r.target_months) };
  const m = s.milestones as Loose | undefined;
  if (m) {
    const completed = (m.completed as Loose[] | undefined) ?? [];
    const missed = (m.missed as Loose[] | undefined) ?? [];
    out.milestones = { due: completed.length + missed.length, met: completed.length, missed: missed.length, missedTitles: missed.map((x) => String(x.title)) };
  }
  return out;
}

// ---------- Tiles ----------

export type TileStatus = "met" | "soon" | "missed" | "neutral";
export type Tile = { key: string; label: string; value: string; pct: number | null; status: TileStatus; note: string };

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 90% or more = on track, 70% or more = close, below = off track. */
export function pctStatus(pct: number | null): TileStatus {
  if (pct === null) return "neutral";
  if (pct >= 90) return "met";
  if (pct >= 70) return "soon";
  return "missed";
}

/** A count against a required number: all of it = on track, 70% or more = close, below = off track. */
export function ratioStatus(total: number, required: number): TileStatus {
  if (!(required > 0)) return "neutral";
  const pct = (total / required) * 100;
  return pct >= 100 ? "met" : pct >= 70 ? "soon" : "missed";
}

/** Zero is on track, a few is close, more is off track. */
export function countDownStatus(n: number, closeUpTo: number): TileStatus {
  return n <= 0 ? "met" : n <= closeUpTo ? "soon" : "missed";
}

const TARGET_MATCH: Partial<Record<MeasureKey, { source: string; name: string }>> = {
  deals_sourced: { source: "deals_sourced", name: "Deals sourced" },
  listings_screened: { source: "", name: "Listings screened" },
  cims_reviewed: { source: "cims_reviewed", name: "CIMs reviewed" },
  deal_calls: { source: "deal_calls", name: "Broker or owner calls" },
  network_outreach: { source: "communications_outreach", name: "Network outreach" },
};

export function findTarget(targets: TargetNumbers[] | undefined, key: MeasureKey): TargetNumbers | null {
  const m = TARGET_MATCH[key];
  if (!m || !targets) return null;
  return targets.find((t) => t.name.toLowerCase() === m.name.toLowerCase()) ?? (m.source ? targets.find((t) => t.source === m.source) : undefined) ?? null;
}

function targetTile(key: MeasureKey, label: string, t: TargetNumbers | null): Tile | null {
  if (!t) return null;
  return {
    key,
    label,
    value: String(t.total),
    pct: t.required > 0 ? clampPct((t.total / t.required) * 100) : null,
    status: ratioStatus(t.total, t.required),
    note: t.required > 0 ? `of ${t.required} required` : "No days required",
  };
}

/** The tiles for one template and one period, in the catalog order. Measures with no saved numbers are left out. */
export function tilesFor(measures: MeasureKey[], d: PeriodData): Tile[] {
  const out: Tile[] = [];
  const has = new Set(measures);
  for (const m of MEASURES) {
    if (!has.has(m.key)) continue;
    const c = d.commitments;
    const decided = c ? c.met + c.missed : 0;
    switch (m.key) {
      case "completion_pct":
        if (c) out.push({ key: m.key, label: "Commitments completed", value: c.pct === null ? "None due" : `${c.pct}%`, pct: c.pct, status: pctStatus(c.pct), note: decided ? `${c.met} of ${decided} met` : "No commitments were due" });
        break;
      case "commitments_met":
        if (c) out.push({ key: m.key, label: "Commitments met", value: String(c.met), pct: decided ? clampPct((c.met / decided) * 100) : null, status: decided ? pctStatus((c.met / decided) * 100) : "neutral", note: `of ${decided} due` });
        break;
      case "commitments_missed":
        if (c) out.push({ key: m.key, label: "Commitments missed", value: String(c.missed), pct: decided ? clampPct((c.missed / decided) * 100) : null, status: countDownStatus(c.missed, 1), note: c.missed ? "Reasons given at the daily close" : "None missed" });
        break;
      case "tasks_done":
        if (d.tasks) {
          const all = d.tasks.done + d.tasks.overdue;
          out.push({ key: m.key, label: "Tasks done", value: String(d.tasks.done), pct: all ? clampPct((d.tasks.done / all) * 100) : null, status: all ? pctStatus((d.tasks.done / all) * 100) : "neutral", note: `${d.tasks.overdue} still overdue` });
        }
        break;
      case "tasks_overdue":
        if (d.tasks) {
          const all = d.tasks.done + d.tasks.overdue;
          out.push({ key: m.key, label: "Tasks overdue", value: String(d.tasks.overdue), pct: all ? clampPct((d.tasks.overdue / all) * 100) : null, status: countDownStatus(d.tasks.overdue, 2), note: "Open and past the due date" });
        }
        break;
      case "deals_sourced": {
        const t = targetTile(m.key, "Deals sourced", findTarget(d.targets, m.key));
        if (t) out.push(t);
        else if (d.dealsSourced !== undefined && d.dealsSourced !== null) out.push({ key: m.key, label: "Deals sourced", value: String(d.dealsSourced), pct: null, status: "neutral", note: "New Acquisitions items" });
        break;
      }
      case "outreach_done":
        if (d.outreach) {
          const t = findTarget(d.targets, "network_outreach");
          out.push({ key: m.key, label: "Outreach done", value: String(d.outreach.sent), pct: t && t.required > 0 ? clampPct((d.outreach.sent / t.required) * 100) : null, status: t ? ratioStatus(d.outreach.sent, t.required) : "neutral", note: t && t.required > 0 ? `of ${t.required} planned` : "Messages logged as outreach" });
        }
        break;
      case "targets_met_pct":
        if (d.targets) {
          const met = d.targets.reduce((s, t) => s + t.met, 0);
          const missed = d.targets.reduce((s, t) => s + t.missed, 0);
          const pct = met + missed ? Math.round((met / (met + missed)) * 100) : null;
          out.push({ key: m.key, label: "Daily targets met", value: pct === null ? "None due" : `${pct}%`, pct, status: pctStatus(pct), note: met + missed ? `${met} of ${met + missed} days and weeks met` : "No target days were decided" });
        }
        break;
      case "listings_screened":
      case "cims_reviewed":
      case "deal_calls":
      case "network_outreach": {
        const label = MEASURES.find((x) => x.key === m.key)!.label;
        const t = targetTile(m.key, label, findTarget(d.targets, m.key));
        if (t) out.push(t);
        break;
      }
      case "reply_rate":
        if (d.outreach) out.push({ key: m.key, label: "Reply rate", value: d.outreach.replyRatePct === null ? "No outreach" : `${d.outreach.replyRatePct}%`, pct: d.outreach.replyRatePct, status: "neutral", note: `${plural(d.outreach.sent, "message")} sent` });
        break;
      case "meetings_booked":
        if (d.outreach) out.push({ key: m.key, label: "Meetings booked", value: String(d.outreach.meetings), pct: null, status: "neutral", note: "From outreach" });
        break;
      case "pipeline_moves":
        if (d.moves) {
          if (!d.moves.length) out.push({ key: "pipeline_moves", label: "Pipeline moves", value: "0", pct: null, status: "neutral", note: "No stage moves" });
          for (const p of d.moves) out.push({ key: `pipeline_moves:${p.pipeline}`, label: `Moves: ${p.pipeline}`, value: String(p.count), pct: null, status: "neutral", note: "Stage moves" });
        }
        break;
      case "runway_months":
        if (d.runway) {
          const { months, target } = d.runway;
          const status: TileStatus = months === null || !target ? "neutral" : months >= target ? "met" : months >= target * 0.75 ? "soon" : "missed";
          out.push({ key: m.key, label: "Runway", value: months === null ? "Not known" : `${months.toFixed(1)} months`, pct: months !== null && target ? clampPct((months / target) * 100) : null, status, note: target ? `Target ${target} months` : "No target set" });
        }
        break;
      case "milestones_due":
        if (d.milestones) {
          const ms = d.milestones;
          const status: TileStatus = ms.missed > 0 ? "missed" : ms.due === 0 ? "neutral" : ms.met === ms.due ? "met" : "soon";
          out.push({ key: m.key, label: "Milestones due", value: String(ms.due), pct: ms.due ? clampPct((ms.met / ms.due) * 100) : null, status, note: `${ms.met} met, ${ms.missed} missed` });
        }
        break;
    }
  }
  return out;
}

export type Overall = { onTrack: number; total: number; status: TileStatus; text: string };

/** Tiles with a target (not gray) that are on track. 80% or more = green, 50% or more = amber, below = red. */
export function overallOf(tiles: Tile[]): Overall {
  const scored = tiles.filter((t) => t.status !== "neutral");
  const onTrack = scored.filter((t) => t.status === "met").length;
  if (!scored.length) return { onTrack: 0, total: 0, status: "neutral", text: "Nothing to score" };
  const share = onTrack / scored.length;
  return { onTrack, total: scored.length, status: share >= 0.8 ? "met" : share >= 0.5 ? "soon" : "missed", text: `${onTrack} of ${scored.length} on track` };
}

/** Short list of misses for the measures the template shows (at most `max` lines; the rest are counted). */
export function missesFor(measures: MeasureKey[], d: PeriodData, max = 6): string[] {
  const has = (...k: MeasureKey[]) => k.some((x) => measures.includes(x));
  const lines: string[] = [];
  if (has("completion_pct", "commitments_met", "commitments_missed") && d.commitments) {
    for (const t of d.commitments.missedTitles) lines.push(`Missed: ${t}`);
    if (d.commitments.missed > d.commitments.missedTitles.length) lines.push(`${plural(d.commitments.missed - d.commitments.missedTitles.length, "other commitment")} missed`);
  }
  const targetKeys: MeasureKey[] = ["targets_met_pct", "deals_sourced", "listings_screened", "cims_reviewed", "deal_calls", "network_outreach"];
  if (has(...targetKeys) && d.targets) {
    // Only targets whose own measure the template shows (all targets when it shows "Daily targets met").
    const named = new Set(targetKeys.filter((k) => measures.includes(k)).map((k) => findTarget(d.targets, k)?.name).filter(Boolean));
    for (const t of d.targets) {
      if (!t.missed) continue;
      if (!has("targets_met_pct") && !named.has(t.name)) continue;
      const n = t.met + t.missed;
      lines.push(`${t.name}: ${t.missed} of ${n} ${t.period === "week" ? (n === 1 ? "week" : "weeks") : n === 1 ? "day" : "days"} missed`);
    }
  }
  if (has("milestones_due") && d.milestones) for (const t of d.milestones.missedTitles) lines.push(`Milestone missed: ${t}`);
  if (has("tasks_done", "tasks_overdue") && d.tasks?.overdue) lines.push(`${plural(d.tasks.overdue, "task")} overdue`);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), `${lines.length - (max - 1)} more`];
}

// ---------- One report section per template ----------

export function periodText(start: string, end: string): string {
  try {
    const s = parseISO(start);
    const e = parseISO(end);
    if (start === end) return format(e, "EEE, MMM d, yyyy");
    return s.getFullYear() === e.getFullYear() ? `${format(s, "MMM d")} to ${format(e, "MMM d, yyyy")}` : `${format(s, "MMM d, yyyy")} to ${format(e, "MMM d, yyyy")}`;
  } catch {
    return `${start} to ${end}`;
  }
}

export type ReportSection = { template: ReportTemplate; period: string; start: string; end: string; tiles: Tile[]; overall: Overall; misses: string[]; exact: boolean };

export type ReportInput = {
  partnerName: string;
  report: { period_start: string; period_end: string; summary?: string | null; snapshot?: Record<string, unknown> | null; report_kind?: string | null };
  templates: ReportTemplate[];
  link: string | null;
};

export function reportSections(input: ReportInput): ReportSection[] {
  // A daily report shows today's numbers whichever template is chosen.
  const daily = isDailyReport(input.report);
  return input.templates.slice(0, 2).map((t) => {
    const template = daily ? { ...t, period: "day" as const } : t;
    const { data, exact } = periodDataFor(input.report.snapshot, template.period, input.report);
    const tiles = tilesFor(template.measures, data);
    return { template, period: periodText(data.start, data.end), start: data.start, end: data.end, tiles, overall: overallOf(tiles), misses: missesFor(template.measures, data), exact };
  });
}

/** One overall result across both templates (each tile counted once). */
export function combinedOverall(sections: ReportSection[]): Overall {
  const seen = new Map<string, Tile>();
  for (const s of sections) for (const t of s.tiles) if (!seen.has(`${s.start}:${t.key}`)) seen.set(`${s.start}:${t.key}`, t);
  return overallOf([...seen.values()]);
}

export function reportSubject(sections: ReportSection[]): string {
  const daily = sections.length > 0 && sections.every((s) => s.start === s.end);
  return `${daily ? "Daily accountability report" : "Accountability report"}: ${sections[0]?.period ?? ""}`.trim();
}

/** Summary text without markdown marks, as plain lines (the saved summary uses "- " bullets and **bold**). */
export function summaryLines(summary: string | null | undefined): string[] {
  return String(summary ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/, "").replace(/^\s*[-*]\s+/, "- ").trimEnd())
    .filter((l) => l.trim());
}

// ---------- Plain text part ----------

export function reportEmailText(input: ReportInput): { subject: string; body: string } {
  const sections = reportSections(input);
  const day = dayDetailOf(input);
  if (day) return dailyEmailText(input, sections, day);
  const overall = combinedOverall(sections);
  const lines: string[] = [`Hello ${input.partnerName},`, "", `Here is my accountability report for ${sections[0]?.period ?? ""}. Overall: ${overall.text}.`];
  for (const s of sections) {
    lines.push("", `${s.template.name.toUpperCase()} (${s.period})`);
    if (s.template.note) lines.push(s.template.note);
    for (const t of s.tiles) lines.push(`- ${t.label}: ${t.value} (${t.note})`);
    if (!s.exact) lines.push("- Some measures were not saved in this report (it was made before report templates).");
  }
  const misses = [...new Set(sections.flatMap((s) => s.misses))];
  if (misses.length) lines.push("", "MISSES", ...misses.map((m) => `- ${m}`));
  const summary = summaryLines(input.report.summary);
  if (summary.length) lines.push("", "SUMMARY", ...summary);
  if (input.link) lines.push("", `The full report is here (no login needed): ${input.link}`, "Nothing is required from you. You can press Reviewed, leave a comment, or request a call on that page.");
  lines.push("", "Thank you,", "Bram");
  return { subject: reportSubject(sections), body: lines.join("\n") };
}

// ---------- HTML part (email-safe: tables, inline styles, no images, no scripts) ----------

/** Status colors for email (the same values as the app's status tokens). */
export const EMAIL_COLORS = {
  bar: { met: "#16a34a", soon: "#f59e0b", missed: "#dc2626", neutral: "#94a3b8" } as Record<TileStatus, string>,
  text: { met: "#15803d", soon: "#92400e", missed: "#b91c1c", neutral: "#475569" } as Record<TileStatus, string>,
  tint: { met: "#f0fdf4", soon: "#fffbeb", missed: "#fef2f2", neutral: "#f8fafc" } as Record<TileStatus, string>,
  track: "#e2e8f0",
  gold: "#d9bd84",
  ink: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  link: "#1e40af",
  cobalt: "#1d4ed8",
};

export const STATUS_WORD: Record<TileStatus, string> = { met: "On track", soon: "Close", missed: "Off track", neutral: "No target" };

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "font-family:Arial,Helvetica,sans-serif";

/** A progress bar as two table cells (filled and empty) with background colors: works in every email app. */
function barHtml(pct: number | null, status: TileStatus): string {
  const p = pct === null ? 0 : clampPct(pct);
  const fill = p > 0 ? `<td width="${p}%" style="width:${p}%;height:4px;line-height:4px;font-size:0;background-color:${EMAIL_COLORS.bar[status]};border-radius:2px">&nbsp;</td>` : "";
  const rest = p < 100 ? `<td style="height:4px;line-height:4px;font-size:0;background-color:${EMAIL_COLORS.track}">&nbsp;</td>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 4px 0"><tr>${fill}${rest}</tr></table>`;
}

/**
 * One tile: a block 140px wide at most that sits next to the others (inline-block), so 4 fit in a row at 600px and the
 * row wraps to 2 tiles on a phone (Gmail on a phone narrows the email). The label and note keep a fixed height (2
 * lines each), so tiles in a row line up.
 */
function tileHtml(t: Tile): string {
  return (
    `<div style="display:inline-block;width:100%;max-width:140px;vertical-align:top;padding:4px;box-sizing:border-box;text-align:left">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${EMAIL_COLORS.border};border-radius:8px;background-color:#ffffff"><tr><td style="padding:8px 10px;${FONT}">` +
    `<div style="height:32px;overflow:hidden;font-size:12px;line-height:16px;color:${EMAIL_COLORS.muted}">${escapeHtml(t.label)}</div>` +
    `<div style="font-size:20px;line-height:26px;font-weight:bold;white-space:nowrap;color:${t.status === "neutral" || t.status === "met" ? EMAIL_COLORS.ink : EMAIL_COLORS.text[t.status]}">${escapeHtml(t.value)}</div>` +
    barHtml(t.pct, t.status) +
    `<div style="height:30px;overflow:hidden;font-size:11px;line-height:15px;color:${EMAIL_COLORS.muted}">${escapeHtml(t.note)}</div>` +
    `</td></tr></table></div>`
  );
}

function tilesGridHtml(tiles: Tile[]): string {
  // font-size:0 removes the gaps between inline-block tiles.
  return `<div style="font-size:0;line-height:0;text-align:left">${tiles.map(tileHtml).join("")}</div>`;
}

function pillHtml(o: Overall): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${EMAIL_COLORS.tint[o.status]};border:1px solid ${EMAIL_COLORS.bar[o.status]};color:${EMAIL_COLORS.text[o.status]};font-size:13px;line-height:18px;font-weight:bold;white-space:nowrap;${FONT}"><span style="color:${EMAIL_COLORS.bar[o.status]}">&#9679;</span>&nbsp;${escapeHtml(o.text)}</span>`;
}

/**
 * The visual report email: a compact header (period and the overall color with the score), the thin gold line under it,
 * one tile grid per template (number, label, a small progress bar, a short note; 4 per row, 2 on a phone), a short list of misses, the summary,
 * and the link to the full report. At most 600px wide; tables and inline styles only, so Gmail on a phone shows it.
 */
export function reportEmailHtml(input: ReportInput): string {
  const sections = reportSections(input);
  const day = dayDetailOf(input);
  if (day) return dailyEmailHtml(input, sections, day);
  const overall = combinedOverall(sections);
  const period = sections[0]?.period ?? "";
  const misses = [...new Set(sections.flatMap((s) => s.misses))];
  const summary = summaryLines(input.report.summary);
  const p = (html: string, extra = "") => `<p style="margin:0 0 10px 0;font-size:14px;line-height:20px;color:${EMAIL_COLORS.ink};${FONT}${extra}">${html}</p>`;
  const parts: string[] = [];
  parts.push(
    `<tr><td style="padding:16px 20px 12px 20px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
      `<td valign="middle" style="${FONT}"><div style="font-size:12px;line-height:16px;color:${EMAIL_COLORS.muted}">${sections.length && sections.every((x) => x.start === x.end) ? "Daily accountability report" : "Accountability report"}</div>` +
      `<div style="font-size:18px;line-height:24px;font-weight:bold;color:${EMAIL_COLORS.ink}">${escapeHtml(period)}</div></td>` +
      `<td valign="middle" align="right" style="${FONT}">${pillHtml(overall)}</td>` +
      `</tr></table></td></tr>`,
  );
  // The thin gold line under the header (the app's rule for title dividers).
  parts.push(`<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;line-height:1px;font-size:0;background-color:${EMAIL_COLORS.gold}">&nbsp;</td></tr></table></td></tr>`);
  parts.push(`<tr><td style="padding:14px 20px 4px 20px">${p(`Hello ${escapeHtml(input.partnerName)},`)}${p(`Here is my accountability report for ${escapeHtml(period)}.`)}</td></tr>`);
  for (const s of sections) {
    parts.push(
      `<tr><td style="padding:6px 16px 4px 16px">` +
        `<div style="padding:0 4px 4px 4px;font-size:13px;line-height:18px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(s.template.name)} <span style="font-weight:normal;color:${EMAIL_COLORS.muted}">${escapeHtml(s.period)}</span></div>` +
        (s.template.note ? `<div style="padding:0 4px 6px 4px;font-size:13px;line-height:18px;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(s.template.note)}</div>` : "") +
        (s.tiles.length ? tilesGridHtml(s.tiles) : `<div style="padding:4px;font-size:13px;color:${EMAIL_COLORS.muted};${FONT}">No numbers were saved for these measures.</div>`) +
        (!s.exact ? `<div style="padding:4px 4px 0 4px;font-size:11px;line-height:15px;color:${EMAIL_COLORS.muted};${FONT}">Some measures were not saved in this report (it was made before report templates).</div>` : "") +
        `</td></tr>`,
    );
  }
  if (misses.length) {
    const rows = misses
      .map((m) => `<tr><td valign="top" width="14" style="width:14px;padding:2px 0;color:${EMAIL_COLORS.bar.missed};font-size:13px;line-height:18px;${FONT}">&#9679;</td><td style="padding:2px 0;font-size:13px;line-height:18px;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(m)}</td></tr>`)
      .join("");
    parts.push(
      `<tr><td style="padding:10px 20px 4px 20px"><div style="font-size:13px;line-height:18px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">Misses</div>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:4px">${rows}</table></td></tr>`,
    );
  }
  if (summary.length) {
    const items = summary.map((l) => (l.startsWith("- ") ? `<li style="margin:0 0 4px 0">${escapeHtml(l.slice(2))}</li>` : `<li style="margin:0 0 4px 0;list-style:none;margin-left:-18px">${escapeHtml(l)}</li>`)).join("");
    parts.push(`<tr><td style="padding:10px 20px 4px 20px"><div style="font-size:13px;line-height:18px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">Summary</div><ul style="margin:4px 0 0 0;padding-left:18px;font-size:13px;line-height:19px;color:${EMAIL_COLORS.ink};${FONT}">${items}</ul></td></tr>`);
  }
  const closing: string[] = [];
  if (input.link)
    closing.push(
      p(`<a href="${escapeHtml(input.link)}" style="color:${EMAIL_COLORS.link};font-weight:bold;text-decoration:underline">Open the full report</a> (no login needed).`),
      p("Nothing is required from you. You can press Reviewed, leave a comment, or request a call on that page.", `;color:${EMAIL_COLORS.muted};font-size:13px`),
    );
  closing.push(p("Thank you,<br>Bram", ";margin-bottom:0"));
  parts.push(`<tr><td style="padding:12px 20px 18px 20px">${closing.join("")}</td></tr>`);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#f8fafc"><tr><td align="center" style="padding:12px 6px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid ${EMAIL_COLORS.border};border-radius:10px">` +
    parts.join("") +
    `</table></td></tr></table>`
  );
}

// ---------- The daily report (the focused version, batch 1) ----------

/**
 * The content of a daily report, saved with the report when the daily close drafts it (snapshot.day, built by
 * src/lib/engine/day-detail.ts). Daily reports made before it have none and show the tiles as before.
 */
export function dayDetailOf(input: ReportInput): DayDetail | null {
  if (!isDailyReport(input.report)) return null;
  const d = input.report.snapshot?.day as DayDetail | undefined;
  return d && Array.isArray(d.outcomes) && Array.isArray(d.initiatives) ? d : null;
}

/**
 * How much of the day a template shows. Summary: the planned outcomes and tomorrow's priority only. Standard (and a
 * template the owner made): outcomes, progress by initiative, changes in plan, tomorrow's priority. Detailed: the same
 * plus the template's measures as tiles (today's numbers).
 */
export type DailyLevel = "summary" | "standard" | "detailed";
export function dailyLevel(t: ReportTemplate | undefined): DailyLevel {
  if (t?.starter_key === "summary") return "summary";
  if (t?.starter_key === "detailed") return "detailed";
  return "standard";
}

/** The overall pill of a daily report: outcomes complete out of those planned (a partial one counts half). */
export function outcomesOverall(outcomes: DayOutcome[]): Overall {
  const total = outcomes.length;
  if (!total) return { onTrack: 0, total: 0, status: "neutral", text: "No outcomes planned" };
  const complete = outcomes.filter((o) => o.status === "complete").length;
  const partial = outcomes.filter((o) => o.status === "partial").length;
  const share = (complete + partial / 2) / total;
  return { onTrack: complete, total, status: share >= 0.8 ? "met" : share >= 0.5 ? "soon" : "missed", text: `${complete} of ${total} ${total === 1 ? "outcome" : "outcomes"} complete` };
}

const OUTCOME_TILE_STATUS: Record<DayOutcome["status"], TileStatus> = { planned: "neutral", complete: "met", partial: "soon", incomplete: "missed" };

/** "Complete: Review the CIM (90 min). Read it; the asking price is high." */
export function outcomeLine(o: DayOutcome): string {
  const status = o.status === "planned" ? "Not marked" : OUTCOME_STATUS_LABEL[o.status];
  const block = o.actual !== null && o.actual !== undefined ? `${o.actual} min` : o.block ? `${o.block} min planned` : "";
  return `${status}: ${o.title}${block ? ` (${block})` : ""}${o.initiative ? `, ${o.initiative}` : ""}${o.result ? `. ${o.result}` : ""}`;
}

/** The tiles for one initiative in "Progress by initiative": each target, tasks done, stage moves, outreach. */
export function initiativeTiles(g: DayInitiative): Tile[] {
  const out: Tile[] = [];
  for (const t of g.targets) {
    out.push({
      key: `target:${g.name}:${t.name}`,
      label: t.name,
      value: String(t.count),
      pct: t.required > 0 ? clampPct((t.count / t.required) * 100) : null,
      status: t.required > 0 ? ratioStatus(t.count, t.required) : "neutral",
      note: t.required > 0 ? `of ${t.required}${t.period === "week" ? " this week" : " today"}` : "No minimum set",
    });
  }
  if (g.tasksDone) out.push({ key: `tasks:${g.name}`, label: "Tasks done", value: String(g.tasksDone), pct: null, status: "neutral", note: "Marked done today" });
  if (g.moved.length) out.push({ key: `moved:${g.name}`, label: "Moved stage", value: String(g.moved.length), pct: null, status: "neutral", note: g.moved.length === 1 ? g.moved[0].item : "Pipeline items moved today" });
  if (g.passes.length) out.push({ key: `passes:${g.name}`, label: "Passed", value: String(g.passes.length), pct: null, status: "neutral", note: "Screened out with a reason" });
  // An outreach target already shows the count; the plain tile is for initiatives without one.
  if (g.outreach && !g.targets.some((t) => /outreach/i.test(t.name))) out.push({ key: `outreach:${g.name}`, label: "Outreach sent", value: String(g.outreach), pct: null, status: "neutral", note: "Messages logged as outreach" });
  return out;
}

function dailyEmailText(input: ReportInput, sections: ReportSection[], day: DayDetail): { subject: string; body: string } {
  const level = dailyLevel(input.templates[0]);
  const period = periodText(day.date, day.date);
  const overall = outcomesOverall(day.outcomes);
  const lines: string[] = [`Hello ${input.partnerName},`, "", `Here is my daily report for ${period}. ${overall.text}.`];
  lines.push("", "PLANNED OUTCOMES");
  if (day.outcomes.length) for (const o of day.outcomes) lines.push(`- ${outcomeLine(o)}`);
  else lines.push("No outcomes were planned.");
  if (level !== "summary") {
    lines.push("", "PROGRESS BY INITIATIVE");
    if (day.initiatives.length) for (const g of day.initiatives) lines.push(`- ${initiativeLine(g)}`);
    else lines.push("No activity was recorded today.");
    if (level === "detailed") {
      const s = sections[0];
      if (s?.tiles.length) {
        lines.push("", "TODAY'S NUMBERS");
        for (const t of s.tiles) lines.push(`- ${t.label}: ${t.value} (${t.note})`);
      }
    }
    lines.push("", "CHANGES IN PLAN", day.changes ?? "No changes.");
  }
  lines.push("", "TOMORROW'S TOP PRIORITY", day.tomorrow ?? "Not set.");
  const summary = summaryLines(input.report.summary);
  if (summary.length) lines.push("", "SUMMARY", ...summary);
  if (input.link) lines.push("", `The full report is here (no login needed): ${input.link}`, "Nothing is required from you. You can press Reviewed, leave a comment, or request a call on that page.");
  lines.push("", "Thank you,", "Bram");
  return { subject: `Daily accountability report: ${period}`, body: lines.join("\n") };
}

function dailyEmailHtml(input: ReportInput, sections: ReportSection[], day: DayDetail): string {
  const level = dailyLevel(input.templates[0]);
  const period = periodText(day.date, day.date);
  const overall = outcomesOverall(day.outcomes);
  const summary = summaryLines(input.report.summary);
  const p = (html: string, extra = "") => `<p style="margin:0 0 10px 0;font-size:14px;line-height:20px;color:${EMAIL_COLORS.ink};${FONT}${extra}">${html}</p>`;
  const heading = (text: string) => `<div style="padding:0 0 6px 0;font-size:13px;line-height:18px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(text)}</div>`;
  const muted = (text: string) => `<div style="font-size:13px;line-height:18px;color:${EMAIL_COLORS.muted};${FONT}">${escapeHtml(text)}</div>`;
  const section = (inner: string) => `<tr><td style="padding:10px 20px 4px 20px">${inner}</td></tr>`;
  const parts: string[] = [];
  parts.push(
    `<tr><td style="padding:16px 20px 12px 20px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
      `<td valign="middle" style="${FONT}"><div style="font-size:12px;line-height:16px;color:${EMAIL_COLORS.muted}">Daily accountability report</div>` +
      `<div style="font-size:18px;line-height:24px;font-weight:bold;color:${EMAIL_COLORS.ink}">${escapeHtml(period)}</div></td>` +
      `<td valign="middle" align="right" style="${FONT}">${pillHtml(overall)}</td>` +
      `</tr></table></td></tr>`,
  );
  parts.push(`<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;line-height:1px;font-size:0;background-color:${EMAIL_COLORS.gold}">&nbsp;</td></tr></table></td></tr>`);
  parts.push(`<tr><td style="padding:14px 20px 0 20px">${p(`Hello ${escapeHtml(input.partnerName)},`)}${p(`Here is my daily report for ${escapeHtml(period)}.${day.focusedHours !== null && day.focusedHours !== undefined ? ` Focused hours: ${escapeHtml(String(day.focusedHours))}.` : ""}`)}</td></tr>`);
  // Planned outcomes: a colored dot, the status word, the title, the block, and the result line.
  const outcomeRows = day.outcomes
    .map((o) => {
      const st = OUTCOME_TILE_STATUS[o.status];
      const block = o.actual !== null && o.actual !== undefined ? `${o.actual} min` : o.block ? `${o.block} min planned` : "";
      return (
        `<tr><td valign="top" width="14" style="width:14px;padding:3px 0;color:${EMAIL_COLORS.bar[st]};font-size:13px;line-height:18px;${FONT}">&#9679;</td>` +
        `<td style="padding:3px 0 5px 0;font-size:13px;line-height:18px;color:${EMAIL_COLORS.ink};${FONT}">` +
        `<span style="font-weight:bold;color:${st === "neutral" ? EMAIL_COLORS.muted : EMAIL_COLORS.text[st]}">${escapeHtml(o.status === "planned" ? "Not marked" : OUTCOME_STATUS_LABEL[o.status])}</span>` +
        `&nbsp; ${escapeHtml(o.title)}` +
        (block || o.initiative ? `<span style="color:${EMAIL_COLORS.muted}"> (${escapeHtml([o.initiative, block].filter(Boolean).join(", "))})</span>` : "") +
        (o.result ? `<div style="font-size:13px;line-height:18px;color:${EMAIL_COLORS.muted}">${escapeHtml(o.result)}</div>` : "") +
        `</td></tr>`
      );
    })
    .join("");
  parts.push(section(heading("Planned outcomes") + (day.outcomes.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${outcomeRows}</table>` : muted("No outcomes were planned."))));
  if (level !== "summary") {
    const groups = day.initiatives
      .map((g) => {
        const lines = [...g.moved.map((m) => `Moved: ${m.item} to ${m.stage}`), ...g.passes.map((x) => `Passed: ${x.item}${x.reason ? ` (${x.reason})` : ""}`)];
        return (
          `<div style="padding:6px 0 2px 0;font-size:13px;line-height:18px;font-weight:bold;color:${EMAIL_COLORS.cobalt};${FONT}">${escapeHtml(g.name)}</div>` +
          `<div style="margin:0 -4px">${tilesGridHtml(initiativeTiles(g))}</div>` +
          (lines.length ? `<div style="padding:2px 0 4px 0;font-size:12px;line-height:17px;color:${EMAIL_COLORS.muted};${FONT}">${lines.map(escapeHtml).join("<br>")}</div>` : "")
        );
      })
      .join("");
    parts.push(section(heading("Progress by initiative") + (day.initiatives.length ? groups : muted("No activity was recorded today."))));
    if (level === "detailed") {
      const s = sections[0];
      if (s?.tiles.length) parts.push(section(heading("Today's numbers") + `<div style="margin:0 -4px">${tilesGridHtml(s.tiles)}</div>`));
    }
    parts.push(section(heading("Changes in plan") + (day.changes ? `<div style="font-size:13px;line-height:19px;color:${EMAIL_COLORS.ink};white-space:pre-wrap;${FONT}">${escapeHtml(day.changes)}</div>` : muted("No changes."))));
  }
  parts.push(section(heading("Tomorrow's top priority") + (day.tomorrow ? `<div style="font-size:14px;line-height:20px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(day.tomorrow)}</div>` : muted("Not set."))));
  if (summary.length) {
    const items = summary.map((l) => (l.startsWith("- ") ? `<li style="margin:0 0 4px 0">${escapeHtml(l.slice(2))}</li>` : `<li style="margin:0 0 4px 0;list-style:none;margin-left:-18px">${escapeHtml(l)}</li>`)).join("");
    parts.push(section(heading("Summary") + `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:19px;color:${EMAIL_COLORS.ink};${FONT}">${items}</ul>`));
  }
  const closing: string[] = [];
  if (input.link)
    closing.push(
      p(`<a href="${escapeHtml(input.link)}" style="color:${EMAIL_COLORS.link};font-weight:bold;text-decoration:underline">Open the full report</a> (no login needed).`),
      p("Nothing is required from you. You can press Reviewed, leave a comment, or request a call on that page.", `;color:${EMAIL_COLORS.muted};font-size:13px`),
    );
  closing.push(p("Thank you,<br>Bram", ";margin-bottom:0"));
  parts.push(`<tr><td style="padding:14px 20px 18px 20px">${closing.join("")}</td></tr>`);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#f8fafc"><tr><td align="center" style="padding:12px 6px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid ${EMAIL_COLORS.border};border-radius:10px">` +
    parts.join("") +
    `</table></td></tr></table>`
  );
}

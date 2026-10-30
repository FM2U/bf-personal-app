/**
 * Status colors, defined once and used on every screen (tokens in globals.css).
 * - met: met or done (green)
 * - soon: due soon or due today, and warnings (amber)
 * - missed: missed or overdue, and critical (red)
 * - neutral: not started or neutral (gray)
 * No other color carries meaning. Cobalt is the app color (links, buttons, the Next required action card);
 * gold is the secondary accent (Proprietary, highlights); violet, cyan, and coral mark modules and chart series.
 */
export type Status = "met" | "soon" | "missed" | "neutral";

export const STATUSES: Status[] = ["met", "soon", "missed", "neutral"];

/** Text color (passes WCAG AA on white and on the status tint). */
export const STATUS_TEXT: Record<Status, string> = {
  met: "text-status-met",
  soon: "text-status-soon",
  missed: "text-status-missed",
  neutral: "text-status-neutral",
};

/** Badge: light tint with the status text color. */
export const STATUS_BADGE: Record<Status, string> = {
  met: "border-transparent bg-status-met-bg text-status-met",
  soon: "border-transparent bg-status-soon-bg text-status-soon",
  missed: "border-transparent bg-status-missed-bg text-status-missed",
  neutral: "border-transparent bg-status-neutral-bg text-status-neutral",
};

/** Small round dot or bar (not for text). */
export const STATUS_DOT: Record<Status, string> = {
  met: "bg-status-met-solid",
  soon: "bg-status-soon-solid",
  missed: "bg-status-missed-solid",
  neutral: "bg-status-neutral-solid",
};

/** Boxed area (notices, highlighted rows): thin status border on the status tint. */
export const STATUS_BOX: Record<Status, string> = {
  met: "border-status-met-border bg-status-met-bg",
  soon: "border-status-soon-border bg-status-soon-bg",
  missed: "border-status-missed-border bg-status-missed-bg",
  neutral: "border-status-neutral-border bg-status-neutral-bg",
};

/** Tones used by older components, mapped to a status. */
export type Tone = "good" | "warn" | "bad" | "neutral";
export function toneStatus(tone: Tone | null | undefined): Status {
  if (tone === "good") return "met";
  if (tone === "warn") return "soon";
  if (tone === "bad") return "missed";
  return "neutral";
}

/** Alert severity: critical = red, warning = amber, anything else = gray. */
export function severityStatus(severity: string | null | undefined): Status {
  if (severity === "critical") return "missed";
  if (severity === "warning") return "soon";
  return "neutral";
}

/**
 * Status of a due date (ISO yyyy-mm-dd) on `today`: before today = missed (overdue), today = soon (due today),
 * within `soonDays` after today = soon, later or no date = neutral. Done items are met.
 */
export function dueStatus(due: string | null | undefined, today: string, opts: { done?: boolean; soonDays?: number } = {}): Status {
  if (opts.done) return "met";
  if (!due) return "neutral";
  const d = due.slice(0, 10);
  if (d < today) return "missed";
  if (d === today) return "soon";
  if (opts.soonDays && opts.soonDays > 0) {
    const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    const x = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
    if ((x - t) / 864e5 <= opts.soonDays) return "soon";
  }
  return "neutral";
}

/** The status word shown next to a due date: "Overdue", "Due today", or nothing. */
export function dueWord(due: string | null | undefined, today: string): "Overdue" | "Due today" | null {
  if (!due) return null;
  const d = due.slice(0, 10);
  if (d < today) return "Overdue";
  if (d === today) return "Due today";
  return null;
}

/** Met / missed / open period results (daily targets, commitments, milestones). */
export function resultStatus(result: string | null | undefined): Status {
  if (result === "met" || result === "done" || result === "completed" || result === "kept") return "met";
  if (result === "missed" || result === "overdue" || result === "broken") return "missed";
  if (result === "open" || result === "today" || result === "due_today" || result === "in_progress") return "soon";
  return "neutral";
}

/**
 * Status of a count against its required number (daily targets): met when the count reaches the requirement,
 * soon while the period is still open, missed when it closed short, neutral when the period is not counted.
 */
export function countStatus(count: number, required: number, open: boolean, counted = true): Status {
  if (!counted) return "neutral";
  if (count >= required && required > 0) return "met";
  return open ? "soon" : "missed";
}

/** Width of a progress bar in percent (0 to 100). A requirement of 0 shows an empty bar. */
export function progressPct(count: number, required: number): number {
  if (!(required > 0) || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100, Math.round((count / required) * 100)));
}

/**
 * Accent colors (not statuses) as hex, for charts (SVG fill and stroke). Each one equals a token in globals.css
 * (a test checks this): cobalt = --primary, gold = --gold, violet = --violet, cyan = --cyan, coral = --coral,
 * gray = --status-neutral-solid.
 */
export type Accent = "cobalt" | "gold" | "violet" | "cyan" | "coral" | "gray";
export const ACCENT_HEX: Record<Accent, string> = {
  cobalt: "#1d4ed8",
  gold: "#b8862b",
  violet: "#6d28d9",
  cyan: "#0e7c86",
  coral: "#e0603f",
  gray: "#94a3b8",
};

/** Chart series colors, in order: cobalt, gold, violet, cyan, coral. A "current" or baseline series uses gray. */
export const CHART_SERIES: string[] = [ACCENT_HEX.cobalt, ACCENT_HEX.gold, ACCENT_HEX.violet, ACCENT_HEX.cyan, ACCENT_HEX.coral];
export const CHART_BASELINE = ACCENT_HEX.gray;
/**
 * Chart colors that carry a status (tokens --status-met-solid, --status-missed-solid, --status-missed-border, --input):
 * green = done or positive, red = negative (debts, below zero), light red = not done, light gray = a reference amount.
 */
export const CHART_STATUS = { positive: "#16a34a", negative: "#dc2626", negativeSoft: "#fecaca", muted: "#cbd5e1" };

/** The n-th chart series color (wraps after five). */
export function seriesColor(i: number): string {
  return CHART_SERIES[((i % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length];
}

/** One accent per module, used for module icons (sidebar, Home card titles). Home and Settings stay gray. */
export const MODULE_ACCENT: Record<string, Accent> = {
  home: "gray",
  plan: "violet",
  finance: "gold",
  opportunities: "coral",
  people: "cyan",
  productivity: "cobalt",
  accountability: "violet",
  settings: "gray",
  today: "cobalt",
  pipelines: "coral",
  commitments: "violet",
  reports: "violet",
  more: "gray",
};

/** Text color class for a module icon. */
export const ACCENT_TEXT: Record<Accent, string> = {
  cobalt: "text-primary",
  gold: "text-gold",
  violet: "text-violet",
  cyan: "text-cyan",
  coral: "text-coral",
  gray: "text-slate-400",
};

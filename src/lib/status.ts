/**
 * Status colors, defined once and used on every screen (tokens in globals.css).
 * - met: met or done (green)
 * - soon: due soon or due today, and warnings (amber)
 * - missed: missed or overdue, and critical (red)
 * - neutral: not started or neutral (gray)
 * No other color carries meaning. Teal is the app color (links, buttons, Proprietary), not a status.
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

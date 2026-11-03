/**
 * Status colors, defined once and used on every screen (tokens in globals.css).
 * - met: met or done (green)
 * - soon: due soon or due today, and warnings (amber)
 * - missed: missed or overdue, and critical (red)
 * - neutral: not started or neutral (gray)
 * No other color carries meaning. Cobalt is the app color (links, buttons, the Next required action card);
 * sky, violet, cyan, and coral mark modules and chart series (never gold or brown since Edit batch B, 2026-11-01).
 */
export type Status = "met" | "soon" | "missed" | "neutral";
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
/** Boxed area (notices, highlighted rows): thin status border on the status tint. */
export const STATUS_BOX: Record<Status, string> = {
  met: "border-status-met-border bg-status-met-bg",
  soon: "border-status-soon-border bg-status-soon-bg",
  missed: "border-status-missed-border bg-status-missed-bg",
  neutral: "border-status-neutral-border bg-status-neutral-bg",
};

/** Tones used by older components, mapped to a status. */
type Tone = "good" | "warn" | "bad" | "neutral";
export function toneStatus(tone: Tone | null | undefined): Status {
  if (tone === "good") return "met";
  if (tone === "warn") return "soon";
  if (tone === "bad") return "missed";
  return "neutral";
}

/**
 * Accent colors (not statuses) as hex, for charts (SVG fill and stroke). Each one equals a token in globals.css
 * (a test checks this): cobalt = --primary, sky = --sky, violet = --violet, cyan = --cyan, coral = --coral,
 * gray = --status-neutral-solid.
 */
type Accent = "cobalt" | "sky" | "violet" | "cyan" | "coral" | "gray";
/** One accent per module, used for module icons (sidebar, Home card titles). Home and Settings stay gray. */
export const MODULE_ACCENT: Record<string, Accent> = {
  home: "gray",
  plan: "violet",
  finance: "sky",
  opportunities: "coral",
  people: "cyan",
  productivity: "cobalt",
  accountability: "violet",
  settings: "gray",
  work: "cobalt",
  today: "cobalt",
  pipelines: "coral",
  commitments: "violet",
  reports: "violet",
  more: "gray",
};

/** Text color class for a module icon. */
export const ACCENT_TEXT: Record<Accent, string> = {
  cobalt: "text-primary",
  sky: "text-sky",
  violet: "text-violet",
  cyan: "text-cyan",
  coral: "text-coral",
  gray: "text-slate-400",
};

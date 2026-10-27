/**
 * Suggestion lines: at most one short, dismissible line per page or window, made from data and rules the app already
 * has (no AI call). The AI is only used when the owner presses a button on the line (for example "Suggest a next step",
 * which opens the AI chat about the record). Pure functions, tested in src/lib/suggestions.test.ts.
 *
 * Dismissal is remembered per suggestion in the `bf_dismissed` cookie (this browser): a list of suggestion keys.
 * Each key holds the data it was made from (a date, a count, an id), so a new situation shows a new line.
 */
export type Suggestion = {
  /** Remembered when dismissed. Includes the data that made it, so a new situation shows again. */
  key: string;
  text: string;
  /** Optional link after the text. `window` opens a window address (the `w` parameter) instead of a page. */
  link?: { href: string; label: string; window?: string };
  /** Optional AI button: opens the AI chat about the record and sends this question. */
  ai?: { label: string; prompt: string };
};

export const DISMISSED_COOKIE = "bf_dismissed";
/** Keys kept in the cookie (oldest dropped first), so the cookie stays small. */
export const DISMISSED_MAX = 60;

/** Keys in the cookie value (a list joined with "|"). Bad input gives an empty list. */
export function parseDismissed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return [];
  }
  return text
    .split("|")
    .map((k) => k.trim())
    .filter((k) => k && k.length <= 200);
}

/** The cookie value after dismissing `key` (newest last, at most DISMISSED_MAX keys, no repeats). */
export function addDismissed(raw: string | null | undefined, key: string): string {
  const list = parseDismissed(raw).filter((k) => k !== key);
  list.push(key.replace(/\|/g, "/").slice(0, 200));
  return encodeURIComponent(list.slice(-DISMISSED_MAX).join("|"));
}

/** The first suggestion that was not dismissed (pages show at most one). */
export function pickSuggestion(list: (Suggestion | null | undefined)[], dismissed: string[]): Suggestion | null {
  const set = new Set(dismissed);
  return list.find((s): s is Suggestion => !!s && !set.has(s.key)) ?? null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Rules ----------

/** Targets: the target that is furthest behind today (day targets), or this week (week targets). */
export function targetSuggestion(
  // Target rows are database rows (id, name, count_source, active) with their rule in `def`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaries: { target: { [column: string]: any; def: { period: "day" | "week" } }; today: { status: string; count: number; required: number } }[],
  today: string,
): Suggestion | null {
  const behind = summaries
    .filter((s) => s.target.active !== false && s.today.status === "open" && s.today.count < s.today.required)
    .map((s) => ({ s, gap: s.today.required - s.today.count }))
    .sort((a, b) => (a.s.target.def.period === b.s.target.def.period ? b.gap - a.gap : a.s.target.def.period === "day" ? -1 : 1));
  const first = behind[0];
  if (!first) return null;
  const { s, gap } = first;
  const when = s.target.def.period === "day" ? "today" : "this week";
  const link = s.target.count_source === "communications_outreach" ? { href: "/people/outreach", label: "Open the Outreach Queue" } : undefined;
  return { key: `target:${s.target.id}:${today}:${s.today.count}`, text: `You are ${gap} behind on ${s.target.name} ${when}.`, link };
}

/** Whole days from `from` to `to` (dates as YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Pipeline item: no activity for a while (from 2 days before the item counts as stalled, at least 3 days), with a
 * suggested next step: the next open task for the item, or a follow-up with the person the deal came from. (An overdue
 * next action is already shown in red on the Next required action card, so it gets no line here.)
 */
export function pipelineSuggestion(p: {
  id: string;
  open: boolean;
  today: string;
  lastActivity: string | null;
  nextAction: string | null;
  nextTask: string | null;
  sourceName: string | null;
  stallDays: number;
  /** The item's name: stage task titles start with it ("Demo Pest Control: Sign NDA"), the line leaves it out. */
  itemName?: string | null;
}): Suggestion | null {
  if (!p.open || !p.lastActivity) return null;
  const quiet = daysBetween(p.lastActivity.slice(0, 10), p.today);
  const threshold = Math.max(3, Math.round(p.stallDays) - 2);
  if (quiet < threshold) return null;
  const task = p.nextTask && p.itemName && p.nextTask.startsWith(`${p.itemName}: `) ? p.nextTask.slice(p.itemName.length + 2) : p.nextTask;
  const step = (task ?? (p.sourceName ? `Follow up with ${p.sourceName}` : p.nextAction ?? "Send a short follow-up")).replace(/\.$/, "");
  return {
    key: `pipe-quiet:${p.id}:${p.lastActivity.slice(0, 10)}`,
    text: `No activity in ${plural(quiet, "day")}. Suggested next step: ${step}.`,
    ai: { label: "Suggest a next step", prompt: "Suggest one next step for this item, with the reason, in 3 bullets or fewer." },
  };
}

/** Expenses: savings ideas waiting for a decision. */
export function savingsIdeasSuggestion(pending: { id: string; estimated_monthly_savings?: number | string | null }[], money: (n: number) => string): Suggestion | null {
  if (!pending.length) return null;
  const total = pending.reduce((s, i) => s + Number(i.estimated_monthly_savings ?? 0), 0);
  const ids = pending.map((i) => i.id).sort().join(",");
  return {
    key: `ideas:${hash(ids)}`,
    text: `${plural(pending.length, "savings idea")} waiting${total > 0 ? ` (about ${money(total)} a month)` : ""}.`,
    link: { href: "#savings-ideas", label: "Review them" },
  };
}

/** The first item of the morning plan's Top 3, without its bold lead-in ("- **Task 1:** Call the broker" gives "Call the broker"). */
export function topPriority(plan: string | null | undefined): string | null {
  if (!plan) return null;
  for (const line of plan.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(?:\*\*[^*]{0,40}\*\*:?\s*)?(.+)$/);
    if (m && m[1].trim()) return m[1].replace(/\*\*/g, "").trim();
  }
  return null;
}

/** Home (morning): the top priority from the morning plan, or the first open task. */
export function homeSuggestion(p: { today: string; plan: string | null; firstTask: string | null; openCount: number }): Suggestion | null {
  const top = topPriority(p.plan) ?? p.firstTask;
  if (!top) return null;
  return {
    key: `home:${p.today}`,
    text: `Top priority: ${top.replace(/\.$/, "")}.`,
    link: p.openCount ? { href: "/productivity", label: "Work through tasks", window: "work" } : undefined,
  };
}

/** Productivity: overdue tasks. */
export function overdueSuggestion(p: { today: string; overdue: number }): Suggestion | null {
  if (p.overdue < 1) return null;
  return { key: `overdue:${p.today}:${p.overdue}`, text: `${plural(p.overdue, "task")} ${p.overdue === 1 ? "is" : "are"} overdue. Go through them one at a time.`, link: { href: "/productivity", label: "Work through tasks", window: "work" } };
}

/** A task that keeps moving to the next day. */
export function taskSuggestion(t: { id: string; status: string; times_moved?: number | null }): Suggestion | null {
  const moved = Number(t.times_moved ?? 0);
  if (t.status !== "todo" || moved < 3) return null;
  return { key: `task-moved:${t.id}:${moved}`, text: `Moved ${moved} times. Write a smaller first step, give it a later date, or delete it.` };
}

/** Goal: deadline within 30 days and the target is not met yet. */
export function goalSuggestion(g: { id: string; status: string; deadline: string | null; met: boolean | null; today: string }): Suggestion | null {
  if (g.status !== "active" || !g.deadline || g.met !== false) return null;
  const left = daysBetween(g.today, g.deadline);
  if (left < 0 || left > 30) return null;
  return {
    key: `goal:${g.id}:${g.deadline}`,
    text: `Deadline in ${plural(left, "day")} and the target is not met yet.`,
    ai: { label: "Suggest a next step", prompt: "What should I do this week to meet this goal? 3 bullets or fewer." },
  };
}

/** Short stable text hash (for keys). */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

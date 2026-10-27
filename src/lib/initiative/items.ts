/**
 * Repeated items in the initiative setup and the draft review screen (goals, milestones, recurring tasks, checklists,
 * target and budget, plan): the one-line summary each item shows while it is collapsed, and which items start open.
 * Pure functions, tested in src/lib/initiative/items.test.ts; the component is src/components/app/repeat-items.tsx.
 *
 * Rules:
 * - A collapsed item shows its number, its name, and a few small labeled facts ("Due Oct 31", "Goal 1",
 *   "Test 4 recipes chosen..."). Every item of a kind shows the same facts in the same order (a missing value says
 *   "Not set"), so the facts line up from row to row. Long text is cut to one line.
 * - Which items start open: the first item when the list has 1 or 2 items; none when it has more. An item with a
 *   problem (an empty required field or a value the step would refuse) always starts open. A viewer's saved choice
 *   wins over the default; a problem wins over a saved "closed".
 */
import { METRICS } from "@/lib/metrics-list";
import { date } from "@/lib/format";
import { goalTargetText, targetRuleText, WEEKDAY_NAMES } from "@/lib/initiative/summary";
import type { Proposal } from "@/lib/initiative/proposal";

/** One small labeled value on a collapsed row. `size` sets its column width so rows line up; "long" takes the rest. */
export type Fact = { label: string; value: string; size: "sm" | "md" | "long" };

/** Longest text shown in a long fact before it is cut with "..." (the row also cuts it to one line). */
export const LONG_MAX = 80;
/** Longest text shown in a short fact. */
export const SHORT_MAX = 28;

/** Text cut to `max` characters at a word break where one is close, with "..." added. Spaces and line breaks collapse. */
export function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  // The cut ends a word when the next character is a space; otherwise go back to the last space if it is close.
  const space = t[max - 3] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}...`;
}

const NOT_SET = "Not set";
const shortDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? date(d, "MMM d") : NOT_SET);
const fact = (label: string, value: string | null | undefined, size: Fact["size"]): Fact => {
  const v = (value ?? "").trim();
  return { label, value: v ? clip(v, size === "long" ? LONG_MAX : SHORT_MAX) : NOT_SET, size };
};

type Goal = Proposal["goals"][number];
type Milestone = Proposal["milestones"][number];
type Task = Proposal["recurring_tasks"][number];
type Checklist = Proposal["checklists"][number];

export function goalFacts(g: Goal): Fact[] {
  const metric = METRICS.find((m) => m.key === g.metric_key)?.label ?? (g.metric_key ? g.metric_key : "Not measured automatically");
  return [fact("Deadline", shortDate(g.deadline), "sm"), fact("Target", goalTargetText(g.metric_key, g.comparison, g.target_value), "md"), fact("Measured", metric, "long")];
}

/** `goals` gives the goal number its place in the list ("Goal 1"). */
export function milestoneFacts(m: Milestone, goals: number): Fact[] {
  const options = m.options_if_missed.filter((o) => o.trim()).length;
  return [
    fact("Due", shortDate(m.due_date), "sm"),
    fact("Goal", goals ? String(Math.min(m.goal, goals - 1) + 1) : NOT_SET, "sm"),
    fact("If missed", options ? `${options} option${options === 1 ? "" : "s"}` : NOT_SET, "sm"),
    fact("Test", m.completion_test, "long"),
  ];
}

export function cadenceText(t: Pick<Task, "cadence" | "weekday" | "day_of_month">): string {
  if (t.cadence === "daily") return "Daily";
  if (t.cadence === "monthly") return `Monthly, day ${t.day_of_month ?? 1}`;
  return t.weekday === null || t.weekday === undefined ? "Weekly" : `Weekly, ${WEEKDAY_NAMES[t.weekday] ?? ""}`.replace(/, $/, "");
}

export function taskFacts(t: Task, commitment: boolean): Fact[] {
  return [fact("Repeats", cadenceText(t), "md"), fact("Kind", commitment ? "Commitment" : "Regular task", "md"), fact("Details", t.details, "long")];
}

export function checklistFacts(c: Checklist, tasks: string[]): Fact[] {
  const n = c.items.filter((it) => it.text.trim()).length;
  const task = c.recurring_task === null || c.recurring_task === undefined ? "None" : tasks[c.recurring_task] || `Recurring task ${c.recurring_task + 1}`;
  return [fact("Items", String(n), "sm"), fact("Resets", c.reset_weekly ? "Each week" : "No", "sm"), fact("With task", task, "long")];
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function budgetFacts(b: NonNullable<Proposal["budget_change"]>, current: number | null): Fact[] {
  return [fact("New amount", `${usd(b.new_monthly_amount)} a month`, "md"), fact("Spending now", current === null ? "No spending" : `${usd(current)} a month`, "md")];
}

export function targetFacts(t: NonNullable<Proposal["target"]>): Fact[] {
  return [fact("Rule", targetRuleText(t.period, t.minimum_count, t.weekdays), "md"), fact("Counted", "With +1 on Today", "md")];
}

export function conditionFacts(c: NonNullable<Proposal["decision_condition"]>): Fact[] {
  return [fact("Threshold", String(c.threshold), "sm"), fact("Task when met", c.action_task, "long")];
}

export function planFacts(p: NonNullable<Proposal["plan_document"]>): Fact[] {
  const lines = p.body.split("\n").filter((l) => l.trim()).length;
  const first = p.body.split("\n").find((l) => l.trim()) ?? "";
  return [fact("Lines", String(lines), "sm"), fact("Starts", first.replace(/^[-*\s]+/, "").replace(/\*\*/g, ""), "long")];
}

// ---------- Which items start open ----------

/** Open by default: the first item when the list has 1 or 2 items, none when it has more. */
export function defaultItemOpen(index: number, count: number): boolean {
  return count <= 2 && index === 0;
}

/**
 * Open state of each item: a choice made on this page view first, then a problem (always open), then the viewer's
 * saved choice, then the default (from the item count when the list was first shown, so adding an item never closes
 * the first one).
 */
export function itemsOpen(opts: { count: number; initialCount: number; attention: boolean[]; saved: Record<string, boolean> | null; changed: Record<string, boolean> }): boolean[] {
  const { count, initialCount, attention, saved, changed } = opts;
  return Array.from({ length: count }, (_, i) => {
    const k = String(i);
    if (typeof changed[k] === "boolean") return changed[k];
    if (attention[i]) return true;
    if (saved && typeof saved[k] === "boolean") return saved[k];
    return defaultItemOpen(i, initialCount);
  });
}

/** An index-keyed map after item `removed` is deleted: later items move up one. */
export function shiftAfterRemove(map: Record<string, boolean>, removed: number): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i === removed) continue;
    out[String(i > removed ? i - 1 : i)] = v;
  }
  return out;
}

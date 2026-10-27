/**
 * The initiative summary window ("View summary"), on the draft review screen and on every initiative page.
 * One shape of data for both: built from the AI proposal (draft) or from the saved records (initiative page).
 * Each line has a `ref`: on the review screen it points at the item's fields (the window closes, the page scrolls
 * there and focuses the field); on a saved initiative it points at the record (opened in the quick view).
 * Pure functions, tested in src/lib/initiative/summary.test.ts.
 */
import { METRICS } from "@/lib/metrics-list";
import { budgetSavings, type Include, type Proposal } from "@/lib/initiative/proposal";

export type SummaryRef = { kind: "field"; anchor: string } | { kind: "record"; table: string; id: string } | { kind: "plan" } | { kind: "none" };

export type SummaryRecurring = { title: string; cadence: "daily" | "weekly" | "monthly" | string; weekday: number | null; dayOfMonth: number | null; ref: SummaryRef };

export type InitiativeSummary = {
  name: string;
  purpose: string | null;
  parent: string | null;
  ref: SummaryRef;
  purposeRef: SummaryRef;
  savings: number | null;
  savingsBasis: string | null;
  goals: { title: string; target: string | null; deadline: string | null; ref: SummaryRef }[];
  milestones: { title: string; due: string | null; ref: SummaryRef }[];
  recurring: SummaryRecurring[];
  targets: { name: string; rule: string; ref: SummaryRef }[];
  budget: { category: string; amount: number; current: number | null; ref: SummaryRef }[];
  checklists: { name: string; count: number; ref: SummaryRef }[];
  plan: { title: string; preview: string[]; body: string; ref: SummaryRef } | null;
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Weekdays in the order the week is shown: Monday first, Sunday last. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "At or below $700" style text for a goal target, in the measured number's unit. */
export function goalTargetText(metricKey: string | null | undefined, comparison: string | null | undefined, value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const unit = METRICS.find((m) => m.key === metricKey)?.unit;
  const v = Number(value);
  const shown = unit === "usd" ? usd(v) : unit === "percent" ? `${v}%` : unit === "months" ? `${v} months` : unit === "days" ? `${v} days` : String(v);
  return `${comparison === "gte" ? "At or above" : "At or below"} ${shown}`;
}

/** "3 per weekday", "5 per week", "1 per day" for a target. */
export function targetRuleText(period: string, minimum: number, weekdays?: number[] | null): string {
  if (period === "week") return `${minimum} per week`;
  const days = [...new Set(weekdays ?? [])].sort();
  if (days.length === 5 && days.join(",") === "1,2,3,4,5") return `${minimum} per weekday`;
  if (!days.length || days.length === 7) return `${minimum} per day`;
  return `${minimum} per day on ${days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(", ")}`;
}

/**
 * Recurring tasks grouped by when they happen, in week order: "Every day" first, then Monday to Sunday,
 * then "Monthly" (sorted by day of the month), then "Quarterly". Empty groups are left out.
 */
export function groupRecurringByWeekday<T extends { cadence: string; weekday: number | null; dayOfMonth: number | null }>(tasks: T[]): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  const daily = tasks.filter((t) => t.cadence === "daily");
  if (daily.length) out.push({ label: "Every day", items: daily });
  for (const d of WEEK_ORDER) {
    const items = tasks.filter((t) => t.cadence === "weekly" && Number(t.weekday ?? 0) === d);
    if (items.length) out.push({ label: WEEKDAY_NAMES[d], items });
  }
  const monthly = tasks.filter((t) => t.cadence === "monthly").sort((a, b) => Number(a.dayOfMonth ?? 1) - Number(b.dayOfMonth ?? 1));
  if (monthly.length) out.push({ label: "Monthly", items: monthly });
  const quarterly = tasks.filter((t) => t.cadence === "quarterly");
  if (quarterly.length) out.push({ label: "Quarterly", items: quarterly });
  const other = tasks.filter((t) => !["daily", "weekly", "monthly", "quarterly"].includes(t.cadence));
  if (other.length) out.push({ label: "Other", items: other });
  return out;
}

/** The first `n` lines of a plan document as plain text (bullets, bold markers, and headings removed). */
export function planPreview(body: string, n = 4): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "").replace(/\*\*|__/g, "").trim())
    .filter(Boolean)
    .slice(0, n);
}

/** Milestones in date order (no date last). */
export function byDate<T extends { due: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

/**
 * Summary of a draft on the review screen: only the items checked "Include", each pointing at its fields.
 * `currentSpend` is the budget category's average monthly spending (last 3 full months), when known.
 */
export function summaryFromProposal(p: Proposal, inc: Include, currentSpend: number | null): InitiativeSummary {
  const f = (anchor: string): SummaryRef => ({ kind: "field", anchor });
  const budgetOn = !!(p.budget_change && inc.budget_change);
  const savings = budgetOn && currentSpend !== null ? budgetSavings(currentSpend, p.budget_change!.new_monthly_amount) : budgetOn ? p.budget_change!.estimated_monthly_savings ?? p.estimated_monthly_savings ?? null : p.estimated_monthly_savings ?? null;
  return {
    name: p.initiative.name,
    purpose: p.initiative.purpose || null,
    parent: p.initiative.parent_initiative ?? null,
    ref: f("i-name"),
    purposeRef: f("i-purpose"),
    savings: savings ?? null,
    savingsBasis: budgetOn && currentSpend !== null ? `${p.budget_change!.category}: ${usd(currentSpend)} per month now minus the new ${usd(p.budget_change!.new_monthly_amount)}` : savings !== null && savings !== undefined ? "The AI's estimate" : null,
    goals: p.goals.flatMap((g, i) => (inc.goals[i] ? [{ title: g.title, target: goalTargetText(g.metric_key, g.comparison, g.target_value), deadline: g.deadline, ref: f(`g-title-${i}`) }] : [])),
    milestones: byDate(p.milestones.flatMap((m, i) => (inc.milestones[i] ? [{ title: m.title, due: m.due_date, ref: f(`m-title-${i}`) }] : []))),
    recurring: p.recurring_tasks.flatMap((t, i) => (inc.recurring_tasks[i] ? [{ title: t.title, cadence: t.cadence, weekday: t.weekday ?? null, dayOfMonth: t.day_of_month ?? null, ref: f(`t-title-${i}`) }] : [])),
    targets: p.target && inc.target ? [{ name: p.target.name, rule: targetRuleText(p.target.period, p.target.minimum_count, p.target.weekdays), ref: f("tg-name") }] : [],
    budget: p.budget_change && inc.budget_change ? [{ category: p.budget_change.category, amount: p.budget_change.new_monthly_amount, current: currentSpend, ref: f("b-amt") }] : [],
    checklists: p.checklists.flatMap((c, i) => (inc.checklists[i] ? [{ name: c.name, count: c.items.length, ref: f(`c-name-${i}`) }] : [])),
    plan: p.plan_document && inc.plan_document ? { title: p.plan_document.title, preview: planPreview(p.plan_document.body), body: p.plan_document.body, ref: f("pd-title") } : null,
  };
}

/** Number of lines in the summary (the initiative itself counts as one). */
export function summaryCount(s: InitiativeSummary): number {
  return 1 + s.goals.length + s.milestones.length + s.recurring.length + s.targets.length + s.budget.length + s.checklists.length + (s.plan ? 1 : 0);
}

/**
 * Initiative drafts in the step-by-step setup (src/components/app/windows/setup-window.tsx): reading a saved draft
 * that may be half filled in (Add manually), checking one step before it is saved, and the blank items that
 * "+ Add goal", "+ Add milestone", ... start from. Pure functions, tested in src/lib/initiative/draft.test.ts.
 * The full check happens on approval (validateForApproval in proposal.ts).
 */
import { addDaysISO } from "@/lib/calc/dates";
import {
  BudgetChangeSchema,
  ChecklistSchema,
  GoalSchema,
  includeAll,
  issuesText,
  MilestoneSchema,
  PlanDocumentSchema,
  RecurringTaskSchema,
  TargetSchema,
  validateProposal,
  type Include,
  type Proposal,
} from "@/lib/initiative/proposal";
import type { SetupStep } from "@/lib/window-route";
import type { z } from "zod";

export type DraftState = { proposal: Proposal; include: Include };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const str = (x: unknown, d = ""): string => (typeof x === "string" ? x : d);
const strOrNull = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const arr = (x: unknown): Loose[] => (Array.isArray(x) ? x : []);
const obj = (x: unknown): Loose | null => (x && typeof x === "object" && !Array.isArray(x) ? x : null);

/** A proposal with nothing in it (Add manually starts here). */
export function emptyProposal(): Proposal {
  return {
    initiative: { name: "", purpose: "", parent_initiative: null },
    goals: [],
    milestones: [],
    recurring_tasks: [],
    target: null,
    budget_change: null,
    decision_condition: null,
    plan_document: null,
    checklists: [],
    estimated_monthly_savings: null,
  };
}

/**
 * A saved draft as the setup edits it. A complete draft (from the AI) is read as is; a half-filled one (Add manually,
 * or saved for later in the middle) keeps every value it has, with blanks where something is missing.
 * Null only when there is no proposal at all.
 */
export function normalizeDraft(value: unknown): DraftState | null {
  const v = obj(value);
  if (!v || !obj(v.proposal)) return null;
  const strict = validateProposal(v.proposal);
  let proposal: Proposal;
  if (strict.ok) proposal = strict.proposal;
  else {
    const p = v.proposal;
    const ini = obj(p.initiative) ?? {};
    proposal = {
      initiative: { name: str(ini.name), purpose: str(ini.purpose), parent_initiative: strOrNull(ini.parent_initiative) },
      goals: arr(p.goals).slice(0, 3).map((g) => ({
        title: str(g?.title),
        metric_key: strOrNull(g?.metric_key),
        categories: Array.isArray(g?.categories) ? g.categories.filter((c: unknown) => typeof c === "string") : null,
        comparison: g?.comparison === "gte" ? "gte" : "lte",
        target_value: num(g?.target_value),
        deadline: str(g?.deadline),
      })),
      milestones: arr(p.milestones).slice(0, 4).map((m) => ({
        title: str(m?.title),
        completion_test: str(m?.completion_test),
        due_date: str(m?.due_date),
        goal: Math.max(0, Math.min(2, Math.round(num(m?.goal) ?? 0))),
        target_value: num(m?.target_value),
        options_if_missed: arr(m?.options_if_missed).filter((o) => typeof o === "string"),
      })),
      recurring_tasks: arr(p.recurring_tasks).slice(0, 6).map((t) => ({
        title: str(t?.title),
        cadence: t?.cadence === "daily" || t?.cadence === "monthly" ? t.cadence : "weekly",
        weekday: num(t?.weekday),
        day_of_month: num(t?.day_of_month),
        details: strOrNull(t?.details),
        review: t?.review === true,
      })),
      target: obj(p.target)
        ? { name: str(p.target.name), period: p.target.period === "week" ? "week" : "day", minimum_count: Math.max(1, Math.round(num(p.target.minimum_count) ?? 1)), weekdays: arr(p.target.weekdays).filter((d) => typeof d === "number") }
        : null,
      budget_change: obj(p.budget_change)
        ? { category: str(p.budget_change.category), new_monthly_amount: Math.max(0, num(p.budget_change.new_monthly_amount) ?? 0), estimated_monthly_savings: num(p.budget_change.estimated_monthly_savings) }
        : null,
      decision_condition: obj(p.decision_condition) ? (p.decision_condition as Proposal["decision_condition"]) : null,
      plan_document: obj(p.plan_document) ? { title: str(p.plan_document.title), body: str(p.plan_document.body) } : null,
      checklists: arr(p.checklists).slice(0, 4).map((c) => ({
        name: str(c?.name),
        reset_weekly: c?.reset_weekly === true,
        recurring_task: num(c?.recurring_task),
        items: arr(c?.items).map((it) => ({ text: str(it?.text), quantity: strOrNull(it?.quantity), notes: strOrNull(it?.notes) })),
      })),
      estimated_monthly_savings: num(p.estimated_monthly_savings),
    };
  }
  const all = includeAll(proposal);
  // Each saved choice is kept where it fits the items; anything missing is included.
  const raw = obj(v.include) ?? {};
  const fit = (key: string, fallback: boolean[]) => {
    const saved = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [];
    return fallback.map((d, i) => (typeof saved[i] === "boolean" ? (saved[i] as boolean) : d));
  };
  const flag = (key: string, has: boolean) => has && (typeof raw[key] === "boolean" ? (raw[key] as boolean) : true);
  const include: Include = {
    goals: fit("goals", all.goals),
    milestones: fit("milestones", all.milestones),
    recurring_tasks: fit("recurring_tasks", all.recurring_tasks),
    target: flag("target", !!proposal.target),
    budget_change: flag("budget_change", !!proposal.budget_change),
    decision_condition: flag("decision_condition", !!proposal.decision_condition),
    plan_document: flag("plan_document", !!proposal.plan_document),
    checklists: fit("checklists", all.checklists),
  };
  return { proposal, include };
}

/** A problem in one item, in plain words: "Goal 2: deadline must be a date in YYYY-MM-DD form". */
function check<T extends z.ZodType>(schema: T, value: unknown, label: string): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : `${label}: ${issuesText(r.error)}`;
}

export type ItemKind = "goals" | "milestones" | "recurring_tasks" | "checklists" | "target" | "budget_change" | "decision_condition" | "plan_document";

/**
 * The problem in one item, or null (the same checks as Save on its step). Used by Save (validateStep) and to open
 * the items that need attention in a list of collapsed items. A missing item has no problem.
 */
export function itemIssue(s: DraftState, kind: ItemKind, i = 0): string | null {
  const p = s.proposal;
  switch (kind) {
    case "goals": {
      const g = p.goals[i];
      if (!g) return null;
      const e = check(GoalSchema, g, `Goal ${i + 1}`);
      if (e) return e;
      if (g.metric_key?.startsWith("category_") && !g.categories?.length) return `Goal ${i + 1}: a category measured number needs at least one category.`;
      return null;
    }
    case "milestones": {
      const m = p.milestones[i];
      if (!m) return null;
      const e = check(MilestoneSchema, m, `Milestone ${i + 1}`);
      if (e) return e;
      if (!p.goals.some((_, j) => s.include.goals[j])) return `Milestone ${i + 1}: every milestone belongs to a goal. Add or include a goal first.`;
      return null;
    }
    case "recurring_tasks": {
      const t = p.recurring_tasks[i];
      if (!t) return null;
      const e = check(RecurringTaskSchema, t, `Recurring task ${i + 1}`);
      if (e) return e;
      if (t.cadence === "weekly" && (t.weekday === null || t.weekday === undefined)) return `Recurring task ${i + 1}: choose the day of the week.`;
      return null;
    }
    case "checklists":
      return p.checklists[i] ? check(ChecklistSchema, p.checklists[i], `Checklist ${i + 1}`) : null;
    case "target":
      return p.target ? check(TargetSchema, p.target, "Target") : null;
    case "budget_change":
      return p.budget_change ? check(BudgetChangeSchema, p.budget_change, "Budget change") : null;
    case "plan_document":
      return p.plan_document ? check(PlanDocumentSchema, p.plan_document, "Plan") : null;
    case "decision_condition":
      return null;
  }
}

/** Per item of a list: true when it is included and has a problem (it starts open in a list of collapsed items). */
export function itemsNeedingAttention(s: DraftState, kind: "goals" | "milestones" | "recurring_tasks" | "checklists"): boolean[] {
  return s.proposal[kind].map((_, i) => !!s.include[kind][i] && itemIssue(s, kind, i) !== null);
}

/**
 * Checks the items of one setup step that are included (Save on that step). Returns the first problem, or null.
 * Items that are not included are never checked; they are not created.
 */
export function validateStep(s: DraftState, step: SetupStep): string | null {
  const p = s.proposal;
  const inc = s.include;
  const first = (kind: "goals" | "milestones" | "recurring_tasks" | "checklists") => {
    for (let i = 0; i < p[kind].length; i++) {
      if (!inc[kind][i]) continue;
      const e = itemIssue(s, kind, i);
      if (e) return e;
    }
    return null;
  };
  switch (step) {
    case "name": {
      const name = p.initiative.name.trim();
      if (!name) return "Name: give the initiative a name.";
      if (name.length > 80) return "Name: use 80 characters or fewer.";
      if (p.initiative.purpose.length > 500) return "Purpose: use 500 characters or fewer.";
      return null;
    }
    case "goals":
      return first("goals");
    case "milestones":
      return first("milestones");
    case "tasks":
      return first("recurring_tasks");
    case "target":
      return (inc.target ? itemIssue(s, "target") : null) ?? (inc.budget_change ? itemIssue(s, "budget_change") : null);
    case "plan":
      return (inc.plan_document ? itemIssue(s, "plan_document") : null) ?? first("checklists");
    default:
      return null;
  }
}

/** Number of items that will be created (the initiative counts as one). */
export function selectedCount(s: DraftState): { selected: number; total: number } {
  const { proposal: p, include: inc } = s;
  const selected =
    1 +
    inc.goals.filter(Boolean).length +
    inc.milestones.filter(Boolean).length +
    inc.recurring_tasks.filter(Boolean).length +
    (inc.target ? 1 : 0) +
    (inc.budget_change ? 1 : 0) +
    (inc.decision_condition ? 1 : 0) +
    (inc.plan_document ? 1 : 0) +
    inc.checklists.filter(Boolean).length;
  const total = 1 + p.goals.length + p.milestones.length + p.recurring_tasks.length + (p.target ? 1 : 0) + (p.budget_change ? 1 : 0) + (p.decision_condition ? 1 : 0) + (p.plan_document ? 1 : 0) + p.checklists.length;
  return { selected, total };
}

// ---------- Blank items (+ Add ...) ----------

export const newGoal = (today: string): Proposal["goals"][number] => ({ title: "", metric_key: null, categories: null, comparison: "lte", target_value: null, deadline: addDaysISO(today, 90) });
export const newMilestone = (today: string): Proposal["milestones"][number] => ({ title: "", completion_test: "", due_date: addDaysISO(today, 30), goal: 0, target_value: null, options_if_missed: ["Extend 30 days", "Drop this milestone"] });
export const newRecurringTask = (): Proposal["recurring_tasks"][number] => ({ title: "", cadence: "weekly", weekday: 1, day_of_month: null, details: null, review: false });
export const newTarget = (): NonNullable<Proposal["target"]> => ({ name: "", period: "day", minimum_count: 1, weekdays: [1, 2, 3, 4, 5] });
export const newBudgetChange = (category: string): NonNullable<Proposal["budget_change"]> => ({ category, new_monthly_amount: 0, estimated_monthly_savings: null });
export const newPlan = (name: string): NonNullable<Proposal["plan_document"]> => ({ title: name ? `${name}: plan` : "Plan", body: "" });
export const newChecklist = (): Proposal["checklists"][number] => ({ name: "", reset_weekly: false, recurring_task: null, items: [{ text: "", quantity: null, notes: null }] });

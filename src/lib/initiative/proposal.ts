/**
 * "Start an initiative": the AI's structured proposal, its validation (strict JSON, checked with Zod), and the
 * mapping from the items the owner approved to database records (one batch, saved in one transaction by
 * public.insert_record_batch). Pure functions: no database access, so they are unit tested
 * (src/lib/initiative/proposal.test.ts).
 *
 * Commitment rule: only pipeline next actions, milestones, daily targets, and reviews are commitments. So a recurring
 * task is a commitment only when it is a review ("review": true and the title says review); milestones get a
 * commitment; a target counts as a commitment; everything else is a regular task.
 */
import { z } from "zod";
import { METRICS } from "@/lib/metrics-list";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD form");
const text = (max: number) => z.string().trim().min(1, "must not be empty").max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();
const METRIC_KEYS = new Set(METRICS.map((m) => m.key));

export const GoalSchema = z.object({
  title: text(160),
  metric_key: z.string().nullish(),
  categories: z.array(z.string().trim().min(1)).max(4).nullish(),
  comparison: z.enum(["lte", "gte"]).default("lte"),
  target_value: z.number().finite().nullish(),
  deadline: dateStr,
});

export const MilestoneSchema = z.object({
  title: text(160),
  completion_test: text(300),
  due_date: dateStr,
  goal: z.number().int().min(0).max(2).default(0),
  target_value: z.number().finite().nullish(),
  options_if_missed: z.array(text(120)).min(1).max(4),
});

export const RecurringTaskSchema = z.object({
  title: text(120),
  cadence: z.enum(["daily", "weekly", "monthly"]),
  weekday: z.number().int().min(0).max(6).nullish(),
  day_of_month: z.number().int().min(1).max(28).nullish(),
  details: optText(500),
  review: z.boolean().default(false),
});

export const TargetSchema = z.object({
  name: text(80),
  period: z.enum(["day", "week"]),
  minimum_count: z.number().int().min(1).max(100),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
});

export const BudgetChangeSchema = z.object({
  category: text(80),
  new_monthly_amount: z.number().finite().min(0),
  estimated_monthly_savings: z.number().finite().min(0).nullish(),
});

export const ConditionSchema = z.object({
  name: text(120),
  metric_key: z.string(),
  categories: z.array(z.string().trim().min(1)).max(4).nullish(),
  operator: z.enum(["lt", "lte", "gt", "gte", "eq", "neq"]),
  threshold: z.number().finite(),
  check_from: dateStr.nullish(),
  action_task: text(160),
});

export const PlanDocumentSchema = z.object({ title: text(120), body: z.string().trim().min(1).max(12000) });

export const ChecklistSchema = z.object({
  name: text(80),
  reset_weekly: z.boolean().default(false),
  recurring_task: z.number().int().min(0).max(5).nullish(),
  items: z
    .array(z.object({ text: text(160), quantity: optText(40), notes: optText(200) }))
    .min(1)
    .max(80),
});

const ProposalObject = z.object({
  initiative: z.object({ name: text(80), purpose: text(500), parent_initiative: optText(80) }),
  goals: z.array(GoalSchema).min(1).max(3),
  milestones: z.array(MilestoneSchema).max(4).default([]),
  recurring_tasks: z.array(RecurringTaskSchema).max(6).default([]),
  target: TargetSchema.nullish(),
  budget_change: BudgetChangeSchema.nullish(),
  decision_condition: ConditionSchema.nullish(),
  plan_document: PlanDocumentSchema.nullish(),
  checklists: z.array(ChecklistSchema).max(4).default([]),
  estimated_monthly_savings: z.number().finite().min(0).nullish(),
});

/**
 * What the owner may approve (step-by-step setup and the review screen): the AI's rules, except that a purpose and
 * goals are optional, so an initiative added manually can be approved with only a name.
 */
const ApprovalObject = ProposalObject.extend({
  initiative: z.object({ name: text(80), purpose: z.string().trim().max(500).default(""), parent_initiative: optText(80) }),
  goals: z.array(GoalSchema).max(3),
});

function refineProposal(p: z.infer<typeof ApprovalObject>, ctx: z.RefinementCtx) {
  p.goals.forEach((g, i) => {
    if (g.metric_key && !METRIC_KEYS.has(g.metric_key)) ctx.addIssue({ code: "custom", path: ["goals", i, "metric_key"], message: `unknown measured number "${g.metric_key}"` });
    if (g.metric_key?.startsWith("category_") && !g.categories?.length) ctx.addIssue({ code: "custom", path: ["goals", i, "categories"], message: "a category measured number needs categories" });
  });
  p.milestones.forEach((m, i) => {
    if (m.goal >= Math.max(1, p.goals.length)) ctx.addIssue({ code: "custom", path: ["milestones", i, "goal"], message: "goal index out of range" });
  });
  p.recurring_tasks.forEach((t, i) => {
    if (t.cadence === "weekly" && (t.weekday === null || t.weekday === undefined)) ctx.addIssue({ code: "custom", path: ["recurring_tasks", i, "weekday"], message: "a weekly task needs a weekday (0 = Sunday)" });
  });
  p.checklists.forEach((c, i) => {
    if (c.recurring_task !== null && c.recurring_task !== undefined && c.recurring_task >= p.recurring_tasks.length) {
      ctx.addIssue({ code: "custom", path: ["checklists", i, "recurring_task"], message: "recurring task index out of range" });
    }
  });
  const dc = p.decision_condition;
  if (dc && !METRIC_KEYS.has(dc.metric_key)) ctx.addIssue({ code: "custom", path: ["decision_condition", "metric_key"], message: `unknown measured number "${dc.metric_key}"` });
}

export const ProposalSchema = ProposalObject.superRefine(refineProposal);
export const ApprovalSchema = ApprovalObject.superRefine(refineProposal);

export type Proposal = z.infer<typeof ProposalSchema>;

/** Readable list of what was wrong, for the retry message to the AI and for the owner. */
export function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "reply"}: ${i.message}`)
    .join("; ");
}

/** Validates the AI's reply (already parsed from JSON). */
export function validateProposal(value: unknown): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  const r = ProposalSchema.safeParse(value);
  return r.success ? { ok: true, proposal: r.data } : { ok: false, error: issuesText(r.error) };
}

/** Validates what the owner approves (purpose and goals optional; see ApprovalSchema). */
export function validateForApproval(value: unknown): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  const r = ApprovalSchema.safeParse(value);
  return r.success ? { ok: true, proposal: r.data as Proposal } : { ok: false, error: issuesText(r.error) };
}

/** Which items the owner keeps. The initiative itself is always created. */
export type Include = {
  goals: boolean[];
  milestones: boolean[];
  recurring_tasks: boolean[];
  target: boolean;
  budget_change: boolean;
  decision_condition: boolean;
  plan_document: boolean;
  checklists: boolean[];
};

export function includeAll(p: Proposal): Include {
  return {
    goals: p.goals.map(() => true),
    milestones: p.milestones.map(() => true),
    recurring_tasks: p.recurring_tasks.map(() => true),
    target: !!p.target,
    budget_change: !!p.budget_change,
    decision_condition: !!p.decision_condition,
    plan_document: !!p.plan_document,
    checklists: p.checklists.map(() => true),
  };
}

export const IncludeSchema = z.object({
  goals: z.array(z.boolean()),
  milestones: z.array(z.boolean()),
  recurring_tasks: z.array(z.boolean()),
  target: z.boolean(),
  budget_change: z.boolean(),
  decision_condition: z.boolean(),
  plan_document: z.boolean(),
  checklists: z.array(z.boolean()),
});

export type Category = { id: string; name: string; kind?: string | null };

const FOOD_WORDS = /\b(food|grocer|meal|cook|kitchen)/i;

/**
 * The existing category for a name the AI gave: exact name, then a name that contains it (or the other way around),
 * then food words to Groceries. Expense categories only. Null when nothing fits.
 */
export function matchCategory(name: string | null | undefined, categories: Category[]): Category | null {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const expense = categories.filter((c) => !c.kind || c.kind === "expense");
  const exact = expense.find((c) => c.name.toLowerCase() === n);
  if (exact) return exact;
  const partial = expense.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
  if (partial) return partial;
  if (FOOD_WORDS.test(n)) return expense.find((c) => /grocer/i.test(c.name)) ?? expense.find((c) => /food/i.test(c.name)) ?? null;
  return null;
}

/** "Weekly meal plan" or, when that name is used, "Weekly meal plan (2)", "(3)", ... */
export function uniqueName(name: string, existing: string[]): string {
  const used = new Set(existing.map((e) => e.trim().toLowerCase()));
  if (!used.has(name.trim().toLowerCase())) return name.trim();
  for (let i = 2; i < 100; i++) {
    const n = `${name.trim()} (${i})`;
    if (!used.has(n.toLowerCase())) return n;
  }
  return `${name.trim()} (${Date.now()})`;
}

/** Monthly savings from a new budget amount: current monthly spending minus the new amount, never below 0. */
export function budgetSavings(currentMonthly: number | null | undefined, newMonthly: number): number {
  const c = Number(currentMonthly ?? 0);
  return Math.max(0, Math.round((c - newMonthly) * 100) / 100);
}

/** A recurring task is a commitment only when it is a scheduled review (commitment rule). */
export function isReviewCommitment(t: { title: string; review?: boolean | null }): boolean {
  return !!t.review && /\breview\b/i.test(t.title);
}

export type Setup = {
  today: string;
  initiatives: { id: string; name: string }[];
  categories: Category[];
  budgetId: string | null;
  budgetLines: { id: string; category_id: string; current_monthly: number; target_monthly: number }[];
  /** Average monthly spending per category id (last 3 full months). */
  categorySpend: Record<string, number>;
  existingTargetNames: string[];
};

export type Batch = { table: string; op?: "insert" | "update"; rows: Record<string, unknown>[] };

export type MappedPlan = {
  initiativeId: string;
  initiativeName: string;
  batches: Batch[];
  counts: Record<string, number>;
  estimatedMonthlySavings: number | null;
  warnings: string[];
};

const metricParams = (cats: string[] | null | undefined, categories: Category[]) => {
  if (!cats?.length) return null;
  const names = cats.map((c) => matchCategory(c, categories)?.name ?? c);
  return { categories: [...new Set(names)] };
};

/**
 * Turns the approved items into records, all linked to the new initiative (foreign keys and record_links).
 * `newId` makes record ids (crypto.randomUUID in the app), so records can refer to each other inside one batch.
 */
export function mapProposalToBatches(p: Proposal, inc: Include, setup: Setup, newId: () => string): MappedPlan {
  const warnings: string[] = [];
  const batches: Batch[] = [];
  const add = (table: string, rows: Record<string, unknown>[], op: "insert" | "update" = "insert") => {
    if (rows.length) batches.push({ table, op, rows });
  };
  const links: Record<string, unknown>[] = [];
  const link = (fromType: string, fromId: string, toType: string, toId: string, relation: string) =>
    links.push({ id: newId(), from_type: fromType, from_id: fromId, to_type: toType, to_id: toId, relation });

  // Initiative
  const initiativeId = newId();
  const parent = p.initiative.parent_initiative
    ? setup.initiatives.find((i) => i.name.toLowerCase() === String(p.initiative.parent_initiative).trim().toLowerCase()) ?? null
    : null;
  if (p.initiative.parent_initiative && !parent) warnings.push(`"${p.initiative.parent_initiative}" is not an initiative, so the new initiative has no parent.`);
  const initiativeName = uniqueName(p.initiative.name, setup.initiatives.map((i) => i.name));
  add("initiatives", [{ id: initiativeId, name: initiativeName, description: p.initiative.purpose, sort_order: 20, is_active: true, parent_initiative_id: parent?.id ?? null }]);
  if (parent) link("initiatives", parent.id, "initiatives", initiativeId, "includes");

  // Goals
  const goalIds: (string | null)[] = p.goals.map((g, i) => (inc.goals[i] ? newId() : null));
  add(
    "goals",
    p.goals.flatMap((g, i) => {
      const id = goalIds[i];
      if (!id) return [];
      link("initiatives", initiativeId, "goals", id, "goal");
      return [{
        id,
        initiative_id: initiativeId,
        title: g.title,
        metric_key: g.metric_key ?? null,
        metric_params: metricParams(g.categories, setup.categories),
        comparison: g.comparison,
        target_value: g.target_value ?? null,
        deadline: g.deadline,
        status: "active",
      }];
    }),
  );
  const firstGoal = goalIds.find((g) => g) ?? null;

  // Milestones, their options if missed, and their commitments
  const msRows: Record<string, unknown>[] = [];
  const optRows: Record<string, unknown>[] = [];
  const commitRows: Record<string, unknown>[] = [];
  p.milestones.forEach((m, i) => {
    if (!inc.milestones[i]) return;
    const goalId = goalIds[m.goal] ?? firstGoal;
    if (!goalId) {
      warnings.push(`Milestone "${m.title}" was not created: every milestone belongs to a goal, and no goal was selected.`);
      return;
    }
    const id = newId();
    msRows.push({ id, goal_id: goalId, title: m.title, completion_test: m.completion_test, target_value: m.target_value ?? null, due_date: m.due_date, status: msRows.length ? "planned" : "active", proof_type: "number", sort_order: i + 1 });
    m.options_if_missed.forEach((label, j) => optRows.push({ id: newId(), milestone_id: id, label, sort_order: j + 1 }));
    commitRows.push({ id: newId(), title: m.title, record_type: "milestones", record_id: id, due_date: m.due_date, original_due_date: m.due_date, status: "open" });
    link("initiatives", initiativeId, "milestones", id, "milestone");
  });
  add("milestones", msRows);
  add("milestone_options", optRows);

  // Recurring tasks
  const templateIds: (string | null)[] = p.recurring_tasks.map((t, i) => (inc.recurring_tasks[i] ? newId() : null));
  add(
    "task_templates",
    p.recurring_tasks.flatMap((t, i) => {
      const id = templateIds[i];
      if (!id) return [];
      link("initiatives", initiativeId, "task_templates", id, "recurring task");
      return [{
        id,
        title: t.title,
        description: t.details ?? null,
        cadence: t.cadence,
        weekday: t.cadence === "weekly" ? t.weekday ?? 0 : null,
        day_of_month: t.cadence === "monthly" ? t.day_of_month ?? 1 : null,
        initiative_id: initiativeId,
        is_commitment: isReviewCommitment(t),
        is_active: true,
      }];
    }),
  );

  // Target (counted with +1 taps; a target counts as a commitment)
  if (p.target && inc.target) {
    const id = newId();
    const name = uniqueName(p.target.name, setup.existingTargetNames);
    add("targets", [{
      id,
      name,
      initiative_id: initiativeId,
      period: p.target.period,
      minimum_count: p.target.minimum_count,
      active_weekdays: p.target.period === "day" ? (p.target.weekdays?.length ? [...new Set(p.target.weekdays)].sort() : [1, 2, 3, 4, 5]) : [0, 1, 2, 3, 4, 5, 6],
      count_source: "manual",
      is_commitment: true,
      show_to_partners: false,
      active: true,
      start_date: setup.today,
      sort_order: 20,
    }]);
    link("initiatives", initiativeId, "targets", id, "target");
  }

  // Budget target change (Finance, Budget)
  let estimated: number | null = p.estimated_monthly_savings ?? null;
  if (p.budget_change && inc.budget_change) {
    const cat = matchCategory(p.budget_change.category, setup.categories);
    if (!cat) {
      warnings.push(`No budget change was made: no expense category matches "${p.budget_change.category}".`);
    } else {
      let budgetId = setup.budgetId;
      if (!budgetId) {
        budgetId = newId();
        add("budgets", [{ id: budgetId, name: "Monthly budget", is_active: true }]);
      }
      const spend = setup.categorySpend[cat.id] ?? null;
      const line = setup.budgetLines.find((l) => l.category_id === cat.id) ?? null;
      const lineId = line?.id ?? newId();
      if (line) add("budget_lines", [{ id: line.id, target_monthly: p.budget_change.new_monthly_amount }], "update");
      else add("budget_lines", [{ id: lineId, budget_id: budgetId, category_id: cat.id, current_monthly: Math.round(spend ?? p.budget_change.new_monthly_amount), target_monthly: p.budget_change.new_monthly_amount }]);
      link("initiatives", initiativeId, "budget_lines", lineId, "budget target");
      const computed = spend !== null ? budgetSavings(spend, p.budget_change.new_monthly_amount) : null;
      estimated = computed ?? p.budget_change.estimated_monthly_savings ?? estimated;
    }
  }

  // Decision condition
  if (p.decision_condition && inc.decision_condition) {
    const dc = p.decision_condition;
    const id = newId();
    add("decision_conditions", [{
      id,
      initiative_id: initiativeId,
      name: dc.name,
      metric_key: dc.metric_key,
      metric_params: metricParams(dc.categories, setup.categories),
      operator: dc.operator,
      threshold: dc.threshold,
      check_from: dc.check_from ?? null,
      actions: [{ type: "create_task", title: dc.action_task }, { type: "create_alert", message: `${dc.name}: the condition is met.` }],
      is_active: true,
    }]);
    link("initiatives", initiativeId, "decision_conditions", id, "decision condition");
  }

  // Plan document
  if (p.plan_document && inc.plan_document) {
    const id = newId();
    add("plan_documents", [{ id, initiative_id: initiativeId, title: p.plan_document.title, body: p.plan_document.body }]);
    link("initiatives", initiativeId, "plan_documents", id, "plan");
  }

  // Checklists (optionally tied to a recurring task; "reset each week" unchecks the items when that task is created)
  const clRows: Record<string, unknown>[] = [];
  const itemRows: Record<string, unknown>[] = [];
  p.checklists.forEach((c, i) => {
    if (!inc.checklists[i]) return;
    const id = newId();
    const templateId = c.recurring_task !== null && c.recurring_task !== undefined ? templateIds[c.recurring_task] ?? null : null;
    if (c.reset_weekly && !templateId) warnings.push(`"${c.name}" resets each week only with its recurring task; it was saved without the weekly reset.`);
    clRows.push({ id, name: c.name, initiative_id: initiativeId, related_type: "initiatives", related_id: initiativeId, task_template_id: templateId, reset_weekly: c.reset_weekly && !!templateId, sort_order: i + 1 });
    c.items.forEach((it, j) => itemRows.push({ id: newId(), checklist_id: id, text: it.text, quantity: it.quantity ?? null, notes: it.notes ?? null, checked: false, sort_order: j + 1 }));
    link("initiatives", initiativeId, "checklists", id, "checklist");
    if (templateId) link("task_templates", templateId, "checklists", id, "checklist");
  });
  add("checklists", clRows);
  add("checklist_items", itemRows);

  add("commitments", commitRows);
  add("record_links", links);

  const counts: Record<string, number> = {};
  for (const b of batches) counts[b.table] = (counts[b.table] ?? 0) + b.rows.length;
  return { initiativeId, initiativeName, batches, counts, estimatedMonthlySavings: estimated, warnings };
}

/** One line per created record type, for the success message (example: "2 goals, 1 checklist (24 items)"). */
export function describeCounts(counts: Record<string, number>): string {
  const label: Record<string, [string, string]> = {
    goals: ["goal", "goals"],
    milestones: ["milestone", "milestones"],
    task_templates: ["recurring task", "recurring tasks"],
    targets: ["target", "targets"],
    budget_lines: ["budget target", "budget targets"],
    decision_conditions: ["decision condition", "decision conditions"],
    plan_documents: ["plan document", "plan documents"],
    checklists: ["checklist", "checklists"],
  };
  const parts = Object.entries(label)
    .filter(([t]) => counts[t])
    .map(([t, [one, many]]) => `${counts[t]} ${counts[t] === 1 ? one : many}${t === "checklists" && counts.checklist_items ? ` (${counts.checklist_items} items)` : ""}`);
  return parts.length ? parts.join(", ") : "the initiative only";
}

/**
 * Instructions for the AI (the JSON it must return). The marker "TASK: initiative_proposal" lets the local test
 * stand-in (dev-tools/mock-supabase.mjs) recognize the request.
 */
export function proposalPrompt(input: { description: string; today: string; initiatives: string[]; categories: { name: string; monthly: number | null }[]; weeklyReviewDay: number }): string {
  return `TASK: initiative_proposal
Bram wants to start an initiative. His words: """${input.description.slice(0, 2000)}"""
Today is ${input.today}. Existing initiatives: ${input.initiatives.join(", ")}.
Expense categories with average monthly spending (last 3 full months): ${input.categories.map((c) => `${c.name} ${c.monthly === null ? "no data" : `$${Math.round(c.monthly)}`}`).join(", ")}.
Return ONLY one JSON object (no text before or after) with these keys:
{
  "initiative": {"name": "short name", "purpose": "one or two sentences", "parent_initiative": "name of an existing initiative it belongs under, or null"},
  "goals": [1 to 3 of {"title": "measured goal with number and date", "metric_key": "one of: ${METRICS.map((m) => m.key).join(", ")}", "categories": ["category names, only for category_ measured numbers"], "comparison": "lte" or "gte", "target_value": number, "deadline": "YYYY-MM-DD"}],
  "milestones": [0 to 4 of {"title": "...", "completion_test": "measurable test", "due_date": "YYYY-MM-DD", "goal": index of its goal (0 based), "target_value": number or null, "options_if_missed": ["2 or 3 options written now, for example Extend 30 days"]}],
  "recurring_tasks": [0 to 6 of {"title": "...", "cadence": "daily" | "weekly" | "monthly", "weekday": 0 to 6 (0 = Sunday, weekly only), "day_of_month": 1 to 28 (monthly only), "details": "short", "review": false}],
  "target": null or {"name": "...", "period": "day" | "week", "minimum_count": number, "weekdays": [0 to 6] for day targets},
  "budget_change": null or {"category": "existing category name", "new_monthly_amount": number, "estimated_monthly_savings": number},
  "decision_condition": null or {"name": "...", "metric_key": "...", "categories": [...], "operator": "lt" | "lte" | "gt" | "gte", "threshold": number, "check_from": "YYYY-MM-DD" or null, "action_task": "task created when the condition is met"},
  "plan_document": null or {"title": "...", "body": "markdown"},
  "checklists": [0 to 4 of {"name": "...", "reset_weekly": true or false, "recurring_task": index of the recurring task it goes with, or null, "items": [{"text": "...", "quantity": "short or null", "notes": "short or null"}]}],
  "estimated_monthly_savings": number or null
}
Rules:
- Commitments are only milestones, targets, and reviews. Set "review": true only for a recurring review task; every other recurring task is a regular task.
- Weekly tasks need a weekday. Bram's weekly review day is ${input.weeklyReviewDay} (0 = Sunday).
- Use existing category names. Base savings on the spending numbers above.
- The plan document body follows the output format: bulleted outline, bold lead-ins, short lines, no headings with "#", no em dashes.
- Dates are after ${input.today}.`;
}

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { budgetSavings, describeCounts, includeAll, isReviewCommitment, mapProposalToBatches, matchCategory, uniqueName, validateProposal, type Proposal, type Setup } from "./proposal";

const require = createRequire(import.meta.url);
const { mealPlanProposal } = require("../../../dev-tools/fixtures/meal-plan.cjs") as { mealPlanProposal: (today: string) => unknown };

const TODAY = "2026-10-27";
const categories = [
  { id: "c-groc", name: "Groceries", kind: "expense" },
  { id: "c-dine", name: "Dining", kind: "expense" },
  { id: "c-stor", name: "Storage", kind: "expense" },
  { id: "c-cons", name: "Consulting Income", kind: "income" },
];
const setup = (over: Partial<Setup> = {}): Setup => ({
  today: TODAY,
  initiatives: [{ id: "i-pf", name: "Personal Finance" }, { id: "i-acq", name: "Acquisition Search" }],
  categories,
  budgetId: "b-1",
  budgetLines: [],
  categorySpend: { "c-groc": 980, "c-dine": 520 },
  existingTargetNames: ["Network outreach"],
  ...over,
});
let n = 0;
const ids = () => `id-${++n}`;

function meal(): Proposal {
  const r = validateProposal(mealPlanProposal(TODAY));
  if (!r.ok) throw new Error(r.error);
  return r.proposal;
}

describe("Start an initiative: proposal validation (strict JSON)", () => {
  it("accepts the meal plan proposal", () => {
    const p = meal();
    expect(p.initiative.name).toBe("Weekly meal plan");
    expect(p.checklists[0].items.length).toBeGreaterThan(20);
    expect(p.recurring_tasks.map((t) => t.weekday)).toEqual([6, 0]);
  });

  it("rejects missing goals, bad dates, and unknown measured numbers with readable reasons", () => {
    const base = mealPlanProposal(TODAY) as Record<string, unknown>;
    const noGoals = validateProposal({ ...base, goals: [] });
    expect(noGoals.ok).toBe(false);
    const badDate = validateProposal({ ...base, goals: [{ title: "x", metric_key: null, comparison: "lte", target_value: 1, deadline: "next month" }] });
    expect(!badDate.ok && badDate.error).toMatch(/goals\.0\.deadline/);
    const badMetric = validateProposal({ ...base, goals: [{ title: "x", metric_key: "food_score", comparison: "lte", target_value: 1, deadline: "2027-01-01" }] });
    expect(!badMetric.ok && badMetric.error).toMatch(/unknown measured number/);
  });

  it("rejects a weekly task without a weekday and out-of-range indexes", () => {
    const base = mealPlanProposal(TODAY) as Record<string, unknown>;
    const r1 = validateProposal({ ...base, recurring_tasks: [{ title: "Shop", cadence: "weekly", review: false }] });
    expect(!r1.ok && r1.error).toMatch(/weekday/);
    const r2 = validateProposal({ ...base, milestones: [{ title: "m", completion_test: "t", due_date: "2027-01-01", goal: 2, options_if_missed: ["Extend"] }] });
    expect(!r2.ok && r2.error).toMatch(/goal index/);
  });

  it("rejects text that is not an object (the AI reply must be the JSON object)", () => {
    expect(validateProposal("here is your plan").ok).toBe(false);
    expect(validateProposal(null).ok).toBe(false);
  });
});

describe("Start an initiative: mapping approved items to records", () => {
  it("creates the meal plan records, all linked to the new initiative under Personal Finance", () => {
    const p = meal();
    const m = mapProposalToBatches(p, includeAll(p), setup(), ids);
    const by = (t: string) => m.batches.filter((b) => b.table === t).flatMap((b) => b.rows);
    const [init] = by("initiatives");
    expect(init).toMatchObject({ name: "Weekly meal plan", parent_initiative_id: "i-pf" });
    expect(by("goals")[0]).toMatchObject({ initiative_id: m.initiativeId, metric_key: "category_spending_last_month", metric_params: { categories: ["Groceries", "Dining"] }, target_value: 1000 });
    expect(by("milestones")[0]).toMatchObject({ goal_id: by("goals")[0].id, status: "active" });
    expect(by("milestone_options")).toHaveLength(3);
    // Commitment rule: the milestone is a commitment; the shop and cook tasks are regular tasks; the target is a commitment.
    expect(by("commitments")).toEqual([expect.objectContaining({ record_type: "milestones", record_id: by("milestones")[0].id })]);
    expect(by("task_templates").map((t) => [t.title, t.weekday, t.is_commitment])).toEqual([["Shop for the week's groceries", 6, false], ["Cook meals for the week", 0, false]]);
    expect(by("targets")[0]).toMatchObject({ count_source: "manual", is_commitment: true, period: "week", start_date: TODAY, active_weekdays: [0, 1, 2, 3, 4, 5, 6] });
    // The grocery checklist goes with the Saturday shop task and resets each week.
    const [list] = by("checklists");
    expect(list).toMatchObject({ name: "Grocery list", reset_weekly: true, task_template_id: by("task_templates")[0].id, initiative_id: m.initiativeId });
    expect(by("checklist_items").every((i) => i.checklist_id === list.id && i.checked === false)).toBe(true);
    // Budget: a new Groceries line (current = 3-month average), and savings from the real numbers: 980 - 700 = 280.
    expect(by("budget_lines")[0]).toMatchObject({ budget_id: "b-1", category_id: "c-groc", current_monthly: 980, target_monthly: 700 });
    expect(m.estimatedMonthlySavings).toBe(280);
    expect(by("plan_documents")[0].body).toContain("Breakfast plan");
    // Links: from the parent and to every created record type.
    const links = by("record_links");
    expect(links).toContainEqual(expect.objectContaining({ from_type: "initiatives", from_id: "i-pf", to_id: m.initiativeId }));
    for (const t of ["goals", "milestones", "task_templates", "targets", "budget_lines", "plan_documents", "checklists"]) {
      expect(links.some((l) => l.from_id === m.initiativeId && l.to_type === t)).toBe(true);
    }
    expect(links).toContainEqual(expect.objectContaining({ from_type: "task_templates", to_type: "checklists", to_id: list.id }));
    // Batch order: a record is inserted after the records it refers to.
    const order = m.batches.map((b) => b.table);
    expect(order.indexOf("initiatives")).toBe(0);
    expect(order.indexOf("task_templates")).toBeLessThan(order.indexOf("checklists"));
    expect(order.indexOf("checklists")).toBeLessThan(order.indexOf("checklist_items"));
    expect(order[order.length - 1]).toBe("record_links");
    expect(describeCounts(m.counts)).toContain("1 checklist (24 items)");
  });

  it("leaves out excluded items and updates an existing budget line instead of adding one", () => {
    const p = meal();
    const inc = includeAll(p);
    inc.checklists = [false];
    inc.target = false;
    inc.recurring_tasks = [true, false];
    const m = mapProposalToBatches(p, inc, setup({ budgetLines: [{ id: "bl-9", category_id: "c-groc", current_monthly: 900, target_monthly: 900 }] }), ids);
    const tables = m.batches.map((b) => b.table);
    expect(tables).not.toContain("checklists");
    expect(tables).not.toContain("targets");
    expect(m.batches.find((b) => b.table === "task_templates")?.rows).toHaveLength(1);
    const update = m.batches.find((b) => b.table === "budget_lines");
    expect(update).toMatchObject({ op: "update", rows: [{ id: "bl-9", target_monthly: 700 }] });
  });

  it("a milestone whose goal is excluded moves to the first selected goal, or is skipped with a warning", () => {
    const p = meal();
    p.goals.push({ title: "Second goal", metric_key: null, categories: null, comparison: "gte", target_value: 4, deadline: "2027-02-01" });
    const inc = includeAll(p);
    inc.goals = [false, true];
    const m = mapProposalToBatches(p, inc, setup(), ids);
    const goal = m.batches.find((b) => b.table === "goals")!.rows[0];
    expect(m.batches.find((b) => b.table === "milestones")!.rows[0].goal_id).toBe(goal.id);
    inc.goals = [false, false];
    const none = mapProposalToBatches(p, inc, setup(), ids);
    expect(none.batches.some((b) => b.table === "milestones")).toBe(false);
    expect(none.warnings.join(" ")).toMatch(/belongs to a goal/);
  });

  it("creates a budget when there is none and gives the initiative a unique name", () => {
    const p = meal();
    const m = mapProposalToBatches(p, includeAll(p), setup({ budgetId: null, initiatives: [{ id: "i-pf", name: "Personal Finance" }, { id: "i-x", name: "Weekly meal plan" }] }), ids);
    expect(m.initiativeName).toBe("Weekly meal plan (2)");
    const budget = m.batches.find((b) => b.table === "budgets")!.rows[0];
    expect(m.batches.find((b) => b.table === "budget_lines")!.rows[0].budget_id).toBe(budget.id);
  });

  it("a checklist marked to reset weekly without its recurring task is saved without the reset", () => {
    const p = meal();
    const inc = includeAll(p);
    inc.recurring_tasks = [false, true];
    const m = mapProposalToBatches(p, inc, setup(), ids);
    expect(m.batches.find((b) => b.table === "checklists")!.rows[0]).toMatchObject({ reset_weekly: false, task_template_id: null });
    expect(m.warnings.join(" ")).toMatch(/resets each week only/);
  });

  it("only review tasks can be commitments", () => {
    expect(isReviewCommitment({ title: "Weekly meal plan review", review: true })).toBe(true);
    expect(isReviewCommitment({ title: "Cook meals for the week", review: true })).toBe(false);
    expect(isReviewCommitment({ title: "Monthly review", review: false })).toBe(false);
  });

  it("matches categories by name, partial name, and food words", () => {
    expect(matchCategory("groceries", categories)?.id).toBe("c-groc");
    expect(matchCategory("Food", categories)?.id).toBe("c-groc");
    expect(matchCategory("Storage units", categories)?.id).toBe("c-stor");
    expect(matchCategory("Consulting Income", categories)).toBeNull();
    expect(matchCategory("Pets", categories)).toBeNull();
  });

  it("savings math and names", () => {
    expect(budgetSavings(980, 700)).toBe(280);
    expect(budgetSavings(600, 700)).toBe(0);
    expect(uniqueName("Plan", ["plan", "Plan (2)"])).toBe("Plan (3)");
  });
});

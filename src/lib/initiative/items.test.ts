import { describe, expect, it } from "vitest";
import { budgetFacts, cadenceText, checklistFacts, clip, defaultItemOpen, goalFacts, itemsOpen, LONG_MAX, milestoneFacts, planFacts, shiftAfterRemove, taskFacts } from "./items";
import { emptyProposal, itemIssue, itemsNeedingAttention, newGoal, newMilestone, type DraftState } from "./draft";
import { includeAll } from "./proposal";

const byLabel = (facts: { label: string; value: string }[]) => Object.fromEntries(facts.map((f) => [f.label, f.value]));

describe("collapsed item summary: cutting text to one line", () => {
  it("keeps short text, collapses spaces and line breaks", () => {
    expect(clip("  4 recipes\n chosen  ", 80)).toBe("4 recipes chosen");
    expect(clip(null, 10)).toBe("");
  });
  it("cuts long text at a word break with ...", () => {
    const t = "4 recipes chosen for the week and the grocery list written from them before Saturday morning shopping";
    const c = clip(t, 40);
    expect(c.endsWith("...")).toBe(true);
    expect(c.length).toBeLessThanOrEqual(40);
    expect(c).toBe("4 recipes chosen for the week and the...");
  });
  it("cuts inside a long word when there is no break close to the end", () => {
    expect(clip("Supercalifragilisticexpialidocious", 12)).toBe("Supercali...");
  });
  it("drops trailing punctuation before ...", () => {
    expect(clip("Shop once, cook once, eat all week long", 16)).toBe("Shop once...");
  });
});

describe("collapsed item summary: which facts show", () => {
  it("milestone: due date, goal number, options count, then the test (long, cut)", () => {
    const m = { ...newMilestone("2026-10-01"), title: "Menu chosen", due_date: "2026-10-31", goal: 2, completion_test: "x ".repeat(120), options_if_missed: ["Extend 30 days", "", "Drop it"] };
    const f = milestoneFacts(m, 3);
    expect(f.map((x) => x.label)).toEqual(["Due", "Goal", "If missed", "Test"]);
    const v = byLabel(f);
    expect(v.Due).toBe("Oct 31");
    expect(v.Goal).toBe("3");
    expect(v["If missed"]).toBe("2 options");
    expect(v.Test.length).toBeLessThanOrEqual(LONG_MAX);
    expect(f[3].size).toBe("long");
  });
  it("missing values say Not set, so every row shows the same facts in the same place", () => {
    const m = { ...newMilestone("2026-10-01"), due_date: "", completion_test: "", options_if_missed: [] };
    expect(byLabel(milestoneFacts(m, 0))).toEqual({ Due: "Not set", Goal: "Not set", "If missed": "Not set", Test: "Not set" });
    // A goal number past the end points at the last goal (as the select shows it).
    expect(byLabel(milestoneFacts({ ...m, goal: 2 }, 1)).Goal).toBe("1");
  });
  it("goal: deadline, target in its unit, measured number", () => {
    const g = { ...newGoal("2026-10-01"), deadline: "2027-03-01", metric_key: "avg_monthly_spending", target_value: 700, comparison: "lte" as const };
    const v = byLabel(goalFacts(g));
    expect(v.Deadline).toBe("Mar 1");
    expect(v.Target).toMatch(/^At or below/);
    expect(byLabel(goalFacts(newGoal("2026-10-01"))).Measured).toBe("Not measured automatically");
    expect(byLabel(goalFacts(newGoal("2026-10-01"))).Target).toBe("Not set");
  });
  it("recurring task: when it repeats, commitment or regular, details", () => {
    expect(cadenceText({ cadence: "weekly", weekday: 6, day_of_month: null })).toBe("Weekly, Saturday");
    expect(cadenceText({ cadence: "monthly", weekday: null, day_of_month: 15 })).toBe("Monthly, day 15");
    expect(cadenceText({ cadence: "daily", weekday: null, day_of_month: null })).toBe("Daily");
    const v = byLabel(taskFacts({ title: "Weekly review", cadence: "weekly", weekday: 0, day_of_month: null, details: null, review: true }, true));
    expect(v).toEqual({ Repeats: "Weekly, Sunday", Kind: "Commitment", Details: "Not set" });
  });
  it("checklist: items with text, weekly reset, the recurring task it goes with", () => {
    const c = { name: "Groceries", reset_weekly: true, recurring_task: 0, items: [{ text: "Eggs", quantity: null, notes: null }, { text: " ", quantity: null, notes: null }] };
    expect(byLabel(checklistFacts(c, ["Shop for the week's groceries"]))).toEqual({ Items: "1", Resets: "Each week", "With task": "Shop for the week's groceries" });
    expect(byLabel(checklistFacts({ ...c, recurring_task: null, reset_weekly: false }, [])).Resets).toBe("No");
  });
  it("budget change and plan", () => {
    expect(byLabel(budgetFacts({ category: "Groceries", new_monthly_amount: 700, estimated_monthly_savings: null }, 1512.4))).toEqual({ "New amount": "$700 a month", "Spending now": "$1,512 a month" });
    expect(byLabel(planFacts({ title: "Plan", body: "\n- **Sunday:** cook\n- Shop Saturday" }))).toEqual({ Lines: "2", Starts: "Sunday: cook" });
  });
});

describe("which items start open", () => {
  it("the first item of a list of 1 or 2; none of a longer list", () => {
    expect([0, 1].map((i) => defaultItemOpen(i, 2))).toEqual([true, false]);
    expect(defaultItemOpen(0, 1)).toBe(true);
    expect([0, 1, 2].map((i) => defaultItemOpen(i, 3))).toEqual([false, false, false]);
  });
  it("an item with a problem opens; a choice on this page view wins; the saved choice beats the default", () => {
    const base = { count: 3, initialCount: 3, attention: [false, true, false], saved: null, changed: {} };
    expect(itemsOpen(base)).toEqual([false, true, false]);
    expect(itemsOpen({ ...base, saved: { "0": true, "1": false } })).toEqual([true, true, false]);
    expect(itemsOpen({ ...base, changed: { "1": false } })).toEqual([false, false, false]);
  });
  it("adding an item never closes the first one (defaults use the count when the list was shown)", () => {
    expect(itemsOpen({ count: 3, initialCount: 1, attention: [false, false, true], saved: null, changed: {} })).toEqual([true, false, true]);
  });
  it("removing an item moves the later items' state up one", () => {
    expect(shiftAfterRemove({ "0": true, "1": false, "2": true }, 1)).toEqual({ "0": true, "1": true });
    expect(shiftAfterRemove({ "0": true, x: false }, 0)).toEqual({});
  });
  it("items needing attention: included items with an empty required field", () => {
    const p = emptyProposal();
    p.goals.push({ ...newGoal("2026-10-27"), title: "Walk 3 times a week" });
    p.milestones.push({ ...newMilestone("2026-10-27"), title: "First month", completion_test: "12 walks logged" }, newMilestone("2026-10-27"), newMilestone("2026-10-27"));
    const s: DraftState = { proposal: p, include: includeAll(p) };
    s.include.milestones[2] = false;
    expect(itemsNeedingAttention(s, "milestones")).toEqual([false, true, false]);
    expect(itemIssue(s, "milestones", 1)).toMatch(/^Milestone 2:/);
    expect(itemIssue(s, "milestones", 9)).toBeNull();
    expect(itemsNeedingAttention(s, "goals")).toEqual([false]);
  });
});

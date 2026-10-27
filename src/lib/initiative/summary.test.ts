import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { includeAll, validateProposal, type Proposal } from "./proposal";
import { byDate, goalTargetText, groupRecurringByWeekday, planPreview, summaryCount, summaryFromProposal, targetRuleText } from "./summary";

const require = createRequire(import.meta.url);
const { mealPlanProposal } = require("../../../dev-tools/fixtures/meal-plan.cjs") as { mealPlanProposal: (today: string) => unknown };
const meal = (): Proposal => {
  const r = validateProposal(mealPlanProposal("2026-10-27"));
  if (!r.ok) throw new Error(r.error);
  return r.proposal;
};

describe("initiative summary: recurring tasks grouped by weekday", () => {
  const t = (title: string, cadence: string, weekday: number | null = null, dayOfMonth: number | null = null) => ({ title, cadence, weekday, dayOfMonth });
  it("orders Every day, then Monday to Sunday, then Monthly by day; leaves out empty days", () => {
    const groups = groupRecurringByWeekday([t("Cook", "weekly", 0), t("Shop", "weekly", 6), t("Check budget", "monthly", null, 15), t("Pay rent", "monthly", null, 1), t("Walk", "daily"), t("Plan", "weekly", 1), t("Prep", "weekly", 0)]);
    expect(groups.map((g) => g.label)).toEqual(["Every day", "Monday", "Saturday", "Sunday", "Monthly"]);
    expect(groups.find((g) => g.label === "Sunday")!.items.map((i) => i.title)).toEqual(["Cook", "Prep"]);
    expect(groups.find((g) => g.label === "Monthly")!.items.map((i) => i.title)).toEqual(["Pay rent", "Check budget"]);
  });
  it("returns nothing for no tasks", () => {
    expect(groupRecurringByWeekday([])).toEqual([]);
  });
});

describe("initiative summary: text helpers", () => {
  it("goal target in the measured number's unit", () => {
    expect(goalTargetText("category_spending_month", "lte", 700)).toBe("At or below $700");
    expect(goalTargetText("runway_months", "gte", 12)).toBe("At or above 12 months");
    expect(goalTargetText(null, "lte", null)).toBeNull();
  });
  it("target rule", () => {
    expect(targetRuleText("day", 3, [1, 2, 3, 4, 5])).toBe("3 per weekday");
    expect(targetRuleText("week", 5)).toBe("5 per week");
    expect(targetRuleText("day", 1, [])).toBe("1 per day");
    expect(targetRuleText("day", 2, [6, 0])).toBe("2 per day on Sun, Sat");
  });
  it("plan preview: first lines without markdown markers", () => {
    expect(planPreview("# Plan\n\n- **Shop:** Saturday\n- **Cook:** Sunday\n1. Breakfast\nMore\nLast", 4)).toEqual(["Plan", "Shop: Saturday", "Cook: Sunday", "Breakfast"]);
  });
  it("milestones in date order, no date last", () => {
    expect(byDate([{ due: "2027-02-01" }, { due: null }, { due: "2026-12-01" }]).map((m) => m.due)).toEqual(["2026-12-01", "2027-02-01", null]);
  });
});

describe("initiative summary from the draft", () => {
  it("lists only included items, each pointing at its fields, with savings from the budget change", () => {
    const p = meal();
    const inc = includeAll(p);
    const s = summaryFromProposal(p, inc, 980);
    expect(s.name).toBe("Weekly meal plan");
    expect(s.ref).toEqual({ kind: "field", anchor: "i-name" });
    expect(s.savings).toBe(980 - p.budget_change!.new_monthly_amount);
    expect(s.goals[0].ref).toEqual({ kind: "field", anchor: "g-title-0" });
    expect(s.recurring.map((r) => r.ref)).toEqual([{ kind: "field", anchor: "t-title-0" }, { kind: "field", anchor: "t-title-1" }]);
    expect(s.checklists[0].count).toBe(p.checklists[0].items.length);
    expect(s.plan?.preview.length).toBeGreaterThan(0);
    const all = summaryCount(s);
    inc.recurring_tasks[0] = false;
    inc.plan_document = false;
    const fewer = summaryFromProposal(p, inc, 980);
    expect(fewer.recurring.length).toBe(1);
    expect(fewer.plan).toBeNull();
    expect(summaryCount(fewer)).toBe(all - 2);
  });
  it("without spending data the AI's estimate is used", () => {
    const p = meal();
    const s = summaryFromProposal(p, includeAll(p), null);
    expect(s.savings).toBe(p.budget_change!.estimated_monthly_savings ?? p.estimated_monthly_savings ?? null);
  });
});

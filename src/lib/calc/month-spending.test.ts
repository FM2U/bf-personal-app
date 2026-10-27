import { describe, expect, it } from "vitest";
import { monthSpendingBreakdown } from "./month-spending";

describe("Home, This month: spending by week and top categories", () => {
  const tx = [
    { date: "2026-10-02", amount: -100, category_id: "g", account_id: "a" },
    { date: "2026-10-09", amount: -50, category_id: "d", account_id: "a" },
    { date: "2026-10-10", amount: -30, category_id: "g", account_id: "a" },
    { date: "2026-10-10", amount: 900, category_id: null, account_id: "a" },
    { date: "2026-10-11", amount: -500, category_id: "x", account_id: "a", is_transfer: true },
    { date: "2026-10-12", amount: -70, category_id: "s", account_id: "other" },
    { date: "2026-09-30", amount: -999, category_id: "g", account_id: "a" },
    { date: "2026-10-20", amount: -20, category_id: null, account_id: "a" },
  ];
  const r = monthSpendingBreakdown({ transactions: tx, accountIds: ["a"], today: "2026-10-20", budgetTotal: 3100, categoryNames: { g: "Groceries", d: "Dining" }, categoryBudgets: { g: 450 } });
  it("weeks of the month (days 1-7, 8-14, ...), weeks still ahead are empty, budget spread over the days", () => {
    expect(r.weeks.map((w) => w.label)).toEqual(["1-7", "8-14", "15-21", "22-28", "29-31"]);
    expect(r.weeks.map((w) => w.spent)).toEqual([100, 80, 20, null, null]);
    expect(r.weeks[0].budget).toBe(700);
    expect(r.weeks[4].budget).toBe(300);
    expect(r.weeks.find((w) => w.current)?.label).toBe("15-21");
  });
  it("top 3 categories with their budget (money out only, no transfers, runway accounts only)", () => {
    expect(r.categories).toEqual([
      { id: "g", name: "Groceries", spent: 130, budget: 450 },
      { id: "d", name: "Dining", spent: 50, budget: null },
      { id: null, name: "Not categorized", spent: 20, budget: null },
    ]);
  });
  it("no budget: no budget line", () => {
    const n = monthSpendingBreakdown({ transactions: [], accountIds: [], today: "2026-02-03", budgetTotal: 0, categoryNames: {}, categoryBudgets: {} });
    expect(n.weeks.map((w) => w.label)).toEqual(["1-7", "8-14", "15-21", "22-28"]);
    expect(n.weeks.every((w) => w.budget === null)).toBe(true);
  });
});

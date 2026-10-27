import { describe, expect, it } from "vitest";
import { analyzeSpending, buildIdeas, estimateSavings, ideasPrompt, ideaToProposal, ideaToReductionAction, MONTHS_IN_PERIOD, suppressedTargets, type IdeaReply } from "./ideas";
import { validateProposal } from "@/lib/initiative/proposal";

const TODAY = "2026-10-27";
const cats = [
  { id: "groc", name: "Groceries", kind: "expense" },
  { id: "stor", name: "Storage", kind: "expense" },
  { id: "soft", name: "Software and Subscriptions", kind: "expense", is_software: true },
  { id: "inc", name: "Consulting Income", kind: "income" },
];
const txns = [
  ...[5, 35, 65].flatMap((d, i) => [
    { id: `s${i}`, date: `2026-${String(8 + i).padStart(2, "0")}-${String(d % 28 || 1).padStart(2, "0")}`, amount: -385, category_id: "stor", merchant_name: "Sample Storage Co. Unit A", description: null },
    { id: `g${i}`, date: `2026-${String(8 + i).padStart(2, "0")}-10`, amount: -600, category_id: "groc", merchant_name: "Sample Grocery Market", description: null },
  ]),
  { id: "old", date: "2026-06-01", amount: -9999, category_id: "groc", merchant_name: "Too old", description: null },
  { id: "in1", date: "2026-10-15", amount: 4500, category_id: "inc", merchant_name: "Client", description: null },
  { id: "tr1", date: "2026-10-16", amount: -2000, category_id: null, merchant_name: "Transfer", description: null, is_transfer: true },
];
const series = [
  { id: "ser1", merchant_name: "Sample Storage Co. Unit A", frequency: "monthly", monthly_cost: 385, category_id: "stor", review_flag: false, review_status: "unreviewed", status: "active" },
  { id: "ser2", merchant_name: "Sample Design App", frequency: "monthly", monthly_cost: 54.99, category_id: "soft", review_flag: true, review_status: "unreviewed", status: "active" },
  { id: "ser3", merchant_name: "Old gym", frequency: "monthly", monthly_cost: 60, category_id: null, status: "ended" },
];

describe("savings ideas: spending analysis (last 90 days)", () => {
  const a = analyzeSpending({ txns, categories: cats, series, today: TODAY });
  const byKey = Object.fromEntries(a.candidates.map((c) => [c.key, c]));

  it("totals categories and merchants over 90 days and converts to monthly", () => {
    expect(byKey["category:groc"].total90).toBe(1800);
    expect(byKey["category:groc"].monthly).toBeCloseTo(1800 / MONTHS_IN_PERIOD, 1);
    expect(byKey["category:stor"].total90).toBe(1155);
    expect(byKey["category:inc"]).toBeUndefined(); // money in is not spending
    expect(a.candidates.some((c) => c.label === "Too old" || c.label === "Transfer")).toBe(false);
    expect(byKey["merchant:sample grocery market"].count).toBe(3);
  });

  it("lists active recurring charges with the unused-subscription flag", () => {
    expect(byKey["series:ser1"].monthly).toBe(385);
    expect(byKey["series:ser2"].unused).toBe(true);
    expect(byKey["series:ser1"].unused).toBe(false);
    expect(byKey["series:ser3"]).toBeUndefined();
  });
});

describe("savings ideas: the request lists unused subscriptions even when small", () => {
  it("adds unused-flag series beyond the 40 largest expenses", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `big${i}`, merchant_name: `Big ${i}`, frequency: "monthly", monthly_cost: 1000 - i, category_id: null, status: "active" }));
    const a = analyzeSpending({ txns: [], categories: cats, series: [...many, series[1]], today: TODAY });
    const prompt = ideasPrompt(a, new Set(["series:big0"]));
    expect(prompt).toContain("series:ser2");
    expect(prompt).not.toContain("series:big0");
    expect(prompt).not.toContain("series:big45");
  });
});

describe("savings ideas: estimate math", () => {
  it("computes savings from the real cost by method, with how it was estimated", () => {
    expect(estimateSavings(385, { method: "cancel" })).toEqual({ monthly: 385, basis: "Cancel it: the current cost is $385 per month (last 90 days)." });
    expect(estimateSavings(600, { method: "reduce_percent", percent: 25 }).monthly).toBe(150);
    expect(estimateSavings(600, { method: "reduce_to_amount", new_monthly_amount: 450 }).monthly).toBe(150);
    expect(estimateSavings(600, { method: "reduce_to_amount", new_monthly_amount: 800 }).monthly).toBe(0);
    const other = estimateSavings(100, { method: "other", monthly_amount: 250 });
    expect(other.monthly).toBe(100);
    expect(other.basis).toMatch(/held to the current cost/);
  });
});

describe("savings ideas: decline suppression window (90 days)", () => {
  it("suppresses targets declined in the last 90 days and targets with an open idea", () => {
    const s = suppressedTargets(
      [
        { target_key: "series:a", status: "declined", decided_at: "2026-08-01T10:00:00Z", created_at: "2026-07-30T10:00:00Z" }, // 87 days ago
        { target_key: "series:b", status: "declined", decided_at: "2026-07-28T10:00:00Z", created_at: "2026-07-20T10:00:00Z" }, // 91 days ago
        { target_key: "category:c,merchant:d", status: "later", decided_at: null, created_at: "2026-10-01T10:00:00Z" },
        { target_key: "series:e", status: "pending", decided_at: null, created_at: "2026-10-20T10:00:00Z" },
        { target_key: "series:f", status: "approved", decided_at: "2026-10-21T10:00:00Z", created_at: "2026-10-20T10:00:00Z" },
      ],
      TODAY,
    );
    expect([...s].sort()).toEqual(["category:c", "merchant:d", "series:a", "series:e"]);
  });

  it("buildIdeas drops suppressed, unknown, duplicate, and zero-savings ideas and keeps at most 3", () => {
    const a = analyzeSpending({ txns, categories: cats, series, today: TODAY });
    const reply: IdeaReply = {
      ideas: [
        { title: "Cancel the design app", target_keys: ["series:ser2"], estimate: { method: "cancel" }, effort: "low", steps: ["Open account settings", "Cancel the plan"] },
        { title: "Close storage unit A", target_keys: ["series:ser1"], estimate: { method: "cancel" }, effort: "medium", steps: ["Empty the unit", "Give notice"] },
        { title: "Unknown", target_keys: ["series:nope"], estimate: { method: "cancel" }, effort: "low", steps: ["a", "b"] },
        { title: "Again unit A", target_keys: ["series:ser1"], estimate: { method: "cancel" }, effort: "low", steps: ["a", "b"] },
        { title: "Groceries at the same cost", target_keys: ["category:groc"], estimate: { method: "reduce_percent", percent: 0 }, effort: "low", steps: ["a", "b"] },
      ],
    };
    const out = buildIdeas(reply, a.candidates, new Set(["series:ser2"]));
    expect(out.map((i) => i.title)).toEqual(["Close storage unit A"]);
    expect(out[0]).toMatchObject({ target_key: "series:ser1", recurring_series_id: "ser1", estimated_monthly_savings: 385, current_monthly_cost: 385 });
  });
});

describe("savings ideas: approve as an initiative or a reduction action", () => {
  const idea = { title: "Cut groceries by 25%", target_label: "Groceries", target_type: "category", category_name: "Groceries", current_monthly_cost: 600, estimated_monthly_savings: 150, estimate_basis: "Cut by 25%.", steps: ["Plan meals", "Shop once a week"] };

  it("makes a valid initiative proposal with a goal, a milestone, a budget change, a plan, and a steps checklist", () => {
    const p = ideaToProposal(idea, TODAY);
    const r = validateProposal(p);
    expect(r.ok).toBe(true);
    expect(p.goals[0]).toMatchObject({ metric_key: "category_spending_last_month", categories: ["Groceries"], target_value: 450 });
    expect(p.budget_change).toMatchObject({ category: "Groceries", new_monthly_amount: 450 });
    expect(p.checklists[0].items.map((i) => i.text)).toEqual(idea.steps);
  });

  it("an idea about a recurring charge has no category goal or budget change", () => {
    const p = ideaToProposal({ ...idea, target_type: "recurring_series", category_name: null }, TODAY);
    expect(validateProposal(p).ok).toBe(true);
    expect(p.goals[0].metric_key).toBeNull();
    expect(p.budget_change).toBeNull();
  });

  it("makes a reduction action with the owner's edits", () => {
    const row = ideaToReductionAction({ ...idea, recurring_series_id: "ser1", category_id: "groc" }, { deadline: "2026-12-01", projected_monthly_savings: 120 }, TODAY);
    expect(row).toMatchObject({ deadline: "2026-12-01", projected_monthly_savings: 120, status: "chosen", recurring_series_id: "ser1", chosen_suggestion: "1. Plan meals\n2. Shop once a week" });
    expect(ideaToReductionAction({ ...idea, recurring_series_id: null, category_id: null }, { deadline: "soon" }, TODAY).deadline).toBe("2026-11-26");
  });
});

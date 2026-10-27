import { describe, expect, it } from "vitest";
import { addDismissed, DISMISSED_MAX, goalSuggestion, homeSuggestion, overdueSuggestion, parseDismissed, pickSuggestion, pipelineSuggestion, savingsIdeasSuggestion, targetSuggestion, taskSuggestion, topPriority } from "./suggestions";

const ID = "3f2b8c1e-1234-4abc-9def-0123456789ab";
const money = (n: number) => `$${n}`;

describe("suggestion lines: dismissal", () => {
  it("remembers dismissed keys without repeats, newest last, and keeps at most DISMISSED_MAX", () => {
    let raw = "";
    raw = addDismissed(raw, "a:1");
    raw = addDismissed(raw, "b:2");
    raw = addDismissed(raw, "a:1");
    expect(parseDismissed(raw)).toEqual(["b:2", "a:1"]);
    for (let i = 0; i < DISMISSED_MAX + 10; i++) raw = addDismissed(raw, `k:${i}`);
    const list = parseDismissed(raw);
    expect(list).toHaveLength(DISMISSED_MAX);
    expect(list.at(-1)).toBe(`k:${DISMISSED_MAX + 9}`);
  });
  it("reads bad cookie values as nothing dismissed", () => {
    expect(parseDismissed(undefined)).toEqual([]);
    expect(parseDismissed("%E0%A4%A")).toEqual([]);
  });
  it("shows the first suggestion that was not dismissed, so a dismissed one stays hidden", () => {
    const a = { key: "a", text: "A" };
    const b = { key: "b", text: "B" };
    expect(pickSuggestion([null, a, b], [])).toBe(a);
    expect(pickSuggestion([a, b], ["a"])).toBe(b);
    expect(pickSuggestion([a], ["a"])).toBeNull();
  });
});

describe("suggestion lines: rules (no AI call)", () => {
  const target = (id: string, name: string, period: "day" | "week", count: number, required: number, status = "open", source = "manual") => ({
    target: { id, name, count_source: source, active: true, def: { period } },
    today: { status, count, required },
  });
  it("Targets: the day target furthest behind today", () => {
    const s = targetSuggestion([target("t1", "Deals sourced", "day", 4, 5), target("t2", "Network outreach", "day", 1, 3, "open", "communications_outreach"), target("t3", "Weekly review prep", "week", 0, 5)], "2026-10-27");
    expect(s?.text).toBe("You are 2 behind on Network outreach today.");
    expect(s?.link?.href).toBe("/people/outreach");
    expect(s?.key).toBe("target:t2:2026-10-27:1");
  });
  it("Targets: nothing when every target is met or off today", () => {
    expect(targetSuggestion([target("t1", "X", "day", 3, 3, "met"), target("t2", "Y", "day", 0, 3, "off")], "2026-10-27")).toBeNull();
  });
  it("Pipeline item: no activity for 5 days (stall limit 7) suggests the next open task, with an AI button", () => {
    const s = pipelineSuggestion({ id: ID, open: true, today: "2026-10-27", lastActivity: "2026-10-21T10:00:00Z", nextAction: "Call the broker", nextTask: "Request CIM", sourceName: "Alex", stallDays: 7 });
    expect(s?.text).toBe("No activity in 6 days. Suggested next step: Request CIM.");
    expect(s?.ai?.label).toBe("Suggest a next step");
    expect(s?.key).toBe(`pipe-quiet:${ID}:2026-10-21`);
  });
  it("Pipeline item: the step leaves out the item's own name", () => {
    expect(pipelineSuggestion({ id: ID, open: true, today: "2026-10-27", lastActivity: "2026-10-07", nextAction: null, nextTask: "Demo Pest Control: Sign NDA", sourceName: null, stallDays: 7, itemName: "Demo Pest Control" })?.text).toBe("No activity in 20 days. Suggested next step: Sign NDA.");
  });
  it("Pipeline item: falls back to following up with the deal source; nothing when recent or closed", () => {
    expect(pipelineSuggestion({ id: ID, open: true, today: "2026-10-27", lastActivity: "2026-10-20", nextAction: null, nextTask: null, sourceName: "Alex", stallDays: 7 })?.text).toContain("Follow up with Alex");
    expect(pipelineSuggestion({ id: ID, open: true, today: "2026-10-27", lastActivity: "2026-10-25", nextAction: null, nextTask: null, sourceName: null, stallDays: 7 })).toBeNull();
    expect(pipelineSuggestion({ id: ID, open: false, today: "2026-10-27", lastActivity: "2026-09-01", nextAction: null, nextTask: null, sourceName: null, stallDays: 7 })).toBeNull();
  });
  it("Expenses: savings ideas waiting, with the monthly total; a new set of ideas gives a new key", () => {
    const s = savingsIdeasSuggestion([{ id: "a", estimated_monthly_savings: 40 }, { id: "b", estimated_monthly_savings: 80 }, { id: "c", estimated_monthly_savings: 0 }], money);
    expect(s?.text).toBe("3 savings ideas waiting (about $120 a month).");
    expect(s?.key).not.toBe(savingsIdeasSuggestion([{ id: "a" }, { id: "d" }], money)?.key);
    expect(savingsIdeasSuggestion([], money)).toBeNull();
  });
  it("Home: the top priority from the morning plan, without the bold lead-in", () => {
    const plan = "**Top 3**\n- **Task 1:** Demo Landscaping LLC: Request financials\n- **Task 2:** Draft IOI template";
    expect(topPriority(plan)).toBe("Demo Landscaping LLC: Request financials");
    const s = homeSuggestion({ today: "2026-10-27", plan, firstTask: "Other", openCount: 4 });
    expect(s?.text).toBe("Top priority: Demo Landscaping LLC: Request financials.");
    expect(s?.link?.window).toBe("work");
    expect(homeSuggestion({ today: "2026-10-27", plan: null, firstTask: "Call Lender A", openCount: 1 })?.text).toBe("Top priority: Call Lender A.");
    expect(homeSuggestion({ today: "2026-10-27", plan: null, firstTask: null, openCount: 0 })).toBeNull();
  });
  it("Productivity, tasks, goals", () => {
    expect(overdueSuggestion({ today: "2026-10-27", overdue: 1 })?.text).toBe("1 task is overdue. Go through them one at a time.");
    expect(overdueSuggestion({ today: "2026-10-27", overdue: 0 })).toBeNull();
    expect(taskSuggestion({ id: ID, status: "todo", times_moved: 5 })?.text).toContain("Moved 5 times");
    expect(taskSuggestion({ id: ID, status: "todo", times_moved: 2 })).toBeNull();
    expect(taskSuggestion({ id: ID, status: "done", times_moved: 9 })).toBeNull();
    expect(goalSuggestion({ id: ID, status: "active", deadline: "2026-11-08", met: false, today: "2026-10-27" })?.text).toBe("Deadline in 12 days and the target is not met yet.");
    expect(goalSuggestion({ id: ID, status: "active", deadline: "2027-06-30", met: false, today: "2026-10-27" })).toBeNull();
    expect(goalSuggestion({ id: ID, status: "active", deadline: "2026-11-08", met: true, today: "2026-10-27" })).toBeNull();
  });
  it("never writes em dashes", () => {
    const all = [overdueSuggestion({ today: "2026-10-27", overdue: 3 }), taskSuggestion({ id: ID, status: "todo", times_moved: 4 }), savingsIdeasSuggestion([{ id: "a", estimated_monthly_savings: 5 }], money)];
    for (const s of all) expect(s?.text).not.toMatch(/[–—]/);
  });
});

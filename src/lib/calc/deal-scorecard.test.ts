import { describe, expect, it } from "vitest";
import { activityCheck, activityWarnDays, dealScorecard, nextActionCheck, overallColor, requiredCheck, stageTimeCheck } from "./deal-scorecard";
import type { StageLite } from "./pipeline";

const today = "2026-10-29";
const stages: StageLite[] = [
  { id: "s1", position: 1, outcome: "open", required_fields: [] },
  { id: "s2", position: 2, outcome: "open", required_fields: ["revenue", "asking_price"] },
  { id: "s3", position: 3, outcome: "open", required_fields: ["ebitda", "sde"] },
  { id: "lost", position: 9, outcome: "lost", required_fields: [] },
];

describe("deal scorecard: time in stage", () => {
  it("is green without a limit and under 80% of it", () => {
    expect(stageTimeCheck(30, null)).toMatchObject({ color: "green", value: "30 days, no limit" });
    expect(stageTimeCheck(10, 14)).toMatchObject({ color: "green", value: "10 of 14 days" });
  });
  it("is amber from 80% of the limit up to the limit, red over it", () => {
    expect(stageTimeCheck(12, 14).color).toBe("amber");
    expect(stageTimeCheck(14, 14).color).toBe("amber");
    const over = stageTimeCheck(17, 14);
    expect(over.color).toBe("red");
    expect(over.todo).toMatch(/Over the limit by 3 days/);
  });
  it("says 1 day, not 1 days", () => {
    expect(stageTimeCheck(1, null).value).toBe("1 day, no limit");
  });
});

describe("deal scorecard: next action", () => {
  it("is red when missing, without a due date, or overdue", () => {
    expect(nextActionCheck(null, "2026-11-02", today)).toMatchObject({ color: "red", value: "Missing" });
    expect(nextActionCheck("  ", "2026-11-02", today).color).toBe("red");
    expect(nextActionCheck("Call broker", null, today)).toMatchObject({ color: "red", value: "No due date" });
    expect(nextActionCheck("Call broker", "2026-10-27", today)).toMatchObject({ color: "red", value: "Overdue 2 days" });
  });
  it("is amber when due today and green when due later", () => {
    expect(nextActionCheck("Call broker", today, today)).toMatchObject({ color: "amber", value: "Due today" });
    expect(nextActionCheck("Call broker", "2026-10-30", today)).toMatchObject({ color: "green", value: "Due in 1 day" });
  });
});

describe("deal scorecard: required details", () => {
  it("counts the current stage and every earlier stage", () => {
    const r = requiredCheck(stages, "s3", { revenue: 100, asking_price: 200, ebitda: 50, sde: null });
    expect(r).toMatchObject({ filled: 3, required: 4, color: "amber", value: "3 of 4 filled", missing: ["SDE"] });
    expect(r.todo).toBe("Press Edit and fill: SDE.");
  });
  it("is red with fewer than half filled, green when all are filled or none are needed", () => {
    expect(requiredCheck(stages, "s3", { revenue: 1 }).color).toBe("red");
    expect(requiredCheck(stages, "s2", { revenue: 1, asking_price: 0 }).color).toBe("green");
    expect(requiredCheck(stages, "s1", {})).toMatchObject({ color: "green", value: "None required" });
    expect(requiredCheck(stages, "lost", {})).toMatchObject({ color: "green", value: "None required" });
  });
  it("treats empty text as missing", () => {
    expect(requiredCheck(stages, "s2", { revenue: "", asking_price: 5 }).missing).toEqual(["Revenue"]);
  });
});

describe("deal scorecard: last activity", () => {
  it("turns amber 2 days before the stall days (at least 3) and red at the stall days", () => {
    expect(activityWarnDays(7)).toBe(5);
    expect(activityWarnDays(4)).toBe(3);
    expect(activityWarnDays(2)).toBe(2);
    expect(activityCheck("2026-10-25", today, 7)).toMatchObject({ color: "green", value: "4 days ago" });
    expect(activityCheck("2026-10-24", today, 7)).toMatchObject({ color: "amber", value: "5 days ago" });
    expect(activityCheck("2026-10-22", today, 7)).toMatchObject({ color: "red", value: "7 days ago" });
    expect(activityCheck(today, today, 7)).toMatchObject({ color: "green", value: "Today" });
  });
  it("is red with no activity at all", () => {
    expect(activityCheck(null, today, 7)).toMatchObject({ color: "red", value: "None logged" });
  });
});

describe("deal scorecard: overall", () => {
  const base = {
    stages,
    today,
    values: { revenue: 1, asking_price: 2 },
    daysInStage: 3,
    limitDays: 14,
    lastActivity: "2026-10-28",
    stallDays: 7,
  };
  it("is green with all four on track", () => {
    const s = dealScorecard({ ...base, item: { status: "open", stage_id: "s2", next_action: "Call", next_action_due: "2026-11-01" } });
    expect(s).toMatchObject({ open: true, overall: "green", onTrack: 4, total: 4, scoreText: "4 of 4 on track" });
  });
  it("takes the worst color and counts only green checks", () => {
    const amber = dealScorecard({ ...base, item: { status: "open", stage_id: "s2", next_action: "Call", next_action_due: today } });
    expect(amber).toMatchObject({ overall: "amber", scoreText: "3 of 4 on track" });
    const red = dealScorecard({ ...base, daysInStage: 20, item: { status: "open", stage_id: "s2", next_action: null, next_action_due: today } });
    expect(red).toMatchObject({ overall: "red", scoreText: "2 of 4 on track" });
    expect(overallColor([{ color: "green" }, { color: "amber" }, { color: "red" }])).toBe("red");
  });
  it("shows no checks for a closed item", () => {
    expect(dealScorecard({ ...base, item: { status: "won", stage_id: "s2" } })).toEqual({ open: false, reason: "Won: no checks for a closed item." });
    expect(dealScorecard({ ...base, item: { status: "lost", stage_id: "s2" } }).open).toBe(false);
  });
  it("keeps the checks in a fixed order", () => {
    const s = dealScorecard({ ...base, item: { status: "open", stage_id: "s2", next_action: "Call", next_action_due: "2026-11-01" } });
    expect(s.open && s.checks.map((c) => c.key)).toEqual(["stage_time", "next_action", "required", "activity"]);
  });
});

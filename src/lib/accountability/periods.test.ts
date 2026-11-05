import { describe, expect, it } from "vitest";
import { parsePeriodKey, periodPills, weekLine } from "./periods";

describe("the Reports periods (Edit batch C, item 7)", () => {
  it("reads the period from the address; anything else is This week", () => {
    expect(parsePeriodKey("w2")).toBe("w2");
    expect(parsePeriodKey("month")).toBe("month");
    expect(parsePeriodKey("w9")).toBe("this");
    expect(parsePeriodKey(undefined)).toBe("this");
  });
  it("shows an older week's pill only while it is open", () => {
    const all = (["this", "last", "w2", "w3", "w4", "month"] as const).map((key) => ({ key }));
    expect(periodPills(all, "this").map((p) => p.key)).toEqual(["this", "last", "month"]);
    expect(periodPills(all, "w3").map((p) => p.key)).toEqual(["this", "last", "w3", "month"]);
  });
});

describe("edits of Nov 5, item 3: the week line on Reports", () => {
  const week = { start: "2026-11-02", end: "2026-11-06" };
  it("this week before Friday's End of day is partial, through today", () => {
    expect(weekLine(week, { thisWeek: true, open: true, today: "2026-11-05" })).toBe("This week, Nov 2 to 6 · partial, through today, Thu Nov 5");
  });
  it("this week once Friday's End of day is done, and a past week", () => {
    expect(weekLine(week, { thisWeek: true, open: false, today: "2026-11-06" })).toBe("This week, Nov 2 to 6");
    expect(weekLine({ start: "2026-10-12", end: "2026-10-16" }, { thisWeek: false })).toBe("Week of Oct 12 to 16");
  });
  it("a week that runs into the next month names both months; nothing about when targets are judged", () => {
    expect(weekLine({ start: "2026-09-28", end: "2026-10-02" }, { thisWeek: false })).toBe("Week of Sep 28 to Oct 2");
    expect(weekLine(week, { thisWeek: true, open: true, today: "2026-11-02" })).not.toMatch(/judged|[\u2013\u2014]/);
  });
});

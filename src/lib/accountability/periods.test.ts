import { describe, expect, it } from "vitest";
import { parsePeriodKey, pastWeekPeriodKey, periodPills, weeksBackOf } from "./periods";

describe("the Reports periods (Edit batch C, item 7)", () => {
  it("names the past weeks: Last week, then 2 to 4 weeks back", () => {
    expect([1, 2, 3, 4].map(pastWeekPeriodKey)).toEqual(["last", "w2", "w3", "w4"]);
    expect(weeksBackOf("w3")).toBe(3);
    expect(weeksBackOf("this")).toBe(0);
    expect(weeksBackOf("month")).toBeNull();
  });
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

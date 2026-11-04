import { describe, expect, it } from "vitest";
import { blockedLabel, dayBounds, defaultLength, defaultStart, firstOverlap, isoToZoned, lengthChoices, lengthLabel, rangeLabel, startChoices, timeLabel, zonedToIso } from "./time-blocks";

const day = [
  { id: "a", title: "Meridian: Finish the model", start: "09:00", end: "11:00", kind: "block" as const },
  { id: "b", title: "Lunch with Dana Whitfield", start: "12:30", end: "13:00", kind: "event" as const },
  { id: "c", title: "Call with Greg Thornton", start: "15:30", end: "16:00", kind: "event" as const },
];

describe("Block time: overlap (push C)", () => {
  it("finds the first event the block overlaps; touching ends do not count", () => {
    expect(firstOverlap("10:00", 15, day)?.id).toBe("a");
    expect(firstOverlap("08:30", 60, day)?.id).toBe("a");
    expect(firstOverlap("11:00", 60, day)).toBeNull();
    expect(firstOverlap("12:00", 30, day)).toBeNull();
    expect(firstOverlap("12:00", 45, day)?.id).toBe("b");
    expect(firstOverlap("14:00", 120, day)?.id).toBe("c");
    expect(firstOverlap("08:00", 600, day)?.id).toBe("a");
    expect(firstOverlap("10:00", 30, [])).toBeNull();
  });
});

describe("Block time: lengths and starts", () => {
  it("the length starts at the row's minutes, else the setting (60)", () => {
    expect(defaultLength(120)).toBe(120);
    expect(defaultLength(null)).toBe(60);
    expect(defaultLength(null, 45)).toBe(45);
    expect(defaultLength(0, 90)).toBe(90);
    expect(lengthChoices(60)).toEqual([15, 30, 45, 60, 90, 120]);
    expect(lengthChoices(10)).toEqual([10, 15, 30, 45, 60, 90, 120]);
    expect([15, 60, 90, 120, 75].map(lengthLabel)).toEqual(["15 min", "1 hour", "1.5 hours", "2 hours", "75 min"]);
  });

  it("starts every half hour from 7 am to 8 pm; today starts at the next half hour", () => {
    const c = startChoices();
    expect(c[0]).toBe("07:00");
    expect(c[c.length - 1]).toBe("20:00");
    expect(defaultStart("2026-11-03", "2026-11-03", "13:40")).toBe("14:00");
    expect(defaultStart("2026-11-03", "2026-11-03", "14:00")).toBe("14:30");
    expect(defaultStart("2026-11-03", "2026-11-03", "05:10")).toBe("07:00");
    expect(defaultStart("2026-11-03", "2026-11-03", "22:10")).toBe("20:00");
    expect(defaultStart("2026-11-05", "2026-11-03", "13:40")).toBe("09:00");
    expect(timeLabel("14:00")).toBe("2:00 pm");
    expect(timeLabel("00:30")).toBe("12:30 am");
    expect(timeLabel("12:00")).toBe("12:00 pm");
    expect(rangeLabel({ start: "09:00", end: "11:00" })).toBe("9:00 to 11:00");
  });

  it("the row line: Blocked 2:00 today, Blocked Nov 5 on a later day", () => {
    expect(blockedLabel("2026-11-03", "14:00", "2026-11-03", () => "Nov 3")).toBe("Blocked 2:00");
    expect(blockedLabel("2026-11-05", "09:30", "2026-11-03", () => "Nov 5")).toBe("Blocked Nov 5");
  });
});

describe("Block time: the owner's time zone", () => {
  it("turns a local time into an instant and back, across the daylight saving change", () => {
    expect(zonedToIso("2026-11-03", "14:00", "America/New_York")).toBe("2026-11-03T19:00:00.000Z");
    expect(zonedToIso("2026-10-30", "14:00", "America/New_York")).toBe("2026-10-30T18:00:00.000Z");
    expect(isoToZoned("2026-11-03T19:00:00.000Z", "America/New_York")).toEqual({ date: "2026-11-03", time: "14:00" });
    expect(isoToZoned("2026-11-04T03:30:00.000Z", "America/New_York")).toEqual({ date: "2026-11-03", time: "22:30" });
    expect(dayBounds("2026-11-03", "America/New_York")).toEqual({ start: "2026-11-03T05:00:00.000Z", end: "2026-11-04T05:00:00.000Z" });
    expect(zonedToIso("2026-11-03", "09:00", "UTC")).toBe("2026-11-03T09:00:00.000Z");
  });
});

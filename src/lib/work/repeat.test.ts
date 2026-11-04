import { describe, expect, it } from "vitest";
import { nextRepeatDate, parseRepeat, repeatLabel, REPEAT_CHOICES } from "./repeat";

const today = "2026-11-03"; // a Tuesday

describe("Repeat: the date of the next copy (push C)", () => {
  it("counts from the due date", () => {
    expect(nextRepeatDate("2026-11-03", "daily", today)).toBe("2026-11-04");
    expect(nextRepeatDate("2026-11-03", "weekly", today)).toBe("2026-11-10");
    expect(nextRepeatDate("2026-11-03", "monthly", today)).toBe("2026-12-03");
    expect(nextRepeatDate("2026-11-03", "weekdays", today)).toBe("2026-11-04");
  });

  it("an item done early keeps its rhythm from its own date", () => {
    expect(nextRepeatDate("2026-11-10", "weekly", today)).toBe("2026-11-17");
    expect(nextRepeatDate("2026-11-08", "monthly", today)).toBe("2026-12-08");
  });

  it("an overdue item never adds an overdue copy: the steps go on until after today", () => {
    expect(nextRepeatDate("2026-10-20", "weekly", today)).toBe("2026-11-10");
    expect(nextRepeatDate("2026-10-27", "weekly", today)).toBe("2026-11-10");
    expect(nextRepeatDate("2026-10-30", "daily", today)).toBe("2026-11-04");
    expect(nextRepeatDate("2026-09-15", "monthly", today)).toBe("2026-11-15");
  });

  it("every weekday skips the weekend", () => {
    expect(nextRepeatDate("2026-11-06", "weekdays", "2026-11-06")).toBe("2026-11-09");
    expect(nextRepeatDate("2026-11-07", "weekdays", "2026-11-07")).toBe("2026-11-09");
    expect(nextRepeatDate("2026-11-05", "weekdays", "2026-11-05")).toBe("2026-11-06");
  });

  it("every month keeps the day of the month through a short month", () => {
    expect(nextRepeatDate("2027-01-31", "monthly", "2027-01-31")).toBe("2027-02-28");
    expect(nextRepeatDate("2027-01-31", "monthly", "2027-02-28")).toBe("2027-03-31");
  });

  it("no date counts from today", () => {
    expect(nextRepeatDate(null, "daily", today)).toBe("2026-11-04");
    expect(nextRepeatDate(null, "weekly", today)).toBe("2026-11-10");
  });

  it("names and reads the choices", () => {
    expect(REPEAT_CHOICES.map((c) => c.label)).toEqual(["Does not repeat", "Every day", "Every weekday", "Every week", "Every month"]);
    expect(repeatLabel("weekly")).toBe("Every week");
    expect(repeatLabel(null)).toBe("Does not repeat");
    expect(parseRepeat("weekdays")).toBe("weekdays");
    expect(parseRepeat("yearly")).toBeNull();
    expect(parseRepeat("")).toBeNull();
  });
});

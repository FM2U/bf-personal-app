import { describe, expect, it } from "vitest";
import { cleanRepeatUntil, nextCopyDate, nextRepeatDate, parseRepeat, repeatDoneLine, repeatLabel, REPEAT_CHOICES, untilLabel } from "./repeat";

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

describe("Repeat: an end date (push D)", () => {
  it("adds the next copy while its date is on or before the end date", () => {
    expect(nextCopyDate("2026-11-03", "weekly", today, "2026-11-10")).toBe("2026-11-10");
    expect(nextCopyDate("2026-11-03", "weekly", today, "2026-11-30")).toBe("2026-11-10");
    expect(nextCopyDate("2026-11-03", "daily", today, "2026-11-04")).toBe("2026-11-04");
  });

  it("adds no copy once the next date is after the end date", () => {
    expect(nextCopyDate("2026-11-03", "weekly", today, "2026-11-09")).toBeNull();
    expect(nextCopyDate("2026-11-03", "daily", today, "2026-11-03")).toBeNull();
    expect(nextCopyDate("2026-11-06", "weekdays", "2026-11-06", "2026-11-08")).toBeNull();
    expect(nextCopyDate("2026-11-06", "weekdays", "2026-11-06", "2026-11-09")).toBe("2026-11-09");
    expect(nextCopyDate("2026-11-03", "monthly", today, "2026-11-30")).toBeNull();
  });

  it("an end date already past adds nothing, even for an overdue item", () => {
    expect(nextCopyDate("2026-10-20", "weekly", today, "2026-10-31")).toBeNull();
  });

  it("a blank end date repeats with no end", () => {
    expect(nextCopyDate("2026-11-03", "weekly", today, null)).toBe("2026-11-10");
    expect(nextCopyDate("2026-11-03", "monthly", today, "")).toBe("2026-12-03");
    expect(nextCopyDate(null, "daily", today)).toBe("2026-11-04");
  });

  it("the chip shows the end date", () => {
    expect(repeatLabel("weekdays", "2026-12-19", today)).toBe("Every weekday, until Dec 19");
    expect(repeatLabel("weekly", "2027-01-08", today)).toBe("Every week, until Jan 8, 2027");
    expect(repeatLabel("weekly", null, today)).toBe("Every week");
    expect(repeatLabel(null, "2026-12-19", today)).toBe("Does not repeat");
    expect(untilLabel("2026-12-19")).toBe("Dec 19");
  });

  it("keeps an end date only on a repeating item, and only a real date", () => {
    expect(cleanRepeatUntil("weekly", "2026-12-19")).toBe("2026-12-19");
    expect(cleanRepeatUntil(null, "2026-12-19")).toBeNull();
    expect(cleanRepeatUntil("weekly", "")).toBeNull();
    expect(cleanRepeatUntil("weekly", "next week")).toBeNull();
    expect(cleanRepeatUntil("weekly", undefined)).toBeNull();
  });
});

describe("Repeat: the line after Done (push D)", () => {
  const fmt = (d: string) => `<${d}>`;
  it("names the next copy, or says the series ended", () => {
    expect(repeatDoneLine({ next: "2026-11-10" }, fmt)).toBe(" The next one is on <2026-11-10>.");
    expect(repeatDoneLine({ next: null, ended: "2026-11-09" }, fmt)).toBe(" That was the last one; it repeated until Nov 9.");
    expect(repeatDoneLine({ next: null }, fmt)).toBe("");
  });
});

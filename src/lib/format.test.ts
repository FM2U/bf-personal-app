import { describe, expect, it } from "vitest";
import { date, dateTime, formatInZone } from "./format";

describe("times are shown in New York time", () => {
  it("shows an afternoon UTC timestamp as the New York clock time (daylight saving)", () => {
    expect(dateTime("2026-10-29T16:38:00Z")).toBe("Oct 29, 2026 12:38 PM");
  });
  it("uses standard time in winter", () => {
    expect(dateTime("2026-12-01T17:05:00Z")).toBe("Dec 1, 2026 12:05 PM");
  });
  it("shows a late-evening New York timestamp on the New York date", () => {
    expect(date("2026-10-30T02:30:00Z")).toBe("Oct 29, 2026");
  });
  it("leaves plain dates unchanged", () => {
    expect(date("2026-10-29")).toBe("Oct 29, 2026");
  });
  it("formats with a custom pattern", () => {
    expect(formatInZone("2026-10-29T16:38:00Z", "h:mm a")).toBe("12:38 PM");
  });
  it("returns the input for an invalid value", () => {
    expect(dateTime("not a date")).toBe("not a date");
  });
});

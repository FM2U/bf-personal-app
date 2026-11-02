import { describe, expect, it } from "vitest";
import { aiSpendLine, capWarning, nearCap } from "./spend";

describe("the month's AI spend (Edit batch C, item 13)", () => {
  it("reads as one line for Settings", () => {
    expect(aiSpendLine(3.4219, 25)).toBe("AI this month: $3.42 of $25.00");
    expect(aiSpendLine(0, 25)).toBe("AI this month: $0.00 of $25.00");
  });
  it("warns in the panel only within 10% of the cap, and not once the cap is reached (that has its own message)", () => {
    expect(nearCap(22.49, 25)).toBe(false);
    expect(nearCap(22.5, 25)).toBe(true);
    expect(nearCap(24.99, 25)).toBe(true);
    expect(nearCap(25, 25)).toBe(false);
    expect(nearCap(1, 0)).toBe(false);
    expect(capWarning(10, 25)).toBeNull();
    expect(capWarning(23, 25)).toBe("AI this month: $23.00 of $25.00. Close to the monthly cap; the AI stops when it is reached.");
  });
});

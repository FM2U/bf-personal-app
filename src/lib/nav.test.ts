import { describe, expect, it } from "vitest";
import { mainFor, menuPath, workTabFor } from "./nav";

describe("the menus on the Monthly review (2026-11-05)", () => {
  it("opened from Work on now: Work > Home, as the crumb reads", () => {
    const p = menuPath("/work/reports/monthly/2026-10", "home");
    expect(mainFor(p).key).toBe("work");
    expect(workTabFor(p)?.label).toBe("Home");
  });
  it("opened from Reports: Accountability > Reports, as the crumb reads", () => {
    const p = menuPath("/work/reports/monthly/2026-10", null);
    expect(mainFor(p).key).toBe("accountability");
    expect(workTabFor(p)).toBeNull();
  });
  it("leaves every other address as it is", () => {
    expect(menuPath("/work/reports", "home")).toBe("/work/reports");
    expect(menuPath("/work/deals", null)).toBe("/work/deals");
  });
});

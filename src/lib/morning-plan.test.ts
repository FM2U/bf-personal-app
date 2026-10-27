import { describe, expect, it } from "vitest";
import { planSections, splitMorningPlan, trimMorningPlan } from "./morning-plan";

const LONG = `**Top 3**
- **Task 1:** Call the broker
- **Task 2:** Send the CIM request
- **Task 3:** Update the budget
- **Task 4:** One too many

**Daily targets**
- **Network outreach:** 1 of 3 done today.

**Also today**
- **Task:** Pay the phone bill
- **Task:** Review the scenario

**Watch**
- **Runway:** 8.2 months (target 12 months).
  - **Cash:** $40,000
- **Alert:** 2 pipeline items need a next action.
- **Open decision:** Accept the offer?`;

describe("morning plan", () => {
  it("reads sections by their bold labels", () => {
    expect(planSections(LONG).map((s) => s.name)).toEqual(["Top 3", "Daily targets", "Also today", "Watch"]);
  });
  it("stores only Top 3 (three bullets) and Watch", () => {
    const short = trimMorningPlan(LONG);
    expect(short).toContain("**Top 3**");
    expect(short).toContain("Update the budget");
    expect(short).not.toContain("One too many");
    expect(short).not.toContain("Pay the phone bill");
    expect(short).not.toContain("Network outreach");
    expect(short).toContain("**Watch**");
    expect(short).toContain("  - **Cash:** $40,000");
    expect(short.indexOf("**Top 3**")).toBeLessThan(short.indexOf("**Watch**"));
  });
  it("Show all keeps everything else, including what was cut", () => {
    const { rest } = splitMorningPlan(LONG);
    expect(rest).toContain("One too many");
    expect(rest).toContain("**Daily targets**");
    expect(rest).toContain("Pay the phone bill");
    expect(rest).not.toContain("Call the broker");
  });
  it("labels with a colon or a heading still count; a plan with neither section is kept as written", () => {
    expect(trimMorningPlan("**Top 3:**\n- a\n\n## Watch\n- b")).toBe("**Top 3**\n- a\n\n**Watch**\n- b");
    expect(trimMorningPlan("- just one line")).toBe("- just one line");
    expect(splitMorningPlan("- just one line").rest).toBe("");
  });
  it("a short plan has nothing under Show all", () => {
    const short = "**Top 3**\n- a\n- b\n- c\n\n**Watch**\n- **Runway:** 9 months.";
    expect(splitMorningPlan(short)).toEqual({ main: short, rest: "" });
  });
});

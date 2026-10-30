import { describe, expect, it } from "vitest";
import { commitmentStatusWord, completedAtFor, defaultDoneOn, doneLateProblem, isResolution, resolutionLabel, RESOLVE_CHOICES } from "./resolve-miss";
import { completionScore } from "./scores";

describe("resolving a miss", () => {
  it("offers four choices, Done late first", () => {
    expect(RESOLVE_CHOICES.map((c) => c.label)).toEqual(["Done late", "New date", "Open a decision", "No longer a commitment"]);
    expect(isResolution("done_late")).toBe(true);
    expect(isResolution("pending")).toBe(false);
  });
  it("checks the Done late date: not before the due date, not in the future", () => {
    expect(doneLateProblem("2026-10-29", "2026-10-28", "2026-10-30")).toBeNull();
    expect(doneLateProblem("2026-10-28", "2026-10-28", "2026-10-30")).toBeNull();
    expect(doneLateProblem("2026-10-27", "2026-10-28", "2026-10-30")).toBe("The date it was done cannot be before the due date.");
    expect(doneLateProblem("2026-10-31", "2026-10-28", "2026-10-30")).toBe("The date it was done cannot be in the future.");
    expect(doneLateProblem("", "2026-10-28", "2026-10-30")).toBe("Choose the date it was done.");
    expect(defaultDoneOn("2026-10-28", "2026-10-30")).toBe("2026-10-30");
  });
  it("keeps a past completion date on the same New York date", () => {
    expect(completedAtFor("2026-10-29", "2026-10-30")).toBe("2026-10-29T16:00:00.000Z");
    const now = new Date("2026-10-30T20:00:00Z");
    expect(completedAtFor("2026-10-30", "2026-10-30", now)).toBe(now.toISOString());
  });
  it("labels each resolution", () => {
    expect(resolutionLabel({ resolution: "done_late", done_on: "2026-10-30" })).toBe("Done late, Oct 30");
    expect(resolutionLabel({ resolution: "new_date", new_due_date: "2026-11-03" })).toBe("New date, Nov 3");
    expect(resolutionLabel({ resolution: "released" })).toBe("No longer a commitment");
    expect(resolutionLabel({ resolution: "decision" })).toBe("Decision opened");
    expect(commitmentStatusWord("done_late")).toBe("Done late");
  });
  it("done late still counts as a miss in the commitment score", () => {
    const s = completionScore(
      [
        { due_date: "2026-10-27", status: "met" },
        { due_date: "2026-10-28", status: "done_late" },
      ],
      "2026-10-26",
      "2026-11-01",
    );
    expect(s).toEqual({ met: 1, missed: 1, total: 2, pct: 50 });
  });
});

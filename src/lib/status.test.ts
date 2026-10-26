import { describe, expect, it } from "vitest";
import { dueStatus, dueWord, resultStatus, severityStatus, STATUS_BADGE, STATUS_DOT, STATUS_TEXT, STATUSES, toneStatus } from "@/lib/status";

const TODAY = "2026-10-26";

describe("status colors", () => {
  it("maps due dates: overdue red, today amber, later gray, done green", () => {
    expect(dueStatus("2026-10-25", TODAY)).toBe("missed");
    expect(dueStatus("2026-10-26", TODAY)).toBe("soon");
    expect(dueStatus("2026-10-27", TODAY)).toBe("neutral");
    expect(dueStatus(null, TODAY)).toBe("neutral");
    expect(dueStatus("2026-10-20", TODAY, { done: true })).toBe("met");
    expect(dueStatus("2026-10-26T15:00:00Z", TODAY)).toBe("soon");
  });
  it("counts the next days as due soon only when asked", () => {
    expect(dueStatus("2026-10-28", TODAY, { soonDays: 2 })).toBe("soon");
    expect(dueStatus("2026-10-29", TODAY, { soonDays: 2 })).toBe("neutral");
    expect(dueStatus("2026-11-01", "2026-10-31", { soonDays: 1 })).toBe("soon");
  });
  it("gives the status word", () => {
    expect(dueWord("2026-10-01", TODAY)).toBe("Overdue");
    expect(dueWord(TODAY, TODAY)).toBe("Due today");
    expect(dueWord("2026-12-01", TODAY)).toBeNull();
    expect(dueWord(undefined, TODAY)).toBeNull();
  });
  it("maps severity, tone, and results", () => {
    expect(severityStatus("critical")).toBe("missed");
    expect(severityStatus("warning")).toBe("soon");
    expect(severityStatus("info")).toBe("neutral");
    expect(toneStatus("good")).toBe("met");
    expect(toneStatus("warn")).toBe("soon");
    expect(toneStatus("bad")).toBe("missed");
    expect(toneStatus(undefined)).toBe("neutral");
    expect(resultStatus("met")).toBe("met");
    expect(resultStatus("missed")).toBe("missed");
    expect(resultStatus("open")).toBe("soon");
    expect(resultStatus("off")).toBe("neutral");
  });
  it("uses only the four status tokens", () => {
    for (const s of STATUSES) {
      for (const cls of [STATUS_TEXT[s], STATUS_BADGE[s], STATUS_DOT[s]]) {
        expect(cls).toContain(`status-${s}`);
        expect(cls).not.toMatch(/(emerald|amber|red|green|sky|blue)-\d/);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { headerFigures } from "./record-page";

const today = "2026-11-03";
const fmt = (d: string) => d.slice(5);

describe("the record-page header figures", () => {
  it("shows next follow-up, open tasks, and last contact for a person", () => {
    const f = headerFigures({ nextDue: "2026-10-29", hasNext: true, nextLabel: "Next follow-up", openTasks: 2, lastContactAt: "2026-10-20T10:00:00Z", lastContactKind: "email" }, today, fmt);
    expect(f.map((x) => [x.key, x.value, x.label, x.tone])).toEqual([
      ["next", "5 days late", "Next follow-up", "over"],
      ["tasks", "2", "Open tasks", "none"],
      ["last", "10-20 · email", "Last contact", "none"],
    ]);
  });

  it("says None without a next action, No date with text but no date, and 1 Open task", () => {
    expect(headerFigures({ nextDue: null, hasNext: false, nextLabel: "Next action", openTasks: 1, lastContactAt: null, lastContactKind: null }, today, fmt).map((x) => x.value)).toEqual(["None", "1", "Never"]);
    expect(headerFigures({ nextDue: null, hasNext: true, nextLabel: "Next action", openTasks: 1, lastContactAt: null, lastContactKind: null }, today, fmt)[0].value).toBe("No date");
    expect(headerFigures({ nextDue: null, hasNext: false, nextLabel: "Next action", openTasks: 1, lastContactAt: null, lastContactKind: null }, today, fmt)[1].label).toBe("Open task");
  });

  it("shows the wait instead of the last contact on a deal waiting on someone", () => {
    const f = headerFigures({ nextDue: today, hasNext: true, nextLabel: "Next action", openTasks: 0, lastContactAt: "2026-10-20T10:00:00Z", lastContactKind: "call", waitingOn: "Rachel Kim", waitDays: 6, waitTone: "amber" }, today, fmt);
    expect(f[0]).toMatchObject({ value: "Today", tone: "today" });
    expect(f[2]).toEqual({ key: "waiting", value: "6 days", label: "Waiting on Rachel Kim", tone: "amber" });
  });
});

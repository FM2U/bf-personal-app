import { describe, expect, it } from "vitest";
import { dealPageState, headerFigures } from "./record-page";

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

describe("the deal page state (Edit batch C round 3)", () => {
  it("shows a listing in the Listing state: Screen listings crumb with the name, the Listing pill, Pass and Interested, no Documents", () => {
    expect(dealPageState({ screened: false, status: "open", stageName: null, name: "00 Industrial Filtration Distributor" })).toEqual({
      kind: "listing",
      crumb: { label: "Screen listings", href: "/work/listings", tail: "00 Industrial Filtration Distributor" },
      typePill: "Listing",
      noActionHint: "Optional for a listing",
      decision: "listing",
      documents: false,
      questionsTools: false,
    });
  });

  it("shows the same row as a deal once it is screened: Deals crumb with the stage, the stage pill, Documents", () => {
    const s = dealPageState({ screened: true, status: "open", stageName: "Interested", name: "Dalton Services" });
    expect(s).toMatchObject({ kind: "deal", crumb: { label: "Deals", href: "/work/deals", tail: "Interested" }, typePill: null, noActionHint: "Needs a next action", decision: "open", documents: true, questionsTools: true });
    expect(dealPageState({ screened: true, status: "closed", stageName: "Passed", name: "x" })).toMatchObject({ kind: "deal", decision: "closed", crumb: { tail: "Passed" } });
    expect(dealPageState({ screened: true, status: "open", stageName: null, name: "x" }).crumb.tail).toBe("No stage");
  });
});

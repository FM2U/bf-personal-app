import { describe, expect, it } from "vitest";
import {
  compareDeals,
  countDealsAdvanced,
  countDealsSourced,
  latestDate,
  missingRequiredFields,
  requiredFieldsForStage,
  sortTasksProprietaryFirst,
  sourceRank,
  sourcedBreakdownByDay,
  stageLimitDedupeKey,
  stageLimitStatus,
  stallStatus,
  sumBreakdown,
  type StageLite,
} from "./pipeline";
import { outreachStatus, sortQueue } from "./outreach";
import { periodResult, type TargetDef } from "./targets";

const ACQ: StageLite[] = [
  { id: "sourced", position: 1, outcome: "open", required_fields: [] },
  { id: "screened", position: 2, outcome: "open", required_fields: [] },
  { id: "nda", position: 3, outcome: "open", required_fields: [] },
  { id: "cim", position: 4, outcome: "open", required_fields: [] },
  { id: "ioi", position: 5, outcome: "open", required_fields: ["revenue", "ebitda", "asking_price"] },
  { id: "loi", position: 6, outcome: "open", required_fields: ["financing_structure"] },
  { id: "dil", position: 7, outcome: "open", required_fields: [] },
  { id: "closed", position: 8, outcome: "won", required_fields: [] },
  { id: "passed", position: 9, outcome: "lost", required_fields: ["revenue"] },
];

describe("required details before a stage", () => {
  it("adds the requirements of every earlier stage", () => {
    expect(requiredFieldsForStage(ACQ, "cim")).toEqual([]);
    expect(requiredFieldsForStage(ACQ, "ioi")).toEqual(["revenue", "ebitda", "asking_price"]);
    expect(requiredFieldsForStage(ACQ, "loi")).toEqual(["revenue", "ebitda", "asking_price", "financing_structure"]);
    expect(requiredFieldsForStage(ACQ, "closed")).toEqual(["revenue", "ebitda", "asking_price", "financing_structure"]);
  });

  it("never requires details to pass on an item", () => {
    expect(requiredFieldsForStage(ACQ, "passed")).toEqual([]);
    expect(requiredFieldsForStage(ACQ, "unknown")).toEqual([]);
  });

  it("lists the empty fields with plain labels", () => {
    const req = requiredFieldsForStage(ACQ, "loi");
    expect(missingRequiredFields(req, { revenue: 6200000, ebitda: 0, asking_price: null, financing_structure: "  " })).toEqual([
      { key: "asking_price", label: "Asking price" },
      { key: "financing_structure", label: "Financing structure" },
    ]);
    expect(missingRequiredFields(req, { revenue: 1, ebitda: 1, asking_price: 1, financing_structure: "SBA 7(a)" })).toEqual([]);
  });
});

describe("stage time limits", () => {
  it("is over the limit only after the limit days have passed", () => {
    expect(stageLimitStatus({ enteredDate: "2026-10-19", today: "2026-10-26", maxDays: 7 })).toMatchObject({ daysInStage: 7, limit: 7, over: false });
    expect(stageLimitStatus({ enteredDate: "2026-10-18", today: "2026-10-26", maxDays: 7 })).toMatchObject({ daysInStage: 8, over: true, overBy: 1 });
  });

  it("adds extensions to the limit", () => {
    expect(stageLimitStatus({ enteredDate: "2026-10-12", today: "2026-10-26", maxDays: 7, extensionDays: 7 })).toMatchObject({ daysInStage: 14, limit: 14, over: false });
    expect(stageLimitStatus({ enteredDate: "2026-10-11", today: "2026-10-26", maxDays: 7, extensionDays: 7 })).toMatchObject({ limit: 14, over: true, overBy: 1 });
  });

  it("has no limit when the stage has none", () => {
    expect(stageLimitStatus({ enteredDate: "2026-01-01", today: "2026-10-26", maxDays: null })).toMatchObject({ limit: null, over: false });
  });

  it("opens a new decision only for a new stay or a new limit", () => {
    const a = stageLimitDedupeKey("i1", "s1", "2026-10-01", 0);
    expect(stageLimitDedupeKey("i1", "s1", "2026-10-01", 0)).toBe(a);
    expect(stageLimitDedupeKey("i1", "s1", "2026-10-01", 7)).not.toBe(a);
    expect(stageLimitDedupeKey("i1", "s1", "2026-10-15", 0)).not.toBe(a);
  });
});

describe("stalled items", () => {
  it("uses the latest activity date", () => {
    expect(latestDate(["2026-10-01", null, "2026-10-20", undefined, "2026-10-05"])).toBe("2026-10-20");
    expect(latestDate([])).toBeNull();
  });

  it("is stalled after the set number of days without activity", () => {
    expect(stallStatus({ status: "open", lastActivityDate: "2026-10-20", today: "2026-10-26", stallDays: 7 })).toEqual({ stalled: false, daysSince: 6 });
    expect(stallStatus({ status: "open", lastActivityDate: "2026-10-19", today: "2026-10-26", stallDays: 7 })).toEqual({ stalled: true, daysSince: 7 });
    expect(stallStatus({ status: "open", lastActivityDate: "2026-10-23", today: "2026-10-26", stallDays: 3 }).stalled).toBe(true);
  });

  it("never marks closed items as stalled", () => {
    expect(stallStatus({ status: "lost", lastActivityDate: "2026-01-01", today: "2026-10-26", stallDays: 7 }).stalled).toBe(false);
  });
});

describe("proprietary deals first", () => {
  it("ranks proprietary, then brokered, then not set", () => {
    expect([sourceRank("brokered"), sourceRank(null), sourceRank("proprietary")]).toEqual([1, 2, 0]);
  });

  it("orders the board inside a stage", () => {
    const items = [
      { name: "B1", deal_source_type: "brokered", next_action_due: "2026-10-20" },
      { name: "N1", deal_source_type: null, next_action_due: "2026-10-01" },
      { name: "P2", deal_source_type: "proprietary", next_action_due: null },
      { name: "P1", deal_source_type: "proprietary", next_action_due: "2026-10-27" },
    ];
    expect([...items].sort(compareDeals).map((i) => i.name)).toEqual(["P1", "P2", "B1", "N1"]);
  });

  it("puts proprietary deal tasks above brokered ones at equal priority and due date", () => {
    const rank: Record<string, number> = { p: 0, b: 1 };
    const tasks = [
      { id: "1", priority: 2, due_date: "2026-10-26", pipeline_item_id: "b" },
      { id: "2", priority: 2, due_date: "2026-10-26", pipeline_item_id: null },
      { id: "3", priority: 2, due_date: "2026-10-26", pipeline_item_id: "p" },
      { id: "4", priority: 1, due_date: "2026-10-27", pipeline_item_id: "b" },
      { id: "5", priority: 2, due_date: "2026-10-25", pipeline_item_id: "b" },
    ];
    const sorted = sortTasksProprietaryFirst(tasks, (id) => (id ? rank[id] ?? 2 : 2));
    // Priority first, then due date, then deal source.
    expect(sorted.map((t) => t.id)).toEqual(["4", "5", "3", "1", "2"]);
  });

  it("can keep done tasks last", () => {
    const tasks = [
      { id: "a", priority: 1, due_date: "2026-10-26", status: "done" },
      { id: "b", priority: 2, due_date: "2026-10-26", status: "todo" },
    ];
    expect(sortTasksProprietaryFirst(tasks, () => 2, { doneLast: true, status: (t) => t.status }).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("puts deal-source contacts first in the outreach queue", () => {
    const today = "2026-10-26";
    const rows = [
      { name: "Never", status: outreachStatus({ relationship_group: "warm" }, null, today) },
      { name: "Late", status: outreachStatus({ relationship_group: "close" }, "2026-08-01", today) },
      { name: "CPA", isDealSource: true, status: outreachStatus({ relationship_group: "professional" }, "2026-07-20", today) },
      { name: "Banker", isDealSource: true, status: outreachStatus({ relationship_group: "close" }, "2026-09-20", today) },
    ];
    expect(sortQueue(rows).map((r) => r.name)).toEqual(["CPA", "Banker", "Never", "Late"]);
  });
});

describe("deal targets: counting", () => {
  // 2026-10-26 is a Monday.
  const def: TargetDef = { id: "t", period: "day", minimum_count: 5, active_weekdays: [1, 2, 3, 4, 5], start_date: "2026-10-26" };

  it("counts deals sourced per day with the proprietary and brokered breakdown", () => {
    const items = [
      { id: "1", date: "2026-10-26", deal_source_type: "proprietary" },
      { id: "2", date: "2026-10-26", deal_source_type: "brokered" },
      { id: "3", date: "2026-10-26", deal_source_type: "proprietary" },
      { id: "4", date: "2026-10-27", deal_source_type: null },
    ];
    const counts = countDealsSourced(items);
    expect(counts).toEqual({ "2026-10-26": 3, "2026-10-27": 1 });
    expect(periodResult(def, counts, "2026-10-26", "2026-10-26")).toMatchObject({ count: 3, required: 5, status: "missed" });
    const byDay = sourcedBreakdownByDay(items);
    expect(byDay["2026-10-26"]).toEqual({ proprietary: 2, brokered: 1, notSet: 0 });
    expect(sumBreakdown(byDay, "2026-10-26", "2026-10-27")).toEqual({ proprietary: 2, brokered: 1, notSet: 1, total: 4, proprietarySharePct: 50 });
    expect(sumBreakdown({}, "2026-10-26", "2026-10-27").proprietarySharePct).toBeNull();
  });

  it("counts each advanced deal once per day", () => {
    const counts = countDealsAdvanced({
      minPosition: 3, // NDA signed
      moves: [
        { item_id: "a", date: "2026-10-26", position: 3, outcome: "open" }, // into NDA signed
        { item_id: "a", date: "2026-10-26", position: 4, outcome: "open" }, // same item, same day: counted once
        { item_id: "b", date: "2026-10-26", position: 2, outcome: "open" }, // Screened: before the threshold
        { item_id: "c", date: "2026-10-26", position: 9, outcome: "lost" }, // Passed: never counts
        { item_id: "d", date: "2026-10-27", position: 6, outcome: "open" },
      ],
      comms: [
        { item_id: "a", date: "2026-10-26", purpose: "cim_request" }, // same item, same day: counted once
        { item_id: "b", date: "2026-10-26", purpose: "source_contact" }, // contacted the broker: counts
        { item_id: "e", date: "2026-10-26", purpose: "general" }, // other purposes do not count
        { item_id: null, date: "2026-10-26", purpose: "cim_request" }, // not linked to an item
        { item_id: "a", date: "2026-10-27", purpose: "cim_request" }, // next day: counts again
      ],
    });
    expect(counts).toEqual({ "2026-10-26": 2, "2026-10-27": 2 });
    expect(periodResult({ ...def, minimum_count: 1 }, counts, "2026-10-26", "2026-10-26").status).toBe("met");
  });
});

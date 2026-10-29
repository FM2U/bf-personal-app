import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  conversionNotes,
  conversionPct,
  countDealCalls,
  countFirstReach,
  firstReachDates,
  hoursText,
  oneIn,
  stagePosition,
  suggestionText,
  suggestTargets,
  targetTimeText,
  toStageEntries,
  type StageEntry,
} from "./deal-funnel";
import { periodResult, type TargetDef } from "./targets";
import { todayInTz } from "./dates";

const ny = (ts: string) => todayInTz("America/New_York", new Date(ts));

// Acquisitions stages: Sourced 1, Screened 2, NDA signed 3, CIM reviewed 4, IOI sent 5, LOI signed 6, Diligence 7, Closed 8 (won), Passed 9 (lost).
const e = (item: string, ts: number, date: string, position: number | null, opts: Partial<StageEntry> = {}): StageEntry => ({
  item_id: item,
  ts,
  date,
  position,
  outcome: position === 9 ? "lost" : position === 8 ? "won" : "open",
  isCreation: false,
  threshold: 4,
  ...opts,
});

describe("CIMs reviewed: first move into CIM reviewed or later, once per item", () => {
  it("counts a move into CIM reviewed, and a move that skips it", () => {
    const entries = [
      e("a", 1, "2026-10-26", 1, { isCreation: true }),
      e("a", 2, "2026-10-26", 4), // into CIM reviewed
      e("b", 1, "2026-10-20", 2, { isCreation: true }),
      e("b", 3, "2026-10-27", 5), // skipped CIM reviewed: straight to IOI sent
    ];
    expect(firstReachDates(entries)).toEqual({ a: "2026-10-26", b: "2026-10-27" });
    expect(countFirstReach(entries)).toEqual({ "2026-10-26": 1, "2026-10-27": 1 });
  });

  it("counts each item once, ever (later moves and moving back and forward again do not count)", () => {
    const entries = [
      e("a", 1, "2026-10-19", 1, { isCreation: true }),
      e("a", 2, "2026-10-26", 4),
      e("a", 3, "2026-10-27", 5), // next stage the next day
      e("a", 4, "2026-10-28", 3), // back to NDA signed
      e("a", 5, "2026-10-29", 4), // forward again
    ];
    expect(countFirstReach(entries)).toEqual({ "2026-10-26": 1 });
  });

  it("does not count the stage an item was created in, or an item created at or past the stage", () => {
    const entries = [
      e("c", 1, "2026-10-26", 4, { isCreation: true }), // created at CIM reviewed
      e("c", 2, "2026-10-27", 5), // then IOI sent: the CIM was reviewed before it was added
      e("d", 1, "2026-10-26", 6, { isCreation: true }), // created at LOI signed
    ];
    expect(countFirstReach(entries)).toEqual({});
  });

  it("never counts passed (lost) stages; the earliest entry is the creation when none is marked", () => {
    const entries = [
      e("f", 1, "2026-10-26", 2, { isCreation: true }),
      e("f", 2, "2026-10-26", 9), // Passed
      e("g", 10, "2026-10-26", 1), // no creation mark: earliest entry is the creation
      e("g", 20, "2026-10-28", 4),
      e("h", 5, "2026-10-26", 4), // only entry, so it is the creation: not counted
    ];
    expect(firstReachDates(entries)).toEqual({ g: "2026-10-28" });
  });

  it("uses New York dates: a move at 11:30 pm New York time counts on that day, not the next UTC day", () => {
    const stages = [
      { id: "s1", pipeline_id: "p", name: "Sourced", position: 1, outcome: "open" },
      { id: "s4", pipeline_id: "p", name: "CIM reviewed", position: 4, outcome: "open" },
    ];
    const items = { a: { pipeline_id: "p", created_at: "2026-10-20T14:00:00Z" } };
    const history = [
      { item_id: "a", stage_id: "s1", entered_at: "2026-10-20T14:00:00Z" },
      { item_id: "a", stage_id: "s4", entered_at: "2026-10-29T03:30:00Z" }, // Oct 28, 11:30 pm in New York
      { item_id: "x", stage_id: "s4", entered_at: "2026-10-29T03:30:00Z" }, // not in the items list: left out
    ];
    const entries = toStageEntries(history, stages, items, (pid) => stagePosition(stages, pid, "CIM reviewed", 4), ny);
    expect(entries).toHaveLength(2);
    expect(entries[0].isCreation).toBe(true);
    expect(countFirstReach(entries)).toEqual({ "2026-10-28": 1 });
  });

  it("finds the stage position by the target's stage, the name, or the default", () => {
    const stages = [
      { id: "n", pipeline_id: "p", name: "NDA signed", position: 3 },
      { id: "c", pipeline_id: "p", name: "cim reviewed", position: 5 },
      { id: "o", pipeline_id: "q", name: "Other", position: 7 },
    ];
    expect(stagePosition(stages, "p", "CIM reviewed", 4)).toBe(5);
    expect(stagePosition(stages, "p", "CIM reviewed", 4, "n")).toBe(3);
    expect(stagePosition(stages, "p", "CIM reviewed", 4, "o")).toBe(5); // stage of another pipeline: by name
    expect(stagePosition(stages, "q", "CIM reviewed", 4)).toBe(4);
  });
});

describe("Broker or owner calls", () => {
  // 2026-10-26 is a Monday.
  const weekly: TargetDef = { id: "w", period: "week", minimum_count: 2, active_weekdays: [1, 2, 3, 4, 5], start_date: "2026-10-26" };

  it("counts calls, meetings, and video calls on deals, one per deal per day, added up Monday to Sunday", () => {
    const counts = countDealCalls([
      { item_id: "a", date: "2026-10-26", method: "call" },
      { item_id: "a", date: "2026-10-26", method: "meeting" }, // same deal, same day: once
      { item_id: "a", date: "2026-10-27", method: "call" }, // next day: counts
      { item_id: "b", date: "2026-10-27", method: "video" },
      { item_id: "b", date: "2026-10-27", method: "email" }, // not a call
      { item_id: null, date: "2026-10-27", method: "call" }, // not linked to a deal
    ]);
    expect(counts).toEqual({ "2026-10-26": 1, "2026-10-27": 2 });
    expect(periodResult(weekly, counts, "2026-10-28", "2026-10-27")).toMatchObject({ start: "2026-10-26", end: "2026-11-01", count: 3, status: "met" });
    expect(periodResult(weekly, { "2026-10-26": 1 }, "2026-10-28", "2026-10-27").status).toBe("open");
    expect(periodResult(weekly, { "2026-10-26": 1 }, "2026-10-28", "2026-11-01").status).toBe("missed");
  });

  it("a call at 11 pm Sunday New York time counts in that week, not the next one", () => {
    const date = ny("2026-11-02T04:00:00Z"); // Sunday Nov 1, 11 pm EST
    expect(date).toBe("2026-11-01");
    const counts = countDealCalls([
      { item_id: "a", date, method: "call" },
      { item_id: "b", date, method: "call" },
    ]);
    expect(periodResult(weekly, counts, "2026-11-01", "2026-11-01").status).toBe("met");
    expect(periodResult(weekly, counts, "2026-11-02", "2026-11-01").count).toBe(0);
  });
});

describe("funnel card", () => {
  const types: Record<string, string | null> = { a: "proprietary", b: "brokered", c: "proprietary", d: null };

  it("builds six steps with conversion from the previous step and the proprietary and brokered split", () => {
    const steps = buildFunnel({ listings: 40, sourced: ["a", "b", "c", "d"], ndas: ["a", "b"], cims: ["a"], calls: ["a", "a", "b"], lois: [], typeOf: (id) => types[id] });
    expect(steps.map((s) => [s.key, s.count, s.conversionPct])).toEqual([
      ["listings", 40, null],
      ["sourced", 4, 10],
      ["ndas", 2, 50],
      ["cims", 1, 50],
      ["calls", 3, 300],
      ["lois", 0, 0],
    ]);
    expect(steps[0].split).toBeNull();
    expect(steps[1].split).toEqual({ proprietary: 2, brokered: 1, notSet: 1 });
    expect(steps[4].split).toEqual({ proprietary: 2, brokered: 1, notSet: 0 });
  });

  it("shows no percent when the previous step is 0", () => {
    expect(conversionPct(3, 0)).toBeNull();
    expect(conversionPct(1, 3)).toBe(33);
    const steps = buildFunnel({ listings: 0, sourced: ["a"], ndas: [], cims: [], calls: [], lois: [], typeOf: () => null });
    expect(steps[1].conversionPct).toBeNull();
    expect(steps[2].conversionPct).toBe(0);
  });

  it("compares actual conversion with the targets only after 14 days of data, over the same days", () => {
    const base = { listings: 160, sourcedSinceListings: 16, sourced: 16, cims: 2, targets: { listings: 20, sourced: 5, cims: 1 } };
    expect(conversionNotes({ ...base, dealDays: 13, listingsDays: 13 })).toEqual([]);
    expect(conversionNotes({ ...base, dealDays: 14, listingsDays: 14 })).toEqual([
      "1 in 10 listings screened becomes a sourced deal (your targets plan for 1 in 4).",
      "You reach a CIM from 1 in 8 sourced deals (your targets plan for 1 in 5).",
    ]);
    // Listings counted for only 3 days: no listings comparison yet; the deals comparison still shows.
    expect(conversionNotes({ ...base, dealDays: 30, listingsDays: 3 })).toEqual(["You reach a CIM from 1 in 8 sourced deals (your targets plan for 1 in 5)."]);
    expect(conversionNotes({ ...base, dealDays: 30, listingsDays: 20, cims: 0 })[1]).toBe("No CIM reviewed yet from 16 sourced deals (your targets plan for 1 in 5).");
    expect(conversionNotes({ ...base, dealDays: 30, listingsDays: 20, listings: 6, sourcedSinceListings: 9 })[0]).toBe("9 sourced deals came from 6 listings screened (your targets plan for 1 in 4).");
    expect(conversionNotes({ ...base, dealDays: 30, listingsDays: 20, sourcedSinceListings: 0 })[0]).toBe("No sourced deal yet from 160 listings screened (your targets plan for 1 in 4).");
    expect(oneIn(0, 5)).toBeNull();
    expect(oneIn(3, 10)).toBe("1 in 3");
  });
});

describe("suggested targets", () => {
  it("keeps the targets' mix and scales it to the search hours", () => {
    // Targets: 20 listings x 3 + 5 replies x 5 + 1 CIM x 45 + (2 calls x 30) / 5 = 142 minutes a weekday.
    const s = suggestTargets({ hours: 2, minutes: {}, targets: {} });
    expect(s).toEqual({ hours: 2, targetMinutes: 142, listings: 17, replies: 4, cims: 1, callsPerWeek: 2, cimEveryDays: null });
    expect(suggestionText(s)).toBe("With 2 hours a day: screen 17 listings, reply to 4, review 1 CIM, 2 calls a week.");
    expect(targetTimeText(s)).toBe("Your current targets take about 2 hours 22 minutes a day, 22 minutes more than the time set.");
  });

  it("uses the inputs and the owner's targets", () => {
    const s = suggestTargets({ hours: 4, minutes: { listing: 2, cim: 60, reply: 5, call: 30 }, targets: { listings: 30, replies: 6, cims: 1, callsPerWeek: 5 } });
    // 30 x 2 + 6 x 5 + 60 + 5 x 30 / 5 = 180 minutes; 240 / 180 = 1.33
    expect(s).toMatchObject({ targetMinutes: 180, listings: 40, replies: 8, cims: 1, callsPerWeek: 7 });
    expect(targetTimeText(s)).toBe("Your current targets take about 3 hours a day, 1 hour less than the time set.");
  });

  it("falls back to the defaults for empty or zero inputs, and spaces CIMs out when less than half fits", () => {
    expect(suggestTargets({ hours: NaN, minutes: { listing: 0 }, targets: { listings: -1 } }).targetMinutes).toBe(142);
    const s = suggestTargets({ hours: 0.5, minutes: {}, targets: {} });
    expect(s.cims).toBe(0);
    expect(s.cimEveryDays).toBe(5);
    expect(suggestionText(s)).toBe("With 0.5 hours a day: screen 4 listings, reply to 1, review 1 CIM every 5 weekdays, 0 calls a week.");
    expect(suggestionText(suggestTargets({ hours: 1, minutes: {}, targets: { listings: 20, replies: 5, cims: 1, callsPerWeek: 2 } }))).toBe(
      "With 1 hour a day: screen 8 listings, reply to 2, review 1 CIM every 2 weekdays, 1 call a week.",
    );
  });

  it("writes hours in plain words", () => {
    expect(hoursText(120)).toBe("2 hours");
    expect(hoursText(60)).toBe("1 hour");
    expect(hoursText(142)).toBe("2 hours 22 minutes");
    expect(hoursText(22)).toBe("22 minutes");
  });
});

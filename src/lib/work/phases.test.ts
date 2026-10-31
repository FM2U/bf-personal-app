import { describe, expect, it } from "vitest";
import { DEAL_FILTERS, dealsLabel, filterCounts, groupByPhase, matchesFilter, matchesSearch, PHASES, type FilterableDeal } from "./phases";
import { WORK_STAGES } from "./stages";

const TODAY = "2026-10-30";

const deal = (name: string, o: Partial<FilterableDeal> = {}): FilterableDeal => ({ name, status: "open", nextAction: "Do the thing", nextActionDue: "2026-11-03", waitLevel: "none", ...o });

describe("the three phases", () => {
  it("cover the nine stages in order, three each, with the approved names and taglines", () => {
    expect(PHASES.map((p) => p.name)).toEqual(["Early", "Evaluate", "Decide"]);
    expect(PHASES.map((p) => p.tagline)).toEqual(["Get the CIM", "Decide whether to bid", "Bid and close"]);
    expect(PHASES.flatMap((p) => p.stages)).toEqual([...WORK_STAGES]);
    for (const p of PHASES) expect(p.stages).toHaveLength(3);
  });

  it("group the stage groups under their phase and count the deals per phase", () => {
    const groups = WORK_STAGES.map((name, i) => ({ stage: { name }, deals: Array.from({ length: i % 3 }, (_, k) => `${name}-${k}`) }));
    const phased = groupByPhase(groups);
    expect(phased.map((p) => p.phase.key)).toEqual(["early", "evaluate", "decide"]);
    expect(phased[0].groups.map((g) => g.stage.name)).toEqual(["Interested", "NDA signed", "Broker call"]);
    expect(phased[2].groups.map((g) => g.stage.name)).toEqual(["Partner presentation", "IOI or LOI", "Diligence"]);
    // 0 + 1 + 2 deals in each phase
    expect(phased.map((p) => p.count)).toEqual([3, 3, 3]);
  });

  it("leave out a stage that is not one of the nine and keep going when a stage is missing", () => {
    const groups = [{ stage: { name: "Passed" }, deals: [1] }, { stage: { name: "Model" }, deals: [1, 2] }];
    const phased = groupByPhase(groups);
    expect(phased[0].groups).toEqual([]);
    expect(phased[1].groups.map((g) => g.stage.name)).toEqual(["Model"]);
    expect(phased[1].count).toBe(2);
  });

  it("label the count", () => {
    expect(dealsLabel(0)).toBe("No deals");
    expect(dealsLabel(1)).toBe("1 deal");
    expect(dealsLabel(4)).toBe("4 deals");
  });
});

describe("the Deals filters", () => {
  const deals: FilterableDeal[] = [
    deal("Hilltop Pest Solutions", { nextActionDue: TODAY }),
    deal("BrightPath Home Care", { nextActionDue: TODAY, waitLevel: "quiet" }),
    deal("Oakline Dental Lab", { nextActionDue: "2026-11-01", waitLevel: "quiet" }),
    deal("Summit Logistics Group", { nextActionDue: "2026-11-05", waitLevel: "red" }),
    deal("Meridian Industrial Coatings", { nextActionDue: "2026-10-29" }),
    deal("Ridgeline Commercial Roofing", { nextAction: null, nextActionDue: null }),
    deal("Pinecrest Landscaping", { waitLevel: "amber" }),
    deal("Passed one", { status: "passed", nextAction: null, nextActionDue: null, waitLevel: "red" }),
  ];

  it("are All, Due today, Waiting on someone, Needs a next action, in that order", () => {
    expect(DEAL_FILTERS.map((f) => f.key)).toEqual(["all", "today", "wait", "needs"]);
    expect(DEAL_FILTERS.map((f) => f.label)).toEqual(["All", "Due today", "Waiting on someone", "Needs a next action"]);
  });

  it("count open deals only: due today includes overdue, waiting is any wait color, needs is no next action", () => {
    expect(filterCounts(deals, TODAY)).toEqual({ all: 7, today: 3, wait: 4, needs: 1 });
  });

  it("match a deal the way the counts do", () => {
    const names = (f: "all" | "today" | "wait" | "needs") => deals.filter((d) => d.status === "open" && matchesFilter(d, f, TODAY)).map((d) => d.name);
    expect(names("all")).toHaveLength(7);
    expect(names("today")).toEqual(["Hilltop Pest Solutions", "BrightPath Home Care", "Meridian Industrial Coatings"]);
    expect(names("wait")).toEqual(["BrightPath Home Care", "Oakline Dental Lab", "Summit Logistics Group", "Pinecrest Landscaping"]);
    expect(names("needs")).toEqual(["Ridgeline Commercial Roofing"]);
    // A deal with no next action and a past date is not "due today".
    expect(matchesFilter(deal("x", { nextAction: null, nextActionDue: "2026-10-01" }), "today", TODAY)).toBe(false);
  });

  it("find a deal by part of its name, any letter case, and match everything when the box is empty", () => {
    expect(matchesSearch(deal("Oakline Dental Lab"), "dental")).toBe(true);
    expect(matchesSearch(deal("Oakline Dental Lab"), "  OAK ")).toBe(true);
    expect(matchesSearch(deal("Oakline Dental Lab"), "pest")).toBe(false);
    expect(matchesSearch(deal("Oakline Dental Lab"), "")).toBe(true);
    expect(matchesSearch(deal("Oakline Dental Lab"), "   ")).toBe(true);
  });
});

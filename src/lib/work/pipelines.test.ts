import { describe, expect, it } from "vitest";
import { groupByPhase } from "./phases";
import { closedBarLabel, CONSULTING_COLUMNS, CONSULTING_STAGES, feeLabel, findOutLines, JOB_PHASES, JOB_STAGES, matchesConsultingFilter, nextOpenStage, noteLine, openStageIndex } from "./pipelines";

describe("the Job search phases", () => {
  it("has two phases, Early (Contact, Conversation) and Decide (Interview, Offer), and groups the stages under them", () => {
    expect(JOB_PHASES.map((p) => p.name)).toEqual(["Early", "Decide"]);
    expect(JOB_PHASES.flatMap((p) => p.stages)).toEqual([...JOB_STAGES]);
    const groups = JOB_STAGES.map((name) => ({ stage: { name }, deals: name === "Contact" ? [1, 2] : name === "Offer" ? [3] : [] }));
    const phased = groupByPhase(groups, JOB_PHASES);
    expect(phased.map((p) => [p.phase.key, p.count])).toEqual([["early", 2], ["decide", 1]]);
    expect(phased[0].groups.map((g) => g.stage.name)).toEqual(["Contact", "Conversation"]);
  });

  it("knows the open stage order, the next stage, and the closed bar label", () => {
    expect(openStageIndex("job", "Interview")).toBe(2);
    expect(openStageIndex("job", "Declined")).toBe(-1);
    expect(nextOpenStage("job", "Contact")).toBe("Conversation");
    expect(nextOpenStage("job", "Offer")).toBeNull();
    expect(nextOpenStage("job", "Not chosen")).toBeNull();
    expect(closedBarLabel("job", { Declined: 3, "Not chosen": 2 })).toBe("Declined 3 · Not chosen 2");
    expect(closedBarLabel("job", { Declined: 0, "Not chosen": 0, Accepted: 1 })).toBe("Declined 0 · Not chosen 0 · Accepted 1");
  });

  it("reads What to find out as one group (the self lines first, then any older seller and broker lines)", () => {
    expect(findOutLines({ seller: ["a"], broker: [], self: ["b", "c"] })).toEqual(["b", "c", "a"]);
  });
});

describe("the Consulting columns", () => {
  it("has four columns with their lines, the next stage, and the closed bar label", () => {
    expect(CONSULTING_COLUMNS.map((c) => c.name)).toEqual([...CONSULTING_STAGES]);
    expect(CONSULTING_COLUMNS.map((c) => c.tagline)).toEqual(["Someone asked", "Scope and fee sent", "Work under way", "Invoice paid"]);
    expect(nextOpenStage("consulting", "Proposal")).toBe("Engagement");
    expect(nextOpenStage("consulting", "Paid")).toBeNull();
    expect(openStageIndex("consulting", "Lost")).toBe(-1);
    expect(closedBarLabel("consulting", { Lost: 1, Done: 4 })).toBe("Lost 1 · Done 4");
  });

  it("shows the fee short, with est. on a lead, and the one-line note", () => {
    expect(feeLabel(18000, "Proposal")).toBe("$18K");
    expect(feeLabel(4500, "Paid")).toBe("$4.5K");
    expect(feeLabel(12000, "Lead")).toBe("$12K est.");
    expect(feeLabel(800, "Lead")).toBe("$800 est.");
    expect(feeLabel(1_500_000, "Engagement")).toBe("$1.5M");
    expect(feeLabel(null, "Lead")).toBe("No fee yet");
    expect(noteLine("Two of three leases read\nMore detail")).toBe("Two of three leases read");
    expect(noteLine("  \n Second line only")).toBe("Second line only");
    expect(noteLine(null)).toBeNull();
  });

  it("filters Due today (today or earlier) and Due next 7 days (after today, within 7 days) over open items", () => {
    const today = "2026-11-03";
    const i = (due: string | null, status = "open") => ({ status, nextAction: due ? "x" : null, nextActionDue: due });
    expect(matchesConsultingFilter(i("2026-11-03"), "today", today, "2026-11-10")).toBe(true);
    expect(matchesConsultingFilter(i("2026-11-01"), "today", today, "2026-11-10")).toBe(true);
    expect(matchesConsultingFilter(i("2026-11-04"), "today", today, "2026-11-10")).toBe(false);
    expect(matchesConsultingFilter(i("2026-11-04"), "week", today, "2026-11-10")).toBe(true);
    expect(matchesConsultingFilter(i("2026-11-10"), "week", today, "2026-11-10")).toBe(true);
    expect(matchesConsultingFilter(i("2026-11-11"), "week", today, "2026-11-10")).toBe(false);
    expect(matchesConsultingFilter(i(null), "all", today, "2026-11-10")).toBe(true);
    expect(matchesConsultingFilter(i("2026-11-03", "won"), "all", today, "2026-11-10")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { glanceCounts, waitSections, type HomeRow } from "./home";
import { WORK_STAGES } from "./stages";

const row = (id: string, o: Partial<HomeRow> = {}): HomeRow => ({ id, name: id, status: "open", nextAction: "Do it", nextActionDue: "2026-11-03", waitLevel: "none", waitDays: 0, stageName: "Interested", ...o });

describe("Home", () => {
  it("splits the waits at the threshold", () => {
    const deals = [row("eleven", { waitLevel: "red", waitDays: 11 }), row("five", { waitLevel: "amber", waitDays: 5 }), row("two", { waitLevel: "quiet", waitDays: 2 }), row("none")];
    const w = waitSections(deals, 5);
    expect(w.map((x) => x.label)).toEqual(["5+ days", "< 5 days"]);
    expect(w[0].deals.map((d) => d.id)).toEqual(["eleven", "five"]);
    expect(w[1].deals.map((d) => d.id)).toEqual(["two"]);
    // Exactly at the threshold counts in "N+ days"; one day under does not.
    const edge = waitSections([row("seven", { waitLevel: "amber", waitDays: 7 }), row("six", { waitLevel: "quiet", waitDays: 6 })], 7);
    expect(edge[0].deals.map((d) => d.id)).toEqual(["seven"]);
    expect(edge[1].deals.map((d) => d.id)).toEqual(["six"]);
    expect(waitSections(deals, 7)[0].label).toBe("7+ days");
  });
  it("counts Deals at a glance by phase, waiting over the threshold, and needs a next action", () => {
    const groups = WORK_STAGES.map((name) => ({ stage: { name }, deals: [] as { status: string; nextAction: string | null; waitLevel: string }[] }));
    groups[0].deals.push({ status: "open", nextAction: "x", waitLevel: "none" }, { status: "open", nextAction: null, waitLevel: "none" });
    groups[4].deals.push({ status: "open", nextAction: "x", waitLevel: "red" });
    groups[8].deals.push({ status: "open", nextAction: "x", waitLevel: "quiet" }, { status: "open", nextAction: "x", waitLevel: "amber" });
    expect(glanceCounts(groups)).toEqual({ active: 5, early: 2, evaluate: 1, decide: 2, waitingOver: 2, needsAction: 1 });
  });
});

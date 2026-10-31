import { describe, expect, it } from "vitest";
import { glanceCounts, HOME_SECTIONS, homeFilterCounts, homeRowShown, nextActionSections, waitSections, type HomeRow } from "./home";
import { WORK_STAGES } from "./stages";

const TODAY = "2026-10-30";
const row = (id: string, o: Partial<HomeRow> = {}): HomeRow => ({ id, name: id, status: "open", nextAction: "Do it", nextActionDue: "2026-11-03", waitLevel: "none", waitDays: 0, stageName: "Interested", ...o });

describe("Home", () => {
  it("splits next actions into Overdue, Due today, and Needs a next action", () => {
    const deals = [row("late", { nextActionDue: "2026-10-29" }), row("today", { nextActionDue: TODAY }), row("later"), row("none", { nextAction: null, nextActionDue: null }), row("passed", { status: "lost", nextActionDue: TODAY })];
    const s = nextActionSections(deals, TODAY);
    expect(HOME_SECTIONS.map((x) => x.key)).toEqual(["overdue", "today", "needs"]);
    expect(s.overdue.map((d) => d.id)).toEqual(["late"]);
    expect(s.today.map((d) => d.id)).toEqual(["today"]);
    expect(s.needs.map((d) => d.id)).toEqual(["none"]);
  });

  it("splits the waits at the threshold", () => {
    const deals = [row("eleven", { waitLevel: "red", waitDays: 11 }), row("five", { waitLevel: "amber", waitDays: 5 }), row("two", { waitLevel: "quiet", waitDays: 2 }), row("none")];
    const w = waitSections(deals, 5);
    expect(w.map((x) => x.label)).toEqual(["Over 5 days", "Under 5 days"]);
    expect(w[0].deals.map((d) => d.id)).toEqual(["eleven", "five"]);
    expect(w[1].deals.map((d) => d.id)).toEqual(["two"]);
    expect(waitSections(deals, 7)[0].label).toBe("Over 7 days");
  });

  it("counts the filter pills over the rows on the page and hides rows that do not match", () => {
    const both = row("both", { nextActionDue: TODAY, waitLevel: "amber", waitDays: 6 });
    const rows = [{ card: "actions" as const, deal: both }, { card: "actions" as const, deal: row("none", { nextAction: null, nextActionDue: null }) }, { card: "waiting" as const, deal: both }];
    expect(homeFilterCounts(rows, TODAY)).toEqual({ all: 3, today: 2, wait: 2, needs: 1 });
    expect(homeRowShown(both, "today", "", TODAY)).toBe(true);
    expect(homeRowShown(both, "needs", "", TODAY)).toBe(false);
    expect(homeRowShown(both, "all", "BOT", TODAY)).toBe(true);
    expect(homeRowShown(both, "all", "zzz", TODAY)).toBe(false);
  });

  it("counts Deals at a glance by phase, waiting over the threshold, and needs a next action", () => {
    const groups = WORK_STAGES.map((name) => ({ stage: { name }, deals: [] as { status: string; nextAction: string | null; waitLevel: string }[] }));
    groups[0].deals.push({ status: "open", nextAction: "x", waitLevel: "none" }, { status: "open", nextAction: null, waitLevel: "none" });
    groups[4].deals.push({ status: "open", nextAction: "x", waitLevel: "red" });
    groups[8].deals.push({ status: "open", nextAction: "x", waitLevel: "quiet" }, { status: "open", nextAction: "x", waitLevel: "amber" });
    expect(glanceCounts(groups)).toEqual({ active: 5, early: 2, evaluate: 1, decide: 2, waitingOver: 2, needsAction: 1 });
  });
});

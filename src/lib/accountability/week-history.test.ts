import { describe, expect, it } from "vitest";
import { EMPTY_FACTS, type Facts, type Target } from "./targets";
import { fourWeeksBefore, tileHistories } from "./week-history";

const targets: Target[] = [
  { id: "t1", name: "Network outreach", key: "outreach_contacts", cadence: "week", number: 3, commitment: true, sortOrder: 1 },
  { id: "t2", name: "Rosara focus done", key: "rosara_focus_done", cadence: "week", number: 1, commitment: false, sortOrder: 2 },
];
// Weeks of Oct 5, 12, 19, 26 (before the week of Nov 2).
const email = (on: string, i: number) => ({ on, method: "email", contactId: `p${i}`, contactName: `P ${i}`, broker: false });
const facts: Facts = {
  ...EMPTY_FACTS,
  comms: [email("2026-10-06", 1), email("2026-10-13", 2), email("2026-10-14", 3), email("2026-10-15", 4), email("2026-10-27", 5)],
  focusDone: [{ on: "2026-10-08", text: "x" }, { on: "2026-10-22", text: "x" }, { on: "2026-10-29", text: "x" }],
  moves: [{ on: "2026-10-20", name: "Dalton", from: "A", to: "B", keyFinding: null, lane: "Deals" }],
};

describe("the last 4 weeks under each tile", () => {
  it("are the four Mondays before the week, oldest first", () => {
    expect(fourWeeksBefore("2026-11-02")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });
  it("draws the values to scale and marks a week below its target red", () => {
    const h = tileHistories({ targets, facts, weekStart: "2026-11-02", waits: [{ sinceDate: "2026-10-21" }], mostLabel: "Most missed this week", mostName: "Rosara focus done" });
    const out = h["Network outreach"];
    expect(out.kind).toBe("bars");
    if (out.kind !== "bars") return;
    expect(out.weeks.map((w) => w.value)).toEqual(["1", "3", "0", "1"]);
    expect(out.weeks.map((w) => w.red)).toEqual([true, false, true, true]);
    expect(out.weeks[1].share).toBe(1);
    expect(out.weeks[0].share).toBeCloseTo(1 / 3);
    const moved = h["Deals moved"];
    expect(moved.kind === "bars" && moved.weeks.map((w) => w.value)).toEqual(["0", "0", "1", "0"]);
    const wait = h["Days waiting on brokers"];
    expect(wait.kind === "bars" && wait.weeks.map((w) => w.value)).toEqual(["0.0", "0.0", "2.0", "9.0"]);
    const fu = h["Follow-ups on time"];
    expect(fu.kind === "bars" && fu.weeks.every((w) => w.value === "none")).toBe(true);
  });
  it("the Most missed tile shows done or not done each week", () => {
    const h = tileHistories({ targets, facts, weekStart: "2026-11-02", waits: [], mostLabel: "Most missed this week", mostName: "Rosara focus done" });
    const m = h["Most missed this week"];
    expect(m.kind === "marks" && m.weeks.map((w) => w.word)).toEqual(["done", "not done", "done", "done"]);
  });
});

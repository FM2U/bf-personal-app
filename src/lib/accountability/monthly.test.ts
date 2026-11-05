import { describe, expect, it } from "vitest";
import { cleanNextTargets, firstWorkday, fullWeeks, monthLabel, monthResults, monthSummary, nextMonthStart, parseMonthSlug, previousMonthStart, readNextTargets, readResults, reviewListLine, reviewMonthFor, targetLineOf } from "./monthly";
import { DEFAULT_TARGETS, EMPTY_FACTS, type Facts, type Target } from "./targets";

const targets: Target[] = DEFAULT_TARGETS.map((t, i) => ({ ...t, id: `t${i + 1}` }));
const OCT = "2026-10-01";

describe("the month under review", () => {
  it("opens on the first workday of the next month", () => {
    expect(firstWorkday("2026-11-01")).toBe("2026-11-02");
    expect(reviewMonthFor("2026-11-01")).toBeNull();
    expect(reviewMonthFor("2026-11-02")).toEqual({ month: OCT, opensOn: "2026-11-02" });
    expect(reviewMonthFor("2026-11-06")).toEqual({ month: OCT, opensOn: "2026-11-02" });
    expect(reviewMonthFor("2027-01-01")).toEqual({ month: "2026-12-01", opensOn: "2027-01-01" });
  });
  it("names and reads months", () => {
    expect(previousMonthStart("2027-01-15")).toBe("2026-12-01");
    expect(nextMonthStart("2026-12-01")).toBe("2027-01-01");
    expect(monthLabel(OCT)).toBe("October 2026");
    expect(parseMonthSlug("2026-10")).toBe(OCT);
    expect(parseMonthSlug("2026-13")).toBeNull();
    expect(parseMonthSlug("../x")).toBeNull();
  });
  it("counts only the full work weeks inside the month", () => {
    expect(fullWeeks(OCT)).toEqual([
      { start: "2026-10-05", end: "2026-10-09" },
      { start: "2026-10-12", end: "2026-10-16" },
      { start: "2026-10-19", end: "2026-10-23" },
      { start: "2026-10-26", end: "2026-10-30" },
    ]);
    expect(fullWeeks("2026-09-01").length).toBe(3);
    expect(fullWeeks("2026-11-01")[0].start).toBe("2026-11-02");
  });
});

describe("how the month went", () => {
  // Listings: 5 a day in weeks 1 and 2, 4 a day in week 3, none in week 4. Outreach: 11, 9, 10, 0. Deals moved: 2 each week.
  const days = (start: string, n: number) => Array.from({ length: 5 }, (_, i) => `2026-10-${String(Number(start.slice(8)) + i).padStart(2, "0")}`).flatMap((d) => Array.from({ length: n }, () => d));
  const screened = [...days("2026-10-05", 5), ...days("2026-10-12", 5), ...days("2026-10-19", 4)].map((on, i) => ({ on, outcome: "passed" as const, name: `L${i}`, reason: null }));
  const comms = [["2026-10-06", 11], ["2026-10-13", 9], ["2026-10-20", 10]].flatMap(([on, n]) => Array.from({ length: n as number }, (_, i) => ({ on: on as string, method: "email", contactId: `c${i}`, contactName: `P${i}`, broker: false })));
  const moves = ["2026-10-06", "2026-10-07", "2026-10-13", "2026-10-14", "2026-10-20", "2026-10-21", "2026-10-27", "2026-10-28"].map((on) => ({ on, name: "Deal", from: "A", to: "B", keyFinding: null, lane: "Deals" as const }));
  const facts: Facts = { ...EMPTY_FACTS, screened, comms, moves };
  const res = monthResults(targets, facts, OCT);
  const by = (name: string) => res.find((r) => r.name === name)!;

  it("judges each full week", () => {
    expect(by("Listings screened")).toMatchObject({ weeks: 4, weeksMet: 2, average: "3.5 a day", commitment: true });
    expect(by("Network outreach")).toMatchObject({ weeksMet: 2, average: "7.5 a week" });
    expect(by("Deals moved a stage")).toMatchObject({ weeksMet: 4, average: "2.0 a week" });
    expect(by("Follow-ups done on time")).toMatchObject({ weeksMet: 4, average: "100%", unit: "percent" });
    expect(by("Rosara focus done")).toMatchObject({ weeksMet: 0, average: "0.0 a week" });
  });
  it("a skipped day is not counted for a per-weekday target", () => {
    const skipped = ["2026-10-19"];
    const r = monthResults(targets, facts, OCT, skipped).find((x) => x.name === "Listings screened")!;
    // Week 3: 16 on the 4 counted days (the skipped Monday is left out), need 5 x 4 = 20; 66 over 19 days.
    expect(r.weeksMet).toBe(2);
    expect(r.average).toBe("3.5 a day");
  });
  it("sums it up in one line", () => {
    expect(monthSummary(res)).toBe("Most missed: Brokers contacted, 4 of 4 weeks. Best: Follow-ups done on time, every week.");
    expect(monthSummary([])).toBe("No full work week in this month to judge.");
    expect(targetLineOf(by("Listings screened"))).toBe("Per weekday · target 5");
    expect(targetLineOf(by("Follow-ups done on time"))).toBe("Per week · target 100%");
  });
  it("reads a kept copy back", () => {
    expect(readResults(JSON.parse(JSON.stringify(res)))).toEqual(res);
    expect(readResults("x")).toEqual([]);
  });
});

describe("next month's targets", () => {
  it("takes the numbers and switches from the click, and keeps the rest as they are", () => {
    const r = cleanNextTargets([{ id: "t1", number: "6", commitment: false }, { id: "t3", number: 12, commitment: true }, { id: "nope", number: 3 }], targets);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => `${x.name} ${x.number} ${x.commitment}`)).toEqual(["Listings screened 6 false", "Brokers contacted 5 false", "Network outreach 12 true", "Follow-ups done on time 100 false", "Deals moved a stage 2 false", "Rosara focus done 1 false"]);
    expect(r.rows[0].before).toBe(5);
    expect(readNextTargets(JSON.parse(JSON.stringify(r.rows)))).toEqual(r.rows);
  });
  it("refuses a number out of range", () => {
    expect(cleanNextTargets([{ id: "t1", number: 0 }], targets)).toEqual({ ok: false, error: "The number for Listings screened must be between 1 and 1000." });
    expect(cleanNextTargets([{ id: "t4", number: 120 }], targets)).toEqual({ ok: false, error: "The number for Follow-ups done on time must be between 1 and 100." });
    expect(cleanNextTargets([{ id: "t1", number: "five" }], targets).ok).toBe(false);
  });
  it("the line under a review in the list", () => {
    const fmt = (d: string) => d.slice(5);
    expect(reviewListLine({ finishedOn: null, exported: false, current: true }, fmt)).toBe("Not finished yet · also on Work on now");
    expect(reviewListLine({ finishedOn: "2026-10-01", exported: true, current: false }, fmt)).toBe("Finished 10-01 · read only");
    expect(reviewListLine({ finishedOn: "2026-11-04", exported: false, current: true }, fmt)).toBe("Finished 11-04 without the export · read only");
    expect(reviewListLine({ finishedOn: null, exported: false, current: false }, fmt)).toBe("Not finished · read only");
  });
});

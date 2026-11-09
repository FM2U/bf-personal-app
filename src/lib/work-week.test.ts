import { afterEach, describe, expect, it } from "vitest";
import { cleanWorkWeek, DEFAULT_WORK_WEEK, fromKept, isReviewDay, isWeekJudgedOn, isWorkDay, keepWorkWeek, nextWorkDay, setWorkWeek, weekCountFrom, weekOf, weekStartOf, workDaysIn, workDaysLabel, workWeekFromProfile } from "./work-week";
import { countedDays, judgeDay, judgeWeek, tomorrowLabel, type Facts, type Target } from "./accountability/targets";
import { partnerSettings } from "./accountability/partners";
import { fullWeeks } from "./accountability/monthly";

// 2026-11-01 is a Sunday, 2026-11-02 a Monday, 2026-11-06 a Friday, 2026-11-07 a Saturday.
afterEach(() => setWorkWeek(null));

describe("the work week (design B, 2026-11-07)", () => {
  it("Monday to Friday, week starting Monday, review on Friday, unless changed", () => {
    expect(DEFAULT_WORK_WEEK).toEqual({ days: [1, 2, 3, 4, 5], start: 1, review: 5 });
    expect(weekOf("2026-11-04")).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(weekOf("2026-11-08")).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(isWorkDay("2026-11-07")).toBe(false);
    expect(isWeekJudgedOn("2026-11-06")).toBe(true);
    expect(isReviewDay("2026-11-06")).toBe(true);
    expect(nextWorkDay("2026-11-06")).toBe("2026-11-09");
    expect(workDaysLabel()).toBe("Mon to Fri");
  });

  it("Monday to Saturday: Saturday counts, the week ends Saturday, the review stays Friday", () => {
    setWorkWeek({ days: [1, 2, 3, 4, 5, 6], start: 1, review: 5 });
    expect(isWorkDay("2026-11-07")).toBe(true);
    expect(weekOf("2026-11-04")).toEqual({ start: "2026-11-02", end: "2026-11-07" });
    expect(isWeekJudgedOn("2026-11-06")).toBe(false);
    expect(isWeekJudgedOn("2026-11-07")).toBe(true);
    expect(isReviewDay("2026-11-06")).toBe(true);
    expect(nextWorkDay("2026-11-06")).toBe("2026-11-07");
    expect(tomorrowLabel("2026-11-06")).toBe("Tomorrow");
    expect(tomorrowLabel("2026-11-07")).toBe("Monday");
    expect(workDaysLabel()).toBe("Mon to Sat");
  });

  it("A week starting Sunday, Sunday to Thursday", () => {
    setWorkWeek({ days: [7, 1, 2, 3, 4], start: 7, review: 4 });
    expect(weekStartOf("2026-11-04")).toBe("2026-11-01");
    expect(weekOf("2026-11-07")).toEqual({ start: "2026-11-01", end: "2026-11-05" });
    expect(workDaysIn("2026-11-01", "2026-11-07")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(workDaysLabel()).toBe("Sun to Thu");
    expect(isReviewDay("2026-11-05")).toBe(true);
    expect(tomorrowLabel("2026-11-05")).toBe("Sunday");
  });

  it("Saved values: bad parts fall back; the profile's review day is 0 Sunday to 6 Saturday; before the update it stays Friday", () => {
    expect(cleanWorkWeek({ days: [9, "x"], start: 3, review: 0 })).toEqual(DEFAULT_WORK_WEEK);
    expect(workWeekFromProfile({ work_days: [1, 2, 3, 4, 5, 6], week_start: 7, weekly_review_weekday: 0 })).toEqual({ days: [1, 2, 3, 4, 5, 6], start: 7, review: 7 });
    expect(workWeekFromProfile({ weekly_review_weekday: 0 })).toEqual(DEFAULT_WORK_WEEK);
    expect(fromKept(keepWorkWeek({ days: [2, 3], start: 1, review: 3 }))).toEqual({ days: [2, 3], start: 1, review: 3 });
    expect(fromKept(undefined)).toBe(null);
  });

  it("Targets follow the work days: a Saturday counts toward a per-weekday target, and the week is judged on Saturday", () => {
    setWorkWeek({ days: [1, 2, 3, 4, 5, 6], start: 1, review: 5 });
    const day: Target = { id: "d", name: "Listings screened", key: "listings_screened", cadence: "day", number: 2, commitment: true, sortOrder: 1 } as Target;
    const week: Target = { id: "w", name: "Deals moved a stage", key: "deals_moved", cadence: "week", number: 1, commitment: false, sortOrder: 2 } as Target;
    const facts = { screened: [], comms: [], followUps: [], moves: [], actionsDone: [], focusDone: [] } as unknown as Facts;
    expect(countedDays("2026-11-07", [])).toBe(6);
    const sat = judgeDay([day, week], facts, "2026-11-07");
    expect(sat.map((j) => j.judged)).toEqual([true, true]);
    const fri = judgeDay([day, week], facts, "2026-11-06");
    expect(fri.map((j) => j.judged)).toEqual([true, false]);
    expect(judgeWeek([day], facts, "2026-11-02").missed[0].figure).toBe("0 of 12");
  });

  it("A partner saved without days gets the work days; the month's full weeks follow the week", () => {
    setWorkWeek({ days: [1, 2, 3, 4, 5, 6], start: 1, review: 5 });
    expect(partnerSettings({}).days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fullWeeks("2026-11-01")[0]).toEqual({ start: "2026-11-02", end: "2026-11-07" });
  });
});

describe("weekend work counts toward the coming week (Bram, 2026-11-09)", () => {
  it("a week counts from the day after the previous week's last work day", () => {
    // Mon to Fri: the week of Mon Nov 9 counts from Sat Nov 7.
    expect(weekCountFrom("2026-11-09")).toBe("2026-11-07");
    // Every day a work day: the week's own start.
    setWorkWeek({ days: [1, 2, 3, 4, 5, 6, 7], start: 1, review: 5 });
    expect(weekCountFrom("2026-11-09")).toBe("2026-11-09");
    // Mon to Fri with the week starting Sunday: from the Saturday before.
    setWorkWeek({ days: [1, 2, 3, 4, 5], start: 7, review: 5 });
    expect(weekCountFrom("2026-11-08")).toBe("2026-11-07");
    // Mon, Wed, Fri: from Saturday too.
    setWorkWeek({ days: [1, 3, 5], start: 1, review: 5 });
    expect(weekCountFrom("2026-11-09")).toBe("2026-11-07");
  });
});


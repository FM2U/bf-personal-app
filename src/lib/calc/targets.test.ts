import { describe, expect, it } from "vitest";
import { completionRate, consecutive, countByDay, countInRange, describeTarget, isActiveDay, periodHistory, periodResult, rangeTotals, type TargetDef } from "./targets";
import { effectiveEveryDays, outreachStats, outreachStatus, sortQueue } from "./outreach";
import { combineScores, nextScheduledReview } from "./scores";
import { fixDashes, markdownToPlain, parseInline, parseMarkdown } from "../markdown";
import { isMissingSchemaError } from "../schema-guard";

// 2026-10-19 is a Monday.
const daily: TargetDef = { id: "t1", period: "day", minimum_count: 3, active_weekdays: [1, 2, 3, 4, 5], start_date: "2026-10-01" };
const weekly: TargetDef = { id: "t2", period: "week", minimum_count: 5, active_weekdays: [1, 2, 3, 4, 5], start_date: "2026-10-01" };

describe("daily targets: counting", () => {
  it("counts items per day and in a range", () => {
    const c = countByDay([{ date: "2026-10-19" }, { date: "2026-10-19" }, { date: "2026-10-20", count: 4 }]);
    expect(c).toEqual({ "2026-10-19": 2, "2026-10-20": 4 });
    expect(countInRange(c, "2026-10-19", "2026-10-19")).toBe(2);
    expect(countInRange(c, "2026-10-19", "2026-10-25")).toBe(6);
  });

  it("honors active weekdays and the start date", () => {
    expect(isActiveDay(daily, "2026-10-19")).toBe(true); // Monday
    expect(isActiveDay(daily, "2026-10-24")).toBe(false); // Saturday
    expect(isActiveDay(daily, "2026-09-29")).toBe(false); // before start
  });
});

describe("daily targets: met or missed per period", () => {
  const counts = { "2026-10-19": 3, "2026-10-20": 1, "2026-10-22": 5, "2026-10-24": 2 };

  it("marks days met, missed, open, and off", () => {
    expect(periodResult(daily, counts, "2026-10-19", "2026-10-22").status).toBe("met");
    expect(periodResult(daily, counts, "2026-10-20", "2026-10-22").status).toBe("missed");
    expect(periodResult(daily, counts, "2026-10-23", "2026-10-22").status).toBe("open");
    expect(periodResult(daily, counts, "2026-10-24", "2026-10-25").status).toBe("off");
  });

  it("the daily close makes today final", () => {
    expect(periodResult(daily, counts, "2026-10-20", "2026-10-19").status).toBe("open");
    expect(periodResult(daily, counts, "2026-10-20", "2026-10-20").status).toBe("missed");
  });

  it("weekly targets add up Monday to Sunday", () => {
    const r = periodResult(weekly, counts, "2026-10-21", "2026-10-26");
    expect(r).toMatchObject({ start: "2026-10-19", end: "2026-10-25", count: 11, required: 5, status: "met" });
    expect(periodResult(weekly, { "2026-10-20": 2 }, "2026-10-21", "2026-10-26").status).toBe("missed");
    expect(periodResult(weekly, { "2026-10-20": 2 }, "2026-10-21", "2026-10-21").status).toBe("open");
  });

  it("builds a history, completion rate, and consecutive counts", () => {
    const hist = periodHistory(daily, counts, "2026-10-19", "2026-10-25", "2026-10-24");
    expect(hist.map((h) => h.status)).toEqual(["met", "missed", "missed", "met", "missed", "off", "off"]);
    expect(completionRate(hist)).toEqual({ met: 2, missed: 3, pct: 40 });
    expect(consecutive(hist, "missed")).toBe(1);
    expect(consecutive(hist, "met")).toBe(0);
    const good = periodHistory(daily, { "2026-10-19": 3, "2026-10-20": 3, "2026-10-21": 4 }, "2026-10-19", "2026-10-22", "2026-10-21");
    // Wednesday met, Thursday still open (does not break the count)
    expect(good.map((h) => h.status)).toEqual(["met", "met", "met", "open"]);
    expect(consecutive(good, "met")).toBe(3);
    expect(completionRate([]).pct).toBeNull();
  });

  it("totals a range against the required count", () => {
    const t = rangeTotals(daily, counts, "2026-10-19", "2026-10-25", "2026-10-25");
    expect(t).toMatchObject({ total: 11, required: 15, periods: 5, met: 2, missed: 3, pct: 40 });
  });

  it("describes a target in plain words", () => {
    expect(describeTarget(daily)).toBe("3 per weekday (Mon to Fri)");
    expect(describeTarget(weekly)).toBe("5 per week");
    expect(describeTarget({ period: "day", minimum_count: 1, active_weekdays: [0, 6] })).toBe("1 per day (Sun, Sat)");
  });
});

describe("outreach queue", () => {
  it("uses the group default when no frequency is set", () => {
    expect(effectiveEveryDays("close", null)).toBe(30);
    expect(effectiveEveryDays("warm", null)).toBe(60);
    expect(effectiveEveryDays("professional", null)).toBe(90);
    expect(effectiveEveryDays("warm", 14)).toBe(14);
    expect(effectiveEveryDays(null, null)).toBeNull();
  });

  it("finds due and overdue contacts", () => {
    expect(outreachStatus({ relationship_group: "close" }, "2026-09-25", "2026-10-25")).toMatchObject({ due: true, daysOverdue: 0, dueDate: "2026-10-25" });
    expect(outreachStatus({ relationship_group: "close" }, "2026-09-20", "2026-10-25")).toMatchObject({ due: true, daysOverdue: 5 });
    expect(outreachStatus({ relationship_group: "warm" }, "2026-10-01", "2026-10-25").due).toBe(false);
    expect(outreachStatus({ relationship_group: "warm" }, null, "2026-10-25")).toMatchObject({ due: true, neverContacted: true });
    expect(outreachStatus({ relationship_group: null }, null, "2026-10-25").due).toBe(false);
    expect(outreachStatus({ relationship_group: null, outreach_every_days: 7 }, "2026-10-10", "2026-10-25")).toMatchObject({ due: true, daysOverdue: 8 });
  });

  it("sorts never contacted first, then most overdue", () => {
    const rows = [
      { name: "B", status: outreachStatus({ relationship_group: "close" }, "2026-09-20", "2026-10-25") },
      { name: "A", status: outreachStatus({ relationship_group: "close" }, "2026-08-01", "2026-10-25") },
      { name: "C", status: outreachStatus({ relationship_group: "warm" }, null, "2026-10-25") },
    ];
    expect(sortQueue(rows).map((r) => r.name)).toEqual(["C", "A", "B"]);
  });

  it("calculates the reply rate", () => {
    const s = outreachStats([{ outcome: "replied" }, { outcome: "meeting_booked" }, { outcome: "no_response" }, { outcome: null }]);
    expect(s).toEqual({ sent: 4, replied: 1, meetings: 1, referrals: 0, noResponse: 1, replyRatePct: 50 });
    expect(outreachStats([]).replyRatePct).toBeNull();
  });
});

describe("review schedule and combined score", () => {
  it("finds the next weekly, monthly, or quarterly review", () => {
    // 2026-10-25 is a Sunday; weekly review on Sunday
    expect(nextScheduledReview("2026-10-25", 0)).toEqual({ kind: "weekly", date: "2026-10-25" });
    // Nov 1 is both a Sunday and the 1st: the larger review is named
    expect(nextScheduledReview("2026-10-26", 0)).toEqual({ kind: "monthly", date: "2026-11-01" });
    expect(nextScheduledReview("2026-11-02", 0)).toEqual({ kind: "weekly", date: "2026-11-08" });
    expect(nextScheduledReview("2026-10-27", 6)).toEqual({ kind: "weekly", date: "2026-10-31" });
    expect(nextScheduledReview("2026-12-29", 0)).toEqual({ kind: "quarterly", date: "2027-01-01" });
    expect(nextScheduledReview("2026-11-28", 3)).toEqual({ kind: "monthly", date: "2026-12-01" });
  });

  it("adds target periods to the commitment score", () => {
    expect(combineScores({ met: 3, missed: 1 }, { met: 1, missed: 3 })).toEqual({ met: 4, missed: 4, pct: 50 });
    expect(combineScores({ met: 0, missed: 0 }, { met: 0, missed: 0 }).pct).toBeNull();
  });
});

describe("AI text: dashes", () => {
  it("replaces em and en dashes used as punctuation", () => {
    expect(fixDashes("Runway — 7 months")).toBe("Runway, 7 months");
    expect(fixDashes("Call the broker — Then send the NDA")).toBe("Call the broker. Then send the NDA");
    expect(fixDashes("Two options—both slow")).toBe("Two options, both slow");
    expect(fixDashes("Weeks 3–5 are open")).toBe("Weeks 3-5 are open");
    expect(fixDashes("— first item")).toBe("- first item");
    expect(fixDashes("Done —")).toBe("Done.");
    expect(fixDashes("Is it due? — yes")).toBe("Is it due? yes");
    expect(fixDashes("- **Runway:** 7 months – below target")).toBe("- **Runway:** 7 months, below target");
    expect(fixDashes("a\n———\nb")).toBe("a\n\nb");
    expect(fixDashes("plain-hyphen words stay")).toBe("plain-hyphen words stay");
  });
});

describe("AI text: markdown reader", () => {
  it("reads bold parts and drops stray marks", () => {
    expect(parseInline("**Runway:** 7 months")).toEqual([{ text: "Runway:", bold: true }, { text: " 7 months", bold: false }]);
    expect(parseInline("a ** b")).toEqual([{ text: "a  b", bold: false }]);
    expect(parseInline("see `code` and [link](http://x.y) and *this*")).toEqual([{ text: "see code and link and this", bold: false }]);
  });

  it("reads labels, nested bullets, numbers, and paragraphs", () => {
    const blocks = parseMarkdown("## Today\n- **Call** the broker\n  - ask for the CIM\n  - set a date\n- Send NDA\n\n**Watch**\n1. Runway\n2. Budget\nPlain line one\nPlain line two");
    expect(blocks[0]).toEqual({ kind: "label", inline: [{ text: "Today", bold: true }] });
    expect(blocks[1].kind).toBe("list");
    const list = blocks[1] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].children[0].items.map((i) => i.inline[0].text)).toEqual(["ask for the CIM", "set a date"]);
    expect(blocks[2]).toEqual({ kind: "label", inline: [{ text: "Watch", bold: true }] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[4]).toMatchObject({ kind: "paragraph" });
    expect((blocks[4] as { lines: unknown[] }).lines).toHaveLength(2);
  });

  it("keeps one list across blank lines between bullets", () => {
    const blocks = parseMarkdown("- one\n\n- two\n\n  - two a");
    expect(blocks).toHaveLength(1);
  });

  it("never returns raw # or ** characters", () => {
    const plain = markdownToPlain("# Plan\n- **Top:** call\n  - **Why:** due today\nText with **bold**");
    expect(plain).toBe("Plan\n- Top: call\n  - Why: due today\n\nText with bold");
    expect(plain).not.toMatch(/\*\*|#/);
  });
});

describe("database update guard", () => {
  it("recognizes missing table and column errors", () => {
    expect(isMissingSchemaError({ code: "42P01", message: 'relation "public.targets" does not exist' })).toBe(true);
    expect(isMissingSchemaError({ code: "42703", message: "column contacts.relationship_group does not exist" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST205", message: "Could not find the table 'public.targets' in the schema cache" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST204", message: "Could not find the 'is_outreach' column of 'communications' in the schema cache" })).toBe(true);
    expect(isMissingSchemaError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});

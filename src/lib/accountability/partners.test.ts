import { describe, expect, it } from "vitest";
import { ALL_SECTIONS, cleanPartnerSettings, daysLabel, dueLine, firstName, getsLabel, isoWeekday, partnerSettings, partnersDueOn, REPORT_SECTIONS, sendLabel } from "./partners";
import { reportFor, reportInnerHtml, reportText, type ReportData } from "./report-email";

// 2026-11-02 is a Monday, 2026-11-06 a Friday, 2026-11-07 a Saturday.
const jake = { first: "Jake", ...partnerSettings({ report_days: [1, 2, 3, 4, 5], report_sections: ["today", "targets", "waiting", "tomorrow", "week", "review"] }) };
const sarah = { first: "Sarah", ...partnerSettings({ report_days: [5], report_sections: ["targets", "tomorrow", "week"] }) };

describe("which partners are due on a weekday", () => {
  it("reads the ISO weekday", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-06")).toBe(5);
    expect(isoWeekday("2026-11-08")).toBe(7);
  });
  it("Monday: only Jake; Friday: both; Saturday: no one", () => {
    expect(partnersDueOn([jake, sarah], "2026-11-02").map((p) => p.first)).toEqual(["Jake"]);
    expect(partnersDueOn([jake, sarah], "2026-11-06").map((p) => p.first)).toEqual(["Jake", "Sarah"]);
    expect(partnersDueOn([jake, sarah], "2026-11-07")).toEqual([]);
  });
  it("writes the line next to the send button and the button itself", () => {
    expect(dueLine([jake, sarah], "2026-11-02")).toBe("Only Jake is due today");
    expect(dueLine([jake, sarah], "2026-11-06")).toBe("Jake gets weekdays; Sarah gets Fridays");
    expect(dueLine([jake], "2026-11-02")).toBe("Jake gets weekdays");
    expect(dueLine([sarah], "2026-11-02")).toBe("No partner is due today");
    expect(dueLine([], "2026-11-02")).toBe("No accountability partner yet");
    expect(sendLabel(1)).toBe("Approve and send");
    expect(sendLabel(2)).toBe("Approve and send to 2");
  });
  it("labels the days", () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("every weekday");
    expect(daysLabel([5])).toBe("Fridays");
    expect(daysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(daysLabel([])).toBe("no days");
    // The Gets column of the partner table on End of day (2026-11-05).
    expect([[1, 2, 3, 4, 5], [5], [1, 3, 5], []].map((d) => getsLabel(d))).toEqual(["Weekdays", "Fridays", "Mon, Wed, Fri", "No days"]);
  });
});

describe("a partner's sections", () => {
  it("keeps the known sections in the report's order; unknown keys stay out of the checklist", () => {
    // Push D: the Weekly review is on unless it was unticked, so a partner saved before it gets it.
    expect(jake.sections).toEqual(["today", "targets", "waiting", "week", "review", "tomorrow"]);
    // "Deals moved" from before the push B edits reads as Active today.
    expect(partnerSettings({ report_days: [1], report_sections: ["today", "moved"] }).sections).toEqual(["today", "active", "review"]);
    expect(sarah.days).toEqual([5]);
  });
  it("a partner never set up gets every weekday and every section", () => {
    expect(partnerSettings({ report_days: [], report_sections: [] })).toEqual({ days: [1, 2, 3, 4, 5], sections: ALL_SECTIONS });
    expect(partnerSettings({})).toEqual({ days: [1, 2, 3, 4, 5], sections: ALL_SECTIONS });
  });
  it("no days is kept as no days once sections are saved", () => {
    expect(partnerSettings({ report_days: [], report_sections: ["targets", "review_off"] })).toEqual({ days: [], sections: ["targets"] });
  });
  it("Save: weekdays in order, at least one section, unknown saved keys kept", () => {
    expect(cleanPartnerSettings({ days: [5, 1, 1, 8], sections: ["week", "today", "nope"] }, ["today", "later_section"])).toEqual({ ok: true, days: [1, 5], sections: ["today", "week", "review_off", "later_section"] });
    // The work week (2026-11-07): Saturday and Sunday can be report days too.
    expect(cleanPartnerSettings({ days: [7, 6], sections: ["today"] }, [])).toMatchObject({ ok: true, days: [6, 7] });
    expect(daysLabel([6])).toBe("Saturdays");
    expect(daysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("every weekday");
  });
  it("Weekly review (push D): on by default, off only when unticked, and ticking it again clears the mark", () => {
    expect(partnerSettings({ report_days: [5], report_sections: ["targets"] }).sections).toEqual(["targets", "review"]);
    expect(partnerSettings({ report_days: [5], report_sections: ["targets", "review_off"] }).sections).toEqual(["targets"]);
    expect(cleanPartnerSettings({ days: [5], sections: ["targets"] }, ["targets"])).toEqual({ ok: true, days: [5], sections: ["targets", "review_off"] });
    expect(cleanPartnerSettings({ days: [5], sections: ["targets", "review"] }, ["targets", "review_off"])).toEqual({ ok: true, days: [5], sections: ["targets", "review"] });
    expect(REPORT_SECTIONS.map((x) => x.key)).toContain("review");
    expect(cleanPartnerSettings({ days: [1], sections: [] }, [])).toEqual({ ok: false, error: "Tick at least one section." });
  });
  it("first name", () => {
    expect(firstName("Sarah Klein")).toBe("Sarah");
  });
});

describe("each partner's copy of the report", () => {
  const base: ReportData = {
    partnerName: "Partner", partnerFirst: "there", dateLong: "Friday, Nov 6, 2026", dateShort: "Friday, Nov 6", withWeek: true,
    pill: { text: "4 of 6 targets met", status: "missed" },
    today: [{ label: "Listings screened", value: "6", small: "of 5", note: "", status: "met", pct: 100 }],
    targets: [{ id: "t1", group: "met", text: "Listings screened: 6 of 5", commitment: true, asks: false, reason: null }], owed: null,
    waits: [{ id: "d9", name: "Summit Logistics Group", days: 13, who: "Mark Reed" }], threshold: 5,
    deals: [{ id: "d1", name: "Dalton Services", stage: "NDA signed", position: 2, lastActivity: "2026-11-06T15:00:00Z", status: "Nothing waiting", next: null, activity: ["moved to NDA signed"] }],
    jobs: [], period: "this week",
    week: { label: "The week, Nov 2 to 6", tiles: [{ label: "Deals moved", value: "3", note: "", status: "neutral", pct: null }] },
    tomorrow: { label: "Monday", text: "Meridian partner deck and the Summit decision." },
  };
  it("Jake gets the counts, targets, the waits, the week, and tomorrow, but not the top deals", () => {
    const html = reportInnerHtml(reportFor(base, { name: "Jake Morgan", first: "Jake", sections: jake.sections }));
    expect(html).toContain("Hello Jake,");
    expect(html).toContain("Listings screened");
    expect(html).toContain("Summit Logistics Group");
    expect(html).not.toContain("Top 3 deals");
    expect(html).toContain("The week, Nov 2 to 6");
    expect(html).toContain("Meridian partner deck");
  });
  it("Sarah gets targets, the week, and Monday's line only", () => {
    const d = reportFor(base, { name: "Sarah Klein", first: "Sarah", sections: sarah.sections });
    const html = reportInnerHtml(d);
    expect(html).toContain("Hello Sarah,");
    expect(html).not.toContain(">Today<");
    expect(html).not.toContain("Summit Logistics Group");
    expect(html).toContain("Listings screened: 6 of 5");
    expect(html).toContain("The week, Nov 2 to 6");
    const text = reportText(d);
    expect(text).not.toContain("TODAY");
    expect(text).not.toContain("TOP 3 DEALS");
    expect(text).toContain("TARGETS");
    expect(text).toContain("MONDAY");
  });
  it("a report without sections keeps every section", () => {
    const html = reportInnerHtml(base);
    expect(html).toContain("Top 3 deals");
    expect(html).toContain("Dalton Services");
    expect(html).toContain("Summit Logistics Group");
  });
});

describe("the next report day", () => {
  it("today while the day is open, otherwise the next of the partner's days", async () => {
    const { nextReportDay } = await import("./partners");
    expect(nextReportDay([1, 2, 3, 4, 5], "2026-11-02", false)).toBe("2026-11-02");
    expect(nextReportDay([1, 2, 3, 4, 5], "2026-11-02", true)).toBe("2026-11-03");
    expect(nextReportDay([5], "2026-11-02", false)).toBe("2026-11-06");
    expect(nextReportDay([1, 2, 3, 4, 5], "2026-11-06", true)).toBe("2026-11-09");
    expect(nextReportDay([], "2026-11-02", false)).toBeNull();
  });
});

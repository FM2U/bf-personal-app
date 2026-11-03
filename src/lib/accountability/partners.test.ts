import { describe, expect, it } from "vitest";
import { ALL_SECTIONS, cleanPartnerSettings, daysLabel, dueLine, firstName, isoWeekday, partnerSettings, partnersDueOn, sendLabel } from "./partners";
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
  });
});

describe("a partner's sections", () => {
  it("keeps the known sections in the report's order; unknown keys stay out of the checklist", () => {
    expect(jake.sections).toEqual(["today", "targets", "waiting", "tomorrow", "week"]);
    expect(sarah.days).toEqual([5]);
  });
  it("a partner never set up gets every weekday and every section", () => {
    expect(partnerSettings({ report_days: [], report_sections: [] })).toEqual({ days: [1, 2, 3, 4, 5], sections: ALL_SECTIONS });
    expect(partnerSettings({})).toEqual({ days: [1, 2, 3, 4, 5], sections: ALL_SECTIONS });
  });
  it("no days is kept as no days once sections are saved", () => {
    expect(partnerSettings({ report_days: [], report_sections: ["targets"] })).toEqual({ days: [], sections: ["targets"] });
  });
  it("Save: weekdays in order, at least one section, unknown saved keys kept", () => {
    expect(cleanPartnerSettings({ days: [5, 1, 1, 6], sections: ["week", "today", "nope"] }, ["today", "review"])).toEqual({ ok: true, days: [1, 5], sections: ["today", "week", "review"] });
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
    deals: ["Dalton Services moved to NDA signed.", "Waiting on brokers over 5 days: Summit Logistics Group (13 days, Mark Reed)."],
    dealMoves: ["Dalton Services moved to NDA signed."], dealWaits: ["Waiting on brokers over 5 days: Summit Logistics Group (13 days, Mark Reed)."],
    targets: [{ met: true, judged: true, line: "Listings screened 6 of 5", commitment: true, reason: null }], owed: [],
    week: { label: "The week, Nov 2 to 6", tiles: [{ label: "Deals moved", value: "3", note: "", status: "neutral", pct: null }] },
    tomorrow: { label: "Monday", text: "Meridian partner deck and the Summit decision." },
  };
  it("Jake gets the counts, targets, the waits but not the moves, the week, and tomorrow", () => {
    const html = reportInnerHtml(reportFor(base, { name: "Jake Morgan", first: "Jake", sections: jake.sections }));
    expect(html).toContain("Hello Jake,");
    expect(html).toContain("Listings screened");
    expect(html).toContain("Summit Logistics Group");
    expect(html).not.toContain("Dalton Services moved");
    expect(html).toContain("The week, Nov 2 to 6");
    expect(html).toContain("Meridian partner deck");
  });
  it("Sarah gets targets, the week, and Monday's line only", () => {
    const d = reportFor(base, { name: "Sarah Klein", first: "Sarah", sections: sarah.sections });
    const html = reportInnerHtml(d);
    expect(html).toContain("Hello Sarah,");
    expect(html).not.toContain(">Today<");
    expect(html).not.toContain("Summit Logistics Group");
    expect(html).toContain("Listings screened 6 of 5");
    expect(html).toContain("The week, Nov 2 to 6");
    const text = reportText(d);
    expect(text).not.toContain("TODAY");
    expect(text).not.toContain("DEALS");
    expect(text).toContain("TARGETS");
    expect(text).toContain("MONDAY");
  });
  it("a report without sections (built before push B) keeps every section", () => {
    const html = reportInnerHtml(base);
    expect(html).toContain("Dalton Services moved");
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

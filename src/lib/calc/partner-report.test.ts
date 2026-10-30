import { describe, expect, it } from "vitest";
import {
  combinedOverall,
  defaultTemplateFor,
  legacyPeriodData,
  MEASURE_KEYS,
  missesFor,
  overallOf,
  periodDataFor,
  reportEmailHtml,
  reportEmailText,
  reportSections,
  STARTER_TEMPLATES,
  templateProblems,
  tilesFor,
  toTemplate,
  type PeriodData,
  type ReportTemplate,
} from "./partner-report";

const week: PeriodData = {
  start: "2026-10-23",
  end: "2026-10-29",
  commitments: { met: 9, missed: 1, pct: 90, missedTitles: ["Call Sample Broker"] },
  tasks: { done: 12, overdue: 3 },
  targets: [
    { name: "Network outreach", source: "communications_outreach", period: "day", total: 12, required: 15, met: 4, missed: 1, pct: 80 },
    { name: "Deals sourced", source: "deals_sourced", period: "day", total: 25, required: 25, met: 5, missed: 0, pct: 100 },
    { name: "Listings screened", source: "manual", period: "day", total: 40, required: 100, met: 1, missed: 4, pct: 20 },
    { name: "CIMs reviewed", source: "cims_reviewed", period: "day", total: 4, required: 5, met: 4, missed: 1, pct: 80 },
    { name: "Broker or owner calls", source: "deal_calls", period: "week", total: 2, required: 2, met: 1, missed: 0, pct: 100 },
  ],
  outreach: { sent: 12, replyRatePct: 25, meetings: 2 },
  dealsSourced: 25,
  moves: [
    { pipeline: "Acquisitions", count: 4 },
    { pipeline: "Jobs", count: 1 },
  ],
  runway: { months: 10.4, target: 12 },
  milestones: { due: 2, met: 1, missed: 1, missedTitles: ["First LOI sent"] },
};
const snapshot = { measures: { week, two_weeks: { ...week, start: "2026-10-16" }, month: { ...week, start: "2026-09-30" } } };
const report = { period_start: "2026-10-23", period_end: "2026-10-29", summary: "- **Runway:** 10.4 months.\n- Cash is fine.", snapshot };
const standard = STARTER_TEMPLATES[1];
const detailed = STARTER_TEMPLATES[2];

describe("partner report templates", () => {
  it("has three starter templates, Detailed with every measure, all weekly", () => {
    expect(STARTER_TEMPLATES.map((t) => t.name)).toEqual(["Summary", "Standard", "Detailed"]);
    expect(detailed.measures).toEqual(MEASURE_KEYS);
    expect(STARTER_TEMPLATES.every((t) => t.period === "week")).toBe(true);
  });
  it("cleans a database row: unknown measures dropped, catalog order, valid period", () => {
    const t = toTemplate({ id: "x", name: "Mine", measures: ["runway_months", "nonsense", "tasks_done"], period: "year", note: "n" });
    expect(t).toEqual({ id: "x", name: "Mine", measures: ["tasks_done", "runway_months"], period: "week", note: "n", starter_key: null });
  });
  it("lists what is wrong with a template in plain words", () => {
    expect(templateProblems({ name: " ", measures: [], period: "week" })).toEqual(["Give the template a name.", "Choose at least one measure."]);
    expect(templateProblems({ name: "Ok", measures: ["tasks_done"], period: "month", note: "x".repeat(301) })).toEqual(["Keep the note to 300 characters or fewer."]);
    expect(templateProblems({ name: "Ok", measures: ["tasks_done"], period: "two_weeks" })).toEqual([]);
  });
  it("uses the partner's template, otherwise Standard", () => {
    const mine: ReportTemplate = { ...standard, id: "mine", name: "Mine", starter_key: null };
    expect(defaultTemplateFor([...STARTER_TEMPLATES, mine], "mine").name).toBe("Mine");
    expect(defaultTemplateFor(STARTER_TEMPLATES, null).name).toBe("Standard");
    expect(defaultTemplateFor(STARTER_TEMPLATES, "deleted-id").name).toBe("Standard");
  });
});

describe("partner report tiles", () => {
  it("shows the Standard measures with values, bars, and colors", () => {
    const tiles = tilesFor(standard.measures, week);
    expect(tiles.map((t) => [t.key, t.value, t.status])).toEqual([
      ["completion_pct", "90%", "met"],
      ["commitments_met", "9", "met"],
      ["commitments_missed", "1", "soon"],
      ["tasks_done", "12", "soon"],
      ["tasks_overdue", "3", "missed"],
      ["deals_sourced", "25", "met"],
      ["outreach_done", "12", "soon"],
      ["targets_met_pct", "71%", "soon"],
    ]);
    expect(tiles[5]).toMatchObject({ pct: 100, note: "of 25 required" });
  });
  it("adds a tile per pipeline for pipeline moves and the detailed target counts", () => {
    const tiles = tilesFor(detailed.measures, week);
    expect(tiles.filter((t) => t.key.startsWith("pipeline_moves")).map((t) => t.label)).toEqual(["Moves: Acquisitions", "Moves: Jobs"]);
    expect(tiles.find((t) => t.key === "listings_screened")).toMatchObject({ value: "40", pct: 40, status: "missed" });
    expect(tiles.find((t) => t.key === "deal_calls")).toMatchObject({ value: "2", status: "met" });
    expect(tiles.find((t) => t.key === "runway_months")).toMatchObject({ value: "10.4 months", status: "soon", pct: 87 });
    expect(tiles.find((t) => t.key === "milestones_due")).toMatchObject({ value: "2", status: "missed" });
    expect(tiles.find((t) => t.key === "reply_rate")).toMatchObject({ value: "25%", status: "neutral" });
  });
  it("leaves out measures with no saved numbers", () => {
    expect(tilesFor(["tasks_done", "runway_months"], { start: "a", end: "b" })).toEqual([]);
  });
  it("scores only tiles with a target: 80% green, 50% amber, below red", () => {
    expect(overallOf([{ key: "a", label: "", value: "", pct: null, status: "met", note: "" }, { key: "b", label: "", value: "", pct: null, status: "neutral", note: "" }])).toMatchObject({ status: "met", text: "1 of 1 on track" });
    const tiles = tilesFor(standard.measures, week);
    expect(overallOf(tiles)).toMatchObject({ onTrack: 3, total: 8, status: "missed", text: "3 of 8 on track" });
    expect(overallOf([])).toMatchObject({ status: "neutral", text: "Nothing to score" });
  });
});

describe("partner report misses", () => {
  it("lists missed commitments, missed target days, milestones, and overdue tasks for the template's measures", () => {
    expect(missesFor(detailed.measures, week)).toEqual([
      "Missed: Call Sample Broker",
      "Network outreach: 1 of 5 days missed",
      "Listings screened: 4 of 5 days missed",
      "CIMs reviewed: 1 of 5 days missed",
      "Milestone missed: First LOI sent",
      "3 tasks overdue",
    ]);
  });
  it("keeps the list short", () => {
    const many = { ...week, commitments: { met: 0, missed: 9, pct: 0, missedTitles: ["a", "b", "c", "d", "e", "f", "g"] } };
    const out = missesFor(["commitments_missed"], many);
    expect(out).toHaveLength(6);
    expect(out[5]).toBe("3 more");
  });
  it("shows only the template's own misses", () => {
    expect(missesFor(["completion_pct"], week)).toEqual(["Missed: Call Sample Broker"]);
    expect(missesFor(["listings_screened", "deal_calls"], week)).toEqual(["Listings screened: 4 of 5 days missed"]);
    const one = { ...week, targets: [{ name: "CIMs reviewed", source: "cims_reviewed", period: "day" as const, total: 0, required: 1, met: 0, missed: 1, pct: 0 }] };
    expect(missesFor(["cims_reviewed"], one)).toEqual(["CIMs reviewed: 1 of 1 day missed"]);
  });
});

describe("partner report periods and older reports", () => {
  it("uses the saved numbers for the template's period", () => {
    const month = { ...standard, period: "month" as const };
    const [s] = reportSections({ partnerName: "Sample Partner A", report, templates: [month], link: null });
    expect(s.start).toBe("2026-09-30");
    expect(s.period).toBe("Sep 30 to Oct 29, 2026");
    expect(s.exact).toBe(true);
  });
  it("falls back to an older report's own numbers", () => {
    const old = { commitments: { score: { met: 3, missed: 1, pct: 75 } }, targets: [{ name: "Network outreach", period: "day", total: 10, required: 15, met: 3, missed: 2, pct: 60 }], milestones: { completed: [{ title: "A" }], missed: [{ title: "B" }] } };
    const { data, exact } = periodDataFor(old, "week", { period_start: "2026-10-01", period_end: "2026-10-07" });
    expect(exact).toBe(false);
    expect(data.commitments).toEqual({ met: 3, missed: 1, pct: 75, missedTitles: [] });
    expect(tilesFor(standard.measures, data).map((t) => t.key)).toEqual(["completion_pct", "commitments_met", "commitments_missed", "targets_met_pct"]);
    expect(legacyPeriodData({}, { period_start: "a", period_end: "b" })).toEqual({ start: "a", end: "b" });
  });
});

describe("partner report email", () => {
  const input = { partnerName: "Sample Partner A", report, templates: [STARTER_TEMPLATES[0], { ...detailed, note: "Focus: <deal flow> & calls" }], link: "https://app.example.com/report/abc" };
  const html = reportEmailHtml(input);
  it("is email-safe: tables and inline styles, no style blocks, scripts, images, or classes", () => {
    expect(html).toMatch(/^<table role="presentation"/);
    expect(html).not.toMatch(/<style|<script|<img|class=|<link|javascript:/i);
    expect(html).toContain("max-width:600px");
  });
  it("has the header with the period, the overall pill, and the gold line under it", () => {
    expect(html).toContain("Oct 23 to Oct 29, 2026");
    expect(html).toContain("background-color:#d9bd84");
    expect(html.indexOf("Oct 23 to Oct 29, 2026")).toBeLessThan(html.indexOf("#d9bd84"));
    const overall = combinedOverall(reportSections(input));
    expect(html).toContain(overall.text);
  });
  it("shows both templates, escapes the note, and draws bars as colored table cells", () => {
    expect(html).toContain(">Summary <span");
    expect(html).toContain(">Detailed <span");
    expect(html).toContain("Focus: &lt;deal flow&gt; &amp; calls");
    expect(html).toMatch(/<td width="40%" style="width:40%;height:4px;line-height:4px;font-size:0;background-color:#dc2626/);
    expect(html).toContain("Misses");
    expect(html).toContain("Missed: Call Sample Broker");
    expect(html).toContain('href="https://app.example.com/report/abc"');
  });
  it("uses tiles 140px wide at most that wrap (4 per row at 600px, 2 on a phone), with fixed label and note heights", () => {
    const tiles = html.match(/<div style="display:inline-block;width:100%;max-width:140px;/g) ?? [];
    expect(tiles.length).toBe(reportSections(input).reduce((n, s) => n + s.tiles.length, 0));
    expect(4 * 140).toBeLessThanOrEqual(600 - 2 - 2 * 16);
    expect(html).toContain("height:32px;overflow:hidden");
  });
  it("keeps a plain text part with the same numbers", () => {
    const t = reportEmailText(input);
    expect(t.subject).toBe("Accountability report: Oct 23 to Oct 29, 2026");
    expect(t.body).toContain("SUMMARY (Oct 23 to Oct 29, 2026)");
    expect(t.body).toContain("- Commitments completed: 90% (9 of 10 met)");
    expect(t.body).toContain("MISSES\n- Missed: Call Sample Broker");
    expect(t.body).toContain("- Runway: 10.4 months.");
    expect(t.body).not.toContain("**");
    expect(t.body).toContain("https://app.example.com/report/abc");
  });
});

describe("daily partner reports (the day period)", () => {
  const day: PeriodData = { start: "2026-10-30", end: "2026-10-30", commitments: { met: 2, missed: 1, pct: 67, missedTitles: ["Send the LOI"] }, tasks: { done: 5, overdue: 1 } };
  const dailySnapshot = { measures: { day, week }, report_kind: "daily" };
  it("a daily report shows today's numbers whichever period the template has", () => {
    const [s] = reportSections({ partnerName: "Pat", report: { period_start: "2026-10-30", period_end: "2026-10-30", snapshot: dailySnapshot }, templates: [STARTER_TEMPLATES[1]], link: null });
    expect(s.template.period).toBe("day");
    expect(s.period).toBe("Fri, Oct 30, 2026");
    expect(s.tiles.find((t) => t.key === "commitments_met")?.value).toBe("2");
    expect(s.tiles.find((t) => t.key === "tasks_done")?.value).toBe("5");
  });
  it("the subject and the header say daily", () => {
    const input = { partnerName: "Pat", report: { period_start: "2026-10-30", period_end: "2026-10-30", snapshot: dailySnapshot }, templates: [STARTER_TEMPLATES[0]], link: null };
    expect(reportEmailText(input).subject).toBe("Daily accountability report: Fri, Oct 30, 2026");
    expect(reportEmailHtml(input)).toContain("Daily accountability report");
  });
  it("a regular report keeps the template's period; a day template saves", () => {
    const [s] = reportSections({ partnerName: "Pat", report, templates: [STARTER_TEMPLATES[1]], link: null });
    expect(s.template.period).toBe("week");
    expect(toTemplate({ id: "d", name: "Today", measures: ["tasks_done"], period: "day" }).period).toBe("day");
    expect(templateProblems({ name: "Today", measures: ["tasks_done"], period: "day" })).toEqual([]);
  });
});

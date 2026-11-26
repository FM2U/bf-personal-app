import { describe, expect, it } from "vitest";
import { buildTracks, dayWithWeekday, money, nowLine, pickMeta, reportNext } from "./report-v8";
import { buildSections, sentSections, type ReportData } from "./report-sections";
import { reportInnerHtml, reportSubject, reportText } from "./report-email";
import type { PriorityColumns } from "@/lib/work/priorities";

const DAY = "2026-11-17";
const local = (ts: string) => ts.slice(0, 10);
const stageById = Object.fromEntries(
  [["s1", "Interested"], ["s2", "NDA signed"], ["s3", "CIM review"], ["s4", "Broker call"], ["s5", "Seller call"], ["s6", "Diligence"], ["s7", "Partner presentation"], ["s8", "IOI or LOI"], ["s9", "Confirmatory diligence"], ["s10", "Passed"], ["j1", "Lead"], ["j2", "Applied"], ["j3", "Interview"], ["j4", "Offer"], ["c1", "Lead"], ["c2", "Intro call"], ["c3", "Proposal sent"], ["c4", "Engagement"], ["c5", "Paid"]].map(([id, name]) => [id, { name, outcome: id === "s10" ? "lost" : "open" }]),
);
const pick = (o: Partial<PriorityColumns["acquisition"][number]>) => ({ id: "x", table: "pipeline_items" as const, kind: "acquisition" as const, number: 1, rank: 1, name: "X", href: "", stage: null, strength: null, day: null, movedToday: false, why: null, next: null, ...o });

describe("the report's tracks (v8, 2026-11-15)", () => {
  const items = [
    { id: "dalton", pipeline_id: "acq", stage_id: "s5", status: "open", screened: true, what_it_does: "HVAC service", location: "Columbus OH", next_action: "Call the owner", next_action_due: "2026-11-19" },
    { id: "meridian", pipeline_id: "acq", stage_id: "s6", status: "open", screened: true },
    { id: "nda", pipeline_id: "acq", stage_id: "s2", status: "open", screened: true },
    { id: "loi", pipeline_id: "acq", stage_id: "s9", status: "open", screened: true },
    { id: "listing", pipeline_id: "acq", stage_id: null, status: "open", screened: false },
    { id: "harbor", pipeline_id: "acq", stage_id: "s10", status: "lost", screened: true, name: "Harbor Plumbing" },
    { id: "acme", pipeline_id: "job", stage_id: "j3", status: "open", pay_range: "$220 to 250K" },
    { id: "sw", pipeline_id: "con", stage_id: "c5", status: "open", fee: 9000 },
  ];
  const history = [
    { item_id: "dalton", stage_id: "s4", entered_at: "2026-11-10T10:00:00Z" },
    { item_id: "dalton", stage_id: "s5", entered_at: "2026-11-17T15:00:00Z" },
    { item_id: "nda", stage_id: "s1", entered_at: "2026-11-15T10:00:00Z" },
    { item_id: "nda", stage_id: "s2", entered_at: "2026-11-16T10:00:00Z" },
    { item_id: "acme", stage_id: "j3", entered_at: "2026-11-16T10:00:00Z" },
    { item_id: "sw", stage_id: "c5", entered_at: "2026-11-02T10:00:00Z" },
  ];
  const columns: PriorityColumns = {
    acquisition: [pick({ id: "dalton", name: "Dalton Services", stage: "Seller call", strength: "hot", day: 23, movedToday: true, why: "70% recurring", next: { text: "Go or no-go on an LOI", on: "2026-11-25", movedFrom: null, passed: false } })],
    job: [pick({ id: "acme", kind: "job", name: "VP Operations, Acme Health", stage: "Interview", day: 9 })],
    consulting: [],
    startup: [pick({ id: "rosara", table: "projects", kind: "startup", name: "Rosara", stage: "Customer interviews", day: 40 })],
  };
  const t = buildTracks({
    columns,
    items,
    projects: [{ id: "rosara", name: "Rosara", next_action: "Interview two agency owners" }],
    ebitda: new Map([["dalton", 2_100_000]]),
    history,
    stageById,
    pipes: { acquisition: "acq", job: "job", consulting: "con" },
    decisions: [
      { pipeline_item_id: "harbor", decided_on: "2026-11-16", outcome: "no_go", line: "Two customers are 60% of revenue" },
      { pipeline_item_id: "harbor", decided_on: "2026-11-01", outcome: "go", line: "older" },
    ],
    screenedThisWeek: 14,
    weekStart: "2026-11-14",
    day: DAY,
    local,
    startupActive: true,
  });

  it("each pick: the facts line, Why, Now from the next action, Next with its weekday", () => {
    const d = t.acquisition.picks[0];
    expect(d).toMatchObject({ name: "Dalton Services", meta: "HVAC service, Columbus OH · $2.1M EBITDA", since: "day 23 since first contact", moved: "moved to Seller call today", why: "70% recurring", now: "call the owner, Thu, Nov 19", next: { words: "go or no-go on an LOI by Wed, Nov 25", amber: false } });
    expect(t.job.picks[0]).toMatchObject({ meta: "$220 to 250K", since: "day 9 since first contact" });
    expect(t.startup.picks[0]).toMatchObject({ now: "interview two agency owners", since: "day 40 since start" });
  });

  it("Decided this week: the week's decisions of the track, with the line", () => {
    expect(t.acquisition.decided).toBe("Harbor Plumbing, no-go on Nov 16 (two customers are 60% of revenue)");
    expect(t.job.decided).toBeNull();
  });

  it("the Pipeline table (2026-11-25: no Screened row, four rows that hold every open deal): each column's records open now and entered this week", () => {
    expect(t.acquisition.pipeline!.map((c) => ({ label: c.label, added: c.added, inStage: c.inStage }))).toEqual([
      // nda entered Interested and NDA signed this week: one record, counted once.
      { label: "CIM review", added: 1, inStage: 1 },
      // dalton moved from Broker call to Seller call this week: the same column, so not added.
      { label: "Broker + seller calls", added: 0, inStage: 1 },
      { label: "Diligence", added: 0, inStage: 1 },
      { label: "IOI/LOI", added: 0, inStage: 1 },
    ]);
    // Every column says what reached it today and the day the week's count starts on.
    expect(t.acquisition.pipeline!.every((c) => typeof c.today === "number" && typeof c.since === "string" && c.today <= (c.added ?? 0))).toBe(true);
    expect(t.job.pipeline!.map((c) => [c.label, c.added, c.inStage])).toEqual([["Lead", 0, 0], ["Applied", 0, 0], ["Interview", 1, 1], ["Offer", 0, 0]]);
    // Paid counts under Engagement.
    expect(t.consulting.pipeline!.map((c) => [c.label, c.inStage])).toEqual([["Lead", 0], ["Intro call", 0], ["Proposal sent", 0], ["Engagement", 1]]);
    expect(t.startup.pipeline).toBeNull();
  });

  const report: ReportData = {
    layout: "v8",
    opening: "Most of today went to Dalton.",
    tracks: t,
    signName: "Bram",
    partnerName: "Jake Morgan", partnerFirst: "Jake", dateLong: "Tuesday, Nov 17, 2026", dateShort: "Tuesday, Nov 17", withWeek: false,
    pill: { text: "x", status: "neutral" }, today: [], targets: [], owed: null, waits: [], threshold: 5, deals: [], jobs: [], period: "today", week: null,
    tomorrow: { label: "Tomorrow", text: "Dalton financials review." },
  };

  it("the email: opening under the greeting, the tracks with their tables, Startup on a startup day, no pill, no 'Nothing is required'", () => {
    // Consulting has no pick but an open record, so it shows its pipeline with a quiet line.
    expect(sentSections(report).map((s) => s.key)).toEqual(["opening", "acquisition", "jobs", "consulting", "startup", "tomorrow"]);
    const html = reportInnerHtml(report);
    expect(html).toContain("Hey Jake,");
    expect(html).toContain("Most of today went to Dalton.");
    expect(html).toContain("Acquisition · top priorities");
    expect(html).toContain("Job search · top priorities");
    expect(html).toContain("Startup · initiatives");
    expect(html).toContain("No top priorities chosen.");
    expect(html).toContain("&#9650; moved to Seller call today");
    expect(html).toContain("Decided this week:");
    expect((html.match(/data-pipeline="1"/g) ?? []).length).toBe(3);
    expect(html).not.toContain("Nothing is required");
    expect(html).not.toContain("targets met");
    expect(html).toContain("Thank you,<br>Bram");
    expect(reportSubject(report)).toBe("Daily report: Tuesday, Nov 17, 2026");
    const text = reportText(report);
    expect(text).toContain("ACQUISITION · TOP PRIORITIES");
    expect(text).toContain("1. Dalton Services · HVAC service, Columbus OH · $2.1M EBITDA");
    expect(text).toContain("  Now: call the owner, Thu, Nov 19");
    expect(text).toMatch(/Pipeline: CIM review 1 in process, (0|\+1) today, \+1 this week · Broker \+ seller calls 1 in process, 0 today, 0 this week/);
    expect(text).not.toContain("Nothing is required");
  });

  it("Startup only on a day with startup work; Change hides a pick; a list saved before the redesign gets every section", () => {
    const quiet = { ...report, tracks: { ...t, startupActive: false } };
    expect(sentSections(quiet).map((s) => s.key)).not.toContain("startup");
    const hid = { ...report, choices: { hidden: { acquisition: ["dalton"] } } };
    const acq = buildSections(hid).find((s) => s.key === "acquisition")!;
    expect(acq.picks).toEqual([]);
    expect(acq.choices).toEqual([{ id: "dalton", label: "Dalton Services", on: false }]);
    expect(sentSections({ ...report, sections: ["today", "targets", "tomorrow"] }).map((s) => s.key)).toEqual(["opening", "acquisition", "jobs", "consulting", "startup", "tomorrow"]);
    expect(sentSections({ ...report, sections: ["acquisition", "tomorrow"] }).map((s) => s.key)).toEqual(["acquisition", "tomorrow"]);
  });

  it("Added this week counts a record that came into the column from another one, once", () => {
    const tt = buildTracks({
      columns: { acquisition: [], job: [], consulting: [], startup: [] },
      items: [{ id: "a", pipeline_id: "acq", stage_id: "s6", status: "open", screened: true }],
      projects: [],
      ebitda: new Map(),
      history: [
        { item_id: "a", stage_id: "s3", entered_at: "2026-11-01T10:00:00Z" },
        { item_id: "a", stage_id: "s5", entered_at: "2026-11-15T10:00:00Z" },
        { item_id: "a", stage_id: "s6", entered_at: "2026-11-16T10:00:00Z" },
      ],
      stageById,
      pipes: { acquisition: "acq", job: null, consulting: null },
      decisions: [],
      screenedThisWeek: 0,
      weekStart: "2026-11-14",
      day: DAY,
      local,
      startupActive: false,
    });
    expect(tt.acquisition.pipeline!.map((c) => [c.label, c.added, c.inStage])).toEqual([["CIM review", 0, 0], ["Broker + seller calls", 1, 0], ["Diligence", 1, 1], ["IOI/LOI", 0, 0]]);
    expect(tt.job.pipeline).toBeNull();
  });

  it("helpers", () => {
    expect(dayWithWeekday("2026-11-25")).toBe("Wed, Nov 25");
    expect(money(2_100_000)).toBe("$2.1M");
    expect(money(9000)).toBe("$9K");
    expect(money(1500)).toBe("$1.5K");
    expect(pickMeta("consulting", { fee: 9000 }, null)).toBe("$9K project");
    expect(pickMeta("startup", { goal: "x" }, null)).toBeNull();
    expect(nowLine({ next_action: "Send the deck" })).toBe("send the deck");
    expect(nowLine({})).toBeNull();
    expect(reportNext({ text: "Go or no-go", on: "2026-12-01", movedFrom: "2026-11-20", passed: false })).toEqual({ words: "go or no-go, moved from Nov 20 to Dec 1", amber: true });
    expect(reportNext({ text: "Decide", on: "2026-11-10", movedFrom: null, passed: true })).toEqual({ words: "decide by Nov 10, passed", amber: true });
  });
});

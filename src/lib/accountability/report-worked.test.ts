import { describe, expect, it } from "vitest";
import type { ActivityRow } from "./activity";
import { buildWorked, keptBox, recordOfRow, rowsLine, rowWords, subjectCounts, todayBox, earningsOf, sizeOf } from "./report-worked";
import { buildSections, type ReportData } from "./report-sections";
import { reportInnerHtml, reportSubject, reportText } from "./report-email";
import type { PriorityColumns } from "@/lib/work/priorities";

const D1 = "11111111-1111-4111-8111-111111111111"; // Moody, top priority 1
const D2 = "22222222-2222-4222-8222-222222222222"; // AI back office, new today, moved
const D3 = "33333333-3333-4333-8333-333333333333"; // a deal worked on, not a pick
const D4 = "44444444-4444-4444-8444-444444444444"; // a passed listing
const J1 = "55555555-5555-4555-8555-555555555555"; // a job
const P1 = "66666666-6666-4666-8666-666666666666"; // a Rosara project
const DAY = "2026-11-17";
const local = (ts: string) => ts.slice(0, 10);
const stageById = { s1: { name: "Interested", outcome: "open" }, s2: { name: "NDA signed", outcome: "open" }, s3: { name: "Diligence", outcome: "open" }, s4: { name: "Interview", outcome: "open" }, s5: { name: "Applied", outcome: "open" }, s9: { name: "Passed", outcome: "lost" } };
const pipes = { acquisition: "pa", job: "pj", consulting: "pc" };

const item = (id: string, x: Record<string, unknown>) => ({ id, pipeline_id: "pa", status: "open", screened: true, created_at: "2026-11-09T12:00:00Z", stage_entered_at: "2026-11-12T12:00:00Z", ...x });
const items = [
  item(D1, { name: "Moody", company_name: "Moody & Associates Law Office", stage_id: "s3", what_it_does: "elder law and estate planning", location: "Perry, GA", why_fits: "Elder law demand rises with an aging population.", strength: "hot", next_action: "Ask Reid how they reached the price", next_action_due: "2026-11-18" }),
  item(D2, { name: "00 AI-Enabled Back-Office Operations Provider", stage_id: "s2", created_at: "2026-11-17T14:00:00Z", stage_entered_at: "2026-11-17T16:00:00Z", why_fits: "Recurring subscription revenue.", next_action: "Ask the broker for the CIM", next_action_due: "2026-11-19" }),
  item(D3, { name: "Dalton Services", stage_id: "s1" }),
  item(D4, { name: "Passed Listing Co", stage_id: "s9", status: "lost" }),
  item(J1, { name: "Harbor Health", role_title: "VP Operations", pipeline_id: "pj", stage_id: "s4", pay_range: "$180K to $210K", strength: "warm", stage_entered_at: "2026-11-17T15:00:00Z" }),
];
const projects = [{ id: P1, name: "Rosara: agency interviews", status: "open", milestone: "Research", created_at: "2026-11-01T12:00:00Z", next_action: "Write up the five most common problems", next_action_due: "2026-11-20" }];
const history = [
  { item_id: D2, stage_id: "s1", entered_at: "2026-11-17T14:00:00Z" },
  { item_id: D2, stage_id: "s2", entered_at: "2026-11-17T16:00:00Z" },
  { item_id: J1, stage_id: "s5", entered_at: "2026-11-10T12:00:00Z" },
  { item_id: J1, stage_id: "s4", entered_at: "2026-11-17T15:00:00Z" },
];
const columns = { acquisition: [{ id: D1, number: 1 }], job: [], consulting: [], startup: [] } as unknown as PriorityColumns;
const row = (id: string, text: string, href: string | null, x: Partial<ActivityRow> = {}): ActivityRow => ({ id, kind: "work", text, record: null, time: null, href, ...x });
const rows: ActivityRow[] = [
  row("comm:1", "Deal structure, 60 min", `/work/deals/${D1}`),
  row("listing:x", "Screened and marked Interested", `/work/deals/${D2}`),
  row("move:x", "Moved from Interested to NDA signed", `/work/deals/${D2}`),
  row("cal:e1", "Dalton broker call, 30 min", "/work/people/p1", { recordHref: `/work/deals/${D3}` }),
  row("listing:y", "Screened and passed (too small)", `/work/deals/${D4}`),
  row("comm:2", "Call with David Aferiat, 45 min", "/work/people/p9"),
  row("comm:3", "First interview with the COO, 45 min", `/work/jobs/${J1}`),
  row("done:x", "Two calls with agency owners", `/work/rosara/${P1}`),
];

const build = (over: Partial<Parameters<typeof buildWorked>[0]> = {}) =>
  buildWorked({ rows, items, projects, pipes, stageById, history, columns, ebitda: new Map(), day: DAY, local, todayText: { [D1]: "about an hour on the deal structure" }, ...over });

describe("the new daily report: worked on today (release 4, 2026-11-16)", () => {
  it("finds the record a row is about from its link; people are not records", () => {
    expect(recordOfRow({ href: `/work/deals/${D1}` })).toEqual({ table: "pipeline_items", id: D1 });
    expect(recordOfRow({ href: `/work/rosara/${P1.toUpperCase()}` })).toEqual({ table: "projects", id: P1 });
    expect(recordOfRow({ href: "/work/people/p1", recordHref: `/work/jobs/${J1}` })).toEqual({ table: "pipeline_items", id: J1 });
    expect(recordOfRow({ href: "/work/people/p1" })).toBeNull();
    expect(recordOfRow({ href: null })).toBeNull();
  });

  it("lists each track's records with kept activity: top priorities first, then new today, then the rest; closed records and people stay out", () => {
    const w = build();
    expect(w.acquisition.map((r) => [r.mark, r.name])).toEqual([
      [1, "Moody & Associates Law Office"],
      ["+", "AI-Enabled Back-Office Operations Provider"],
      ["dot", "Dalton Services"],
    ]);
    expect(w.job.map((r) => r.name)).toEqual(["VP Operations, Harbor Health"]);
    expect(w.consulting).toEqual([]);
    expect(w.startup.map((r) => [r.mark, r.name, r.stage, r.since])).toEqual([["dot", "Rosara: agency interviews", "Research", "day 17 since start"]]);
  });

  it("gives each record its Upside, facts, day N or new today, the move, the Today line and the Next line", () => {
    const w = build();
    const moody = w.acquisition[0];
    expect(moody).toMatchObject({ upside: "Elder law demand rises with an aging population.", stage: "Diligence", strength: "hot", since: "day 9 since first contact", moved: null, today: "about an hour on the deal structure", next: "ask Reid how they reached the price, Wed, Nov 18", meta: "elder law and estate planning, Perry, GA" });
    const fresh = w.acquisition[1];
    expect(fresh).toMatchObject({ since: "new today", moved: "moved from Interested today", today: "screened and marked Interested; moved from Interested to NDA signed" });
    expect(w.job[0]).toMatchObject({ moved: "moved from Applied today", strength: "warm", meta: "$180K to $210K" });
  });

  it("leaves a dropped row's record out, and a track with nothing kept is empty", () => {
    const w = build({ rows: rows.filter((r) => r.id !== "comm:3") });
    expect(w.job).toEqual([]);
    expect(build({ rows: [] })).toEqual({ acquisition: [], job: [], consulting: [], startup: [] });
  });

  it("writes the kept rows in plain words when no Today line is saved, cut at 220 characters; names keep capitals, notes stay in the app, no '00 '", () => {
    expect(rowsLine([row("a", "Call with Mark, 30 min", null), row("b", "Call with Mark, 30 min", null), row("c", "Offer low at 2.1x", null, { kind: "note" })])).toBe("call with Mark, 30 min; added notes");
    expect(rowWords({ kind: "calendar", text: "Dalton broker call, 30 min" })).toBe("Dalton broker call, 30 min");
    expect(rowWords({ kind: "move", text: "Moved from Interested to NDA signed" })).toBe("moved from Interested to NDA signed");
    expect(rowWords({ kind: "work", text: "Model for 00 Testing Laboratory, 60 min" })).toBe("Model for Testing Laboratory, 60 min");
    expect(rowsLine([])).toBeNull();
    expect(rowsLine([row("a", "x".repeat(400), null)])!.length).toBe(220);
  });

  it("counts the box from the kept rows: a dropped listing, move, call or email is not counted; job moves are not deals", () => {
    const kept: ActivityRow[] = [
      row("listing:a", "Screened and marked Interested", `/work/deals/${D2}`, { kind: "listing" }),
      row("listing:b", "Screened and passed (Too small)", `/work/deals/${D2}`, { kind: "listing" }),
      row("move:a", "Moved", `/work/deals/${D2}`, { kind: "move" }),
      row("move:b", "Moved", `/work/jobs/${J1}`, { kind: "move" }),
      row("comm:1", "Call with Rachel", `/work/people/p1`, { kind: "call" }),
      row("comm:2", "Meeting with Mark", `/work/people/p2`, { kind: "meeting" }),
    ];
    const comms = [
      { rowId: "comm:1", contactId: "p1", broker: true, method: "call" },
      { rowId: "comm:2", contactId: "p2", broker: false, method: "meeting" },
      { rowId: "comm:3", contactId: "p1", broker: true, method: "email" },
      { rowId: "comm:4", contactId: "p3", broker: true, method: "email" },
      { rowId: "comm:5", contactId: null, broker: false, method: "call" },
    ];
    const box = keptBox({ kept, dropped: new Set(["comm:4"]), comms, acquisitionIds: new Set([D2]), reviewed: 15 });
    // Listings reviewed 15 (entered by hand), deals added 1 (the pass is not a deal added), moved 1, brokers 1, calls 2, outreach 3.
    expect(box.map((c) => c.value)).toEqual([15, 1, 1, 1, 2, 3]);
  });

  it("keeps the day counts to the same six, and the subject names up to three above zero", () => {
    const box = todayBox({ reviewed: 15, added: 2, moved: 3, brokers: 4, calls: 1, outreach: 0 });
    expect(box.map((c) => `${c.label} ${c.value}`)).toEqual(["Listings reviewed 15", "Deals added 2", "Deals moved 3", "Brokers contacted 4", "Calls and meetings 1", "Network outreach 0"]);
    expect(subjectCounts(box)).toBe("15 listings reviewed, 2 deals added, 3 deals moved");
    expect(subjectCounts(todayBox({ reviewed: 0, added: 1, moved: 1, brokers: 0, calls: 1, outreach: 2 }))).toBe("1 deal added, 1 deal moved, 1 call or meeting");
    expect(subjectCounts(todayBox({ reviewed: 0, added: 0, moved: 0, brokers: 0, calls: 0, outreach: 0 }))).toBe("");
  });

  it("builds the email in layout H: one numbered card per record worked on today, the priority mark, Today and Next, Upside and Size under a hairline, the counts in the opening card, a pipeline card", () => {
    const worked = build();
    const pipeline = [{ label: "CIM review", added: 4, inStage: 5, today: 1, since: "Monday" }, { label: "Broker + seller calls", added: 0, inStage: 2, today: 0, since: "Monday" }];
    const d: ReportData = {
      layout: "v8",
      opening: "A deal day: an hour on the Moody structure and a first interview at Harbor Health.",
      tracks: { acquisition: { picks: [], decided: null, pipeline }, job: { picks: [], decided: null, pipeline: null }, consulting: { picks: [], decided: null, pipeline: null }, startup: { picks: [], decided: null, pipeline: null }, startupActive: false },
      worked,
      box: todayBox({ reviewed: 15, added: 2, moved: 3, brokers: 4, calls: 3, outreach: 2 }),
      signName: "Bram",
      partnerName: "David Ertel",
      partnerFirst: "David",
      dateLong: "Tuesday, Nov 17, 2026",
      dateShort: "Tuesday, Nov 17",
      withWeek: false,
      pill: { text: "", status: "neutral" },
      today: [],
      targets: [],
      owed: null,
      waits: [],
      threshold: 5,
      deals: [],
      jobs: [],
      period: "today",
      week: null,
      tomorrow: { label: "Tomorrow", text: "Get Reid's answer on the price." },
    };
    const sections = buildSections(d);
    expect(sections.map((s) => [s.key, s.title])).toEqual([
      ["opening", expect.any(String)],
      ["acquisition", "Acquisition · 3 deals worked on today"],
      ["jobs", "Job search · 1 job worked on today"],
      ["startup", "Startup · 1 project worked on today"],
      ["tomorrow", expect.any(String)],
    ]);
    const html = reportInnerHtml(d);
    expect(html).toContain('data-layout="h"');
    expect(html).toContain("max-width:640px");
    expect(html).toContain("Acquisition · 3 deals worked on today");
    expect(html).not.toContain("1 to 3 are my top priorities");
    expect(html).toContain("data-today-box");
    expect(html.indexOf("data-today-box")).toBeLessThan(html.indexOf("Acquisition · 3 deals worked on today"));
    // One card per record, numbered 1 to N; only the pick carries the priority mark.
    expect(html.match(/data-worked="1"/g)?.length).toBe(5);
    expect(html.match(/data-priority="1"/g)?.length).toBe(1);
    const moody = html.slice(html.indexOf("Moody &amp; Associates"), html.indexOf("AI-Enabled"));
    expect(moody).toContain("top priority");
    expect(moody.indexOf("Diligence")).toBeLessThan(moody.indexOf(">Today<"));
    expect(moody.indexOf(">Today<")).toBeLessThan(moody.indexOf(">Next<"));
    expect(moody.indexOf(">Next<")).toBeLessThan(moody.indexOf(">Upside<"));
    expect(moody).toContain("vertical-align:baseline");
    expect(moody).toContain("day 9");
    expect(moody).not.toContain("since first contact");
    const ai = html.slice(html.indexOf("AI-Enabled"), html.indexOf("Dalton Services"));
    expect(ai).toContain("new today");
    expect(ai).toContain("moved up from Interested");
    expect(ai).not.toContain("top priority");
    expect(html).not.toContain("Why:");
    expect(html).not.toContain("00 AI-Enabled");
    expect(html.indexOf("data-pipeline")).toBeLessThan(html.indexOf("Job search · 1 job worked on today"));
    expect(html).toContain("Acquisition pipeline");
    // 2026-11-25: Stage, In process, Today, This week, with what each column counts under the title; no Screened row.
    expect(html).toContain("In process");
    expect(html).toMatch(/>Today<\/td>/);
    expect(html).toContain("This week counts from Monday.");
    expect(html).not.toContain("in the stage right now");
    expect(html).toContain(`<span style="white-space:nowrap">Broker + seller</span> calls`); // one line when wide, two at most on a phone
    expect(html).not.toContain("moves on the same day");
    expect(html).not.toContain(">Screened<");
    expect(html).not.toContain("Consulting · ");
    // The job's Size line: its pay.
    expect(html.slice(html.indexOf("Harbor Health"))).toContain("$180K to $210K");
    expect(reportSubject(d)).toBe("Daily report: Tuesday, Nov 17 · 15 listings reviewed, 2 deals added, 3 deals moved");
    const text = reportText(d);
    expect(text).toContain("Today: Listings reviewed 15 · Deals added 2 · Deals moved 3 · Brokers contacted 4 · Calls and meetings 3 · Network outreach 2");
    expect(text).toContain("1. Moody & Associates Law Office");
    expect(text).toContain("  Upside: Elder law demand rises with an aging population.");
    expect(text).toContain("+ AI-Enabled Back-Office Operations Provider");
    // Change hides a record; a whole track hidden leaves nothing in its place.
    const hidden = buildSections({ ...d, choices: { hidden: { jobs: [J1] } } }).find((s) => s.key === "jobs")!;
    expect(hidden.worked).toEqual([]);
    expect(hidden.emptyAfterChange).toBe(true);
  });

  it("shows EBITDA, SDE or both on a deal's Size line (Bram, 2026-11-24: within 5% of each other is the same figure)", () => {
    const labels = (e: number | null, s: number | null) => earningsOf(e, s).map((x) => `${x.label} ${x.value}`);
    // Only one has a number: that one, and the other is left out.
    expect(labels(null, 850_000)).toEqual(["SDE $850K"]);
    expect(labels(1_300_000, null)).toEqual(["EBITDA $1.3M"]);
    expect(labels(null, null)).toEqual([]);
    expect(labels(0, 850_000)).toEqual(["SDE $850K"]);
    // Both, the same or close: EBITDA only.
    expect(labels(1_000_000, 1_000_000)).toEqual(["EBITDA $1M"]);
    expect(labels(1_000_000, 1_040_000)).toEqual(["EBITDA $1M"]);
    expect(labels(1_040_000, 1_000_000)).toEqual(["EBITDA $1.0M"]);
    // Both, clearly different: both, EBITDA first.
    expect(labels(1_000_000, 1_300_000)).toEqual(["EBITDA $1M", "SDE $1.3M"]);
    expect(labels(1_000_000, 1_060_000).length).toBe(2);
    // The whole line: revenue first, then the earnings.
    expect(sizeOf("acquisition", {}, 4_000_000, null, 850_000).map((x) => x.label)).toEqual(["Revenue", "SDE"]);
    expect(sizeOf("acquisition", {}, 4_000_000, 1_000_000, 1_300_000).map((x) => x.label)).toEqual(["Revenue", "EBITDA", "SDE"]);
    expect(sizeOf("acquisition", {}, null, 1_100_000).map((x) => x.label)).toEqual(["EBITDA"]);
  });
});

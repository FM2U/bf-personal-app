import { describe, expect, it } from "vitest";
import { activeNotInTop, activityLine, buildSections, cleanChoices, hasChoices, includesLine, parseEdited, pickTop, sentSections, type ReportData, type ReportDeal } from "./report-sections";
import { reportDeals } from "./report-deals";

const deal = (id: string, position: number, lastActivity: string, activity: string[] = [], stage = `Stage ${position}`): ReportDeal => ({ id, name: `Deal ${id}`, stage, position, lastActivity, status: "Nothing waiting", next: `Next for ${id}, Nov 9`, activity });

const deals = [
  deal("summit", 3, "2026-11-02T10:00:00Z"),
  deal("pine", 8, "2026-11-01T10:00:00Z", ["emailed Dana Whitfield"]),
  deal("ridge", 7, "2026-11-03T09:00:00Z", ["moved to Partner presentation"]),
  deal("dalton", 4, "2026-11-03T15:00:00Z", ["Rachel Kim emailed: CIM received", "note: read the first half"]),
  deal("hill", 1, "2026-11-03T12:00:00Z", ["screened in as Interested"]),
  deal("oak", 3, "2026-10-28T10:00:00Z"),
];

const base: ReportData = {
  partnerName: "Jake Morgan", partnerFirst: "Jake", dateLong: "Tuesday, Nov 3, 2026", dateShort: "Tuesday, Nov 3", withWeek: false,
  pill: { text: "Listings screened missed", status: "missed" },
  today: [
    { label: "Listings screened", value: "3", small: "of 5", note: "2 passed", status: "missed", pct: 60 },
    { label: "Calls", value: "0", note: "", status: "neutral", pct: null },
  ],
  targets: [
    { id: "t1", group: "missed", text: "Listings screened: 3 of 5 today, 8 of 10 this week", commitment: true, asks: true, reason: "Two CIMs came in" },
    { id: "t2", group: "now", text: "Brokers contacted: 3 of 5", commitment: false, asks: false, reason: null },
    { id: "t3", group: "met", text: "Follow-ups done on time: 100%", commitment: false, asks: false, reason: null },
  ],
  owed: { dayWord: "Monday", items: [{ id: "t1", text: "Listings screened: 2 of 5", reason: null }] },
  waits: [{ id: "summit", name: "Summit Logistics Group", days: 11, who: "Mark Reed" }, { id: "pine", name: "Pinecrest Landscaping", days: 6, who: "Dana Whitfield" }],
  threshold: 5,
  deals,
  jobs: [deal("harbor", 4, "2026-11-01T10:00:00Z"), deal("ssg", 2, "2026-10-30T10:00:00Z"), deal("peach", 1, "2026-11-02T10:00:00Z"), deal("river", 1, "2026-11-01T09:00:00Z", ["recruiter emailed"])],
  period: "today",
  week: null,
  tomorrow: { label: "Tomorrow", text: "Push Mark for the Summit call." },
};
const sec = (d: ReportData, k: string) => buildSections(d).find((s) => s.key === k)!;

describe("Top 3 and Active", () => {
  it("the top 3 are the furthest along, then the newest activity", () => {
    expect(pickTop(deals).map((d) => d.id)).toEqual(["pine", "ridge", "dalton"]);
    // Two at the same stage: the newer activity first.
    expect(pickTop([deal("a", 3, "2026-11-01"), deal("b", 3, "2026-11-03")], null, 1).map((d) => d.id)).toEqual(["b"]);
  });
  it("Change swaps which 3; the picked ones keep the default order", () => {
    expect(pickTop(deals, ["summit", "pine", "hill"]).map((d) => d.id)).toEqual(["pine", "summit", "hill"]);
    expect(pickTop(deals, ["gone"]).map((d) => d.id)).toEqual(["pine", "ridge", "dalton"]);
  });
  it("Active lists the deals worked on that are not in the top 3: nothing repeats", () => {
    const top = pickTop(deals);
    expect(activeNotInTop(deals, top).map((d) => d.id)).toEqual(["hill"]);
    // Taking Dalton out of the top 3 moves it to Active (it was worked on); Summit was not, so it shows nowhere.
    const swapped = pickTop(deals, ["pine", "ridge", "summit"]);
    expect(activeNotInTop(deals, swapped).map((d) => d.id)).toEqual(["dalton", "hill"]);
    const s = buildSections({ ...base, choices: { top: ["pine", "ridge", "summit"] } });
    const topIds = s.find((x) => x.key === "top")!.blocks.map((b) => b.title);
    const activeIds = s.find((x) => x.key === "active")!.blocks[0].items.map((i) => i.line.lead);
    expect(topIds).toEqual(["Deal pine", "Deal ridge", "Deal summit"]);
    expect(activeIds).toEqual(["Deal dalton", "Deal hill"]);
    expect(topIds.some((t) => activeIds.includes(t))).toBe(false);
  });
  it("a deal's activity on one line", () => {
    expect(activityLine(deals[3])).toBe("Rachel Kim emailed: CIM received; note: read the first half");
  });
  it("Top 3 lines: Stage, Status, Next step as child lines", () => {
    const top = sec(base, "top");
    expect(top.blocks[0].title).toBe("Deal pine");
    expect(top.blocks[0].items.map((i) => `${i.line.label}: ${i.line.text}`)).toEqual(["Stage: Stage 8", "Status: Nothing waiting", "Next step: Next for pine, Nov 9"]);
    expect(top.pick!.filter((p) => p.on).map((p) => p.id)).toEqual(["pine", "ridge", "dalton"]);
  });
  it("Job search: the top 3 opportunities, then the others worked on; Friday says this week", () => {
    const jobs = sec(base, "jobs");
    expect(jobs.blocks.map((b) => b.title)).toEqual(["Top 3 opportunities", "Deal harbor", "Deal ssg", "Deal peach", "Active today"]);
    expect(sec({ ...base, period: "this week" }, "jobs").blocks.at(-1)!.title).toBe("Active this week");
    expect(sec({ ...base, period: "this week" }, "active").title).toBe("Active this week");
  });
  it("leaves out empty sections: no deals, nothing worked on, no jobs", () => {
    const keys = buildSections({ ...base, deals: [], jobs: [] }).map((s) => s.key);
    expect(keys).toEqual(["today", "targets", "waiting", "tomorrow"]);
  });
});

describe("the sections with include, Change, and Edit", () => {
  it("builds the targets as groups, each target a child with its short sub-line", () => {
    const t = sec(base, "targets");
    expect(t.blocks.map((b) => b.title)).toEqual(["Missed", "Under way", "Met", "Owed from Monday"]);
    expect(t.blocks[0].items[0].line.text).toBe("Listings screened: 3 of 5 today, 8 of 10 this week");
    expect(t.blocks[0].items[0].sub!.map((x) => x.text)).toEqual(["Commitment. Reason: Two CIMs came in"]);
    expect(t.blocks[3].items[0].sub![0]).toEqual({ text: "Commitment. Reason: ", todo: "(still to give)" });
    expect(t.text).toContain("Missed\n  - Listings screened: 3 of 5 today, 8 of 10 this week\n    - Commitment. Reason: Two CIMs came in");
  });
  it("the standing sections decide what is ticked; today's tick wins", () => {
    const sarah = { ...base, sections: ["targets", "week", "tomorrow"] };
    expect(sentSections(sarah).map((s) => s.key)).toEqual(["targets", "tomorrow"]);
    const s2 = { ...sarah, choices: { include: { waiting: true, targets: false } } };
    expect(sentSections(s2).map((s) => s.key)).toEqual(["waiting", "tomorrow"]);
    expect(buildSections(s2).find((s) => s.key === "targets")!.standing).toBe(true);
    expect(includesLine(base)).toBe("Today, Targets, Top 3 deals, Active today, Waiting on brokers, Job search, Tomorrow");
    // "moved" saved before the push B edits reads as Active today.
    expect(sentSections({ ...base, sections: ["moved"] }).map((s) => s.key)).toEqual(["active"]);
  });
  it("Change hides items for today: tiles, targets, waits", () => {
    const d = { ...base, choices: { hidden: { today: ["Calls"], targets: ["t2", "owed:t1"], waiting: ["pine"] } } };
    expect(sec(d, "today").tiles.map((t) => t.label)).toEqual(["Listings screened"]);
    expect(sec(d, "today").choices!.find((c) => c.id === "Calls")!.on).toBe(false);
    expect(sec(d, "targets").blocks.map((b) => b.title)).toEqual(["Missed", "Met"]);
    expect(sec(d, "waiting").blocks[0].items.map((i) => i.line.lead)).toEqual(["Summit Logistics Group"]);
    const all = { ...base, choices: { hidden: { waiting: ["pine", "summit"] } } };
    expect(sec(all, "waiting").emptyAfterChange).toBe(true);
  });
  it("Edit rewrites a section for today; Tomorrow has Edit only", () => {
    const d = { ...base, choices: { edits: { waiting: "Waiting on brokers\n  - Summit: Mark owes the date" } } };
    expect(sec(d, "waiting").edited).toBe("Waiting on brokers\n  - Summit: Mark owes the date");
    expect(sec(base, "tomorrow").choices).toBeNull();
    expect(sec(base, "tomorrow").pick).toBeNull();
    expect(sec(base, "tomorrow").text).toBe("Push Mark for the Summit call.");
    expect(sec({ ...base, choices: { edits: { tomorrow: "   " } } }, "tomorrow").edited).toBeNull();
  });
  it("reads an edited section's bullets and depth", () => {
    expect(parseEdited("Missed\n  - Listings: 3 of 5\n    - Commitment\nPlain line")).toEqual([
      { depth: 0, bullet: false, text: "Missed" },
      { depth: 1, bullet: true, text: "Listings: 3 of 5" },
      { depth: 2, bullet: true, text: "Commitment" },
      { depth: 0, bullet: false, text: "Plain line" },
    ]);
    expect(parseEdited("- one\n  - two").map((l) => l.depth)).toEqual([1, 2]);
  });
  it("cleans the saved choices", () => {
    expect(cleanChoices({ include: { today: false, nope: true, top: "yes" }, hidden: { waiting: ["a", "a", 3] }, top: ["x", "y", "z", "w"], edits: { tomorrow: "Line", targets: "  " } })).toEqual({ include: { today: false }, hidden: { waiting: ["a", "3"] }, edits: { tomorrow: "Line" }, top: ["x", "y", "z"] });
    expect(cleanChoices(null)).toEqual({});
    expect(hasChoices({})).toBe(false);
    expect(hasChoices({ include: { today: false } })).toBe(true);
  });
});

describe("the report's deals from the rows", () => {
  const stageById = { s1: { name: "Interested", outcome: "open", position: 1 }, s4: { name: "CIM review", outcome: "open", position: 3 }, s5: { name: "Broker call", outcome: "open", position: 4 }, sp: { name: "Passed", outcome: "lost", position: 99 } };
  const rows = {
    items: [
      { id: "a", name: "Summit Logistics Group", pipeline_id: "acq", status: "open", screened: true, stage_id: "s4", waiting_on: "A seller call to be scheduled", waiting_since: "2026-10-23", primary_contact_id: "mark", next_action: "Push Mark for the call", next_action_due: "2026-11-04", updated_at: "2026-10-30T10:00:00Z" },
      { id: "b", name: "Dalton Services", pipeline_id: "acq", status: "open", screened: true, stage_id: "s5", next_action: "Review the CIM", next_action_due: "2026-11-03", updated_at: "2026-11-01T10:00:00Z" },
      { id: "c", name: "Old one", pipeline_id: "acq", status: "open", screened: true, stage_id: "sp" },
      { id: "d", name: "A listing", pipeline_id: "acq", status: "open", screened: false, stage_id: null },
      { id: "e", name: "VP Ops", pipeline_id: "job", status: "open", screened: true, stage_id: "s1" },
    ],
    history: [
      { item_id: "b", stage_id: "s4", entered_at: "2026-10-20T15:00:00Z" },
      { item_id: "b", stage_id: "s5", entered_at: "2026-11-03T14:00:00Z" },
      { item_id: "a", stage_id: "s4", entered_at: "2026-10-15T15:00:00Z" },
    ],
    comms: [{ pipeline_item_id: "b", occurred_at: "2026-11-03T16:00:00Z", method: "email", direction: "incoming", contact_id: "rachel", subject: "CIM received" }],
    notes: [{ record_id: "b", body: "Read the first half\nmore", created_at: "2026-11-03T18:00:00Z" }],
    events: [{ kind: "next_action_done", record_id: "b", happened_on: "2026-11-03", happened_at: "2026-11-03T13:00:00Z", meta: { action: "Ask Rachel for the CIM" } }],
    people: [{ id: "mark", name: "Mark Reed" }, { id: "rachel", name: "Rachel Kim" }],
    stageById,
  };
  const out = reportDeals({ ...rows, pipelineId: "acq", period: { start: "2026-11-03", end: "2026-11-03" }, today: "2026-11-03", local: (ts) => ts.slice(0, 10), fmt: (d) => (d === "2026-10-23" ? "Oct 23" : d === "2026-11-04" ? "Nov 4" : d), weekday: () => "Monday" });
  it("keeps the open, screened deals with an open stage, furthest along first", () => {
    expect(out.map((d) => d.name)).toEqual(["Dalton Services", "Summit Logistics Group"]);
  });
  it("writes the status from the waiting fields, the next step with its date", () => {
    const summit = out[1];
    expect(summit.status).toBe("Waiting on Mark Reed: a seller call to be scheduled, since Oct 23 (11 days)");
    expect(summit.next).toBe("Push Mark for the call, Nov 4");
    expect(summit.activity).toEqual([]);
    expect(out[0].status).toBe("Moved from CIM review today; nothing waiting");
    expect(out[0].next).toBe("Review the CIM, today");
  });
  it("lists what happened in the period, oldest first", () => {
    expect(out[0].activity).toEqual(["done: ask Rachel for the CIM", "moved to Broker call", "Rachel Kim emailed: CIM received", "note: Read the first half"]);
  });
});

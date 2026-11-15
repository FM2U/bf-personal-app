import { describe, expect, it } from "vitest";
import { buildPriorityColumns, movedFromByRecord, nextWords, pickName, planRanks } from "./priorities";

const TODAY = "2026-11-15";
const localDate = (ts: string) => ts.slice(0, 10);
const pipelines = [
  { id: "p-acq", kind: "acquisition" },
  { id: "p-job", kind: "job" },
  { id: "p-con", kind: "consulting" },
];
const stages = [
  { id: "s-seller", name: "Seller call" },
  { id: "s-dil", name: "Diligence" },
  { id: "s-int", name: "Interview" },
];
const item = (o: Record<string, unknown>) => ({ status: "open", screened: true, created_at: "2026-10-24T15:00:00Z", stage_entered_at: "2026-11-01T15:00:00Z", ...o });

describe("Top priorities (2026-11-15)", () => {
  it("builds each track's picks in rank order, numbered 1 to 3, leaving out closed records and listings", () => {
    const cols = buildPriorityColumns({
      items: [
        item({ id: "d2", pipeline_id: "p-acq", stage_id: "s-dil", name: "Meridian", priority_rank: 3, strength: "warm" }),
        item({ id: "d1", pipeline_id: "p-acq", stage_id: "s-seller", name: "Dalton", priority_rank: 1, strength: "hot", stage_entered_at: "2026-11-15T14:00:00Z", why_fits: "70% recurring", next_decision: "Go or no-go on an LOI", next_decision_on: "2026-11-25" }),
        item({ id: "d3", pipeline_id: "p-acq", stage_id: "s-dil", name: "Passed one", priority_rank: 2, status: "lost" }),
        item({ id: "l1", pipeline_id: "p-acq", name: "A listing", priority_rank: 2, screened: false }),
        item({ id: "j1", pipeline_id: "p-job", stage_id: "s-int", name: "Acme Health", role_title: "VP Operations", priority_rank: 2 }),
        item({ id: "c1", pipeline_id: "p-con", name: "Sullivan Wickley", what_it_does: "Site analysis", priority_rank: 1, strength: "cold" }),
        item({ id: "x1", pipeline_id: "p-acq", name: "Not a pick" }),
      ],
      projects: [
        { id: "r1", name: "Rosara", milestone: "Customer interviews", priority_rank: 1, status: "open", created_at: "2026-11-01T12:00:00Z", strength: "warm" },
        { id: "r2", name: "Closed idea", priority_rank: 2, status: "closed" },
      ],
      pipelines,
      stages,
      moves: [],
      today: TODAY,
      localDate,
    });
    expect(cols.acquisition.map((p) => [p.number, p.name, p.rank])).toEqual([[1, "Dalton", 1], [2, "Meridian", 3]]);
    const dalton = cols.acquisition[0];
    expect(dalton).toMatchObject({ stage: "Seller call", strength: "hot", day: 23, movedToday: true, why: "70% recurring", href: "/work/deals/d1" });
    expect(dalton.next).toEqual({ text: "Go or no-go on an LOI", on: "2026-11-25", movedFrom: null, passed: false });
    expect(cols.acquisition[1].movedToday).toBe(false);
    expect(cols.job.map((p) => [p.number, p.name, p.stage, p.href])).toEqual([[1, "VP Operations, Acme Health", "Interview", "/work/jobs/j1"]]);
    expect(cols.consulting.map((p) => [p.name, p.strength])).toEqual([["Site analysis, Sullivan Wickley", "cold"]]);
    expect(cols.startup.map((p) => [p.name, p.stage, p.day, p.href])).toEqual([["Rosara", "Customer interviews", 15, "/work/rosara/r1"]]);
  });

  it("a record added today is not 'moved today'", () => {
    const cols = buildPriorityColumns({ items: [item({ id: "d", pipeline_id: "p-acq", name: "New", priority_rank: 1, created_at: "2026-11-15T13:00:00Z", stage_entered_at: "2026-11-15T13:00:00Z" })], projects: [], pipelines, stages, moves: [], today: TODAY, localDate });
    expect(cols.acquisition[0]).toMatchObject({ day: 1, movedToday: false });
  });

  it("marks the Next line moved when the latest date change went later, and passed when the date is before today", () => {
    const moves = [
      { record_id: "d1", old_value: null, new_value: "2026-11-20", created_at: "2026-11-10T10:00:00Z" },
      { record_id: "d1", old_value: "2026-11-20", new_value: "2026-12-01", created_at: "2026-11-14T10:00:00Z" },
      { record_id: "d2", old_value: "2026-12-01", new_value: "2026-11-28", created_at: "2026-11-14T10:00:00Z" },
    ];
    expect([...movedFromByRecord(moves)]).toEqual([["d1", "2026-11-20"], ["d2", null]]);
    const cols = buildPriorityColumns({
      items: [
        item({ id: "d1", pipeline_id: "p-acq", name: "A", priority_rank: 1, next_decision: "Go or no-go", next_decision_on: "2026-12-01" }),
        item({ id: "d2", pipeline_id: "p-acq", name: "B", priority_rank: 2, next_decision: "Their answer", next_decision_on: "2026-11-28" }),
        item({ id: "d3", pipeline_id: "p-acq", name: "C", priority_rank: 3, next_decision: "Decide", next_decision_on: "2026-11-14" }),
      ],
      projects: [],
      pipelines,
      stages,
      moves,
      today: TODAY,
      localDate,
    });
    expect(cols.acquisition.map((p) => nextWords(p.next))).toEqual([
      { words: "go or no-go, moved to Dec 1", amber: true },
      { words: "their answer by Nov 28", amber: false },
      { words: "decide by Nov 14, passed", amber: true },
    ]);
    expect(nextWords(null)).toBeNull();
    expect(nextWords({ text: "Pick a lawyer", on: null, movedFrom: null, passed: false })).toEqual({ words: "pick a lawyer", amber: false });
  });

  it("names a job 'Role, Company' and a consulting item 'Project, Client'", () => {
    expect(pickName("job", { name: "Acme", role_title: "COO" })).toBe("COO, Acme");
    expect(pickName("job", { name: "Acme" })).toBe("Acme");
    expect(pickName("acquisition", { name: "Listing name", company_name: "Real Co" })).toBe("Real Co");
  });

  it("plans ranks: put a record at a place, the others close up and move down, a fourth falls off", () => {
    const at = (m: Map<string, number | null>) => Object.fromEntries(m);
    expect(at(planRanks(["a", "b"], "c", 3))).toEqual({ a: 1, b: 2, c: 3 });
    expect(at(planRanks(["a", "b"], "c", 1))).toEqual({ c: 1, a: 2, b: 3 });
    expect(at(planRanks(["a", "b", "c"], "d", 2))).toEqual({ a: 1, d: 2, b: 3, c: null });
    expect(at(planRanks(["a", "b", "c"], "c", 1))).toEqual({ c: 1, a: 2, b: 3 });
    expect(at(planRanks(["a", "b", "c"], "a", 3))).toEqual({ b: 1, c: 2, a: 3 });
    expect(at(planRanks(["a", "b", "c"], "b", null))).toEqual({ a: 1, c: 2, b: null });
    expect(at(planRanks(["a"], "z", 3))).toEqual({ a: 1, z: 2 });
  });
});

import { describe, expect, it } from "vitest";
import { applyFilters, optionCount } from "@/lib/filters";
import { byName, followUpBucket, followUpFilterGroups, kindOptions, lastContactBucket, matchesOrgSearch, onFollowUps, orgFilterGroups, orgKindLabel, orgLine, parseOrgKind, parsePeopleView, peopleNamesLine, peopleViewHref, personFilterGroups, regionOf } from "./people";

const people = [
  { name: "mark Reed", roleKey: "broker", nextFollowUp: "2026-11-01" },
  { name: "Jake Morgan", roleKey: "accountability_partner", nextFollowUp: null },
  { name: "Sarah Klein", roleKey: "accountability_partner", nextFollowUp: "2026-11-09" },
  { name: "Kevin O'Brien", roleKey: "recruiter", nextFollowUp: null },
  { name: "Ann Lee", roleKey: null, nextFollowUp: null },
];

describe("People views", () => {
  it("reads the view from the address", () => {
    expect(parsePeopleView(undefined)).toBe("follow");
    expect(parsePeopleView("everyone")).toBe("people");
    expect(parsePeopleView("people")).toBe("people");
    expect(parsePeopleView("orgs")).toBe("orgs");
    expect(parsePeopleView("nonsense")).toBe("follow");
    expect(peopleViewHref("follow")).toBe("/work/people");
    expect(peopleViewHref("orgs")).toBe("/work/people?view=orgs");
  });

  it("sorts A to Z ignoring letter case", () => {
    expect(byName(people).map((p) => p.name)).toEqual(["Ann Lee", "Jake Morgan", "Kevin O'Brien", "mark Reed", "Sarah Klein"]);
  });

  it("Follow-ups leaves out a partner without a follow-up date", () => {
    expect(people.filter(onFollowUps).map((p) => p.name)).toEqual(["mark Reed", "Sarah Klein", "Kevin O'Brien", "Ann Lee"]);
  });
});

describe("Organizations", () => {
  const orgs = [
    { name: "Transworld Business Advisors", kind: "broker", region: "Knoxville and Chattanooga, TN", peopleNames: ["Mark Reed", "Rachel Kim"] },
    { name: "Truist", kind: "lender", region: "Atlanta, GA", peopleNames: ["Priya Natarajan"] },
    { name: "GA Home Care Association", kind: "nonprofit", region: null, peopleNames: [] },
  ];
  it("labels the kinds and falls back to Other", () => {
    expect(orgKindLabel("broker")).toBe("Broker");
    expect(orgKindLabel("investor")).toBe("Investor");
    expect(orgKindLabel("nope")).toBe("Other");
    expect(parseOrgKind("consulting_client")).toBe("consulting_client");
    expect(parseOrgKind("nope")).toBe("other");
  });
  it("lists the eight kinds, with Service provider only when held, Other last", () => {
    expect(kindOptions([]).map((k) => k.label)).toEqual(["Broker", "Lender", "Employer", "Consulting client", "Investor", "Business", "Nonprofit", "Other"]);
    expect(kindOptions(["service_provider"]).map((k) => k.label).slice(-2)).toEqual(["Service provider", "Other"]);
  });
  it("finds by name, region, or a person at the organization", () => {
    expect(orgs.filter((o) => matchesOrgSearch(o, "rachel")).map((o) => o.name)).toEqual(["Transworld Business Advisors"]);
    expect(orgs.filter((o) => matchesOrgSearch(o, "atlanta")).map((o) => o.name)).toEqual(["Truist"]);
    expect(orgs.filter((o) => matchesOrgSearch(o, "  "))).toHaveLength(3);
  });
  it("writes the row lines", () => {
    expect(orgLine(orgs[0])).toBe("Broker · Knoxville and Chattanooga, TN");
    expect(orgLine(orgs[2])).toBe("Nonprofit");
    expect(peopleNamesLine([])).toBe("No one yet");
    expect(peopleNamesLine(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});

describe("Contacts filter groups", () => {
  const today = "2026-11-03"; // a Tuesday
  const kinds: Record<string, string> = { tw: "broker", truist: "lender", ssg: "employer" };
  type P = { name: string; roleKey: string | null; lastContactOn: string | null; nextFollowUp: string | null; organizationId: string | null };
  const ppl: P[] = [
    { name: "Mark Reed", roleKey: "broker", lastContactOn: "2026-10-26", nextFollowUp: "2026-11-02", organizationId: "tw" },
    { name: "Rachel Kim", roleKey: "broker", lastContactOn: "2026-11-03", nextFollowUp: "2026-11-14", organizationId: "tw" },
    { name: "Luis Ortega", roleKey: "broker", lastContactOn: "2026-11-01", nextFollowUp: "2026-11-05", organizationId: null },
    { name: "Priya Natarajan", roleKey: "lender", lastContactOn: "2026-10-21", nextFollowUp: "2026-11-01", organizationId: "truist" },
    { name: "Carla Jenkins", roleKey: "recruiter", lastContactOn: "2026-10-30", nextFollowUp: "2026-11-03", organizationId: "ssg" },
    { name: "Nate Boone", roleKey: "personal_network", lastContactOn: "2026-07-14", nextFollowUp: null, organizationId: null },
    { name: "Owen Marsh", roleKey: "lender", lastContactOn: null, nextFollowUp: null, organizationId: null },
  ];
  const groups = personFilterGroups<P>(today, (id) => kinds[id] ?? null, Object.values(kinds));
  const names = (t: Record<string, string[]>) => applyFilters(ppl, groups, t).map((p) => p.name);

  it("buckets the last contact and the follow-up", () => {
    expect(lastContactBucket("2026-11-02", today, "week")).toBe(true);
    expect(lastContactBucket("2026-10-30", today, "week")).toBe(false);
    expect(lastContactBucket("2026-10-30", today, "month")).toBe(true);
    expect(lastContactBucket("2026-11-02", today, "month")).toBe(false);
    expect(lastContactBucket("2026-09-20", today, "month")).toBe(false);
    expect(lastContactBucket("2026-09-20", today, "1to3")).toBe(true);
    expect(lastContactBucket("2026-08-05", today, "1to3")).toBe(true);
    expect(lastContactBucket("2026-07-14", today, "1to3")).toBe(false);
    expect(lastContactBucket("2026-07-14", today, "3plus")).toBe(true);
    expect(lastContactBucket("2026-07-14", today, "90")).toBe(true);
    expect(lastContactBucket(null, today, "never")).toBe(true);
    expect(followUpBucket("2026-11-02", today, "overdue")).toBe(true);
    expect(followUpBucket("2026-11-03", today, "today")).toBe(true);
    expect(followUpBucket("2026-11-09", today, "week")).toBe(true);
    expect(followUpBucket("2026-11-14", today, "week")).toBe(false);
    expect(followUpBucket(null, today, "none")).toBe(true);
  });

  it("ticks in one group mean either one; ticks in different groups must all match", () => {
    expect(names({ role: ["broker", "lender"] })).toEqual(["Mark Reed", "Rachel Kim", "Luis Ortega", "Priya Natarajan", "Owen Marsh"]);
    expect(names({ role: ["broker"], fu: ["overdue"] })).toEqual(["Mark Reed"]);
    expect(names({ role: ["broker", "lender"], fu: ["overdue"] })).toEqual(["Mark Reed", "Priya Natarajan"]);
    expect(names({ org: ["none"] })).toEqual(["Luis Ortega", "Nate Boone", "Owen Marsh"]);
    expect(names({ org: ["broker"], lc: ["week"] })).toEqual(["Rachel Kim"]);
  });

  it("counts what each box would show, given the other groups' ticks", () => {
    const t = { role: ["broker"] };
    // Inside the ticked group the count ignores that group's own ticks.
    expect(optionCount(ppl, groups, t, "role", "lender")).toBe(2);
    // In another group it counts with the Role tick.
    expect(optionCount(ppl, groups, t, "fu", "overdue")).toBe(1);
    expect(optionCount(ppl, groups, t, "fu", "week")).toBe(1);
    expect(optionCount(ppl, groups, t, "org", "lender")).toBe(0);
  });

  it("Organizations: the state as the region, Status Active until ticked", () => {
    expect(regionOf("Knoxville and Chattanooga, TN")).toBe("Tennessee");
    expect(regionOf("Southeast")).toBe("Southeast");
    expect(regionOf(null)).toBe(null);
    type O = { name: string; kind: string; region: string | null; openDeals: number; archived: boolean };
    const orgs: O[] = [
      { name: "Transworld", kind: "broker", region: "Knoxville, TN", openDeals: 4, archived: false },
      { name: "Truist", kind: "lender", region: "Atlanta, GA", openDeals: 0, archived: false },
      { name: "Example Brokers", kind: "broker", region: "Charlotte, NC", openDeals: 0, archived: true },
    ];
    const g = orgFilterGroups<O>(orgs);
    expect(g.find((x) => x.key === "region")!.options.map((o) => o.label)).toEqual(["Georgia", "North Carolina", "Tennessee"]);
    expect(applyFilters(orgs, g, {}).map((o) => o.name)).toEqual(["Transworld", "Truist"]);
    expect(applyFilters(orgs, g, { status: ["archived"] }).map((o) => o.name)).toEqual(["Example Brokers"]);
    expect(applyFilters(orgs, g, { kind: ["broker"], status: ["active", "archived"] }).map((o) => o.name)).toEqual(["Transworld", "Example Brokers"]);
    expect(applyFilters(orgs, g, { deals: ["none"] }).map((o) => o.name)).toEqual(["Truist"]);
    expect(optionCount(orgs, g, {}, "status", "archived")).toBe(1);
  });
});

describe("the Follow-ups Filter window (2026-11-04)", () => {
  type F = { roleKey: string | null; lastContactOn: string | null; nextFollowUp: string | null; organizationId: string | null; purposes: string[] };
  const g = followUpFilterGroups<F>();
  const p = (roleKey: string | null, purposes: string[]): F => ({ roleKey, lastContactOn: null, nextFollowUp: null, organizationId: null, purposes });
  it("has only Role and Project (the tiles pick the follow-up group)", () => {
    expect(g.map((x) => x.title)).toEqual(["Role", "Project"]);
    expect(g[1].options.map((o) => o.label)).toEqual(["Off-market deals", "Rosara", "Job search", "Consulting", "None"]);
  });
  it("matches a project the person is on, and None for a person on no project", () => {
    const rows = [p("broker", ["off_market_deals"]), p("lender", []), p("broker", ["rosara", "job_search"])];
    expect(applyFilters(rows, g, { proj: ["rosara"] })).toEqual([rows[2]]);
    expect(applyFilters(rows, g, { proj: ["none"] })).toEqual([rows[1]]);
    expect(applyFilters(rows, g, { role: ["broker"], proj: ["off_market_deals", "none"] })).toEqual([rows[0]]);
  });
});

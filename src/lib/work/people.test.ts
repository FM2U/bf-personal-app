import { describe, expect, it } from "vitest";
import { byName, matchesOrgFilter, matchesOrgSearch, matchesRole, onFollowUps, orgFilters, orgKindLabel, orgLine, parseOrgKind, parsePeopleView, peopleNamesLine, peopleViewHref, roleCounts, roleFilters } from "./people";

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
    expect(parsePeopleView("everyone")).toBe("everyone");
    expect(parsePeopleView("orgs")).toBe("orgs");
    expect(parsePeopleView("nonsense")).toBe("follow");
    expect(peopleViewHref("follow")).toBe("/work/people");
    expect(peopleViewHref("orgs")).toBe("/work/people?view=orgs");
  });

  it("Everyone: the main role pills always, other roles only when someone has them", () => {
    const f = roleFilters(people);
    expect(f.map((x) => x.label)).toEqual(["All", "Broker", "Lender", "Accountability partner", "Investor", "Co-founder candidate", "Personal network", "Consulting client", "Recruiter"]);
    expect(roleFilters([]).map((x) => x.key)).not.toContain("recruiter");
    const c = roleCounts(people, f);
    expect(c.all).toBe(5);
    expect(c.accountability_partner).toBe(2);
    expect(c.lender).toBe(0);
    expect(people.filter((p) => matchesRole(p, "broker")).map((p) => p.name)).toEqual(["mark Reed"]);
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
    expect(orgKindLabel("broker")).toBe("Broker firm");
    expect(orgKindLabel("investor")).toBe("Investor firm");
    expect(orgKindLabel("nope")).toBe("Other");
    expect(parseOrgKind("consulting_client")).toBe("consulting_client");
    expect(parseOrgKind("nope")).toBe("other");
  });
  it("filters by kind, with other kinds shown only when held", () => {
    expect(orgFilters(orgs).map((f) => f.label)).toEqual(["All", "Broker firm", "Lender", "Employer", "Consulting client", "Investor firm", "Nonprofit"]);
    expect(orgs.filter((o) => matchesOrgFilter(o, "lender")).map((o) => o.name)).toEqual(["Truist"]);
    expect(orgs.filter((o) => matchesOrgFilter(o, "all"))).toHaveLength(3);
  });
  it("finds by name, region, or a person at the organization", () => {
    expect(orgs.filter((o) => matchesOrgSearch(o, "rachel")).map((o) => o.name)).toEqual(["Transworld Business Advisors"]);
    expect(orgs.filter((o) => matchesOrgSearch(o, "atlanta")).map((o) => o.name)).toEqual(["Truist"]);
    expect(orgs.filter((o) => matchesOrgSearch(o, "  "))).toHaveLength(3);
  });
  it("writes the row lines", () => {
    expect(orgLine(orgs[0])).toBe("Broker firm · Knoxville and Chattanooga, TN");
    expect(orgLine(orgs[2])).toBe("Nonprofit");
    expect(peopleNamesLine([])).toBe("No one yet");
    expect(peopleNamesLine(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});

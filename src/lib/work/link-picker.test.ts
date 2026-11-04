import { describe, expect, it } from "vitest";
import { chipOf, linkKey, movePick, pickerResults, type LinkRecord } from "./link-picker";

const r = (kind: LinkRecord["kind"], name: string, extra: Partial<LinkRecord> = {}): LinkRecord => ({ kind, id: name.toLowerCase().replace(/\s+/g, "-"), name, status: "Open", closed: false, dueToday: false, ...extra });
const records: LinkRecord[] = [
  r("deal", "Summit Logistics Group", { status: "CIM review", dueToday: true }),
  r("deal", "Meridian Industrial Coatings", { status: "Model" }),
  r("listing", "Summer Pool Service", { status: "Listing" }),
  r("deal", "Sunbelt Plumbing", { status: "Passed", closed: true }),
  r("person", "Mark Reed", { status: "Broker", dueToday: true }),
  r("person", "Sam Ortiz", { status: "Lender", closed: true }),
  r("organization", "Transworld Business Advisors", { status: "Broker firm" }),
  r("project", "Care plan screens", { status: "Milestone: core plan" }),
  r("job", "Southern Staffing Group", { status: "Conversation" }),
  r("consulting", "Sullivan Wickley", { status: "Proposal" }),
];

describe("the Link to picker (push C)", () => {
  it("before typing: today's records (due today or opened today), grouped by type, closed ones left out", () => {
    const res = pickerResults(records, "", "All", new Set(["organization:transworld-business-advisors", "deal:sunbelt-plumbing"]));
    expect(res.groups.map((g) => g.label)).toEqual(["Deals", "People", "Organizations"]);
    expect(res.flat.map((x) => x.name)).toEqual(["Summit Logistics Group", "Mark Reed", "Transworld Business Advisors"]);
    expect(pickerResults([], "", "All").empty).toBe("nothing-today");
  });

  it("while typing: matches across every type, the name first, grouped in chip order; listings sit under Deals", () => {
    const res = pickerResults(records, "su", "All");
    expect(res.groups.map((g) => g.label)).toEqual(["Deals", "Consulting"]);
    expect(res.groups[0].items.map((x) => x.name)).toEqual(["Summer Pool Service", "Summit Logistics Group"]);
    expect(pickerResults(records, "broker", "All").flat.map((x) => x.name)).toEqual(["Mark Reed", "Transworld Business Advisors"]);
  });

  it("closed records show only when three letters or more of their name are typed", () => {
    expect(pickerResults(records, "sa", "All").flat.map((x) => x.name)).not.toContain("Sam Ortiz");
    expect(pickerResults(records, "sam", "All").flat.map((x) => x.name)).toContain("Sam Ortiz");
    expect(pickerResults(records, "passed", "All").flat).toHaveLength(0);
    expect(pickerResults(records, "sunbelt", "All").flat.map((x) => x.name)).toEqual(["Sunbelt Plumbing"]);
  });

  it("a type chip narrows the list; no match in that type offers Search all types", () => {
    expect(pickerResults(records, "", "People").flat.map((x) => x.name)).toEqual(["Mark Reed"]);
    expect(pickerResults(records, "summit", "Deals").flat.map((x) => x.name)).toEqual(["Summit Logistics Group"]);
    expect(pickerResults(records, "summit", "People").empty).toBe("no-match-in-type");
    expect(pickerResults(records, "zzz", "People").empty).toBe("no-match");
    expect(pickerResults(records, "zzz", "All").empty).toBe("no-match");
  });

  it("chips, keys, and the arrow keys", () => {
    expect(chipOf("listing")).toBe("Deals");
    expect(chipOf("project")).toBe("Projects");
    expect(linkKey({ kind: "listing", id: "x" })).toBe("deal:x");
    expect(movePick(0, -1, 3)).toBe(0);
    expect(movePick(1, 1, 3)).toBe(2);
    expect(movePick(2, 1, 3)).toBe(2);
    expect(movePick(0, 1, 0)).toBe(0);
  });
});

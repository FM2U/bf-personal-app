import { describe, expect, it } from "vitest";
import { fieldText, parseRecordHref, quickFields } from "./quick-view";
import { getResource } from "./resources";

const ID = "3f2b8c1e-1234-4abc-9def-0123456789ab";

describe("quick view: which links open it", () => {
  it("opens tasks, contacts, organizations, pipeline items, goals, and milestones", () => {
    for (const t of ["tasks", "contacts", "organizations", "pipeline_items", "goals", "milestones"]) expect(parseRecordHref(`/records/${t}/${ID}`)).toEqual({ table: t, id: ID });
  });
  it("leaves other links alone: other record types (unless inside a window), edit links, sections, new forms, other sites", () => {
    expect(parseRecordHref(`/records/initiatives/${ID}`)).toBeNull();
    expect(parseRecordHref(`/records/initiatives/${ID}`, { anyTable: true })).toEqual({ table: "initiatives", id: ID });
    expect(parseRecordHref(`/records/tasks/${ID}?edit=1`)).toBeNull();
    expect(parseRecordHref(`/records/tasks/${ID}#notes`)).toBeNull();
    expect(parseRecordHref("/records/tasks/new")).toBeNull();
    expect(parseRecordHref(`/records/not_a_table/${ID}`, { anyTable: true })).toBeNull();
    expect(parseRecordHref(`https://example.com/records/tasks/${ID}`, { origin: "http://localhost:3000" })).toBeNull();
    expect(parseRecordHref(`http://localhost:3000/records/tasks/${ID}`, { origin: "http://localhost:3000" })).toEqual({ table: "tasks", id: ID });
  });
});

describe("quick view: fields", () => {
  it("formats values as plain text", () => {
    const goal = getResource("goals")!;
    const f = (n: string) => goal.fields.find((x) => x.name === n)!;
    expect(fieldText(f("deadline"), "2027-03-01")).toBe("Mar 1, 2027");
    expect(fieldText(f("status"), "active")).toBe("Active");
    expect(fieldText(f("comparison"), "lte")).toBe("At or below the target");
    expect(fieldText(f("notes"), "")).toBe("");
    expect(fieldText(f("metric_params"), { a: 1 })).toBe("");
  });
  it("shows filled fields in order, never the title, long text last", () => {
    const row = { id: ID, title: "Spend less", notes: "Long note", deadline: "2027-03-01", target_value: 700, status: "active", metric_params: { categories: ["Groceries"] }, initiative_id: ID };
    const names = quickFields("goals", row).map((f) => f.name);
    expect(names).not.toContain("title");
    expect(names).not.toContain("metric_params");
    expect(names[names.length - 1]).toBe("notes");
    expect(names.indexOf("initiative_id")).toBeLessThan(names.indexOf("deadline"));
  });
});

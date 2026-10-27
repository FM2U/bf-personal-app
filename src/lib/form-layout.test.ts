import { describe, expect, it } from "vitest";
import { fieldWidth, formLayout, groupFields, moreStartsOpen, packSpans, spanClasses } from "./form-layout";
import { getResource, RESOURCES } from "./resources";

const fields = (t: string) => getResource(t)!.fields.filter((f) => !f.hideOnForm && !f.readOnly);

describe("form layout: field widths by content", () => {
  it("dates, numbers, and short dropdowns are short; names and references medium; long text full", () => {
    const g = Object.fromEntries(fields("goals").map((f) => [f.name, fieldWidth(f)]));
    expect(g.deadline).toBe("short");
    expect(g.target_value).toBe("short");
    expect(g.status).toBe("short");
    expect(g.comparison).toBe("short");
    expect(g.title).toBe("medium");
    expect(g.initiative_id).toBe("medium");
    expect(g.notes).toBe("full");
    const t = Object.fromEntries(fields("targets").map((f) => [f.name, fieldWidth(f)]));
    expect(t.count_source).toBe("medium"); // long option labels
    expect(t.active_weekdays).toBe("full");
  });
});

describe("form layout: sections, required first, More details", () => {
  it("goals: Goal (required first), How it is measured, then More details with status and notes", () => {
    const { main, more } = formLayout("goals", fields("goals"));
    expect(main.map((g) => g.section)).toEqual(["Goal", "How it is measured"]);
    expect(main[0].fields.map((f) => f.name)).toEqual(["title", "initiative_id", "deadline"]);
    expect(more.map((f) => f.name)).toEqual(["metric_params", "status", "notes"]);
  });
  it("never hides a required field, and keeps one optional field inline", () => {
    for (const t of Object.keys(RESOURCES)) {
      const { main, more } = formLayout(t, fields(t));
      expect(more.some((f) => f.required)).toBe(false);
      expect(more.length === 0 || more.length >= 2).toBe(true);
      const all = [...main.flatMap((g) => g.fields), ...more].map((f) => f.name).sort();
      expect(all).toEqual(fields(t).map((f) => f.name).sort());
    }
  });
  it("record definitions with their own sections keep them in order", () => {
    expect(groupFields("contacts", fields("contacts")).map((g) => g.section)).toEqual(["Name and contact details", "Relationship and outreach", "Follow-up", "Labels in the Outreach Queue", "Notes"]);
  });
  it("More details opens when one of its fields holds a value other than the default", () => {
    const { more } = formLayout("goals", fields("goals"));
    expect(moreStartsOpen(more, {})).toBe(false);
    expect(moreStartsOpen(more, { status: "active" })).toBe(false);
    expect(moreStartsOpen(more, { status: "met" })).toBe(true);
    expect(moreStartsOpen(more, { notes: "Check in March" })).toBe(true);
  });
});

describe("form layout: packing fields into rows of 12", () => {
  it("medium fields give up columns so a short field fits on the same row", () => {
    expect(packSpans(["medium", "medium", "short"])).toEqual([5, 4, 3]);
    expect(packSpans(["medium", "short", "short"])).toEqual([6, 3, 3]);
    expect(packSpans(["short", "short", "short", "short", "short"])).toEqual([3, 3, 3, 3, 3]);
    expect(packSpans(["medium", "medium", "medium"])).toEqual([6, 6, 6]);
    expect(packSpans(["full", "short", "medium"])).toEqual([12, 3, 6]);
    // Two short fields do not fit beside two medium fields (each medium keeps at least 4): the second goes on.
    expect(packSpans(["medium", "medium", "short", "short"])).toEqual([5, 4, 3, 3]);
  });
  it("goals: Goal, Initiative, Deadline share one row on a wide form", () => {
    const { main } = formLayout("goals", fields("goals"));
    const cls = spanClasses(main[0].fields);
    expect(cls[0]).toContain("@2xl:col-span-5");
    expect(cls[1]).toContain("@2xl:col-span-4");
    expect(cls[2]).toContain("@2xl:col-span-3");
  });
});

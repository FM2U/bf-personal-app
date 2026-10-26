import { describe, expect, it } from "vitest";
import { initialSelection, isFieldDirty, isFormDirty, safeLeaveTarget } from "./form-dirty";
import { addCreatedOption, canQuickCreate, filterOptions, quickCreateFields, quickCreateRefTables } from "./quick-create";
import { getResource } from "./resources";

describe("unsaved changes: comparing fields with what they held when shown", () => {
  it("text, number, date, and hidden values", () => {
    expect(isFieldDirty({ kind: "value", value: "abc", initial: "abc" })).toBe(false);
    expect(isFieldDirty({ kind: "value", value: "abcd", initial: "abc" })).toBe(true);
    expect(isFieldDirty({ kind: "value", value: "", initial: "0" })).toBe(true);
  });

  it("a value changed back to the original is not a change", () => {
    const field = { kind: "value" as const, value: "Demo Car Wash", initial: "Demo Car Wash" };
    expect(isFormDirty([field, { kind: "check", checked: false, initial: false }])).toBe(false);
  });

  it("checkboxes", () => {
    expect(isFieldDirty({ kind: "check", checked: true, initial: false })).toBe(true);
    expect(isFieldDirty({ kind: "check", checked: true, initial: true })).toBe(false);
  });

  it("dropdowns: the first option is the starting choice when none is marked", () => {
    expect(initialSelection([false, false, false], false)).toEqual([true, false, false]);
    expect(initialSelection([false, true, false], false)).toEqual([false, true, false]);
    expect(isFieldDirty({ kind: "select", selected: [true, false], initial: [false, false], multiple: false })).toBe(false);
    expect(isFieldDirty({ kind: "select", selected: [false, true], initial: [false, false], multiple: false })).toBe(true);
    expect(isFieldDirty({ kind: "select", selected: [false, true], initial: [false, true], multiple: false })).toBe(false);
  });

  it("multi-choice lists keep their exact starting choices", () => {
    expect(isFieldDirty({ kind: "select", selected: [false, false], initial: [false, false], multiple: true })).toBe(false);
    expect(isFieldDirty({ kind: "select", selected: [true, false], initial: [false, false], multiple: true })).toBe(true);
  });

  it("a chosen file is a change; ignored fields never are", () => {
    expect(isFieldDirty({ kind: "file", count: 1 })).toBe(true);
    expect(isFieldDirty({ kind: "file", count: 0 })).toBe(false);
    expect(isFormDirty([{ kind: "ignore" }])).toBe(false);
    expect(isFormDirty([])).toBe(false);
  });

  it("Save and leave goes straight to app pages only", () => {
    expect(safeLeaveTarget("/opportunities/abc?view=board")).toBe("/opportunities/abc?view=board");
    expect(safeLeaveTarget("/api/export/full")).toBeNull();
    expect(safeLeaveTarget("//evil.example.com/x")).toBeNull();
    expect(safeLeaveTarget("https://example.com")).toBeNull();
    expect(safeLeaveTarget("")).toBeNull();
  });
});

describe("+ New next to a reference field", () => {
  it("contacts: name, organization, email, phone, relationship group", () => {
    expect(quickCreateFields("contacts").map((f) => f.name)).toEqual(["name", "organization_id", "email", "phone", "relationship_group"]);
  });

  it("organizations: name, kind, website, phone", () => {
    expect(quickCreateFields("organizations").map((f) => f.name)).toEqual(["name", "kind", "website", "phone"]);
  });

  it("other record types: every required field plus up to 2 simple optional fields, in form order", () => {
    for (const table of ["pipeline_stages", "milestones", "debts", "accounts", "tasks"]) {
      const fields = quickCreateFields(table);
      const r = getResource(table)!;
      const required = r.fields.filter((f) => f.required && !f.readOnly && !f.hideOnForm).map((f) => f.name);
      for (const name of required) expect(fields.map((f) => f.name)).toContain(name);
      expect(fields.map((f) => f.name)).toContain(r.titleField);
      expect(fields.filter((f) => !f.required && f.name !== r.titleField).length).toBeLessThanOrEqual(2);
      const order = r.fields.map((f) => f.name);
      expect(fields.map((f) => order.indexOf(f.name))).toEqual([...fields.map((f) => order.indexOf(f.name))].sort((a, b) => a - b));
    }
  });

  it("record types made only by the app have no + New", () => {
    expect(canQuickCreate("contacts")).toBe(true);
    expect(canQuickCreate("commitments")).toBe(false);
    expect(canQuickCreate("reviews")).toBe(false);
    expect(canQuickCreate("not_a_table")).toBe(false);
    expect(canQuickCreate("scenarios")).toBe(false);
    expect(quickCreateFields("commitments")).toEqual([]);
  });

  it("lists the reference options the dialogs need (organizations for a new contact)", () => {
    const item = getResource("pipeline_items")!;
    expect(quickCreateRefTables(item.fields)).toContain("organizations");
  });

  it("adds the new record to the options once, sorted by name", () => {
    const opts = [
      { id: "1", label: "Avery" },
      { id: "2", label: "Morgan" },
    ];
    const next = addCreatedOption(opts, { id: "3", label: "Jordan" });
    expect(next.map((o) => o.label)).toEqual(["Avery", "Jordan", "Morgan"]);
    expect(addCreatedOption(next, { id: "3", label: "Jordan" })).toBe(next);
  });

  it("type to filter: every word must appear, case and accents ignored", () => {
    const opts = [
      { id: "1", label: "Quinn Demo (broker)" },
      { id: "2", label: "José Álvarez" },
      { id: "3", label: "Demo Car Wash Co" },
    ];
    expect(filterOptions(opts, "demo").map((o) => o.id)).toEqual(["1", "3"]);
    expect(filterOptions(opts, "jose alv").map((o) => o.id)).toEqual(["2"]);
    expect(filterOptions(opts, "  ").length).toBe(3);
    expect(filterOptions(opts, "zzz")).toEqual([]);
  });
});

describe("pipeline view", () => {
  it("opens in list view; the address wins, then the remembered choice", async () => {
    const { resolvePipelineView, pipelineViewCookie } = await import("./pipeline-view");
    expect(resolvePipelineView(undefined, undefined)).toBe("list");
    expect(resolvePipelineView(undefined, "board")).toBe("board");
    expect(resolvePipelineView("list", "board")).toBe("list");
    expect(resolvePipelineView("board", undefined)).toBe("board");
    expect(resolvePipelineView("other", "nonsense")).toBe("list");
    expect(pipelineViewCookie("ab-12;x")).toBe("pipeline_view_ab-12x");
  });
});

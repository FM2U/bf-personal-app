import { describe, expect, it } from "vitest";
import { activeLabels, applyFilters, dateMatches, fieldFilter, filterHref, isDefaultFilters, readFilters, type FilterColumn } from "./list-filters";
import type { Field } from "./resources";

const status: FilterColumn = { key: "status", title: "Status", options: [{ value: "open", label: "Open" }, { value: "met", label: "Met" }, { value: "missed", label: "Missed" }], defaults: ["open"] };
const method: FilterColumn = { key: "method", title: "Method", options: [{ value: "email", label: "Email" }, { value: "call", label: "Call" }] };
const cols = [status, method];

describe("list filters in the address", () => {
  it("reads values, drops unknown ones, and uses defaults when a key is missing", () => {
    expect(readFilters({}, cols)).toEqual({ status: ["open"], method: [] });
    expect(readFilters({ status: "met,bogus", method: "call" }, cols)).toEqual({ status: ["met"], method: ["call"] });
    expect(readFilters(new URLSearchParams("status=all"), cols)).toEqual({ status: [], method: [] });
  });

  it("writes addresses: defaults left out, an emptied default column is all, other parameters kept, w dropped", () => {
    expect(filterHref("/accountability", { status: ["open"], method: [] }, cols)).toBe("/accountability");
    expect(filterHref("/accountability", { status: [], method: ["email", "call"] }, cols)).toBe("/accountability?status=all&method=email,call");
    expect(filterHref("/finance/expenses", { status: ["open"], method: ["call"] }, cols, { month: "2026-09", w: "work", method: "email" })).toBe("/finance/expenses?month=2026-09&method=call");
    expect(isDefaultFilters({ status: ["open"], method: [] }, cols)).toBe(true);
    expect(isDefaultFilters({ status: ["open"], method: ["call"] }, cols)).toBe(false);
  });

  it("makes removable labels", () => {
    const labels = activeLabels({ status: ["open", "met"], method: ["call"] }, cols, (s) => filterHref("/x", s, cols));
    expect(labels.map((l) => [l.label, l.href])).toEqual([
      ["Open", "/x?status=met&method=call"],
      ["Met", "/x?method=call"],
      ["Call", "/x?status=open,met"],
    ]);
  });
});

describe("filters made from record fields", () => {
  const today = "2026-10-29";
  it("puts dates in buckets", () => {
    expect(dateMatches("2026-10-28", ["overdue"], "due", today)).toBe(true);
    expect(dateMatches("2026-10-29", ["week"], "due", today)).toBe(true);
    expect(dateMatches("2026-11-20", ["later"], "due", today)).toBe(true);
    expect(dateMatches(null, ["none"], "due", today)).toBe(true);
    expect(dateMatches("2026-10-25T14:00:00Z", ["7"], "past", today)).toBe(true);
    expect(dateMatches("2026-09-01", ["7"], "past", today)).toBe(false);
    expect(dateMatches("2026-09-01", ["90"], "past", today)).toBe(true);
    expect(dateMatches("2026-01-01", ["older"], "past", today)).toBe(true);
  });

  it("filters rows by choices, yes or no, references, and lists", () => {
    const sel = fieldFilter({ name: "method", label: "Method", type: "select", options: [{ value: "email", label: "Email" }, { value: "call", label: "Call" }], required: true } as Field)!;
    const yes = fieldFilter({ name: "is_deal_source", label: "Deal source", type: "boolean" } as Field)!;
    const ref = fieldFilter({ name: "organization_id", label: "Organization", type: "ref", ref: "organizations" } as Field, { refOptions: [{ id: "o1", label: "Acme" }] })!;
    const multi = fieldFilter({ name: "roles", label: "Roles", type: "multiselect", options: [{ value: "broker", label: "Broker" }] } as Field)!;
    expect(sel.column.options.map((o) => o.value)).toEqual(["email", "call"]);
    expect(ref.column.options.map((o) => o.value)).toEqual(["o1", "none"]);
    const rows = [
      { id: 1, method: "email", is_deal_source: true, organization_id: "o1", roles: ["broker"] },
      { id: 2, method: "call", is_deal_source: false, organization_id: null, roles: [] },
    ];
    const specs = [sel, yes, ref, multi];
    expect(applyFilters(rows, specs, { method: ["call"] }, today).map((r) => r.id)).toEqual([2]);
    expect(applyFilters(rows, specs, { is_deal_source: ["yes"] }, today).map((r) => r.id)).toEqual([1]);
    expect(applyFilters(rows, specs, { organization_id: ["none"] }, today).map((r) => r.id)).toEqual([2]);
    expect(applyFilters(rows, specs, { roles: ["broker"], method: ["email", "call"] }, today).map((r) => r.id)).toEqual([1]);
    expect(applyFilters(rows, specs, {}, today).length).toBe(2);
  });
});

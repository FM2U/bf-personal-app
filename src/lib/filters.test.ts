import { describe, expect, it } from "vitest";
import { activeChips, applyFilters, clearGroup, filterSummary, optionCount, optionCounts, parseTicks, showLabel, tickedCount, ticksToParam, toggleTick, type FilterGroup } from "./filters";

type Row = { name: string; color: string; size: string };
const rows: Row[] = [
  { name: "a", color: "red", size: "s" },
  { name: "b", color: "red", size: "l" },
  { name: "c", color: "blue", size: "s" },
  { name: "d", color: "green", size: "m" },
];
const groups: FilterGroup<Row>[] = [
  { key: "color", title: "Color", options: [{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }, { value: "green", label: "Green" }], test: (r, v) => r.color === v },
  { key: "size", title: "Size", options: [{ value: "s", label: "Small" }, { value: "m", label: "Medium" }, { value: "l", label: "Large" }], test: (r, v) => r.size === v, phrase: (v) => `size ${v}` },
];
const names = (t: Record<string, string[]>) => applyFilters(rows, groups, t).map((r) => r.name);

describe("Filter window logic", () => {
  it("shows everything with nothing ticked", () => {
    expect(names({})).toEqual(["a", "b", "c", "d"]);
  });
  it("OR within a group", () => {
    expect(names({ color: ["red", "blue"] })).toEqual(["a", "b", "c"]);
  });
  it("AND across groups", () => {
    expect(names({ color: ["red", "blue"], size: ["s"] })).toEqual(["a", "c"]);
    expect(names({ color: ["green"], size: ["s"] })).toEqual([]);
  });
  it("counts each choice as if ticked, given the other groups", () => {
    const t = { color: ["red"] };
    expect(optionCount(rows, groups, t, "color", "blue")).toBe(1);
    expect(optionCount(rows, groups, t, "color", "red")).toBe(2);
    expect(optionCount(rows, groups, t, "size", "s")).toBe(1);
    expect(optionCount(rows, groups, t, "size", "m")).toBe(0);
    const all = optionCounts(rows, groups, { size: ["s"] });
    expect(all.color).toEqual({ red: 1, blue: 1, green: 0 });
    expect(all.size).toEqual({ s: 2, m: 1, l: 1 });
  });
  it("a group's default applies until a box in it is ticked", () => {
    const g: FilterGroup<Row>[] = [{ ...groups[0], default: ["red"] }, groups[1]];
    expect(applyFilters(rows, g, {}).map((r) => r.name)).toEqual(["a", "b"]);
    expect(applyFilters(rows, g, { color: ["blue"] }).map((r) => r.name)).toEqual(["c"]);
    expect(optionCount(rows, g, {}, "color", "green")).toBe(1);
    expect(tickedCount(g, {})).toBe(0);
  });
  it("ticks, unticks, clears, counts, chips", () => {
    let t = toggleTick({}, "color", "red");
    t = toggleTick(t, "size", "l");
    expect(tickedCount(groups, t)).toBe(2);
    expect(activeChips(groups, t).map((c) => `${c.groupTitle}: ${c.label}`)).toEqual(["Color: Red", "Size: Large"]);
    t = toggleTick(t, "color", "red");
    expect(t).toEqual({ size: ["l"] });
    expect(clearGroup(t, "size")).toEqual({});
    expect(tickedCount(groups, { color: ["purple"] })).toBe(0);
  });
  it("writes the summary line and the Show button", () => {
    expect(filterSummary(groups, {}, "people")).toBe("Showing all people");
    expect(filterSummary(groups, { color: ["red", "blue"], size: ["s"] }, "people")).toBe("Showing people who are: Red or Blue · size s");
    expect(filterSummary(groups, { size: ["m"] }, "organizations", "that are")).toBe("Showing organizations that are: size m");
    expect(showLabel(1, "person", "people")).toBe("Show 1 person");
    expect(showLabel(12, "person", "people")).toBe("Show 12 people");
    expect(showLabel(4, "organization", "organizations")).toBe("Show 4 organizations");
  });
  it("keeps the ticks in the address", () => {
    const t = { color: ["red", "blue"], size: ["s"] };
    expect(ticksToParam(t)).toBe("color:red,blue;size:s");
    expect(parseTicks("color:red,blue;size:s")).toEqual(t);
    expect(parseTicks("color:red,<x>;bad key:s;size:xl", groups)).toEqual({ color: ["red"] });
    expect(parseTicks(null)).toEqual({});
  });
});

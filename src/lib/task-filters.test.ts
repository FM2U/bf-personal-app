import { describe, expect, it } from "vitest";
import { activeFilterLabels, matchesTaskFilters, parseTaskFilters, taskFilterQuery } from "./task-filters";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-27";

describe("task filters: address", () => {
  it("opens on To do when the address has no status", () => {
    expect(parseTaskFilters({})).toEqual({ status: ["todo"], initiative: [], due: [], priority: [] });
    expect(taskFilterQuery(parseTaskFilters({}))).toBe("");
  });
  it("reads lists (comma separated or repeated), drops unknown values, and reads older links", () => {
    const f = parseTaskFilters(new URLSearchParams(`status=todo,done&initiative=${A}&initiative=${B},bad&due=overdue,today,soon&priority=1,9`));
    expect(f).toEqual({ status: ["todo", "done"], initiative: [A, B], due: ["overdue", "today"], priority: ["1"] });
    expect(parseTaskFilters({ status: "all", due: "all" })).toEqual({ status: [], initiative: [], due: [], priority: [] });
  });
  it("writes the address back, so links, Back, and Forward keep the filters", () => {
    const f = { status: ["todo", "done"], initiative: [A], due: ["week"], priority: ["1"] };
    const q = taskFilterQuery(f);
    expect(q).toBe(`?status=todo,done&initiative=${A}&due=week&priority=1`);
    expect(parseTaskFilters(new URLSearchParams(q.slice(1)))).toEqual(f);
    expect(taskFilterQuery({ status: [], initiative: [], due: [], priority: [] })).toBe("?status=all");
  });
});

describe("task filters: which tasks show", () => {
  const f = (over: Partial<ReturnType<typeof parseTaskFilters>>) => ({ status: [], initiative: [], due: [], priority: [], ...over });
  it("an empty group means any", () => {
    expect(matchesTaskFilters({ status: "done", due_date: null }, f({}), TODAY)).toBe(true);
  });
  it("status, initiative, priority", () => {
    expect(matchesTaskFilters({ status: "todo" }, f({ status: ["done"] }), TODAY)).toBe(false);
    expect(matchesTaskFilters({ status: "todo", initiative_id: A }, f({ initiative: [A] }), TODAY)).toBe(true);
    expect(matchesTaskFilters({ status: "todo", initiative_id: null }, f({ initiative: [A] }), TODAY)).toBe(false);
    expect(matchesTaskFilters({ priority: 1 }, f({ priority: ["1"] }), TODAY)).toBe(true);
    expect(matchesTaskFilters({ priority: null }, f({ priority: ["2"] }), TODAY)).toBe(true);
  });
  it("due date buckets: overdue, today, next 7 days (includes today), later, no date", () => {
    const due = (d: string | null, pick: string[]) => matchesTaskFilters({ due_date: d }, f({ due: pick }), TODAY);
    expect(due("2026-10-26", ["overdue"])).toBe(true);
    expect(due(TODAY, ["today"])).toBe(true);
    expect(due(TODAY, ["week"])).toBe(true);
    expect(due("2026-11-03", ["week"])).toBe(true);
    expect(due("2026-11-04", ["week"])).toBe(false);
    expect(due("2026-11-04", ["later"])).toBe(true);
    expect(due(null, ["none"])).toBe(true);
    expect(due(null, ["overdue", "today"])).toBe(false);
  });
});

describe("task filters: removable labels", () => {
  it("one label per active filter; removing one keeps the others", () => {
    const labels = activeFilterLabels({ status: ["todo"], initiative: [A], due: ["overdue"], priority: ["1"] }, { [A]: "Acquisition Search" });
    expect(labels.map((l) => l.label)).toEqual(["To do", "Acquisition Search", "Overdue", "High priority"]);
    expect(labels.find((l) => l.label === "Overdue")?.href).toBe(`?initiative=${A}&priority=1`);
    expect(labels.find((l) => l.label === "To do")?.href).toBe(`?status=all&initiative=${A}&due=overdue&priority=1`);
  });
});

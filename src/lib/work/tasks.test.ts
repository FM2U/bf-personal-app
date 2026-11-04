import { describe, expect, it } from "vitest";
import { homeTodos, onTodoLists, splitTomorrow, todoSections, type PersonalTodo } from "./personal-todos";
import { parseRecordKind, pipelineItemKind, recordHref, recordPillText, recordTable, type TaskRecord } from "./task-records";

const today = "2026-11-03";
const summit: TaskRecord = { kind: "deal", id: "s1", name: "Summit Logistics Group", closed: false };
const passed: TaskRecord = { kind: "deal", id: "p1", name: "Sunbelt Plumbing", closed: true };
const t = (id: string, dueOn: string | null, record: TaskRecord | null = null, doneAt: string | null = null): PersonalTodo => ({ id, text: id, dueOn, doneAt, position: 1, createdAt: "2026-11-01T10:00:00Z", repeat: null, record });
const local = (ts: string) => ts.slice(0, 10);

describe("one list of tasks and to-dos (push C, merge approved 2026-11-03)", () => {
  it("record tasks with a date mix into the To-dos sections by date; undated record tasks stay on the record", () => {
    const list = [t("personal-none", null), t("deal-none", null, summit), t("deal-late", "2026-11-01", summit), t("personal-today", today), t("deal-week", "2026-11-04", summit), t("deal-later", "2026-11-20", summit), t("deal-done", today, summit, "2026-11-03T15:00:00Z")];
    const s = todoSections(list, today, local);
    expect(s.today.map((x) => x.id)).toEqual(["deal-late", "personal-today", "personal-none"]);
    expect(s.week.map((x) => x.id)).toEqual(["deal-week"]);
    expect(s.later.map((x) => x.id)).toEqual(["deal-later"]);
    expect(s.done.map((x) => x.id)).toEqual(["deal-done"]);
  });

  it("tasks on a closed record stay on the record only", () => {
    expect(onTodoLists(t("x", today, passed))).toBe(false);
    expect(onTodoLists(t("x", today, summit))).toBe(true);
    expect(onTodoLists(t("x", null, summit))).toBe(false);
    expect(onTodoLists(t("x", null))).toBe(true);
  });

  it("Home shows the open ones due today or earlier, record tasks and personal to-dos together", () => {
    const list = [t("deal-late", "2026-10-30", summit), t("personal-today", today), t("deal-tomorrow", "2026-11-04", summit), t("passed-late", "2026-11-01", passed), t("deal-none", null, summit)];
    expect(homeTodos(list, today).map((x) => x.id)).toEqual(["deal-late", "personal-today"]);
  });

  it("Next 7 days has a Tomorrow line", () => {
    const { tomorrow, rest } = splitTomorrow([t("a", "2026-11-04"), t("b", "2026-11-06"), t("c", "2026-11-04")], today);
    expect(tomorrow.map((x) => x.id)).toEqual(["a", "c"]);
    expect(rest.map((x) => x.id)).toEqual(["b"]);
  });

  it("names the record on the gray pill and opens its page", () => {
    expect(recordPillText(summit)).toBe("Deal · Summit Logistics Group");
    expect(recordPillText({ kind: "project", name: "Care plan screens" })).toBe("Rosara · Care plan screens");
    expect(recordHref({ kind: "person", id: "m" })).toBe("/work/people/m");
    expect(recordHref({ kind: "organization", id: "o" })).toBe("/work/people/organizations/o");
    expect(recordHref({ kind: "job", id: "j" })).toBe("/work/jobs/j");
    expect(recordHref({ kind: "listing", id: "l" })).toBe("/work/deals/l");
    expect(recordTable("consulting")).toBe("pipeline_items");
    expect(recordTable("person")).toBe("contacts");
    expect(pipelineItemKind("acquisition", false)).toBe("listing");
    expect(pipelineItemKind("acquisition", true)).toBe("deal");
    expect(pipelineItemKind("job", true)).toBe("job");
    expect(parseRecordKind("organization")).toBe("organization");
    expect(parseRecordKind("tasks")).toBeNull();
  });
});

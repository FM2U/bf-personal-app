import { describe, expect, it } from "vitest";
import { homeTodos, nextPersonalTodoPosition, todoDueLabel, todoSections, type PersonalTodo } from "./personal-todos";

const today = "2026-11-03";
const t = (id: string, dueOn: string | null, doneAt: string | null = null, position = 1, createdAt = "2026-11-01T10:00:00Z"): PersonalTodo => ({ id, text: id, dueOn, doneAt, position, createdAt, repeat: null, record: null });
const local = (ts: string) => ts.slice(0, 10);
const fmt = (d: string) => d.slice(5);

describe("the To-dos sections", () => {
  it("sorts by date (no date last), then position; done today under Done today, older done items left out", () => {
    const s = todoSections([t("nodate", null, null, 1), t("late", "2026-11-01", null, 2), t("todayB", "2026-11-03", null, 3), t("todayA", "2026-11-03", null, 2), t("week", "2026-11-05"), t("later", "2026-11-20"), t("done-now", "2026-11-03", "2026-11-03T14:00:00Z"), t("done-old", null, "2026-11-02T14:00:00Z")], today, local);
    expect(s.today.map((x) => x.id)).toEqual(["late", "todayA", "todayB", "nodate"]);
    expect(s.week.map((x) => x.id)).toEqual(["week"]);
    expect(s.later.map((x) => x.id)).toEqual(["later"]);
    expect(s.done.map((x) => x.id)).toEqual(["done-now"]);
  });

  it("positions a new item after the last and labels the due date", () => {
    expect(nextPersonalTodoPosition([{ position: 2 }, { position: 7 }])).toBe(8);
    expect(nextPersonalTodoPosition([])).toBe(1);
    expect(todoDueLabel("2026-11-03", today, fmt)).toEqual({ text: "Today", tone: "today" });
    expect(todoDueLabel("2026-11-02", today, fmt)).toEqual({ text: "Yesterday", tone: "over" });
    expect(todoDueLabel("2026-10-31", today, fmt)).toEqual({ text: "3 days late", tone: "over" });
    expect(todoDueLabel("2026-11-14", today, fmt)).toEqual({ text: "11-14", tone: "later" });
    expect(todoDueLabel(null, today, fmt)).toEqual({ text: "", tone: "none" });
  });
});

describe("the to-dos Home shows (Edit batch C round 2)", () => {
  it("open to-dos due today or earlier, oldest first; no date, later dates, and done ones stay off Home", () => {
    const list = [t("later", "2026-11-04"), t("today", today), t("none", null), t("old", "2026-10-30"), t("done", "2026-11-01", "2026-11-03T09:00:00Z")];
    expect(homeTodos(list, today).map((x) => x.id)).toEqual(["old", "today"]);
  });
});

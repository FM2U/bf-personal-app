import { describe, expect, it } from "vitest";
import { checklistProgress, checklistsToReset } from "./checklists";

describe("checklists: weekly reset", () => {
  const lists = [
    { id: "groceries", task_template_id: "shop", reset_weekly: true, last_reset_on: "2026-10-24" },
    { id: "never-reset", task_template_id: "shop", reset_weekly: true, last_reset_on: null },
    { id: "keep", task_template_id: "shop", reset_weekly: false, last_reset_on: null },
    { id: "other-task", task_template_id: "cook", reset_weekly: true, last_reset_on: null },
  ];

  it("resets the lists that go with the recurring task when it is created a week later", () => {
    expect(checklistsToReset(lists, "shop", "2026-10-31")).toEqual(["groceries", "never-reset"]);
  });

  it("does not reset twice within 6 days, lists without the weekly reset, or other tasks' lists", () => {
    expect(checklistsToReset(lists, "shop", "2026-10-27")).toEqual(["never-reset"]);
    expect(checklistsToReset(lists, "cook", "2026-10-27")).toEqual(["other-task"]);
    expect(checklistsToReset(lists, "nothing", "2026-10-27")).toEqual([]);
  });

  it("shows progress", () => {
    expect(checklistProgress([{ checked: true }, { checked: false }, { checked: true }]).text).toBe("2 of 3 checked");
    expect(checklistProgress([]).text).toBe("No items yet");
  });
});

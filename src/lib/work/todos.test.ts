import { describe, expect, it } from "vitest";
import { nextTodoPosition, openTodos, sortTodos, todosLabel, topTodo, type DealTodo } from "./todos";

const t = (id: string, position: number, doneAt: string | null = null, createdAt = "2026-10-30T10:00:00Z"): DealTodo => ({ id, text: id, position, doneAt, createdAt });

describe("the Also to do checklist", () => {
  it("orders open items by position then age, and done items after them, most recently done first", () => {
    const list = [t("done-old", 1, "2026-10-29T10:00:00Z"), t("b", 2), t("a", 1), t("done-new", 3, "2026-10-30T10:00:00Z"), t("c", 2, null, "2026-10-29T10:00:00Z")];
    expect(sortTodos(list).map((x) => x.id)).toEqual(["a", "c", "b", "done-new", "done-old"]);
  });

  it("offers the first open item as the next action", () => {
    expect(topTodo([t("done", 1, "2026-10-30T10:00:00Z"), t("second", 3), t("first", 2)])?.id).toBe("first");
    expect(topTodo([t("done", 1, "2026-10-30T10:00:00Z")])).toBeNull();
    expect(topTodo([])).toBeNull();
    expect(openTodos([t("done", 1, "2026-10-30T10:00:00Z"), t("x", 2)]).map((x) => x.id)).toEqual(["x"]);
  });

  it("puts a new item after the last one and labels the count", () => {
    expect(nextTodoPosition([t("a", 1), t("b", 5)])).toBe(6);
    expect(nextTodoPosition([])).toBe(1);
    expect(todosLabel(0)).toBe("Nothing else to do");
    expect(todosLabel(1)).toBe("1 to do");
    expect(todosLabel(3)).toBe("3 to do");
  });
});

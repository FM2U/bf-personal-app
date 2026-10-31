/**
 * The "Also to do" checklist of a deal (Edit batch A, approved 2026-10-31; table deal_todos, database update 0021),
 * pure and tested in src/lib/work/todos.test.ts: the order of the list, the top open item (offered as the next action
 * when the current one is marked Done), and the position of a new item.
 */

export type DealTodo = { id: string; text: string; position: number; doneAt: string | null; createdAt: string };

/** Open items first by position then by age, done items after them (most recently done first). */
export function sortTodos<T extends DealTodo>(todos: readonly T[]): T[] {
  return [...todos].sort((a, b) => {
    if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
    if (a.doneAt && b.doneAt) return a.doneAt < b.doneAt ? 1 : a.doneAt > b.doneAt ? -1 : 0;
    return a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  });
}

/** The first open item (what Done offers as the next action), or null. */
export function topTodo<T extends DealTodo>(todos: readonly T[]): T | null {
  return sortTodos(todos).find((t) => !t.doneAt) ?? null;
}

export function openTodos<T extends DealTodo>(todos: readonly T[]): T[] {
  return sortTodos(todos).filter((t) => !t.doneAt);
}

/** A new item goes after the last one. */
export function nextTodoPosition(todos: readonly DealTodo[]): number {
  return todos.reduce((m, t) => Math.max(m, t.position), 0) + 1;
}

/** "3 to do", "1 to do", "Nothing else to do". */
export function todosLabel(open: number): string {
  return open === 0 ? "Nothing else to do" : `${open} to do`;
}

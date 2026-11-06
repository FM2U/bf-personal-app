/**
 * The To-dos page (batch B; push C, approved 2026-11-03), pure and tested in src/lib/work/personal-todos.test.ts and
 * src/lib/work/tasks.test.ts: the sections Today (overdue and undated personal to-dos included), Next 7 days (with
 * a Tomorrow line), Later, and Done today, the order inside each, and the position of a new item.
 *
 * Push C: a personal to-do and a task on a record are one kind of item (table deal_todos). A personal to-do has no
 * record; a task on a record shows here and on Home only when it has a date (an undated record task stays on its
 * record's Tasks card). Tasks on a closed record (passed, lost, archived) stay on the record only.
 */
import { daysBetween, addDaysISO } from "@/lib/calc/dates";
import type { Repeat } from "@/lib/work/repeat";
import type { TaskRecord } from "@/lib/work/task-records";

export type PersonalTodo = {
  id: string;
  text: string;
  dueOn: string | null;
  doneAt: string | null;
  position: number;
  createdAt: string;
  repeat: Repeat | null;
  /** Push D: the Repeat end date, or null for no end. */
  repeatUntil?: string | null;
  /** The record this item belongs to, or null for a personal to-do. */
  record: TaskRecord | null;
};

export type TodoSectionKey = "today" | "week" | "later" | "done";

export const TODO_SECTIONS: readonly { key: TodoSectionKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "done", label: "Done today" },
];

/** On To-dos and Home: personal to-dos, and record tasks with a date whose record is not closed. */
export function onTodoLists(t: Pick<PersonalTodo, "record" | "dueOn">): boolean {
  if (!t.record) return true;
  return !!t.dueOn && !t.record.closed;
}

/** Today: due today, earlier, or no date. Next 7 days: due tomorrow to seven days on. Later: after that. */
function todoSectionOf(t: Pick<PersonalTodo, "dueOn">, today: string): Exclude<TodoSectionKey, "done"> {
  if (!t.dueOn) return "today";
  const d = t.dueOn.slice(0, 10);
  if (d <= today) return "today";
  return daysBetween(today, d) <= 7 ? "week" : "later";
}

/** Open items by due date (no date last), then position, then age; done items most recently done first. */
export function compareTodos(a: PersonalTodo, b: PersonalTodo): number {
  if (a.doneAt && b.doneAt) return a.doneAt < b.doneAt ? 1 : a.doneAt > b.doneAt ? -1 : 0;
  const da = a.dueOn ?? "9999-12-31";
  const db = b.dueOn ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
}

/**
 * The four sections. `doneLocalDate` turns a done_at timestamp into the owner's date; done items from earlier days
 * are left out (they stay in the table). Items that do not belong on the lists (onTodoLists) are left out.
 */
export function todoSections<T extends PersonalTodo>(todos: readonly T[], today: string, doneLocalDate: (ts: string) => string): Record<TodoSectionKey, T[]> {
  const out: Record<TodoSectionKey, T[]> = { today: [], week: [], later: [], done: [] };
  for (const t of todos) {
    if (!onTodoLists(t)) continue;
    if (t.doneAt) {
      if (doneLocalDate(t.doneAt) === today) out.done.push(t);
      continue;
    }
    out[todoSectionOf(t, today)].push(t);
  }
  for (const k of Object.keys(out) as TodoSectionKey[]) out[k].sort(compareTodos);
  return out;
}

/** Inside Next 7 days: the items due tomorrow, then the rest of the week (approved 2026-11-02). */
export function splitTomorrow<T extends Pick<PersonalTodo, "dueOn">>(week: readonly T[], today: string): { tomorrow: T[]; rest: T[] } {
  const tm = addDaysISO(today, 1);
  return { tomorrow: week.filter((t) => t.dueOn?.slice(0, 10) === tm), rest: week.filter((t) => t.dueOn?.slice(0, 10) !== tm) };
}

/**
 * The items on Home's Next actions (Edit batch C round 2; push C adds dated record tasks): open items due today or
 * earlier, in due order (the oldest first), then position. Items with no date or a later date stay on To-dos.
 */
export function homeTodos<T extends PersonalTodo>(todos: readonly T[], today: string): T[] {
  return todos.filter((t) => onTodoLists(t) && !t.doneAt && !!t.dueOn && t.dueOn.slice(0, 10) <= today).sort(compareTodos);
}

/** Home's Due later (fix list item 3, 2026-11-06): the open items due after today, soonest first. */
export function homeLaterTodos<T extends PersonalTodo>(todos: readonly T[], today: string): T[] {
  return todos.filter((t) => onTodoLists(t) && !t.doneAt && !!t.dueOn && t.dueOn.slice(0, 10) > today).sort(compareTodos);
}

/** A new item goes after the last one. */
export function nextPersonalTodoPosition(todos: readonly { position: number }[]): number {
  return todos.reduce((m, t) => Math.max(m, t.position), 0) + 1;
}

/** "Today", "Nov 5", "Yesterday", "3 days late" (red), or "" with no date. */
export function todoDueLabel(dueOn: string | null, today: string, fmt: (d: string) => string): { text: string; tone: "today" | "over" | "later" | "none" } {
  if (!dueOn) return { text: "", tone: "none" };
  const d = dueOn.slice(0, 10);
  const diff = daysBetween(today, d);
  if (diff === 0) return { text: "Today", tone: "today" };
  if (diff === -1) return { text: "Yesterday", tone: "over" };
  if (diff < 0) return { text: `${-diff} days late`, tone: "over" };
  return { text: fmt(d), tone: "later" };
}

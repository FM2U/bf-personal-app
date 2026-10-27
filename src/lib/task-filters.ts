/**
 * Task list filters (Productivity, Task lists). The filter state lives in the page address, so links, Back, and
 * Forward keep it: `?status=todo,done&initiative=<id>,<id>&due=overdue,today&priority=1`.
 * No `status` in the address means "To do" (the list opens on open tasks); `status=all` (older links) means every status.
 * Pure functions, tested in src/lib/task-filters.test.ts; the popover is src/components/app/task-filter.tsx.
 */
import { addDaysISO } from "@/lib/calc/dates";

export const TASK_STATUSES = [
  { value: "todo", label: "To do" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
] as const;

export const TASK_DUE = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Next 7 days" },
  { value: "later", label: "Later" },
  { value: "none", label: "No due date" },
] as const;

export const TASK_PRIORITIES = [
  { value: "1", label: "High" },
  { value: "2", label: "Normal" },
  { value: "3", label: "Low" },
] as const;

export type TaskFilters = { status: string[]; initiative: string[]; due: string[]; priority: string[] };

const allowed = (list: readonly { value: string }[]) => new Set(list.map((o) => o.value));
const STATUS_SET = allowed(TASK_STATUSES);
const DUE_SET = allowed(TASK_DUE);
const PRIORITY_SET = allowed(TASK_PRIORITIES);
const ID = /^[0-9a-f-]{36}$/i;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function values(sp: Params, key: string): string[] | null {
  const raw = sp instanceof URLSearchParams ? sp.getAll(key) : ([] as string[]).concat(sp[key] ?? []);
  if (!raw.length) return null;
  return [...new Set(raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
}

/** The filters in an address. Unknown values are left out; a missing status means To do. */
export function parseTaskFilters(sp: Params): TaskFilters {
  const status = values(sp, "status");
  return {
    status: status === null ? ["todo"] : status.includes("all") ? [] : status.filter((s) => STATUS_SET.has(s)),
    initiative: (values(sp, "initiative") ?? []).filter((v) => ID.test(v)),
    // Older links used due=all for "any due date".
    due: (values(sp, "due") ?? []).filter((v) => DUE_SET.has(v)),
    priority: (values(sp, "priority") ?? []).filter((v) => PRIORITY_SET.has(v)),
  };
}

/** The address query for the filters ("" for the default: To do, nothing else). Empty status is written status=all. */
export function taskFilterQuery(f: TaskFilters): string {
  const q = new URLSearchParams();
  const isDefaultStatus = f.status.length === 1 && f.status[0] === "todo";
  if (!isDefaultStatus) q.set("status", f.status.length ? f.status.join(",") : "all");
  if (f.initiative.length) q.set("initiative", f.initiative.join(","));
  if (f.due.length) q.set("due", f.due.join(","));
  if (f.priority.length) q.set("priority", f.priority.join(","));
  const s = q.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

/** True when the task passes the filters (an empty list in a group means "any"). */
export function matchesTaskFilters(t: { status?: string | null; initiative_id?: string | null; due_date?: string | null; priority?: number | string | null }, f: TaskFilters, today: string): boolean {
  if (f.status.length && !f.status.includes(String(t.status ?? "todo"))) return false;
  if (f.initiative.length && !(t.initiative_id && f.initiative.includes(t.initiative_id))) return false;
  if (f.priority.length && !f.priority.includes(String(t.priority ?? "2"))) return false;
  if (f.due.length) {
    const d = t.due_date ?? null;
    const weekEnd = addDaysISO(today, 7);
    const bucket = !d ? "none" : d < today ? "overdue" : d === today ? "today" : d <= weekEnd ? "week" : "later";
    // "Next 7 days" includes today.
    if (!(f.due.includes(bucket) || (bucket === "today" && f.due.includes("week")))) return false;
  }
  return true;
}

/** The small removable labels next to the Filter button: each with the address query after removing it ("?" for none). */
export function activeFilterLabels(f: TaskFilters, initiativeNames: Record<string, string>): { key: string; label: string; href: string }[] {
  const out: { key: string; label: string; href: string }[] = [];
  const without = (group: keyof TaskFilters, value: string): string => taskFilterQuery({ ...f, [group]: f[group].filter((v) => v !== value) }) || "?";
  // The status is always shown (the list opens on "To do"); removing the last status shows every status.
  for (const s of f.status) out.push({ key: `status:${s}`, label: TASK_STATUSES.find((o) => o.value === s)?.label ?? s, href: without("status", s) });
  for (const id of f.initiative) out.push({ key: `initiative:${id}`, label: initiativeNames[id] ?? "Initiative", href: without("initiative", id) });
  for (const d of f.due) out.push({ key: `due:${d}`, label: TASK_DUE.find((o) => o.value === d)?.label ?? d, href: without("due", d) });
  for (const p of f.priority) out.push({ key: `priority:${p}`, label: `${TASK_PRIORITIES.find((o) => o.value === p)?.label ?? p} priority`, href: without("priority", p) });
  return out;
}

/** "Clear all": back to the default list (To do). */
export const CLEAR_TASK_FILTERS = "/productivity/tasks";

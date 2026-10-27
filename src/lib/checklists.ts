/**
 * Checklists (named lists of items, example: "Grocery list"). A checklist can go with a recurring task; with
 * "Reset each week" on, every item is unchecked when that recurring task is created (the list is reused weekly).
 * Pure rules, unit tested in src/lib/checklists.test.ts.
 */
import { daysBetween } from "@/lib/calc/dates";

export type ChecklistRow = { id: string; task_template_id: string | null; reset_weekly: boolean; last_reset_on: string | null };

/**
 * Checklists to uncheck when the recurring task `templateId` is created on `today`: "Reset each week" is on, the
 * checklist goes with that recurring task, and it was not reset in the last 6 days (at most once a week, even when
 * the recurring task repeats more often).
 */
export function checklistsToReset(lists: ChecklistRow[], templateId: string, today: string): string[] {
  return lists
    .filter((c) => c.reset_weekly && c.task_template_id === templateId)
    .filter((c) => !c.last_reset_on || daysBetween(c.last_reset_on, today) >= 6)
    .map((c) => c.id);
}

/** "3 of 24 checked". */
export function checklistProgress(items: { checked: boolean }[]): { done: number; total: number; text: string } {
  const done = items.filter((i) => i.checked).length;
  return { done, total: items.length, text: items.length ? `${done} of ${items.length} checked` : "No items yet" };
}

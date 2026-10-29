"use client";

import { FilterPanel } from "@/components/app/filter-panel";
import { CLEAR_TASK_FILTERS, TASK_DUE, TASK_PRIORITIES, TASK_STATUSES, taskFilterQuery, type TaskFilters } from "@/lib/task-filters";
import type { FilterLayout, FilterState } from "@/lib/list-filters";

/**
 * One "Filter" button for the task list (the shared FilterPanel, src/components/app/filter-panel.tsx): 3 columns of
 * checkboxes (Status, Initiative, Due date and Priority), Clear all, and Apply. Active filters show as small labels
 * next to the button; each label's x removes that filter. The filters live in the page address
 * (src/lib/task-filters.ts), so links, Back, and Forward keep them.
 */
export function TaskFilter({ filters, initiatives }: { filters: TaskFilters; initiatives: { id: string; name: string }[] }) {
  const layout: FilterLayout = [
    [{ key: "status", title: "Status", options: [...TASK_STATUSES] }],
    [{ key: "initiative", title: "Initiative", options: initiatives.map((i) => ({ value: i.id, label: i.name })) }],
    [
      { key: "due", title: "Due date", options: [...TASK_DUE] },
      { key: "priority", title: "Priority", options: [...TASK_PRIORITIES], chipSuffix: "priority" },
    ],
  ];
  const toTask = (s: FilterState): TaskFilters => ({ status: s.status ?? [], initiative: s.initiative ?? [], due: s.due ?? [], priority: s.priority ?? [] });
  return (
    <FilterPanel
      layout={layout}
      state={filters}
      hrefFor={(s) => `${CLEAR_TASK_FILTERS}${taskFilterQuery(toTask(s))}`}
      resetHref={CLEAR_TASK_FILTERS}
      isDefault={taskFilterQuery(filters) === ""}
      label="Filter"
    />
  );
}

import Link from "next/link";
import { Badge, dueClass } from "@/components/ui/badge";
import { TaskCheckbox } from "@/components/app/task-checkbox";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { movedNote } from "@/lib/calc/commitment-rule";
import { OpenReviewButton } from "@/components/app/open-review-button";

/** The scheduled review tasks open their review (in the large window) instead of the task page. */
const REVIEW_TASKS: Record<string, "daily" | "weekly" | "monthly" | "quarterly"> = {
  "Complete the daily close": "daily",
  "Complete the weekly review": "weekly",
  "Complete the monthly review": "monthly",
  "Complete the quarterly review": "quarterly",
};

/**
 * Tasks with completion checkboxes. Each title opens the task (in the quick view); a scheduled review task
 * ("Complete the daily close") opens its review in the large window.
 * `dealTypes` (pipeline item id to deal source) marks tasks for proprietary deals.
 * A regular task that moved to the next day shows "Moved N times" under its title.
 */
export function TaskList({ tasks, today, showDue = true, dealTypes }: { tasks: Row[]; today: string; showDue?: boolean; dealTypes?: Record<string, string> }) {
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2">
          <TaskCheckbox id={t.id} done={t.status === "done"} label={t.title} />
          <div className="min-w-0 flex-1">
            {REVIEW_TASKS[t.title] && t.status !== "done" ? (
              <OpenReviewButton kind={REVIEW_TASKS[t.title]} asLink className="clamp-2">
                {t.title}
              </OpenReviewButton>
            ) : (
              <Link href={`/records/tasks/${t.id}`} className={`clamp-2 text-sm hover:underline ${t.status === "done" ? "text-muted-foreground line-through" : "text-slate-900"}`}>
                {t.title}
              </Link>
            )}
            {t.status !== "done" && movedNote(t.times_moved) ? <span className="block text-xs text-status-soon">{movedNote(t.times_moved)}</span> : null}
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {dealTypes && t.pipeline_item_id && dealTypes[t.pipeline_item_id] === "proprietary" ? <Badge variant="gold">Proprietary</Badge> : null}
            {t.priority === 1 ? <Badge variant="warning">High</Badge> : null}
            {showDue && t.due_date ? (
              <span className={`w-20 text-right text-xs ${dueClass(t.due_date, today, t.status === "done") || "text-muted-foreground"}`}>{t.due_date === today ? "Due today" : fmtDate(t.due_date, "MMM d")}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Task lists page: tasks as a table with enough columns to use the width (task, what it is for, priority, due date,
 * status), so no title sits far from its date. Each title opens the task's quick view.
 */
export function TaskTable({ tasks, today, initiatives, items }: { tasks: Row[]; today: string; initiatives: Record<string, string>; items: Record<string, string> }) {
  const PRIORITY: Record<string, string> = { "1": "High", "2": "Normal", "3": "Low" };
  return (
    <div className="-mx-1 overflow-x-auto" data-testid="task-table">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <th className="w-8 px-1 py-2" aria-label="Done" />
            <th className="px-2 py-2">Task</th>
            <th className="px-2 py-2">For</th>
            <th className="w-24 px-2 py-2">Priority</th>
            <th className="w-28 px-2 py-2 text-right">Due</th>
            <th className="w-24 px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const done = t.status === "done";
            const forText = (t.pipeline_item_id && items[t.pipeline_item_id]) || (t.initiative_id && initiatives[t.initiative_id]) || "";
            return (
              <tr key={t.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/70">
                <td className="px-1 py-2">
                  <TaskCheckbox id={t.id} done={done} label={t.title} />
                </td>
                <td className="px-2 py-2">
                  {REVIEW_TASKS[t.title] && !done ? (
                    <OpenReviewButton kind={REVIEW_TASKS[t.title]} asLink className="clamp-2">
                      {t.title}
                    </OpenReviewButton>
                  ) : (
                    <Link href={`/records/tasks/${t.id}`} className={`clamp-2 hover:underline ${done ? "text-muted-foreground line-through" : "text-slate-900"}`}>
                      {t.title}
                    </Link>
                  )}
                  {!done && movedNote(t.times_moved) ? <span className="block text-xs text-status-soon">{movedNote(t.times_moved)}</span> : null}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  <span className="clamp-1">{forText}</span>
                </td>
                <td className="px-2 py-2">{String(t.priority) === "1" ? <Badge variant="warning">High</Badge> : <span className="text-slate-600">{PRIORITY[String(t.priority ?? "2")] ?? ""}</span>}</td>
                <td className={`tabular whitespace-nowrap px-2 py-2 text-right ${dueClass(t.due_date, today, done) || "text-muted-foreground"}`}>{t.due_date ? (t.due_date === today ? "Due today" : fmtDate(t.due_date, "MMM d")) : "No date"}</td>
                <td className="px-2 py-2 text-slate-600">{done ? "Done" : t.status === "skipped" ? "Skipped" : "To do"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

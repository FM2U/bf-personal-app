import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TaskCheckbox } from "@/components/app/task-checkbox";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { movedNote } from "@/lib/calc/commitment-rule";

/**
 * Tasks with completion checkboxes. Each title opens the task.
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
            <Link href={`/records/tasks/${t.id}`} className={`clamp-2 text-sm hover:underline ${t.status === "done" ? "text-muted-foreground line-through" : "text-slate-900"}`}>
              {t.title}
            </Link>
            {t.status !== "done" && movedNote(t.times_moved) ? <span className="block text-xs text-amber-700">{movedNote(t.times_moved)}</span> : null}
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {dealTypes && t.pipeline_item_id && dealTypes[t.pipeline_item_id] === "proprietary" ? <Badge variant="success">Proprietary</Badge> : null}
            {t.priority === 1 ? <Badge variant="warning">High</Badge> : null}
            {showDue && t.due_date ? (
              <span className={`w-20 text-right text-xs ${t.due_date < today && t.status !== "done" ? "font-medium text-red-700" : "text-muted-foreground"}`}>{t.due_date === today ? "Today" : fmtDate(t.due_date, "MMM d")}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

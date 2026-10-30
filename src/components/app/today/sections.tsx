import Link from "next/link";
import { Plus } from "lucide-react";
import { addTargetEntry } from "@/app/actions/targets";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { TaskCheckbox } from "@/components/app/task-checkbox";
import { Badge } from "@/components/ui/badge";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { date as fmtDate } from "@/lib/format";
import type { ActivityRow } from "@/lib/today";
import type { WaitingRow } from "@/lib/calc/today";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A section of Today: a short title with the thin gold line under it, then its rows. */
export function TodaySection({ title, meta, children, testId }: { title: string; meta?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      <h2 className="flex items-baseline justify-between gap-3 border-b border-gold-rule pb-1.5 text-sm font-semibold text-slate-900">
        <span>{title}</span>
        {meta ? <span className="text-xs font-normal text-muted-foreground">{meta}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** Today's activity: each daily target as one aligned row (name, count so far of the minimum, +1 for targets counted by hand). */
export function ActivityRows({ available, rows }: { available: boolean; rows: ActivityRow[] }) {
  if (!available) return <DbUpdateNotice compact />;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No daily target is active today.</p>;
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem] items-center gap-x-3 py-1.5" data-testid="activity-row">
          <Link href="/accountability/targets" className="clamp-1 text-sm text-slate-900 hover:underline">
            {r.name}
          </Link>
          <span className={cn("tabular text-right text-sm", r.met ? "font-medium text-status-met" : "text-slate-700")} data-testid="activity-count">
            {r.count} of {r.required}
          </span>
          <span className="flex justify-end">
            {r.manual ? (
              <GuardedForm action={addTargetEntry}>
                <input type="hidden" name="target_id" value={r.id} />
                <input type="hidden" name="back" value="/" />
                <input type="hidden" name="count" value="1" />
                <SubmitButton size="sm" variant="outline" pendingText="+1" aria-label={`Add 1 to ${r.name}`} className="h-7 w-14" data-testid="activity-plus">
                  <Plus /> 1
                </SubmitButton>
              </GuardedForm>
            ) : (
              <span className="text-xs text-muted-foreground">Counted</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Next actions: open tasks due today or earlier, a checkbox to mark each done, and the title that opens the task window. */
export function NextActionRows({ tasks, more, today }: { tasks: Row[]; more: number; today: string }) {
  if (!tasks.length) return <p className="text-sm text-muted-foreground">Nothing is due today.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-slate-100">
        {tasks.map((t) => (
          <li key={t.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5" data-testid="next-action-row">
            <TaskCheckbox id={t.id} done={t.status === "done"} label={t.title} />
            <Link href={`/records/tasks/${t.id}`} className="clamp-1 text-sm text-slate-900 hover:underline">
              {t.title}
            </Link>
            <span className="flex items-center gap-1.5">
              {t.priority === 1 ? <Badge variant="warning">High</Badge> : null}
              <span className={cn("tabular w-16 text-right text-xs", t.due_date && t.due_date < today ? "text-status-missed" : "text-muted-foreground")}>{t.due_date && t.due_date < today ? fmtDate(t.due_date, "MMM d") : "Today"}</span>
            </span>
          </li>
        ))}
      </ul>
      {more ? (
        <Link href="/productivity/tasks" className="text-xs font-medium text-primary-strong hover:underline" data-testid="next-actions-more">
          {more} more
        </Link>
      ) : null}
    </div>
  );
}

/** Waiting on someone: tasks with a name in "Waiting on" (set in the task window). */
export function WaitingRows({ rows }: { rows: WaitingRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing is waiting on anyone. Set &quot;Waiting on&quot; inside a task to list it here.</p>;
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 text-sm sm:grid-cols-[10rem_7rem_minmax(0,1fr)]" data-testid="waiting-row">
          <span className="clamp-1 font-medium text-slate-900">{r.who}</span>
          <span className="tabular text-xs text-muted-foreground">{r.since ? `since ${fmtDate(r.since, "MMM d")}` : ""}</span>
          <Link href={`/records/tasks/${r.id}`} className="clamp-1 col-span-2 text-slate-800 hover:underline sm:col-span-1">
            {r.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

import Link from "next/link";
import { ChevronRight, Repeat as RepeatIcon } from "lucide-react";
import { date as fmtDate } from "@/lib/format";
import { daysBetween } from "@/lib/calc/dates";
import { repeatLabel, type Repeat } from "@/lib/work/repeat";
import { RECORD_KIND_LABEL, recordHref, recordPillText, type TaskRecord } from "@/lib/work/task-records";
import { cn } from "@/lib/utils";

/**
 * The small pieces every task and to-do shows (push C, approved 2026-11-03): the gray record pill ("Deal · Summit
 * Logistics Group ›", opens the record), the Repeat chip ("Every week"), and the due chip of a record's Tasks card
 * ("Overdue · Nov 2" red, "Today" amber, "Tue Nov 10" gray). Server and client components both use them.
 */

const CHIP = "inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap";

export function RecordPill({ record, className, link = true }: { record: TaskRecord; className?: string; /** False inside a link already (the pill is then plain text). */ link?: boolean }) {
  const body = (
    <>
      <span className="text-slate-500">{RECORD_KIND_LABEL[record.kind]} ·</span>
      <span className="min-w-0 truncate text-slate-800">{record.name}</span>
      <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
    </>
  );
  const cls = cn(CHIP, "border-border bg-white", link && "hover:border-slate-300 hover:bg-slate-50", className);
  if (!link) return <span className={cls} data-testid="record-pill" title={recordPillText(record)}>{body}</span>;
  return (
    <Link href={recordHref(record)} className={cls} data-testid="record-pill" title={`Open ${recordPillText(record)}`} data-row-stop>
      {body}
    </Link>
  );
}

/** "Every week", or with an end date (push D) "Every weekday, until Dec 19". */
export function RepeatChip({ repeat, until, today, className }: { repeat: Repeat; until?: string | null; today?: string | null; className?: string }) {
  return (
    <span className={cn(CHIP, "border-border bg-white text-slate-700", className)} data-testid="repeat-chip" data-until={until ?? ""}>
      <RepeatIcon className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
      {repeatLabel(repeat, until, today)}
    </span>
  );
}

/** The due chip on a record's Tasks card. */
export function DueChip({ dueOn, today, className }: { dueOn: string; today: string; className?: string }) {
  const diff = daysBetween(today, dueOn);
  const text = diff < 0 ? `Overdue · ${fmtDate(dueOn, "MMM d")}` : diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : fmtDate(dueOn, "EEE MMM d");
  const tone = diff < 0 ? "border-status-missed-border bg-status-missed-bg text-status-missed" : diff === 0 ? "border-status-soon-border bg-status-soon-bg text-status-soon" : "border-border bg-status-neutral-bg text-status-neutral";
  return (
    <span className={cn(CHIP, tone, className)} data-testid="due-chip" data-tone={diff < 0 ? "over" : diff === 0 ? "today" : "later"}>
      {text}
    </span>
  );
}

/** The chips line under a task's text: the date (record cards), Repeat, and the record (To-dos, Home). */
export function TaskChips({ dueOn, today, repeat, repeatUntil, record, done = false, className }: { dueOn?: string | null; today?: string; repeat?: Repeat | null; /** The Repeat end date (push D). */ repeatUntil?: string | null; record?: TaskRecord | null; done?: boolean; className?: string }) {
  if (!dueOn && !repeat && !record) return null;
  return (
    <div className={cn("mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5", done && "opacity-60", className)} data-testid="task-chips">
      {dueOn && today ? <DueChip dueOn={dueOn} today={today} /> : null}
      {repeat ? <RepeatChip repeat={repeat} until={repeatUntil} today={today} /> : null}
      {record ? <RecordPill record={record} /> : null}
    </div>
  );
}

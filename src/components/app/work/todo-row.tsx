"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deferTask, setTaskDone } from "@/app/actions/tasks";
import { date as fmtDate } from "@/lib/format";
import { actionKey } from "@/lib/work/lanes";
import { todoDueLabel, type PersonalTodo } from "@/lib/work/personal-todos";
import { repeatDoneLine } from "@/lib/work/repeat";
import { recordHref } from "@/lib/work/task-records";
import { blockSlots } from "@/components/app/work/block-time";
import { AiReason } from "@/components/app/work/project-row";
import { TaskChips } from "@/components/app/work/task-bits";
import { ActionFigures, Confirm, LanePill, Line2, ROW_COLS, RowButton, RowButtons, RowShell } from "@/components/app/work/ui";

/**
 * A personal to-do or a dated record task on Home's Next actions (Edit batch C round 2; push C, approved 2026-11-03):
 * the "To-do" lane pill (a personal to-do) or the "Task" lane pill (a task on a record) and the text; under it the
 * gray record pill ("Deal · Summit Logistics Group ›", opens the record) and the Repeat chip, or "Personal to-do".
 * At the right the due date, the block icon, Done (checks it off everywhere, on the record too; a repeating one adds
 * the next) and Later (moves it to tomorrow). Only items due today or earlier come here.
 */
export function TodoActionRow({ todo, today, reason }: { todo: PersonalTodo; today: string; /** The AI's one-line reason under the row (By the AI). */ reason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: "blue" | "warn"; text: string } | null>(null);
  const due = todoDueLabel(todo.dueOn, today, (d) => fmtDate(d, "MMM d"));
  const href = todo.record ? recordHref(todo.record) : "/work/todos";
  const act = <R extends { ok: true } | { ok: false; error: string }>(fn: () => Promise<R>, text: (r: Extract<R, { ok: true }>) => string) =>
    start(async () => {
      const r = await fn();
      if (r.ok === false) return setResult({ tone: "warn", text: (r as { error: string }).error });
      setResult({ tone: "blue", text: text(r as Extract<R, { ok: true }>) });
      setTimeout(() => router.refresh(), 1200);
    });
  if (result) {
    return (
      <RowShell testId="todo-action-row" dataAttrs={{ "data-todo": todo.id }}>
        <Confirm tone={result.tone} testId="next-action-result">
          <span>{result.text}</span>
          {result.tone === "warn" ? <RowButton onClick={() => setResult(null)}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }
  const where = todo.record ? `It is checked off on ${todo.record.name} too.` : "It is under Done today on To-dos.";
  return (
    <RowShell
      testId="todo-action-row"
      dataAttrs={{ "data-todo": todo.id, "data-record": todo.record ? `${todo.record.kind}:${todo.record.id}` : "" }}
      open={href}
      openLabel={todo.record ? `Open ${todo.record.name}` : "Open To-dos"}
      right={
        <ActionFigures due={due.text ? { text: due.text, tone: due.tone } : null} minutes={null} block={blockSlots({ rowKey: actionKey("To-dos", todo.id), lane: todo.record ? "Task" : "To-do", name: todo.text, action: null, minutes: null, recordType: "deal_todos", recordId: todo.id, href })}>
          <RowButtons pair>
            <RowButton tone="cobalt" disabled={pending} onClick={() => act(() => setTaskDone(todo.id, true), (r) => `Done: ${todo.text}. ${where}${repeatDoneLine(r, (d) => fmtDate(d, "EEE MMM d"))}`)} className={ROW_COLS.button.cls} data-testid="next-action-done">
              {pending ? "Saving" : "Done"}
            </RowButton>
            <RowButton disabled={pending} onClick={() => act(() => deferTask(todo.id), (r) => `Moved to ${fmtDate(r.due, "EEE MMM d")}.`)} className={ROW_COLS.button.cls} data-testid="next-action-later">
              Later
            </RowButton>
          </RowButtons>
        </ActionFigures>
      }
    >
      {/* The pill and the text share one line; a long text wraps under the pill instead of pushing it onto a line of its own. */}
      <div className="min-w-0 text-sm leading-[22px]">
        <LanePill lane={todo.record ? "Task" : "To-do"} className="mr-2.5 align-[1px]" />
        <Link href={href} className="font-semibold text-slate-900 hover:underline" data-testid="todo-link">
          {todo.text}
        </Link>
      </div>
      {todo.record || todo.repeat ? <TaskChips repeat={todo.repeat} repeatUntil={todo.repeatUntil} today={today} record={todo.record} className="mt-1" /> : <Line2 className="text-muted-foreground">Personal to-do</Line2>}
      {reason ? <AiReason text={reason} /> : null}
    </RowShell>
  );
}

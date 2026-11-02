"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deferPersonalTodo, setPersonalTodoDone } from "@/app/actions/todos";
import { date as fmtDate } from "@/lib/format";
import { todoDueLabel, type PersonalTodo } from "@/lib/work/personal-todos";
import { AiReason } from "@/components/app/work/project-row";
import { ActionFigures, Confirm, LanePill, Line1, Line2, ROW_COLS, RowButton, RowButtons, RowShell } from "@/components/app/work/ui";

/**
 * A personal to-do on Home's Next actions (Edit batch C round 2, approved 2026-11-02): the "To-do" lane pill and the
 * to-do's text, the due date in the due column (the minutes column stays empty), Done (checks it off; it shows under
 * Done today on the To-dos page) and Later (moves it to tomorrow). Only to-dos due today or earlier come here.
 */
export function TodoActionRow({ todo, today, reason }: { todo: PersonalTodo; today: string; /** The AI's one-line reason under the row (By the AI). */ reason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ tone: "blue" | "warn"; text: string } | null>(null);
  const due = todoDueLabel(todo.dueOn, today, (d) => fmtDate(d, "MMM d"));
  const act = (fn: () => Promise<{ ok: true; due?: string } | { ok: false; error: string }>, text: (r: { due?: string }) => string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setResult({ tone: "blue", text: text(r) });
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
  return (
    <RowShell
      testId="todo-action-row"
      dataAttrs={{ "data-todo": todo.id }}
      open="/work/todos"
      openLabel="Open To-dos"
      right={
        <ActionFigures due={due.text ? { text: due.text, tone: due.tone } : null} minutes={null}>
          <RowButtons pair>
            <RowButton tone="cobalt" disabled={pending} onClick={() => act(() => setPersonalTodoDone(todo.id, true), () => `Done: ${todo.text}. It is under Done today on To-dos.`)} className={ROW_COLS.button.cls} data-testid="next-action-done">
              {pending ? "Saving" : "Done"}
            </RowButton>
            <RowButton disabled={pending} onClick={() => act(() => deferPersonalTodo(todo.id), (r) => `Moved to ${r.due ? fmtDate(r.due, "EEE MMM d") : "tomorrow"}.`)} className={ROW_COLS.button.cls} data-testid="next-action-later">
              Later
            </RowButton>
          </RowButtons>
        </ActionFigures>
      }
    >
      <Line1>
        <LanePill lane="To-do" />
        <Link href="/work/todos" className="hover:underline" data-testid="todo-link">
          <span className="text-sm font-semibold text-slate-900">{todo.text}</span>
        </Link>
      </Line1>
      <Line2 className="text-muted-foreground">Personal to-do</Line2>
      {reason ? <AiReason text={reason} /> : null}
    </RowShell>
  );
}

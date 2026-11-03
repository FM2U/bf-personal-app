"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import type { AskContext } from "@/lib/work/ask-ai";
import { sortTodos, todosLabel, type DealTodo } from "@/lib/work/todos";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { AiButton, RowButton, WorkCard } from "@/components/app/work/ui";
import { ShowAll } from "@/components/app/work/show-all";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

type Result = { ok: true } | { ok: false; error: string; /** The AI's reply (first 300 characters) when it could not be used. */ reply?: string };

/**
 * Tasks (the record-page rule, batch B; the deal's "Also to do" renamed): other things to do on this record, outside
 * its one next action (they do not show on Home). Each item has a checkbox (done), a faint x (delete), and "Make
 * this the next action" (the text becomes the next action or follow-up and the item leaves the list; the old one
 * is kept as an item). "+ Add" adds a typed item; "Suggest tasks" (deals) asks the AI for up to 5 and shares the one
 * thinking state of every AI button; when the reply cannot be used the note shows it with Try again (Edit batch B).
 * The same card serves deals, people, projects, opportunities, and consulting items; the actions come from the page.
 * Batch B2: the purple star in the header opens the Ask AI panel about this card; the star inside the add box writes
 * one task.
 */
export function TasksCard({ tasks, open, actions, placeholder, emptyText, testId = "deal-todos", ai, windowTitle = "Tasks" }: {
  /** The title of the Show all window ("Tasks · Transworld Business Advisors"). */
  windowTitle?: string;
  tasks: DealTodo[];
  /** The Ask AI context of the page (the card star and the field star), when the page has one. */
  ai?: AskContext | null;
  /** The record is open (closed records show the list without the add and move controls). */
  open: boolean;
  actions: {
    add: (text: string) => Promise<Result>;
    setDone: (id: string, done: boolean) => Promise<Result>;
    remove: (id: string) => Promise<Result>;
    makeNext: (id: string) => Promise<Result & { nextAction?: string }>;
    suggest?: () => Promise<(Result & { added?: number })>;
  };
  placeholder: string;
  emptyText: string;
  testId?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string; reply?: string | null; retry?: () => void } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  // The checkbox shows the click at once; the saved state arrives with the page re-read.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (prevTasks !== tasks) {
    setPrevTasks(tasks);
    setTicked({});
  }
  const list = sortTodos(tasks);
  const openCount = list.filter((t) => !t.doneAt).length;
  const act = <R extends Result>(fn: () => Promise<R>, after?: (r: Extract<R, { ok: true }>) => void, retry?: () => void) =>
    start(async () => {
      setNote(null);
      const r = await fn();
      if (r.ok === false) return setNote({ tone: "warn", text: (r as { ok: false; error: string }).error, reply: (r as { ok: false; reply?: string }).reply, retry });
      after?.(r as Extract<R, { ok: true }>);
      router.refresh();
    });
  const suggest = () => {
    if (!actions.suggest) return;
    setSuggesting(true);
    act(
      () => actions.suggest!().finally(() => setSuggesting(false)),
      (r) => setNote({ tone: "ok", text: r.added ? `${r.added} suggested.` : "Nothing new to add." }),
      () => suggest(),
    );
  };
  useUnsavedWork(text.trim() !== "", "The task you typed is not added yet.");
  const add = () => {
    if (!text.trim()) return;
    act(
      () => actions.add(text),
      () => {
        setText("");
        setAdding(false);
      },
    );
  };
  return (
    <WorkCard
      title="Tasks"
      hint={todosLabel(openCount)}
      actions={
        open ? (
          <>
            <button type="button" onClick={() => setAdding(true)} className="text-xs font-medium text-primary-strong hover:underline" data-testid="todo-add">
              + Add
            </button>
            {actions.suggest ? (
              <AiButton busy={suggesting} onClick={suggest} disabled={pending} className="h-7 px-2.5 text-xs" data-testid="todo-suggest">
                Suggest tasks
              </AiButton>
            ) : null}
            {ai ? <AiCardStar context={{ ...ai, card: "Tasks" }} /> : null}
          </>
        ) : ai ? (
          <AiCardStar context={{ ...ai, card: "Tasks" }} />
        ) : undefined
      }
      testId={testId}
    >
      <div className="flex flex-col px-[22px] pt-2 pb-4" data-testid="todo-list">
        <ShowAll
          items={list}
          title={windowTitle}
          sub={`All ${list.length} tasks, open first`}
          text={(t) => t.text}
          testId="tasks-all"
          className="flex justify-center pt-2 pb-1 text-[13px]"
          wrap={(rows, inWindow) => (inWindow ? <div className="flex flex-col px-[22px]">{rows}</div> : <>{rows}</>)}
          render={(t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 py-[7px] last:border-b-0" data-testid="todo-item" data-done={t.doneAt ? "1" : "0"}>
            <input
              type="checkbox"
              checked={ticked[t.id] ?? !!t.doneAt}
              onChange={(e) => {
                const on = e.target.checked;
                setTicked((m) => ({ ...m, [t.id]: on }));
                act(() => actions.setDone(t.id, on));
              }}
              disabled={pending}
              aria-label={`Done: ${t.text}`}
              className="h-4 w-4 shrink-0 accent-[var(--primary)]"
              data-testid="todo-check"
            />
            <span className={cn("min-w-0 flex-1 basis-[220px] text-sm text-slate-800", t.doneAt && "text-slate-400 line-through")} data-testid="todo-text">
              {t.text}
            </span>
            {!t.doneAt && open ? (
              <button type="button" onClick={() => act(() => actions.makeNext(t.id), (r) => setNote({ tone: "ok", text: `Next action set: ${r.nextAction ?? t.text}, due tomorrow.` }))} disabled={pending} className="ml-6 shrink-0 text-xs font-medium whitespace-nowrap text-primary-strong hover:underline sm:ml-0" data-testid="todo-make-next">
                Make this the next action
              </button>
            ) : null}
            <button type="button" onClick={() => act(() => actions.remove(t.id))} disabled={pending} className="h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label={`Delete: ${t.text}`} title="Delete" data-testid="todo-delete">
              ×
            </button>
          </div>
          )}
        />
        {!list.length && !adding ? <p className="py-2 text-[13px] text-muted-foreground">{emptyText}</p> : null}
        {adding ? (
          <div className="flex items-center gap-2 pt-2">
            <div className="relative min-w-0 flex-1">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                  if (e.key === "Escape") {
                    setAdding(false);
                    setText("");
                  }
                }}
                autoFocus
                placeholder={placeholder}
                className={cn(INPUT, ai && "pr-9")}
                data-testid="todo-input"
              />
              {ai ? <AiFieldStar context={ai} field={{ key: "task_text", label: "Task", current: text }} visible={!text.trim() || focused} onUse={setText} /> : null}
            </div>
            <RowButton tone={text.trim() ? "primary" : "outline"} onClick={add} disabled={pending || !text.trim()} data-testid="todo-save">
              Add
            </RowButton>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setText("");
              }}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : null}
        {note ? (
          <p className={cn("pt-2 text-[13px]", note.tone === "ok" ? "text-status-met" : "text-status-missed")} role="status" data-testid="todo-note">
            {note.text}
            {note.reply ? (
              <>
                {" "}
                Its reply: <q className="text-slate-700 italic" data-testid="todo-note-reply">{note.reply}</q>
              </>
            ) : null}
            {note.retry ? (
              <>
                {" "}
                <button type="button" onClick={note.retry} className="font-medium text-primary-strong hover:underline" data-testid="todo-note-retry">
                  Try again
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </WorkCard>
  );
}

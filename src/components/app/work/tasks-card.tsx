"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask, deleteTask, editTask, setTaskDone } from "@/app/actions/tasks";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import type { AskContext } from "@/lib/work/ask-ai";
import { repeatDoneLine, type Repeat } from "@/lib/work/repeat";
import type { RecordKind } from "@/lib/work/task-records";
import { sortTodos, todosLabel, type DealTodo } from "@/lib/work/todos";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { rememberOpened } from "@/components/app/work/link-picker";
import { rowClickOpens } from "@/components/app/work/open-row";
import { TaskChips } from "@/components/app/work/task-bits";
import { EndsInput, RepeatSelect } from "@/components/app/work/todos-board";
import { AiButton, RowButton, WorkCard } from "@/components/app/work/ui";
import { ShowAll } from "@/components/app/work/show-all";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "mb-1 block text-[12.5px] font-medium text-slate-700";

type Result = { ok: true } | { ok: false; error: string; /** The AI's reply (first 300 characters) when it could not be used. */ reply?: string };

/**
 * Tasks (the record-page rule, batch B; the deal's "Also to do" renamed): other things to do on this record, outside
 * its one next action. Each item has a checkbox (done), a faint x (delete), and "Make this the next action" (the text
 * becomes the next action or follow-up and the item leaves the list; the old one is kept as an item). "+ Add" adds a
 * typed item with an optional date; "Suggest tasks" (deals) asks the AI for up to 5 and shares the one thinking state
 * of every AI button. The same card serves deals, listings, people, organizations, projects, jobs and consulting.
 *
 * Push C (approved 2026-11-03): a task can have a due date and Repeat, shown as chips on a second line under the
 * text; a click on the text opens the edit box (the text, the due date, Repeat). A task with a date also shows on
 * To-dos and on Home's Next actions; checking it off anywhere checks it off here (one item, table deal_todos), and a
 * repeating one adds the next. A to-do linked to this record from To-dos is one of these tasks. Opening the page
 * notes the record as opened today (the Link to picker offers it first).
 *
 * Push D (approved 2026-11-04): Add has Repeat too, and beside Repeat (here and in the edit box) an optional Ends date,
 * shown only while the task repeats; after that date checking it off adds no new copy.
 */
export function TasksCard({ tasks, open, record, today, actions, placeholder, emptyText, testId = "deal-todos", ai, windowTitle = "Tasks" }: {
  /** The title of the Show all window ("Tasks · Transworld Business Advisors"). */
  windowTitle?: string;
  tasks: DealTodo[];
  /** The record the tasks belong to. */
  record: { kind: RecordKind; id: string };
  /** The owner's date (YYYY-MM-DD), for the due chips. */
  today: string;
  /** The Ask AI context of the page (the card star and the field star), when the page has one. */
  ai?: AskContext | null;
  /** The record is open (closed records show the list without the add and move controls). */
  open: boolean;
  actions: {
    makeNext: (id: string) => Promise<Result & { nextAction?: string }>;
    suggest?: () => Promise<(Result & { added?: number })>;
  };
  placeholder: string;
  emptyText: string;
  testId?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [repeat, setRepeat] = useState<Repeat | "">("");
  const [until, setUntil] = useState("");
  const [adding, setAdding] = useState(false);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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
  useEffect(() => rememberOpened(today, `${record.kind === "listing" ? "deal" : record.kind}:${record.id}`), [today, record.kind, record.id]);
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
      () => addTask({ text, due: due || null, repeat, until: repeat ? until || null : null, link: record }),
      () => {
        setText("");
        setDue("");
        setRepeat("");
        setUntil("");
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
          render={(t, _i, inWindow) => (
            <div key={t.id} className="border-b border-slate-100 last:border-b-0" data-testid="todo-item" data-done={t.doneAt ? "1" : "0"} data-todo={t.id}>
              {/* A click on the row (outside its checkbox and buttons) opens the edit box; the text button is the keyboard path. */}
              <div
                onClick={(e) => {
                  if (open && !t.doneAt && !inWindow && editing !== t.id && rowClickOpens(e)) setEditing(t.id);
                }}
                className={cn("-mx-2 grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 px-2 py-[7px] sm:grid-cols-[16px_minmax(0,1fr)_auto_24px]", open && !t.doneAt && !inWindow && "row-hover")}
              >
                <input
                  type="checkbox"
                  checked={ticked[t.id] ?? !!t.doneAt}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setTicked((m) => ({ ...m, [t.id]: on }));
                    act(
                      () => setTaskDone(t.id, on),
                      (r) => {
                        if (on && (r.next || r.ended)) setNote({ tone: "ok", text: `Done.${repeatDoneLine(r, (d) => fmtDate(d, "EEE MMM d"))}` });
                      },
                    );
                  }}
                  disabled={pending}
                  aria-label={`Done: ${t.text}`}
                  className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--primary)]"
                  data-testid="todo-check"
                />
                <div className="min-w-0">
                  <button type="button" onClick={() => open && !t.doneAt && !inWindow && setEditing(t.id)} className={cn("max-w-full rounded text-left text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", t.doneAt && "cursor-default text-slate-400 line-through")} title={open && !t.doneAt ? "Click to edit" : undefined} data-testid="todo-text">
                    {t.text}
                  </button>
                  <TaskChips dueOn={t.doneAt ? null : t.dueOn} today={today} repeat={t.repeat} repeatUntil={t.repeatUntil} done={!!t.doneAt} />
                </div>
                {!t.doneAt && open ? (
                  <button type="button" onClick={() => act(() => actions.makeNext(t.id), (r) => setNote({ tone: "ok", text: `Next action set: ${r.nextAction ?? t.text}, due tomorrow.` }))} disabled={pending} className="col-start-2 justify-self-start text-xs leading-5 font-medium whitespace-nowrap text-primary-strong hover:underline sm:col-start-auto sm:justify-self-end" data-testid="todo-make-next">
                    Make this the next action
                  </button>
                ) : (
                  <span className="hidden sm:block" />
                )}
                <button type="button" onClick={() => act(() => deleteTask(t.id))} disabled={pending} className="col-start-3 row-start-1 h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600 sm:col-start-4" aria-label={`Delete: ${t.text}`} title="Delete" data-testid="todo-delete">
                  ×
                </button>
              </div>
              {editing === t.id && !inWindow ? <TaskEditBox task={t} today={today} pending={pending} onCancel={() => setEditing(null)} onSave={(v) => act(() => editTask(t.id, v), () => setEditing(null))} /> : null}
            </div>
          )}
        />
        {!list.length && !adding ? <p className="py-2 text-[13px] text-muted-foreground">{emptyText}</p> : null}
        {adding ? (
          <div className="grid grid-cols-1 items-center gap-2 pt-2 sm:grid-cols-[minmax(0,1fr)_150px_auto_auto]" data-testid="todo-add-row">
            <div className="relative min-w-0">
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
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} aria-label="Due date (optional)" data-testid="todo-input-due" />
            <RowButton tone={text.trim() ? "primary" : "outline"} onClick={add} disabled={pending || !text.trim()} className="h-9" data-testid="todo-save">
              Add
            </RowButton>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setText("");
                setDue("");
                setRepeat("");
                setUntil("");
              }}
              className="justify-self-start text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
            <div className={"grid grid-cols-1 gap-2 sm:col-span-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"} data-testid="todo-add-repeat-row">
              <RepeatSelect value={repeat} onChange={setRepeat} testId="todo-input-repeat" />
              {repeat ? <EndsInput value={until} onChange={setUntil} min={due || today} inline testId="todo-input-until" /> : <span className="hidden sm:block" />}
            </div>
          </div>
        ) : null}
        {list.length || adding ? (
          <p className="pt-2.5 text-[12.5px] text-muted-foreground" data-testid="tasks-dated-note">
            Tasks with a date also show on To-dos and Home.
          </p>
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

/** The edit box under a record task (approved 2026-11-03): the text, then Due date, Repeat, and Ends (push D, while it repeats); Save and Cancel. */
function TaskEditBox({ task, today, pending, onSave, onCancel }: { task: DealTodo; today: string; pending: boolean; onSave: (v: { text: string; due: string | null; repeat: Repeat | ""; until: string | null }) => void; onCancel: () => void }) {
  const [text, setText] = useState(task.text);
  const [due, setDue] = useState(task.dueOn ?? "");
  const [repeat, setRepeat] = useState<Repeat | "">(task.repeat ?? "");
  const [until, setUntil] = useState(task.repeatUntil ?? "");
  const dirty = text !== task.text || due !== (task.dueOn ?? "") || repeat !== (task.repeat ?? "") || (repeat ? until : "") !== (task.repeatUntil ?? "");
  useUnsavedWork(dirty, "Your changes to this task are not saved yet.");
  const save = () => onSave({ text, due: due || null, repeat, until: repeat ? until || null : null });
  return (
    <div
      className="mb-2.5 ml-[26px] rounded-[10px] border border-border bg-slate-50 px-4 pt-3 pb-3.5"
      data-testid="task-edit-box"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label className={LABEL} htmlFor={`tk-text-${task.id}`}>
        Task
      </label>
      <input
        id={`tk-text-${task.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        autoFocus
        className={INPUT}
        data-testid="task-edit-text"
      />
      <div className={cn("mt-3 grid grid-cols-1 gap-3", repeat ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <div className="min-w-0">
          <label className={LABEL} htmlFor={`tk-due-${task.id}`}>
            Due date
          </label>
          <input id={`tk-due-${task.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={INPUT} data-testid="task-edit-due" />
        </div>
        <div className="min-w-0">
          <label className={LABEL} htmlFor={`tk-rep-${task.id}`}>
            Repeat
          </label>
          <RepeatSelect id={`tk-rep-${task.id}`} value={repeat} onChange={setRepeat} testId="task-edit-repeat" />
        </div>
        {repeat ? (
          <div className="min-w-0">
            <label className={cn(LABEL, "whitespace-nowrap")} htmlFor={`tk-until-${task.id}`}>
              Ends <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <EndsInput id={`tk-until-${task.id}`} value={until} onChange={setUntil} min={due || today} testId="task-edit-until" />
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <RowButton tone="primary" disabled={pending || !text.trim()} onClick={save} className="h-8 px-3.5 text-[13px]" data-testid="task-edit-save">
          Save
        </RowButton>
        <RowButton onClick={onCancel} className="h-8 px-3 text-[13px]" data-testid="task-edit-cancel">
          Cancel
        </RowButton>
      </div>
    </div>
  );
}

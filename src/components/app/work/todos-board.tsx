"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask, deleteTask, editTask, setTaskDone, type TaskLink } from "@/app/actions/tasks";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import type { LinkRecord } from "@/lib/work/link-picker";
import { splitTomorrow, TODO_SECTIONS, todoDueLabel, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import type { TodosData } from "@/lib/work/personal-todos-data";
import { REPEAT_CHOICES, type Repeat } from "@/lib/work/repeat";
import type { TaskRecord } from "@/lib/work/task-records";
import { useSections } from "@/components/app/work/sections";
import { StickySections } from "@/components/app/work/sticky-sections";
import { rowClickOpens } from "@/components/app/work/open-row";
import { LinkPicker } from "@/components/app/work/link-picker";
import { TaskChips } from "@/components/app/work/task-bits";
import { CollapseAllButton, Due, RowButton, SectionHeading } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The To-dos page (batch B; push C, approved 2026-11-02 and 2026-11-03): one card, at most 720px wide. Sections Today
 * (overdue and undated personal to-dos included), Next 7 days (a Tomorrow line, then the rest of the week), Later,
 * and Done today, with the band headings (only Today open by default, remembered per day). Personal to-dos and the
 * dated tasks of records mix by date: a record task carries the gray record pill (opens the record), a repeating one
 * the Repeat chip. Checking one off anywhere checks it off everywhere; a repeating one adds the next. A click on a
 * row (outside the checkbox, the pill and the x) opens the full-width edit box: the text, the due date, Repeat, and
 * Link to (the shared picker; linking puts the item on that record's Tasks card, unlinking makes it personal again).
 * Add at the bottom: the text, an optional date, Repeat, and Link to.
 */
const STORAGE_KEY = "work-todos-sections";
const INPUT = "h-9 min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "mb-1 block text-[12.5px] font-medium text-slate-700";

/** The picker's entry for a task's record (from the loaded list, or built from the task). */
function linkOf(record: TaskRecord | null, records: readonly LinkRecord[]): LinkRecord | null {
  if (!record) return null;
  return records.find((r) => r.id === record.id) ?? { kind: record.kind, id: record.id, name: record.name, status: "", closed: record.closed, dueToday: false };
}
const toLink = (r: LinkRecord | null): TaskLink => (r ? { kind: r.kind, id: r.id } : null);

export function TodosBoard({ data }: { data: TodosData }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [repeat, setRepeat] = useState<Repeat | "">("");
  const [link, setLink] = useState<LinkRecord | null>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [prev, setPrev] = useState(data);
  if (prev !== data) {
    setPrev(data);
    setTicked({});
  }
  useUnsavedWork(text.trim() !== "", "The to-do you typed is not added yet.");
  const { sections, today, records } = data;
  // Only Today opens by default; what is opened or closed is remembered for the rest of the day (approved 2026-11-03).
  const ui = useSections(
    `${STORAGE_KEY}:${today}`,
    TODO_SECTIONS.map((s) => ({ name: s.label, count: sections[s.key].length, hasMatch: true, defaultOpen: s.key === "today" })),
    false,
  );
  const act = <R extends { ok: true } | { ok: false; error: string }>(fn: () => Promise<R>, after?: (r: Extract<R, { ok: true }>) => void) =>
    start(async () => {
      setNote(null);
      const r = await fn();
      if (r.ok === false) return setNote({ tone: "warn", text: (r as { error: string }).error });
      after?.(r as Extract<R, { ok: true }>);
      router.refresh();
    });
  const add = () => {
    if (!text.trim()) return;
    act(
      () => addTask({ text, due, repeat, link: toLink(link) }),
      () => {
        setText("");
        setDue("");
        setRepeat("");
        setLink(null);
      },
    );
  };
  const check = (t: PersonalTodo, on: boolean) => {
    setTicked((m) => ({ ...m, [t.id]: on }));
    act(
      () => setTaskDone(t.id, on),
      (r) => {
        if (on && r.next) setNote({ tone: "ok", text: `Done. The next one is on ${fmtDate(r.next, "EEE MMM d")}.` });
      },
    );
  };
  const line = (t: PersonalTodo, s: TodoSectionKey) => (
    <TodoLine
      key={t.id}
      todo={t}
      today={today}
      section={s}
      records={records}
      checked={ticked[t.id] ?? !!t.doneAt}
      pending={pending}
      editing={editing === t.id}
      onOpenEdit={() => setEditing(t.id)}
      onCloseEdit={() => setEditing(null)}
      onCheck={(on) => check(t, on)}
      onSave={(v) => act(() => editTask(t.id, v), () => setEditing(null))}
      onDelete={() => act(() => deleteTask(t.id))}
    />
  );
  return (
    <section className="w-full max-w-[720px] rounded-xl border border-border bg-white px-[22px] pt-1 pb-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="todos-card">
      <div className="flex items-center justify-between gap-3 pt-2 pb-2">
        {note ? (
          <p className={cn("min-w-0 text-[13px]", note.tone === "ok" ? "text-status-met" : "text-status-missed")} role={note.tone === "warn" ? "alert" : "status"} data-testid={note.tone === "warn" ? "todos-error" : "todos-note"}>
            {note.text}
          </p>
        ) : (
          <span />
        )}
        <CollapseAllButton allCollapsed={ui.allCollapsed} onClick={ui.toggleAll} />
      </div>
      <StickySections under="page">
        {TODO_SECTIONS.map((s) => {
          const list = sections[s.key];
          const closed = ui.isCollapsed(s.label);
          const split = s.key === "week" ? splitTomorrow(list, today) : null;
          return (
            <div key={s.key} data-testid="todos-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
              <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => ui.toggle(s.label)} band />
              {list.length && !closed ? (
                <div className="flex flex-col" data-testid="section-body">
                  {split && split.tomorrow.length ? (
                    <>
                      <SubLine label="Tomorrow" testId="todos-tomorrow" />
                      {split.tomorrow.map((t) => line(t, s.key))}
                      {split.rest.length ? <SubLine label="Rest of the week" testId="todos-rest-of-week" /> : null}
                      {split.rest.map((t) => line(t, s.key))}
                    </>
                  ) : (
                    list.map((t) => line(t, s.key))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </StickySections>
      <div className="mt-4 flex flex-col gap-2" data-testid="todo-add-form">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add a to-do"
            aria-label="Add a to-do"
            className={INPUT}
            data-testid="personal-todo-input"
          />
          <input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-full")} aria-label="Due date (optional)" data-testid="personal-todo-due" />
          <RowButton tone={text.trim() ? "primary" : "outline"} disabled={pending || !text.trim()} onClick={add} className="h-9 px-3.5 text-[13px]" data-testid="personal-todo-add">
            Add
          </RowButton>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[190px_minmax(0,1fr)]">
          <RepeatSelect value={repeat} onChange={setRepeat} testId="personal-todo-repeat" />
          <LinkPicker records={records} value={link} onChange={setLink} today={today} placeholder="Link to a record (optional): click to pick, or type" testId="add-link" />
        </div>
        <p className="text-[12.5px] text-muted-foreground">A to-do linked to a record also shows on that record&apos;s Tasks card. Checking off a repeating one adds the next.</p>
      </div>
    </section>
  );
}

function SubLine({ label, testId }: { label: string; testId: string }) {
  return (
    <div className="border-b border-slate-100 pt-3 pb-1 text-[11.5px] font-semibold tracking-[0.06em] text-slate-500 uppercase" data-testid={testId}>
      {label}
    </div>
  );
}

export function RepeatSelect({ value, onChange, testId, id }: { value: Repeat | ""; onChange: (v: Repeat | "") => void; testId: string; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Repeat | "")} className={cn(INPUT, "w-full pr-7")} aria-label="Repeat" data-testid={testId}>
      {REPEAT_CHOICES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function TodoLine({ todo, today, section, records, checked, pending, editing, onOpenEdit, onCloseEdit, onCheck, onSave, onDelete }: { todo: PersonalTodo; today: string; section: TodoSectionKey; records: readonly LinkRecord[]; checked: boolean; pending: boolean; editing: boolean; onOpenEdit: () => void; onCloseEdit: () => void; onCheck: (on: boolean) => void; onSave: (v: { text: string; due: string | null; repeat: Repeat | ""; link: TaskLink }) => void; onDelete: () => void }) {
  const due = todoDueLabel(todo.dueOn, today, (d) => fmtDate(d, "MMM d"));
  const clickable = !todo.doneAt && !editing;
  return (
    <div className={cn("border-b border-slate-100 last:border-b-0", editing && "pb-3")} data-testid="personal-todo" data-done={todo.doneAt ? "1" : "0"} data-todo={todo.id} data-record={todo.record ? `${todo.record.kind}:${todo.record.id}` : ""}>
      {/* The row's click is a shortcut for the text button (the keyboard path), so it needs no key handler of its own. */}
      <div
        onClick={(e) => {
          if (clickable && rowClickOpens(e)) onOpenEdit();
        }}
        className={cn("group -mx-2 grid grid-cols-[16px_minmax(0,1fr)_auto_24px] items-start gap-x-3 px-2 py-[9px]", clickable && "row-hover", section === "done" && "opacity-70")}
      >
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} disabled={pending} aria-label={`Done: ${todo.text}`} className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--primary)]" data-testid="personal-todo-check" />
        <div className="min-w-0">
          <button type="button" onClick={() => !todo.doneAt && onOpenEdit()} className={cn("max-w-full rounded text-left text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", todo.doneAt && "cursor-default text-slate-400 line-through")} title={todo.doneAt ? undefined : "Click to edit"} data-testid="personal-todo-text">
            {todo.text}
          </button>
          <TaskChips repeat={todo.repeat} record={todo.record} done={!!todo.doneAt} />
        </div>
        <span className="min-w-[64px] pt-px text-right">{due.text ? <Due text={due.text} tone={todo.doneAt ? "none" : due.tone} testId="personal-todo-due-label" /> : null}</span>
        <button type="button" onClick={onDelete} disabled={pending} className="h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label={`Delete: ${todo.text}`} title="Delete" data-testid="personal-todo-delete">
          ×
        </button>
      </div>
      {editing ? <TodoEditBox todo={todo} today={today} records={records} pending={pending} onSave={onSave} onCancel={onCloseEdit} /> : null}
    </div>
  );
}

/** The full-width edit box under a to-do (approved 2026-11-03): the text, then Due date, Repeat, Link to; Save and Cancel. */
function TodoEditBox({ todo, today, records, pending, onSave, onCancel }: { todo: PersonalTodo; today: string; records: readonly LinkRecord[]; pending: boolean; onSave: (v: { text: string; due: string | null; repeat: Repeat | ""; link: TaskLink }) => void; onCancel: () => void }) {
  const [text, setText] = useState(todo.text);
  const [due, setDue] = useState(todo.dueOn ?? "");
  const [repeat, setRepeat] = useState<Repeat | "">(todo.repeat ?? "");
  const [link, setLink] = useState<LinkRecord | null>(linkOf(todo.record, records));
  const dirty = text !== todo.text || due !== (todo.dueOn ?? "") || repeat !== (todo.repeat ?? "") || (link?.id ?? null) !== (todo.record?.id ?? null);
  useUnsavedWork(dirty, "Your changes to this to-do are not saved yet.");
  const save = () => onSave({ text, due: due || null, repeat, link: toLink(link) });
  return (
    <div
      className="rounded-[10px] border border-border bg-slate-50 px-4 pt-3 pb-3.5"
      data-testid="todo-edit-box"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label className={LABEL} htmlFor={`te-text-${todo.id}`}>
        {todo.record ? "Task" : "To-do"}
      </label>
      <input
        id={`te-text-${todo.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        autoFocus
        className={cn(INPUT, "w-full")}
        data-testid="personal-todo-edit"
      />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <label className={LABEL} htmlFor={`te-due-${todo.id}`}>
            Due date
          </label>
          <input id={`te-due-${todo.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-full")} data-testid="todo-edit-due" />
        </div>
        <div className="min-w-0">
          <label className={LABEL} htmlFor={`te-rep-${todo.id}`}>
            Repeat
          </label>
          <RepeatSelect id={`te-rep-${todo.id}`} value={repeat} onChange={setRepeat} testId="todo-edit-repeat" />
        </div>
        <div className="min-w-0">
          <label className={LABEL} htmlFor={`te-link-${todo.id}`}>
            Link to <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <LinkPicker records={records} value={link} onChange={setLink} today={today} placeholder="Click to pick a record" testId="edit-link" inputId={`te-link-${todo.id}`} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <RowButton tone="primary" disabled={pending || !text.trim()} onClick={save} className="h-8 px-3.5 text-[13px]" data-testid="todo-edit-save">
          Save
        </RowButton>
        <RowButton onClick={onCancel} className="h-8 px-3 text-[13px]" data-testid="todo-edit-cancel">
          Cancel
        </RowButton>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPersonalTodo, deletePersonalTodo, editPersonalTodo, setPersonalTodoDone } from "@/app/actions/todos";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import { TODO_SECTIONS, todoDueLabel, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import type { TodosData } from "@/lib/work/personal-todos-data";
import { useSections } from "@/components/app/work/sections";
import { Due, RowButton, SectionHeading } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The To-dos page (batch B, approved 2026-10-31): a simple personal list in one card, at most 720px wide. Sections
 * Today, Next 7 days, Later (gold small caps, collapsible, remembered), and Done today (collapsed by default). Each
 * item: a checkbox (done items move under Done today), the text (click to edit inline, Enter saves, Escape cancels),
 * the due date at the right, a faint x to delete. Add at the bottom: the text and an optional date. Not tied to
 * records.
 */
const STORAGE_KEY = "work-todos-sections";
const INPUT = "h-9 min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function TodosBoard({ data }: { data: TodosData }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [prev, setPrev] = useState(data);
  if (prev !== data) {
    setPrev(data);
    setTicked({});
  }
  useUnsavedWork(text.trim() !== "", "The to-do you typed is not added yet.");
  const { sections, today } = data;
  const ui = useSections(
    STORAGE_KEY,
    TODO_SECTIONS.map((s) => ({ name: s.label, count: sections[s.key].length, hasMatch: true, defaultOpen: s.key !== "done" })),
    false,
  );
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  const add = () => {
    if (!text.trim()) return;
    act(
      () => addPersonalTodo({ text, due }),
      () => {
        setText("");
        setDue("");
      },
    );
  };
  return (
    <section className="w-full max-w-[720px] rounded-xl border border-border bg-white px-[22px] pt-1 pb-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="todos-card">
      {TODO_SECTIONS.map((s) => {
        const list = sections[s.key];
        const closed = ui.isCollapsed(s.label);
        return (
          <div key={s.key} data-testid="todos-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
            <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => ui.toggle(s.label)} />
            {list.length && !closed ? (
              <div className="flex flex-col" data-testid="section-body">
                {list.map((t) => (
                  <TodoLine key={t.id} todo={t} today={today} section={s.key} checked={ticked[t.id] ?? !!t.doneAt} pending={pending} onCheck={(on) => { setTicked((m) => ({ ...m, [t.id]: on })); act(() => setPersonalTodoDone(t.id, on)); }} onEdit={(v) => act(() => editPersonalTodo(t.id, { text: v }))} onDelete={() => act(() => deletePersonalTodo(t.id))} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="todo-add-form">
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
          className={cn(INPUT, "min-w-[200px] flex-1")}
          data-testid="personal-todo-input"
        />
        <input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-auto")} aria-label="Due date (optional)" data-testid="personal-todo-due" />
        <RowButton tone={text.trim() ? "primary" : "outline"} disabled={pending || !text.trim()} onClick={add} className="h-9 px-3.5 text-[13px]" data-testid="personal-todo-add">
          Add
        </RowButton>
      </div>
      {error ? (
        <p className="pt-2 text-[13px] text-status-missed" role="alert" data-testid="todos-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TodoLine({ todo, today, section, checked, pending, onCheck, onEdit, onDelete }: { todo: PersonalTodo; today: string; section: TodoSectionKey; checked: boolean; pending: boolean; onCheck: (on: boolean) => void; onEdit: (text: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const due = todoDueLabel(todo.dueOn, today, (d) => fmtDate(d, "MMM d"));
  const save = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== todo.text) onEdit(draft);
    else setDraft(todo.text);
  };
  return (
    <div className={cn("group flex items-center gap-3 border-b border-slate-100 py-[9px] last:border-b-0", section === "done" && "opacity-70")} data-testid="personal-todo" data-done={todo.doneAt ? "1" : "0"}>
      <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} disabled={pending} aria-label={`Done: ${todo.text}`} className="h-4 w-4 shrink-0 accent-[var(--primary)]" data-testid="personal-todo-check" />
      {editing ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setDraft(todo.text);
              setEditing(false);
            }
          }}
          autoFocus
          className={cn(INPUT, "h-8 flex-1")}
          aria-label="Edit the to-do"
          data-testid="personal-todo-edit"
        />
      ) : (
        <button type="button" onClick={() => !todo.doneAt && setEditing(true)} className={cn("min-w-0 flex-1 truncate text-left text-sm text-slate-800", todo.doneAt ? "cursor-default text-slate-400 line-through" : "rounded px-1 -mx-1 hover:bg-slate-50")} title={todo.doneAt ? undefined : "Click to edit"} data-testid="personal-todo-text">
          {todo.text}
        </button>
      )}
      {due.text ? <Due text={due.text} tone={due.tone} className="shrink-0" testId="personal-todo-due-label" /> : null}
      <button type="button" onClick={onDelete} disabled={pending} className="h-6 w-6 shrink-0 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label={`Delete: ${todo.text}`} title="Delete" data-testid="personal-todo-delete">
        ×
      </button>
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTask, deleteTask, editTask, setTaskDone, type TaskLink } from "@/app/actions/tasks";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { FilterMenuButton, FilterPopover } from "@/components/app/filter-popover";
import { readRaw } from "@/lib/disclosure";
import { filterButtonLabel, optionCounts, parseTicks, ticksToParam, toggleTick, type FilterGroup, type Ticks } from "@/lib/filters";
import { date as fmtDate } from "@/lib/format";
import { TODO_AREA_STORAGE_KEY, TODO_AREAS, todoAreaOf } from "@/lib/work/lanes";
import type { LinkRecord } from "@/lib/work/link-picker";
import { splitTomorrow, TODO_SECTIONS, todoDueLabel, type PersonalTodo, type TodoSectionKey } from "@/lib/work/personal-todos";
import type { TodosData } from "@/lib/work/personal-todos-data";
import { REPEAT_CHOICES, type Repeat } from "@/lib/work/repeat";
import type { TaskRecord } from "@/lib/work/task-records";
import { selectedTile, tileAfterFilter, type Tile } from "@/lib/work/tiles";
import { SlimBar, SlimTools } from "@/components/app/work/slim-bar";
import { StatusTiles, TileChips } from "@/components/app/work/status-tiles";
import { TitleRow } from "@/components/app/work/title-row";
import { rowClickOpens } from "@/components/app/work/open-row";
import { LinkPicker } from "@/components/app/work/link-picker";
import { TaskChips } from "@/components/app/work/task-bits";
import { Due, ListBand, RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The To-dos page (batch B; push C, approved 2026-11-02 and 2026-11-03; the header of 2026-11-04): at most 720px wide.
 * The title with the Area filter (a small box under the button; a personal to-do is To-dos, a record task counts by its
 * record's area) and Ask AI, the top menu row under 1024px, then four tiles that work like tabs (Today with overdue and
 * undated personal to-dos, Next 7 days, Later, Done today; src/lib/work/tiles.ts) and one card: the intro line, the
 * selected tile's list under its pinned band (Next 7 days has a Tomorrow line, then the rest of the week), and Add at
 * the bottom. Personal to-dos and the dated tasks of records mix by date: a record task carries the gray record pill
 * (opens the record), a repeating one the Repeat chip. Checking one off anywhere checks it off everywhere; a
 * repeating one adds the next. A click on a row (outside the checkbox, the pill and the x) opens the full-width edit
 * box: the text, the due date, Repeat, and Link to (the shared picker; linking puts the item on that record's Tasks
 * card, unlinking makes it personal again). After about 40px of scroll the slim pinned bar slides in with the tiles
 * as chips.
 */
const PANEL_ID = "todos-panel";
const noSubscribe = () => () => {};
/** The Area filter (2026-11-04): a personal to-do is To-dos; a task on a record counts by its record's area. */
const AREA_GROUP: FilterGroup<PersonalTodo>[] = [{ key: "area", title: "Area", options: TODO_AREAS.map((a) => ({ value: a.value, label: a.label })), test: (t, v) => todoAreaOf(t.record) === v }];
const TODO_EMPTY: Record<TodoSectionKey, string> = { today: "Nothing left for today.", week: "Nothing in the next 7 days.", later: "Nothing planned for later.", done: "Nothing checked off yet today." };
const INPUT = "h-9 min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "mb-1 block text-[12.5px] font-medium text-slate-700";

/** The picker's entry for a task's record (from the loaded list, or built from the task). */
function linkOf(record: TaskRecord | null, records: readonly LinkRecord[]): LinkRecord | null {
  if (!record) return null;
  return records.find((r) => r.id === record.id) ?? { kind: record.kind, id: record.id, name: record.name, status: "", closed: record.closed, dueToday: false };
}
const toLink = (r: LinkRecord | null): TaskLink => (r ? { kind: r.kind, id: r.id } : null);

export function TodosBoard({ data, askAi, tabs }: { data: TodosData; askAi: React.ReactNode; /** The top menu row (under 1024px). */ tabs: React.ReactNode }) {
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
  const { today, records } = data;
  // ---------- The Area filter: narrows the lists and the tile numbers; remembered in this browser ----------
  const savedAreaRaw = useSyncExternalStore(noSubscribe, () => readRaw(TODO_AREA_STORAGE_KEY), () => null);
  const savedTicks = useMemo(() => parseTicks(savedAreaRaw, AREA_GROUP), [savedAreaRaw]);
  const [chosenTicks, setChosenTicks] = useState<Ticks | null>(null);
  const ticks = chosenTicks ?? savedTicks;
  const areaTicked = useMemo(() => ticks.area ?? [], [ticks]);
  const narrow = (t: Ticks) => (list: readonly PersonalTodo[]) => (t.area?.length ? list.filter((x) => t.area!.includes(todoAreaOf(x.record))) : [...list]);
  const sections = useMemo(() => {
    const f = narrow(ticks);
    return Object.fromEntries(TODO_SECTIONS.map((s) => [s.key, f(data.sections[s.key])])) as Record<TodoSectionKey, PersonalTodo[]>;
  }, [data.sections, ticks]);
  const tiles: Tile<TodoSectionKey>[] = TODO_SECTIONS.map((s) => ({ key: s.key, label: s.label, count: sections[s.key].length }));
  const [chosenTile, setChosenTile] = useState<TodoSectionKey | null>(null);
  const selected = selectedTile(chosenTile, tiles) as TodoSectionKey;
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const toggleFilter = (el: HTMLElement) => setFilterAnchor((a) => (a === el ? null : el));
  const closeFilter = useCallback(() => setFilterAnchor(null), []);
  const allItems = useMemo(() => TODO_SECTIONS.flatMap((s) => data.sections[s.key]), [data.sections]);
  const setTicks = (t: Ticks) => {
    setChosenTicks(t);
    try {
      const v = ticksToParam(t);
      if (v) window.localStorage.setItem(TODO_AREA_STORAGE_KEY, v);
      else window.localStorage.removeItem(TODO_AREA_STORAGE_KEY);
    } catch {
      /* no storage: the choice holds until the page reloads */
    }
    // A tick that drops the selected tile to 0 selects the first tile with items.
    const f = narrow(t);
    setChosenTile(tileAfterFilter(selected, TODO_SECTIONS.map((s) => ({ key: s.key, count: f(data.sections[s.key]).length }))));
  };
  const pickTile = (k: TodoSectionKey) => {
    setChosenTile(k);
    setNote(null);
  };
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
  const list = sections[selected];
  const split = selected === "week" ? splitTomorrow(list, today) : null;
  const label = TODO_SECTIONS.find((s) => s.key === selected)?.label ?? "";
  return (
    <div className="w-full max-w-[720px]">
      <SlimBar title="To-dos" chips={<TileChips tiles={tiles} selected={selected} onPick={pickTile} label="To-dos" idPrefix="todos-chip" panelId={PANEL_ID} />} tools={<SlimTools filterCount={areaTicked.length} onFilter={toggleFilter} filterOpen={!!filterAnchor} />} />
      <header className="pb-5" data-testid="todos-header">
        <TitleRow title="To-dos" tools={<FilterMenuButton label={filterButtonLabel("Area", AREA_GROUP, ticks)} ticked={areaTicked.length} open={!!filterAnchor} onOpen={toggleFilter} />} askAi={askAi} />
        {tabs}
      </header>
      <FilterPopover anchor={filterAnchor} onClose={closeFilter} groups={AREA_GROUP} ticks={ticks} counts={optionCounts(allItems, AREA_GROUP, ticks)} onToggle={(g, v) => setTicks(toggleTick(ticks, g, v))} onClear={() => setTicks({})} />
      <StatusTiles tiles={tiles} selected={selected} onPick={pickTile} label="To-dos" idPrefix="todos-tile" panelId={PANEL_ID} testId="todos-tiles" className="mb-6" />
      <section id={PANEL_ID} role="tabpanel" aria-labelledby={`todos-tile-${selected}`} className="w-full rounded-xl border border-border bg-white px-[22px] pb-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="todos-card">
        <div className="flex min-h-[46px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[13px] text-muted-foreground">
          <span>Personal to-dos and record tasks with a date</span>
          {note ? (
            <p className={cn("min-w-0 text-[13px]", note.tone === "ok" ? "text-status-met" : "text-status-missed")} role={note.tone === "warn" ? "alert" : "status"} data-testid={note.tone === "warn" ? "todos-error" : "todos-note"}>
              {note.text}
            </p>
          ) : null}
        </div>
        <div data-testid="todos-section" data-section={selected}>
          <ListBand name={label} count={list.length} testId="todos-band" />
          {list.length ? (
            <div className="flex flex-col" data-testid="section-body">
              {split && split.tomorrow.length ? (
                <>
                  <SubLine label="Tomorrow" testId="todos-tomorrow" />
                  {split.tomorrow.map((t) => line(t, selected))}
                  {split.rest.length ? <SubLine label="Rest of the week" testId="todos-rest-of-week" /> : null}
                  {split.rest.map((t) => line(t, selected))}
                </>
              ) : (
                list.map((t) => line(t, selected))
              )}
            </div>
          ) : (
            <p className="pt-[18px] pb-1.5 text-[13px] text-muted-foreground" data-testid="todos-empty">
              {TODO_EMPTY[selected]}
            </p>
          )}
        </div>
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
    </div>
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

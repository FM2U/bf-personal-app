"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProject, saveWeeklyFocus, type ProjectInput } from "@/app/actions/projects";
import { markFocusDone } from "@/app/actions/accountability";
import { date as fmtDate } from "@/lib/format";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { addDaysISO } from "@/lib/calc/dates";
import type { AskContext } from "@/lib/work/ask-ai";
import { matchesProjectFilter, matchesProjectSearch, PROJECT_FILTERS, PROJECT_SECTIONS, projectFilterCounts, projectSections, type ProjectFilter } from "@/lib/work/projects";
import type { ProjectRow, RosaraData } from "@/lib/work/projects-data";
import { AiFieldStar } from "@/components/app/work/ask-ai";
import { ProjectListRow } from "@/components/app/work/project-row";
import { useSections } from "@/components/app/work/sections";
import { FilterRow, RowButton, SectionHeading, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Rosara (batch B2, approved 2026-10-31, decisions on v4 and v5): the Weekly focus bar (editable, saved to the
 * setting, shown on Home) and the Projects card with Add a project, the pills All, Due today, Needs a next action,
 * Closed, Find a project, and the sections Due today, Active (sorted by next due), No next action, Closed
 * (collapsed). Each row: name and milestone, the next action with its due (or "No next action set" in amber), the
 * figures TASKS and NEXT, Done and Later (or Set the next action). The page scrolls as one. Collapse all and Expand
 * all sit at the end of the filter row (Edit batch C, item 3); Due today and Active start open, Closed collapsed.
 */
const STORAGE_KEY = "work-rosara-sections";
const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";

const PAGE: AskContext = { page: "rosara", label: "Rosara" };

export function RosaraBoard({ data }: { data: RosaraData }) {
  const router = useRouter();
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const { projects, today } = data;
  const sections = useMemo(() => projectSections(projects, today), [projects, today]);
  const counts = useMemo(() => projectFilterCounts(projects, today), [projects, today]);
  const shown = (p: ProjectRow) => matchesProjectFilter(p, filter, today) && matchesProjectSearch(p, query);
  const states = useMemo(() => PROJECT_SECTIONS.map((s) => ({ name: s.label, count: sections[s.key].length, hasMatch: sections[s.key].some((p) => matchesProjectFilter(p, filter, today)), defaultOpen: !s.collapsed })), [sections, filter, today]);
  const ui = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: ProjectFilter) => {
    setFilter(f);
    ui.resetOverrides();
  };
  const open = projects.filter((p) => p.status === "open").length;
  return (
    <div className="flex flex-col gap-[18px]">
      <WeeklyFocusBar focus={data.focus} doneOn={data.focusDoneOn} />
      <WorkCard
        title="Projects"
        count={open}
        actions={
          <>
            <span className="hidden text-[13px] text-muted-foreground sm:inline">Click a row to open the project</span>
            <RowButton tone={adding ? "outline" : "primary"} onClick={() => setAdding((a) => !a)} className="h-8" data-testid="add-project-button">
              {adding ? "Close the form" : "Add a project"}
            </RowButton>
          </>
        }
        testId="projects-card"
      >
        {adding ? (
          <AddProjectForm
            today={today}
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              router.refresh();
            }}
          />
        ) : null}
        <div className="px-[22px] pt-3">
          <FilterRow prefix="rosara" filters={PROJECT_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find a project" searchClassName="sm:w-[160px]" collapse={{ allCollapsed: ui.allCollapsed, onClick: ui.toggleAll }} />
        </div>
        {projects.length ? (
          <div className="px-[22px] pt-1 pb-3">
            {PROJECT_SECTIONS.map((s) => {
              const list = sections[s.key];
              const closed = ui.isCollapsed(s.label);
              return (
                <div key={s.key} data-testid="project-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
                  <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => ui.toggle(s.label)} hint={s.hint} />
                  {list.length && !closed ? (
                    <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                      {list.map((p) => (
                        <div key={p.id} className={cn("border-t border-slate-100 first:border-t-0", !shown(p) && "hidden")} data-testid="rosara-row" data-hidden={shown(p) ? "0" : "1"}>
                          <ProjectListRow project={p} today={today} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="projects-empty">
            No projects yet. Add one, or load the sample data under Settings, Sample data and reset.
          </p>
        )}
        <p className="border-t border-slate-100 px-[22px] pt-3 pb-4 text-[13px] text-muted-foreground" data-testid="rosara-note">
          Next actions here show on Home. People you talk to for Rosara live on Contacts with purpose Rosara.
        </p>
      </WorkCard>
    </div>
  );
}

/**
 * The Weekly focus bar: the label, the text (click to edit, Save), "Shown on Home", and Done (batch C: marks the
 * week's focus done, which the Rosara focus done target counts; then "Done Thursday"). One field, so only the star
 * inside the field (Edit batch B, item 3).
 */
function WeeklyFocusBar({ focus, doneOn = null }: { focus: string; doneOn?: string | null }) {
  const router = useRouter();
  const [done, setDone] = useState(doneOn);
  const [doneError, setDoneError] = useState<string | null>(null);
  const markDone = () =>
    start(async () => {
      setDoneError(null);
      const r = await markFocusDone();
      if (!r.ok) return setDoneError(r.error);
      setDone(new Date().toISOString().slice(0, 10));
      router.refresh();
    });
  const [text, setText] = useState(focus);
  const [prev, setPrev] = useState(focus);
  if (prev !== focus) {
    setPrev(focus);
    setText(focus);
  }
  const [focused, setFocused] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const dirty = text.trim() !== focus.trim();
  useUnsavedWork(dirty, "The weekly focus is not saved yet.");
  const save = () =>
    start(async () => {
      setNote(null);
      const r = await saveWeeklyFocus(text);
      if (!r.ok) return setNote({ tone: "warn", text: r.error });
      setNote({ tone: "ok", text: "Saved" });
      router.refresh();
    });
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-white px-[22px] py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="weekly-focus">
      <span className="label-caps whitespace-nowrap">Weekly focus</span>
      <div className="relative min-w-0 flex-1 basis-[280px]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="This week: the one thing Rosara gets"
          aria-label="Weekly focus"
          className={cn(INPUT, "pr-9")}
          data-testid="weekly-focus-input"
        />
        <AiFieldStar context={PAGE} field={{ key: "weekly_focus", label: "Weekly focus", current: text }} visible={!text.trim() || focused} onUse={setText} />
      </div>
      <div className="flex items-center gap-2.5">
        {dirty ? (
          <RowButton tone="primary" onClick={save} disabled={pending} data-testid="weekly-focus-save">
            {pending ? "Saving..." : "Save"}
          </RowButton>
        ) : note ? (
          <span className={cn("text-[13px]", note.tone === "ok" ? "font-medium text-status-met" : "text-status-missed")} role="status" data-testid="weekly-focus-note">
            {note.text}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">Shown on Home</span>
        )}
        {done ? (
          <span className="text-[13px] font-medium text-status-met" data-testid="weekly-focus-done">
            Done {fmtDate(done, "EEEE")}
          </span>
        ) : focus.trim() && !dirty ? (
          <RowButton tone="cobalt" onClick={markDone} disabled={pending} data-testid="weekly-focus-mark-done">
            Done
          </RowButton>
        ) : null}
        {doneError ? (
          <span className="text-[13px] text-status-missed" role="alert">
            {doneError}
          </span>
        ) : null}
      </div>
    </section>
  );
}

const EMPTY: ProjectInput = { name: "", goal: "", milestone: "", nextAction: "", due: "" };

/** Add a project: Name, First due, Goal, Milestone, First next action (with the star), Cancel, Save. */
function AddProjectForm({ today, onClose, onSaved }: { today: string; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const [f, setF] = useState<ProjectInput>({ ...EMPTY, due: addDaysISO(today, 7) });
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = !!(f.name || f.goal || f.milestone || f.nextAction);
  useUnsavedWork(dirty, "The project is not saved yet.");
  const set = (k: keyof ProjectInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createProject(f);
      if (!r.ok) return setError(r.error);
      onSaved();
    });
  const row = (k: keyof ProjectInput, label: string, placeholder: string, extra?: React.ReactNode, star?: boolean) => (
    <div className="grid grid-cols-1 items-center gap-x-3.5 gap-y-1 sm:grid-cols-[130px_minmax(0,1fr)]">
      <label htmlFor={`${ids}-${k}`} className={LABEL}>
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
        <div className="relative min-w-0 flex-1 basis-[200px]">
          <input id={`${ids}-${k}`} value={String(f[k] ?? "")} onChange={set(k)} onFocus={() => setFocusedField(k)} onBlur={() => setFocusedField(null)} placeholder={placeholder} className={cn(INPUT, star && "pr-9")} data-testid={`project-${k}`} />
          {star ? <AiFieldStar context={PAGE} field={{ key: "next_action", label: "First next action", current: f.nextAction, extra: f.name ? `The project: ${f.name}. Goal: ${f.goal || "not set"}. Milestone: ${f.milestone || "not set"}.` : null }} visible={!f.nextAction.trim() || focusedField === k} onUse={(t) => setF((x) => ({ ...x, nextAction: t }))} /> : null}
        </div>
        {extra}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2.5 border-b border-slate-100 px-[22px] pt-3 pb-4" data-testid="add-project-form">
      {row("name", "Name", "Project name", (
        <div className="flex items-center gap-2.5">
          <label htmlFor={`${ids}-due`} className={LABEL}>
            First due
          </label>
          <input id={`${ids}-due`} type="date" value={f.due} onChange={set("due")} className={cn(INPUT, "w-auto")} data-testid="project-due" />
        </div>
      ))}
      {row("goal", "Goal", "One line: what done looks like")}
      {row("milestone", "Milestone", "One line: the next thing to reach")}
      {row("nextAction", "First next action", "What you do first", undefined, true)}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="project-error">
            {error}
          </span>
        ) : null}
        <RowButton onClick={onClose} disabled={pending}>
          Cancel
        </RowButton>
        <RowButton tone="primary" onClick={save} disabled={pending || !f.name.trim()} data-testid="project-save">
          {pending ? "Saving..." : "Save"}
        </RowButton>
      </div>
    </div>
  );
}

"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectNote, addProjectTask, closeProject, deleteProjectTask, makeProjectTaskNext, reopenProject, saveProjectFacts, saveProjectGoal, saveProjectNextAction, setProjectTaskDone } from "@/app/actions/projects";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import { projectAsk } from "@/lib/work/ask-ai";
import type { ProjectRow } from "@/lib/work/projects-data";
import { projectTasksLabel } from "@/lib/work/projects";
import { dueLabel } from "@/lib/work/stages";
import type { TimelineEvent } from "@/lib/work/timeline";
import type { DealTodo } from "@/lib/work/todos";
import { AiCardStar, AiFieldStar } from "@/components/app/work/ask-ai";
import { Fact, GrowingTextarea, SaveLine, useSave, useSynced } from "@/components/app/work/deal/cards";
import { ProjectActionButtons } from "@/components/app/work/project-row";
import { TasksCard } from "@/components/app/work/tasks-card";
import { TimelineEvents } from "@/components/app/work/timeline-list";
import { Pill, RowButton, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The cards of the project page (/work/rosara/[id]) under the record-page rule (batch B2, approved 2026-10-31).
 * Left: Goal and milestone (the type-specific card), Next action (Save; Done, Later), Tasks. Right: Facts (Edit),
 * Timeline (notes and findings with a Finding pill and source link, Add a note below; a note can be marked as a
 * finding), Decision (Close project, Reopen). Each card saves through its own server action; the page re-reads.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
const LABEL = "text-xs font-medium text-muted-foreground";
const FORM = "grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 px-[22px] pt-3 pb-5 sm:grid-cols-[110px_minmax(0,1fr)]";

// ---------- Goal and milestone ----------

export function GoalCard({ project }: { project: ProjectRow }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [goal, setGoal] = useSynced(project.goal ?? "");
  const [milestone, setMilestone] = useSynced(project.milestone ?? "");
  const dirty = goal !== (project.goal ?? "") || milestone !== (project.milestone ?? "");
  useUnsavedWork(dirty, "The goal and milestone are not saved yet.");
  return (
    <WorkCard title="Goal and milestone" hint="One line each" testId="project-goal">
      <div className={FORM}>
        <label htmlFor={`${ids}-g`} className={LABEL}>
          Goal
        </label>
        <input id={`${ids}-g`} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What done looks like" className={INPUT} data-testid="project-goal-input" />
        <label htmlFor={`${ids}-m`} className={LABEL}>
          Milestone
        </label>
        <input id={`${ids}-m`} value={milestone} onChange={(e) => setMilestone(e.target.value)} placeholder="The next thing to reach" className={INPUT} data-testid="project-milestone-input" />
        {dirty || state.kind !== "idle" ? (
          <SaveLine state={dirty ? { kind: "idle" } : state}>
            {dirty ? (
              <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveProjectGoal(project.id, { goal, milestone }))} data-testid="project-goal-save">
                {pending ? "Saving..." : "Save"}
              </RowButton>
            ) : null}
          </SaveLine>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Next action ----------

export function ProjectNextActionCard({ project, today }: { project: ProjectRow; today: string }) {
  const ids = useId();
  const { pending, state, run } = useSave();
  const [action, setAction] = useSynced(project.nextAction ?? "");
  const [due, setDue] = useSynced(project.nextActionDue ?? "");
  const [minutes, setMinutes] = useSynced(project.nextActionMinutes ? String(project.nextActionMinutes) : "");
  const [focused, setFocused] = useState(false);
  const dirty = action !== (project.nextAction ?? "") || due !== (project.nextActionDue ?? "") || minutes !== (project.nextActionMinutes ? String(project.nextActionMinutes) : "");
  useUnsavedWork(dirty, "The next action is not saved yet.");
  const d = project.nextAction ? dueLabel(project.nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  const hint = project.status === "closed" ? "Closed project" : project.nextAction ? `Due ${d!.text.toLowerCase() === "today" ? "today" : d!.text}${project.nextActionMinutes ? ` · ${project.nextActionMinutes} min` : ""} · shows on Home` : "No next action set";
  return (
    <WorkCard
      id="next-action"
      title="Next action"
      actions={
        <>
          <span className="text-[13px] text-muted-foreground" data-testid="next-action-hint">{hint}</span>
          <AiCardStar context={{ ...projectAsk(project), card: "Next action" }} onUseNext={(x) => {
            setAction(x.action);
            setDue(x.due);
            setMinutes(x.minutes ? String(x.minutes) : "");
          }} testId="next-action-star" />
        </>
      }
      testId="project-next-action"
    >
      <div className={FORM} data-testid="next-action-form">
        <label htmlFor={`${ids}-a`} className={LABEL}>
          Action
        </label>
        <div className="relative min-w-0">
          <input id={`${ids}-a`} value={action} onChange={(e) => setAction(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="What you do next on this project" className={cn(INPUT, "pr-9")} data-testid="na-action" />
          <AiFieldStar context={projectAsk(project)} field={{ key: "next_action", label: "Next action", current: action }} visible={!action.trim() || focused} onUse={setAction} />
        </div>
        <label htmlFor={`${ids}-d`} className={LABEL}>
          Due
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`${ids}-d`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="na-due" />
          <label htmlFor={`${ids}-m`} className={LABEL}>
            Block
          </label>
          <input id={`${ids}-m`} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} inputMode="numeric" placeholder="min" className={cn(INPUT, "w-20")} data-testid="na-minutes" />
          <span className="text-xs text-muted-foreground">min</span>
        </div>
        <SaveLine state={dirty ? { kind: "idle" } : state}>
          {dirty ? (
            <RowButton tone="primary" disabled={pending} onClick={() => run(() => saveProjectNextAction(project.id, { action, due, minutes }))} data-testid="na-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          ) : project.nextAction && project.status === "open" ? (
            <ProjectActionButtons key={`${project.nextAction}|${project.nextActionDue}`} project={project} today={today} />
          ) : null}
        </SaveLine>
      </div>
    </WorkCard>
  );
}

// ---------- Tasks ----------

export function ProjectTasksCard({ project, tasks }: { project: ProjectRow; tasks: DealTodo[] }) {
  return (
    <TasksCard
      tasks={tasks}
      open={project.status === "open"}
      actions={{
        add: (text) => addProjectTask(project.id, text),
        setDone: (id, done) => setProjectTaskDone(id, done),
        remove: (id) => deleteProjectTask(id),
        makeNext: (id) => makeProjectTaskNext(id),
      }}
      placeholder="Something to do on this project"
      emptyText="No tasks yet. Add the research questions, the things to write, the people to ask."
      testId="project-tasks"
      ai={projectAsk(project)}
    />
  );
}

// ---------- Facts ----------

export function ProjectFactsCard({ project }: { project: ProjectRow }) {
  const ids = useId();
  const { pending, state, run, reset } = useSave();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useSynced(project.name);
  const dirty = editing && name !== project.name;
  useUnsavedWork(dirty, "The facts are not saved yet.");
  return (
    <WorkCard
      title="Facts"
      actions={
        <RowButton
          onClick={() => {
            if (editing) setName(project.name);
            reset();
            setEditing((e) => !e);
          }}
          disabled={pending}
          data-testid="facts-edit"
        >
          {editing ? "Cancel" : "Edit"}
        </RowButton>
      }
      testId="project-facts"
    >
      {editing ? (
        <div className="flex flex-col gap-2.5 px-[22px] pt-3 pb-5" data-testid="facts-form">
          <label htmlFor={`${ids}-n`} className={LABEL}>
            Name
          </label>
          <input id={`${ids}-n`} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} data-testid="fact-name" />
          <SaveLine state={state}>
            <RowButton tone="primary" disabled={pending || !dirty} onClick={() => run(() => saveProjectFacts(project.id, { name }), () => setEditing(false))} data-testid="facts-save">
              {pending ? "Saving..." : "Save"}
            </RowButton>
          </SaveLine>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3 px-[22px] pt-3 pb-5" data-testid="facts-grid">
          <Fact label="Name">{project.name}</Fact>
          <Fact label="Status" testId="fact-status">
            {project.status === "closed" ? "Closed" : "Open"}
          </Fact>
          <Fact label="Started">{project.createdAt ? fmtDate(project.createdAt, "MMM d, yyyy") : "Not known"}</Fact>
          <Fact label="Closed">{project.closedAt ? fmtDate(project.closedAt, "MMM d, yyyy") : "Not yet"}</Fact>
          <Fact label="Open tasks">{projectTasksLabel(project.openTasks)}</Fact>
          <Fact label="Lane">Rosara</Fact>
          {state.kind === "saved" ? (
            <span className="self-end text-[13px] font-medium text-status-met" role="status" data-testid="save-ok">
              Saved
            </span>
          ) : null}
        </div>
      )}
    </WorkCard>
  );
}

// ---------- Timeline: notes and findings ----------

export function ProjectTimelineCard({ project, events }: { project: ProjectRow; events: TimelineEvent[] }) {
  const { pending, state, run } = useSave();
  const [note, setNote] = useState("");
  const [finding, setFinding] = useState(false);
  const [source, setSource] = useState("");
  const [focused, setFocused] = useState(false);
  useUnsavedWork(note.trim() !== "", "The note is not saved yet.");
  const findings = events.filter((e) => e.kind === "finding").length;
  return (
    <WorkCard title="Notes and findings" hint={findings ? `Newest first · ${findings} ${findings === 1 ? "finding" : "findings"}` : "Newest first"} testId="project-timeline">
      <TimelineEvents events={events} empty="Nothing yet. Notes and findings show here." />
      <div className="flex flex-col gap-2 px-[22px] pt-2 pb-4" data-testid="note-form">
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <GrowingTextarea id="project-note" value={note} onChange={setNote} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} minRows={1} placeholder={finding ? "The finding: one or two lines" : "Add a note or a finding"} className="pr-9" data-testid="project-note" />
            <AiFieldStar context={projectAsk(project)} field={{ key: "project_note", label: "Note", current: note }} visible={!note.trim() || focused} onUse={setNote} className="top-[18px]" />
          </div>
          <RowButton tone={note.trim() ? "primary" : "outline"} disabled={pending || !note.trim()} onClick={() => run(() => addProjectNote(project.id, { body: note, finding, source }), () => { setNote(""); setSource(""); setFinding(false); })} className="h-9 shrink-0" data-testid="note-save">
            {pending ? "Saving..." : "Add"}
          </RowButton>
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={finding} onChange={(e) => setFinding(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" data-testid="note-finding" />
            Mark as a finding
          </label>
          {finding ? <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source link (optional)" aria-label="Source link" className={cn(INPUT, "h-8 flex-1 basis-[200px] text-[13px]")} data-testid="note-source" /> : null}
        </div>
        {state.kind === "error" ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="save-error">
            {state.text}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

// ---------- Decision ----------

export function ProjectDecisionCard({ project }: { project: ProjectRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Not saved.");
      router.refresh();
    });
  const closed = project.status === "closed";
  return (
    <WorkCard title="Decision" hint={closed ? "Closed; Reopen brings it back to Rosara" : "Close when the milestone is reached and nothing is left"} testId="project-decision">
      <div className="flex flex-col gap-2 px-[22px] pt-3 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          {closed ? (
            <>
              <Pill tone="charcoal" testId="decision-closed">
                Closed{project.closedAt ? ` ${fmtDate(project.closedAt, "MMM d, yyyy")}` : ""}
              </Pill>
              <RowButton onClick={() => act(() => reopenProject(project.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="decision-reopen">
                {pending ? "Saving..." : "Reopen"}
              </RowButton>
            </>
          ) : (
            <RowButton onClick={() => act(() => closeProject(project.id))} disabled={pending} className="h-9 px-3.5 text-[13px]" data-testid="decision-close">
              {pending ? "Saving..." : "Close project"}
            </RowButton>
          )}
        </div>
        {error ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="decision-error">
            {error}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

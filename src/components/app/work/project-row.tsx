"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeProjectAction, deferProjectAction } from "@/app/actions/projects";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import type { ProjectRow as ProjectRowData } from "@/lib/work/projects-data";
import { dueLabel } from "@/lib/work/stages";
import { actionKey } from "@/lib/work/lanes";
import { blockSlots } from "@/components/app/work/block-time";
import { ActionFigures, Confirm, Due, Figure, Figures, LanePill, Line1, Line2, Name, Pill, ROW_COLS, RowButton, RowButtons, RowLink, RowShell, What } from "@/components/app/work/ui";

/**
 * A project's next action with Done and Later (batch B2): on the Rosara rows, on Home with a Rosara lane pill, and
 * (compact) on the project page. Done clears the action and the project moves to "No next action" (approved
 * 2026-10-31, decisions on v5); when the project has tasks, the line after Done offers the top task as the new next
 * action (due tomorrow). Later: Tomorrow, or a date. Every save goes through a server action; the page re-reads.
 */
type State = { kind: "idle" } | { kind: "ask" } | { kind: "later" } | { kind: "done"; text: string } | { kind: "error"; text: string };

function useProjectAction(project: ProjectRowData, compact: boolean) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });
  const refresh = () => (compact ? router.refresh() : setTimeout(() => router.refresh(), 1600));
  const finish = (taskId: string | null = null) =>
    start(async () => {
      const r = await completeProjectAction(project.id, taskId);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.nextAction ? `Done. Next on ${project.name}: ${r.nextAction}, due tomorrow.` : `Done. ${project.name} has no next action now; set one on the project.` });
      refresh();
    });
  const later = (date: string) =>
    start(async () => {
      const r = await deferProjectAction(project.id, date);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: `Moved to ${fmtDate(r.due, "EEE MMM d")}.` });
      refresh();
    });
  return { pending, state, setState, finish, later };
}

export function AskDone({ project, pending, onTask, onClear }: { project: ProjectRowData; pending: boolean; onTask: (id: string) => void; onClear: () => void }) {
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-ask">
      <span>Done. What is next on {project.name}?</span>
      {project.topTask ? (
        <RowButton tone="cobalt" disabled={pending} onClick={() => onTask(project.topTask!.id)} className="max-w-full" title={project.topTask.text} data-testid="next-action-todo">
          <span className="truncate">Next: {project.topTask.text}</span>
        </RowButton>
      ) : null}
      <RowButton disabled={pending} onClick={onClear} data-testid="next-action-not-yet">
        No next action
      </RowButton>
    </Confirm>
  );
}

function LaterChoice({ today, pending, onPick, onCancel }: { today: string; pending: boolean; onPick: (d: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(addDaysISO(today, 2));
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-later-choice">
      <span>Later:</span>
      <RowButton tone="cobalt" disabled={pending} onClick={() => onPick(addDaysISO(today, 1))} data-testid="later-tomorrow">
        Tomorrow
      </RowButton>
      <span className="flex items-center gap-1.5">
        <input type="date" value={date} min={addDaysISO(today, 1)} onChange={(e) => setDate(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Pick a date" data-testid="later-date" />
        <RowButton disabled={pending || !date} onClick={() => onPick(date)} data-testid="later-pick">
          Move
        </RowButton>
      </span>
      <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onCancel}>
        Cancel
      </button>
    </Confirm>
  );
}

function Buttons({ pending, onDone, onLater }: { pending: boolean; onDone: () => void; onLater: () => void }) {
  return (
    <RowButtons pair>
      <RowButton tone="cobalt" disabled={pending} onClick={onDone} className={ROW_COLS.button.cls} data-testid="next-action-done">
        {pending ? "Saving" : "Done"}
      </RowButton>
      <RowButton disabled={pending} onClick={onLater} className={ROW_COLS.button.cls} data-testid="next-action-later">
        Later
      </RowButton>
    </RowButtons>
  );
}

/** The Done and Later buttons of the project page's Next action card. */
export function ProjectActionButtons({ project, today }: { project: ProjectRowData; today: string }) {
  const { pending, state, setState, finish, later } = useProjectAction(project, true);
  if (state.kind === "done" || state.kind === "error") {
    return (
      <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
        <span>{state.text}</span>
        {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
      </Confirm>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="next-action-row" data-project={project.id}>
      <div className="flex justify-end">
        <Buttons pending={pending} onDone={() => (project.topTask ? setState({ kind: "ask" }) : finish())} onLater={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} />
      </div>
      {state.kind === "ask" ? <AskDone project={project} pending={pending} onTask={(id) => finish(id)} onClear={() => finish()} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </div>
  );
}

/** One project on the Rosara page: name and milestone, the next action with its due and minutes (or "No next action set"), TASKS and NEXT, Done and Later (or Set the next action). */
export function ProjectListRow({ project, today }: { project: ProjectRowData; today: string }) {
  const { pending, state, setState, finish, later } = useProjectAction(project, false);
  const due = project.nextAction ? dueLabel(project.nextActionDue, today, (d) => fmtDate(d, "MMM d")) : null;
  const closed = project.status === "closed";
  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="project-row" dataAttrs={{ "data-project": project.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
          <span>{state.text}</span>
          {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }
  return (
    <RowShell
      testId="project-row"
      dataAttrs={{ "data-project": project.id }}
      open={`/work/rosara/${project.id}`}
      openLabel={`Open ${project.name}`}
      right={
        <>
          <Figures className="gap-x-6" testId="project-figures">
            <Figure value={project.openTasks} label="Tasks" col="count" testId="project-tasks" />
            <Figure value={closed ? "Closed" : project.nextAction ? due!.text : "None"} label="Next" tone={closed || !project.nextAction ? "none" : due!.tone} col="nextDate" testId="project-next" />
          </Figures>
          {closed ? (
            <RowButtons pair aria-hidden />
          ) : project.nextAction ? (
            <Buttons pending={pending} onDone={() => (project.topTask ? setState({ kind: "ask" }) : finish())} onLater={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} />
          ) : (
            <RowButtons pair>
              <RowLink href={`/work/rosara/${project.id}#next-action`} tone="cobalt" className="w-full" data-testid="set-next-action">
                Set the next action
              </RowLink>
            </RowButtons>
          )}
        </>
      }
    >
      <Line1>
        <Link href={`/work/rosara/${project.id}`} className="hover:underline" data-testid="project-link">
          <Name>{project.name}</Name>
        </Link>
        {project.milestone ? <What>{project.milestone}</What> : <What className="text-slate-400">No milestone yet</What>}
        {closed ? <Pill tone="charcoal">Closed</Pill> : null}
      </Line1>
      {closed ? (
        <Line2 className="text-muted-foreground">Closed{project.closedAt ? ` · ${fmtDate(project.closedAt, "MMM d")}` : ""}</Line2>
      ) : project.nextAction ? (
        <Line2 className="text-slate-900">
          {project.nextAction}
          {due ? (
            <>
              {" "}
              <span className="text-muted-foreground">·</span> <Due text={due.text} tone={due.tone} />
              {project.nextActionMinutes ? <Due text={`· ${project.nextActionMinutes} min`} tone={due.tone} className="ml-1" /> : null}
            </>
          ) : null}
        </Line2>
      ) : (
        <Line2 className="font-medium text-status-soon">No next action set</Line2>
      )}
      {state.kind === "ask" ? <AskDone project={project} pending={pending} onTask={(id) => finish(id)} onClear={() => finish()} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

/** One project's next action on Home: the Rosara lane pill, the name and milestone, the action, the due and minutes, Done and Later. */
export function ProjectActionRow({ project, today, reason }: { project: ProjectRowData; today: string; /** The AI's one-line reason under the row (By the AI). */ reason?: string | null }) {
  const { pending, state, setState, finish, later } = useProjectAction(project, false);
  const due = dueLabel(project.nextActionDue, today, (d) => fmtDate(d, "MMM d"));
  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="project-action-row" dataAttrs={{ "data-project": project.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
          <span>{state.text}</span>
          {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }
  if (!project.nextAction) {
    return (
      <RowShell
        testId="needs-action-row"
        dataAttrs={{ "data-project": project.id }}
        open={`/work/rosara/${project.id}`}
        openLabel={`Open ${project.name}`}
        right={
          <RowButtons pair>
            <RowLink href={`/work/rosara/${project.id}#next-action`} tone="cobalt" className="w-full" data-testid="set-next-action">
              Set next action
            </RowLink>
          </RowButtons>
        }
      >
        <Line1>
          <LanePill lane="Rosara" />
          <Link href={`/work/rosara/${project.id}`} className="hover:underline">
            <Name>{project.name}</Name>
          </Link>
          {project.milestone ? <What>{project.milestone}</What> : null}
        </Line1>
        <Line2 className="font-medium text-status-soon">No next action set</Line2>
      </RowShell>
    );
  }
  return (
    <RowShell
      testId="project-action-row"
      dataAttrs={{ "data-project": project.id }}
      open={`/work/rosara/${project.id}`}
      openLabel={`Open ${project.name}`}
      right={
        <ActionFigures due={due} minutes={project.nextActionMinutes} block={blockSlots({ rowKey: actionKey("Rosara", project.id), lane: "Rosara", name: project.name, action: project.nextAction, minutes: project.nextActionMinutes, recordType: "projects", recordId: project.id, href: `/work/rosara/${project.id}` })}>
          <Buttons pending={pending} onDone={() => (project.topTask ? setState({ kind: "ask" }) : finish())} onLater={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} />
        </ActionFigures>
      }
    >
      <Line1>
        <LanePill lane="Rosara" />
        <Link href={`/work/rosara/${project.id}`} className="hover:underline">
          <Name>{project.name}</Name>
        </Link>
        {project.milestone ? <What>{project.milestone}</What> : null}
      </Line1>
      <Line2 className="text-slate-900">{project.nextAction}</Line2>
      {reason ? <AiReason text={reason} /> : null}
      {state.kind === "ask" ? <AskDone project={project} pending={pending} onTask={(id) => finish(id)} onClear={() => finish()} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

/** "AI: Due today and the broker goes quiet after 5 days", in purple under a Home row (By the AI). */
export function AiReason({ text }: { text: string }) {
  return (
    <div className="mt-0.5 text-[12.5px] text-violet" data-testid="ai-reason">
      <b className="font-semibold">AI:</b> {text}
    </div>
  );
}

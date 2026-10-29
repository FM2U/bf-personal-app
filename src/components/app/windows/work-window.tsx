"use client";

/**
 * Work through tasks: today's tasks (due today or overdue) one at a time in the large window. Each task shows what it
 * is for (the linked record, which opens in the same window), that record's next required action, and Done, Move to
 * tomorrow, Edit, Skip, with "3 of 12" and a short summary at the end. The list is fixed when the window opens (kept
 * for this browser tab, so a refresh continues where it was).
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, Pencil, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, DueWord, dueClass } from "@/components/ui/badge";
import { Notice } from "@/components/app/page-header";
import { useWindowNav } from "@/components/app/window-host";
import { ActionError, FullPageButton, Skeleton, useLoad, ViewLayout, clearWindowCache } from "@/components/app/windows/views";
import { TaskDetails, useTaskWindow } from "@/components/app/windows/task-window";
import { loadWorkTasks, moveTaskToTomorrow, type WorkTask } from "@/app/actions/window";
import { setTaskStatus } from "@/app/actions/records";
import { workPosition } from "@/lib/window-route";
import { movedNote } from "@/lib/calc/commitment-rule";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Outcome = "done" | "moved" | "skipped";
type Session = { ids: string[]; titles: Record<string, string>; outcomes: Record<string, Outcome>; started: string };

const KEY = "work-through-tasks";
function readSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null) {
  try {
    if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the list still works until the page is reloaded.
  }
}

export function WorkWindow() {
  const nav = useWindowNav();
  const taskId = nav.view.kind === "work" ? nav.view.taskId : null;
  const { data } = useLoad("work-list", () => loadWorkTasks());
  const [session, setSession] = useState<Session | null>(null);

  // The list is fixed when the window opens; a refresh with a task in the address keeps the same list.
  useEffect(() => {
    if (!data?.ok || session) return;
    const saved = readSession();
    const fresh = data.tasks;
    const keep = saved && taskId && saved.ids.includes(taskId) ? saved : null;
    const s: Session = keep ?? { ids: fresh.map((t) => t.id), titles: Object.fromEntries(fresh.map((t) => [t.id, t.title])), outcomes: {}, started: new Date().toISOString() };
    writeSession(s);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(s);
  }, [data, session, taskId]);

  if (!data || (data.ok && !session)) {
    return (
      <ViewLayout title="Work through tasks">
        <Skeleton />
      </ViewLayout>
    );
  }
  if (!data.ok) {
    return (
      <ViewLayout title="Work through tasks" footer={<FullPageButton href="/productivity" />}>
        <Notice tone="warn">{data.error}</Notice>
      </ViewLayout>
    );
  }
  const s = session!;
  const record = (id: string, o: Outcome) => {
    const next = { ...s, outcomes: { ...s.outcomes, [id]: o } };
    writeSession(next);
    setSession(next);
  };
  const remaining = s.ids.filter((id) => !s.outcomes[id]);
  const current = taskId && s.ids.includes(taskId) ? taskId : remaining[0] ?? null;
  if (!s.ids.length) {
    return (
      <ViewLayout title="Work through tasks" footer={<Button size="sm" onClick={nav.close}>Close</Button>}>
        <Notice tone="success">No tasks are due today or overdue. Nothing to work through.</Notice>
      </ViewLayout>
    );
  }
  if (!current || (s.outcomes[current] && !remaining.length)) {
    return <WorkSummary s={s} onRestart={(ids) => {
      const next: Session = { ...s, ids, outcomes: {}, started: new Date().toISOString() };
      writeSession(next);
      setSession(next);
      nav.replace({ kind: "work", taskId: ids[0] });
    }} />;
  }
  return <WorkTaskView key={current} s={s} taskId={current} tomorrow={data.tomorrow} today={data.today} onOutcome={record} />;
}

function WorkTaskView({ s, taskId, today, onOutcome }: { s: Session; taskId: string; today: string; tomorrow: string; onOutcome: (id: string, o: Outcome) => void }) {
  const nav = useWindowNav();
  const { data, reload } = useTaskWindow("tasks", taskId);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pos = useMemo(() => workPosition(s.ids, taskId), [s.ids, taskId]);
  // The next task still to do after this one (skipped or finished ones are passed over).
  const nextOpen = useMemo(() => {
    const i = s.ids.indexOf(taskId);
    return s.ids.slice(i + 1).find((id) => !s.outcomes[id]) ?? s.ids.slice(0, i).find((id) => !s.outcomes[id]) ?? null;
  }, [s, taskId]);
  const advance = () => {
    clearWindowCache();
    if (nextOpen) nav.push({ kind: "work", taskId: nextOpen });
    else nav.push({ kind: "work", taskId: null });
    // After the address changed, so the page reload is for the new address.
    nav.refreshPage();
  };
  const outcome = s.outcomes[taskId];
  const title = s.titles[taskId] ?? "Task";
  const progress = (
    <div className="flex items-center gap-3" data-testid="work-progress">
      <span className="tabular whitespace-nowrap text-sm font-semibold text-slate-900">
        {pos.index} of {pos.total}
      </span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pos.index} aria-valuemin={1} aria-valuemax={pos.total} aria-label="Tasks worked through">
        <div className="h-full bg-primary" style={{ width: `${(Object.keys(s.outcomes).length / Math.max(1, pos.total)) * 100}%` }} />
      </div>
      <span className="tabular hidden whitespace-nowrap text-xs text-slate-600 sm:inline">
        {Object.values(s.outcomes).filter((o) => o === "done").length} done, {Object.values(s.outcomes).filter((o) => o === "moved").length} moved, {Object.values(s.outcomes).filter((o) => o === "skipped").length} skipped
      </span>
    </div>
  );
  const quick = data && data.ok ? data : null;
  const isCommitment = !!quick?.commitment && ["open", "missed"].includes(quick.commitment.status);
  return (
    <ViewLayout
      title="Work through tasks"
      subtitle={`Task ${pos.index} of ${pos.total}`}
      toolbar={progress}
      footer={
        <>
          <Button
            size="sm"
            disabled={pending || !quick || outcome === "done"}
            data-testid="work-done"
            onClick={() =>
              start(async () => {
                await setTaskStatus(taskId, true, true);
                onOutcome(taskId, "done");
                advance();
              })
            }
          >
            <CheckCircle2 /> Done
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !quick || isCommitment || outcome === "done"}
            title={isCommitment ? "A commitment keeps its date." : undefined}
            data-testid="work-tomorrow"
            onClick={() =>
              start(async () => {
                const r = await moveTaskToTomorrow(taskId);
                if (!r.ok) return setError(r.error);
                onOutcome(taskId, "moved");
                advance();
              })
            }
          >
            <CalendarClock /> Move to tomorrow
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => nav.push({ kind: "edit", table: "tasks", id: taskId })} data-testid="work-edit">
            <Pencil /> Edit
          </Button>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            data-testid="work-skip"
            onClick={() => {
              onOutcome(taskId, "skipped");
              advance();
            }}
          >
            Skip <SkipForward />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="work-task">
        <ActionError error={error} />
        {!data ? (
          <Skeleton />
        ) : !data.ok || !quick ? (
          <Notice tone="warn">{data.ok ? "This task could not be shown." : data.error}</Notice>
        ) : (
          <>
            <section className="rounded-xl border border-border bg-white px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {isCommitment ? <Badge variant="default">Commitment</Badge> : <Badge variant="neutral">Regular task</Badge>}
                {outcome ? <Badge variant="success">{outcome === "done" ? "Done" : outcome === "moved" ? "Moved to tomorrow" : "Skipped"}</Badge> : null}
                <DueWord due={quick.task?.due ?? null} today={today} />
              </div>
              <h2 className={cn("mt-2 text-xl font-semibold leading-snug text-slate-900", quick.task?.done && "text-muted-foreground line-through")} data-testid="work-task-title">
                {quick.base.title || title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {quick.task?.due ? <span className={cn("tabular", dueClass(quick.task.due, today))}>Due {fmtDate(quick.task.due)}</span> : "No due date"}
                {movedNote(quick.task?.timesMoved ?? 0) ? <span className="text-status-soon"> {movedNote(quick.task?.timesMoved ?? 0)}</span> : null}
              </p>
            </section>
            {/* The same content as the task window everywhere else (src/components/app/windows/task-window.tsx). */}
            <TaskDetails d={quick} reload={reload} />
          </>
        )}
        {data && !data.ok ? <Button size="sm" variant="outline" className="self-start" onClick={reload}>Try again</Button> : null}
      </div>
    </ViewLayout>
  );
}

function WorkSummary({ s, onRestart }: { s: Session; onRestart: (ids: string[]) => void }) {
  const nav = useWindowNav();
  const count = (o: Outcome) => s.ids.filter((id) => s.outcomes[id] === o).length;
  const skipped = s.ids.filter((id) => s.outcomes[id] === "skipped" || !s.outcomes[id]);
  return (
    <ViewLayout
      title="Work through tasks: finished"
      footer={
        <>
          {skipped.length ? (
            <Button size="sm" variant="outline" onClick={() => onRestart(skipped)} data-testid="work-restart">
              Go through the {skipped.length} skipped again
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            size="sm"
            onClick={() => {
              writeSession(null);
              nav.close();
            }}
            data-testid="work-close"
          >
            Close
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="work-summary">
        <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
          {(
            [
              ["Done", count("done"), "text-status-met"],
              ["Moved to tomorrow", count("moved"), "text-slate-900"],
              ["Skipped", skipped.length, "text-slate-900"],
            ] as const
          ).map(([label, n, tone]) => (
            <div key={label} className="rounded-xl border border-border bg-white px-4 py-3">
              <p className="clamp-2 text-xs font-medium text-slate-600">{label}</p>
              <p className={cn("tabular mt-1 text-3xl font-semibold", tone)}>{n}</p>
            </div>
          ))}
        </div>
        <ul className="flex max-w-3xl flex-col divide-y divide-slate-100 rounded-xl border border-border bg-white px-4">
          {s.ids.map((id) => (
            <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-sm">
              <button type="button" className="clamp-1 text-left text-slate-900 hover:underline" onClick={() => nav.push({ kind: "record", table: "tasks", id })}>
                {s.titles[id] ?? "Task"}
              </button>
              <span className={cn("text-xs", s.outcomes[id] === "done" ? "text-status-met" : "text-slate-600")}>{s.outcomes[id] === "done" ? "Done" : s.outcomes[id] === "moved" ? "Moved to tomorrow" : "Skipped"}</span>
            </li>
          ))}
        </ul>
      </div>
    </ViewLayout>
  );
}

export type { WorkTask };

"use client";

/**
 * The one task and commitment window. Every way of opening a task or a commitment in a window (a task link on Home,
 * Task lists, Commitments, a record's task list, Work through tasks) shows the same content, the same as the full task
 * page: the next required action and the record the task is for first, then Details, Commitment (with its misses),
 * Checklists, Linked records, Documents, Notes, and Change history in sections that open and close (each viewer's
 * choice is remembered in this browser).
 *
 * - TaskDetails: the content (used by TaskWindow and by Work through tasks, which has its own buttons).
 * - TaskWindow: the window for /?w=r/tasks/<id> and r/commitments/<id>, with Mark as done, Move to tomorrow, Edit,
 *   and Open full page.
 * - Resolve: every Resolve button (Commitments, alerts, Home, the misses below, Next required action) opens this window
 *   at r/commitments/<id>/resolve[/<miss id>]: "Resolve this miss" is open at the top and every other section is
 *   closed (this choice is not remembered). Choices: Done late, New date, Open a decision, No longer a commitment
 *   (the form itself is src/components/app/resolve-miss-form.tsx, shared with step 2 of Close the day).
 * - Waiting on someone: two small fields on a task (who, since when; database update 0019). Tasks with a name here
 *   are listed on Today under "Waiting on someone".
 */
import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Circle, Hourglass, ListChecks, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, StatusBadge, dueClass } from "@/components/ui/badge";
import { NextActionCard } from "@/components/app/next-action-card";
import { SuggestionLine } from "@/components/app/suggestion-line";
import { CollapsibleCard, DisclosureGroup } from "@/components/app/collapsible";
import { DocumentsCard, HistoryCard, LinkedRecordsCard, NotesCard } from "@/components/app/record-side-panels";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { flashMessage, useWindowNav } from "@/components/app/window-host";
import { ActionError, clearWindowCache, ErrorView, FullPageButton, LoadingView, useLoad, ViewLayout } from "@/components/app/windows/views";
import { loadTaskWindow, moveTaskToTomorrow, type TaskWindowData } from "@/app/actions/window";
import { markCommitment, setTaskStatus } from "@/app/actions/records";
import { setTaskWaiting } from "@/app/actions/today";
import { movedNote } from "@/lib/calc/commitment-rule";
import { commitmentStatusWord, resolutionLabel } from "@/lib/calc/resolve-miss";
import { ResolveMissForm, type ResolveResult } from "@/components/app/resolve-miss-form";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Ok = Extract<TaskWindowData, { ok: true }>;

/** Loads the task window's data (shared cache with the other windows, refreshed after each change). */
export function useTaskWindow(table: string, id: string) {
  return useLoad<TaskWindowData>(`task-window:${table}:${id}`, () => loadTaskWindow(table, id));
}

const statusWord = commitmentStatusWord;

/** Resolve mode: "Resolve this miss" open, every other section closed. */
const RESOLVE_DEFAULTS: Record<string, boolean> = { resolve: true, details: false, commitment: false, checklists: false, linked: false, documents: false, notes: false, history: false };

/** The content of the task and commitment window. */
export function TaskDetails({ d, reload, hideContextNext = false, resolve = null }: { d: Ok; reload: () => void; hideContextNext?: boolean; /** Open "Resolve this miss" (a miss id, or "pending" for the newest pending miss). */ resolve?: string | null }) {
  const body = <TaskDetailsBody d={d} reload={reload} hideContextNext={hideContextNext} resolve={resolve} />;
  if (!resolve) return body;
  return (
    <DisclosureGroup storageKey={`window:${d.table}:resolve`} defaults={RESOLVE_DEFAULTS} remember={false}>
      {body}
    </DisclosureGroup>
  );
}

function TaskDetailsBody({ d, reload, hideContextNext, resolve }: { d: Ok; reload: () => void; hideContextNext: boolean; resolve: string | null }) {
  const nav = useWindowNav();
  const b = d.base;
  const changed = () => {
    reload();
    nav.refreshPage();
  };
  const win = { onChanged: changed };
  const storageKey = `window:${d.table}`;
  const c = d.commitment;
  const pendingMisses = c?.misses.filter((m) => m.resolution === "pending").length ?? 0;
  const [markError, setMarkError] = useState<string | null>(null);
  const resolveMiss = resolve && c ? (resolve === "pending" ? c.misses.find((m) => m.resolution === "pending") : c.misses.find((m) => m.id === resolve)) ?? null : null;
  return (
    <div className="flex flex-col gap-4" data-testid="task-window-body">
      {resolve ? <ResolveSection d={d} miss={resolveMiss} /> : null}
      {d.suggestion && !resolve ? <SuggestionLine s={d.suggestion} context={{ table: b.table, id: b.id, label: b.title }} /> : null}
      {/* First: what to do next, and the record the task is for (while resolving: only the record it is for). */}
      <div className={cn("grid grid-cols-1 gap-4", d.context && !resolve && "lg:grid-cols-2")}>
        {(!hideContextNext || !d.context) && !resolve ? <NextActionCard action={b.next} today={b.today} compact /> : null}
        {d.context ? (
          <button
            type="button"
            onClick={() => nav.push({ kind: "record", table: d.context!.table, id: d.context!.id })}
            className="flex min-w-0 flex-col rounded-xl border border-border bg-white px-4 py-3 text-left hover:border-primary-border hover:bg-primary-soft/40"
            data-testid="task-context"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-slate-600">For {d.context.singular.toLowerCase()}</span>
            <span className="clamp-2 mt-1 text-base font-semibold text-primary-strong">{d.context.title}</span>
            <span className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-600">Its next required action</span>
            <span className="clamp-2 mt-0.5 text-sm text-slate-800">{d.context.next.text}</span>
            {d.context.next.due ? <span className={cn("tabular mt-0.5 text-xs", dueClass(d.context.next.due, b.today) || "text-slate-500")}>Due {fmtDate(d.context.next.due)}</span> : null}
          </button>
        ) : null}
      </div>
      {d.task && d.table === "tasks" && !resolve && !d.task.done ? <WaitingOnRow taskId={b.id} who={d.task.waitingOn} since={d.task.waitingSince} today={d.today} available={d.has0019} onSaved={changed} /> : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CollapsibleCard id="details" storageKey={storageKey} title="Details" meta={b.fields.length || undefined} summary={b.fields.slice(0, 3).map((f) => `${f.label}: ${f.text}`).join(", ")} testId="task-window-details">
            {b.fields.length ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-3">
                {b.fields
                  .filter((f) => !f.wide)
                  .map((f, i) => (
                    <div key={i} className="min-w-0">
                      <dt className="clamp-2 text-xs font-medium leading-4 text-slate-500">{f.label}</dt>
                      <dd className="mt-0.5 min-w-0 break-words text-sm text-slate-900">
                        {f.href ? (
                          <Link href={f.href} className="font-medium text-primary-strong underline-offset-2 hover:underline">
                            {f.text}
                          </Link>
                        ) : f.status ? (
                          <StatusBadge status={f.status}>{f.text}</StatusBadge>
                        ) : (
                          f.text
                        )}
                      </dd>
                    </div>
                  ))}
                {b.fields
                  .filter((f) => f.wide)
                  .map((f, i) => (
                    <div key={`w${i}`} className="col-span-full border-t border-slate-100 pt-3">
                      <dt className="text-xs font-medium text-slate-500">{f.label}</dt>
                      <dd className="mt-1 max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{f.text}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No details filled in.</p>
            )}
          </CollapsibleCard>
          <CollapsibleCard
            id="commitment"
            storageKey={storageKey}
            title="Commitment"
            icon={<ShieldCheck className="h-4 w-4" />}
            meta={c ? (c.missCount ? `${c.missCount} missed` : undefined) : undefined}
            defaultOpen={!!c && (c.missCount > 0 || pendingMisses > 0)}
            summary={c ? `Due ${fmtDate(c.due)}. ${statusWord(c.status)}. Missed ${c.missCount} ${c.missCount === 1 ? "time" : "times"}.` : "Not a commitment. Open to mark it as one."}
            testId="task-window-commitment"
          >
            {c ? (
              <div className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Due</dt>
                    <dd className={cn("tabular mt-0.5 text-sm", c.status === "open" && dueClass(c.due, b.today))}>{fmtDate(c.due)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Original due date</dt>
                    <dd className="tabular mt-0.5 text-sm">{c.originalDue ? fmtDate(c.originalDue) : "Not set"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Status</dt>
                    <dd className="mt-0.5 text-sm">
                      <StatusBadge status={c.status === "met" ? "met" : c.status === "missed" ? "missed" : c.status === "done_late" ? "soon" : "neutral"}>{statusWord(c.status)}</StatusBadge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Times missed</dt>
                    <dd className={cn("tabular mt-0.5 text-sm", c.missCount ? "font-medium text-status-missed" : "")}>{c.missCount}</dd>
                  </div>
                </dl>
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-slate-700">Misses</h4>
                  {c.misses.length ? (
                    <ul className="flex flex-col divide-y divide-slate-100" data-testid="task-window-misses">
                      {c.misses.map((m) => (
                        <li key={m.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-1.5 text-sm">
                          <span className="tabular text-slate-600">{fmtDate(m.missedOn)}</span>
                          <span className={cn("clamp-2", !m.reason && "text-muted-foreground")}>{m.reason ?? "No reason given yet"}</span>
                          {m.resolution === "pending" ? (
                            <button
                              type="button"
                              onClick={() => nav.replace({ kind: "record", table: "commitments", id: c.id, resolve: m.id })}
                              className="whitespace-nowrap text-xs font-medium text-primary-strong hover:underline"
                              data-testid="task-window-resolve"
                            >
                              Resolve
                            </button>
                          ) : (
                            <span className="whitespace-nowrap text-xs text-slate-600" data-testid="task-window-resolution">
                              {resolutionLabel({ resolution: m.resolution, done_on: m.doneOn, new_due_date: m.newDue })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Never missed.</p>
                  )}
                </div>
              </div>
            ) : d.table === "tasks" ? (
              <GuardedForm
                action={async (fd) => {
                  try {
                    return await markCommitment(fd);
                  } catch {
                    return { ok: false, error: "Not saved. Try again." };
                  }
                }}
                onResult={(r) => {
                  const res = r as { ok: boolean; error?: string } | null;
                  setMarkError(res && !res.ok ? res.error ?? "Not saved." : null);
                  if (res?.ok) changed();
                }}
                className="flex flex-col gap-2"
              >
                <p className="text-sm text-slate-700">A commitment is checked against its due date. A miss needs a reason and a new date or a decision.</p>
                <input type="hidden" name="record_type" value="tasks" />
                <input type="hidden" name="record_id" value={b.id} />
                <input type="hidden" name="__quiet" value="1" />
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="date" name="due_date" defaultValue={d.markDue ?? ""} required aria-label="Commitment due date" className="w-44" />
                  <SubmitButton size="sm" variant="outline" pendingText="Saving...">
                    Mark as commitment
                  </SubmitButton>
                </div>
                <ActionError error={markError} />
              </GuardedForm>
            ) : null}
          </CollapsibleCard>
          {d.checklists.length ? (
            <CollapsibleCard id="checklists" storageKey={storageKey} title="Checklists" icon={<ListChecks className="h-4 w-4" />} meta={d.checklists.length} summary={d.checklists.map((l) => `${l.name}: ${l.text}`).join(", ")} testId="task-window-checklists">
              <ul className="flex flex-col divide-y divide-slate-100 text-sm">
                {d.checklists.map((l) => (
                  <li key={l.name} className="flex justify-between gap-3 py-1.5">
                    <span className="font-medium">{l.name}</span>
                    <span className="tabular text-slate-600">{l.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Check items off on the full page.</p>
            </CollapsibleCard>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <LinkedRecordsCard table={d.table} id={b.id} data={d.linked} win={win} storageKey={storageKey} />
          <DocumentsCard table={d.table} id={b.id} docs={d.documents} win={win} storageKey={storageKey} />
          <NotesCard table={d.table} id={b.id} notes={d.notes} win={win} storageKey={storageKey} />
          <HistoryCard table={d.table} history={d.history} storageKey={storageKey} />
        </div>
      </div>
    </div>
  );
}

/** The window of a task or a commitment (r/tasks/<id>, r/commitments/<id>). */
export function TaskWindow({ table, id, resolve = null }: { table: string; id: string; resolve?: string | null }) {
  const nav = useWindowNav();
  const { data, reload } = useTaskWindow(table, id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!data) return <LoadingView />;
  if (!data.ok) return <ErrorView error={data.error} href={`/records/${table}/${id}`} />;
  const b = data.base;
  const t = data.task;
  const isCommitment = !!data.commitment && ["open", "missed"].includes(data.commitment.status);
  const resolving = !!resolve && !!data.commitment;
  const moved = t ? movedNote(t.timesMoved) : null;
  return (
    <ViewLayout
      title={b.title}
      subtitle={
        <span className="flex items-center gap-2">
          {b.singular}
          {isCommitment ? <Badge variant="default">Commitment</Badge> : null}
          {resolving ? <Badge variant="danger">Missed</Badge> : null}
          {moved ? <span className="text-status-soon">{moved}</span> : null}
        </span>
      }
      footer={
        <>
          {t && !resolving ? (
            <Button
              size="sm"
              variant={t.done ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setTaskStatus(b.id, !t.done, true);
                  reload();
                  nav.refreshPage();
                })
              }
              data-testid="quick-view-task-toggle"
            >
              {t.done ? <Circle /> : <CheckCircle2 />} {pending ? "Saving..." : t.done ? "Mark as not done" : "Mark as done"}
            </Button>
          ) : null}
          {t && !t.done && !isCommitment ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid="quick-view-tomorrow"
              onClick={() =>
                start(async () => {
                  const r = await moveTaskToTomorrow(b.id);
                  if (!r.ok) return setError(r.error);
                  reload();
                  nav.refreshPage();
                })
              }
            >
              <CalendarClock /> Move to tomorrow
            </Button>
          ) : null}
          <span className="flex-1" />
          {b.canEdit ? (
            <Button size="sm" variant="outline" onClick={() => nav.push({ kind: "edit", table: b.table, id: b.id })} data-testid="window-edit">
              <Pencil /> Edit
            </Button>
          ) : null}
          <FullPageButton href={b.href} variant="default" />
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="quick-view-body">
        <ActionError error={error} />
        <TaskDetails d={data} reload={reload} resolve={resolve} />
      </div>
    </ViewLayout>
  );
}

// ---------- Resolve this miss ----------

/**
 * "Resolve this miss": the commitment and the miss, "Why was it missed?" (one line, required for every choice), then
 * Done late (the date it was done, today by default, not before the due date, not in the future, and an optional
 * note), New date, Open a decision, or No longer a commitment. Saving closes the window (Open a decision opens the
 * new decision) and reloads the page underneath.
 */
function ResolveSection({ d, miss }: { d: Ok; miss: NonNullable<Ok["commitment"]>["misses"][number] | null }) {
  const nav = useWindowNav();
  const c = d.commitment;
  const due = miss?.missedOn ?? c?.due ?? d.today;
  const done = (r: ResolveResult) => {
    if (!r.ok) return;
    clearWindowCache();
    nav.refreshPage();
    if (r.resolution === "decision" && r.decisionId) {
      flashMessage("Decision opened. Choose one of its options when you are ready.");
      nav.replace({ kind: "record", table: "decisions", id: r.decisionId });
      return;
    }
    flashMessage(
      r.resolution === "done_late"
        ? "Marked done late. It still counts as a miss in the commitment score."
        : r.resolution === "released"
          ? "No longer a commitment. The task stays in your task list."
          : "Reason and new date saved.",
    );
    nav.close();
  };
  return (
    <CollapsibleCard id="resolve" className="max-w-[48rem]" title="Resolve this miss" icon={<AlertTriangle className="h-4 w-4 text-status-missed" />} summary={miss ? `Missed ${fmtDate(miss.missedOn)}` : undefined} testId="task-window-resolve-section">
      {!c ? (
        <p className="text-sm text-muted-foreground">This is not a commitment, so there is nothing to resolve.</p>
      ) : !miss ? (
        <p className="text-sm text-slate-700" data-testid="resolve-nothing">
          Nothing to resolve. Every miss of this commitment has a reason. Status: {statusWord(c.status)}.
        </p>
      ) : miss.resolution !== "pending" ? (
        <p className="text-sm text-slate-700" data-testid="resolve-already">
          This miss is already resolved: {resolutionLabel({ resolution: miss.resolution, done_on: miss.doneOn, new_due_date: miss.newDue })}.{miss.reason ? ` Reason: ${miss.reason}` : ""}
        </p>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="clamp-1 text-xs font-medium text-slate-500">Was due</dt>
              <dd className="tabular mt-0.5 text-sm">{fmtDate(miss.missedOn)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="clamp-1 text-xs font-medium text-slate-500">Times missed</dt>
              <dd className={cn("tabular mt-0.5 text-sm", c.missCount ? "font-medium text-status-missed" : "")}>{c.missCount}</dd>
            </div>
            <div className="min-w-0">
              <dt className="clamp-1 text-xs font-medium text-slate-500">Status</dt>
              <dd className="mt-0.5 text-sm">
                <StatusBadge status="missed">Reason needed</StatusBadge>
              </dd>
            </div>
          </dl>
          <ResolveMissForm missId={miss.id} due={due} today={d.today} has0018={d.has0018} reason={miss.reason} onDone={done} />
        </>
      )}
    </CollapsibleCard>
  );
}

// ---------- Waiting on someone ----------

/**
 * "Waiting on": who the task waits on and since when (today by default), saved with Save. Clearing the name clears
 * the wait. Tasks with a name here are listed on Today under "Waiting on someone".
 */
function WaitingOnRow({ taskId, who, since, today, available, onSaved }: { taskId: string; who: string | null; since: string | null; today: string; available: boolean; onSaved: () => void }) {
  const [name, setName] = useState(who ?? "");
  const [date, setDate] = useState(since ?? today);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const dirty = name.trim() !== (who ?? "") || (name.trim() ? date !== (since ?? today) : false);
  if (!available) return null;
  return (
    <form
      className="grid grid-cols-1 items-end gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
      data-testid="task-waiting"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setTaskWaiting(taskId, name, date);
          setMessage(r.ok ? (name.trim() ? "Saved. It is on Today under Waiting on someone." : "Cleared.") : r.error);
          if (r.ok) onSaved();
        });
      }}
    >
      <span className="flex items-center gap-1.5 pb-2 text-xs font-medium text-slate-700 sm:pb-2.5">
        <Hourglass aria-hidden className="h-3.5 w-3.5 text-slate-500" /> Waiting on
      </span>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who (empty when no one)" maxLength={120} aria-label="Waiting on" className="h-8" data-testid="task-waiting-who" />
      <label className="flex items-center gap-2 text-xs text-slate-700">
        since
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-label="Waiting since" className="h-8 w-40" data-testid="task-waiting-since" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty} data-testid="task-waiting-save">
        {pending ? "Saving..." : "Save"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground sm:col-span-4">{message}</p> : null}
    </form>
  );
}

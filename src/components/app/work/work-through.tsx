"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeFollowUp, deferFollowUp, saveFollowUp } from "@/app/actions/outreach";
import { completeItemAction, deferItemAction, saveItemNextAction } from "@/app/actions/pipelines";
import { completeProjectAction, deferProjectAction, saveProjectNextAction } from "@/app/actions/projects";
import { deferTask, editTask, setTaskDone } from "@/app/actions/tasks";
import { completeNextAction, deferNextAction, saveNextAction } from "@/app/actions/work";
import { CenteredWindow } from "@/components/app/window";
import { addDaysISO, isWeekday } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import type { DealRow } from "@/lib/work/data";
import { lastContactLabel, orgRoleLine } from "@/lib/work/outreach";
import type { PersonRow } from "@/lib/work/outreach-data";
import type { PersonalTodo } from "@/lib/work/personal-todos";
import type { ItemRow } from "@/lib/work/pipelines-data";
import type { ProjectRow } from "@/lib/work/projects-data";
import { repeatDoneLine, repeatLabel } from "@/lib/work/repeat";
import { dueLabel } from "@/lib/work/stages";
import { recordHref, recordPillText } from "@/lib/work/task-records";
import { useBlockTime } from "@/components/app/work/block-time";
import { itemDoneAsks, AskMove as ItemAskMove, itemHref } from "@/components/app/work/item-row";
import { AskMove as DealAskMove } from "@/components/app/work/next-action-row";
import { FollowUpDoneAsk } from "@/components/app/work/person-row";
import { AskDone as ProjectAskDone } from "@/components/app/work/project-row";
import { Confirm, Pill, ProgressMark, RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Work through (push C, approved 2026-11-02): the solid main action on Next actions opens a large centered window
 * (about 860px) that steps one row at a time across every lane due today or earlier, in the Next actions order. Each
 * step shows the lane pill, the name and its context, the action in large type with its due, minutes and block, two
 * context lines for its lane, and a progress bar. Done and Later do what they do on the row (Done on a deal at its
 * stage's default asks about moving on; Done on a person asks for the next date); Edit changes the action, its date
 * and minutes in place; Skip goes to the next; Open full page opens the record. The last step says how it went.
 */

export type WorkStep =
  | { kind: "deal"; key: string; deal: DealRow }
  | { kind: "person"; key: string; person: PersonRow }
  | { kind: "project"; key: string; project: ProjectRow }
  | { kind: "item"; key: string; item: ItemRow }
  | { kind: "todo"; key: string; todo: PersonalTodo };

type View = { lane: string; name: string; meta: string; action: string; due: string | null; minutes: number | null; href: string; stage: string | null; ctx: [string, string][] };

function viewOf(s: WorkStep, today: string): View {
  const fmt = (d: string) => fmtDate(d, "MMM d");
  switch (s.kind) {
    case "deal": {
      const d = s.deal;
      return { lane: d.screened ? "Deal" : "Listing", name: d.name, meta: [d.screened ? d.stageName : "Listing", [d.whatItDoes, d.location].filter(Boolean).join(", ")].filter(Boolean).join(" · "), action: d.nextAction ?? "", due: d.nextActionDue, minutes: d.nextActionMinutes, href: `/work/deals/${d.id}`, stage: d.stageName, ctx: [["Key finding", d.keyFinding || "None yet"], ["Waiting on", d.waitingOn ? `${d.waitingOn}${d.waitingSince ? `, since ${fmt(d.waitingSince)}` : ""}` : "No one"]] };
    }
    case "person": {
      const p = s.person;
      return { lane: "Contacts", name: p.name, meta: orgRoleLine(p), action: p.followUpFor ?? "Follow up", due: p.nextFollowUp, minutes: null, href: `/work/people/${p.id}`, stage: null, ctx: [["Last contact", p.lastContactOn ? lastContactLabel(p.lastContactOn, p.lastContactKind, today, fmt) : "Not contacted yet"], ["Why in touch", p.note || "Not written yet"]] };
    }
    case "project": {
      const p = s.project;
      return { lane: "Rosara", name: p.name, meta: p.milestone ? `Milestone: ${p.milestone}` : "Rosara project", action: p.nextAction ?? "", due: p.nextActionDue, minutes: p.nextActionMinutes, href: `/work/rosara/${p.id}`, stage: null, ctx: [["Goal", p.goal || "Not set yet"], ["Open tasks", String(p.openTasks)]] };
    }
    case "item": {
      const i = s.item;
      const job = i.kind === "job";
      return { lane: job ? "Job search" : "Consulting", name: i.name, meta: [i.title, i.stageName].filter(Boolean).join(" · "), action: i.nextAction ?? "", due: i.nextActionDue, minutes: i.nextActionMinutes, href: itemHref(i), stage: null, ctx: job ? [["Contact", i.contactName || "None yet"], ["Note", i.note || "None yet"]] : [["Scope", i.scope || "Not set yet"], ["Contact", i.contactName || "None yet"]] };
    }
    case "todo": {
      const t = s.todo;
      return { lane: t.record ? "Task" : "To-do", name: t.text, meta: t.record ? recordPillText(t.record) : "Personal to-do", action: "", due: t.dueOn, minutes: null, href: t.record ? recordHref(t.record) : "/work/todos", stage: null, ctx: [["Linked to", t.record ? recordPillText(t.record) : "No record"], ["Repeat", repeatLabel(t.repeat, t.repeatUntil)]] };
    }
  }
}

/** Next Monday (or the Monday after, from a Monday). */
function nextMonday(today: string): string {
  let d = addDaysISO(today, 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDaysISO(d, 1);
  return d;
}

type Mode = "idle" | "ask" | "later" | "edit";
type Edit = { action: string; due: string; minutes: string };

export function WorkThrough({ steps, today, onClose }: { steps: WorkStep[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const blocks = useBlockTime();
  const [list] = useState(steps);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [done, setDone] = useState(0);
  const [moved, setMoved] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [what, setWhat] = useState("");
  const [laterDate, setLaterDate] = useState(addDaysISO(today, 2));
  const [edits, setEdits] = useState<Record<string, Partial<View>>>({});
  const [form, setForm] = useState<Edit>({ action: "", due: "", minutes: "" });
  const [pending, start] = useTransition();
  const close = () => {
    onClose();
    router.refresh();
  };
  const step = list[i];
  const finished = i >= list.length;
  const v = step ? { ...viewOf(step, today), ...edits[step.key] } : null;
  const go = (text: string | null, kind: "done" | "moved" | "skip") => {
    if (kind === "done") setDone((n) => n + 1);
    if (kind === "moved") setMoved((n) => n + 1);
    setLast(text);
    setError(null);
    setMode("idle");
    setI((n) => n + 1);
    const next = list[i + 1];
    setWhat(next?.kind === "person" ? (next.person.followUpFor ?? "") : "");
  };
  const run = <R extends { ok: true } | { ok: false; error: string }>(fn: () => Promise<R>, after: (r: Extract<R, { ok: true }>) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok === false) return setError((r as { error: string }).error);
      after(r as Extract<R, { ok: true }>);
    });

  // ---------- Done ----------
  const doneDirect = () => {
    if (!step || !v) return;
    if (step.kind === "deal") {
      const d = step.deal;
      if ((d.actionIsDefault && !!d.nextStage) || !!d.topTodo) return setMode("ask");
      return run(() => completeNextAction(d.id, false), () => go(`Done: ${v.action}. ${d.name} needs a next action.`, "done"));
    }
    if (step.kind === "person") {
      setWhat(step.person.followUpFor ?? "");
      return setMode("ask");
    }
    if (step.kind === "project") {
      if (step.project.topTask) return setMode("ask");
      return run(() => completeProjectAction(step.project.id), () => go(`Done: ${v.action}.`, "done"));
    }
    if (step.kind === "item") {
      if (itemDoneAsks(step.item).asks) return setMode("ask");
      return run(() => completeItemAction(step.item.kind, step.item.id, false), () => go(`Done: ${v.action}.`, "done"));
    }
    return run(() => setTaskDone(step.todo.id, true), (r) => go(`Done: ${step.todo.text}.${repeatDoneLine(r, (d) => fmtDate(d, "EEE MMM d"))}`, "done"));
  };
  const askPanel = () => {
    if (!step) return null;
    if (step.kind === "deal") {
      const d = step.deal;
      return <DealAskMove deal={d} pending={pending} onYes={() => run(() => completeNextAction(d.id, true), (r) => go(r.movedTo ? `${d.name} moved to ${r.movedTo}.` : `Done on ${d.name}.`, "done"))} onNo={() => run(() => completeNextAction(d.id, false), () => go(`Done on ${d.name}.`, "done"))} onTodo={(id) => run(() => completeNextAction(d.id, false, id), (r) => go(`Done. Next on ${d.name}: ${r.nextAction ?? "the task"}, due tomorrow.`, "done"))} />;
    }
    if (step.kind === "person") {
      const p = step.person;
      return <FollowUpDoneAsk person={p} today={today} pending={pending} what={what} setWhat={setWhat} onPick={(date) => run(() => completeFollowUp(p.id, { date, what }), (r) => go(r.date ? `Done. Next follow-up with ${p.name}: ${fmtDate(r.date, "EEE MMM d")}.` : `Done. ${p.name} has no next date.`, "done"))} onCancel={() => setMode("idle")} />;
    }
    if (step.kind === "project") {
      const p = step.project;
      return <ProjectAskDone project={p} pending={pending} onTask={(id) => run(() => completeProjectAction(p.id, id), (r) => go(`Done. Next on ${p.name}: ${r.nextAction ?? "the task"}, due tomorrow.`, "done"))} onClear={() => run(() => completeProjectAction(p.id), () => go(`Done on ${p.name}.`, "done"))} />;
    }
    if (step.kind === "item") {
      const it = step.item;
      const { nextStage } = itemDoneAsks(it);
      return <ItemAskMove item={it} nextStage={nextStage} pending={pending} onYes={() => run(() => completeItemAction(it.kind, it.id, true), (r) => go(r.movedTo ? `${it.name} moved to ${r.movedTo}.` : `Done on ${it.name}.`, "done"))} onNo={() => run(() => completeItemAction(it.kind, it.id, false), () => go(`Done on ${it.name}.`, "done"))} onTask={(id) => run(() => completeItemAction(it.kind, it.id, false, id), (r) => go(`Done. Next on ${it.name}: ${r.nextAction ?? "the task"}, due tomorrow.`, "done"))} />;
    }
    return null;
  };

  // ---------- Later ----------
  const later = (date: string) => {
    if (!step) return;
    const text = `Moved to ${fmtDate(date, "EEE MMM d")}.`;
    if (step.kind === "deal") return run(() => deferNextAction(step.deal.id, date), () => go(`${step.deal.name}: ${text}`, "moved"));
    if (step.kind === "person") return run(() => deferFollowUp(step.person.id, date), () => go(`${step.person.name}: ${text}`, "moved"));
    if (step.kind === "project") return run(() => deferProjectAction(step.project.id, date), () => go(`${step.project.name}: ${text}`, "moved"));
    if (step.kind === "item") return run(() => deferItemAction(step.item.kind, step.item.id, date), () => go(`${step.item.name}: ${text}`, "moved"));
    return run(() => deferTask(step.todo.id, date), () => go(`${step.todo.text}: ${text}`, "moved"));
  };

  // ---------- Edit ----------
  const openEdit = () => {
    if (!v) return;
    setForm({ action: step?.kind === "todo" ? v.name : v.action, due: v.due ?? "", minutes: v.minutes ? String(v.minutes) : "" });
    setMode(mode === "edit" ? "idle" : "edit");
  };
  const saveEdit = () => {
    if (!step) return;
    const patch: Partial<View> = step.kind === "todo" ? { name: form.action, due: form.due || null } : { action: form.action, due: form.due || null, minutes: form.minutes ? Number(form.minutes) : null };
    const after = () => {
      setEdits((m) => ({ ...m, [step.key]: { ...m[step.key], ...patch } }));
      setMode("idle");
    };
    if (step.kind === "deal") return run(() => saveNextAction(step.deal.id, { action: form.action, due: form.due, minutes: form.minutes, waitingOn: step.deal.waitingOn ?? "", waitingSince: step.deal.waitingSince ?? "" }), after);
    if (step.kind === "person") return run(() => saveFollowUp(step.person.id, { date: form.due, what: form.action }), after);
    if (step.kind === "project") return run(() => saveProjectNextAction(step.project.id, { action: form.action, due: form.due, minutes: form.minutes }), after);
    if (step.kind === "item") return run(() => saveItemNextAction(step.item.kind, step.item.id, { action: form.action, due: form.due, minutes: form.minutes, waitingOn: step.item.waitingOn ?? "", waitingSince: step.item.waitingSince ?? "" }), after);
    return run(() => editTask(step.todo.id, { text: form.action, due: form.due || null }), after);
  };

  const pct = list.length ? Math.round(((finished ? list.length : i) / list.length) * 100) : 100;
  const due = v?.due ? dueLabel(v.due, today, (d) => fmtDate(d, "MMM d")) : null;
  const blocked = step ? blocks?.blocked(step.key) : null;
  const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  const BIG = "h-[38px] px-4 text-[14px]";
  return (
    <CenteredWindow
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
      size="work"
      sub="Every row due today or earlier, one at a time, in the Next actions order"
      title={
        <span className="flex items-baseline gap-2">
          Work through
          <span className="text-[13px] font-normal text-muted-foreground" data-testid="wt-count">
            {finished ? `${list.length} of ${list.length}` : `${i + 1} of ${list.length}`}
          </span>
        </span>
      }
      testId="work-through"
      footer={
        finished ? (
          <>
            <span />
            <RowButton tone="primary" onClick={close} className={BIG} data-testid="wt-close">
              Close
            </RowButton>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <RowButton tone="primary" disabled={pending} onClick={doneDirect} className={cn(BIG, "min-w-[76px]")} data-testid="wt-done">
                {pending ? "Saving" : "Done"}
              </RowButton>
              <RowButton disabled={pending} onClick={() => setMode(mode === "later" ? "idle" : "later")} className={BIG} data-testid="wt-later">
                Later
              </RowButton>
              <RowButton disabled={pending} onClick={openEdit} className={BIG} data-testid="wt-edit">
                Edit
              </RowButton>
              <button type="button" disabled={pending} onClick={() => go(null, "skip")} className="h-[38px] rounded-[7px] px-3.5 text-[14px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800" data-testid="wt-skip">
                Skip
              </button>
            </div>
            <button type="button" onClick={() => { onClose(); router.push(v!.href); }} className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="wt-open">
              Open full page
            </button>
          </>
        )
      }
    >
      <div className="mb-5 h-[6px] overflow-hidden rounded-full bg-border" aria-hidden data-testid="wt-progress" data-pct={pct}>
        <i className="block h-full rounded-full bg-electric transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {last ? (
        <p className="mb-3 text-[13px] text-status-met" role="status" data-testid="wt-last">
          {last}
        </p>
      ) : null}
      {finished ? (
        <Confirm tone="ok" testId="wt-finished">
          <span>
            All {list.length} gone through: {done} done, {moved} moved, {list.length - done - moved} skipped.
          </span>
        </Confirm>
      ) : v ? (
        <div className="rounded-xl border border-border px-6 pt-5 pb-5" data-testid="wt-step" data-key={step!.key} data-kind={step!.kind}>
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill tone="blue" testId="wt-lane">
              {v.lane}
            </Pill>
            {step!.kind === "deal" ? <ProgressMark stage={v.stage} /> : null}
            <span className="text-[15px] font-semibold text-slate-900" data-testid="wt-name">
              {step!.kind === "todo" ? (v.meta === "Personal to-do" ? "Personal to-do" : v.meta) : v.name}
            </span>
          </div>
          {step!.kind !== "todo" && v.meta ? <div className="mt-1 text-[13px] text-muted-foreground">{v.meta}</div> : null}
          <div className="mt-3.5 text-[21px] leading-snug font-semibold tracking-[-0.01em] text-slate-900" data-testid="wt-action">
            {step!.kind === "todo" ? v.name : v.action}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {due ? <span className={cn(due.tone === "over" ? "font-semibold text-status-missed" : due.tone === "today" ? "font-semibold text-status-soon" : "text-muted-foreground")}>Due {due.text === "Today" ? "today" : due.text === "Yesterday" ? "yesterday" : due.text}</span> : null}
            {v.minutes ? <span className="text-muted-foreground">{v.minutes} min</span> : null}
            {blocked ? <span className="font-medium text-primary-strong">{blocked}</span> : null}
          </div>
          <div className="mt-4 grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3.5" data-testid="wt-context">
            {v.ctx.map(([k, val]) => (
              <div key={k} className="contents">
                <span className="label-caps pt-px text-[11px] text-slate-500">{k}</span>
                <span className="min-w-0 text-[13.5px] text-slate-800">{val}</span>
              </div>
            ))}
          </div>
          {error ? (
            <Confirm tone="warn" className="mt-4" testId="wt-error">
              <span>{error}</span>
            </Confirm>
          ) : null}
          {mode === "ask" ? <div className="mt-2">{askPanel()}</div> : null}
          {mode === "later" ? (
            <Confirm tone="blue" className="mt-4" testId="wt-later-choice">
              <span>Move to</span>
              <RowButton tone="cobalt" disabled={pending} onClick={() => later(addDaysISO(today, 1))} data-testid="wt-later-tomorrow">
                Tomorrow
              </RowButton>
              <RowButton disabled={pending} onClick={() => later(nextMonday(today))} data-testid="wt-later-monday">
                {isWeekday(today) && new Date(`${today}T12:00:00Z`).getUTCDay() === 5 ? "Monday" : "Next Monday"}
              </RowButton>
              <span className="flex items-center gap-1.5">
                <input type="date" value={laterDate} min={addDaysISO(today, 1)} onChange={(e) => setLaterDate(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Pick a date" data-testid="wt-later-date" />
                <RowButton disabled={pending || !laterDate} onClick={() => later(laterDate)} data-testid="wt-later-pick">
                  Move
                </RowButton>
              </span>
            </Confirm>
          ) : null}
          {mode === "edit" ? (
            <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-border bg-slate-50 px-4 pt-3 pb-3.5" data-testid="wt-edit-box">
              <div>
                <label className="mb-1 block text-[12.5px] font-medium text-slate-700" htmlFor="wt-act">
                  {step!.kind === "person" ? "Follow-up for" : step!.kind === "todo" ? (step!.todo.record ? "Task" : "To-do") : "Next action"}
                </label>
                <input id="wt-act" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className={INPUT} data-testid="wt-edit-action" />
              </div>
              <div className={cn("grid gap-3", step!.kind === "person" || step!.kind === "todo" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2")}>
                <div>
                  <label className="mb-1 block text-[12.5px] font-medium text-slate-700" htmlFor="wt-due">
                    Due
                  </label>
                  <input id="wt-due" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className={INPUT} data-testid="wt-edit-due" />
                </div>
                {step!.kind === "person" || step!.kind === "todo" ? null : (
                  <div>
                    <label className="mb-1 block text-[12.5px] font-medium text-slate-700" htmlFor="wt-min">
                      Minutes
                    </label>
                    <input id="wt-min" inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value.replace(/[^\d]/g, "") })} className={INPUT} data-testid="wt-edit-minutes" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <RowButton tone="primary" disabled={pending || !form.action.trim()} onClick={saveEdit} className="h-8 px-3.5 text-[13px]" data-testid="wt-edit-save">
                  Save
                </RowButton>
                <RowButton onClick={() => setMode("idle")} className="h-8 px-3 text-[13px]">
                  Cancel
                </RowButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </CenteredWindow>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeFollowUp, deferFollowUp } from "@/app/actions/outreach";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { lastContactLabel, nextDateChoices, nextFollowUpLabel, orgRoleLine, purposeLabel, purposeTone } from "@/lib/work/outreach";
import type { PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { dueLabel } from "@/lib/work/stages";
import { Confirm, Due, Figure, Figures, LanePill, Line1, Line2, Line3, Name, Pill, RowButton, RowShell, What } from "@/components/app/work/ui";

/** The purpose pills of a person (Off-market deals gold, Job search blue, Consulting gray, Rosara gold). */
export function PurposePills({ purposes, className }: { purposes: readonly string[]; className?: string }) {
  return (
    <>
      {purposes.map((p) => (
        <Pill key={p} tone={purposeTone(p)} className={className} testId="purpose-pill">
          {purposeLabel(p)}
        </Pill>
      ))}
    </>
  );
}

/**
 * One person on Outreach: name, the organization and role line, the purpose pills, the one-line note; at the right
 * the figures LAST CONTACT and NEXT FOLLOW-UP (red when overdue) and the buttons Email (the editor, prefilled and
 * logged by the send), Log a call (the drawer), and Done (asks for the next date and what for, then the row moves).
 * The row opens the person page. The editor and the drawer are held by the board, so they survive the row moving.
 */
export function PersonRow({ person, today, onEmail, onCall, done: doneText }: { person: PersonRowData; today: string; onEmail: (p: PersonRowData) => void; onCall: (p: PersonRowData) => void; /** A line to show after a call or an email was logged on this visit ("Call logged, 20 min"). */ done?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "ask" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const [what, setWhat] = useState(person.followUpFor ?? "");
  const last = lastContactLabel(person.lastContactOn, person.lastContactKind, today, (d) => fmtDate(d, "MMM d"));
  const next = nextFollowUpLabel(person.nextFollowUp, today, (d) => fmtDate(d, "MMM d"));
  const finish = (date: string | null) =>
    start(async () => {
      const r = await completeFollowUp(person.id, { date, what });
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.date ? `Done. Next follow-up with ${person.name}: ${fmtDate(r.date, "EEE MMM d")}.` : `Done. ${person.name} has no next date and moves to No date.` });
      setTimeout(() => router.refresh(), 1600);
    });
  const line = orgRoleLine(person);
  const asking = state.kind === "ask";

  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="person-row" dataAttrs={{ "data-person": person.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="person-done-result">
          <span>{state.text}</span>
          {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }

  return (
    <RowShell
      testId="person-row"
      dataAttrs={{ "data-person": person.id, "data-section-date": person.nextFollowUp ?? "" }}
      right={
        asking ? undefined : (
        <>
          <Figures className="mr-1">
            <Figure value={last} label="Last contact" testId="person-last-contact" />
            <Figure value={next.text} label="Next follow-up" tone={next.tone} testId="person-next-follow-up" />
          </Figures>
          <div className="flex gap-1.5">
            <RowButton onClick={() => onEmail(person)} data-testid="row-email">
              Email
            </RowButton>
            <RowButton onClick={() => onCall(person)} data-testid="row-log-call">
              Log a call
            </RowButton>
            <RowButton tone="soft" disabled={pending} onClick={() => setState(asking ? { kind: "idle" } : { kind: "ask" })} data-testid="row-done">
              Done
            </RowButton>
          </div>
        </>
        )
      }
    >
      <Line1>
        <Link href={`/work/outreach/${person.id}`} className="hover:underline" data-testid="person-link">
          <Name>{person.name}</Name>
        </Link>
        {line ? <What>{line}</What> : null}
        <PurposePills purposes={person.purposes} />
      </Line1>
      {person.note ? <Line3 className="text-[13px] text-slate-600">{person.note}</Line3> : null}
      {doneText ? (
        <Pill tone="green" className="mt-1.5" testId="person-logged">
          {doneText}
        </Pill>
      ) : null}
      {state.kind === "ask" ? <FollowUpDoneAsk person={person} today={today} pending={pending} what={what} setWhat={setWhat} onPick={finish} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

/**
 * The line after Done on a person: "Done. Next follow-up with X:" with three date choices, a date box with Save,
 * No date, and the "What for" text. Shared by the Outreach row and the outreach row on Home.
 */
export function FollowUpDoneAsk({ person, today, pending, what, setWhat, onPick, onCancel }: { person: Pick<PersonRowData, "id" | "name">; today: string; pending: boolean; what: string; setWhat: (v: string) => void; onPick: (date: string | null) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const choices = nextDateChoices(today);
  return (
    <Confirm tone="blue" className="mt-2" testId="person-done-ask">
      <span>
        Done. Next follow-up with <b>{person.name}</b>:
      </span>
      {choices.map((c) => (
        <RowButton key={c.date} tone="soft" disabled={pending} onClick={() => onPick(c.date)} data-testid="person-done-choice" data-date={c.date}>
          {c.label((d) => fmtDate(d, "MMM d"))}
        </RowButton>
      ))}
      <span className="flex items-center gap-1.5">
        <input type="date" value={typed} min={addDaysISO(today, 1)} onChange={(e) => setTyped(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Or a date" data-testid="person-done-date" />
        <RowButton disabled={pending || !typed} onClick={() => onPick(typed)} data-testid="person-done-save">
          Save
        </RowButton>
      </span>
      <RowButton disabled={pending} onClick={() => onPick(null)} data-testid="person-done-none">
        No date
      </RowButton>
      <span className="flex w-full items-center gap-2">
        <label htmlFor={`what-${person.id}`} className="text-xs text-muted-foreground whitespace-nowrap">
          What for
        </label>
        <input id={`what-${person.id}`} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What the next follow-up is for" className="h-[30px] min-w-0 flex-1 rounded-[7px] border border-input bg-white px-2 text-[12.5px]" data-testid="person-done-what" />
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </Confirm>
  );
}

/**
 * A person due today or overdue on Home's Next actions: the Outreach lane pill, the name, the organization and
 * role, what the follow-up is for; at the right the due date and Done (the same date choices) and Later.
 */
export function OutreachActionRow({ person, today }: { person: PersonRowData; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "ask" } | { kind: "later" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const [what, setWhat] = useState(person.followUpFor ?? "");
  const [typed, setTyped] = useState(addDaysISO(today, 2));
  const next = nextFollowUpLabel(person.nextFollowUp, today, (d) => fmtDate(d, "MMM d"));
  const refresh = () => setTimeout(() => router.refresh(), 1600);
  const finish = (date: string | null) =>
    start(async () => {
      const r = await completeFollowUp(person.id, { date, what });
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.date ? `Done. Next follow-up with ${person.name}: ${fmtDate(r.date, "EEE MMM d")}.` : `Done. ${person.name} has no next date.` });
      refresh();
    });
  const later = (date: string) =>
    start(async () => {
      const r = await deferFollowUp(person.id, date);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: `Moved to ${fmtDate(r.date, "EEE MMM d")}.` });
      refresh();
    });
  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="outreach-action-row" dataAttrs={{ "data-person": person.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
          <span>{state.text}</span>
          {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }
  const line = orgRoleLine(person);
  const asking = state.kind === "ask";
  return (
    <RowShell
      testId="outreach-action-row"
      dataAttrs={{ "data-person": person.id }}
      right={
        asking ? undefined : (
        <>
          <Due text={next.tone === "over" ? overdueText(person.nextFollowUp!, today) : next.text} tone={next.tone} testId="next-action-due" />
          <div className="flex gap-1.5">
            <RowButton tone="primary" disabled={pending} onClick={() => setState(asking ? { kind: "idle" } : { kind: "ask" })} data-testid="next-action-done">
              Done
            </RowButton>
            <RowButton disabled={pending} onClick={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} data-testid="next-action-later">
              Later
            </RowButton>
          </div>
        </>
        )
      }
    >
      <Line1>
        <LanePill lane="Outreach" />
        <Link href={`/work/outreach/${person.id}`} className="hover:underline">
          <Name>{person.name}</Name>
        </Link>
        {line ? <What>{line}</What> : null}
      </Line1>
      <Line2 className="text-slate-900">{person.followUpFor ?? "Follow up"}</Line2>
      {state.kind === "ask" ? <FollowUpDoneAsk person={person} today={today} pending={pending} what={what} setWhat={setWhat} onPick={finish} onCancel={() => setState({ kind: "idle" })} /> : null}
      {state.kind === "later" ? (
        <Confirm tone="blue" className="mt-2" testId="next-action-later-choice">
          <span>Later:</span>
          <RowButton tone="primary" disabled={pending} onClick={() => later(addDaysISO(today, 1))} data-testid="later-tomorrow">
            Tomorrow
          </RowButton>
          <span className="flex items-center gap-1.5">
            <input type="date" value={typed} min={addDaysISO(today, 1)} onChange={(e) => setTyped(e.target.value)} className="h-[30px] rounded-[7px] border border-input bg-white px-2 text-[12.5px]" aria-label="Pick a date" data-testid="later-date" />
            <RowButton disabled={pending || !typed} onClick={() => later(typed)} data-testid="later-pick">
              Move
            </RowButton>
          </span>
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setState({ kind: "idle" })}>
            Cancel
          </button>
        </Confirm>
      ) : null}
    </RowShell>
  );
}

/** "Yesterday", "3 days late" for an overdue follow-up on Home (the same words as deals). */
function overdueText(date: string, today: string): string {
  return dueLabel(date, today, (d) => fmtDate(d, "MMM d")).text;
}

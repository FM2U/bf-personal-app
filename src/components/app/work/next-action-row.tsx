"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeNextAction, deferNextAction } from "@/app/actions/work";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { dueLabel } from "@/lib/work/stages";
import type { DealRow } from "@/lib/work/data";
import { Confirm, Due, Line1, Line2, Name, Pill, ProgressMark, RowButton, RowShell, What } from "@/components/app/work/ui";

/**
 * One next action on Work on now (and the Done and Later buttons of the deal page's Next action card, through
 * `compact`). Done: when the action is the stage's default, the row asks "Move X to <next stage>? Yes / Not yet";
 * Yes moves the deal and sets the next stage's default action, Not yet clears the action (the deal then needs a next
 * action). Later: Tomorrow, or a date. Every save goes through a server action; the page re-reads after it.
 */
export function NextActionRow({ deal, today, compact = false }: { deal: DealRow; today: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "ask" } | { kind: "later" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const due = dueLabel(deal.nextActionDue, today, (d) => fmtDate(d, "MMM d"));
  // The confirmation stays readable for a moment before the list re-reads (the row then leaves Work on now).
  const refresh = () => (compact ? router.refresh() : setTimeout(() => router.refresh(), 1600));

  const finish = (move: boolean) =>
    start(async () => {
      const r = await completeNextAction(deal.id, move);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.movedTo ? `${deal.name} moved to ${r.movedTo}. Next action set from the stage default; edit it on the deal.` : `Done. ${deal.name} stays at ${deal.stageName ?? "its stage"} and needs a next action.` });
      refresh();
    });
  const later = (date: string) =>
    start(async () => {
      const r = await deferNextAction(deal.id, date);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: `Moved to ${fmtDate(r.due, "EEE MMM d")}.` });
      refresh();
    });

  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="next-action-row" dataAttrs={{ "data-deal": deal.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : state.text.startsWith("Moved to") || state.text.startsWith("Done.") ? "blue" : "ok"} testId="next-action-result">
          <span>{state.text}</span>
          {state.kind === "error" ? (
            <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton>
          ) : null}
        </Confirm>
      </RowShell>
    );
  }

  const buttons = (
    <div className="flex gap-1.5">
      <RowButton tone="primary" disabled={pending} onClick={() => (deal.actionIsDefault && deal.nextStage ? setState({ kind: "ask" }) : finish(false))} data-testid="next-action-done">
        {pending ? "Saving..." : "Done"}
      </RowButton>
      <RowButton disabled={pending} onClick={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} data-testid="next-action-later">
        Later
      </RowButton>
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2" data-testid="next-action-row" data-deal={deal.id}>
        <div className="flex justify-end">{buttons}</div>
        {state.kind === "ask" ? <AskMove deal={deal} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} /> : null}
        {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
      </div>
    );
  }

  return (
    <RowShell
      testId="next-action-row"
      dataAttrs={{ "data-deal": deal.id }}
      right={
        <>
          <Due text={due.text} tone={due.tone} testId="next-action-due" />
          <Pill tone="quiet" className="tabular min-w-[52px] justify-end">
            {deal.nextActionMinutes ? `${deal.nextActionMinutes} min` : ""}
          </Pill>
          {buttons}
        </>
      }
    >
      <Line1>
        <ProgressMark stage={deal.stageName} />
        <Link href={`/work/deals/${deal.id}`} className="hover:underline">
          <Name>{deal.name}</Name>
        </Link>
        <What>
          {deal.stageName}
          {deal.whatItDoes || deal.location ? ` · ${[deal.whatItDoes, deal.location].filter(Boolean).join(", ")}` : ""}
        </What>
      </Line1>
      <Line2 className="text-slate-900">{deal.nextAction}</Line2>
      {state.kind === "ask" ? <AskMove deal={deal} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

function AskMove({ deal, pending, onYes, onNo }: { deal: DealRow; pending: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-ask">
      <span>
        Done. Move <b>{deal.name}</b> to <b>{deal.nextStage}</b>?
      </span>
      <RowButton tone="primary" disabled={pending} onClick={onYes} data-testid="next-action-yes">
        Yes
      </RowButton>
      <RowButton disabled={pending} onClick={onNo} data-testid="next-action-not-yet">
        Not yet
      </RowButton>
    </Confirm>
  );
}

function LaterChoice({ today, pending, onPick, onCancel }: { today: string; pending: boolean; onPick: (d: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(addDaysISO(today, 2));
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-later-choice">
      <span>Later:</span>
      <RowButton tone="primary" disabled={pending} onClick={() => onPick(addDaysISO(today, 1))} data-testid="later-tomorrow">
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

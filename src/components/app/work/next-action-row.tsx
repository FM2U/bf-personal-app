"use client";

import { CONFIRM_MS } from "@/lib/confirm-timing";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeNextAction, deferNextAction } from "@/app/actions/work";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { dueLabel } from "@/lib/work/stages";
import type { DealRow } from "@/lib/work/data";
import { actionKey } from "@/lib/work/lanes";
import { blockSlots } from "@/components/app/work/block-time";
import { AiReason } from "@/components/app/work/project-row";
import { ActionFigures, Confirm, Line1, Line2, Name, ProgressMark, ROW_COLS, RowButton, RowButtons, RowShell, What } from "@/components/app/work/ui";

/**
 * One next action on Home (and the Done and Later buttons of the deal page's Next action card, through `compact`).
 * Done: when the action is the stage's default, the row asks "Move X to <next stage>? Yes / Not yet"; Yes moves the
 * deal and sets the next stage's default action, Not yet clears the action (the deal then needs a next action). When
 * the deal has Also to do items, the same line also offers "Next: <top item>", which makes that item the next action
 * (due tomorrow); a typed action with to-dos offers that too instead of clearing at once. Later: Tomorrow, or a
 * date. Every save goes through a server action; the page re-reads after it. Edit batch C round 3: a click on the row
 * outside its buttons and links opens the deal (or the listing, which shows "Listing" where a deal shows its stage).
 */
export function NextActionRow({ deal, today, compact = false, reason }: { deal: DealRow; today: string; compact?: boolean; /** The AI's one-line reason under the row (By the AI, batch B2). */ reason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "ask" } | { kind: "later" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const due = dueLabel(deal.nextActionDue, today, (d) => fmtDate(d, "MMM d"));
  // The confirmation stays readable for a moment before the list re-reads (the row then leaves Work on now).
  const refresh = () => (compact ? router.refresh() : setTimeout(() => router.refresh(), CONFIRM_MS));

  const finish = (move: boolean, todoId: string | null = null) =>
    start(async () => {
      const r = await completeNextAction(deal.id, move, todoId);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.movedTo ? `${deal.name} moved to ${r.movedTo}. Next action set from the stage default; edit it on the deal.` : todoId && r.nextAction ? `Done. Next on ${deal.name}: ${r.nextAction}, due tomorrow.` : `Done. ${deal.name} stays at ${deal.stageName ?? "its stage"} and needs a next action.` });
      refresh();
    });
  const asks = (deal.actionIsDefault && !!deal.nextStage) || !!deal.topTodo;
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
    <RowButtons pair>
      <RowButton tone="cobalt" disabled={pending} onClick={() => (asks ? setState({ kind: "ask" }) : finish(false))} className={ROW_COLS.button.cls} data-testid="next-action-done">
        {pending ? "Saving" : "Done"}
      </RowButton>
      <RowButton disabled={pending} onClick={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} className={ROW_COLS.button.cls} data-testid="next-action-later">
        Later
      </RowButton>
    </RowButtons>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2" data-testid="next-action-row" data-deal={deal.id}>
        <div className="flex justify-end">{buttons}</div>
        {state.kind === "ask" ? <AskMove deal={deal} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} onTodo={(id) => finish(false, id)} /> : null}
        {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
      </div>
    );
  }

  return (
    <RowShell
      testId="next-action-row"
      dataAttrs={{ "data-deal": deal.id }}
      open={`/work/deals/${deal.id}`}
      openLabel={`Open ${deal.name}`}
      right={
        <ActionFigures due={due} minutes={deal.nextActionMinutes} block={blockSlots({ rowKey: actionKey("Deals", deal.id), lane: deal.screened ? "Deal" : "Listing", name: deal.name, action: deal.nextAction, minutes: deal.nextActionMinutes, recordType: "pipeline_items", recordId: deal.id, href: `/work/deals/${deal.id}` })}>
          {buttons}
        </ActionFigures>
      }
    >
      <Line1>
        <ProgressMark stage={deal.stageName} />
        <Link href={`/work/deals/${deal.id}`} className="hover:underline">
          <Name>{deal.name}</Name>
        </Link>
        <What>
          {deal.screened ? deal.stageName : "Listing"}
          {deal.whatItDoes || deal.location ? ` · ${[deal.whatItDoes, deal.location].filter(Boolean).join(", ")}` : ""}
        </What>
      </Line1>
      <Line2 className="text-slate-900">{deal.nextAction}</Line2>
      {reason ? <AiReason text={reason} /> : null}
      {state.kind === "ask" ? <AskMove deal={deal} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} onTodo={(id) => finish(false, id)} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

/**
 * The line after Done: "Move X to <next stage>? Yes / Next: <top to-do> / Not yet" when the action was the stage
 * default; "Done. Next: <top to-do> / No next action" when it was typed and the deal has to-dos.
 */
export function AskMove({ deal, pending, onYes, onNo, onTodo }: { deal: DealRow; pending: boolean; onYes: () => void; onNo: () => void; onTodo: (todoId: string) => void }) {
  const move = deal.actionIsDefault && !!deal.nextStage;
  const todo = deal.topTodo;
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-ask">
      {move ? (
        <span>
          Done. Move <b>{deal.name}</b> to <b>{deal.nextStage}</b>?
        </span>
      ) : (
        <span>Done. What is next on {deal.name}?</span>
      )}
      {move ? (
        <RowButton tone="cobalt" disabled={pending} onClick={onYes} data-testid="next-action-yes">
          Yes
        </RowButton>
      ) : null}
      {todo ? (
        <RowButton tone={move ? "soft" : "cobalt"} disabled={pending} onClick={() => onTodo(todo.id)} className="max-w-full" title={todo.text} data-testid="next-action-todo">
          <span className="truncate">Next: {todo.text}</span>
        </RowButton>
      ) : null}
      <RowButton disabled={pending} onClick={onNo} data-testid="next-action-not-yet">
        {move ? "Not yet" : "No next action"}
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

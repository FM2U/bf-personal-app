"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeItemAction, deferItemAction } from "@/app/actions/pipelines";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import type { ItemRow } from "@/lib/work/pipelines-data";
import { feeLabel, nextOpenStage } from "@/lib/work/pipelines";
import { daysLabel, daysShort, dueLabel } from "@/lib/work/stages";
import { ColumnAction, ColumnCard } from "@/components/app/work/deal-columns";
import { shortName } from "@/components/app/work/deal-list-row";
import { AiReason } from "@/components/app/work/project-row";
import { ActionFigures, Confirm, LanePill, Line1, Line2, Line3, Name, Pill, ROW_COLS, RowButton, RowButtons, RowLink, RowShell, Stat, waitTone, What } from "@/components/app/work/ui";

/**
 * The rows of Job search and Consulting items (batch B2): the card in a column (opportunity: company and role, the
 * contact and location, the next action with its due, the waiting pill, the note; consulting: client and project,
 * the fee figure at the right, the next action with its due, the note), the row in the closed bar, the Home row
 * with a lane pill and Done and Later, and the Done and Later buttons of the record page. Done asks about moving to
 * the next stage when the action is the stage's default; a top task is offered as the new next action.
 */
export function itemHref(i: Pick<ItemRow, "kind" | "id">): string {
  return i.kind === "job" ? `/work/jobs/${i.id}` : `/work/consulting/${i.id}`;
}

function laneOf(kind: ItemRow["kind"]): "Job search" | "Consulting" {
  return kind === "job" ? "Job search" : "Consulting";
}

/** One opportunity in a Job search column. */
export function OpportunityCard({ item, today, hidden }: { item: ItemRow; today: string; hidden: boolean }) {
  const waiting = item.waitLevel !== "none" && item.status === "open";
  return (
    <ColumnCard href={itemHref(item)} hidden={hidden} id={item.id} testId="item-row">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-slate-900">{item.name}</span>
        {waiting ? (
          <Pill tone={waitTone(item.waitLevel)} className="tabular shrink-0" testId="item-wait">
            {daysShort(item.waitDays)}
            {item.contactName ? ` · ${shortName(item.contactName)}` : ""}
          </Pill>
        ) : !item.nextAction ? (
          <Pill tone="amber" className="shrink-0" testId="needs-action">
            Needs a next action
          </Pill>
        ) : null}
      </div>
      <div className="mt-px text-xs text-muted-foreground">
        <b className="mr-0.5 text-[13px] font-semibold text-slate-900">{item.title ?? "Role not set"}</b>
        {item.contactName ? ` · ${item.contactName}` : ""}
        {item.location ? ` · ${item.location}` : ""}
      </div>
      <ColumnAction nextAction={item.nextAction} nextActionDue={item.nextActionDue} nextActionMinutes={item.nextActionMinutes} waiting={waiting} today={today} />
      {item.note ? <div className="mt-[3px] line-clamp-2 text-[12.5px] text-muted-foreground italic">{item.note}</div> : null}
    </ColumnCard>
  );
}

/** One consulting item in a stage column: client and project, the fee at the right, the next action with its due, the note. */
export function ConsultingCard({ item, today, hidden }: { item: ItemRow; today: string; hidden: boolean }) {
  const waiting = item.waitLevel !== "none" && item.status === "open";
  return (
    <ColumnCard href={itemHref(item)} hidden={hidden} id={item.id} testId="item-row">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 text-[13.5px] leading-snug font-semibold text-slate-900">{item.name}</span>
        <b className="tabular shrink-0 text-[13px] font-semibold text-slate-900" data-testid="item-fee">
          {feeLabel(item.fee, item.stageName)}
        </b>
      </div>
      <div className="mt-px text-xs text-muted-foreground">
        {item.title ?? "Project not set"}
        {item.contactName ? ` · ${item.contactName}` : ""}
      </div>
      <ColumnAction nextAction={item.nextAction} nextActionDue={item.nextActionDue} nextActionMinutes={item.nextActionMinutes} waiting={waiting} today={today} />
      {item.note ? <div className="mt-[3px] line-clamp-2 text-[12.5px] text-muted-foreground italic">{item.note}</div> : null}
    </ColumnCard>
  );
}

/** One item in the closed bar: name and title, the outcome with its date, the note; the fee or the location at the right. */
export function ItemListRow({ item }: { item: ItemRow }) {
  return (
    <RowShell href={itemHref(item)} testId="item-row" dataAttrs={{ "data-deal": item.id }} right={<Stat value={item.kind === "consulting" ? feeLabel(item.fee, item.stageName) : (item.payRange ?? "No pay range")} label={item.kind === "consulting" ? "Fee" : (item.location ?? "No location")} col="lastContact" />}>
      <Line1>
        <Name>{item.name}</Name>
        {item.title ? <What>{item.title}</What> : null}
      </Line1>
      <Line2 className="text-muted-foreground">
        {item.stageName}
        {item.stageEnteredAt ? ` · ${fmtDate(item.stageEnteredAt, "MMM d")}` : ""}
      </Line2>
      {item.note ? <Line3>{item.note}</Line3> : null}
    </RowShell>
  );
}

type State = { kind: "idle" } | { kind: "ask" } | { kind: "later" } | { kind: "done"; text: string } | { kind: "error"; text: string };

function useItemAction(item: ItemRow, compact: boolean) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>({ kind: "idle" });
  const refresh = () => (compact ? router.refresh() : setTimeout(() => router.refresh(), 1600));
  const finish = (move: boolean, taskId: string | null = null) =>
    start(async () => {
      const r = await completeItemAction(item.kind, item.id, move, taskId);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: r.movedTo ? `${item.name} moved to ${r.movedTo}. Next action set from the stage default; edit it on the page.` : taskId && r.nextAction ? `Done. Next on ${item.name}: ${r.nextAction}, due tomorrow.` : `Done. ${item.name} stays at ${item.stageName ?? "its stage"} and needs a next action.` });
      refresh();
    });
  const later = (date: string) =>
    start(async () => {
      const r = await deferItemAction(item.kind, item.id, date);
      if (!r.ok) return setState({ kind: "error", text: r.error });
      setState({ kind: "done", text: `Moved to ${fmtDate(r.due, "EEE MMM d")}.` });
      refresh();
    });
  const nextStage = nextOpenStage(item.kind, item.stageName);
  const asks = (item.actionIsDefault && !!nextStage) || !!item.topTodo;
  return { pending, state, setState, finish, later, asks, nextStage };
}

function AskMove({ item, nextStage, pending, onYes, onNo, onTask }: { item: ItemRow; nextStage: string | null; pending: boolean; onYes: () => void; onNo: () => void; onTask: (id: string) => void }) {
  const move = item.actionIsDefault && !!nextStage;
  return (
    <Confirm tone="blue" className="mt-2" testId="next-action-ask">
      {move ? (
        <span>
          Done. Move <b>{item.name}</b> to <b>{nextStage}</b>?
        </span>
      ) : (
        <span>Done. What is next on {item.name}?</span>
      )}
      {move ? (
        <RowButton tone="cobalt" disabled={pending} onClick={onYes} data-testid="next-action-yes">
          Yes
        </RowButton>
      ) : null}
      {item.topTodo ? (
        <RowButton tone={move ? "soft" : "cobalt"} disabled={pending} onClick={() => onTask(item.topTodo!.id)} className="max-w-full" title={item.topTodo.text} data-testid="next-action-todo">
          <span className="truncate">Next: {item.topTodo.text}</span>
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

/** The Done and Later buttons of the record page's Next action card. */
export function ItemActionButtons({ item, today }: { item: ItemRow; today: string }) {
  const { pending, state, setState, finish, later, asks, nextStage } = useItemAction(item, true);
  if (state.kind === "done" || state.kind === "error") {
    return (
      <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
        <span>{state.text}</span>
        {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
      </Confirm>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="next-action-row" data-deal={item.id}>
      <div className="flex justify-end">
        <Buttons pending={pending} onDone={() => (asks ? setState({ kind: "ask" }) : finish(false))} onLater={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} />
      </div>
      {state.kind === "ask" ? <AskMove item={item} nextStage={nextStage} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} onTask={(id) => finish(false, id)} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </div>
  );
}

/** One opportunity or consulting item on Home: the lane pill, the name, the stage and role, the action, the due and minutes, Done and Later. */
export function ItemActionRow({ item, today, reason }: { item: ItemRow; today: string; reason?: string | null }) {
  const { pending, state, setState, finish, later, asks, nextStage } = useItemAction(item, false);
  const due = dueLabel(item.nextActionDue, today, (d) => fmtDate(d, "MMM d"));
  const lane = laneOf(item.kind);
  if (state.kind === "done" || state.kind === "error") {
    return (
      <RowShell testId="item-action-row" dataAttrs={{ "data-deal": item.id }}>
        <Confirm tone={state.kind === "error" ? "warn" : "blue"} testId="next-action-result">
          <span>{state.text}</span>
          {state.kind === "error" ? <RowButton onClick={() => setState({ kind: "idle" })}>Try again</RowButton> : null}
        </Confirm>
      </RowShell>
    );
  }
  const meta = [item.stageName, item.title, item.kind === "job" ? item.location : null].filter(Boolean).join(" · ");
  if (!item.nextAction) {
    return (
      <RowShell
        testId="needs-action-row"
        dataAttrs={{ "data-deal": item.id }}
        open={itemHref(item)}
        openLabel={`Open ${item.name}`}
        right={
          <RowButtons pair>
            <RowLink href={`${itemHref(item)}#next-action`} tone="cobalt" className="w-full" data-testid="set-next-action">
              Set next action
            </RowLink>
          </RowButtons>
        }
      >
        <Line1>
          <LanePill lane={lane} />
          <Link href={itemHref(item)} className="hover:underline">
            <Name>{item.name}</Name>
          </Link>
          {meta ? <What>{meta}</What> : null}
        </Line1>
        <Line2 className="font-medium text-status-soon">No next action set</Line2>
      </RowShell>
    );
  }
  const waiting = item.waitLevel !== "none";
  return (
    <RowShell
      testId="item-action-row"
      dataAttrs={{ "data-deal": item.id }}
      open={itemHref(item)}
      openLabel={`Open ${item.name}`}
      right={
        <ActionFigures due={due} minutes={item.nextActionMinutes}>
          <Buttons pending={pending} onDone={() => (asks ? setState({ kind: "ask" }) : finish(false))} onLater={() => setState(state.kind === "later" ? { kind: "idle" } : { kind: "later" })} />
        </ActionFigures>
      }
    >
      <Line1>
        <LanePill lane={lane} />
        <Link href={itemHref(item)} className="hover:underline">
          <Name>{item.name}</Name>
        </Link>
        {meta ? <What>{meta}</What> : null}
        {waiting ? (
          <Pill tone={waitTone(item.waitLevel)} className="tabular" testId="item-wait">
            Waiting {daysLabel(item.waitDays)}
          </Pill>
        ) : null}
      </Line1>
      <Line2 className="text-slate-900">{item.nextAction}</Line2>
      {reason ? <AiReason text={reason} /> : null}
      {state.kind === "ask" ? <AskMove item={item} nextStage={nextStage} pending={pending} onYes={() => finish(true)} onNo={() => finish(false)} onTask={(id) => finish(false, id)} /> : null}
      {state.kind === "later" ? <LaterChoice today={today} pending={pending} onPick={later} onCancel={() => setState({ kind: "idle" })} /> : null}
    </RowShell>
  );
}

"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { addTimeBlock, dayCalendar } from "@/app/actions/calendar";
import { date as fmtDate } from "@/lib/format";
import type { DayCalendar } from "@/lib/work/calendar-data";
import { blockedLabel, defaultLength, defaultStart, firstOverlap, lengthChoices, lengthLabel, rangeLabel, startChoices, timeLabel } from "@/lib/work/time-blocks";
import { Drawer } from "@/components/app/work/drawer";
import { Confirm, Pill, RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Block time (push C, approved 2026-11-02): a block icon beside Done on every Home row opens a side drawer (quick
 * entry): the date, the start, the length (the row's minutes, else the default block length), the event title, the
 * day's Google Calendar events under "Already on", and an amber line when the block overlaps one. "Add to Google
 * Calendar" creates a real event on the owner's primary calendar; the row then shows "Blocked 2:00" under its date.
 * Without the provider (any page but Home) the icon and the line are not shown.
 */

export type BlockTarget = {
  /** The Home row ("deal:<id>", "todo:<id>", ...). */
  rowKey: string;
  /** The lane pill in the drawer ("Deal", "Contacts", "Task"). */
  lane: string;
  name: string;
  action: string | null;
  minutes: number | null;
  recordType: string | null;
  recordId: string | null;
  /** The page the event links back to. */
  href: string;
};

type BlockCtx = { open: (t: BlockTarget) => void; blocked: (rowKey: string) => string | null };
const Ctx = createContext<BlockCtx | null>(null);

export function useBlockTime(): BlockCtx | null {
  return useContext(Ctx);
}

export function BlockTimeProvider({ children, today, nowLocal, blockMinutes, rowBlocks, calendar }: { children: React.ReactNode; today: string; nowLocal: string; blockMinutes: number; rowBlocks: Record<string, { date: string; start: string }>; calendar: DayCalendar }) {
  const [target, setTarget] = useState<BlockTarget | null>(null);
  const value = useMemo<BlockCtx>(
    () => ({
      open: setTarget,
      blocked: (k) => {
        const b = rowBlocks[k];
        return b ? blockedLabel(b.date, b.start, today, (d) => fmtDate(d, "MMM d")) : null;
      },
    }),
    [rowBlocks, today],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {target ? <BlockTimeDrawer key={target.rowKey} target={target} today={today} nowLocal={nowLocal} blockMinutes={blockMinutes} todayCalendar={calendar} onClose={() => setTarget(null)} /> : null}
    </Ctx.Provider>
  );
}

/** The block icon button beside Done (30px, in its own column so the buttons line up on every row). */
export function BlockButton({ target }: { target: BlockTarget }) {
  const ctx = useBlockTime();
  if (!ctx) return null;
  return (
    <span className="shrink-0" data-col="block" data-row-stop>
      <button type="button" onClick={() => ctx.open(target)} className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-input bg-white text-slate-600 hover:border-primary-border hover:bg-primary-soft hover:text-primary-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Block time for ${target.name}`} title="Block time" data-testid="block-time">
        <CalendarPlus className="h-[15px] w-[15px]" aria-hidden />
      </button>
    </span>
  );
}

/** The two parts a row's ActionFigures shows: the line under the due date and the icon before the buttons. */
export function blockSlots(target: BlockTarget): { note: React.ReactNode; button: React.ReactNode } {
  return { note: <BlockedNote rowKey={target.rowKey} />, button: <BlockButton target={target} /> };
}

/** "Blocked 2:00" under a row's due date. */
export function BlockedNote({ rowKey }: { rowKey: string }) {
  const ctx = useBlockTime();
  const text = ctx?.blocked(rowKey);
  if (!text) return null;
  return (
    <span className="mt-0.5 block text-[11.5px] font-medium whitespace-nowrap text-primary-strong" data-testid="blocked-note">
      {text}
    </span>
  );
}

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "mb-1 block text-[12.5px] font-medium text-slate-700";

function BlockTimeDrawer({ target, today, nowLocal, blockMinutes, todayCalendar, onClose }: { target: BlockTarget; today: string; nowLocal: string; blockMinutes: number; todayCalendar: DayCalendar; onClose: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(defaultStart(today, today, nowLocal));
  const def = defaultLength(target.minutes, blockMinutes);
  const [minutes, setMinutes] = useState(def);
  const [title, setTitle] = useState(target.action ? `${target.name}: ${target.action}` : target.name);
  const [day, setDay] = useState<DayCalendar>(todayCalendar);
  const [loading, startLoading] = useTransition();
  const [pending, startSave] = useTransition();
  const [result, setResult] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const hit = firstOverlap(start, minutes, day.items);
  const dayName = fmtDate(date, "EEE MMM d");
  const pickDate = (d: string) => {
    setDate(d);
    setResult(null);
    if (!d) return;
    if (d === today) {
      setDay(todayCalendar);
      return;
    }
    startLoading(async () => {
      const r = await dayCalendar(d);
      if (r.ok) setDay(r.calendar);
    });
  };
  const add = () =>
    startSave(async () => {
      setResult(null);
      const r = await addTimeBlock({ rowKey: target.rowKey, recordType: target.recordType, recordId: target.recordId, href: target.href, date, start, minutes, title });
      if (!r.ok) return setResult({ tone: "warn", text: r.error });
      setResult({ tone: "ok", text: `Added to Google Calendar: ${dayName}, ${timeLabel(start)}, ${lengthLabel(minutes)}. It shows on Home under Today's calendar.` });
      router.refresh();
    });
  const added = result?.tone === "ok";
  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Block time"
      sub="Put this on your Google Calendar"
      testId="block-drawer"
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-[10px] border border-border bg-slate-50 px-3.5 py-3" data-testid="block-context">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="blue">{target.lane}</Pill>
            <b className="text-sm font-semibold text-slate-900">{target.name}</b>
          </div>
          {target.action && target.action !== target.name ? <div className="mt-1 text-[13px] text-slate-700">{target.action}</div> : null}
        </div>
        {result ? (
          <Confirm tone={result.tone} testId="block-result">
            <span>{result.text}</span>
          </Confirm>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="bt-date">
              Date
            </label>
            <input id="bt-date" type="date" value={date} min={today} onChange={(e) => pickDate(e.target.value)} className={INPUT} data-testid="block-date" />
          </div>
          <div>
            <label className={LABEL} htmlFor="bt-start">
              Start
            </label>
            <select id="bt-start" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} data-testid="block-start">
              {startChoices().map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <span className={LABEL}>Length</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Length" data-testid="block-lengths">
            {lengthChoices(def).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={m === minutes} onClick={() => setMinutes(m)} className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", m === minutes ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-700 hover:bg-slate-50")} data-testid="block-length" data-minutes={m}>
                {lengthLabel(m)}
              </button>
            ))}
          </div>
        </div>
        {hit && !added ? (
          <p className="rounded-lg border border-status-soon-border bg-status-soon-bg px-3.5 py-2 text-[13px] text-status-soon" role="status" data-testid="block-overlap">
            Overlaps {hit.title}, {rangeLabel(hit)}. Pick another start or length.
          </p>
        ) : null}
        <div>
          <span className={LABEL}>Already on {dayName}</span>
          <div className={cn("overflow-hidden rounded-[9px] border border-border", loading && "opacity-60")} data-testid="block-day">
            {day.status !== "ok" ? (
              <p className="px-3 py-2.5 text-[13px] text-muted-foreground" data-testid="block-day-note">
                {day.status === "unavailable" ? "Google Calendar did not answer. Your blocks still show here." : "Reconnect Google to see your calendar."}
              </p>
            ) : null}
            {day.items.map((it) => (
              <div key={it.id} className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 border-t border-slate-100 px-3 py-2 text-[13px] first:border-t-0" data-testid="block-day-item" data-kind={it.kind}>
                <span className={cn("tabular", it.kind === "block" ? "font-semibold text-slate-900" : "text-slate-500")}>{rangeLabel(it)}</span>
                <span className="min-w-0 text-slate-800">{it.title}</span>
              </div>
            ))}
            {day.status === "ok" && !day.items.length ? <p className="px-3 py-2.5 text-[13px] text-muted-foreground">Nothing on the calendar yet.</p> : null}
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="bt-title">
            Event title
          </label>
          <input id="bt-title" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} data-testid="block-title" />
        </div>
        <p className="text-[12.5px] text-muted-foreground">Goes on the Google Calendar of {todayCalendar.email ?? "your Google account"}, with a link back to this record.</p>
        <div className="flex gap-2">
          {added ? (
            <RowButton tone="primary" onClick={onClose} className="h-9 px-4 text-[13px]" data-testid="block-close">
              Close
            </RowButton>
          ) : (
            <>
              <RowButton tone="primary" disabled={pending || !title.trim() || !date} onClick={add} className="h-9 px-4 text-[13px]" data-testid="block-add">
                {pending ? "Adding" : "Add to Google Calendar"}
              </RowButton>
              <RowButton onClick={onClose} className="h-9 px-3.5 text-[13px]" data-testid="block-cancel">
                Cancel
              </RowButton>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

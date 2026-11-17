"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DayCalendar } from "@/lib/work/calendar-data";
import { toMinutes } from "@/lib/work/time-blocks";
import { BLOCK_PAD_PX, clockShort, dayLayout, dayY, hourHeight, hourLabel, nowY, placeBlocks, ROW_PX, span, splitDay, type DayEvent, type PlacedBlock } from "@/lib/work/day-view";
import { cn } from "@/lib/utils";

/** The space the day view takes before it is measured (and on the phone, where the card is not stretched). */
const FALLBACK_FILL = 520;
/** The height of an "Early" or "Evening" list: its label, then a row per event. */
const listHeight = (n: number) => (n ? 30 + n * (ROW_PX + 4) : 0);

/**
 * Today's calendar on Home as a day view (release H2, approved by Bram 2026-11-17; the fix of 1:13 pm the same day).
 * The working day, 8 am to 6 pm, as hours at the left; Google Calendar events in soft blue blocks and the app's blocks
 * in soft green; 12px between blocks; a red line at the current time; past titles in gray. Every event is the same
 * row, alone or shared with events that overlap it: the start time at the left, the title at the right, cut with "..."
 * when long (the whole title on hover). Every event always shows: an hour is drawn tall enough for its rows, and a
 * busy block pushes the next one down. The red line of the current time runs on top of the blocks, from their left edge to the
 * right (Bram, 2026-11-17), with the time in the hour column, ending just before the blocks. "Today", "Early" and
 * "Evening" sit 7px left of the hour numbers, so each number sits under the "T" and "o" of "Today"; the day opens
 * scrolled to one hour before now. Events before 8 am are listed as "Early" above the hours and events from 6 pm
 * as "Evening" under them, so one late event never squeezes the day. When the day is taller than the card, it scrolls
 * inside the card, starting at the current hour. The rules are in src/lib/work/day-view.ts (tested).
 */
export function HomeDayCalendar({ calendar, nowLocal, blockHref }: { calendar: DayCalendar; /** "HH:MM" when the page was made, in the owner's time zone. */ nowLocal: string; blockHref: string }) {
  const all: DayEvent[] = calendar.items.map((it) => ({ id: it.id, title: it.title, start: it.start, end: it.end, kind: it.kind }));
  const split = splitDay(all);
  const layout = dayLayout(split.day);
  const now = useNowMinutes(nowLocal);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The space the card gives the day view, measured; the hours show once it is known, so nothing jumps into place.
  const [space, setSpace] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Under 1024px the card grows with the day (no space to fill), so the day keeps its plain height.
    const wide = window.matchMedia("(min-width: 1024px)");
    const watch = new ResizeObserver(() => setSpace(wide.matches ? el.clientHeight || FALLBACK_FILL : FALLBACK_FILL));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const fill = Math.max(FALLBACK_FILL * 0.8, (space ?? FALLBACK_FILL) - listHeight(split.early.length) - listHeight(split.evening.length) - 16);
  const hourPx = hourHeight(layout, fill);
  const placed = placeBlocks(layout, hourPx);
  const y = (m: number) => dayY(m, layout, hourPx);
  const hours = Array.from({ length: layout.toHour - layout.fromHour + 1 }, (_, i) => layout.fromHour + i);
  const note = calendar.status === "ok" ? null : calendar.status === "unavailable" ? "Google Calendar did not answer. Your blocks still show here." : "Reconnect Google to see your calendar.";
  const nowShown = now >= layout.fromHour * 60 && now <= layout.toHour * 60;
  // A day taller than the card starts at the current hour (once, when the space is first known).
  const scrolled = useRef(false);
  const lineY = nowY(placed.blocks, layout, hourPx, now);
  const nowTop = (split.early.length ? listHeight(split.early.length) + 16 : 0) + 8 + lineY - hourPx;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || space === null || scrolled.current || !nowShown) return;
    scrolled.current = true;
    if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = Math.max(0, nowTop);
  }, [space, nowShown, nowTop]);
  return (
    <section className="flex min-h-[560px] min-w-0 flex-col lg:min-h-0 rounded-[10px] border border-[var(--h-line)] bg-white py-4 lg:flex-1" data-testid="home-calendar" aria-label="Today's calendar">
      <div className="flex items-baseline justify-between gap-3 px-[18px]">
        <h2 className="-ml-[7px] text-[13px] font-semibold">Today</h2>
        <span className="text-[12px] text-[var(--h-ink2)]">
          <span data-testid="home-calendar-count">
            {all.length} {all.length === 1 ? "event" : "events"}
          </span>
          <Link href={blockHref} className="ml-3 underline decoration-[#d6d3d1] underline-offset-[3px] hover:text-[var(--h-ink)]" data-testid="home-calendar-block">
            Block time
          </Link>
        </span>
      </div>
      {note ? (
        <p className="mt-2 px-[18px] text-[12px] text-[var(--h-ink2)]" data-testid="calendar-note">
          {note}{" "}
          <Link href="/settings" className="underline underline-offset-[3px]">
            Settings, Connections
          </Link>
        </p>
      ) : null}
      {split.allDay.length ? (
        <div className="mx-[18px] mt-2.5 truncate rounded-[6px] bg-[var(--h-gcal)] px-2.5 py-1 text-[12px]" data-testid="calendar-all-day" data-count={split.allDay.length} title={split.allDay.map((e) => e.title).join(", ")}>
          <span className="mr-2 text-[10.5px] text-[var(--h-ink2)]">All day</span>
          {split.allDay.map((e) => e.title).join(", ")}
        </div>
      ) : null}
      <div ref={scrollRef} className="mt-3.5 min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain px-[18px] pt-2 max-lg:basis-auto" data-testid="home-calendar-scroll">
        <div className={cn(space === null && "invisible")}>
          <EventList label="Early" events={split.early} now={now} testId="calendar-early" />
          <div className="relative ml-[30px]" style={{ height: placed.height }} data-testid="home-calendar-day" data-from={layout.fromHour} data-to={layout.toHour}>
            {hours.map((h) => (
              <div key={h} className="absolute right-0 -left-[30px] text-[10.5px] text-[var(--h-faint)]" style={{ top: y(h * 60) }} aria-hidden>
                <span className={cn("inline-block w-[22px] -translate-y-[7px] text-left", nowShown && Math.abs(now - h * 60) < 15 && "invisible")}>{hourLabel(h)}</span>
                <i className="absolute top-0 right-0 left-[30px] border-t border-[var(--h-hair)]" />
              </div>
            ))}
            {placed.blocks.map((b) => (
              <Block key={b.key} block={b} now={now} />
            ))}
            {nowShown ? (
              <>
                <div className="absolute right-0 left-0 z-[3] border-t border-[var(--h-late)]" style={{ top: lineY }} data-testid="home-calendar-now" aria-hidden />
                <div className="absolute -left-[30px] z-[3] w-[27px] -translate-y-[6px] bg-white pr-[3px] text-right text-[10px] text-[var(--h-late)]" style={{ top: lineY }} aria-hidden>
                  {clockShort(now)}
                </div>
              </>
            ) : null}
            {!all.length && !note ? (
              <p className="absolute inset-x-0 top-1/3 text-center text-[12px] text-[var(--h-ink2)]" data-testid="calendar-empty">
                Nothing on the calendar today.
              </p>
            ) : null}
          </div>
          <EventList label="Evening" events={split.evening} now={now} testId="calendar-evening" />
        </div>
      </div>
    </section>
  );
}

/** One block on the day: one row per event (an event alone, or the events that overlap it). */
function Block({ block, now }: { block: PlacedBlock; now: number }) {
  return (
    <div className="absolute inset-x-0 z-[2] overflow-hidden rounded-[6px] bg-[var(--h-gcal)] px-2.5" style={{ top: block.top, height: block.height, paddingTop: BLOCK_PAD_PX / 2 }} data-testid={block.events.length > 1 ? "calendar-group" : "calendar-single"} data-count={block.events.length}>
      {block.events.map((e, i) => (
        <EventRow key={e.id} event={e} now={now} first={i === 0} />
      ))}
    </div>
  );
}

/**
 * The one row every event uses (Bram, 2026-11-17): the start time in a 36px column, the title cut with "..." when long;
 * an app block on soft green with "blocked"; past titles in gray.
 */
function EventRow({ event: e, now, first }: { event: DayEvent; now: number; first: boolean }) {
  const { s, t } = span(e);
  const past = t <= now;
  return (
    <div className={cn("-mx-2.5 grid grid-cols-[36px_minmax(0,1fr)] items-baseline gap-2 px-2.5 py-[3px]", !first && "border-t border-[rgba(28,25,23,0.06)]", e.kind === "block" && "bg-[var(--h-block)]")} style={{ minHeight: ROW_PX }} data-testid="calendar-item" data-kind={e.kind} title={`${e.title}, ${clockShort(s)} to ${clockShort(t)}`}>
      <span className="text-[10.5px] text-[var(--h-ink2)]">{clockShort(s)}</span>
      <span className={cn("truncate text-[12px]", past ? "text-[var(--h-ink2)]" : e.kind === "block" ? "text-[var(--h-block-ink)]" : "text-[var(--h-ink)]")}>
        {e.title}
        {e.kind === "block" ? ", blocked" : ""}
      </span>
    </div>
  );
}

/** Events before 8 am ("Early", above the hours) or from 6 pm ("Evening", under them), as plain rows. */
function EventList({ label, events, now, testId }: { label: string; events: DayEvent[]; now: number; testId: string }) {
  if (!events.length) return null;
  return (
    <div className={cn(label === "Early" ? "mb-4" : "mt-4")} data-testid={testId}>
      <div className="mb-1 -ml-[7px] text-[10.5px] font-medium tracking-[0.07em] text-[var(--h-faint)] uppercase">{label}</div>
      <div className="rounded-[6px] bg-[var(--h-gcal)] px-2.5 py-1">
        {events.map((e, i) => (
          <EventRow key={e.id} event={e} now={now} first={i === 0} />
        ))}
      </div>
    </div>
  );
}

/** The current time in minutes, moving on every minute from the time the page was made (the owner's time zone). */
function useNowMinutes(nowLocal: string): number {
  const start = toMinutes(nowLocal);
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setNow(start + Math.floor((Date.now() - t0) / 60000)), 30000);
    return () => window.clearInterval(id);
  }, [start]);
  return now;
}

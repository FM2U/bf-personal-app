"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DayCalendar } from "@/lib/work/calendar-data";
import { toMinutes } from "@/lib/work/time-blocks";
import { clockShort, dayLayout, dayPosition, hourLabel, type DayBlock, type DayEvent } from "@/lib/work/day-view";
import { cn } from "@/lib/utils";

/** Space between two blocks that follow each other (Bram, 2026-11-17: about three hairlines). */
const GAP = 12;
/** The height a block keeps when its event is short, so its title stays readable. */
const MIN_BLOCK = 24;
/** One event row inside a shared block (option A). */
const ROW = 23;

/**
 * Today's calendar on Home as a day view (release H2, approved by Bram 2026-11-17): the hours from 8 am (or the first
 * event) to 6 pm at the left, Google Calendar events in soft blue blocks and the app's blocks in soft green, 12px
 * between blocks, a red line at the current time, and past titles in gray. Events that overlap share one block
 * (option A): one row per event, the start time at the left, the title cut with "..." when long; an app block keeps
 * its green row. The grouping and positions are in src/lib/work/day-view.ts (tested).
 */
export function HomeDayCalendar({ calendar, nowLocal, blockHref }: { calendar: DayCalendar; /** "HH:MM" when the page was made, in the owner's time zone. */ nowLocal: string; blockHref: string }) {
  const all: DayEvent[] = calendar.items.map((it) => ({ id: it.id, title: it.title, start: it.start, end: it.end, kind: it.kind }));
  // All-day and multi-day events (00:00 to 23:59 on this day) are named above the hours, not drawn as a block.
  const allDay = all.filter(isAllDay);
  const events = all.filter((e) => !isAllDay(e));
  const layout = dayLayout(events);
  const now = useNowMinutes(nowLocal);
  const gridRef = useRef<HTMLDivElement>(null);
  // The grid's height, measured; the blocks show once it is known, so they never jump into place.
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return setHeight(el.clientHeight || 600);
    const watch = new ResizeObserver(() => setHeight(el.clientHeight || 600));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const H = height ?? 600;
  const y = (m: number) => dayPosition(m, layout) * H;
  const hours = Array.from({ length: layout.toHour - layout.fromHour + 1 }, (_, i) => layout.fromHour + i);
  const note = calendar.status === "ok" ? null : calendar.status === "unavailable" ? "Google Calendar did not answer. Your blocks still show here." : "Reconnect Google to see your calendar.";
  const nowShown = now >= layout.fromHour * 60 && now <= layout.toHour * 60;
  return (
    <section className="flex min-h-[560px] min-w-0 flex-col lg:flex-1 rounded-[10px] border border-[var(--h-line)] bg-white px-[18px] py-4" data-testid="home-calendar" aria-label="Today's calendar">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Today</h2>
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
        <p className="mt-2 text-[12px] text-[var(--h-ink2)]" data-testid="calendar-note">
          {note}{" "}
          <Link href="/settings" className="underline underline-offset-[3px]">
            Settings, Connections
          </Link>
        </p>
      ) : null}
      {allDay.length ? (
        <div className="mt-2.5 truncate rounded-[6px] bg-[var(--h-gcal)] px-2.5 py-1 text-[12px]" data-testid="calendar-all-day" data-count={allDay.length} title={allDay.map((e) => e.title).join(", ")}>
          <span className="mr-2 text-[10.5px] text-[var(--h-ink2)]">All day</span>
          {allDay.map((e) => e.title).join(", ")}
        </div>
      ) : null}
      <div ref={gridRef} className={cn("relative mt-3.5 ml-[34px] flex-1", height === null && "invisible")} data-testid="home-calendar-day" data-from={layout.fromHour} data-to={layout.toHour}>
        {hours.map((h) => (
          <div key={h} className="absolute right-0 -left-[34px] text-[10.5px] text-[var(--h-faint)]" style={{ top: y(h * 60) }} aria-hidden>
            <span className={cn("inline-block w-[22px] -translate-y-[7px] text-right", nowShown && Math.abs(now - h * 60) < 15 && "invisible")}>{hourLabel(h)}</span>
            <i className="absolute top-0 right-0 left-[34px] border-t border-[var(--h-hair)]" />
          </div>
        ))}
        {layout.blocks.map((b, i) => {
          // A short event keeps a readable height, but never runs into the next block or past the last hour.
          const next = layout.blocks[i + 1];
          const room = (next ? y(next.start) : H + GAP / 2) - y(b.start);
          return <Block key={b.key} block={b} top={y(b.start)} height={y(b.end) - y(b.start)} room={room} now={now} />;
        })}
        {nowShown ? (
          <>
            <div className="absolute right-0 -left-1 z-[3] border-t border-[var(--h-late)]" style={{ top: y(now) }} data-testid="home-calendar-now" aria-hidden />
            <div className="absolute -left-[34px] z-[3] w-[28px] -translate-y-[6px] bg-white text-right text-[10px] text-[var(--h-late)]" style={{ top: y(now) }} aria-hidden>
              {clockShort(now)}
            </div>
          </>
        ) : null}
        {!events.length && !note ? (
          <p className="absolute inset-x-0 top-1/3 text-center text-[12px] text-[var(--h-ink2)]" data-testid="calendar-empty">
            Nothing on the calendar today.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** One block: an event alone (title, then the times when there is room), or overlapping events sharing it (one row each). */
function Block({ block, top, height, room, now }: { block: DayBlock; top: number; height: number; /** Space down to the next block's top (or the grid's bottom). */ room: number; now: number }) {
  const h = Math.max(4, Math.min(Math.max(height - GAP, MIN_BLOCK), room - GAP));
  const style = { top: top + GAP / 2, height: h };
  const past = (e: DayEvent) => toMinutes(e.end) <= now;
  if (block.events.length === 1) {
    const e = block.events[0];
    const roomy = h >= 40;
    return (
      <div className={cn("absolute inset-x-0 overflow-hidden rounded-[6px] px-2.5 py-1.5 text-[12px] leading-[1.3]", e.kind === "block" ? "bg-[var(--h-block)]" : "bg-[var(--h-gcal)]")} style={style} data-testid="calendar-item" data-kind={e.kind} title={`${e.title}, ${clockShort(toMinutes(e.start))} to ${clockShort(toMinutes(e.end))}`}>
        <div className={cn(!roomy && "truncate", past(e) ? "text-[var(--h-ink2)]" : e.kind === "block" ? "text-[var(--h-block-ink)]" : "text-[var(--h-ink)]")}>{e.title}</div>
        {roomy ? (
          <div className="mt-0.5 text-[10.5px] text-[var(--h-ink2)]">
            {clockShort(toMinutes(e.start))} to {clockShort(toMinutes(e.end))}
            {e.kind === "block" ? ", blocked by you" : ""}
          </div>
        ) : null}
      </div>
    );
  }
  // Overlapping events: as many rows as fit; the rest are named in "and N more" (the side panel shows all, release H3).
  const fit = Math.max(1, Math.floor((h - 8) / ROW));
  const shown = block.events.length > fit ? block.events.slice(0, fit - 1) : block.events;
  const more = block.events.length - shown.length;
  return (
    <div className="absolute inset-x-0 overflow-hidden rounded-[6px] bg-[var(--h-gcal)] px-2.5 py-1" style={style} data-testid="calendar-group" data-count={block.events.length}>
      {shown.map((e, i) => (
        <div key={e.id} className={cn("-mx-2.5 grid grid-cols-[34px_minmax(0,1fr)] items-baseline gap-2 px-2.5 py-[3px]", i > 0 && "border-t border-[rgba(28,25,23,0.06)]", e.kind === "block" && "bg-[var(--h-block)]")} data-testid="calendar-item" data-kind={e.kind} title={`${e.title}, ${clockShort(toMinutes(e.start))} to ${clockShort(toMinutes(e.end))}`}>
          <span className="text-[10.5px] text-[var(--h-ink2)]">{clockShort(toMinutes(e.start))}</span>
          <span className={cn("truncate text-[12px]", past(e) ? "text-[var(--h-ink2)]" : e.kind === "block" ? "text-[var(--h-block-ink)]" : "text-[var(--h-ink)]")}>
            {e.title}
            {e.kind === "block" ? ", blocked" : ""}
          </span>
        </div>
      ))}
      {more ? <div className="border-t border-[rgba(28,25,23,0.06)] py-[3px] pl-[42px] text-[11px] text-[var(--h-ink2)]">and {more} more</div> : null}
    </div>
  );
}

const isAllDay = (e: DayEvent) => e.start === "00:00" && e.end >= "23:59";

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

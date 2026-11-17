/**
 * Today's calendar as a day view on Home (release H2, approved by Bram 2026-11-17; claude/2026-11-17-home-layout-proposal.md,
 * option A of 2026-11-17-calendar-overlap-ab-2.png; the fix of 1:13 pm the same day), pure and tested in
 * src/lib/work/day-view.test.ts.
 *
 * The working day, 8 am to 6 pm, is drawn as the hours. Events that end by 8 am are listed as "Early", events that start
 * at 6 pm or later as "Evening", so one late event never squeezes the day. Events that overlap in time share one block.
 * Every event is one row (the start time, then the title), alone or shared, and every row always shows: an hour is
 * drawn tall enough for its events, and a block that still needs more room pushes the next one down.
 */
import { toMinutes } from "@/lib/work/time-blocks";

export type DayEvent = { id: string; title: string; start: string; end: string; kind: "event" | "block" };
export type DayBlock = { key: string; start: number; end: number; events: DayEvent[] };
export type DayLayout = { fromHour: number; toHour: number; blocks: DayBlock[] };
export type DaySplit = { early: DayEvent[]; day: DayEvent[]; evening: DayEvent[]; allDay: DayEvent[] };
export type PlacedBlock = DayBlock & { top: number; height: number };

export const DAY_FROM_HOUR = 8;
export const DAY_TO_HOUR = 18;
/** One event row inside a block, in px. */
export const ROW_PX = 23;
/** A block's padding (top and bottom together), in px. */
export const BLOCK_PAD_PX = 8;
/** Space between two blocks that follow each other (Bram, 2026-11-17: about three hairlines), in px. */
export const GAP_PX = 12;
/** The tallest an hour is drawn to make room for its events, in px (a denser hour pushes later blocks down instead). */
export const MAX_HOUR_PX = 96;

/** Minutes of an event, with an end before its start (or equal) read as a 15-minute event. */
export function span(e: Pick<DayEvent, "start" | "end">): { s: number; t: number } {
  const s = toMinutes(e.start);
  const t = toMinutes(e.end);
  return { s, t: t > s ? t : s + 15 };
}

const byStart = (a: DayEvent, b: DayEvent) => span(a).s - span(b).s || span(b).t - span(a).t || a.title.localeCompare(b.title);
const isAllDay = (e: DayEvent) => e.start === "00:00" && e.end >= "23:59";

/** All-day events, events before the working day, events during it, and events after it. */
export function splitDay(events: readonly DayEvent[]): DaySplit {
  const out: DaySplit = { early: [], day: [], evening: [], allDay: [] };
  for (const e of [...events].sort(byStart)) {
    const { s, t } = span(e);
    if (isAllDay(e)) out.allDay.push(e);
    else if (t <= DAY_FROM_HOUR * 60) out.early.push(e);
    else if (s >= DAY_TO_HOUR * 60) out.evening.push(e);
    else out.day.push(e);
  }
  return out;
}

/** The day's blocks: events in time order, overlapping ones grouped (a chain of overlaps is one block). */
export function dayBlocks(events: readonly DayEvent[]): DayBlock[] {
  const out: DayBlock[] = [];
  for (const e of [...events].sort(byStart)) {
    const { s, t } = span(e);
    const last = out[out.length - 1];
    if (last && s < last.end) {
      last.events.push(e);
      last.end = Math.max(last.end, t);
    } else out.push({ key: e.id, start: s, end: t, events: [e] });
  }
  return out;
}

/** The working day's hours and blocks (an event that starts before 8 am or ends after 6 pm sits at the edge). */
export function dayLayout(events: readonly DayEvent[]): DayLayout {
  return { fromHour: DAY_FROM_HOUR, toHour: DAY_TO_HOUR, blocks: dayBlocks(events) };
}

/** The height a block needs to show all of its rows. */
export const blockNeed = (b: Pick<DayBlock, "events">) => b.events.length * ROW_PX + BLOCK_PAD_PX;

/**
 * How tall an hour is drawn: tall enough to fill `fill` px, and tall enough that each block's rows fit before the next
 * block starts (up to MAX_HOUR_PX; past that the blocks push each other down instead).
 */
export function hourHeight(layout: DayLayout, fill: number): number {
  const hours = layout.toHour - layout.fromHour;
  let px = fill / hours;
  const from = layout.fromHour * 60;
  const to = layout.toHour * 60;
  layout.blocks.forEach((b, i) => {
    const s = Math.max(b.start, from);
    const next = layout.blocks[i + 1];
    const room = ((next ? Math.max(next.start, from) : to) - s) / 60;
    if (room > 0) px = Math.max(px, Math.min(MAX_HOUR_PX, (blockNeed(b) + GAP_PX) / room));
  });
  return px;
}

/** Each block's top and height in px for an hour height; a block never covers the next one, which moves down instead. */
export function placeBlocks(layout: DayLayout, hourPx: number): { blocks: PlacedBlock[]; height: number } {
  const from = layout.fromHour * 60;
  const to = layout.toHour * 60;
  const y = (m: number) => ((Math.min(Math.max(m, from), to) - from) / 60) * hourPx;
  let bottom = 0;
  const blocks = layout.blocks.map((b) => {
    const top = Math.max(y(b.start) + GAP_PX / 2, bottom ? bottom + GAP_PX : 0);
    const height = Math.max(y(b.end) - y(b.start) - GAP_PX, blockNeed(b));
    bottom = top + height;
    return { ...b, top, height };
  });
  return { blocks, height: Math.max(y(to), bottom + GAP_PX / 2) };
}

/**
 * Where the current time sits on the drawn day, in px: inside a block, the same share of the block's height as the time
 * is of the block's span; otherwise on the hours, moved down as far as the blocks before it were pushed.
 */
export function nowY(placed: readonly PlacedBlock[], layout: Pick<DayLayout, "fromHour" | "toHour">, hourPx: number, now: number): number {
  const at = dayY(now, layout, hourPx);
  const before = placed.filter((b) => b.start <= now).pop();
  if (!before) return at;
  if (now < before.end) return before.top + ((now - before.start) / (before.end - before.start)) * before.height;
  const shift = before.top - (dayY(before.start, layout, hourPx) + GAP_PX / 2);
  return Math.max(at + shift, before.top + before.height + GAP_PX / 2);
}

/** Where a time sits on the drawn day, in px from the first hour. */
export function dayY(minutes: number, layout: Pick<DayLayout, "fromHour" | "toHour">, hourPx: number): number {
  const from = layout.fromHour * 60;
  return ((Math.min(Math.max(minutes, from), layout.toHour * 60) - from) / 60) * hourPx;
}

/** Where a time sits on the day, from 0 (the first hour) to 1 (the last). */
export function dayPosition(minutes: number, layout: Pick<DayLayout, "fromHour" | "toHour">): number {
  const from = layout.fromHour * 60;
  const to = layout.toHour * 60;
  return Math.max(0, Math.min(1, (minutes - from) / (to - from)));
}

/** "9:58" from minutes; "12:00" at noon. */
export function clockShort(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The hour label at the left of the day view: "8", "12", "1". */
export function hourLabel(h: number): string {
  return String(h % 12 === 0 ? 12 : h % 12);
}

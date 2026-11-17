/**
 * Today's calendar as a day view on Home (release H2, approved by Bram 2026-11-17; claude/2026-11-17-home-layout-proposal.md,
 * option A of 2026-11-17-calendar-overlap-ab-2.png), pure and tested in src/lib/work/day-view.test.ts.
 *
 * The day runs from 8 am (or the hour of the first event, when earlier) to 6 pm (or the hour after the last event,
 * when later). Events that overlap in time share one block: the block spans from the first start to the last end of
 * the overlapping events and lists each event on its own row. An event alone is its own block.
 */
import { toMinutes } from "@/lib/work/time-blocks";

export type DayEvent = { id: string; title: string; start: string; end: string; kind: "event" | "block" };
export type DayBlock = { key: string; start: number; end: number; events: DayEvent[] };
export type DayLayout = { fromHour: number; toHour: number; blocks: DayBlock[] };

export const DAY_FROM_HOUR = 8;
export const DAY_TO_HOUR = 18;

/** Minutes of an event, with an end before its start (or equal) read as a 15-minute event. */
function span(e: DayEvent): { s: number; t: number } {
  const s = toMinutes(e.start);
  const t = toMinutes(e.end);
  return { s, t: t > s ? t : s + 15 };
}

/** The day's blocks: events in time order, overlapping ones grouped (a chain of overlaps is one block). */
export function dayBlocks(events: readonly DayEvent[]): DayBlock[] {
  const sorted = [...events].sort((a, b) => span(a).s - span(b).s || span(b).t - span(a).t || a.title.localeCompare(b.title));
  const out: DayBlock[] = [];
  for (const e of sorted) {
    const { s, t } = span(e);
    const last = out[out.length - 1];
    if (last && s < last.end) {
      last.events.push(e);
      last.end = Math.max(last.end, t);
    } else out.push({ key: e.id, start: s, end: t, events: [e] });
  }
  return out;
}

/** The hours shown: 8 am to 6 pm, widened to whole hours around any event outside them. */
export function dayLayout(events: readonly DayEvent[]): DayLayout {
  const blocks = dayBlocks(events);
  let fromHour = DAY_FROM_HOUR;
  let toHour = DAY_TO_HOUR;
  for (const b of blocks) {
    fromHour = Math.min(fromHour, Math.floor(b.start / 60));
    toHour = Math.max(toHour, Math.ceil(b.end / 60));
  }
  return { fromHour, toHour: Math.min(24, toHour), blocks };
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

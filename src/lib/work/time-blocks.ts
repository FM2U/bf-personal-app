/**
 * Block time (push C, approved 2026-11-02), pure and tested in src/lib/work/time-blocks.test.ts: the start times and
 * lengths the side drawer offers, the default length (the row's minutes, else the owner's default block length,
 * 60 unless changed), the overlap with what is already on that day, the times in the owner's time zone, and the
 * "Blocked 2:00" line a Home row shows under its due date.
 */

/** One thing on a day: a Google Calendar event or one of the app's blocks, as local "HH:MM" times. */
export type DayItem = { id: string; title: string; start: string; end: string; kind: "event" | "block"; /** Where a block came from ("Blocked from Next actions"). */ from?: string | null };

export const DEFAULT_BLOCK_MINUTES = 60;
export const LENGTH_CHOICES = [15, 30, 45, 60, 90, 120] as const;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fromMinutes = (n: number): string => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** "2:00 pm". */
export function timeLabel(hhmm: string): string {
  const n = toMinutes(hhmm);
  const h = Math.floor(n / 60) % 24;
  const m = n % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "2:00" (the short form on a row and in the calendar tile). */
export function shortTime(hhmm: string): string {
  const n = toMinutes(hhmm);
  const h = Math.floor(n / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(n % 60).padStart(2, "0")}`;
}

/** The start times offered: every half hour from 7:00 am to 8:00 pm. */
export function startChoices(): string[] {
  const out: string[] = [];
  for (let n = 7 * 60; n <= 20 * 60; n += 30) out.push(fromMinutes(n));
  return out;
}

/** The first start offered: on today, the next half hour from now (7:00 am at the earliest); on another day 9:00 am. */
export function defaultStart(date: string, today: string, nowHHMM: string): string {
  if (date !== today) return "09:00";
  const next = Math.ceil((toMinutes(nowHHMM) + 1) / 30) * 30;
  return fromMinutes(Math.min(20 * 60, Math.max(7 * 60, next)));
}

/** The length the drawer starts with: the row's minutes when it has them, else the default block length. */
export function defaultLength(rowMinutes: number | null | undefined, setting: number | null | undefined = DEFAULT_BLOCK_MINUTES): number {
  if (rowMinutes && rowMinutes >= 5) return Math.min(480, Math.round(rowMinutes));
  return setting && setting >= 5 ? setting : DEFAULT_BLOCK_MINUTES;
}

/** The length chips: the six usual ones, plus the default when it is not one of them, in order. */
export function lengthChoices(def: number): number[] {
  return [...new Set([...LENGTH_CHOICES, def])].sort((a, b) => a - b);
}

/** "15 min", "1 hour", "1.5 hours", "2 hours", "75 min". */
export function lengthLabel(m: number): string {
  if (m === 60) return "1 hour";
  if (m > 60 && m % 30 === 0) return `${m / 60} hours`;
  return `${m} min`;
}

/** The first item of the day the block would overlap (touching ends do not count), or null. */
export function firstOverlap<T extends Pick<DayItem, "start" | "end">>(start: string, minutes: number, items: readonly T[]): T | null {
  const s = toMinutes(start);
  const e = s + minutes;
  return [...items].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)).find((it) => s < toMinutes(it.end) && toMinutes(it.start) < e) ?? null;
}

/** "9:00 to 11:00". */
export function rangeLabel(it: Pick<DayItem, "start" | "end">): string {
  return `${shortTime(it.start)} to ${shortTime(it.end)}`;
}

/** The line under a Home row's due date: "Blocked 2:00" today, "Blocked Nov 5" on a later day. */
export function blockedLabel(date: string, start: string, today: string, fmt: (d: string) => string): string {
  return date === today ? `Blocked ${shortTime(start)}` : `Blocked ${fmt(date)}`;
}

// ---------- Times in the owner's time zone ----------

/** The offset of a time zone from UTC at an instant, in minutes (New York in November: -300). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** A local date and "HH:MM" in a time zone as an ISO instant. */
export function zonedToIso(date: string, hhmm: string, tz: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const first = tzOffsetMinutes(tz, guess);
  const at = new Date(guess.getTime() - first * 60000);
  const second = tzOffsetMinutes(tz, at);
  return new Date(guess.getTime() - second * 60000).toISOString();
}

/** An instant as the local date and "HH:MM" in a time zone. */
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour").replace("24", "00")}:${get("minute")}` };
}

/** The ISO bounds of a local day (for the Google Calendar list and the blocks query). */
export function dayBounds(date: string, tz: string): { start: string; end: string } {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: zonedToIso(date, "00:00", tz), end: zonedToIso(next.toISOString().slice(0, 10), "00:00", tz) };
}

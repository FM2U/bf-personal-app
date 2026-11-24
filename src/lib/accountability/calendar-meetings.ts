/**
 * Calendar meetings on record (push K, Bram 2026-11-24 3:22 pm; claude/2026-11-24-calendar-meetings-proposal.md), pure
 * and tested in calendar-meetings.test.ts. A Google Calendar event that matches a person on Contacts or a record (the
 * calendar rows of Today's activity) is saved as a meeting (one communication) once its end time has passed, so it is
 * on the person's timeline, moves their last contact, and counts like a meeting logged by hand. Rules:
 *  - one meeting per calendar event (communications.calendar_event_id: "auto:<event id>" when the app saved it,
 *    "<event id>" when the same meeting was logged by hand);
 *  - a call or meeting logged by hand with the same person at an overlapping time IS that meeting: no second one;
 *  - a row dropped on End of day has no meeting (the saved one is taken away; Keep brings it back);
 *  - a block the app created is never a meeting.
 * A meeting logged by hand at another time is its own meeting, so the day's count is the sum (Bram).
 */
import type { ActivityRow } from "@/lib/accountability/activity";

export const AUTO = "auto:";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** "09:30" on a day in a time zone, as an instant (ISO). */
export function localInstant(day: string, hhmm: string, tz: string): string {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  const guess = new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (utc.getTime() - shown.getTime())).toISOString();
}

export type CalendarEvent = { /** The Google event id (the row id without "cal:"). */ eventId: string; rowId: string; title: string; minutes: number; start: string; end: string; contactId: string | null; dealId: string | null };

/** The calendar rows of a day as events: Google events only (no app blocks), with a start time, a person or a deal. */
export function calendarEvents(rows: readonly ActivityRow[], day: string, tz: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const r of rows) {
    if (r.kind !== "calendar" || !r.id.startsWith("cal:") || r.id.startsWith("cal:block:") || !r.time) continue;
    const m = /^(.*?)(?:, (\d+) min)?$/.exec(r.text) ?? [];
    const minutes = Number(m[2] ?? 0) || 0;
    const start = localInstant(day, r.time, tz);
    const contactId = new RegExp(`^/work/people/(${UUID})(?:$|[/?#])`, "i").exec(String(r.href ?? ""))?.[1]?.toLowerCase() ?? null;
    const dealId = new RegExp(`^/work/deals/(${UUID})(?:$|[/?#])`, "i").exec(String(r.recordHref ?? r.href ?? ""))?.[1]?.toLowerCase() ?? null;
    if (!contactId && !dealId) continue;
    out.push({ eventId: r.id.slice(4), rowId: r.id, title: String(m[1] ?? r.text).trim() || r.text, minutes, start, end: new Date(Date.parse(start) + minutes * 60000).toISOString(), contactId, dealId });
  }
  return out;
}

export type DayComm = { id: string; contactId: string | null; method: string; occurredAt: string; minutes: number | null; calendarEventId: string | null };

const isMeeting = (m: string) => m === "call" || m === "meeting" || m === "video";

/** Two spans overlap (a span with no length is the moment it starts). */
export function overlaps(aStart: string, aMinutes: number, bStart: string, bMinutes: number): boolean {
  const a0 = Date.parse(aStart);
  const b0 = Date.parse(bStart);
  const a1 = a0 + Math.max(1, aMinutes) * 60000;
  const b1 = b0 + Math.max(1, bMinutes) * 60000;
  return a0 < b1 && b0 < a1;
}

/** The event a comm stands for: its own mark, with or without "auto:". */
export const eventOf = (calendarEventId: string | null | undefined): string | null => (calendarEventId ? (calendarEventId.startsWith(AUTO) ? calendarEventId.slice(AUTO.length) : calendarEventId) : null);

export type MeetingPlan = {
  /** Events to save as a meeting (ended, kept, no meeting yet). */
  create: CalendarEvent[];
  /** Hand-logged calls or meetings that are the event's meeting (same person, overlapping time): they get the event's mark. */
  tie: { commId: string; eventId: string }[];
  /** Saved meetings to take away: their row was dropped on End of day, or the event left the calendar or no longer matches. */
  remove: string[];
};

/**
 * What to do for a day: `events` the day's calendar events, `comms` the day's communications, `dropped` the row ids
 * dropped on End of day, `now` the current instant. Only an event whose end time has passed becomes a meeting.
 */
export function planCalendarMeetings(i: { events: readonly CalendarEvent[]; comms: readonly DayComm[]; dropped: ReadonlySet<string>; now: string }): MeetingPlan {
  const plan: MeetingPlan = { create: [], tie: [], remove: [] };
  const byEvent = new Map<string, DayComm>();
  for (const c of i.comms) {
    const e = eventOf(c.calendarEventId);
    if (e) byEvent.set(e, c);
  }
  const live = new Set(i.events.map((e) => e.eventId));
  // A meeting the app saved goes when its row is dropped, or when its event is no longer one of the day's.
  for (const c of i.comms) {
    if (!c.calendarEventId?.startsWith(AUTO)) continue;
    const e = c.calendarEventId.slice(AUTO.length);
    if (i.dropped.has(`cal:${e}`) || !live.has(e)) plan.remove.push(c.id);
  }
  const taken = new Set<string>();
  for (const e of i.events) {
    if (i.dropped.has(e.rowId)) continue;
    if (Date.parse(e.end) > Date.parse(i.now)) continue;
    if (byEvent.has(e.eventId)) continue;
    // The same meeting logged by hand: the same person, at an overlapping time, not already another event's meeting.
    const same = e.contactId ? i.comms.find((c) => !c.calendarEventId && !taken.has(c.id) && isMeeting(c.method) && c.contactId?.toLowerCase() === e.contactId && overlaps(c.occurredAt, c.minutes ?? 0, e.start, e.minutes)) : undefined;
    if (same) {
      taken.add(same.id);
      plan.tie.push({ commId: same.id, eventId: e.eventId });
    } else plan.create.push(e);
  }
  return plan;
}

/** "2:00 to 3:00 pm" for an event, in the owner's time zone (the overlap warning). */
export function spanWords(start: string, minutes: number, tz: string): string {
  const fmt = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).toLowerCase();
  const a = fmt(Date.parse(start));
  if (!minutes) return a;
  const b = fmt(Date.parse(start) + minutes * 60000);
  const same = a.slice(-2) === b.slice(-2);
  return `${same ? a.slice(0, -3) : a} to ${b}`;
}

/**
 * A call or meeting about to be logged by hand against the day's calendar events: the event with the same person at an
 * overlapping time (that IS the meeting), else the first other event it overlaps (a warning, never a stop).
 */
export function overlapFor(events: readonly CalendarEvent[], dropped: ReadonlySet<string>, when: string, minutes: number, contactId: string): { same: CalendarEvent | null; other: CalendarEvent | null } {
  const hits = events.filter((e) => !dropped.has(e.rowId) && overlaps(when, minutes, e.start, e.minutes));
  const same = hits.find((e) => e.contactId === contactId.toLowerCase()) ?? null;
  return { same, other: same ? null : hits[0] ?? null };
}

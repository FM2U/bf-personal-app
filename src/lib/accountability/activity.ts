/**
 * Today's activity on End of day (Bram, 2026-11-16, release 3b; claude/2026-11-16-capture-and-new-report-build-plan.md):
 * one list of what the day held, from three inputs: what the app recorded (listings, stage moves, next actions done,
 * calls, meetings, emails, notes), the work logged by hand ("Log work"), and the Google Calendar events that match a
 * contact or a record in the app, or that the app created (blocks). Each row can be dropped with one click (a meeting
 * that did not happen); the dropped ids are kept with the day (report_edits._activity_dropped). The new daily report
 * (release 4) is built from the rows kept. Pure, tested in activity.test.ts.
 */

export type ActivityKind = "listing" | "move" | "done" | "call" | "meeting" | "email" | "work" | "note" | "calendar";

export type ActivityRow = {
  /** Stable for the day, so a dropped row stays dropped ("comm:<id>", "move:<name>:<stage>", "cal:<event id>"). */
  id: string;
  kind: ActivityKind;
  /** The line, in plain words: "Meeting with Mark Reed, 60 min", "Moved Dalton Services to Seller call". */
  text: string;
  /** The deal, job, lead or person it was about, when known. */
  record: string | null;
  /** "9:00" (24-hour, the owner's time zone) when the time is known, for the order. */
  time: string | null;
  href: string | null;
};

export const ACTIVITY_DROPPED_KEY = "_activity_dropped";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  listing: "Listing",
  move: "Moved",
  done: "Done",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  work: "Work",
  note: "Note",
  calendar: "Calendar",
};

/** The dropped ids as saved: strings only, at most 500. */
export function cleanDropped(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x ?? "").slice(0, 200)).filter(Boolean))].slice(0, 500);
}

/** A second row with the same id (the same deal moved to the same stage twice) gets ":2", ":3", so each row has its own Drop. */
export function uniqueIds(rows: ActivityRow[]): ActivityRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.id) ?? 0) + 1;
    seen.set(r.id, n);
    return n === 1 ? r : { ...r, id: `${r.id}:${n}` };
  });
}

/** "14:05" as "2:05 pm" (the way End of day shows times). */
export function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** Rows in the day's order: timed rows first by time, then the rest as given. */
export function sortActivity(rows: ActivityRow[]): ActivityRow[] {
  const timed = rows.filter((r) => r.time).sort((a, b) => (a.time! < b.time! ? -1 : a.time! > b.time! ? 1 : 0));
  return [...timed, ...rows.filter((r) => !r.time)];
}

/** "Moody & Associates" in "Call w/ Moody & Associates re: price", matched as whole words, any case. */
function mentions(title: string, name: string): boolean {
  const n = name.replace(/^00\s+/, "").trim();
  if (n.length < 4) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(title);
}

export type CalendarEventIn = { id: string; title: string; start: string; end: string; kind: "event" | "block"; attendees?: string[] };
export type MatchPerson = { id: string; name: string; email: string | null; href: string };
export type MatchRecord = { id: string; name: string; href: string };

/**
 * The day's calendar events that belong in the activity: an event with a contact among its attendees (by email) or a
 * contact's full name (two words or more) in its title, or a record's name in its title, and every block the app
 * created. Anything else (a dentist, a lease reminder) is left out. One row per event.
 */
export function matchCalendar(events: CalendarEventIn[], people: MatchPerson[], records: MatchRecord[]): ActivityRow[] {
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [String(p.email).trim().toLowerCase(), p]));
  const out: ActivityRow[] = [];
  for (const e of events) {
    const fromEmail = (e.attendees ?? []).map((a) => byEmail.get(a.trim().toLowerCase())).find(Boolean) ?? null;
    const person = fromEmail ?? people.find((p) => p.name.trim().split(/\s+/).length >= 2 && mentions(e.title, p.name)) ?? null;
    const record = records.find((r) => mentions(e.title, r.name)) ?? null;
    if (!person && !record && e.kind !== "block") continue;
    const minutes = Math.max(0, Math.round((Date.parse(`2000-01-01T${e.end}:00Z`) - Date.parse(`2000-01-01T${e.start}:00Z`)) / 60000));
    out.push({
      id: `cal:${e.id}`,
      kind: "calendar",
      text: `${e.title}${minutes ? `, ${minutes} min` : ""}`,
      record: person?.name ?? record?.name ?? null,
      time: e.start,
      href: person?.href ?? record?.href ?? null,
    });
  }
  return out;
}

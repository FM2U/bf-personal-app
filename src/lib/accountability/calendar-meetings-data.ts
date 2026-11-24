import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";
import { ACTIVITY_CALENDAR_KEY, ACTIVITY_DROPPED_KEY, cleanCalendarRows, cleanDropped, type ActivityRow } from "@/lib/accountability/activity";
import { AUTO, calendarEvents, localInstant, planCalendarMeetings, type CalendarEvent, type DayComm } from "@/lib/accountability/calendar-meetings";

/**
 * Calendar meetings on record, the database side (push K, Bram 2026-11-24 3:22 pm;
 * claude/2026-11-24-calendar-meetings-proposal.md; the rules are in calendar-meetings.ts). Run whenever the day's
 * calendar rows are read again (End of day, the report job, the drafts) and when a row is dropped or kept: each
 * calendar event that has ended and is kept gets one meeting on the person's record (and the deal's), a hand-logged
 * meeting with the same person at that time becomes that meeting, and a dropped row's meeting is taken away. Before
 * the database update (no calendar_event_id column) nothing is done.
 */

export type DayCalendar = { ready: boolean; events: CalendarEvent[]; comms: DayComm[]; dropped: Set<string> };

/** The day's communications that can be a meeting, and the marks of the calendar events already on record. */
async function dayComms(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ ready: boolean; comms: DayComm[] }> {
  const from = localInstant(day, "00:00", ctx.tz);
  const to = localInstant(addDaysISO(day, 1), "00:00", ctx.tz);
  const { data, error } = await sb.from("communications").select("id,contact_id,method,occurred_at,call_minutes,calendar_event_id").eq("owner_id", ctx.ownerId).gte("occurred_at", from).lt("occurred_at", to).limit(2000);
  if (error) return { ready: !isMissingSchemaError(error), comms: [] };
  return { ready: true, comms: ((data ?? []) as Row[]).map((c) => ({ id: String(c.id), contactId: c.contact_id ? String(c.contact_id) : null, method: String(c.method), occurredAt: String(c.occurred_at), minutes: c.call_minutes === null || c.call_minutes === undefined ? null : Number(c.call_minutes), calendarEventId: c.calendar_event_id ? String(c.calendar_event_id) : null })) };
}

/** The day's calendar events (from the rows given, or the rows saved with the day), its meetings, and its dropped rows. */
export async function loadDayCalendar(sb: SupabaseClient, ctx: Ctx, day: string, rows?: readonly ActivityRow[]): Promise<DayCalendar> {
  const [{ data: eod }, c] = await Promise.all([sb.from("end_of_day").select("report_edits").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle(), dayComms(sb, ctx, day)]);
  const edits = ((eod as Row | null)?.report_edits ?? {}) as Record<string, unknown>;
  const saved = rows ?? cleanCalendarRows(edits[ACTIVITY_CALENDAR_KEY]);
  return { ready: c.ready, events: calendarEvents(saved, day, ctx.tz), comms: c.comms, dropped: new Set(cleanDropped(edits[ACTIVITY_DROPPED_KEY])) };
}

/**
 * Brings the day's meetings in line with its calendar events. `rows` are the calendar rows just read from Google; left
 * out, the rows saved with the day are used (a Drop or a Keep). Returns true when a meeting was added, marked or taken
 * away.
 */
export async function syncCalendarMeetings(sb: SupabaseClient, ctx: Ctx, day: string, rows?: readonly ActivityRow[]): Promise<boolean> {
  // A day ahead has no ended events; nothing is saved for it.
  if (day > ctx.today) return false;
  const cal = await loadDayCalendar(sb, ctx, day, rows);
  if (!cal.ready) return false;
  const plan = planCalendarMeetings({ events: cal.events, comms: cal.comms, dropped: cal.dropped, now: new Date().toISOString() });
  if (!plan.create.length && !plan.tie.length && !plan.remove.length) return false;
  let changed = false;
  if (plan.remove.length) {
    const { error } = await sb.from("communications").delete().eq("owner_id", ctx.ownerId).in("id", plan.remove).like("calendar_event_id", `${AUTO}%`);
    if (!error) changed = true;
  }
  for (const t of plan.tie) {
    const { error } = await sb.from("communications").update({ calendar_event_id: t.eventId }).eq("owner_id", ctx.ownerId).eq("id", t.commId).is("calendar_event_id", null);
    if (!error) changed = true;
  }
  if (plan.create.length) {
    const ids = [...new Set(plan.create.map((e) => e.contactId).filter((x): x is string => !!x))];
    const { data: people } = ids.length ? await sb.from("contacts").select("id,organization_id").eq("owner_id", ctx.ownerId).in("id", ids) : { data: [] };
    const orgOf = new Map(((people ?? []) as Row[]).map((p) => [String(p.id).toLowerCase(), p.organization_id ? String(p.organization_id) : null]));
    for (const e of plan.create) {
      // A person who is no longer on Contacts: the meeting stays on the deal alone, or is not saved.
      const contactId = e.contactId && orgOf.has(e.contactId) ? e.contactId : null;
      if (!contactId && !e.dealId) continue;
      const { error } = await sb.from("communications").insert({
        owner_id: ctx.ownerId,
        occurred_at: e.start,
        method: "meeting",
        direction: "outgoing",
        contact_id: contactId,
        organization_id: contactId ? orgOf.get(contactId) ?? null : null,
        subject: e.title.slice(0, 300),
        is_outreach: !!contactId,
        purpose: "general",
        pipeline_item_id: e.dealId,
        call_minutes: e.minutes || null,
        calendar_event_id: `${AUTO}${e.eventId}`,
      });
      // A second run at the same moment finds the event already saved (the unique index): not an error.
      if (!error) changed = true;
    }
  }
  return changed;
}

/** The row ids ("cal:<event id>") of the day's calendar events whose meeting was logged by hand (the mark has no "auto:"). */
export function handLoggedRowIds(comms: readonly DayComm[]): Set<string> {
  return new Set(comms.filter((c) => c.calendarEventId && !c.calendarEventId.startsWith(AUTO)).map((c) => `cal:${c.calendarEventId}`));
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { env, isGoogleConfigured } from "@/lib/env";
import { explainGoogleError } from "@/lib/google-errors";
import { calendarPermission } from "@/lib/google-scopes";
import { getGoogleConnection, insertCalendarEvent } from "@/lib/google";
import { DB_UPDATE_NOTICE_PUSH_C, isMissingSchemaError } from "@/lib/schema-guard";
import { loadDayCalendar, type DayCalendar } from "@/lib/work/calendar-data";
import { fromMinutes, toMinutes, zonedToIso } from "@/lib/work/time-blocks";

/**
 * Block time (push C, approved 2026-11-02): the side drawer from the block icon on every Home row. It reads what is
 * already on the chosen day, then "Add to Google Calendar" creates a real event on the owner's primary calendar
 * (with a link back to the record) and keeps the block in time_blocks, so the row shows "Blocked 2:00" under its date
 * and Today's calendar marks it.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Push D: the Monthly review row on Work on now blocks time as "review:2026-10".
const ROW_KEY = /^((deal|person|project|job|consulting|todo):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|review:\d{4}-\d{2})$/i;
const RECORD_TYPES = ["pipeline_items", "contacts", "projects", "organizations", "deal_todos"];

/** What is already on a day (the drawer's "Already on" list when the date changes). */
export async function dayCalendar(date: string): Promise<{ ok: true; calendar: DayCalendar } | Fail> {
  if (!DATE.test(String(date ?? ""))) return fail("Pick a date.");
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  return { ok: true, calendar: await loadDayCalendar(supabase, ownerId, ctx.tz, date) };
}

export type BlockInput = {
  /** The Home row ("deal:<id>", "todo:<id>", ...), so the row shows the block. */
  rowKey: string;
  recordType: string | null;
  recordId: string | null;
  /** The page the event links back to. */
  href: string;
  date: string;
  start: string;
  minutes: number;
  title: string;
};

export async function addTimeBlock(input: BlockInput): Promise<{ ok: true; eventId: string } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const ctx = await loadCtx(sb, ownerId);
  if (!ROW_KEY.test(String(input.rowKey ?? ""))) return fail("This row cannot be blocked.");
  if (!DATE.test(String(input.date ?? ""))) return fail("Pick a date.");
  if (!TIME.test(String(input.start ?? ""))) return fail("Pick a start time.");
  const minutes = Math.round(Number(input.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) return fail("Pick a length.");
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return fail("Give the event a title.");
  const recordType = input.recordType && RECORD_TYPES.includes(input.recordType) ? input.recordType : null;
  const recordId = recordType && /^[0-9a-f-]{36}$/i.test(String(input.recordId ?? "")) ? String(input.recordId) : null;
  const href = String(input.href ?? "").startsWith("/work") ? String(input.href).slice(0, 200) : "/work";

  const conn = await getGoogleConnection(sb, ownerId);
  const perm = isGoogleConfigured() ? calendarPermission(conn) : "not_connected";
  if (perm === "not_connected") return fail("Google is not connected. Connect it under Settings, Connections, then add the block again.");
  if (perm === "reconnect") return fail("Reconnect Google to add blocks to your calendar (Settings, Connections; 1 minute).");

  const endMin = toMinutes(input.start) + minutes;
  const endDate = endMin >= 24 * 60 ? null : input.date;
  if (!endDate) return fail("A block has to end before midnight. Pick an earlier start or a shorter length.");
  const startIso = zonedToIso(input.date, input.start, ctx.tz);
  const endIso = zonedToIso(input.date, fromMinutes(endMin), ctx.tz);

  let eventId: string | null;
  try {
    eventId = await insertCalendarEvent(sb, ownerId, { title, start: startIso, end: endIso, timeZone: ctx.tz, description: `Blocked from BF Personal App: ${env.appUrl}${href}` });
  } catch (e) {
    const x = explainGoogleError(e);
    return fail(x.kind === "no_permission" ? "Google did not allow the app to add events. Reconnect Google in Settings, Connections, and allow the calendar." : `Not added to Google Calendar: ${x.message}`);
  }
  if (!eventId) return fail("Google is not connected. Connect it under Settings, Connections, then add the block again.");
  const { error } = await sb.from("time_blocks").insert({ owner_id: ownerId, row_key: input.rowKey, record_type: recordId ? recordType : null, record_id: recordId, title, starts_at: startIso, ends_at: endIso, google_event_id: eventId });
  if (error) return fail(isMissingSchemaError(error) ? `It is on Google Calendar, but the app could not keep it. ${DB_UPDATE_NOTICE_PUSH_C}` : `It is on Google Calendar, but the app could not keep it: ${error.message}`);
  revalidatePath("/work", "layout");
  return { ok: true, eventId };
}

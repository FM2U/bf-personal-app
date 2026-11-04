import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarPermission } from "@/lib/google-scopes";
import { getGoogleConnection, listCalendarEvents } from "@/lib/google";
import { isGoogleConfigured } from "@/lib/env";
import { dayBounds, isoToZoned, type DayItem } from "@/lib/work/time-blocks";
import type { Row } from "@/lib/types";

/**
 * Today's calendar on Home and "Already on" in Block time (push C, approved 2026-11-02): the day's Google Calendar
 * events plus the app's blocks (blocks marked). Without Google, or without the calendar permission, the status says
 * so and the tile shows a plain note, never an error; the app's own blocks still show.
 */
export type CalendarStatus = "ok" | "reconnect" | "not_connected" | "unavailable";
export type DayCalendar = { date: string; status: CalendarStatus; email: string | null; items: DayItem[] };

const BLOCK_FROM = "Blocked from Next actions";

function localTimes(startIso: string, endIso: string, date: string, tz: string): { start: string; end: string } | null {
  const s = isoToZoned(startIso, tz);
  const e = isoToZoned(endIso, tz);
  if (s.date > date || e.date < date) return null;
  return { start: s.date < date ? "00:00" : s.time, end: e.date > date ? "23:59" : e.time };
}

/** The blocks of a day (time_blocks), oldest first. Empty before the push C update. */
async function dayBlocks(sb: SupabaseClient, ownerId: string, date: string, tz: string): Promise<Row[]> {
  const { start, end } = dayBounds(date, tz);
  const { data, error } = await sb.from("time_blocks").select("id,row_key,title,starts_at,ends_at,google_event_id").eq("owner_id", ownerId).gte("starts_at", start).lt("starts_at", end).order("starts_at").limit(100);
  return error ? [] : ((data ?? []) as Row[]);
}

export async function loadDayCalendar(sb: SupabaseClient, ownerId: string, tz: string, date: string): Promise<DayCalendar> {
  const [conn, blocks] = await Promise.all([getGoogleConnection(sb, ownerId), dayBlocks(sb, ownerId, date, tz)]);
  const perm = isGoogleConfigured() ? calendarPermission(conn) : "not_connected";
  const email = conn?.google_email ? String(conn.google_email) : null;
  const blockByEvent = new Map(blocks.filter((b) => b.google_event_id).map((b) => [String(b.google_event_id), b]));
  const items: DayItem[] = [];
  let status: CalendarStatus = perm === "allowed" ? "ok" : perm;
  const seen = new Set<string>();
  if (perm === "allowed") {
    try {
      const { start, end } = dayBounds(date, tz);
      const events = (await listCalendarEvents(sb, ownerId, start, end)) ?? [];
      for (const e of events) {
        const t = localTimes(e.start, e.end, date, tz);
        if (!t) continue;
        const block = blockByEvent.get(e.id);
        if (block) seen.add(String(block.id));
        items.push({ id: e.id, title: e.title, ...t, kind: block ? "block" : "event", from: block ? BLOCK_FROM : "Google Calendar" });
      }
    } catch (e) {
      const code = Number((e as { code?: unknown; response?: { status?: unknown } })?.response?.status ?? (e as { code?: unknown })?.code);
      status = code === 401 || code === 403 ? "reconnect" : "unavailable";
    }
  }
  // The app's blocks Google did not list (Google not connected, or a block from sample data).
  for (const b of blocks) {
    if (seen.has(String(b.id))) continue;
    const t = localTimes(String(b.starts_at), String(b.ends_at), date, tz);
    if (t) items.push({ id: `block:${b.id}`, title: String(b.title ?? ""), ...t, kind: "block", from: BLOCK_FROM });
  }
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1));
  return { date, status, email, items };
}

/** The next block of each Home row from today on (the "Blocked 2:00" line), by row key. */
export async function loadRowBlocks(sb: SupabaseClient, ownerId: string, tz: string, today: string): Promise<Record<string, { date: string; start: string }>> {
  const { start } = dayBounds(today, tz);
  const { data, error } = await sb.from("time_blocks").select("row_key,starts_at").eq("owner_id", ownerId).gte("starts_at", start).order("starts_at").limit(500);
  if (error) return {};
  const out: Record<string, { date: string; start: string }> = {};
  for (const b of (data ?? []) as Row[]) {
    const k = String(b.row_key);
    if (out[k]) continue;
    const z = isoToZoned(String(b.starts_at), tz);
    out[k] = { date: z.date, start: z.time };
  }
  return out;
}

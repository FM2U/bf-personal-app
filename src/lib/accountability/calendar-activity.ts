import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/engine/helpers";
import type { Row } from "@/lib/types";
import { ACTIVITY_CALENDAR_KEY, cleanCalendarRows, matchCalendar, type ActivityRow } from "@/lib/accountability/activity";
import { editEod } from "@/lib/accountability/eod-write";
import { loadDayCalendar } from "@/lib/work/calendar-data";
import { recordHref } from "@/lib/work/task-records";

/**
 * The day's Google Calendar events that belong in Today's activity (release 3b): those with a contact among the people
 * invited or named in the title, or a record named in the title, and the app's blocks. Personal events are never
 * returned. Release 4 (2026-11-16): the rows are also saved with the day (report_edits._activity_calendar) while the
 * day is open, so the report and the 4:00 pm drafts count a meeting on a deal as work on that deal.
 */
export async function dayCalendarRows(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ status: string; rows: ActivityRow[] }> {
  const [cal, { data: people }, { data: items }] = await Promise.all([
    loadDayCalendar(sb, ctx.ownerId, ctx.tz, day),
    sb.from("contacts").select("id,name,email,relationship_group,outreach_role,purposes").eq("owner_id", ctx.ownerId).is("archived_at", null).limit(5000),
    sb.from("pipeline_items").select("id,name,company_name,pipeline_id").eq("owner_id", ctx.ownerId).eq("status", "open").limit(5000),
  ]);
  // Privacy (2026-11-16): close friends and friends stay out unless they are part of the work (a role or a purpose).
  const persons = ((people ?? []) as Row[]).filter((p) => String(p.name ?? "").trim() && (!["close", "friend"].includes(String(p.relationship_group ?? "")) || !!p.outreach_role || (Array.isArray(p.purposes) && p.purposes.length > 0))).map((p) => ({ id: String(p.id), name: String(p.name), email: p.email ? String(p.email) : null, href: recordHref({ kind: "person", id: String(p.id) }) }));
  const records = ((items ?? []) as Row[]).flatMap((r) => [r.company_name, r.name].filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => ({ id: String(r.id), name: n, href: recordHref({ kind: "deal", id: String(r.id) }) })));
  // A block keeps one id whether Google lists it or not, so a dropped block stays dropped.
  return { status: cal.status, rows: matchCalendar(cal.items.map((e) => ({ id: e.blockId ? `block:${e.blockId}` : e.id, title: e.title, start: e.start, end: e.end, kind: e.kind, attendees: e.attendees ?? [] })), persons, records) };
}

/** Saves the day's calendar rows with the day when they changed (an open day only). True when something was written. */
export async function saveCalendarRows(sb: SupabaseClient, ownerId: string, day: string, rows: ActivityRow[], /** Keep the saved rows and add these (Google not reachable: only the app's blocks came back). */ addOnly = false): Promise<boolean> {
  const r = await editEod(sb, ownerId, day, ({ edits: all }) => {
    const before = cleanCalendarRows(all[ACTIVITY_CALENDAR_KEY]);
    const next = cleanCalendarRows(addOnly ? [...before, ...rows.filter((x) => !before.some((y) => y.id === x.id))] : rows);
    if (JSON.stringify(before) === JSON.stringify(next)) return null;
    if (next.length) all[ACTIVITY_CALENDAR_KEY] = next;
    else delete all[ACTIVITY_CALENDAR_KEY];
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  return r.ok && r.wrote;
}

/**
 * Reads the day's calendar and saves the matching rows with the day. When Google cannot be reached the saved rows
 * are kept and the app's own blocks are added (a disconnected calendar never empties the report).
 */
export async function refreshCalendarActivity(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ status: string; rows: ActivityRow[]; saved: boolean }> {
  const c = await dayCalendarRows(sb, ctx, day);
  // Without Google the app's own blocks still come back: they are added, and nothing saved before is taken away.
  if (c.status !== "ok" && !c.rows.length) return { ...c, saved: false };
  const saved = await saveCalendarRows(sb, ctx.ownerId, day, c.rows, c.status !== "ok").catch(() => false);
  return { ...c, saved };
}

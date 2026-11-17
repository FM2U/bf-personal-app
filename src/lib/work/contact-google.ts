import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchCalendar } from "@/lib/accountability/activity";
import { isValidEmail } from "@/lib/email-address";
import { isGoogleConfigured } from "@/lib/env";
import { date as fmtDate } from "@/lib/format";
import { getGoogleConnection, googleAuth, searchCalendarEvents, searchGmailThreads } from "@/lib/google";
import { calendarPermission, replyPermission } from "@/lib/google-scopes";
import { isoToZoned } from "@/lib/work/time-blocks";
import type { ContactExtras, TimelineEvent } from "@/lib/work/timeline";
import type { Row } from "@/lib/types";

/**
 * Contact timelines (release 3c, Bram 2026-11-16): the person's meetings on Google Calendar (the last 180 days and
 * the next 60: an event that invites their email or has their full name in its title) and their Gmail threads (to,
 * from or copying their address; the latest 10, or 50 with `all`), read-only and never stored. Threads the app already
 * logged (emails sent from the app, reports) are left out before any thread is opened, so nothing shows twice. Served
 * by GET /api/contacts/<id>/google after the page shows (a route, not a server action, so it never holds up Add a
 * note or Log a call); every Google read stops after 8 seconds.
 */
export async function loadContactExtras(sb: SupabaseClient, ownerId: string, tz: string, contactId: string, opts: { all?: boolean; gmailOnly?: boolean } = {}): Promise<ContactExtras | null> {
  const { data: p } = await sb.from("contacts").select("id,name,email").eq("owner_id", ownerId).eq("id", contactId).maybeSingle();
  const person = p as Row | null;
  if (!person) return null;
  const email = String(person.email ?? "").trim().toLowerCase();
  const name = String(person.name ?? "").trim();
  const conn = isGoogleConfigured() ? await getGoogleConnection(sb, ownerId) : null;
  const calPerm = conn ? calendarPermission(conn) : "not_connected";
  const readPerm = conn ? replyPermission(conn) : "not_connected";
  let calendar: ContactExtras["calendar"] = opts.gmailOnly ? "ok" : calPerm === "allowed" ? "ok" : calPerm === "reconnect" ? "reconnect" : "off";
  let gmail: ContactExtras["gmail"] = !email || !isValidEmail(email) ? "no_email" : readPerm === "allowed" ? "ok" : readPerm === "reconnect" ? "reconnect" : "off";
  const auth = calendar === "ok" || gmail === "ok" ? await googleAuth(sb, ownerId) : null;
  if (!auth) {
    if (calendar === "ok" && !opts.gmailOnly) calendar = "off";
    if (gmail === "ok") gmail = "off";
  }
  const events: TimelineEvent[] = [];
  const day = (iso: string) => fmtDate(isoToZoned(iso, tz).date, "MMM d");
  // Reconnect only when Google says the permission is missing; a busy Google (also a 403) is "could not be read".
  const problem = (e: unknown): "reconnect" | "unavailable" => {
    const err = e as { code?: unknown; response?: { status?: unknown; data?: { error?: { errors?: { reason?: string }[]; status?: string } } } };
    const code = Number(err?.response?.status ?? err?.code);
    const reasons = (err?.response?.data?.error?.errors ?? []).map((x) => x.reason);
    return code === 401 || (code === 403 && (reasons.includes("insufficientPermissions") || err?.response?.data?.error?.status === "PERMISSION_DENIED")) ? "reconnect" : "unavailable";
  };
  let more = false;
  const calP = (async () => {
    if (opts.gmailOnly || calendar !== "ok" || !auth) return;
    try {
      const min = new Date(Date.now() - 180 * 86400e3).toISOString();
      const max = new Date(Date.now() + 60 * 86400e3).toISOString();
      const qs = [email, name.split(/\s+/).length >= 2 ? name : ""].filter(Boolean);
      const found = (await Promise.all(qs.map((q) => searchCalendarEvents(auth, q, min, max)))).flat();
      const byId = new Map(found.map((e) => [e.id, e]));
      const hits = matchCalendar([...byId.values()].map((e) => ({ id: e.id, title: e.title, start: isoToZoned(e.start, tz).time, end: isoToZoned(e.end, tz).time, kind: "event" as const, attendees: e.attendees ?? [] })), [{ id: String(person.id), name, email: email || null, href: "" }], []);
      for (const h of hits) {
        const e = byId.get(h.id.slice(4))!;
        events.push({ id: `gcal:${e.id}`, kind: "call", when: new Date(e.start).toISOString(), date: day(e.start), title: `Calendar: ${h.text}`, detail: Date.parse(e.start) > Date.now() ? "Upcoming" : null, href: null, source: "calendar" });
      }
    } catch (e) {
      calendar = problem(e);
    }
  })();
  const mailP = (async () => {
    if (gmail !== "ok" || !auth) return;
    try {
      const { data: logged } = await sb.from("communications").select("gmail_thread_id").eq("owner_id", ownerId).eq("contact_id", person.id).not("gmail_thread_id", "is", null).limit(500);
      const known = new Set(((logged ?? []) as Row[]).map((r) => String(r.gmail_thread_id)));
      const limit = opts.all ? 50 : 10;
      const threads = await searchGmailThreads(auth, email, limit, known);
      more = !opts.all && threads.length >= limit;
      const account = conn?.google_email ? encodeURIComponent(String(conn.google_email)) : "0";
      for (const t of threads) events.push({ id: `gmail:${t.id}`, kind: "email", when: t.at, date: day(t.at), title: `Gmail: ${t.subject}${t.count > 1 ? ` (${t.count} messages)` : ""}`, detail: t.snippet || null, href: null, link: { href: `https://mail.google.com/mail/?authuser=${account}#all/${t.id}`, label: "Open in Gmail" }, source: "gmail" });
    } catch (e) {
      gmail = problem(e);
    }
  })();
  await Promise.all([calP, mailP]);
  return { ok: true, calendar, gmail, events, more };
}

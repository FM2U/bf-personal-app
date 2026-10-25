import "server-only";
import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { env, isGoogleConfigured } from "@/lib/env";
import type { Row } from "@/lib/types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function oauthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, `${env.appUrl}/api/google/callback`);
}

export async function getGoogleConnection(sb: SupabaseClient, ownerId: string): Promise<Row | null> {
  const { data } = await sb.from("google_connections").select("*").eq("owner_id", ownerId).maybeSingle();
  return (data as Row | null) ?? null;
}

async function authed(sb: SupabaseClient, ownerId: string) {
  if (!isGoogleConfigured()) return null;
  const conn = await getGoogleConnection(sb, ownerId);
  if (!conn?.refresh_token_enc || conn.status === "disconnected") return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(conn.refresh_token_enc) });
  return client;
}

/** Offset such as "-04:00" for a time zone on a date. */
export function tzOffset(tz: string, dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

export function localDateTime(dateIso: string, hour: number, minute: number, tz: string): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${dateIso}T${hh}:${mm}:00${tzOffset(tz, dateIso)}`;
}

/** Creates a draft in Gmail. Bram reviews and presses send. Returns the draft id, or null when Google is not connected. */
export async function createGmailDraft(sb: SupabaseClient, ownerId: string, msg: { to: string; subject: string; body: string }): Promise<string | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth });
  const encodedSubject = `=?UTF-8?B?${Buffer.from(msg.subject, "utf8").toString("base64")}?=`;
  const raw = [`To: ${msg.to}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", msg.body].join("\r\n");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: Buffer.from(raw, "utf8").toString("base64url") } },
  });
  return res.data.id ?? null;
}

export async function createCalendarEvent(
  sb: SupabaseClient,
  ownerId: string,
  ev: { summary: string; description?: string; start: string; end: string },
): Promise<string | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: { summary: ev.summary, description: ev.description, start: { dateTime: ev.start }, end: { dateTime: ev.end } },
  });
  return res.data.id ?? null;
}

export type MeetingItem = { id: string; title: string; start: string | null; end: string | null; allDay: boolean; link: string | null };

export async function listEventsForDay(sb: SupabaseClient, ownerId: string, dateIso: string, tz: string): Promise<MeetingItem[] | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: localDateTime(dateIso, 0, 0, tz),
    timeMax: localDateTime(dateIso, 23, 59, tz),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    title: e.summary ?? "(No title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: !e.start?.dateTime,
    link: e.htmlLink ?? null,
  }));
}

/** Confirms the saved Google access still works. */
export async function checkGoogle(sb: SupabaseClient, ownerId: string): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const conn = await getGoogleConnection(sb, ownerId);
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return { ok: true, skipped: true };
  if (!isGoogleConfigured()) return { ok: false, error: "Google client ID, secret, or encryption key is missing on the server." };
  try {
    const auth = await authed(sb, ownerId);
    if (!auth) return { ok: false, error: "No saved Google access." };
    await auth.getAccessToken();
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.calendarList.list({ maxResults: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

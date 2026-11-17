import "server-only";
import { google } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { env, isGoogleConfigured } from "@/lib/env";
import type { Row } from "@/lib/types";
import { gmailRaw, type MimeAttachment } from "@/lib/gmail-mime";
import { loadSignature } from "@/lib/signature-store";
import { sanitizeSignatureHtml, signatureHtmlToText } from "@/lib/email-signature";

export { GOOGLE_SCOPES, GMAIL_SEND_SCOPE, GMAIL_SETTINGS_SCOPE } from "@/lib/google-scopes";
import type { GmailThreadMessage } from "@/lib/gmail-replies";
import { oncePerPage } from "@/lib/request-once";
import { TIMING_ON, timeGoogle } from "@/lib/timing";

/** An email the app sends or drafts. includeSignature: true or false from the checkbox; omitted uses the setting. */
/** body: the plain text; bodyHtml: the formatted editor's HTML when the message was written there (see gmail-mime). */
/** html: the app's own visual HTML (partner reports); attachments: files such as the report PDF (see gmail-mime). */
type AppEmail = { to: string; subject: string; body: string; bodyHtml?: string | null; html?: string | null; attachments?: MimeAttachment[] | null; includeSignature?: boolean };

/** The signature to add to this email, or null (none saved, the setting is off, or unchecked for this email). */
async function signatureFor(sb: SupabaseClient, ownerId: string, include: boolean | undefined): Promise<{ html: string; text: string } | null> {
  if (include === false) return null;
  const sig = await loadSignature(sb, ownerId);
  if (!sig) return null;
  if (include === undefined && !sig.on) return null;
  return { html: sig.html, text: sig.text };
}

/**
 * LOCAL TESTING ONLY: GOOGLE_API_MOCK_URL points every Google call (sign-in, token, Gmail, Calendar) at the
 * stand-in in dev-tools/mock-supabase.mjs. It is honored only for a localhost address, so it can never redirect
 * production traffic.
 */
function mockBase(): string | null {
  const raw = process.env.GOOGLE_API_MOCK_URL ?? "";
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(raw) ? raw.replace(/\/+$/, "") : null;
}

function apiOptions(): { rootUrl?: string } {
  const m = mockBase();
  return m ? { rootUrl: `${m}/` } : {};
}

export function oauthClient() {
  const m = mockBase();
  return new google.auth.OAuth2({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: `${env.appUrl}/api/google/callback`,
    ...(m ? { endpoints: { oauth2AuthBaseUrl: `${m}/o/oauth2/v2/auth`, oauth2TokenUrl: `${m}/token`, oauth2RevokeUrl: `${m}/revoke` } } : {}),
  });
}

export async function getGoogleConnection(sb: SupabaseClient, ownerId: string): Promise<Row | null> {
  // Page speed (2026-11-06): once per page build (Home asks from several parts).
  const { data } = await oncePerPage(`google_connection:${ownerId}`, () => sb.from("google_connections").select("*").eq("owner_id", ownerId).maybeSingle());
  return (data as Row | null) ?? null;
}

async function authed(sb: SupabaseClient, ownerId: string) {
  if (!isGoogleConfigured()) return null;
  const conn = await getGoogleConnection(sb, ownerId);
  if (!conn?.refresh_token_enc || conn.status === "disconnected") return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(conn.refresh_token_enc) });
  // Speed line (2026-11-07, preview only): every app call to Google first fetches a new access token. The library
  // does that inside the first request anyway; fetching it here first times it on its own ("token" in the log).
  if (TIMING_ON) await timeGoogle("token", () => client.getAccessToken());
  return client;
}



/** Creates a draft in Gmail. Bram reviews and presses send. Returns the draft id, or null when Google is not connected. */
export async function createGmailDraft(sb: SupabaseClient, ownerId: string, msg: AppEmail): Promise<string | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth, ...apiOptions() });
  const signature = await signatureFor(sb, ownerId, msg.includeSignature);
  const res = await timeGoogle("gmail draft", () => gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: gmailRaw({ to: msg.to, subject: msg.subject, body: msg.body, bodyHtml: msg.bodyHtml ?? null, html: msg.html ?? null, attachments: msg.attachments ?? null, signature }, { requireValidTo: false }) } },
  }));
  return res.data.id ?? null;
}

/**
 * Sends one email from the connected Gmail account (users.messages.send). Gmail puts it in Sent.
 * Called only after Bram confirms in the "Send email" dialog. Returns null when Google is not connected.
 * Throws Google's error (explain it with explainGoogleError).
 */
export async function sendGmailMessage(
  sb: SupabaseClient,
  ownerId: string,
  msg: AppEmail & { threadId?: string | null; inReplyTo?: string | null },
): Promise<{ id: string; threadId: string | null } | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth, ...apiOptions() });
  const signature = await signatureFor(sb, ownerId, msg.includeSignature);
  const res = await timeGoogle("gmail send", () => gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: gmailRaw({ to: msg.to, subject: msg.subject, body: msg.body, bodyHtml: msg.bodyHtml ?? null, html: msg.html ?? null, attachments: msg.attachments ?? null, inReplyTo: msg.inReplyTo, signature }), ...(msg.threadId ? { threadId: msg.threadId } : {}) },
  }));
  if (!res.data.id) throw new Error("Gmail did not return a message id.");
  return { id: res.data.id, threadId: res.data.threadId ?? null };
}

/**
 * Reads the Gmail signature (users.settings.sendAs.list): the send-as address that matches the connected account,
 * otherwise the default one. Returns it sanitized with its plain text. Null when Google is not connected.
 * Throws Google's error (explain it with explainGoogleError).
 */
export async function fetchGmailSignature(sb: SupabaseClient, ownerId: string): Promise<{ html: string; text: string; address: string | null } | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const conn = await getGoogleConnection(sb, ownerId);
  const connected = String(conn?.google_email ?? "").trim().toLowerCase();
  const gmail = google.gmail({ version: "v1", auth, ...apiOptions() });
  const res = await timeGoogle("gmail signature", () => gmail.users.settings.sendAs.list({ userId: "me" }));
  const list = res.data.sendAs ?? [];
  const pick =
    (connected ? list.find((s) => String(s.sendAsEmail ?? "").toLowerCase() === connected) : undefined) ??
    list.find((s) => s.isDefault) ??
    list.find((s) => s.isPrimary) ??
    list[0];
  const html = sanitizeSignatureHtml(String(pick?.signature ?? ""));
  return { html, text: signatureHtmlToText(html), address: pick?.sendAsEmail ?? null };
}


/**
 * Reads one Gmail thread the app started (users.threads.get): the messages with their headers and text, for the
 * reply check (push B). Only threads whose id the app stored when it sent something are ever asked for. Null when
 * Google is not connected; a thread that is gone (deleted in Gmail) comes back empty. Throws Google's other errors.
 */
export async function getGmailThread(sb: SupabaseClient, ownerId: string, threadId: string): Promise<GmailThreadMessage[] | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const gmail = google.gmail({ version: "v1", auth, ...apiOptions() });
  try {
    const res = await timeGoogle("gmail thread", () => gmail.users.threads.get({ userId: "me", id: threadId, format: "full" }));
    return (res.data.messages ?? []) as GmailThreadMessage[];
  } catch (e) {
    const status = Number((e as { code?: unknown; response?: { status?: unknown } })?.response?.status ?? (e as { code?: unknown })?.code);
    if (status === 404) return [];
    throw e;
  }
}

/** One event of a day from Google Calendar (push C): its id, title, and start and end as ISO instants (all-day events are left out). */
export type CalendarEvent = { id: string; title: string; start: string; end: string; /** The other people invited, by email, lower case (Today's activity, 2026-11-16). */ attendees?: string[] };

/**
 * The events on the owner's primary calendar between two instants (Today's calendar on Home, "Already on" in Block
 * time). Null when Google is not connected. Throws Google's error.
 */
export async function listCalendarEvents(sb: SupabaseClient, ownerId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[] | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth, ...apiOptions() });
  const res = await timeGoogle("calendar events", () => calendar.events.list({ calendarId: "primary", timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 100 }));
  return (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled" && !!e.start?.dateTime && !!e.end?.dateTime)
    .map((e) => ({ id: String(e.id ?? ""), title: String(e.summary ?? "(No title)"), start: String(e.start!.dateTime), end: String(e.end!.dateTime), attendees: (e.attendees ?? []).filter((a) => !a.self && a.email).map((a) => String(a.email).toLowerCase()) }));
}

/** Creates one event on the owner's primary calendar (Block time, push C). Returns its id, or null when Google is not connected. Throws Google's error. */
export async function insertCalendarEvent(sb: SupabaseClient, ownerId: string, ev: { title: string; start: string; end: string; timeZone: string; description?: string | null }): Promise<string | null> {
  const auth = await authed(sb, ownerId);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth, ...apiOptions() });
  const res = await timeGoogle("calendar insert", () => calendar.events.insert({ calendarId: "primary", requestBody: { summary: ev.title, description: ev.description ?? undefined, start: { dateTime: ev.start, timeZone: ev.timeZone }, end: { dateTime: ev.end, timeZone: ev.timeZone } } }));
  if (!res.data.id) throw new Error("Google Calendar did not return an event id.");
  return res.data.id;
}

/** Confirms the saved Google access still works. */
export async function checkGoogle(sb: SupabaseClient, ownerId: string): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const conn = await getGoogleConnection(sb, ownerId);
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return { ok: true, skipped: true };
  if (!isGoogleConfigured()) return { ok: false, error: "Google client ID, secret, or encryption key is missing on the server." };
  try {
    const auth = await authed(sb, ownerId);
    if (!auth) return { ok: false, error: "No saved Google access." };
    if (!TIMING_ON) await auth.getAccessToken();
    const calendar = google.calendar({ version: "v3", auth, ...apiOptions() });
    await timeGoogle("calendar check", () => calendar.calendarList.list({ maxResults: 1 }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}



/** One signed-in Google client for several reads in a row (contact timelines, release 3c). Null when not connected. */
export async function googleAuth(sb: SupabaseClient, ownerId: string) {
  return authed(sb, ownerId);
}
type GoogleAuth = NonNullable<Awaited<ReturnType<typeof authed>>>;

/** Each Google read for a contact's timeline stops after this long, so a slow Google never holds the page. */
const TIMELINE_TIMEOUT_MS = 8000;

/**
 * Contact timelines (release 3c, Bram 2026-11-16): the events on the owner's primary calendar between two instants
 * that Google's search matches to the words (a contact's email or name; Google searches titles, descriptions and the
 * people invited), newest window first, up to 250. Throws Google's error.
 */
export async function searchCalendarEvents(auth: GoogleAuth, q: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const calendar = google.calendar({ version: "v3", auth, ...apiOptions() });
  const res = await timeGoogle("calendar search", () => calendar.events.list({ calendarId: "primary", q, timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 250 }, { timeout: TIMELINE_TIMEOUT_MS }));
  return (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled" && !!e.start?.dateTime && !!e.end?.dateTime)
    .map((e) => ({ id: String(e.id ?? ""), title: String(e.summary ?? "(No title)"), start: String(e.start!.dateTime), end: String(e.end!.dateTime), attendees: (e.attendees ?? []).filter((a) => !a.self && a.email).map((a) => String(a.email).toLowerCase()) }));
}

export type GmailThreadSummary = { id: string; subject: string; at: string; snippet: string; count: number };

/**
 * Contact timelines (release 3c): the latest Gmail threads to, from or copying one address, read-only (subject, the
 * latest message's date and first line). Threads in `skip` (already on the timeline from the app) are left out before
 * any thread is opened; threads are opened 10 at a time, which stays inside Gmail's per-second limit. Nothing is
 * stored. Throws Google's error.
 */
export async function searchGmailThreads(auth: GoogleAuth, email: string, max: number, skip: Set<string>): Promise<GmailThreadSummary[]> {
  const gmail = google.gmail({ version: "v1", auth, ...apiOptions() });
  const q = `from:"${email}" OR to:"${email}" OR cc:"${email}"`;
  const list = await timeGoogle("gmail search", () => gmail.users.threads.list({ userId: "me", q, maxResults: Math.min(100, max * 3) }, { timeout: TIMELINE_TIMEOUT_MS }));
  const ids = (list.data.threads ?? []).map((t) => String(t.id ?? "")).filter((id) => id && !skip.has(id)).slice(0, max);
  const out: GmailThreadSummary[] = [];
  for (let n = 0; n < ids.length; n += 10) {
    const batch = await Promise.all(
      ids.slice(n, n + 10).map(async (id) => {
        try {
          const t = await timeGoogle("gmail thread", () => gmail.users.threads.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject", "Date"] }, { timeout: TIMELINE_TIMEOUT_MS }));
          const msgs = t.data.messages ?? [];
          const last = msgs[msgs.length - 1];
          const first = msgs[0];
          const header = (m: typeof first, name: string) => String(m?.payload?.headers?.find((h) => String(h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "");
          const at = last?.internalDate ? new Date(Number(last.internalDate)).toISOString() : new Date(header(last, "Date") || Date.now()).toISOString();
          return { id, subject: header(first, "Subject") || "(No subject)", at, snippet: String(last?.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 160), count: msgs.length };
        } catch {
          return null;
        }
      }),
    );
    out.push(...batch.filter((x): x is GmailThreadSummary => !!x));
  }
  return out;
}

/** Google permissions the app asks for, and the checks for "Sending from the app: allowed" and the Gmail signature. */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Reads Gmail settings, used only to copy the signature (users.settings.sendAs.list). */
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
/**
 * Reads Gmail (push B), used only to look in the threads of what the app sent (End of day reports, emails sent from
 * the app) for replies. Other mail is never read into the app.
 */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.compose",
  GMAIL_SEND_SCOPE,
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  GMAIL_SETTINGS_SCOPE,
  GMAIL_READ_SCOPE,
];

/** The saved scopes as a list (Google returns them separated by spaces). */
function scopeList(scopes: string | null | undefined): string[] {
  return String(scopes ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True only when the saved connection lists gmail.send (or full Gmail access).
 * A connection saved before this permission was asked for (no scopes saved, or scopes without gmail.send)
 * counts as not allowed until Google is reconnected.
 */
export function canSendFromScopes(scopes: string | null | undefined): boolean {
  const list = scopeList(scopes);
  return list.includes(GMAIL_SEND_SCOPE) || list.includes("https://mail.google.com/");
}

/** True only when the saved connection lists gmail.settings.basic (or full Gmail access): the signature can be read. */
export function canReadSignatureFromScopes(scopes: string | null | undefined): boolean {
  const list = scopeList(scopes);
  return list.includes(GMAIL_SETTINGS_SCOPE) || list.includes("https://mail.google.com/");
}

/** True only when the saved connection can read Gmail threads (gmail.readonly, gmail.modify, or full Gmail access). */
export function canReadRepliesFromScopes(scopes: string | null | undefined): boolean {
  const list = scopeList(scopes);
  return list.includes(GMAIL_READ_SCOPE) || list.includes("https://www.googleapis.com/auth/gmail.modify") || list.includes("https://mail.google.com/");
}

export type SendPermission = "allowed" | "reconnect" | "not_connected";

/** Reading replies for the saved connection: allowed, reconnect needed (connected before push B), or not connected. */
export function replyPermission(conn: { status?: string | null; refresh_token_enc?: string | null; scopes?: string | null } | null | undefined): SendPermission {
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return "not_connected";
  return canReadRepliesFromScopes(conn.scopes) ? "allowed" : "reconnect";
}

/** The note shown where replies would be (Reports, a partner's page) when Google must be reconnected first. */
export const RECONNECT_FOR_REPLIES = "Reconnect Google to see replies (Settings, Connections; 1 minute).";

/** What Settings and the Send now button show for a saved connection row. */
export function sendPermission(conn: { status?: string | null; refresh_token_enc?: string | null; scopes?: string | null } | null | undefined): SendPermission {
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return "not_connected";
  return canSendFromScopes(conn.scopes) ? "allowed" : "reconnect";
}

/**
 * "Copy from Gmail" for the saved connection: allowed, reconnect needed (connected before the signature permission
 * was asked for), or not connected. Sending and drafts keep working while it is "reconnect".
 */
export function signaturePermission(conn: { status?: string | null; refresh_token_enc?: string | null; scopes?: string | null } | null | undefined): SendPermission {
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return "not_connected";
  return canReadSignatureFromScopes(conn.scopes) ? "allowed" : "reconnect";
}

/** The one message shown on the Google card when Reconnect is needed (null when nothing is missing). */
export function reconnectMessage(send: SendPermission, signature: SendPermission, replies: SendPermission = "allowed"): string | null {
  if (send === "reconnect") return "Reconnect Google to allow sending from the app (1 minute).";
  if (send === "allowed" && signature === "reconnect") return "Reconnect Google to use your Gmail signature (1 minute).";
  if (send === "allowed" && replies === "reconnect") return "Reconnect Google to see replies to your reports and emails (1 minute).";
  return null;
}

/** Where Connect or Reconnect returns to: connected, or which permission was left unchecked on Google's screen. */
export function connectResult(scopes: string | null | undefined): "connected" | "connected_no_send" | "connected_no_signature" | "connected_no_replies" {
  if (!canSendFromScopes(scopes)) return "connected_no_send";
  if (!canReadSignatureFromScopes(scopes)) return "connected_no_signature";
  if (!canReadRepliesFromScopes(scopes)) return "connected_no_replies";
  return "connected";
}

/**
 * Scopes to save after Connect or Reconnect: exactly what Google says it granted now (a permission unchecked on
 * Google's screen is not kept). Only when Google returns no list are the scopes saved before kept.
 */
export function scopesAfterConnect(granted: string | null | undefined, previous: string | null | undefined): string | null {
  const list = scopeList(granted);
  if (list.length) return [...new Set(list)].join(" ");
  const prev = scopeList(previous);
  return prev.length ? prev.join(" ") : null;
}

/** Push C: reading the day's events (Today's calendar on Home, "Already on" in Block time) needs a calendar scope. */
export const CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Today's calendar and Block time for the saved connection: allowed, reconnect needed, or not connected. */
export function calendarPermission(conn: { status?: string | null; refresh_token_enc?: string | null; scopes?: string | null } | null | undefined): SendPermission {
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return "not_connected";
  const list = scopeList(conn.scopes);
  const full = list.includes("https://www.googleapis.com/auth/calendar");
  return full || (list.includes(CALENDAR_READ_SCOPE) && list.includes(CALENDAR_EVENTS_SCOPE)) ? "allowed" : "reconnect";
}

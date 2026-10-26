/** Google permissions the app asks for, and the check for "Sending from the app: allowed". */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.compose",
  GMAIL_SEND_SCOPE,
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** The saved scopes as a list (Google returns them separated by spaces). */
export function scopeList(scopes: string | null | undefined): string[] {
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

export type SendPermission = "allowed" | "reconnect" | "not_connected";

/** What Settings and the Send now button show for a saved connection row. */
export function sendPermission(conn: { status?: string | null; refresh_token_enc?: string | null; scopes?: string | null } | null | undefined): SendPermission {
  if (!conn || conn.status === "disconnected" || !conn.refresh_token_enc) return "not_connected";
  return canSendFromScopes(conn.scopes) ? "allowed" : "reconnect";
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

/** Turns an error from Google (Gmail or the sign-in service) into one plain English sentence plus Google's own words. */

export type GoogleErrorKind = "reconnect" | "no_permission" | "bad_address" | "limit" | "network" | "google_down" | "other";

export type ExplainedGoogleError = { kind: GoogleErrorKind; message: string; googleText: string | null };

type AnyErr = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown; data?: unknown };
};

function googleTextOf(e: AnyErr): string | null {
  const data = e?.response?.data as { error?: unknown; error_description?: unknown } | undefined;
  if (data && typeof data === "object") {
    if (typeof data.error_description === "string") return data.error_description;
    const err = data.error as { message?: unknown } | string | undefined;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  }
  return typeof e?.message === "string" && e.message ? e.message : null;
}

export function explainGoogleError(err: unknown): ExplainedGoogleError {
  const e = (err ?? {}) as AnyErr;
  const status = Number(e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : NaN));
  const code = typeof e.code === "string" ? e.code : "";
  const text = googleTextOf(e);
  const lower = `${text ?? ""} ${JSON.stringify(e.response?.data ?? "")}`.toLowerCase();
  const out = (kind: GoogleErrorKind, message: string): ExplainedGoogleError => ({ kind, message, googleText: text });

  if (lower.includes("invalid_grant") || lower.includes("token has been expired or revoked") || status === 401)
    return out("reconnect", "Google no longer accepts the app's saved access. Reconnect Google in Settings, Connections, then try again.");
  if (lower.includes("insufficient") || lower.includes("scope") || (status === 403 && lower.includes("permission")))
    return out("no_permission", "Google did not allow the app to send this email. Reconnect Google in Settings, Connections, and allow sending.");
  if (status === 429 || lower.includes("rate limit") || lower.includes("quota") || lower.includes("ratelimitexceeded"))
    return out("limit", "Gmail's sending limit was reached. Wait a while and try again, or save it to Gmail drafts.");
  if (status === 400 && (lower.includes("recipient") || lower.includes("invalid to") || lower.includes("address")))
    return out("bad_address", "Gmail did not accept the To address. Check the contact's email address.");
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(code) || lower.includes("fetch failed") || lower.includes("network"))
    return out("network", "The app could not reach Google. Try again in a minute.");
  if (status >= 500) return out("google_down", "Gmail had a problem on its side. Try again in a few minutes.");
  return out("other", "Gmail did not send the email.");
}

/**
 * The sign-in messages (push B, 2026-11-03), pure and tested in src/lib/auth-errors.test.ts. Supabase answers a failed
 * sign-in with an error code (newer versions) and a message (every version); each kind gets one plain sentence.
 */
type AuthErrorLike = { code?: unknown; status?: unknown; message?: unknown } | null | undefined;

export const SIGN_IN_MESSAGES = {
  wrong: "Email or password is not correct.",
  notConfirmed: "Your email is not confirmed yet. Open the confirmation email from Supabase, then sign in.",
  tooMany: "Too many sign-in tries in a short time. Wait a few minutes, then try again.",
  other: "Sign-in did not work just now. Try again in a minute.",
} as const;

/** The message the sign-in page shows for a Supabase sign-in error. */
export function signInErrorMessage(err: AuthErrorLike): string {
  const code = String(err?.code ?? "").toLowerCase();
  const status = Number(err?.status ?? NaN);
  const message = String(err?.message ?? "").toLowerCase();
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return SIGN_IN_MESSAGES.notConfirmed;
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) return SIGN_IN_MESSAGES.wrong;
  if (status === 429 || code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many") || message.includes("for security purposes")) return SIGN_IN_MESSAGES.tooMany;
  return SIGN_IN_MESSAGES.other;
}

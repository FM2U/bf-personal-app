/**
 * One plain email address check, shared by the browser (the compose box) and the server (gmail-mime, send).
 * No Node-only code here, so client components can import it.
 */

const EMAIL_RE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** True for one plain email address such as name@example.com. */
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(String(s ?? "").trim());
}

/** The message shown under the To field, or null when the address can be used. */
export function emailAddressProblem(s: string | null | undefined): string | null {
  const v = String(s ?? "").trim();
  if (!v) return "Type an email address.";
  if (/[,;\s]/.test(v) && v.includes("@")) return "Type one email address only.";
  if (!isValidEmail(v)) return "This is not a valid email address. Example: name@example.com";
  return null;
}

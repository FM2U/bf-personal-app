/**
 * Builds the email the app hands to Gmail (users.drafts.create and users.messages.send).
 * Plain text only: the app's drafts have always been plain text, so no HTML part is added.
 * - Subject: kept as plain ASCII when it is plain ASCII; otherwise RFC 2047 encoded words (UTF-8, base64),
 *   split so each word stays under 76 characters and no character is cut in half.
 * - Body: line breaks become CRLF (\r\n), encoded as base64 in 76-character lines (UTF-8 safe).
 * - Header values never carry a line break (no header injection).
 */

export type MimeInput = {
  to: string;
  subject: string;
  body: string;
  /** For a reply: the Message-ID header of the message being answered (adds In-Reply-To and References). */
  inReplyTo?: string | null;
};

const EMAIL_RE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** True for one plain email address such as name@example.com. */
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(String(s ?? "").trim());
}

/** Removes line breaks and control characters from a header value. */
export function cleanHeaderValue(s: string): string {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

/** Encodes a header value (Subject) for email. ASCII stays readable; anything else becomes encoded words. */
export function encodeHeaderValue(value: string): string {
  const v = cleanHeaderValue(value);
  // Printable ASCII, no "=?" (which would look like an encoded word), and short enough for one line.
  if (/^[\x20-\x7e]*$/.test(v) && !v.includes("=?") && v.length <= 900) return v;
  // Each encoded word: "=?UTF-8?B?" + base64(<= 45 bytes = 60 chars) + "?=" = 72 characters.
  const words: string[] = [];
  let chunk = "";
  for (const ch of Array.from(v)) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk || !words.length) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** Line breaks in any form (\r\n, \r, \n) become \r\n. */
export function normalizeLineBreaks(s: string): string {
  return String(s ?? "").replace(/\r\n|\r|\n/g, "\r\n");
}

function base64Lines(s: string): string {
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return (b64.match(/.{1,76}/g) ?? [""]).join("\r\n");
}

/** The full message (RFC 5322) as a string. */
export function buildMimeMessage(msg: MimeInput, opts: { requireValidTo?: boolean } = {}): string {
  const to = cleanHeaderValue(msg.to);
  if (opts.requireValidTo !== false && !isValidEmail(to)) throw new Error(`"${to}" is not a valid email address.`);
  const headers = [`To: ${to}`, `Subject: ${encodeHeaderValue(msg.subject)}`, "MIME-Version: 1.0"];
  const replyTo = msg.inReplyTo ? cleanHeaderValue(msg.inReplyTo) : "";
  if (replyTo) headers.push(`In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
  headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
  return `${headers.join("\r\n")}\r\n\r\n${base64Lines(normalizeLineBreaks(msg.body))}\r\n`;
}

/** The message in the form the Gmail API expects in "raw" (base64url). */
export function gmailRaw(msg: MimeInput, opts: { requireValidTo?: boolean } = {}): string {
  return Buffer.from(buildMimeMessage(msg, opts), "utf8").toString("base64url");
}

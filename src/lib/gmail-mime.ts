/**
 * Builds the email the app hands to Gmail (users.drafts.create and users.messages.send).
 * multipart/alternative with two parts: text/plain (the message, then "-- " and the plain signature) and text/html
 * (the message as HTML, then the signature HTML with Gmail's normal spacing). Both UTF-8, base64.
 * The message comes from the formatted editor (bodyHtml, src/lib/email-body.ts) or as plain text (body).
 * - Subject: kept as plain ASCII when it is plain ASCII; otherwise RFC 2047 encoded words (UTF-8, base64),
 *   split so each word stays under 76 characters and no character is cut in half.
 * - Body: line breaks become CRLF (\r\n), encoded as base64 in 76-character lines (UTF-8 safe).
 * - Header values never carry a line break (no header injection).
 */

import { randomBytes } from "node:crypto";
import { isValidEmail } from "@/lib/email-address";
import { emailHtml, emailText } from "@/lib/email-signature";
import { emailBodyParts } from "@/lib/email-body";

export type MimeInput = {
  to: string;
  subject: string;
  body: string;
  /**
   * The message from the formatted editor (its HTML). When given, the text part is made from it ("- " bullets,
   * "1. " numbers, links as "text (address)") and `body` is not used; the HTML part is it in Gmail's form.
   */
  bodyHtml?: string | null;
  /** The signature to add below the message (sanitized HTML and its plain text). Omit for none. */
  signature?: { html: string; text: string } | null;
  /** For tests: a fixed boundary between the parts. */
  boundary?: string;
  /** For a reply: the Message-ID header of the message being answered (adds In-Reply-To and References). */
  inReplyTo?: string | null;
};

/** True for one plain email address such as name@example.com (shared with the browser: src/lib/email-address.ts). */
export { isValidEmail };

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

/** A boundary that cannot appear in base64 text ("=_" never occurs inside base64). */
export function newBoundary(): string {
  return `=_bf_alt_${randomBytes(12).toString("hex")}`;
}

/** The full message (RFC 5322) as a string: multipart/alternative, plain text part first, then HTML. */
export function buildMimeMessage(msg: MimeInput, opts: { requireValidTo?: boolean } = {}): string {
  const to = cleanHeaderValue(msg.to);
  if (opts.requireValidTo !== false && !isValidEmail(to)) throw new Error(`"${to}" is not a valid email address.`);
  const boundary = cleanHeaderValue(msg.boundary ?? newBoundary()).replace(/"/g, "");
  const headers = [`To: ${to}`, `Subject: ${encodeHeaderValue(msg.subject)}`, "MIME-Version: 1.0"];
  const replyTo = msg.inReplyTo ? cleanHeaderValue(msg.inReplyTo) : "";
  if (replyTo) headers.push(`In-Reply-To: ${replyTo}`, `References: ${replyTo}`);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const sig = msg.signature && msg.signature.html.trim() ? msg.signature : null;
  const message = emailBodyParts(msg);
  const text = normalizeLineBreaks(emailText(message.text, sig?.text ?? null));
  const html = emailHtml(message.text, sig?.html ?? null, message.html);
  const part = (type: string, content: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(content)}\r\n`;
  return `${headers.join("\r\n")}\r\n\r\n${part("text/plain", text)}${part("text/html", html)}--${boundary}--\r\n`;
}

/** The message in the form the Gmail API expects in "raw" (base64url). */
export function gmailRaw(msg: MimeInput, opts: { requireValidTo?: boolean } = {}): string {
  return Buffer.from(buildMimeMessage(msg, opts), "utf8").toString("base64url");
}

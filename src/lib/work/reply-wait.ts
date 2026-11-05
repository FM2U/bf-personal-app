/**
 * The wording of a wait made from an email (Add to Waiting), approved by Bram 2026-11-05 (item 3): "Dana Whitfield's
 * reply to your email "Pinecrest LOI"", with the person the email went to and the subject in straight double quotes.
 * No name: Reply to your email "Pinecrest LOI". No subject: Dana Whitfield's reply to your email. Waits saved before
 * keep their text ("Reply to your email: Pinecrest LOI", or "A reply to: Pinecrest LOI" from before Nov 5) and read
 * the same way. Pure; shared by the Waiting card, the record pages, and the follow-up drafts (src/lib/work/stages.ts),
 * and tested in src/lib/work/waiting.test.ts.
 */

/** The most a wait keeps (the waits table). */
const MAX = 120;

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The wait line Add to Waiting adds, at most 120 characters (a long subject is cut, keeping the closing quote). */
export function replyWaitText(subject: string | null | undefined, name?: string | null): string {
  const s = clean(subject);
  const n = clean(name);
  const head = n ? `${n}'s reply to your email` : "Reply to your email";
  if (head.length > MAX) return `${head.slice(0, MAX - 3).trimEnd()}...`;
  if (!s) return head;
  const full = `${head} "${s}"`;
  if (full.length <= MAX) return full;
  // Room for the head, a space, two quotes, and "...".
  const room = MAX - head.length - 6;
  return room > 0 ? `${head} "${s.slice(0, room).trimEnd()}..."` : head;
}

/** A wait made from an email, read back: the person it names (or null) and the subject (or ""). Null for any other wait. */
export function parseReplyWait(text: string | null | undefined): { name: string | null; subject: string } | null {
  const t = clean(text);
  const now = /^(?:(.+?)'s reply|Reply) to your email(?: "(.*?)"?)?$/.exec(t);
  if (now) return { name: now[1] ? now[1].trim() : null, subject: String(now[2] ?? "").trim() };
  const before = /^(?:Reply to your email(?::\s*(.*))?|A reply to:\s*(.*))$/.exec(t);
  if (before) return { name: null, subject: String(before[1] ?? before[2] ?? "").trim() };
  return null;
}

/** The email subject of a wait made from an email, or "". */
export function replySubject(text: string | null | undefined): string {
  return parseReplyWait(text)?.subject ?? "";
}

/** The person a wait made from an email names ("Dana Whitfield"), or null. */
export function replyWaitName(text: string | null | undefined): string | null {
  return parseReplyWait(text)?.name ?? null;
}

/**
 * What follows a wait's text on the Waiting card ("· Luis Ortega"): nothing when the text already names that person,
 * so the name is not shown twice.
 */
export function whoBesides(text: string | null | undefined, who: string | null | undefined): string | null {
  const w = clean(who);
  if (!w) return null;
  const t = clean(text).toLowerCase();
  const named = replyWaitName(text);
  if ((named && w.toLowerCase().includes(named.toLowerCase())) || t.includes(w.toLowerCase())) return null;
  return w;
}

/** The green pill on a wait with a reply: "Dana replied Nov 4" (the first name), or "Replied Nov 4" with no name. */
export function repliedLabel(name: string | null | undefined, day: string): string {
  const first = clean(name).split(/[\s,(]+/)[0];
  return first ? `${first} replied ${day}` : `Replied ${day}`;
}

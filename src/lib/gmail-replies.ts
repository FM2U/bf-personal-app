/**
 * Reading replies from Gmail (push B, 2026-11-03), the pure part; tested in src/lib/gmail-replies.test.ts. The app
 * reads only the Gmail threads of what it sent itself (End of day reports and emails sent from the app). A reply is
 * a message in such a thread that Bram did not send, newer than the sent item, and not stored yet (by its Gmail
 * message id). Nothing else in the mailbox is read into the app.
 */

/** The parts of a Gmail message this reads (users.threads.get, format "full"). */
type GmailPart = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: GmailPart[] | null; headers?: { name?: string | null; value?: string | null }[] | null };
export type GmailThreadMessage = { id?: string | null; threadId?: string | null; internalDate?: string | null; labelIds?: string[] | null; snippet?: string | null; payload?: GmailPart | null };

export type ThreadReply = { id: string; threadId: string; at: string; from: string; fromEmail: string; subject: string; text: string };

/** The address in a From header ("Jake Morgan <jake@example.com>" to "jake@example.com"), lower case. */
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** The display name in a From header, or the address. */
export function nameOf(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : addressOf(from);
}

function header(p: GmailPart | null | undefined, name: string): string {
  return String(p?.headers?.find((h) => String(h.name ?? "").toLowerCase() === name)?.value ?? "");
}

function decode(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(p: GmailPart | null | undefined, type: string): GmailPart | null {
  if (!p) return null;
  if (String(p.mimeType ?? "").toLowerCase() === type && p.body?.data) return p;
  for (const c of p.parts ?? []) {
    const hit = findPart(c, type);
    if (hit) return hit;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * The new text of a reply: the quoted email under "On ... wrote:" (or a "From:" block, or lines starting with ">")
 * is cut, blank lines are squeezed, and the rest is kept up to 2000 characters.
 */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = `${l} ${lines[i + 1] ?? ""}`;
    if (/^\s*>/.test(l)) break;
    if (/^\s*On .{4,200}wrote:\s*$/i.test(l) || /^\s*On .{4,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? "") && /^\s*On\b/.test(next)) break;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s/i.test(lines[i + 1] ?? "")) break;
    out.push(l.trimEnd());
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
}

/** One message of a thread as plain data: the sender, the subject, the text (the plain part, else the HTML part, else the snippet). */
export function readMessage(m: GmailThreadMessage): { id: string; threadId: string; internalMs: number; labels: string[]; from: string; subject: string; text: string } | null {
  if (!m.id) return null;
  const plain = findPart(m.payload, "text/plain");
  const html = plain ? null : findPart(m.payload, "text/html");
  const raw = plain ? decode(plain.body?.data) : html ? htmlToText(decode(html.body?.data)) : String(m.snippet ?? "");
  return {
    id: String(m.id),
    threadId: String(m.threadId ?? ""),
    internalMs: Number(m.internalDate ?? 0),
    labels: (m.labelIds ?? []).map(String),
    from: header(m.payload, "from"),
    subject: header(m.payload, "subject"),
    text: replyText(raw) || String(m.snippet ?? "").trim(),
  };
}

/**
 * The replies in one thread: messages not sent by the owner (by address, and not in Sent or Drafts), newer than the
 * sent item, not stored yet. Oldest first.
 */
export function newReplies(messages: readonly GmailThreadMessage[], o: { ownerEmail: string | null; sentAt: string; known: ReadonlySet<string> }): ThreadReply[] {
  const owner = String(o.ownerEmail ?? "").trim().toLowerCase();
  const after = Date.parse(o.sentAt);
  const out: ThreadReply[] = [];
  for (const raw of messages) {
    const m = readMessage(raw);
    if (!m || o.known.has(m.id)) continue;
    if (m.labels.includes("SENT") || m.labels.includes("DRAFT")) continue;
    const fromEmail = addressOf(m.from);
    if (!fromEmail || (owner && fromEmail === owner)) continue;
    if (!Number.isFinite(after) || !(m.internalMs > after)) continue;
    out.push({ id: m.id, threadId: m.threadId, at: new Date(m.internalMs).toISOString(), from: m.from, fromEmail, subject: m.subject, text: m.text });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Replies are looked for at most once every few minutes when a page opens (the morning job always looks). */
export const REPLY_CHECK_MINUTES = 5;

export function shouldCheckReplies(lastChecked: string | null | undefined, now: Date, minutes = REPLY_CHECK_MINUTES): boolean {
  if (!lastChecked) return true;
  const t = Date.parse(lastChecked);
  return !Number.isFinite(t) || now.getTime() - t >= minutes * 60_000;
}

/** "Make a task from this": "Answer Jake's reply: Good screening day. What happened with Summit?" (cut at 140 characters). */
export function replyTaskText(first: string, text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const cut = line.length > 110 ? `${line.slice(0, 107).replace(/\s+\S*$/, "")}...` : line;
  return `Answer ${first}'s reply: ${cut}`.slice(0, 140);
}

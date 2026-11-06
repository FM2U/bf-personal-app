/**
 * Waiting on someone (push E, approved 2026-11-05), pure and tested in src/lib/work/waiting.test.ts.
 *
 * The card on Work on now has three groups: "N+ days" and "< N days" (deals and people with at least one wait, one row
 * each with a line per wait, in the group of the longest; N is the waiting setting; push E2) and "No reply yet" (emails the app sent with no reply in their Gmail thread
 * after the No reply setting's days, End of day reports left out). Add to Waiting adds a wait line to the deal (an open
 * deal in the nine stages) or otherwise to the person the email went to, and remembers the email; when a reply to that
 * email (or to the follow-up sent from the card) arrives the line shows "Replied" until Clear.
 */
import { addDaysISO, daysBetween } from "@/lib/calc/dates";
import { personHref } from "@/lib/work/people";
import { daysWaiting, waitLevel, type WaitLevel } from "@/lib/work/stages";
import { parseReplyWait, whoBesides } from "@/lib/work/reply-wait";
import { signOff } from "@/lib/work/names";

/** The No reply setting's default (Bram, 2026-11-05: 2, changed from 3). */
export const DEFAULT_NO_REPLY_DAYS = 2;
/** The reply-reading window (src/lib/replies-sync.ts): older emails are never on No reply yet. */
export const NO_REPLY_WINDOW_DAYS = 30;
// The wording of a wait made from an email (item 3 of 2026-11-05): src/lib/work/reply-wait.ts.
export { parseReplyWait, repliedLabel, replySubject, replyWaitName, replyWaitText, whoBesides } from "@/lib/work/reply-wait";

/**
 * One wait as saved (push E2: table waits). A deal, a job or consulting item, or a person can hold several at once:
 * "The CIM" typed by hand and "Luis Ortega's reply to your email "Oakline CIM"" from an email. `commId` is the email it came from (Add to
 * Waiting) and `followUpCommId` the newest follow-up sent from the Waiting card; a reply to either shows Replied.
 */
export type SavedWait = { id: string; text: string; since: string | null; commId: string | null; followUpCommId: string | null; createdAt: string };

/** One wait as a record page, a row, or the AI reads it: what, since, how many days, and the pill tone. */
export type WaitLine = {
  id: string;
  text: string;
  since: string | null;
  days: number;
  level: WaitLevel;
  /** Edits of Nov 5 (item 6): the day (YYYY-MM-DD) a reply came in for a wait made from an email; record pages show "Replied" and Clear. */
  repliedOn?: string | null;
  /** Item 3 of 2026-11-05: the person the email went to, for "Dana replied Nov 4" when the text names nobody. */
  repliedBy?: string | null;
};

/** A record's waits, longest first (then the one added first). Blank lines are left out. */
export function waitLines(waits: readonly Pick<SavedWait, "id" | "text" | "since" | "createdAt">[], today: string, threshold: number): WaitLine[] {
  const order = new Map(waits.map((w) => [w.id, String(w.createdAt ?? "")]));
  return waits
    .filter((w) => String(w.text ?? "").trim())
    .map((w): WaitLine => {
      const days = daysWaiting(w.since, today);
      return { id: w.id, text: String(w.text).trim(), since: w.since, days, level: waitLevel(w.text, days, threshold) };
    })
    .sort((a, b) => b.days - a.days || (order.get(a.id) ?? "").localeCompare(order.get(b.id) ?? ""));
}

/**
 * What a record shows where there is room for one wait (the header pill, a list row's day pill, the Deals filter):
 * the longest wait, "The CIM and 1 more" when there are more, its Since, days and tone. Nothing waited on: none.
 */
export function waitSummary(lines: readonly WaitLine[]): { waitingOn: string | null; waitingSince: string | null; waitDays: number; waitLevel: WaitLevel } {
  const first = lines[0];
  if (!first) return { waitingOn: null, waitingSince: null, waitDays: 0, waitLevel: "none" };
  return { waitingOn: lines.length > 1 ? `${first.text} and ${lines.length - 1} more` : first.text, waitingSince: first.since, waitDays: first.days, waitLevel: first.level };
}

/** Every wait in one line for the AI and the Work through context: "The CIM, since Nov 3; Luis Ortega's reply to your email "Oakline CIM", since Nov 3". */
export function waitsText(lines: readonly Pick<WaitLine, "text" | "since">[], fmt?: (d: string) => string): string {
  return lines.map((l) => (l.since && fmt ? `${l.text}, since ${fmt(l.since)}` : l.text)).join("; ");
}

/** One wait inside a row of the Waiting card: its own text, who, since, day pill, and Follow up or Replied and Clear. */
export type WaitItemLine = {
  waitId: string;
  waitingOn: string;
  /** Who is waited on: the person the email of an added wait went to, a deal's main contact and broker, a person's organization. */
  who: string | null;
  /** YYYY-MM-DD. */
  since: string | null;
  days: number;
  level: WaitLevel;
  /** The day (YYYY-MM-DD) a reply arrived in the thread of the email this wait came from or of its follow-up; null otherwise. */
  repliedOn: string | null;
  /** For Follow up: who it goes to (the person the email went to, the main contact, or the person waited on). */
  email: string | null;
  contactId: string | null;
  contactName: string | null;
};

/** One row of the two day groups: a deal or a person, with each of its waits on its own line (longest first). */
export type WaitItem = {
  /** "deal:<id>" or "person:<id>". */
  key: string;
  kind: "deal" | "person";
  id: string;
  name: string;
  href: string;
  /** The quiet word after the name: the deal's stage, the person's role. */
  context: string | null;
  lines: WaitItemLine[];
  /** The longest wait's days and tone (the row sits in the group of its longest wait). */
  days: number;
  level: WaitLevel;
};

export type WaitGroupKey = "over" | "under";

/** "5+ days" (a wait of exactly 5 days is here) and "< 5 days"; each sorted longest wait first, then A to Z. */
export function waitGroups<T extends Pick<WaitItem, "days" | "name">>(items: readonly T[], threshold: number): { key: WaitGroupKey; label: string; items: T[] }[] {
  const t = Math.max(1, Math.round(threshold));
  const sort = (xs: T[]) => [...xs].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return [
    { key: "over", label: `${t}+ days`, items: sort(items.filter((d) => d.days >= t)) },
    { key: "under", label: `< ${t} days`, items: sort(items.filter((d) => d.days < t)) },
  ];
}

/**
 * A row of the card from its lines: the longest wait sets the days and tone. Null when no line is left. A line whose
 * text already names its person drops the separate "· <person>" (item 3 of 2026-11-05).
 */
export function waitItem(row: Omit<WaitItem, "lines" | "days" | "level">, lines: readonly WaitItemLine[]): WaitItem | null {
  const sorted = [...lines]
    .filter((l) => l.waitingOn.trim())
    .map((l) => ({ ...l, who: whoBesides(l.waitingOn, l.who) }))
    .sort((a, b) => b.days - a.days);
  if (!sorted.length) return null;
  return { ...row, lines: sorted, days: sorted[0].days, level: sorted[0].level };
}

/** A person being waited on, as the loader reads it, with each of their waits. */
export type WaitingPerson = { id: string; name: string; organization: string | null; role: string | null; email: string | null; waits: { id: string; text: string; since: string | null; repliedOn: string | null; createdAt?: string }[] };

/** People rows for the day groups (only those with at least one wait). */
export function personWaits(people: readonly WaitingPerson[], today: string, threshold: number): WaitItem[] {
  const out: WaitItem[] = [];
  for (const p of people) {
    const lines = waitLines(p.waits.map((w) => ({ ...w, createdAt: w.createdAt ?? "" })), today, threshold).map((l) => ({
      waitId: l.id,
      waitingOn: l.text,
      who: p.organization,
      since: l.since,
      days: l.days,
      level: l.level,
      repliedOn: p.waits.find((w) => w.id === l.id)?.repliedOn ?? null,
      email: p.email,
      contactId: p.id,
      contactName: p.name,
    }));
    const item = waitItem({ key: `person:${p.id}`, kind: "person", id: p.id, name: p.name, href: personHref(p.id), context: p.role }, lines);
    if (item) out.push(item);
  }
  return out;
}

/** The day a wait's reply arrived: the first reply after the email it came from or after its follow-up, whichever is earlier. */
export function waitRepliedAt(mail: readonly Pick<MailRow, "direction" | "threadId" | "occurredAt">[], emails: readonly ({ thread: string | null; at: string } | null | undefined)[]): string | null {
  const found = emails.map((e) => (e?.thread ? firstReplyAfter(mail, e.thread, e.at) : null)).filter((x): x is string => !!x).sort();
  return found[0] ?? null;
}

/** One email of a thread the app sent in (outgoing) or a reply stored from it (incoming). */
export type MailRow = {
  id: string;
  /** ISO timestamp. */
  occurredAt: string;
  direction: string;
  threadId: string;
  subject: string | null;
  contactId: string | null;
  organizationId: string | null;
  itemId: string | null;
  /** Set on a report email and on a reply to one. */
  reportId: string | null;
  dismissed: boolean;
};

/** What a No reply row's record is, as far as Add to Waiting is concerned. */
export type ItemInfo = { name: string; kind: string; status: string; /** An open deal in the nine working stages (on the Waiting card). */ isDeal: boolean };

/**
 * Where Add to Waiting puts the wait: on the deal when the email is on an open deal in the nine stages, otherwise on the
 * person it went to (an email from a person or organization page, or about a job or consulting item, which are not on
 * this card). Null: nowhere (an email on a closed record, or to a typed address with no person), so it is not listed.
 */
export function waitTarget(item: ItemInfo | null, contactId: string | null): "deal" | "person" | null {
  if (item && item.status !== "open") return null;
  if (item?.isDeal) return "deal";
  return contactId ? "person" : null;
}

export type NoReplyRow = {
  commId: string;
  threadId: string;
  /** The day it was sent (YYYY-MM-DD, the owner's date). */
  sentOn: string;
  days: number;
  subject: string;
  /** The person it went to (name), when known. */
  to: string | null;
  /** The deal, item, or organization it is about, when there is one. */
  recordName: string | null;
  target: "deal" | "person";
  /** What a click on the row opens: the deal or the person. */
  href: string;
};

/**
 * No reply yet: per Gmail thread the newest email the app sent, when it is at least `afterDays` old (by the owner's
 * date) and inside the reply-reading window, with no reply stored after it. Left out: End of day reports (and their
 * threads), dismissed emails, threads a deal or person already waits on (Add to Waiting), and emails with nowhere to
 * wait (waitTarget). Oldest first.
 */
export function noReplyRows(i: {
  mail: readonly MailRow[];
  /** Threads of End of day reports (partner_reports.gmail_thread_id). */
  reportThreads: ReadonlySet<string>;
  /** Threads of the emails deals and people wait on (the email a wait came from and its follow-up). */
  waitedThreads: ReadonlySet<string>;
  today: string;
  afterDays: number;
  localDate: (ts: string) => string;
  contacts: Readonly<Record<string, string>>;
  items: Readonly<Record<string, ItemInfo>>;
  organizations: Readonly<Record<string, string>>;
}): NoReplyRow[] {
  const n = Math.max(1, Math.round(i.afterDays));
  const oldest = addDaysISO(i.today, -NO_REPLY_WINDOW_DAYS);
  const byThread = new Map<string, MailRow[]>();
  for (const m of i.mail) {
    if (!m.threadId) continue;
    const list = byThread.get(m.threadId);
    if (list) list.push(m);
    else byThread.set(m.threadId, [m]);
  }
  const out: NoReplyRow[] = [];
  for (const [threadId, list] of byThread) {
    if (i.reportThreads.has(threadId) || i.waitedThreads.has(threadId)) continue;
    if (list.some((m) => m.reportId)) continue;
    const sent = list.filter((m) => m.direction === "outgoing").sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
    const last = sent[0];
    if (!last || last.dismissed) continue;
    if (list.some((m) => m.direction === "incoming" && m.occurredAt > last.occurredAt)) continue;
    const sentOn = i.localDate(last.occurredAt);
    const days = daysBetween(sentOn, i.today);
    if (days < n || sentOn < oldest) continue;
    const item = last.itemId ? (i.items[last.itemId] ?? null) : null;
    const target = waitTarget(item, last.contactId);
    if (!target) continue;
    out.push({
      commId: last.id,
      threadId,
      sentOn,
      days,
      subject: String(last.subject ?? "").trim() || "(No subject)",
      to: last.contactId ? (i.contacts[last.contactId] ?? null) : null,
      recordName: item?.name ?? (last.organizationId ? (i.organizations[last.organizationId] ?? null) : null),
      target,
      href: target === "deal" ? `/work/deals/${last.itemId}` : personHref(String(last.contactId)),
    });
  }
  return out.sort((a, b) => (a.sentOn < b.sentOn ? -1 : a.sentOn > b.sentOn ? 1 : a.subject.localeCompare(b.subject)));
}

/** The first reply stored in a thread after the email a wait came from (its ISO timestamp), or null. */
export function firstReplyAfter(mail: readonly Pick<MailRow, "direction" | "threadId" | "occurredAt">[], threadId: string, sentAt: string): string | null {
  const replies = mail.filter((m) => m.direction === "incoming" && m.threadId === threadId && m.occurredAt > sentAt).map((m) => m.occurredAt).sort();
  return replies[0] ?? null;
}

/** The drafted Follow up to a person being waited on. */
export function personFollowUpDraft(i: { name: string; waitingOn: string | null; days: number; /** Fix list item 10: Settings, Name. */ signName?: string | null }): { subject: string; body: string } {
  const first = String(i.name ?? "").trim().split(/\s+/)[0] || "there";
  const what = String(i.waitingOn ?? "").trim();
  // A wait made from an email reads as "your reply to my email about <subject>" (whatever its wording).
  const parsed = parseReplyWait(what);
  const reply = parsed?.subject ?? "";
  const since = i.days >= 2 ? ` It has been ${i.days} days, so I wanted to make sure it did not get lost.` : "";
  const topic = reply ? `your reply to my email about ${reply}` : parsed ? "your reply to my email" : what ? `${what.charAt(0).toLowerCase()}${what.slice(1)}` : "your reply";
  return {
    subject: reply ? `Following up: ${reply}` : "Following up",
    body: `Hi ${first},\n\nQuick follow-up: I am still waiting on ${topic}.${since}\n\nIs there an update? Happy to jump on a call if that is easier.\n\n${signOff("Thanks", i.signName)}`,
  };
}

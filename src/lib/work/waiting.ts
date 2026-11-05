/**
 * Waiting on someone (push E, approved 2026-11-05), pure and tested in src/lib/work/waiting.test.ts.
 *
 * The card on Work on now has three groups: "N+ days" and "Less than N days" (deals and people whose Waiting on is
 * filled in; N is the waiting setting) and "No reply yet" (emails the app sent with no reply in their Gmail thread
 * after the No reply setting's days, End of day reports left out). Add to Waiting turns a No reply row into a wait on
 * the deal (an open deal in the nine stages) or otherwise on the person the email went to, and remembers the email;
 * when a reply to that email arrives the wait shows "Replied" until Clear.
 */
import { addDaysISO, daysBetween } from "@/lib/calc/dates";
import { personHref } from "@/lib/work/people";
import { daysWaiting, waitLevel, type WaitLevel } from "@/lib/work/stages";

/** The No reply setting's default (Bram, 2026-11-05: 2, changed from 3). */
export const DEFAULT_NO_REPLY_DAYS = 2;
/** The reply-reading window (src/lib/replies-sync.ts): older emails are never on No reply yet. */
export const NO_REPLY_WINDOW_DAYS = 30;
/** What Add to Waiting writes into Waiting on. */
export const REPLY_PREFIX = "A reply to: ";

/** One row of the two day groups: a deal or a person being waited on. Plain data for client components. */
export type WaitItem = {
  /** "deal:<id>" or "person:<id>". */
  key: string;
  kind: "deal" | "person";
  id: string;
  name: string;
  href: string;
  waitingOn: string;
  /** Who is waited on: the person an added email went to, a deal's main contact and broker, a person's organization. */
  who: string | null;
  /** YYYY-MM-DD. */
  since: string | null;
  days: number;
  level: WaitLevel;
  /** The quiet word after Since: the deal's stage, the person's role. */
  context: string | null;
  /** The day (YYYY-MM-DD) a reply arrived in the thread of the email this wait came from (Add to Waiting); null otherwise. */
  repliedOn: string | null;
  /** For Follow up: the main contact's or the person's email address, and the person's id and name. */
  email: string | null;
  contactId: string | null;
  contactName: string | null;
};

export type WaitGroupKey = "over" | "under";

/** "5+ days" (a wait of exactly 5 days is here) and "Less than 5 days"; each sorted longest wait first, then A to Z. */
export function waitGroups<T extends Pick<WaitItem, "days" | "name">>(items: readonly T[], threshold: number): { key: WaitGroupKey; label: string; items: T[] }[] {
  const t = Math.max(1, Math.round(threshold));
  const sort = (xs: T[]) => [...xs].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return [
    { key: "over", label: `${t}+ days`, items: sort(items.filter((d) => d.days >= t)) },
    { key: "under", label: `Less than ${t} days`, items: sort(items.filter((d) => d.days < t)) },
  ];
}

/** A person being waited on, as the loader reads it. */
export type WaitingPerson = { id: string; name: string; waitingOn: string | null; waitingSince: string | null; organization: string | null; role: string | null; email: string | null; repliedOn: string | null };

/** People rows for the day groups (only those whose Waiting on is filled in). */
export function personWaits(people: readonly WaitingPerson[], today: string, threshold: number): WaitItem[] {
  return people
    .filter((p) => String(p.waitingOn ?? "").trim())
    .map((p) => {
      const days = daysWaiting(p.waitingSince, today);
      return {
        key: `person:${p.id}`,
        kind: "person" as const,
        id: p.id,
        name: p.name,
        href: personHref(p.id),
        waitingOn: String(p.waitingOn).trim(),
        who: p.organization,
        since: p.waitingSince,
        days,
        level: waitLevel(p.waitingOn, days, threshold),
        context: p.role,
        repliedOn: p.repliedOn,
        email: p.email,
        contactId: p.id,
        contactName: p.name,
      };
    });
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
  /** Threads of the emails deals and people wait on (their waiting_comm_id). */
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

/** Waiting on, from Add to Waiting: "A reply to: <subject>" (fits the 120 characters Waiting on keeps). */
export function replyWaitText(subject: string | null | undefined): string {
  const s = String(subject ?? "").replace(/\s+/g, " ").trim() || "your email";
  const full = `${REPLY_PREFIX}${s}`;
  return full.length > 120 ? `${full.slice(0, 117).trimEnd()}...` : full;
}

/** The drafted Follow up to a person being waited on. */
export function personFollowUpDraft(i: { name: string; waitingOn: string | null; days: number }): { subject: string; body: string } {
  const first = String(i.name ?? "").trim().split(/\s+/)[0] || "there";
  const what = String(i.waitingOn ?? "").trim();
  const reply = what.startsWith(REPLY_PREFIX) ? what.slice(REPLY_PREFIX.length).trim() : "";
  const since = i.days >= 2 ? ` It has been ${i.days} days, so I wanted to make sure it did not get lost.` : "";
  const topic = reply ? `your reply to my email about ${reply}` : what ? `${what.charAt(0).toLowerCase()}${what.slice(1)}` : "your reply";
  return {
    subject: reply ? `Following up: ${reply}` : "Following up",
    body: `Hi ${first},\n\nQuick follow-up: I am still waiting on ${topic}.${since}\n\nIs there an update? Happy to jump on a call if that is easier.\n\nThanks,\nBram`,
  };
}

import { addDaysISO, daysBetween } from "./dates";

/**
 * Outreach Queue: which contacts are due for a message, based on their relationship group,
 * their outreach frequency, and the date of the latest communication with them.
 */

export type RelationshipGroup = "close" | "warm" | "professional";

export const GROUP_DEFAULT_DAYS: Record<RelationshipGroup, number> = { close: 30, warm: 60, professional: 90 };

export const GROUP_LABELS: Record<RelationshipGroup, string> = { close: "Close", warm: "Warm", professional: "Professional" };

export const OUTCOME_LABELS: Record<string, string> = {
  replied: "Replied",
  meeting_booked: "Meeting booked",
  referral: "Referral",
  no_response: "No response",
};

/** Days between messages: the contact's own number, otherwise the group default (close 30, warm 60, professional 90). */
export function effectiveEveryDays(group: string | null | undefined, everyDays: number | null | undefined): number | null {
  if (everyDays !== null && everyDays !== undefined && Number(everyDays) > 0) return Number(everyDays);
  if (group && group in GROUP_DEFAULT_DAYS) return GROUP_DEFAULT_DAYS[group as RelationshipGroup];
  return null;
}

export type OutreachStatus = {
  everyDays: number | null;
  /** Date the next message is due; null when never contacted. */
  dueDate: string | null;
  due: boolean;
  /** Days past the due date (0 = due today). Null when never contacted. */
  daysOverdue: number | null;
  neverContacted: boolean;
};

/**
 * A contact is due when (last contact date + frequency) is today or earlier,
 * or when the contact has a relationship group and has never been contacted.
 */
export function outreachStatus(
  c: { relationship_group?: string | null; outreach_every_days?: number | null },
  lastContactDate: string | null,
  today: string,
): OutreachStatus {
  const everyDays = effectiveEveryDays(c.relationship_group, c.outreach_every_days);
  if (!lastContactDate) {
    const due = !!c.relationship_group && everyDays !== null;
    return { everyDays, dueDate: null, due, daysOverdue: null, neverContacted: true };
  }
  if (everyDays === null) return { everyDays, dueDate: null, due: false, daysOverdue: null, neverContacted: false };
  const dueDate = addDaysISO(lastContactDate, everyDays);
  const overdue = daysBetween(dueDate, today);
  return { everyDays, dueDate, due: overdue >= 0, daysOverdue: overdue >= 0 ? overdue : null, neverContacted: false };
}

/**
 * Deal-source contacts first (people who can refer off-market deals), then never-contacted contacts.
 * Within the same due status, contacts who introduced deals or consulting leads come first (most introduced first),
 * then most days overdue, then name.
 */
export function sortQueue<T extends { name: string; status: OutreachStatus; isDealSource?: boolean; introducedCount?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!!a.isDealSource !== !!b.isDealSource) return a.isDealSource ? -1 : 1;
    if (a.status.neverContacted !== b.status.neverContacted) return a.status.neverContacted ? -1 : 1;
    const intro = (b.introducedCount ?? 0) - (a.introducedCount ?? 0);
    if (intro !== 0) return intro;
    const d = (b.status.daysOverdue ?? 0) - (a.status.daysOverdue ?? 0);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

export type OutreachStats = {
  sent: number;
  replied: number;
  meetings: number;
  referrals: number;
  noResponse: number;
  replyRatePct: number | null;
  /** Outreach with purpose deal_sourcing. Null when database update 0009 is not applied. */
  dealSourcing: number | null;
  dealSourcingSharePct: number | null;
};

/**
 * Totals for outreach communications. Reply rate = outreach with any reply outcome
 * (replied, meeting booked, or referral) divided by all outreach sent.
 */
export function outreachStats(comms: { outcome: string | null; purpose?: string | null }[]): OutreachStats {
  const sent = comms.length;
  const replied = comms.filter((c) => c.outcome === "replied").length;
  const meetings = comms.filter((c) => c.outcome === "meeting_booked").length;
  const referrals = comms.filter((c) => c.outcome === "referral").length;
  const noResponse = comms.filter((c) => c.outcome === "no_response").length;
  const anyReply = replied + meetings + referrals;
  const hasPurpose = comms.some((c) => c.purpose !== undefined);
  const dealSourcing = hasPurpose ? comms.filter((c) => c.purpose === "deal_sourcing").length : null;
  return {
    sent,
    replied,
    meetings,
    referrals,
    noResponse,
    replyRatePct: sent ? Math.round((anyReply / sent) * 100) : null,
    dealSourcing,
    dealSourcingSharePct: dealSourcing !== null && sent ? Math.round((dealSourcing / sent) * 100) : null,
  };
}

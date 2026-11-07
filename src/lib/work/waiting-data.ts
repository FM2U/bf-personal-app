import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { DealRow, WorkCtx } from "@/lib/work/data";
import { roleLabel } from "@/lib/work/outreach";
import { NO_REPLY_WINDOW_DAYS, noReplyRows, personWaits, waitItem, waitRepliedAt, type ItemInfo, type MailRow, type NoReplyRow, type SavedWait, type WaitItem, type WaitItemLine, type WaitingPerson } from "@/lib/work/waiting";
import { loadWaitsFor } from "@/lib/work/waits-data";
import type { Row } from "@/lib/types";

/**
 * What the Waiting on someone card on Work on now reads (push E, push E2): the deals and people being waited on, one
 * row each with a line per wait (with "Replied" on a line when a reply came in the thread of the email it came from
 * or of its follow-up) and No reply yet. Nothing here writes; the saves are in src/app/actions/waiting.ts. Only the
 * app's own stored emails and replies are read (the reply reading of push B stores the replies); the mailbox itself
 * is not. Before UPDATE_PREVIEW_PUSH_E2.sql runs (table waits missing), `available` is false and nothing is listed.
 */
export type WaitingBoard = {
  available: boolean;
  /** Deals and people being waited on (the two day groups). */
  items: WaitItem[];
  noReply: NoReplyRow[];
  noReplyDays: number;
};

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** "Mark Reed, Transworld": the deal's main contact and broker, as the waiting row has always shown them. */
export function dealWho(d: Pick<DealRow, "contactName" | "brokerName">): string | null {
  if (d.contactName) return d.brokerName && !d.brokerName.includes(d.contactName) ? `${d.contactName}, ${d.brokerName}` : d.contactName;
  return d.brokerName;
}

const toMail = (c: Row): MailRow => ({
  id: String(c.id),
  occurredAt: String(c.occurred_at),
  direction: String(c.direction),
  threadId: String(c.gmail_thread_id ?? ""),
  subject: str(c.subject),
  contactId: str(c.contact_id),
  organizationId: str(c.organization_id),
  itemId: str(c.pipeline_item_id),
  reportId: str(c.partner_report_id),
  dismissed: !!c.no_reply_dismissed_at,
});

/** `deals` may still be loading (Home starts this card's reads before the deals are in; page speed, 2026-11-06). */
export async function loadWaitingBoard(sb: SupabaseClient, ctx: WorkCtx, dealsIn: readonly DealRow[] | Promise<readonly DealRow[]>): Promise<WaitingBoard> {
  const plain: WaitingBoard = { available: false, items: [], noReply: [], noReplyDays: ctx.noReplyDays };
  const owner = ctx.ownerId;
  const local = (ts: string) => todayInTz(ctx.tz, new Date(ts));
  // A day of slack for the time zone; noReplyRows keeps exactly the window.
  const since = `${addDaysISO(ctx.today, -NO_REPLY_WINDOW_DAYS - 1)}T00:00:00Z`;

  const [waits, mailRes, reports] = await Promise.all([
    loadWaitsFor(sb, owner),
    sb.from("communications").select("id,occurred_at,direction,gmail_thread_id,subject,contact_id,organization_id,pipeline_item_id,partner_report_id,no_reply_dismissed_at").eq("owner_id", owner).eq("method", "email").not("gmail_thread_id", "is", null).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(3000),
    sb.from("partner_reports").select("gmail_thread_id").eq("owner_id", owner).not("gmail_thread_id", "is", null).gte("sent_at", since).limit(2000),
  ]);
  if (!waits.available || isMissingSchemaError(mailRes.error) || mailRes.error) return plain;
  const mail = ((mailRes.data ?? []) as Row[]).map(toMail);

  // The emails waits came from and their follow-ups (they may be older than the window), and the replies in their threads.
  const all = [...Object.values(waits.byItem), ...Object.values(waits.byContact)].flat();
  const linkIds = [...new Set(all.flatMap((w) => [w.commId, w.followUpCommId]).filter(Boolean))] as string[];
  // The people waited on (not archived), read side by side with the linked emails (page speed, 2026-11-06).
  const personIds = Object.keys(waits.byContact);
  const [{ data: linkedRows }, { data: peopleRows }] = await Promise.all([
    linkIds.length ? sb.from("communications").select("id,occurred_at,gmail_thread_id,contact_id").in("id", linkIds) : Promise.resolve({ data: [] as Row[] }),
    personIds.length ? sb.from("contacts").select("id,name,email,organization_id,outreach_role,archived_at").eq("owner_id", owner).in("id", personIds).is("archived_at", null) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const personRows = (peopleRows ?? []) as Row[];
  const linked = new Map(((linkedRows ?? []) as Row[]).map((r) => [String(r.id), { at: String(r.occurred_at), thread: str(r.gmail_thread_id), contactId: str(r.contact_id) }]));
  const linkedThreads = [...new Set([...linked.values()].map((l) => l.thread).filter(Boolean))] as string[];
  // The replies in the waited threads and the names below are read side by side (page speed, 2026-11-06).
  const repliesP = linkedThreads.length ? sb.from("communications").select("occurred_at,gmail_thread_id,direction").eq("owner_id", owner).eq("direction", "incoming").in("gmail_thread_id", linkedThreads).limit(2000) : Promise.resolve({ data: [] as Row[] });

  // Names: the people emails went to, the records they are about, the organizations.
  const contactIds = [...new Set([...mail.map((m) => m.contactId), ...[...linked.values()].map((l) => l.contactId)].filter(Boolean))] as string[];
  const itemIds = [...new Set(mail.map((m) => m.itemId).filter(Boolean))] as string[];
  const orgIds = [...new Set([...mail.map((m) => m.organizationId), ...personRows.map((p) => str(p.organization_id))].filter(Boolean))] as string[];
  const [{ data: replyRows }, { data: cs }, { data: its }, { data: orgs }, deals] = await Promise.all([
    repliesP,
    contactIds.length ? sb.from("contacts").select("id,name,email").in("id", contactIds) : Promise.resolve({ data: [] as Row[] }),
    itemIds.length ? sb.from("pipeline_items").select("id,name,company_name,status").in("id", itemIds) : Promise.resolve({ data: [] as Row[] }),
    orgIds.length ? sb.from("organizations").select("id,name").in("id", orgIds) : Promise.resolve({ data: [] as Row[] }),
    dealsIn,
  ]);
  const replies = ((replyRows ?? []) as Row[]).map((r) => ({ direction: "incoming", threadId: String(r.gmail_thread_id), occurredAt: String(r.occurred_at) }));
  /** Push E2, item 3: a reply to the email a wait came from or to its follow-up shows Replied. */
  const repliedOn = (w: SavedWait): string | null => {
    const at = waitRepliedAt(replies, [w.commId ? linked.get(w.commId) : null, w.followUpCommId ? linked.get(w.followUpCommId) : null]);
    return at ? local(at) : null;
  };

  const contactRows = new Map(((cs ?? []) as Row[]).map((c) => [String(c.id), { id: String(c.id), name: String(c.name ?? ""), email: str(c.email) }]));
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const items: Record<string, ItemInfo> = Object.fromEntries(
    ((its ?? []) as Row[]).map((i) => {
      const d = dealById.get(String(i.id));
      return [String(i.id), { name: d?.name ?? String(i.company_name || i.name), kind: d ? "acquisition" : "other", status: String(i.status ?? "open"), isDeal: !!d && d.status === "open" }];
    }),
  );
  const orgName = Object.fromEntries(((orgs ?? []) as Row[]).map((o) => [String(o.id), String(o.name)]));

  const waitedThreads = new Set(linkedThreads);
  const reportThreads = new Set(((reports.data ?? []) as Row[]).map((r) => String(r.gmail_thread_id)));
  const noReply = noReplyRows({
    mail,
    reportThreads,
    waitedThreads,
    today: ctx.today,
    afterDays: ctx.noReplyDays,
    localDate: local,
    contacts: Object.fromEntries([...contactRows].map(([id, c]) => [id, c.name])),
    items,
    organizations: orgName,
  });

  // A deal row: each wait on its own line. A line from an email names the person it went to (Follow up goes to them).
  const dealItems: WaitItem[] = [];
  for (const d of deals) {
    if (d.status !== "open" || !d.waits.length) continue;
    const saved = new Map((waits.byItem[d.id] ?? []).map((w) => [w.id, w]));
    const lines: WaitItemLine[] = d.waits.map((l) => {
      const w = saved.get(l.id);
      const toId = w?.commId ? linked.get(w.commId)?.contactId : null;
      const to = toId ? (contactRows.get(toId) ?? null) : null;
      return {
        waitId: l.id,
        waitingOn: l.text,
        who: to && to.id !== d.contactId ? to.name : dealWho(d),
        since: l.since,
        days: l.days,
        level: l.level,
        repliedOn: w ? repliedOn(w) : null,
        email: to?.email ?? d.contactEmail,
        contactId: to?.id ?? d.contactId,
        contactName: to?.name ?? d.contactName,
      };
    });
    const item = waitItem({ key: `deal:${d.id}`, kind: "deal", id: d.id, name: d.name, href: `/work/deals/${d.id}`, context: d.stageName }, lines);
    if (item) dealItems.push(item);
  }
  const waitingPeople: WaitingPerson[] = personRows.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    organization: p.organization_id ? (orgName[String(p.organization_id)] ?? null) : null,
    role: roleLabel(p.outreach_role as string | null),
    email: str(p.email),
    waits: (waits.byContact[String(p.id)] ?? []).map((w) => ({ id: w.id, text: w.text, since: w.since, repliedOn: repliedOn(w), createdAt: w.createdAt })),
  }));
  return { available: true, items: [...dealItems, ...personWaits(waitingPeople, ctx.today, ctx.threshold)], noReply, noReplyDays: ctx.noReplyDays };
}

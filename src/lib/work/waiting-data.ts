import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { DealRow, WorkCtx } from "@/lib/work/data";
import { roleLabel } from "@/lib/work/outreach";
import { firstReplyAfter, NO_REPLY_WINDOW_DAYS, noReplyRows, personWaits, type ItemInfo, type MailRow, type NoReplyRow, type WaitItem, type WaitingPerson } from "@/lib/work/waiting";
import type { Row } from "@/lib/types";

/**
 * What the Waiting on someone card on Work on now reads (push E): the deals and people being waited on (with "Replied"
 * when a reply came in the thread of the email a wait came from) and No reply yet. Nothing here writes; the saves are
 * in src/app/actions/waiting.ts. Only the app's own stored emails and replies are read (the reply reading of push B
 * stores the replies); the mailbox itself is not. Before UPDATE_PREVIEW_PUSH_E.sql runs, `available` is false and the
 * card shows the deals only, as before.
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

function dealItem(d: DealRow, repliedOn: string | null, to: { id: string; name: string; email: string | null } | null): WaitItem {
  return {
    key: `deal:${d.id}`,
    kind: "deal",
    id: d.id,
    name: d.name,
    href: `/work/deals/${d.id}`,
    waitingOn: String(d.waitingOn ?? "").trim(),
    // An added email names the person it went to; otherwise the main contact and broker.
    who: to && to.id !== d.contactId ? to.name : dealWho(d),
    since: d.waitingSince,
    days: d.waitDays,
    level: d.waitLevel,
    context: d.stageName,
    repliedOn,
    email: to?.email ?? d.contactEmail,
    contactId: to?.id ?? d.contactId,
    contactName: to?.name ?? d.contactName,
  };
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

export async function loadWaitingBoard(sb: SupabaseClient, ctx: WorkCtx, deals: readonly DealRow[]): Promise<WaitingBoard> {
  const waitingDeals = deals.filter((d) => d.status === "open" && d.waitLevel !== "none");
  const plain: WaitingBoard = { available: false, items: waitingDeals.map((d) => dealItem(d, null, null)), noReply: [], noReplyDays: ctx.noReplyDays };
  const owner = ctx.ownerId;
  const local = (ts: string) => todayInTz(ctx.tz, new Date(ts));
  // A day of slack for the time zone; noReplyRows keeps exactly the window.
  const since = `${addDaysISO(ctx.today, -NO_REPLY_WINDOW_DAYS - 1)}T00:00:00Z`;

  const [dealLinks, personLinks, people, mailRes, reports] = await Promise.all([
    sb.from("pipeline_items").select("id,waiting_comm_id").eq("owner_id", owner).not("waiting_comm_id", "is", null).limit(2000),
    sb.from("contacts").select("id,waiting_comm_id").eq("owner_id", owner).not("waiting_comm_id", "is", null).limit(2000),
    sb.from("contacts").select("id,name,email,organization_id,outreach_role,waiting_on,waiting_since,waiting_comm_id").eq("owner_id", owner).is("archived_at", null).not("waiting_on", "is", null).limit(500),
    sb.from("communications").select("id,occurred_at,direction,gmail_thread_id,subject,contact_id,organization_id,pipeline_item_id,partner_report_id,no_reply_dismissed_at").eq("owner_id", owner).eq("method", "email").not("gmail_thread_id", "is", null).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(3000),
    sb.from("partner_reports").select("gmail_thread_id").eq("owner_id", owner).not("gmail_thread_id", "is", null).gte("sent_at", since).limit(2000),
  ]);
  if ([dealLinks, personLinks, people, mailRes].some((r) => isMissingSchemaError(r.error))) return plain;
  if (dealLinks.error || personLinks.error || people.error || mailRes.error) return plain;

  const dealLink = new Map(((dealLinks.data ?? []) as Row[]).map((r) => [String(r.id), String(r.waiting_comm_id)]));
  const personRows = (people.data ?? []) as Row[];
  const linkIds = [...new Set([...dealLink.values(), ...((personLinks.data ?? []) as Row[]).map((r) => String(r.waiting_comm_id))])];
  const mail = ((mailRes.data ?? []) as Row[]).map(toMail);

  // The emails waits came from (they may be older than the window) and the replies in their threads.
  const { data: linkedRows } = linkIds.length ? await sb.from("communications").select("id,occurred_at,gmail_thread_id,contact_id").in("id", linkIds) : { data: [] as Row[] };
  const linked = new Map(((linkedRows ?? []) as Row[]).map((r) => [String(r.id), { at: String(r.occurred_at), thread: str(r.gmail_thread_id), contactId: str(r.contact_id) }]));
  const linkedThreads = [...new Set([...linked.values()].map((l) => l.thread).filter(Boolean))] as string[];
  const { data: replyRows } = linkedThreads.length ? await sb.from("communications").select("occurred_at,gmail_thread_id,direction").eq("owner_id", owner).eq("direction", "incoming").in("gmail_thread_id", linkedThreads).limit(2000) : { data: [] as Row[] };
  const replies = ((replyRows ?? []) as Row[]).map((r) => ({ direction: "incoming", threadId: String(r.gmail_thread_id), occurredAt: String(r.occurred_at) }));
  const repliedOn = (commId: string | null | undefined): string | null => {
    const l = commId ? linked.get(commId) : undefined;
    if (!l?.thread) return null;
    const at = firstReplyAfter(replies, l.thread, l.at);
    return at ? local(at) : null;
  };

  // Names: the people emails went to, the records they are about, the organizations.
  const contactIds = [...new Set([...mail.map((m) => m.contactId), ...[...linked.values()].map((l) => l.contactId)].filter(Boolean))] as string[];
  const itemIds = [...new Set(mail.map((m) => m.itemId).filter(Boolean))] as string[];
  const orgIds = [...new Set([...mail.map((m) => m.organizationId), ...personRows.map((p) => str(p.organization_id))].filter(Boolean))] as string[];
  const [{ data: cs }, { data: its }, { data: orgs }] = await Promise.all([
    contactIds.length ? sb.from("contacts").select("id,name,email").in("id", contactIds) : Promise.resolve({ data: [] as Row[] }),
    itemIds.length ? sb.from("pipeline_items").select("id,name,company_name,status").in("id", itemIds) : Promise.resolve({ data: [] as Row[] }),
    orgIds.length ? sb.from("organizations").select("id,name").in("id", orgIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
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

  const dealItems = waitingDeals.map((d) => {
    const commId = dealLink.get(d.id);
    const to = commId ? linked.get(commId)?.contactId : null;
    return dealItem(d, repliedOn(commId), to ? (contactRows.get(to) ?? null) : null);
  });
  const waitingPeople: WaitingPerson[] = personRows.map((p) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    waitingOn: str(p.waiting_on),
    waitingSince: p.waiting_since ? String(p.waiting_since).slice(0, 10) : null,
    organization: p.organization_id ? (orgName[String(p.organization_id)] ?? null) : null,
    role: roleLabel(p.outreach_role as string | null),
    email: str(p.email),
    repliedOn: repliedOn(str(p.waiting_comm_id)),
  }));
  return { available: true, items: [...dealItems, ...personWaits(waitingPeople, ctx.today, ctx.threshold)], noReply, noReplyDays: ctx.noReplyDays };
}

// ---------- For the saves (src/app/actions/waiting.ts, work.ts, outreach.ts) ----------

/** Marks an email so it stays off No reply yet (a wait that came from it was cleared by hand or moved to a newer email). */
export async function dismissNoReplyEmail(sb: SupabaseClient, ownerId: string, commId: string | null | undefined): Promise<void> {
  if (!commId) return;
  await sb.from("communications").update({ no_reply_dismissed_at: new Date().toISOString() }).eq("owner_id", ownerId).eq("id", commId).is("no_reply_dismissed_at", null);
}

/**
 * After Follow up from the Waiting card: the wait moves to the follow-up email just sent (the newest email the app sent
 * on this deal or to this person in the last 15 minutes), so a reply to it shows Replied and it is not listed again
 * under No reply yet. The email the wait came from before is kept off No reply yet. Quietly does nothing before the
 * push E update.
 */
export async function moveWaitToNewestEmail(sb: SupabaseClient, ownerId: string, target: { table: "pipeline_items" | "contacts"; id: string; commId: string | null }): Promise<void> {
  const recent = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await sb
    .from("communications")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("direction", "outgoing")
    .eq("method", "email")
    .eq(target.table === "pipeline_items" ? "pipeline_item_id" : "contact_id", target.id)
    .not("gmail_thread_id", "is", null)
    .gte("occurred_at", recent)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const newest = ((data ?? []) as Row[])[0];
  if (!newest || String(newest.id) === target.commId) return;
  const { error } = await sb.from(target.table).update({ waiting_comm_id: String(newest.id) }).eq("owner_id", ownerId).eq("id", target.id);
  if (!error) await dismissNoReplyEmail(sb, ownerId, target.commId);
}

/**
 * Waiting on changed or emptied by hand on a record whose wait came from an email: the link is dropped and the email
 * stays off No reply yet (Bram already decided about it).
 */
export async function dropWaitLink(sb: SupabaseClient, ownerId: string, target: { table: "pipeline_items" | "contacts"; id: string; commId: string | null }): Promise<void> {
  if (!target.commId) return;
  await sb.from(target.table).update({ waiting_comm_id: null }).eq("owner_id", ownerId).eq("id", target.id);
  await dismissNoReplyEmail(sb, ownerId, target.commId);
}


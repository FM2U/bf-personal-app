import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { effectiveEveryDays, outreachStatus, sortQueue, type OutreachStatus } from "@/lib/calc/outreach";
import { creditByContact, introducedNote, type ContactCredit } from "@/lib/calc/source-chain";
import { fetchAll } from "@/lib/data";
import { scoped } from "@/lib/finance";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

export type QueueRow = {
  id: string;
  name: string;
  organization: string | null;
  email: string | null;
  group: string | null;
  lastContactDate: string | null;
  lastOutcome: string | null;
  /** Can refer off-market deals (database update 0009). Listed first. */
  isDealSource: boolean;
  /** Marked "Consulting lead" (database update 0011). */
  isConsultingLead: boolean;
  /** Deals and consulting leads where the contact is "Deal came from" or "Introduced by". */
  credit: ContactCredit | null;
  /** Deals plus consulting leads credited (used to sort within the same due status). */
  introducedCount: number;
  introducedNote: string | null;
  status: OutreachStatus;
};

/**
 * Contacts with an outreach schedule (relationship group other than "Other", or their own number of days), with the date of the latest communication
 * (read from communications, never stored by hand) and whether a message is due.
 * `available` is false until database update 0008 is applied.
 */
export async function loadOutreachQueue(
  sb: SupabaseClient,
  opts: { ownerId?: string; today: string; tz: string },
): Promise<{ available: boolean; all: QueueRow[]; due: QueueRow[]; error?: string }> {
  const read = (cols: string) => scoped(sb.from("contacts").select(cols), opts.ownerId).order("name");
  const base = "id,name,email,organization_id,relationship_group,outreach_every_days";
  let { data, error } = await read(`${base},is_deal_source,is_consulting_lead`);
  // Before database update 0011 there is no is_consulting_lead column; before 0009 no is_deal_source column.
  if (error && isMissingSchemaError(error)) ({ data, error } = await read(`${base},is_deal_source`));
  if (error && isMissingSchemaError(error)) ({ data, error } = await read(base));
  if (error) return { available: !isMissingSchemaError(error), all: [], due: [], error: error.message };
  // Only contacts with a schedule: a group with a schedule (not "Other"), or their own number of days.
  const contacts = ((data ?? []) as unknown as Row[]).filter((c) => effectiveEveryDays(c.relationship_group, c.outreach_every_days) !== null);
  if (!contacts.length) return { available: true, all: [], due: [] };
  let comms: Row[] = [];
  let orgs: Row[] = [];
  let chain: Row[] = [];
  let pipes: Row[] = [];
  try {
    // Pipeline items for credit ("Deal came from", "Introduced by"). select("*") works before and after update 0011.
    [chain, pipes] = await Promise.all([
      fetchAll((a, b) => scoped(sb.from("pipeline_items").select("*"), opts.ownerId).range(a, b)),
      fetchAll((a, b) => scoped(sb.from("pipelines").select("id,kind"), opts.ownerId).range(a, b)),
    ]);
  } catch {
    chain = [];
  }
  const kindOf = Object.fromEntries(pipes.map((p) => [p.id, p.kind]));
  const credit = creditByContact(chain.map((i) => ({ id: i.id, kind: kindOf[i.pipeline_id], source_contact_id: i.source_contact_id, introduced_by_contact_id: i.introduced_by_contact_id })));
  try {
    [comms, orgs] = await Promise.all([
      fetchAll((a, b) =>
        scoped(sb.from("communications").select("contact_id,occurred_at,outcome,is_outreach"), opts.ownerId)
          .not("contact_id", "is", null)
          .order("occurred_at", { ascending: false })
          .range(a, b),
      ),
      fetchAll((a, b) => scoped(sb.from("organizations").select("id,name"), opts.ownerId).order("name").range(a, b)),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: !isMissingSchemaError({ message: msg }), all: [], due: [], error: msg };
  }
  const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  const last: Record<string, string> = {};
  const outcome: Record<string, string | null> = {};
  for (const c of comms) {
    if (!last[c.contact_id]) last[c.contact_id] = todayInTz(opts.tz, new Date(c.occurred_at));
    if (c.is_outreach && !(c.contact_id in outcome)) outcome[c.contact_id] = c.outcome ?? null;
  }
  const all: QueueRow[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    organization: c.organization_id ? orgName[c.organization_id] ?? null : null,
    email: c.email ?? null,
    group: c.relationship_group ?? null,
    lastContactDate: last[c.id] ?? null,
    lastOutcome: outcome[c.id] ?? null,
    isDealSource: !!c.is_deal_source,
    isConsultingLead: !!c.is_consulting_lead,
    credit: credit[c.id] ?? null,
    introducedCount: (credit[c.id]?.deals ?? 0) + (credit[c.id]?.consultingLeads ?? 0),
    introducedNote: introducedNote(credit[c.id]),
    status: outreachStatus(c, last[c.id] ?? null, opts.today),
  }));
  return { available: true, all, due: sortQueue(all.filter((r) => r.status.due)) };
}

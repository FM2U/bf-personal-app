import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { outreachStatus, sortQueue, type OutreachStatus } from "@/lib/calc/outreach";
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
  status: OutreachStatus;
};

/**
 * Contacts with a relationship group or an outreach frequency, with the date of the latest communication
 * (read from communications, never stored by hand) and whether a message is due.
 * `available` is false until database update 0008 is applied.
 */
export async function loadOutreachQueue(
  sb: SupabaseClient,
  opts: { ownerId?: string; today: string; tz: string },
): Promise<{ available: boolean; all: QueueRow[]; due: QueueRow[]; error?: string }> {
  const read = (cols: string) => scoped(sb.from("contacts").select(cols), opts.ownerId).order("name");
  const base = "id,name,email,organization_id,relationship_group,outreach_every_days";
  let { data, error } = await read(`${base},is_deal_source`);
  // Before database update 0009 there is no is_deal_source column: read without it.
  if (error && isMissingSchemaError(error)) ({ data, error } = await read(base));
  if (error) return { available: !isMissingSchemaError(error), all: [], due: [], error: error.message };
  const contacts = ((data ?? []) as unknown as Row[]).filter((c) => c.relationship_group || c.outreach_every_days);
  if (!contacts.length) return { available: true, all: [], due: [] };
  let comms: Row[] = [];
  let orgs: Row[] = [];
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
    status: outreachStatus(c, last[c.id] ?? null, opts.today),
  }));
  return { available: true, all, due: sortQueue(all.filter((r) => r.status.due)) };
}

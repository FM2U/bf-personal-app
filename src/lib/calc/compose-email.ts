/**
 * The "Email" button on contact, organization, and pipeline item pages (and "Email them" on the Outreach Queue):
 * who the email goes to by default, which people can be chosen, and the outreach purpose it is logged with.
 * Pure functions (tested in compose-email.test.ts); the server part is src/lib/compose-email.ts.
 */

import { isValidEmail } from "@/lib/email-address";
import { outreachPurpose, type OutreachPurpose } from "@/lib/calc/sent-email";

/** One person the email can go to. `role` says why they are listed ("Main contact", "Deal came from", ...). */
export type Recipient = { contactId: string; name: string; email: string; role: string };

type PersonRow = { id: string; name?: string | null; email?: string | null };

type PipelineContacts = {
  primary_contact_id?: string | null;
  source_contact_id?: string | null;
  introduced_by_contact_id?: string | null;
};

/** Pipeline item fields that name a person, in the order the email recipient is chosen. */
export const PIPELINE_RECIPIENT_FIELDS: { field: keyof PipelineContacts; role: string }[] = [
  { field: "primary_contact_id", role: "Main contact" },
  { field: "source_contact_id", role: "Deal came from" },
  { field: "introduced_by_contact_id", role: "Introduced by" },
];

function asRecipient(c: PersonRow | undefined | null, role: string): Recipient | null {
  if (!c || !c.email || !isValidEmail(String(c.email))) return null;
  return { contactId: String(c.id), name: String(c.name ?? c.email), email: String(c.email).trim(), role };
}

/**
 * People a pipeline item's email can go to: main contact, "Deal came from", "Introduced by", then people at the
 * item's organization. Only people with a valid email address; each person once (with the first role found).
 */
export function pipelineRecipients(item: PipelineContacts, contactsById: Record<string, PersonRow>, orgPeople: PersonRow[] = []): Recipient[] {
  const out: Recipient[] = [];
  const seen = new Set<string>();
  const add = (r: Recipient | null) => {
    if (r && !seen.has(r.contactId)) {
      seen.add(r.contactId);
      out.push(r);
    }
  };
  for (const { field, role } of PIPELINE_RECIPIENT_FIELDS) {
    const id = item[field];
    if (id) add(asRecipient(contactsById[id], role));
  }
  for (const p of orgPeople) add(asRecipient(p, "At the organization"));
  return out;
}

/**
 * Default recipient on a pipeline item: the main contact when they have an email address; otherwise the
 * "Deal came from" contact; otherwise nobody (the owner chooses or types one).
 */
export function defaultPipelineRecipient(item: PipelineContacts, contactsById: Record<string, PersonRow>): Recipient | null {
  for (const { field, role } of PIPELINE_RECIPIENT_FIELDS.slice(0, 2)) {
    const id = item[field];
    const r = id ? asRecipient(contactsById[id], role) : null;
    if (r) return r;
  }
  return null;
}

/** People at an organization who have an email address. The default is set only when there is exactly one. */
export function organizationRecipients(people: PersonRow[]): { recipients: Recipient[]; defaultTo: Recipient | null } {
  const recipients = people.map((p) => asRecipient(p, "At this organization")).filter((r): r is Recipient => !!r);
  return { recipients, defaultTo: recipients.length === 1 ? recipients[0] : null };
}

/** The listed person whose address is the one in the To field (letter case ignored), if any. */
export function matchRecipient(to: string, recipients: Recipient[]): Recipient | null {
  const v = String(to ?? "").trim().toLowerCase();
  if (!v) return null;
  return recipients.find((r) => r.email.toLowerCase() === v) ?? null;
}

/**
 * Outreach purpose of an email written with the Email button. An email about a pipeline item takes the item's
 * purpose (acquisition: deal sourcing; consulting: consulting). Otherwise the Outreach Queue rule for the contact
 * (consulting lead: consulting; deal source: deal sourcing). Anyone else, or no contact: general.
 */
export function composePurpose(input: {
  contact?: { is_consulting_lead?: unknown; is_deal_source?: unknown } | null;
  pipelineKind?: string | null;
}): OutreachPurpose {
  if (input.pipelineKind === "acquisition") return "deal_sourcing";
  if (input.pipelineKind === "consulting") return "consulting";
  return outreachPurpose(input.contact ?? null, null);
}

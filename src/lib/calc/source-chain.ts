/**
 * Deal source chain (database update 0011): who handed over a deal ("Deal came from", pipeline_items.source_contact_id)
 * and who started the chain ("Introduced by", pipeline_items.introduced_by_contact_id).
 * Pure functions (tested): the deal type suggestion and the credit each contact gets for deals and consulting leads.
 */

export type DealSourceType = "proprietary" | "brokered";

export type ContactForSuggestion = {
  roles?: string[] | null;
  /** Kind of the contact's organization (organizations.kind), when known. */
  organizationKind?: string | null;
};

/** True when the contact is marked as a broker (role Broker) or works at an organization of kind broker. */
export function isBroker(c: ContactForSuggestion | null | undefined): boolean {
  if (!c) return false;
  const roles = Array.isArray(c.roles) ? c.roles : [];
  return roles.some((r) => String(r).toLowerCase() === "broker") || String(c.organizationKind ?? "").toLowerCase() === "broker";
}

/**
 * Suggested deal type for the "Deal came from" contact: Brokered when that contact is a broker, otherwise Proprietary
 * (the owner, or a friend who knows the owner). Null when no contact is chosen. Only a suggestion: the form never
 * changes a value the owner chose.
 */
export function suggestDealSourceType(c: ContactForSuggestion | null | undefined): DealSourceType | null {
  if (!c) return null;
  return isBroker(c) ? "brokered" : "proprietary";
}

export type ChainItem = {
  id: string;
  /** Pipeline kind of the item: acquisition items are deals, consulting items are consulting leads. */
  kind: string | null | undefined;
  source_contact_id?: string | null;
  introduced_by_contact_id?: string | null;
  created_at?: string | null;
};

export type ContactCredit = {
  /** Acquisition deals where the contact is "Deal came from" or "Introduced by" (each deal counted once). */
  deals: number;
  dealsCameFrom: number;
  dealsIntroduced: number;
  /** Consulting items where the contact is "Lead came from" or "Introduced by" (each item counted once). */
  consultingLeads: number;
};

const empty = (): ContactCredit => ({ deals: 0, dealsCameFrom: 0, dealsIntroduced: 0, consultingLeads: 0 });

/** Credit per contact id. A contact who is both "Deal came from" and "Introduced by" on one item gets that item once. */
export function creditByContact(items: ChainItem[]): Record<string, ContactCredit> {
  const out: Record<string, ContactCredit> = {};
  for (const it of items) {
    const isDeal = it.kind === "acquisition";
    const isLead = it.kind === "consulting";
    if (!isDeal && !isLead) continue;
    const from = it.source_contact_id || null;
    const intro = it.introduced_by_contact_id || null;
    for (const id of new Set([from, intro].filter(Boolean) as string[])) {
      const c = (out[id] ??= empty());
      if (isDeal) {
        c.deals++;
        if (id === from) c.dealsCameFrom++;
        if (id === intro) c.dealsIntroduced++;
      } else c.consultingLeads++;
    }
  }
  return out;
}

/** Short note for the Outreach Queue: "Introduced 3 deals", "Introduced 1 deal and 2 consulting leads". Null when none. */
export function introducedNote(c: ContactCredit | null | undefined): string | null {
  if (!c || (!c.deals && !c.consultingLeads)) return null;
  const parts: string[] = [];
  if (c.deals) parts.push(`${c.deals} ${c.deals === 1 ? "deal" : "deals"}`);
  if (c.consultingLeads) parts.push(`${c.consultingLeads} consulting ${c.consultingLeads === 1 ? "lead" : "leads"}`);
  return `Introduced ${parts.join(" and ")}`;
}

/**
 * Top contacts by deals introduced (deals, then consulting leads, then name). `inPeriod` counts the deals
 * of items created between from and to (YYYY-MM-DD, compared on the first 10 characters of created_at).
 */
export function topIntroducers(
  items: ChainItem[],
  names: Record<string, string>,
  opts: { limit?: number; from?: string; to?: string } = {},
): { contact_id: string; name: string; deals: number; consulting_leads: number; deals_this_period: number }[] {
  const all = creditByContact(items);
  const period =
    opts.from && opts.to
      ? creditByContact(items.filter((i) => i.created_at && i.created_at.slice(0, 10) >= opts.from! && i.created_at.slice(0, 10) <= opts.to!))
      : {};
  return Object.entries(all)
    .filter(([, c]) => c.deals > 0 || c.consultingLeads > 0)
    .map(([id, c]) => ({ contact_id: id, name: names[id] ?? "Contact", deals: c.deals, consulting_leads: c.consultingLeads, deals_this_period: period[id]?.deals ?? 0 }))
    .sort((a, b) => b.deals - a.deals || b.consulting_leads - a.consulting_leads || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 5);
}

/**
 * "Deal came from" / "Lead came from" is one field: a contact, or "Not a person" with a typed source
 * (example: "BizBuySell listing"). The typed source is saved in pipeline_items.source.
 */
export type SourceMode = "contact" | "text";

/** How the field opens: "Not a person" when there is no contact and a typed source exists; otherwise the contact. */
export function initialSourceMode(contactId: string | null | undefined, sourceText: string | null | undefined): SourceMode {
  return !contactId && String(sourceText ?? "").trim() ? "text" : "contact";
}

/**
 * The values saved for the field.
 * - "Not a person": no contact, and the typed source (empty = none).
 * - A contact (or none): the contact. The typed source is cleared when the owner switched from "Not a person" to a
 *   contact; an item that already had both (from before the fields were merged) keeps its typed source.
 */
export function resolveSourceFields(p: {
  mode: SourceMode;
  contactId: string | null | undefined;
  text: string | null | undefined;
  initialMode: SourceMode;
  initialText: string | null | undefined;
}): { source_contact_id: string | null; source: string | null } {
  if (p.mode === "text") return { source_contact_id: null, source: String(p.text ?? "").trim() || null };
  const keep = p.initialMode === "contact" ? String(p.initialText ?? "").trim() || null : null;
  return { source_contact_id: p.contactId || null, source: keep };
}

/** Deal type suggestion for the field: none for a typed source (it is not a person), otherwise by the contact. */
export function suggestForSource(mode: SourceMode, contact: ContactForSuggestion | null | undefined): DealSourceType | null {
  return mode === "text" ? null : suggestDealSourceType(contact);
}

/** What the item page shows for the field: the contact name, the typed source, or both. */
export function describeSource(contactName: string | null | undefined, sourceText: string | null | undefined): string | null {
  const text = String(sourceText ?? "").trim();
  if (contactName && text) return `${contactName} (also noted: ${text})`;
  if (contactName) return contactName;
  if (text) return `${text} (not a person)`;
  return null;
}

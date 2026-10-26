/**
 * "People at this organization" on the organization form, its "+ New" dialog, and its page:
 * existing contacts linked to the organization (contacts.organization_id) and new people added in rows.
 * Saving links the chosen contacts and unlinks the removed ones (the contact is kept, only the link is removed).
 * Pure functions (tested). Saving is in src/app/actions/records.ts (writeRecord) and src/app/actions/people.ts.
 */

export type NewPerson = { name: string; email?: string; phone?: string; title?: string; relationship_group?: string };

/** What the people editor sends (hidden field __org_people, JSON). */
export type OrgPeopleDraft = { linked: string[]; added: NewPerson[] };

export const ORG_PEOPLE_FIELD = "__org_people";

const PERSON_KEYS = ["name", "email", "phone", "title", "relationship_group"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PERSON_GROUPS = ["close", "friend", "warm", "professional", "other"];

/** A row with nothing typed in it. */
export function isBlankPerson(p: Partial<NewPerson>): boolean {
  return PERSON_KEYS.every((k) => !String(p[k] ?? "").trim());
}

/** The draft as sent: blank rows left out, values trimmed, each linked contact once. */
export function cleanDraft(d: OrgPeopleDraft): OrgPeopleDraft {
  return {
    linked: [...new Set(d.linked.filter(Boolean))],
    added: d.added
      .filter((p) => !isBlankPerson(p))
      .map((p) => Object.fromEntries(PERSON_KEYS.map((k) => [k, String(p[k] ?? "").trim()])) as NewPerson),
  };
}

export function parseOrgPeople(raw: string | null | undefined): OrgPeopleDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OrgPeopleDraft>;
    return cleanDraft({ linked: Array.isArray(v.linked) ? v.linked.map(String) : [], added: Array.isArray(v.added) ? (v.added as NewPerson[]) : [] });
  } catch {
    return null;
  }
}

export type OrgPeoplePlan = { link: string[]; unlink: string[]; create: NewPerson[] };

/**
 * What saving does, from the contacts linked now (`current`) and the draft:
 * link = chosen contacts not linked yet; unlink = linked contacts no longer chosen (unlinked, never deleted);
 * create = new people (a name is required; email checked; relationship group from the list).
 * `addOnly` (the organization page's "Add people"): nothing is unlinked.
 */
export function planOrgPeople(current: string[], draft: OrgPeopleDraft, opts: { addOnly?: boolean } = {}): OrgPeoplePlan | { error: string } {
  const d = cleanDraft(draft);
  for (const p of d.added) {
    if (!p.name) return { error: "Add a name for each new person, or remove the row." };
    if (p.email && !EMAIL.test(p.email)) return { error: `${p.email} is not an email address.` };
    if (p.relationship_group && !PERSON_GROUPS.includes(p.relationship_group)) return { error: "Choose a relationship group from the list." };
  }
  const now = new Set(current);
  const chosen = new Set(d.linked);
  return {
    link: d.linked.filter((id) => !now.has(id)),
    unlink: opts.addOnly ? [] : current.filter((id) => !chosen.has(id)),
    create: d.added,
  };
}

/** The contact rows to insert for new people (empty values saved as null). */
export function newContactRows(people: NewPerson[], organizationId: string, ownerId: string) {
  return people.map((p) => ({
    owner_id: ownerId,
    organization_id: organizationId,
    name: p.name,
    email: p.email || null,
    phone: p.phone || null,
    title: p.title || null,
    relationship_group: p.relationship_group || null,
  }));
}

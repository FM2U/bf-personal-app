/**
 * People (push B, 2026-11-03; Outreach renamed): three views of the same records. Follow-ups is today's working list
 * (what Outreach was), Everyone lists every person A to Z with a role filter, Organizations lists the firms (brokers,
 * lenders, employers, clients, investors). Pure and tested in src/lib/work/people.test.ts.
 */
import { OUTREACH_ROLES, type OutreachRole } from "@/lib/work/outreach";

export type PeopleView = "follow" | "everyone" | "orgs";

export const PEOPLE_VIEWS: readonly { key: PeopleView; label: string }[] = [
  { key: "follow", label: "Follow-ups" },
  { key: "everyone", label: "Everyone" },
  { key: "orgs", label: "Organizations" },
];

/** The view from the address (?view=everyone or ?view=orgs); anything else is Follow-ups. */
export function parsePeopleView(v: string | null | undefined): PeopleView {
  return v === "everyone" ? "everyone" : v === "orgs" ? "orgs" : "follow";
}

/** The address of a view (Follow-ups is plain /work/people). */
export function peopleViewHref(v: PeopleView): string {
  return v === "follow" ? "/work/people" : `/work/people?view=${v}`;
}

export const PEOPLE_HREF = "/work/people";
export const personHref = (id: string) => `/work/people/${id}`;
export const organizationHref = (id: string) => `/work/people/organizations/${id}`;

// ---------- Everyone: the role filter ----------

/** The role pills Everyone always shows (the approved mockup's order); any other role shows once someone has it. */
const MAIN_ROLE_PILLS: OutreachRole[] = ["broker", "lender", "accountability_partner", "investor", "cofounder_candidate", "personal_network", "consulting_client"];

export type RoleFilter = "all" | OutreachRole;

/** "All", the main roles, then the other roles held by at least one person (in the role list's order). */
export function roleFilters(people: readonly { roleKey: string | null }[]): { key: RoleFilter; label: string }[] {
  const held = new Set(people.map((p) => p.roleKey).filter(Boolean));
  const label = (k: OutreachRole) => OUTREACH_ROLES.find((r) => r.key === k)?.label ?? k;
  const extra = OUTREACH_ROLES.map((r) => r.key).filter((k) => !MAIN_ROLE_PILLS.includes(k) && held.has(k));
  return [{ key: "all", label: "All" }, ...[...MAIN_ROLE_PILLS, ...extra].map((k) => ({ key: k as RoleFilter, label: label(k) }))];
}

export function matchesRole(p: { roleKey: string | null }, role: RoleFilter): boolean {
  return role === "all" || p.roleKey === role;
}

export function roleCounts(people: readonly { roleKey: string | null }[], filters: readonly { key: RoleFilter }[]): Record<string, number> {
  return Object.fromEntries(filters.map((f) => [f.key, people.filter((p) => matchesRole(p, f.key)).length]));
}

/** A to Z by name, any letter case. */
export function byName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Follow-ups leaves out an accountability partner who has no follow-up date: the report is how Bram keeps in touch
 * with them, so they would only sit in No date. They stay on Everyone.
 */
export function onFollowUps(p: { roleKey: string | null; nextFollowUp: string | null }): boolean {
  return !(p.roleKey === "accountability_partner" && !p.nextFollowUp);
}

// ---------- Organizations ----------

export const ORG_KINDS = [
  { key: "broker", label: "Broker firm" },
  { key: "lender", label: "Lender" },
  { key: "employer", label: "Employer" },
  { key: "consulting_client", label: "Consulting client" },
  { key: "investor", label: "Investor firm" },
  { key: "business", label: "Business" },
  { key: "service_provider", label: "Service provider" },
  { key: "nonprofit", label: "Nonprofit" },
  { key: "other", label: "Other" },
] as const;
export type OrgKind = (typeof ORG_KINDS)[number]["key"];

export function parseOrgKind(v: unknown): OrgKind {
  return (ORG_KINDS.find((k) => k.key === v)?.key ?? "other") as OrgKind;
}

export function orgKindLabel(v: unknown): string {
  return ORG_KINDS.find((k) => k.key === v)?.label ?? "Other";
}

/** The kind pills Organizations always shows; any other kind shows once an organization has it. */
const MAIN_KIND_PILLS: OrgKind[] = ["broker", "lender", "employer", "consulting_client", "investor"];

export type OrgFilter = "all" | OrgKind;

export function orgFilters(orgs: readonly { kind: string }[]): { key: OrgFilter; label: string }[] {
  const held = new Set(orgs.map((o) => o.kind));
  const extra = ORG_KINDS.map((k) => k.key).filter((k) => !MAIN_KIND_PILLS.includes(k) && held.has(k));
  return [{ key: "all", label: "All" }, ...[...MAIN_KIND_PILLS, ...extra].map((k) => ({ key: k as OrgFilter, label: orgKindLabel(k) }))];
}

export function matchesOrgFilter(o: { kind: string }, f: OrgFilter): boolean {
  return f === "all" || o.kind === f;
}

/** "Find an organization": the name, the region, or a person's name holds the typed text. */
export function matchesOrgSearch(o: { name: string; region: string | null; peopleNames: readonly string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return o.name.toLowerCase().includes(q) || String(o.region ?? "").toLowerCase().includes(q) || o.peopleNames.some((n) => n.toLowerCase().includes(q));
}

/** "Broker firm · Knoxville and Chattanooga, TN": the kind and the region (the organization row and header). */
export function orgLine(o: { kind: string; region: string | null }): string {
  return [orgKindLabel(o.kind), o.region].filter(Boolean).join(" · ");
}

/** "Mark Reed, Rachel Kim" (up to three names, then "and 2 more"), or "No one yet". */
export function peopleNamesLine(names: readonly string[]): string {
  if (!names.length) return "No one yet";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/**
 * Contacts (push B, 2026-11-03; Outreach renamed People, then Contacts in the Push B edits): three views of the same
 * records. Follow-ups is today's working list (what Outreach was), People lists every person A to Z, Organizations
 * lists the organizations (brokers, lenders, employers, clients, investors). Each view has the Filter window
 * (src/lib/filters.ts) with its own groups. Pure and tested in src/lib/work/people.test.ts.
 */
import { daysBetween } from "@/lib/calc/dates";
import type { FilterGroup } from "@/lib/filters";
import { outreachSectionOf, purposeLabel, workWeek, type OutreachRole } from "@/lib/work/outreach";

export type PeopleView = "follow" | "people" | "orgs";

export const PEOPLE_VIEWS: readonly { key: PeopleView; label: string }[] = [
  { key: "follow", label: "Follow-ups" },
  { key: "people", label: "People" },
  { key: "orgs", label: "Organizations" },
];

/** The view from the address (?view=people or ?view=orgs; ?view=everyone from before the rename is People); anything else is Follow-ups. */
export function parsePeopleView(v: string | null | undefined): PeopleView {
  return v === "people" || v === "everyone" ? "people" : v === "orgs" ? "orgs" : "follow";
}

/** The address of a view (Follow-ups is plain /work/people). */
export function peopleViewHref(v: PeopleView): string {
  return v === "follow" ? "/work/people" : `/work/people?view=${v}`;
}

export const PEOPLE_HREF = "/work/people";
export const personHref = (id: string) => `/work/people/${id}`;
export const organizationHref = (id: string) => `/work/people/organizations/${id}`;

/** The menu name of the three views together (push B edits: People became Contacts). */
export const CONTACTS_LABEL = "Contacts";

/** A to Z by name, any letter case. */
export function byName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Follow-ups leaves out an accountability partner who has no follow-up date: the report is how Bram keeps in touch
 * with them, so they would only sit in No date. They stay on People.
 */
export function onFollowUps(p: { roleKey: string | null; nextFollowUp: string | null }): boolean {
  return !(p.roleKey === "accountability_partner" && !p.nextFollowUp);
}

// ---------- Organizations ----------

export const ORG_KINDS = [
  { key: "broker", label: "Broker" },
  { key: "lender", label: "Lender" },
  { key: "employer", label: "Employer" },
  { key: "consulting_client", label: "Consulting client" },
  { key: "investor", label: "Investor" },
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

/** "Find an organization": the name, the region, or a person's name holds the typed text. */
export function matchesOrgSearch(o: { name: string; region: string | null; peopleNames: readonly string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return o.name.toLowerCase().includes(q) || String(o.region ?? "").toLowerCase().includes(q) || o.peopleNames.some((n) => n.toLowerCase().includes(q));
}

/** "Broker · Knoxville and Chattanooga, TN": the kind and the region (the organization row and header). */
export function orgLine(o: { kind: string; region: string | null }): string {
  return [orgKindLabel(o.kind), o.region].filter(Boolean).join(" · ");
}

/** "Mark Reed, Rachel Kim" (up to three names, then "and 2 more"), or "No one yet". */
export function peopleNamesLine(names: readonly string[]): string {
  if (!names.length) return "No one yet";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

// ---------- The Filter window's groups ----------

/** The roles in the order the Filter window lists them (the approved mockup). */
const ROLE_ORDER: { key: OutreachRole; label: string }[] = [
  { key: "broker", label: "Broker" },
  { key: "lender", label: "Lender" },
  { key: "personal_network", label: "Personal network" },
  { key: "service_provider", label: "Service provider" },
  { key: "rosara_customer", label: "Rosara customer" },
  { key: "recruiter", label: "Recruiter" },
  { key: "cofounder_candidate", label: "Co-founder candidate" },
  { key: "investor", label: "Investor" },
  { key: "accountability_partner", label: "Accountability partner" },
  { key: "consulting_client", label: "Consulting client" },
  { key: "other", label: "Other" },
];

/** The organization kinds the Filter window always lists; another stored kind (Service provider) shows once an organization has it. */
const MAIN_KINDS: OrgKind[] = ["broker", "lender", "employer", "consulting_client", "investor", "business", "nonprofit", "other"];

export function kindOptions(held: readonly string[]): { value: string; label: string }[] {
  const extra = ORG_KINDS.map((k) => k.key).filter((k) => !MAIN_KINDS.includes(k) && held.includes(k));
  const keys = [...MAIN_KINDS.slice(0, -1), ...extra, "other" as OrgKind];
  return keys.map((k) => ({ value: k, label: orgKindLabel(k) }));
}

/** What a person row needs for the filters: the role, the last contact and next follow-up dates, the organization's kind. */
export type PersonFilterRow = { roleKey: string | null; lastContactOn: string | null; nextFollowUp: string | null; organizationId: string | null };

/**
 * Last contact, in groups that never overlap: This week (since Monday), This month (the last 30 days, before this
 * week), 1 to 3 months (31 to 90 days ago), 3+ months (more than 90 days ago), Never. Older saved values "30" and "90"
 * still work.
 */
export function lastContactBucket(on: string | null, today: string, value: string): boolean {
  if (value === "never") return !on;
  if (!on) return false;
  const d = on.slice(0, 10);
  if (d > today) return false;
  const weekStart = workWeek(today).start;
  const ago = daysBetween(d, today);
  if (value === "week") return d >= weekStart;
  if (value === "month" || value === "30") return d < weekStart && ago <= 30;
  if (value === "1to3") return ago > 30 && ago <= 90;
  if (value === "3plus" || value === "90") return ago > 90;
  return false;
}

/** Follow-up: Overdue, Today, This week (the next 7 days), None (no date). */
export function followUpBucket(date: string | null, today: string, value: string): boolean {
  const s = outreachSectionOf({ nextFollowUp: date }, today);
  return value === "overdue" ? s === "overdue" : value === "today" ? s === "today" : value === "week" ? s === "week" : value === "none" ? s === "nodate" : false;
}

/** The four groups of People: Role, Last contact, Follow-up, Organization kind. */
export function personFilterGroups<T extends PersonFilterRow>(today: string, kindOf: (orgId: string) => string | null, heldKinds: readonly string[]): FilterGroup<T>[] {
  return [
    { key: "role", title: "Role", options: ROLE_ORDER.map((r) => ({ value: r.key, label: r.label })), test: (p, v) => p.roleKey === v },
    {
      key: "lc",
      title: "Last contact",
      options: [
        { value: "week", label: "This week" },
        { value: "month", label: "This month" },
        { value: "1to3", label: "1 to 3 months" },
        { value: "3plus", label: "3+ months" },
        { value: "never", label: "Never" },
      ],
      test: (p, v) => lastContactBucket(p.lastContactOn, today, v),
      phrase: (v) => ({ week: "contacted this week", month: "contacted earlier this month", "1to3": "contacted 1 to 3 months ago", "3plus": "not contacted in 3+ months", never: "never contacted" })[v] ?? v,
    },
    {
      key: "fu",
      title: "Follow-up",
      options: [
        { value: "overdue", label: "Overdue" },
        { value: "today", label: "Today" },
        { value: "week", label: "This week" },
        { value: "none", label: "None" },
      ],
      test: (p, v) => followUpBucket(p.nextFollowUp, today, v),
      phrase: (v) => ({ overdue: "follow-up overdue", today: "follow-up today", week: "follow-up this week", none: "no follow-up set" })[v] ?? v,
    },
    {
      key: "org",
      title: "Organization kind",
      options: [...kindOptions(heldKinds), { value: "none", label: "No organization" }],
      test: (p, v) => (v === "none" ? !p.organizationId : !!p.organizationId && kindOf(p.organizationId) === v),
      phrase: (v) => (v === "none" ? "no organization" : `at ${/^[aeiou]/i.test(orgKindLabel(v)) ? "an" : "a"} ${orgKindLabel(v).toLowerCase()} organization`),
    },
  ];
}

/** The Project choices of Follow-ups, in the window's order, then None (no project ticked on the person). */
const PROJECT_ORDER = ["off_market_deals", "rosara", "job_search", "consulting"] as const;

/**
 * The two groups of Follow-ups (approved 2026-11-04): Role and Project. The tiles above the list pick the follow-up
 * group (Overdue, Due today, Next 7 days, Later, No date), so the window has no Follow-up or Last contact column.
 */
export function followUpFilterGroups<T extends PersonFilterRow & { purposes: readonly string[] }>(): FilterGroup<T>[] {
  return [
    { key: "role", title: "Role", options: ROLE_ORDER.map((r) => ({ value: r.key, label: r.label })), test: (p, v) => p.roleKey === v },
    {
      key: "proj",
      title: "Project",
      options: [...PROJECT_ORDER.map((k) => ({ value: k, label: purposeLabel(k) })), { value: "none", label: "None" }],
      test: (p, v) => (v === "none" ? !p.purposes.length : p.purposes.includes(v)),
      phrase: (v) => (v === "none" ? "on no project" : `on ${purposeLabel(v)}`),
    },
  ];
}

/** What an organization row needs for the filters. */
export type OrgFilterRow = { kind: string; region: string | null; openDeals: number; archived: boolean };

const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

/** The region an organization is filtered by: the state of "Knoxville and Chattanooga, TN" (Tennessee), or the region as typed. */
export function regionOf(region: string | null | undefined): string | null {
  const t = String(region ?? "").trim();
  if (!t) return null;
  const m = t.match(/,\s*([A-Z]{2})$/);
  return m && STATES[m[1]] ? STATES[m[1]] : t;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";

/** The four groups of Organizations: Kind, Region, Open deals, Status. Status is Active until a box is ticked. */
export function orgFilterGroups<T extends OrgFilterRow>(orgs: readonly OrgFilterRow[]): FilterGroup<T>[] {
  const regions = [...new Set(orgs.map((o) => regionOf(o.region)).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b));
  return [
    { key: "kind", title: "Kind", options: kindOptions(orgs.map((o) => o.kind)), test: (o, v) => o.kind === v, phrase: (v) => orgKindLabel(v) },
    { key: "region", title: "Region", options: regions.map((r) => ({ value: slug(r), label: r })), test: (o, v) => slug(regionOf(o.region) ?? "") === v && !!regionOf(o.region), phrase: (v) => `in ${regions.find((r) => slug(r) === v) ?? v}` },
    {
      key: "deals",
      title: "Open deals",
      options: [
        { value: "has", label: "Has open deals" },
        { value: "none", label: "None" },
      ],
      test: (o, v) => (v === "has" ? o.openDeals > 0 : o.openDeals === 0),
      phrase: (v) => (v === "has" ? "with open deals" : "with no open deals"),
    },
    {
      key: "status",
      title: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" },
      ],
      test: (o, v) => (v === "archived" ? o.archived : !o.archived),
      phrase: (v) => (v === "archived" ? "archived" : "active"),
      default: ["active"],
    },
  ];
}

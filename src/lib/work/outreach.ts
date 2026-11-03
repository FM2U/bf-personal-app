/**
 * Outreach (batch B, approved 2026-10-31), pure and tested in src/lib/work/outreach.test.ts: the roles and purposes a
 * person can have, the sections by next follow-up (Overdue, Due today, Next 7 days, Later, No date), the filter
 * pills, the weekly counter ("Network outreach: N of 10 this week", emails sent and calls logged Monday to Friday),
 * the "LAST CONTACT" figure, and the date choices Done offers. Outreach is the working view of the app's contact
 * records (the contacts table); the next follow-up date and what it is for are the contact's follow_up_date and
 * follow_up_note.
 */
import { addDaysISO, daysBetween, weekBounds } from "@/lib/calc/dates";

export const OUTREACH_ROLES = [
  { key: "broker", label: "Broker" },
  { key: "lender", label: "Lender" },
  // Edit batch C round 2 (item 5): "Former colleague" became "Personal network" (stored as personal_network since update 0026).
  { key: "personal_network", label: "Personal network" },
  // Push B (2026-11-03): Consulting client and Accountability partner can be chosen on a person.
  { key: "consulting_client", label: "Consulting client" },
  { key: "service_provider", label: "Service provider" },
  { key: "rosara_customer", label: "Rosara customer" },
  { key: "recruiter", label: "Recruiter" },
  { key: "cofounder_candidate", label: "Co-founder candidate" },
  { key: "investor", label: "Investor" },
  { key: "accountability_partner", label: "Accountability partner" },
  { key: "other", label: "Other" },
] as const;
export type OutreachRole = (typeof OUTREACH_ROLES)[number]["key"];

/** The four purposes. Every purpose pill is the one soft blue (the color system of Edit batch B, 2026-11-01). */
export const PURPOSES = [
  { key: "off_market_deals", label: "Off-market deals" },
  { key: "job_search", label: "Job search" },
  { key: "consulting", label: "Consulting" },
  { key: "rosara", label: "Rosara" },
] as const;
export type PurposeKey = (typeof PURPOSES)[number]["key"];

const PURPOSE_KEYS = PURPOSES.map((p) => p.key) as readonly string[];

function isRole(v: unknown): v is OutreachRole {
  return OUTREACH_ROLES.some((r) => r.key === v);
}

/** Stored role keys from before a rename, and the role they are now (update 0026 moves the rows over by UPDATE). */
const RENAMED_ROLES: Record<string, OutreachRole> = { former_colleague: "personal_network" };

/** The role a stored key means today: "former_colleague" (before update 0026) reads as personal_network; unknown keys are null. */
export function normalizeRole(key: string | null | undefined): OutreachRole | null {
  const k = String(key ?? "");
  if (RENAMED_ROLES[k]) return RENAMED_ROLES[k];
  return isRole(k) ? k : null;
}

export function roleLabel(key: string | null | undefined): string | null {
  const k = normalizeRole(key);
  return OUTREACH_ROLES.find((r) => r.key === k)?.label ?? null;
}

/**
 * The key saved for a role. Before database update 0026 the database still allows only the old key, so Personal
 * network is saved as "former_colleague" (it reads back as Personal network); after it, as "personal_network".
 */
export function roleForDatabase(role: unknown, has0026: boolean): string | null {
  const k = normalizeRole(typeof role === "string" ? role : null);
  if (!k) return null;
  if (!has0026) for (const [old, now] of Object.entries(RENAMED_ROLES)) if (now === k) return old;
  return k;
}

export function purposeLabel(key: string): string {
  return PURPOSES.find((p) => p.key === key)?.label ?? key;
}

/** Every purpose pill is soft blue (lane and purpose pills share one color). */
export function purposeTone(): "blue" {
  return "blue";
}

/**
 * The purposes saved on a contact (a text array, or a comma-separated string from a form), in the fixed order,
 * unknown values dropped, each at most once.
 */
export function parsePurposes(value: unknown): PurposeKey[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  const keys = new Set(raw.map((v) => String(v ?? "").trim().toLowerCase()).filter((v) => PURPOSE_KEYS.includes(v)));
  return PURPOSES.filter((p) => keys.has(p.key)).map((p) => p.key);
}

/** "Off-market deals, Rosara" (what the Purpose field shows), or "" for none. */
export function purposesText(keys: readonly string[]): string {
  return parsePurposes([...keys]).map(purposeLabel).join(", ");
}

/** What the sections, filters, and rows read on a person (a subset of the loaded row, so the tests stay small). */
export type OutreachPerson = {
  id: string;
  name: string;
  purposes: readonly string[];
  /** YYYY-MM-DD or null. */
  nextFollowUp: string | null;
  archived?: boolean;
};

type OutreachSectionKey = "overdue" | "today" | "week" | "later" | "nodate";

export const OUTREACH_SECTIONS: readonly { key: OutreachSectionKey; label: string; hint?: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "nodate", label: "No date", hint: "Set a date or they fall out of touch" },
];

/** Which section a person sits in, by the next follow-up date. */
export function outreachSectionOf(p: Pick<OutreachPerson, "nextFollowUp">, today: string): OutreachSectionKey {
  if (!p.nextFollowUp) return "nodate";
  const d = p.nextFollowUp.slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  if (daysBetween(today, d) <= 7) return "week";
  return "later";
}

/** Within a section: soonest date first (overdue: the oldest first), then by name; No date: by name. */
function compareOutreach(a: OutreachPerson, b: OutreachPerson): number {
  const da = a.nextFollowUp ?? "";
  const db = b.nextFollowUp ?? "";
  if (da !== db) return da < db ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** The five sections, each sorted. Archived people are left out. */
export function outreachSections<T extends OutreachPerson>(people: readonly T[], today: string): Record<OutreachSectionKey, T[]> {
  const out: Record<OutreachSectionKey, T[]> = { overdue: [], today: [], week: [], later: [], nodate: [] };
  for (const p of people) if (!p.archived) out[outreachSectionOf(p, today)].push(p);
  for (const k of Object.keys(out) as OutreachSectionKey[]) out[k].sort(compareOutreach);
  return out;
}

export type OutreachFilter = "all" | "today" | "over" | "nodate" | PurposeKey;

export const OUTREACH_FILTERS: readonly { key: OutreachFilter; label: string; purpose?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Due today" },
  { key: "over", label: "Overdue" },
  { key: "nodate", label: "No date" },
  ...PURPOSES.map((p) => ({ key: p.key as OutreachFilter, label: p.label, purpose: true })),
];

export function matchesOutreachFilter(p: OutreachPerson, filter: OutreachFilter, today: string): boolean {
  if (p.archived) return false;
  if (filter === "all") return true;
  const section = outreachSectionOf(p, today);
  if (filter === "today") return section === "today";
  if (filter === "over") return section === "overdue";
  if (filter === "nodate") return section === "nodate";
  return p.purposes.includes(filter);
}

/** "Find a person": the name holds the typed text, any letter case; an empty box matches everyone. */
export function matchesPersonSearch(p: { name: string; organization?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || p.name.toLowerCase().includes(q) || String(p.organization ?? "").toLowerCase().includes(q);
}

export function outreachFilterCounts(people: readonly OutreachPerson[], today: string): Record<OutreachFilter, number> {
  const out = {} as Record<OutreachFilter, number>;
  for (const f of OUTREACH_FILTERS) out[f.key] = people.filter((p) => matchesOutreachFilter(p, f.key, today)).length;
  return out;
}

export const DEFAULT_OUTREACH_TARGET = 10;

/** Monday to Friday of the week that holds `today` (YYYY-MM-DD, inclusive). */
export function workWeek(today: string): { start: string; end: string } {
  const { start } = weekBounds(today);
  return { start, end: addDaysISO(start, 4) };
}

/** "email", "call", "meeting", "video call", "text" for the LAST CONTACT figure. */
export function contactKindLabel(kind: string | null | undefined): string {
  return kind === "video" ? "video call" : kind === "email" ? "email" : kind === "call" ? "call" : kind === "meeting" ? "meeting" : kind === "text" ? "text" : "contact";
}

/** "Oct 20 · email", "Today · call", or "Never" for the LAST CONTACT figure. */
export function lastContactLabel(at: string | null | undefined, kind: string | null | undefined, today: string, fmt: (d: string) => string): string {
  if (!at) return "Never";
  const d = at.slice(0, 10);
  return `${d === today ? "Today" : fmt(d)} · ${contactKindLabel(kind)}`;
}

/** "Today", "Oct 29" (red when overdue), "None" for the NEXT FOLLOW-UP figure. */
export function nextFollowUpLabel(date: string | null | undefined, today: string, fmt: (d: string) => string): { text: string; tone: "today" | "over" | "later" | "none" } {
  if (!date) return { text: "None", tone: "none" };
  const d = date.slice(0, 10);
  if (d === today) return { text: "Today", tone: "today" };
  if (d < today) return { text: fmt(d), tone: "over" };
  return { text: fmt(d), tone: "later" };
}

/** "Overdue by 2 days", "Due today", "Due Nov 7", "No date set": the hint on the Next follow-up card. */
export function followUpHint(date: string | null | undefined, today: string, fmt: (d: string) => string): string {
  if (!date) return "No date set";
  const d = date.slice(0, 10);
  const diff = daysBetween(today, d);
  if (diff === 0) return "Due today";
  if (diff < 0) return `Overdue by ${-diff} ${-diff === 1 ? "day" : "days"}`;
  return `Due ${fmt(d)}`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday of a date (YYYY-MM-DD), "Mon" to "Sun". */
export function weekdayShort(date: string): string {
  return WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/**
 * The next follow-up dates Done offers: the next weekday after tomorrow's weekend skip ("in 3 days" moved off a
 * weekend), the Monday after next, and one month on. Each with its weekday, so the choice reads "Nov 3 (Mon)".
 */
export function nextDateChoices(today: string): { date: string; label: (fmt: (d: string) => string) => string }[] {
  const skipWeekend = (d: string) => {
    const w = weekdayShort(d);
    return w === "Sat" ? addDaysISO(d, 2) : w === "Sun" ? addDaysISO(d, 1) : d;
  };
  const soon = skipWeekend(addDaysISO(today, 3));
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nextMonday = addDaysISO(today, ((8 - dow) % 7 || 7) + 7);
  const month = skipWeekend(addDaysISO(today, 30));
  const seen = new Set<string>();
  return [soon, nextMonday, month]
    .filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
    .map((date) => ({ date, label: (fmt) => `${fmt(date)} (${weekdayShort(date)})` }));
}

/**
 * "Transworld · Broker, East Tennessee": the organization, the role, and the title on one line. A title that starts
 * with the role word is not repeated ("Broker, East Tennessee" stays as typed); the role Other shows only the title.
 */
export function orgRoleLine(p: { organization: string | null; roleLabel: string | null; title: string | null }): string {
  const role = p.roleLabel && p.roleLabel !== "Other" ? p.roleLabel : null;
  const title = String(p.title ?? "").trim() || null;
  const repeats = !!role && !!title && title.toLowerCase().startsWith(role.toLowerCase());
  const line = repeats ? title : [role, title].filter(Boolean).join(", ");
  return [p.organization, line].filter(Boolean).join(" · ");
}

/** "2 overdue", "1 overdue", "" for the Outreach tile's foot line. */
export function overdueLabel(n: number): string {
  return n ? `${n} overdue` : "";
}

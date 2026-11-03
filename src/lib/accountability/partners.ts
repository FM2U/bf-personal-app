/**
 * Accountability partners (push B, 2026-11-03): a person with the role Accountability partner gets the End of day
 * report on the weekdays chosen on their page, with only the sections ticked there. Several partners can be due on
 * the same day; each gets their own copy. Pure and tested in src/lib/accountability/partners.test.ts.
 */

/** The report's sections, as the End of day report has them (src/lib/accountability/report-email.ts). */
export const REPORT_SECTIONS = [
  { key: "today", label: "Today's counts", hint: "Listings screened, deals moved, calls, emails" },
  { key: "targets", label: "Targets", hint: "Met, under way, missed, with reasons" },
  { key: "waiting", label: "Deals waiting on brokers", hint: "Waiting longer than the amber mark" },
  { key: "moved", label: "Deals moved", hint: "Stage changes that day, with the key finding" },
  { key: "tomorrow", label: "Tomorrow's line", hint: null },
  { key: "week", label: "The week", hint: "Fridays: the week's figures" },
] as const;
export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export const ALL_SECTIONS: ReportSectionKey[] = REPORT_SECTIONS.map((s) => s.key);

/** Monday to Friday as stored (ISO weekday numbers). */
export const REPORT_WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
] as const;
const WEEKDAY_NUMBERS: number[] = REPORT_WEEKDAYS.map((d) => d.n);

export type PartnerReportSettings = { days: number[]; sections: ReportSectionKey[] };

const isSection = (v: unknown): v is ReportSectionKey => ALL_SECTIONS.includes(v as ReportSectionKey);

/**
 * The days and sections saved on a partner. Never set (both empty, a partner added before push B or just given the
 * role): every weekday, every section. Saving always keeps at least one section, so both empty means never set.
 * Unknown section keys (a section added later, such as the weekly review answers) are kept out of the checklist.
 */
export function partnerSettings(row: { report_days?: unknown; report_sections?: unknown }): PartnerReportSettings {
  const days = Array.isArray(row.report_days) ? [...new Set(row.report_days.map(Number).filter((n) => WEEKDAY_NUMBERS.includes(n)))].sort() : [];
  const sections = Array.isArray(row.report_sections) ? ALL_SECTIONS.filter((k) => (row.report_sections as unknown[]).includes(k)) : [];
  const rawEmpty = (!Array.isArray(row.report_days) || !row.report_days.length) && (!Array.isArray(row.report_sections) || !row.report_sections.length);
  if (rawEmpty) return { days: [...WEEKDAY_NUMBERS], sections: [...ALL_SECTIONS] };
  return { days, sections };
}

/** What Save on the Reports card stores: the weekdays in order; the ticked sections, plus any saved key this version does not know. */
export function cleanPartnerSettings(input: { days: unknown; sections: unknown }, savedSections: unknown): { ok: true; days: number[]; sections: string[] } | { ok: false; error: string } {
  const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((n) => WEEKDAY_NUMBERS.includes(n)))].sort() : [];
  const sections = Array.isArray(input.sections) ? ALL_SECTIONS.filter((k) => (input.sections as unknown[]).includes(k)) : [];
  if (!sections.length) return { ok: false, error: "Tick at least one section." };
  const kept = Array.isArray(savedSections) ? savedSections.map(String).filter((k) => !isSection(k)) : [];
  return { ok: true, days, sections: [...sections, ...kept] };
}

/** The ISO weekday of a date (YYYY-MM-DD): 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The partners who get the report on this day (their days include its weekday), in the order given. */
export function partnersDueOn<T extends { days: readonly number[] }>(partners: readonly T[], day: string): T[] {
  const w = isoWeekday(day);
  return partners.filter((p) => p.days.includes(w));
}

/** "every weekday", "Fridays", "Mon, Wed, Fri", or "no days". */
export function daysLabel(days: readonly number[]): string {
  const list = REPORT_WEEKDAYS.filter((d) => days.includes(d.n));
  if (list.length === 5) return "every weekday";
  if (!list.length) return "no days";
  if (list.length === 1) return { 1: "Mondays", 2: "Tuesdays", 3: "Wednesdays", 4: "Thursdays", 5: "Fridays" }[list[0].n] ?? list[0].label;
  return list.map((d) => d.label).join(", ");
}

/** The short form for a sentence: "weekdays", "Fridays", "Mon, Wed, Fri", "no days". */
function daysShort(days: readonly number[]): string {
  const l = daysLabel(days);
  return l === "every weekday" ? "weekdays" : l;
}

/** The line next to Approve and send: "Only Jake is due today", "Jake gets weekdays; Sarah gets Fridays", "No partner is due today". */
export function dueLine(partners: readonly { first: string; days: readonly number[] }[], day: string): string {
  const due = partnersDueOn(partners, day);
  if (!due.length) return partners.length ? "No partner is due today" : "No accountability partner yet";
  if (due.length === 1) return partners.length === 1 ? `${due[0].first} gets ${daysShort(due[0].days)}` : `Only ${due[0].first} is due today`;
  return due.map((p) => `${p.first} gets ${daysShort(p.days)}`).join("; ");
}

/** "Approve and send" for one partner, "Approve and send to 2" for several. */
export function sendLabel(n: number): string {
  return n > 1 ? `Approve and send to ${n}` : "Approve and send";
}

/** Whether a section is in the report for these sections (null: every section, for reports built before push B). */
export function hasSection(sections: readonly string[] | null | undefined, key: ReportSectionKey): boolean {
  return !sections || sections.includes(key);
}

/** The first name of a person ("Jake" from "Jake Morgan"). */
export function firstName(name: string): string {
  return name.split(/[\s,(]+/)[0] || name;
}

/**
 * The partner's next report day (the NEXT REPORT figure on their page): today when today is one of their days and
 * the day is not closed yet, otherwise the next of their weekdays. Null when they get the report on no day.
 */
export function nextReportDay(days: readonly number[], today: string, todayClosed: boolean): string | null {
  if (!days.length) return null;
  for (let i = todayClosed ? 1 : 0; i <= 7; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (days.includes(isoWeekday(iso))) return iso;
  }
  return null;
}

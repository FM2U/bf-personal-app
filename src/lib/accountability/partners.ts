/**
 * Accountability partners (push B, 2026-11-03): a person with the role Accountability partner gets the End of day
 * report on the weekdays chosen on their page, with only the sections ticked there. Several partners can be due on
 * the same day; each gets their own copy. Pure and tested in src/lib/accountability/partners.test.ts.
 */
import { workWeekNow } from "@/lib/work-week";

/**
 * The report's sections, as the End of day report has them (src/lib/accountability/report-sections.ts), in the
 * email's order. Push B edits: Top 3 deals, Active today, and Job search added (on for a new partner); "Deals moved"
 * became part of Active today (a saved "moved" reads as Active today).
 */
export const REPORT_SECTIONS = [
  { key: "today", label: "Today's counts", hint: "Listings screened, deals moved, calls, emails" },
  { key: "targets", label: "Targets", hint: "Met, under way, missed, with reasons" },
  { key: "top", label: "Top 3 deals", hint: "The 3 deals furthest along: stage, status, next step" },
  { key: "active", label: "Active today", hint: "Other deals worked on that day (Fridays: that week)" },
  { key: "waiting", label: "Deals waiting on brokers", hint: "Waiting longer than the amber mark" },
  { key: "jobs", label: "Job search", hint: "The top 3 opportunities and the ones worked on" },
  { key: "week", label: "The week", hint: "Fridays: the week's figures" },
  { key: "review", label: "Weekly review", hint: "Fridays: what went well, what slipped, next week's focus" },
  { key: "tomorrow", label: "Tomorrow's line", hint: null },
] as const;
export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export const ALL_SECTIONS: ReportSectionKey[] = REPORT_SECTIONS.map((s) => s.key);

/** Section keys saved before a rename, and the key they are now. */
const RENAMED_SECTIONS: Record<string, ReportSectionKey> = { moved: "active" };
const readSections = (v: unknown[]): unknown[] => v.map((k) => RENAMED_SECTIONS[String(k)] ?? k);

/** Monday to Sunday as stored (ISO weekday numbers); the weekend days since the work week setting (2026-11-07). */
export const REPORT_WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
] as const;
const WEEKDAY_NUMBERS: number[] = REPORT_WEEKDAYS.map((d) => d.n);

export type PartnerReportSettings = { days: number[]; sections: ReportSectionKey[] };

const isSection = (v: unknown): v is ReportSectionKey => ALL_SECTIONS.includes(v as ReportSectionKey);

/**
 * The days and sections saved on a partner. Never set (both empty, a partner added before push B or just given the
 * role): every weekday, every section. Saving always keeps at least one section, so both empty means never set.
 * Unknown section keys are kept out of the checklist. Push D: the Weekly review is on unless it was unticked (saved
 * as REVIEW_OFF), so a partner saved before it existed gets it on Fridays.
 */
export function partnerSettings(row: { report_days?: unknown; report_sections?: unknown }): PartnerReportSettings {
  const days = Array.isArray(row.report_days) ? [...new Set(row.report_days.map(Number).filter((n) => WEEKDAY_NUMBERS.includes(n)))].sort() : [];
  const raw = Array.isArray(row.report_sections) ? readSections(row.report_sections as unknown[]) : [];
  const reviewOn = raw.length > 0 && !raw.includes(REVIEW_OFF);
  const sections = ALL_SECTIONS.filter((k) => raw.includes(k) || (k === "review" && reviewOn));
  const rawEmpty = (!Array.isArray(row.report_days) || !row.report_days.length) && (!Array.isArray(row.report_sections) || !row.report_sections.length);
  // Never set: your work days (Settings, Work settings; Monday to Friday unless changed).
  if (rawEmpty) return { days: [...workWeekNow().days], sections: [...ALL_SECTIONS] };
  return { days, sections };
}

/** Saved in report_sections when the Weekly review is unticked (push D): it is on by default, so the choice is kept. */
export const REVIEW_OFF = "review_off";

/**
 * What Save on the Reports card stores: the weekdays in order; the ticked sections (REVIEW_OFF when the Weekly review
 * is not ticked), plus any saved key this version does not know.
 */
export function cleanPartnerSettings(input: { days: unknown; sections: unknown }, savedSections: unknown): { ok: true; days: number[]; sections: string[] } | { ok: false; error: string } {
  const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number).filter((n) => WEEKDAY_NUMBERS.includes(n)))].sort() : [];
  const sections = Array.isArray(input.sections) ? ALL_SECTIONS.filter((k) => (input.sections as unknown[]).includes(k)) : [];
  if (!sections.length) return { ok: false, error: "Tick at least one section." };
  const kept = Array.isArray(savedSections) ? savedSections.map(String).filter((k) => !isSection(k) && !RENAMED_SECTIONS[k] && k !== REVIEW_OFF) : [];
  return { ok: true, days, sections: [...sections, ...(sections.includes("review") ? [] : [REVIEW_OFF]), ...kept] };
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
  if (list.length === 7) return "every day";
  if (list.length === 5 && list.every((d) => d.n <= 5)) return "every weekday";
  if (!list.length) return "no days";
  if (list.length === 1) return { 1: "Mondays", 2: "Tuesdays", 3: "Wednesdays", 4: "Thursdays", 5: "Fridays", 6: "Saturdays", 7: "Sundays" }[list[0].n] ?? list[0].label;
  return list.map((d) => d.label).join(", ");
}

/** The short form for a sentence: "weekdays", "Fridays", "Mon, Wed, Fri", "no days". */
function daysShort(days: readonly number[]): string {
  const l = daysLabel(days);
  return l === "every weekday" ? "weekdays" : l === "every day" ? "every day" : l;
}

/** The Gets column of the partner table on End of day: "Weekdays", "Fridays", "Mon, Wed, Fri", "No days". */
export function getsLabel(days: readonly number[]): string {
  const l = daysShort(days);
  return l.charAt(0).toUpperCase() + l.slice(1);
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

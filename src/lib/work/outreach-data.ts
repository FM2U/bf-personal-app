import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { buildFacts } from "@/lib/accountability/facts";
import { countIn } from "@/lib/accountability/targets";
import { loadComposeSetup, loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import type { Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { isValidEmail } from "@/lib/email-address";
import { DEFAULT_OUTREACH_TARGET, normalizeRole, outreachSections, parsePurposes, roleLabel, workWeek, type PurposeKey } from "@/lib/work/outreach";
import { weekCountFrom } from "@/lib/work-week";
import { readWorkInputs, workInputs } from "@/lib/work/data";
import { commKind, commTitle, type TimelineEvent } from "@/lib/work/timeline";
import { nextReportDay, partnerSettings, type ReportSectionKey } from "@/lib/accountability/partners";
import { RECORD_TASK_COLUMNS, sortTodos, toDealTodo, type DealTodo } from "@/lib/work/todos";
import { DEFAULT_EOD_TIME, parseTime } from "@/lib/work/settings";
import { DEFAULT_WAIT_THRESHOLD_DAYS } from "@/lib/work/stages";
import { waitLines, type WaitLine } from "@/lib/work/waiting";
import { loadWaitReplies, loadWaitsFor, withReplies } from "@/lib/work/waits-data";
import type { Row } from "@/lib/types";
import { workWeekNow } from "@/lib/work-week";

/**
 * What the Outreach page, the person page, and the Outreach tile on Home read (batch B, database update 0022).
 * Outreach is the working view of the contacts table: every contact that is not archived is a person here. The
 * next follow-up date and what it is for are the contact's follow_up_date and follow_up_note; the one-line note is
 * the first line of the contact's notes; the last contact is kept on the contact by the database (from the logged
 * emails and calls). Nothing here writes; the actions are in src/app/actions/outreach.ts.
 */

/** One person as the Outreach rows, the Home tile, and the person page show them. Plain data for client components. */
export type PersonRow = {
  id: string;
  name: string;
  organizationId: string | null;
  organization: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  /** The contact's title ("COO", "Broker, East Tennessee"), shown after the role. */
  title: string | null;
  purposes: PurposeKey[];
  /** The one-line note (the first line of the contact's notes). */
  note: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  /** YYYY-MM-DD or null. */
  nextFollowUp: string | null;
  followUpFor: string | null;
  /** ISO timestamp of the last logged email or call, its date in the owner's time zone (YYYY-MM-DD), and its kind. */
  lastContactAt: string | null;
  lastContactOn: string | null;
  lastContactKind: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  /** Push E2: what this person is being waited on for, one line per wait, longest first (empty when nothing, or before the update). */
  waits: WaitLine[];
};

export const CONTACT_COLUMNS = "id,name,organization_id,outreach_role,title,purposes,notes,email,phone,linkedin_url,follow_up_date,follow_up_note,last_contact_at,last_contact_kind,archived_at,created_at";

export function toPersonRow(c: Row, orgName: string | null, tz: string, waits: WaitLine[] = []): PersonRow {
  const note = String(c.notes ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  return {
    id: String(c.id),
    name: String(c.name ?? ""),
    organizationId: c.organization_id ? String(c.organization_id) : null,
    organization: orgName,
    roleKey: normalizeRole(c.outreach_role as string | null),
    roleLabel: roleLabel(c.outreach_role as string | null),
    title: c.title ? String(c.title) : null,
    purposes: parsePurposes(c.purposes),
    note: note ? note.slice(0, 200) : null,
    email: c.email ? String(c.email) : null,
    phone: c.phone ? String(c.phone) : null,
    linkedin: c.linkedin_url ? String(c.linkedin_url) : null,
    nextFollowUp: c.follow_up_date ? String(c.follow_up_date).slice(0, 10) : null,
    followUpFor: c.follow_up_note ? String(c.follow_up_note) : null,
    lastContactAt: c.last_contact_at ? String(c.last_contact_at) : null,
    lastContactOn: c.last_contact_at ? todayInTz(tz, new Date(String(c.last_contact_at))) : null,
    lastContactKind: c.last_contact_kind ? String(c.last_contact_kind) : null,
    archived: !!c.archived_at,
    archivedAt: c.archived_at ? String(c.archived_at) : null,
    createdAt: String(c.created_at ?? ""),
    waits,
  };
}

/**
 * The weekly outreach target (Bram, 2026-11-08: one number): the Network outreach target on Targets (per week, or per
 * work day times the work days), else the older setting outreach_weekly_target, else 10.
 */
async function loadOutreachTarget(sb: SupabaseClient, ownerId: string): Promise<number> {
  const [{ data: t }, { data }] = await Promise.all([
    sb.from("targets").select("period,minimum_count").eq("owner_id", ownerId).eq("counts_key", "outreach_contacts").is("archived_at", null).order("sort_order").limit(1),
    sb.from("inputs").select("value_number").eq("owner_id", ownerId).eq("key", "outreach_weekly_target").maybeSingle(),
  ]);
  const row = ((t ?? []) as Row[])[0];
  const fromTarget = Number(row?.minimum_count);
  if (row && Number.isFinite(fromTarget) && fromTarget > 0) return Math.round(row.period === "day" ? fromTarget * workWeekNow().days.length : fromTarget);
  const n = Number((data as Row | null)?.value_number);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_OUTREACH_TARGET;
}

type OutreachCounter = { count: number; target: number; pct: number };

/**
 * The weekly counter: emails sent and calls logged to people this week (the owner's dates), counted from the day after
 * the previous week's last work day (Bram, 2026-11-09: weekend work counts toward the coming week), as the target is.
 */
async function loadOutreachCounter(sb: SupabaseClient, ctx: Ctx): Promise<OutreachCounter> {
  const week = workWeek(ctx.today);
  const start = weekCountFrom(week.start);
  const end = week.end;
  const [{ data }, target, { data: inputs }] = await Promise.all([
    sb.from("communications").select("occurred_at,method,direction,contact_id,awaiting_log").eq("owner_id", ctx.ownerId).gte("occurred_at", `${start}T00:00:00Z`).limit(2000),
    loadOutreachTarget(sb, ctx.ownerId),
    readWorkInputs(sb, ctx.ownerId),
  ]);
  // Never before Counting starts on (2026-11-09), as the Targets page counts.
  const countingStart = workInputs((inputs ?? []) as Row[]).countingStart;
  // Counted by the same function as the Network outreach target (Edit batch C, item 6), so the counter, the target, and
  // End of day always agree.
  const { facts } = buildFacts({ items: [], history: [], comms: (data ?? []) as Row[], events: [], people: [], stageById: {}, laneOf: {}, since: start, local: (ts) => todayInTz(ctx.tz, new Date(ts)) });
  const t = Number.isFinite(target) && target > 0 ? Math.round(target) : DEFAULT_OUTREACH_TARGET;
  const count = countIn("outreach_contacts", facts, countingStart && countingStart > start ? countingStart : start, end).value;
  return { count, target: t, pct: Math.min(100, Math.round((count / t) * 100)) };
}

export async function loadPeople(sb: SupabaseClient, ownerId: string, tz: string): Promise<PersonRow[]> {
  const [{ data, error }, { data: orgs }] = await Promise.all([
    sb.from("contacts").select(CONTACT_COLUMNS).eq("owner_id", ownerId).order("name").limit(2000),
    sb.from("organizations").select("id,name").eq("owner_id", ownerId).limit(2000),
  ]);
  if (error) throw new Error(error.message);
  const orgName = Object.fromEntries(((orgs ?? []) as Row[]).map((o) => [String(o.id), String(o.name)]));
  return ((data ?? []) as Row[]).map((c) => toPersonRow(c, c.organization_id ? orgName[String(c.organization_id)] ?? null : null, tz));
}

/** The email setup for one person (the Email button on a row): to the person, logged to the contact. */
export function composeForPerson(gmail: GmailSetup, p: PersonRow): ComposeSetup {
  const valid = !!p.email && isValidEmail(p.email);
  return {
    ...gmail,
    title: `Email ${p.name}`,
    recipients: valid ? [{ contactId: p.id, name: p.name, email: p.email!.trim(), role: "This person" }] : [],
    defaultTo: valid ? p.email!.trim() : "",
    contactId: p.id,
    pipelineItemId: null,
    organizationId: null,
    toNote: valid ? null : "This person has no email address saved. Type one here, or add it on their page.",
  };
}

export type OutreachData = {
  today: string;
  tz: string;
  people: PersonRow[];
  archived: PersonRow[];
  counter: OutreachCounter;
  /** The email setup per person with an address (Email on a row). */
  composes: Record<string, ComposeSetup>;
};

/** The Outreach page: every person (archived apart), the counter, and the email setup per person. */
export async function loadOutreach(sb: SupabaseClient, ctx: Ctx): Promise<OutreachData> {
  const [all, counter, gmail] = await Promise.all([loadPeople(sb, ctx.ownerId, ctx.tz), loadOutreachCounter(sb, ctx), loadGmailSetup(sb, ctx.ownerId)]);
  const people = all.filter((p) => !p.archived);
  return {
    today: ctx.today,
    tz: ctx.tz,
    people,
    archived: all.filter((p) => p.archived),
    counter,
    composes: Object.fromEntries(people.map((p) => [p.id, composeForPerson(gmail, p)])),
  };
}

/** The Outreach tile on Home and the outreach rows on Next actions. */
export type OutreachHome = {
  counter: OutreachCounter;
  /** Up to three people due today (the tile). */
  dueToday: PersonRow[];
  /** Everyone due today or overdue (the rows on Next actions), overdue first, then by name. */
  due: PersonRow[];
  /** Fix list item 3 (2026-11-06): everyone with a follow-up date after today (Home's Due later), soonest first. */
  later: PersonRow[];
  overdue: number;
};

export async function loadOutreachHome(sb: SupabaseClient, ctx: Ctx): Promise<OutreachHome> {
  const [all, counter] = await Promise.all([loadPeople(sb, ctx.ownerId, ctx.tz), loadOutreachCounter(sb, ctx)]);
  const s = outreachSections(all, ctx.today);
  return { counter, dueToday: s.today.slice(0, 3), due: [...s.overdue, ...s.today], later: [...s.week, ...s.later], overdue: s.overdue.length };
}

/** People due today or overdue: the amber badge on the Outreach tab. Null before update 0022. */
export async function countOutreachDue(sb: SupabaseClient, ownerId: string, today: string): Promise<number | null> {
  const { count, error } = await sb.from("contacts").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).is("archived_at", null).lte("follow_up_date", today);
  if (error) return null;
  return count ?? 0;
}

/** An incoming reply not yet on the timeline (the Incoming card). */
export type IncomingReply = { id: string; date: string; subject: string; excerpt: string | null };

/** A deal, opportunity, or consulting item this person is the main contact of (a line in Facts). */
export type PersonRecordLink = { id: string; name: string; href: string; kind: string };

/** The Reports card and figures of an accountability partner's page (push B). */
export type PartnerInfo = { days: number[]; sections: ReportSectionKey[]; sent: number; replies: number; lastSentOn: string | null; lastReplyOn: string | null; nextReport: string | null; todayOpen: boolean; /** Push D: the End of day time ("17:30", Settings, Work settings). */ eodTime: string };

type PersonPageData = {
  available: boolean;
  partner: PartnerInfo | null;
  notice: string | null;
  today: string;
  tz: string;
  person: PersonRow | null;
  timeline: TimelineEvent[];
  incoming: IncomingReply[];
  tasks: DealTodo[];
  records: PersonRecordLink[];
  compose: ComposeSetup | null;
  /** False before UPDATE_PREVIEW_PUSH_E2.sql (the waits list on Next follow-up says so and cannot save). */
  waitsReady: boolean;
};

const TASK_COLUMNS = RECORD_TASK_COLUMNS;

function toTask(t: Row): DealTodo {
  return toDealTodo(t);
}

/** The person page: the person, the timeline (notes, emails, calls; newest first), incoming replies, tasks, records, and the email setup. */
export async function loadPersonPage(sb: SupabaseClient, ctx: Ctx, id: string): Promise<PersonPageData> {
  const base: PersonPageData = { available: true, partner: null, notice: null, today: ctx.today, tz: ctx.tz, person: null, timeline: [], incoming: [], tasks: [], records: [], compose: null, waitsReady: false };
  const { data: row } = await sb.from("contacts").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  const c = row as Row | null;
  if (!c) return base;
  const [{ data: org }, { data: notes }, { data: comms }, { data: taskRows }, { data: items }, { data: pipes }, compose, waits] = await Promise.all([
    c.organization_id ? sb.from("organizations").select("id,name").eq("id", c.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("notes").select("id,body,created_at").eq("record_type", "contacts").eq("record_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,call_outcome,awaiting_log,pipeline_item_id,partner_report_id").eq("contact_id", id).order("occurred_at", { ascending: false }).limit(80),
    sb.from("deal_todos").select(TASK_COLUMNS).eq("owner_id", ctx.ownerId).eq("record_type", "contacts").eq("record_id", id).limit(500),
    sb.from("pipeline_items").select("id,name,company_name,pipeline_id,status").eq("owner_id", ctx.ownerId).eq("primary_contact_id", id).limit(50),
    sb.from("pipelines").select("id,kind").eq("owner_id", ctx.ownerId),
    loadComposeSetup(sb, ctx.ownerId, "contacts", c).catch(() => null),
    loadWaitsFor(sb, ctx.ownerId, { contactIds: [id] }),
  ]);
  // Edits of Nov 5 (item 6): Replied and Clear on a wait whose email has a reply.
  const replied = await loadWaitReplies(sb, ctx.ownerId, waits.byContact[id] ?? [], ctx.tz);
  const person = toPersonRow(c, (org as Row | null)?.name ? String((org as Row).name) : null, ctx.tz, withReplies(waitLines(waits.byContact[id] ?? [], ctx.today, DEFAULT_WAIT_THRESHOLD_DAYS), replied));
  const commRows = (comms ?? []) as Row[];
  // Push B: the End of day reports sent to this person and the replies to them (an accountability partner).
  const isPartner = c.outreach_role === "accountability_partner";
  const { data: reportRows } = isPartner || commRows.some((m) => m.partner_report_id) ? await sb.from("partner_reports").select("id,period_start,sent_at,partner_comment,comment_at").eq("owner_id", ctx.ownerId).eq("contact_id", id).eq("report_kind", "end_of_day").order("sent_at", { ascending: false }).limit(400) : { data: [] as Row[] };
  const reports = (reportRows ?? []) as Row[];
  const reportDay = new Map(reports.map((r) => [String(r.id), String(r.period_start).slice(0, 10)]));
  const reportHref = (day: string) => `/work/reports?view=sent&day=${day}`;
  const dayWord = (day: string) => fmtDate(day, "EEEE");
  const reportEvents: TimelineEvent[] = commRows
    .filter((m) => m.partner_report_id && reportDay.has(String(m.partner_report_id)))
    .map((m) => {
      const day = reportDay.get(String(m.partner_report_id))!;
      const incoming = m.direction === "incoming";
      return { id: `comm:${m.id}`, kind: incoming ? ("reply" as const) : ("report" as const), when: String(m.occurred_at), date: fmtDate(String(m.occurred_at), "MMM d"), title: incoming ? `Reply to ${dayWord(day)}'s report` : `Report sent: ${fmtDate(day, "EEEE, MMM d")}`, detail: incoming ? String(m.summary ?? "").slice(0, 400) || null : null, quote: incoming, href: null, link: incoming ? { href: reportHref(day), label: "Open the report" } : null };
    });
  // A reply recorded on the report before push B (the batch C sample data), when no Gmail reply is stored for it.
  const repliedReports = new Set(commRows.filter((m) => m.direction === "incoming" && m.partner_report_id).map((m) => String(m.partner_report_id)));
  for (const r of reports) {
    if (!r.partner_comment || repliedReports.has(String(r.id))) continue;
    const day = String(r.period_start).slice(0, 10);
    const at = String(r.comment_at ?? r.sent_at);
    reportEvents.push({ id: `comment:${r.id}`, kind: "reply", when: at, date: fmtDate(at, "MMM d"), title: `Reply to ${dayWord(day)}'s report`, detail: String(r.partner_comment).slice(0, 400), quote: true, href: null, link: { href: reportHref(day), label: "Open the report" } });
  }
  // Reports sent before push B have no communication linked to them: one line per report.
  const linked = new Set(commRows.filter((m) => m.partner_report_id && m.direction !== "incoming").map((m) => String(m.partner_report_id)));
  for (const r of reports) {
    if (linked.has(String(r.id)) || !r.sent_at) continue;
    const day = String(r.period_start).slice(0, 10);
    reportEvents.push({ id: `report:${r.id}`, kind: "report", when: String(r.sent_at), date: fmtDate(String(r.sent_at), "MMM d"), title: `Report sent: ${fmtDate(day, "EEEE, MMM d")}`, detail: null, href: null, link: null });
  }
  const timeline: TimelineEvent[] = [
    ...((notes ?? []) as Row[]).map((n) => ({ id: `note:${n.id}`, kind: "note" as const, when: String(n.created_at), date: fmtDate(String(n.created_at), "MMM d"), title: "Note", detail: String(n.body ?? "").slice(0, 400) || null, href: null })),
    ...reportEvents,
    ...commRows
      .filter((m) => !m.awaiting_log && !(m.partner_report_id && reportDay.has(String(m.partner_report_id))))
      .map((m) => ({
        id: `comm:${m.id}`,
        kind: commKind(m.method),
        when: String(m.occurred_at),
        date: fmtDate(String(m.occurred_at), "MMM d"),
        title: commTitle(m),
        detail: [m.summary ? String(m.summary).slice(0, 240) : null, m.call_outcome ? `Next: ${String(m.call_outcome).slice(0, 160)}` : null].filter(Boolean).join(" ") || null,
        href: null,
      })),
  ].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  const incoming: IncomingReply[] = commRows
    .filter((m) => m.awaiting_log)
    .map((m) => ({ id: String(m.id), date: fmtDate(String(m.occurred_at), "MMM d"), subject: String(m.subject ?? "(No subject)").slice(0, 140), excerpt: m.summary ? String(m.summary).slice(0, 200) : null }));
  const kindOf = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [String(p.id), String(p.kind)]));
  const records: PersonRecordLink[] = ((items ?? []) as Row[])
    .filter((i) => i.status === "open")
    .map((i) => {
      const kind = kindOf[String(i.pipeline_id)] ?? "other";
      return { id: String(i.id), name: String(i.company_name || i.name), kind, href: kind === "acquisition" ? `/work/deals/${i.id}` : kind === "job" ? `/work/jobs/${i.id}` : kind === "consulting" ? `/work/consulting/${i.id}` : `/work/deals/${i.id}` };
    });
  let partner: PartnerInfo | null = null;
  if (isPartner) {
    const s = partnerSettings(c);
    const replyDates = reportEvents.filter((e) => e.kind === "reply").map((e) => e.when).sort();
    const [{ data: eod }, { data: eodTimeRow }] = await Promise.all([sb.from("end_of_day").select("status").eq("owner_id", ctx.ownerId).eq("day", ctx.today).maybeSingle(), sb.from("inputs").select("value_text").eq("owner_id", ctx.ownerId).eq("key", "end_of_day_time").maybeSingle()]);
    const todayClosed = !!eod && (eod as Row).status !== "open";
    const lastSent = reports.find((r) => r.sent_at)?.sent_at as string | undefined;
    partner = {
      days: s.days,
      sections: s.sections,
      sent: reports.filter((r) => r.sent_at).length,
      replies: replyDates.length,
      lastSentOn: lastSent ? todayInTz(ctx.tz, new Date(lastSent)) : null,
      lastReplyOn: replyDates.length ? todayInTz(ctx.tz, new Date(replyDates[replyDates.length - 1])) : null,
      nextReport: nextReportDay(s.days, ctx.today, todayClosed),
      todayOpen: !todayClosed,
      eodTime: parseTime((eodTimeRow as Row | null)?.value_text) ?? DEFAULT_EOD_TIME,
    };
  }
  return { ...base, partner, person, timeline, incoming, tasks: sortTodos(((taskRows ?? []) as Row[]).map(toTask)), records, compose: compose ? { ...compose, title: `Email ${person.name}` } : null, waitsReady: waits.available };
}

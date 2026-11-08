import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/engine/helpers";
import { isValidEmail } from "@/lib/email-address";
import { isGoogleConfigured } from "@/lib/env";
import { explainGoogleError } from "@/lib/google-errors";
import { getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { sendPermission } from "@/lib/google-scopes";
import { sentEmailCommunication } from "@/lib/calc/sent-email";
import { AUTO_KEY, EXTRAS_KEY, loadEndOfDay, NO_EXTRAS, type EndOfDayPage, type ReportExtras } from "@/lib/accountability/data";
import { REPORT_SECTIONS, type ReportSectionKey } from "@/lib/accountability/partners";
import { reportFor, reportInnerHtml, reportSubject, reportText, type ReportData } from "@/lib/accountability/report-email";
import { cleanChoices, cleanNotes, sentSections, type ReportChoices, type ReportNotes } from "@/lib/accountability/report-sections";
import { noReasonText, owedReasons, reportSummary } from "@/lib/accountability/targets";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

/**
 * Sending the report (one place for every way it goes out, 2026-11-08): Approve and send (End of day), the automatic
 * send at the send time (the report job, src/lib/accountability/auto-report.ts), and the sends to other people (Also
 * send to, an earlier day). These take the database client and the owner's context, so they work from the signed-in
 * window and from the scheduled job alike. The server actions in src/app/actions/ check the sign-in, then call these.
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const INTRO_MAX = 1200;
const SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key) as ReportSectionKey[];

export type SendReportTo = { contactId: string } | { email: string; name: string; save: boolean };

/** The day's End of day row, made when missing; a message when it cannot be made. */
export async function ensureEodRow(sb: SupabaseClient, ctx: Ctx, day: string): Promise<Row | string> {
  if (!DATE.test(day)) return "The day was not valid.";
  const { data } = await sb.from("end_of_day").select("*").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle();
  if (data) return data as Row;
  const { data: made, error } = await sb.from("end_of_day").insert({ owner_id: ctx.ownerId, day }).select("*").single();
  if (error) return `Not saved: ${error.message}`;
  return made as Row;
}

/** Reasons still owed today: today's missed commitments, and the day before's left as "(still to give)". */
export function owedCount(page: EndOfDayPage): number {
  const todays = owedReasons(page.judged, page.reasons).length;
  const prev = page.owed ? page.owed.items.filter((j) => !String(page.reasons[`owed:${page.owed!.day}:${j.targetId}`] ?? "").trim()).length : 0;
  return todays + prev;
}

/** What stays in report_edits once the day is sent: the people under Also send to (until their own send) and the automatic send's record. */
function keptAfterSend(v: unknown): Record<string, unknown> {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(o).filter(([k]) => k === EXTRAS_KEY || k === AUTO_KEY));
}

/** Saves today's Also send to list and note under the greeting (merged into the day's report_edits). */
export async function saveExtrasCore(sb: SupabaseClient, ctx: Ctx, day: string, extras: ReportExtras): Promise<{ ok: true } | Fail> {
  const row = await ensureEodRow(sb, ctx, day);
  if (typeof row === "string") return fail(row);
  const all = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
  const empty = !extras.chosen.length && !extras.fresh.length && !extras.intro.trim();
  if (empty) delete all[EXTRAS_KEY];
  else all[EXTRAS_KEY] = extras;
  const { error } = await sb.from("end_of_day").update({ report_edits: all }).eq("id", row.id);
  return error ? fail(`Not saved: ${error.message}`) : { ok: true };
}

/** The people under Also send to as recipients. */
export function extrasTo(x: ReportExtras): SendReportTo[] {
  return [...x.chosen.map((contactId) => ({ contactId })), ...x.fresh.map((f) => ({ email: f.email, name: f.name, save: f.save }))];
}

/**
 * Sends today's report to the people saved under Also send to (the copy they were added for, or the first partner's),
 * then takes them off the list (the note under the greeting goes with them). Nothing to do when nobody is listed.
 */
export async function sendExtras(sb: SupabaseClient, ctx: Ctx, day: string, page: EndOfDayPage, requestId: string, intro: string | null = null): Promise<{ alsoTo?: string[]; alsoError?: string }> {
  const x = page.extras;
  if (!x.chosen.length && !x.fresh.length) return {};
  const from = x.from && (x.from === page.general.partner.id || page.copies.some((c) => c.partner.id === x.from)) ? x.from : (page.copies[0]?.partner.id ?? page.general.partner.id);
  const r = await sendReportCore(sb, ctx, { day, sections: [], intro: intro ?? x.intro, to: extrasTo(x), requestId, force: true, fromCopy: from });
  if (!r.ok) return { alsoError: r.error };
  await saveExtrasCore(sb, ctx, day, { ...NO_EXTRAS });
  return { alsoTo: r.sentTo };
}


/** The report of a day as sent then: the fullest data kept with that day's copies, or its email as it went out. */
export async function pastReport(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ data: ReportData | null; html: string | null; subject: string | null } | Fail> {
  const { data } = await sb.from("partner_reports").select("snapshot,sent_at").eq("owner_id", ctx.ownerId).eq("report_kind", "end_of_day").eq("period_start", day).order("sent_at").limit(20);
  const rows = (data ?? []) as Row[];
  const withData = rows.map((r) => (r.snapshot ?? {}) as Row).find((s) => s.report && typeof s.report === "object");
  if (withData) return { data: withData.report as ReportData, html: null, subject: typeof withData.subject === "string" ? withData.subject : null };
  const any = rows.map((r) => (r.snapshot ?? {}) as Row).find((s) => typeof s.html === "string");
  if (any) return { data: null, html: String(any.html), subject: typeof any.subject === "string" ? any.subject : null };
  const { data: eod } = await sb.from("end_of_day").select("report_html,report_subject").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle();
  const e = eod as Row | null;
  if (e?.report_html) return { data: null, html: String(e.report_html), subject: e.report_subject ? String(e.report_subject) : null };
  return fail(`The report of ${fmtDate(day, "EEE MMM d")} was not kept, so it cannot be sent again.`);
}

type Built = { inner: string; subject: string; text: string; asSent: boolean };

/** The copy's data: every section standing (or the given ones), the window's choices and notes, the person's name, the note under the greeting. */
export function copyData(data: ReportData, name: string, sections: readonly string[], intro: string, choices: ReportChoices | null, notes: ReportNotes | null): ReportData {
  const first = name.trim().split(/\s+/)[0] || "there";
  return { ...reportFor({ ...data, notes: notes ?? data.notes ?? {} }, { name: name || "there", first, sections }, choices), intro: intro || null };
}

/**
 * One person's copy: their first name in the greeting, the note under it, and (Bram, 2026-11-08) the same choices as
 * End of day's review window: the include box, Change, Edit and + Note on each section, for this send only.
 */
function buildFor(base: { data: ReportData | null; html: string | null; subject: string | null }, name: string, sections: readonly string[], intro: string, choices: ReportChoices | null = null, notes: ReportNotes | null = null): Built {
  if (base.data) {
    const r = copyData(base.data, name, sections, intro, choices, notes);
    return { inner: reportInnerHtml(r), subject: base.subject ?? reportSubject(r), text: reportText(r), asSent: false };
  }
  // An older day kept only as its email: sent as it went out, with the note above it.
  const note = intro ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#0f172a;margin:0 0 12px">${escape(intro).replace(/\n/g, "<br>")}</p>` : "";
  return { inner: note + String(base.html), subject: base.subject ?? "Daily report", text: `${intro ? `${intro}\n\n` : ""}(The report is in the formatted part of this email.)`, asSent: true };
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const cleanSections = (v: unknown): ReportSectionKey[] => (Array.isArray(v) ? SECTION_KEYS.filter((k) => v.includes(k)) : []);
const cleanIntro = (v: unknown) => String(v ?? "").replace(/\r/g, "").trim().slice(0, INTRO_MAX);

export async function baseFor(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ base: { data: ReportData | null; html: string | null; subject: string | null }; page: EndOfDayPage | null } | Fail> {
  if (day === ctx.today) {
    const page = await loadEndOfDay(sb, ctx);
    return { base: { data: page.report, html: null, subject: null }, page };
  }
  const b = await pastReport(sb, ctx, day);
  if ("ok" in b) return b;
  return { base: b, page: null };
}

export type SendReportResult = { ok: true; sentTo: string[]; dayMarkedSent: boolean } | { ok: false; error: string; sentTo?: string[]; owed?: number };

/**
 * Sends the report to each person chosen. `force` sends today's report even when a missed commitment has no reason
 * yet (the same question as Approve and send). The same requestId never sends twice to one address.
 */
export async function sendReportCore(sb: SupabaseClient, ctx: Ctx, input: { day: string; sections: string[]; intro: string; to: SendReportTo[]; requestId: string; force?: boolean; choices?: unknown; notes?: unknown; /** Today's copy to send (a partner's id, or "_general"): its saved choices and today's notes, read fresh here. */ fromCopy?: string | null }): Promise<SendReportResult> {
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return fail("The send request was not valid. Close the window and try again.");
  if (!DATE.test(String(input.day ?? ""))) return fail("Pick a day.");
  if (!cleanSections(input.sections).length && !input.fromCopy) return fail("Tick at least one section.");
  const intro = cleanIntro(input.intro);
  let choices = input.choices && typeof input.choices === "object" ? cleanChoices(input.choices) : null;
  let notes = input.notes && typeof input.notes === "object" ? cleanNotes(input.notes) : null;
  let sections: readonly string[] = cleanSections(input.sections);

  // The people: saved contacts by id, new addresses checked (and saved as contacts when asked).
  const ids = [...new Set((input.to ?? []).filter((t): t is { contactId: string } => "contactId" in t && UUID.test(String(t.contactId))).map((t) => t.contactId))];
  const fresh = (input.to ?? []).filter((t): t is { email: string; name: string; save: boolean } => "email" in t);
  if (!ids.length && !fresh.length) return fail("Choose who gets the report.");
  const bad = fresh.filter((t) => !isValidEmail(String(t.email ?? "").trim()));
  if (bad.length) return fail(`${bad.map((t) => t.email || "An empty address").join(", ")} is not a valid email address.`);
  const { data: known } = ids.length ? await sb.from("contacts").select("*").eq("owner_id", ctx.ownerId).in("id", ids) : { data: [] as Row[] };
  const people: { contact: Row | null; name: string; email: string }[] = ((known ?? []) as Row[]).map((c) => ({ contact: c, name: String(c.name ?? ""), email: String(c.email ?? "").trim() }));
  const noEmail = people.filter((p) => !isValidEmail(p.email));
  if (noEmail.length) return fail(`${noEmail.map((p) => p.name).join(" and ")} has no valid email address. Add it on their page under Contacts.`);
  for (const t of fresh) people.push({ contact: null, name: String(t.name ?? "").trim(), email: String(t.email).trim() });

  const b = await baseFor(sb, ctx, input.day);
  if ("ok" in b) return b;
  const isToday = input.day === ctx.today;
  // Today's report from the window (2026-11-08): the copy as saved in today's draft, so a note or Edit saved a moment ago goes out.
  if (isToday && b.page && input.fromCopy) {
    const c = input.fromCopy === b.page.general.partner.id ? b.page.general : b.page.copies.find((x) => x.partner.id === input.fromCopy);
    if (!c) return fail("That copy of today's report was not found. Close the window and open it again.");
    choices = c.report.choices ?? null;
    notes = c.report.notes ?? b.page.report.notes ?? {};
    sections = c.partner.sections;
  }
  if (b.base.data && !sentSections(copyData(b.base.data, "", sections, intro, choices, notes)).length) return fail("Every section is left out. Tick at least one section.");
  // No reasons question here: reasons are owed to the partners, and Approve and send asks for them (2026-11-08).
  const perm = isGoogleConfigured() ? sendPermission(await getGoogleConnection(sb, ctx.ownerId)) : "not_connected";
  if (perm === "reconnect") return fail("Sending from the app is not allowed yet. Reconnect Google once (1 minute) under Settings, Connections, then send again.");
  if (perm !== "allowed") return fail("Google is not connected. Connect Google in Settings, Connections, then send again.");

  // Addresses this same press already sent to (a double press or a retry) are not sent to again.
  const { data: prior } = await sb.from("change_log").select("new_value").eq("field", "email_sent").eq("new_value->>request_id", input.requestId).limit(100);
  const done = new Set(((prior ?? []) as Row[]).map((p) => String(((p.new_value as Row) ?? {}).to ?? "").toLowerCase()));
  const summary = b.page ? reportSummary(b.page.judged, b.page.numbers, b.page.friday) : null;
  const sentTo: string[] = [];
  for (const p of people) {
    if (done.has(p.email.toLowerCase())) {
      sentTo.push(p.name || p.email);
      continue;
    }
    // A new address saved as a contact first (unless unticked), so the copy and its replies have a person.
    let contact = p.contact;
    const ask = fresh.find((t) => String(t.email).trim() === p.email && !p.contact);
    if (!contact && ask?.save) {
      const { data: existing } = await sb.from("contacts").select("*").eq("owner_id", ctx.ownerId).ilike("email", p.email).limit(1);
      contact = ((existing ?? []) as Row[])[0] ?? null;
      if (!contact) {
        const { data: made, error } = await sb.from("contacts").insert({ owner_id: ctx.ownerId, name: p.name || p.email, email: p.email }).select("*").single();
        if (error) return { ok: false, error: `${p.email} could not be saved as a contact: ${error.message}. Nothing more was sent.`, sentTo };
        contact = made as Row;
      }
    }
    const name = p.name || String(contact?.name ?? "");
    const built = buildFor(b.base, name, sections, intro, choices, notes);
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#f8fafc"><tr><td align="center" style="padding:12px 6px">${built.inner}</td></tr></table>`;
    let sent: { id: string; threadId: string | null };
    try {
      const r = await sendGmailMessage(sb, ctx.ownerId, { to: p.email, subject: built.subject, body: built.text, html });
      if (!r) return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections.", sentTo };
      sent = r;
    } catch (e) {
      const x = explainGoogleError(e);
      return { ok: false, error: sentTo.length ? `Sent to ${sentTo.join(" and ")}. Not sent to ${name || p.email}: ${x.message}` : x.message, sentTo };
    }
    const sentAt = new Date().toISOString();
    let reportId: string | null = null;
    let commId: string | null = null;
    if (contact) {
      // Kept as a copy of that day's report, so it shows on Reports and the person's timeline, and replies are read.
      const { data: report } = await sb
        .from("partner_reports")
        .insert({ owner_id: ctx.ownerId, contact_id: String(contact.id), period_start: input.day, period_end: input.day, status: "finalized", snapshot: { end_of_day: true, day: input.day, sent_by: "send_a_report", resend: !isToday, judged: b.page?.judged ?? null, reasons: b.page?.reasons ?? null, tomorrow: b.page?.tomorrow ?? null, report: b.base.data ? copyData(b.base.data, name, sections, intro, choices, notes) : null, sections, choices, notes: b.base.data ? (notes ?? b.base.data.notes ?? null) : null, intro: intro || null, html: built.inner, subject: built.subject }, summary: summary ?? "Report sent again", summary_source: "owner", finalized_at: sentAt, delivered_via: ["gmail_sent"], report_kind: "end_of_day", sent_at: sentAt, gmail_message_id: sent.id, gmail_thread_id: sent.threadId })
        .select("id")
        .single();
      reportId = report ? String((report as Row).id) : null;
      const comm = { ...sentEmailCommunication({ kind: "partner_report", ownerId: ctx.ownerId, to: p.email, subject: built.subject, body: built.text, sentAt, contact }), gmail_message_id: sent.id, gmail_thread_id: sent.threadId, partner_report_id: reportId };
      const { data: c } = await sb.from("communications").insert(comm).select("id").single();
      commId = c ? String((c as Row).id) : null;
      if (commId && reportId) await sb.from("record_links").insert({ owner_id: ctx.ownerId, from_type: "communications", from_id: commId, to_type: "partner_reports", to_id: reportId, relation: "report sent" });
    }
    await sb.from("change_log").insert({ owner_id: ctx.ownerId, table_name: "partner_reports", record_id: reportId, action: "insert", field: "email_sent", new_value: { request_id: input.requestId, kind: "send_a_report", to: p.email, subject: built.subject, contact_id: contact ? String(contact.id) : null, day: input.day, communication_id: commId, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt }, actor: "owner" });
    sentTo.push(name || p.email);
  }

  // One report window (Bram, 2026-11-08): a send to other people never closes the day; only Approve and send to the
  // partners due today does. An earlier day stays as it is.
  revalidatePath("/", "layout");
  return { ok: true, sentTo, dayMarkedSent: false };
}

export type SendResult = { ok: true; sentAt: string; sentTime: string; sentTo: string[]; alreadySent?: boolean; alsoTo?: string[]; alsoError?: string } | { ok: false; error: string; reason?: "reasons" | "partner" | "google" | "invalid" | "partial"; owed?: number; sentTo?: string[] };

/**
 * Approve and send (push B: to every partner due today, each getting only their own sections): one email per partner
 * through the existing Gmail sending (never by a job). Each sent copy is kept as a partner report with the partner and
 * its Gmail thread (so replies can be found), one communication on the partner, and a change log entry with the
 * click's request id. A second press of the same click, or a retry after one partner failed, skips every partner who
 * already got today's report; the day is marked sent once every partner due has it. With reasons still owed and
 * `force` false it stops with "N commitments have no reason yet".
 */
export async function approveAndSendCore(sb: SupabaseClient, ctx: Ctx, day: string, requestId: string, force = false, intro: string | null = null, actor: "owner" | "auto" = "owner"): Promise<SendResult> {
  if (!REQUEST_ID.test(String(requestId ?? ""))) return { ok: false, error: "The send request was not valid. Reload the page and try again.", reason: "invalid" };
  const row = await ensureEodRow(sb, ctx, day);
  if (typeof row === "string") return { ok: false, error: row, reason: "invalid" };
  if (row.status === "sent") return { ok: true, sentAt: String(row.sent_at), sentTime: timeOf(String(row.sent_at), ctx.tz), sentTo: [], alreadySent: true };
  if (row.status === "skipped") return { ok: false, error: "Today was skipped. Nothing is sent.", reason: "invalid" };
  const page = await loadEndOfDay(sb, ctx, day);
  // Fix list item 1: an unticked partner is skipped today.
  const waiting = page.copies.filter((c) => !c.sentAt && !c.skipped);
  // This click already sent (a double press or a retry): those partners are not sent to again.
  const { data: prior } = await sb.from("change_log").select("new_value").eq("field", "email_sent").eq("new_value->>request_id", requestId).limit(50);
  const sentThisClick = new Set(((prior ?? []) as Row[]).map((p) => String(((p.new_value as Row) ?? {}).contact_id ?? "")));
  const todo = waiting.filter((c) => !sentThisClick.has(c.partner.id));
  if (!page.copies.length) return { ok: false, error: page.partners.length ? "No partner gets the report today. Change a partner's days on their page under Contacts to send one." : "No accountability partner yet. Add a person under Contacts with the role Accountability partner and an email address.", reason: "partner" };
  if (page.copies.every((c) => c.skipped)) return { ok: false, error: "Every partner is unticked for today. Tick at least one partner to send.", reason: "partner" };
  if (!todo.length) return finishDay(sb, ctx, row, page, requestId);
  const owed = owedCount(page);
  if (owed && !force) return { ok: false, error: noReasonText(owed, todo.length > 1 ? "Your partners" : todo[0].partner.first), reason: "reasons", owed };
  const noEmail = todo.filter((c) => !c.partner.email || !isValidEmail(c.partner.email));
  if (noEmail.length) return { ok: false, error: `${noEmail.map((c) => c.partner.name).join(" and ")} ${noEmail.length > 1 ? "have" : "has"} no valid email address. Add it on ${noEmail.length > 1 ? "their pages" : `${noEmail[0].partner.first}'s page`} under Contacts, then press Approve and send again. Nothing was sent.`, reason: "partner" };
  const perm = isGoogleConfigured() ? sendPermission(await getGoogleConnection(sb, ctx.ownerId)) : "not_connected";
  if (perm === "reconnect") return { ok: false, error: "Sending from the app is not allowed yet. Reconnect Google once (1 minute) under Settings, Connections, then press Approve and send again.", reason: "google" };
  if (perm !== "allowed") return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections, then press Approve and send again.", reason: "google" };

  const summary = reportSummary(page.judged, page.numbers, page.friday);
  const sentTo: string[] = [];
  for (const copy of todo) {
    const p = copy.partner;
    // The copy as the review window shows it: this partner's sections with today's include, Change, and Edit.
    const edited = copy.edited;
    // The note under the greeting (one report window, 2026-11-08): for this send only, in every copy.
    const note = String(intro ?? page.extras.intro ?? "").replace(/\r/g, "").trim().slice(0, 1200);
    if (note) copy.report = { ...copy.report, intro: note };
    const inner = reportInnerHtml(copy.report);
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#f8fafc"><tr><td align="center" style="padding:12px 6px">${inner}</td></tr></table>`;
    const body = reportText(copy.report);
    const subject = reportSubject(copy.report);
    let sent: { id: string; threadId: string | null };
    try {
      const r = await sendGmailMessage(sb, ctx.ownerId, { to: p.email!, subject, body, html });
      if (!r) return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections.", reason: "google", sentTo };
      sent = r;
    } catch (e) {
      const x = explainGoogleError(e);
      if (!sentTo.length) return { ok: false, error: x.message, reason: "google" };
      const left = todo.filter((c) => !sentTo.includes(c.partner.first)).map((c) => c.partner.first);
      return { ok: false, error: `Sent to ${sentTo.join(" and ")}. Not sent to ${left.join(" and ")}: ${x.message} Press Approve and send again to send to ${left.join(" and ")} only.`, reason: "partial", sentTo };
    }
    const sentAt = new Date().toISOString();
    // The sent copy as a partner report (finalized: it never changes), with the thread its replies come in.
    const { data: report } = await sb
      .from("partner_reports")
      .insert({ owner_id: ctx.ownerId, contact_id: p.id, period_start: day, period_end: day, status: "finalized", snapshot: { end_of_day: true, day, judged: page.judged, reasons: page.reasons, tomorrow: page.tomorrow, report: copy.report, sections: p.sections, choices: copy.report.choices ?? null, notes: copy.report.notes ?? null, edited: !!edited, html: inner, subject }, summary, summary_source: "owner", finalized_at: sentAt, delivered_via: ["gmail_sent"], report_kind: "end_of_day", sent_at: sentAt, gmail_message_id: sent.id, gmail_thread_id: sent.threadId })
      .select("id")
      .single();
    const reportId = report ? String((report as Row).id) : null;
    const contact = ((await sb.from("contacts").select("*").eq("id", p.id).maybeSingle()).data as Row | null) ?? null;
    const comm = { ...sentEmailCommunication({ kind: "partner_report", ownerId: ctx.ownerId, to: p.email!, subject, body, sentAt, contact }), gmail_message_id: sent.id, gmail_thread_id: sent.threadId, partner_report_id: reportId };
    const { data: c } = await sb.from("communications").insert(comm).select("id").single();
    const commId = c ? String((c as Row).id) : null;
    if (commId && reportId) await sb.from("record_links").insert({ owner_id: ctx.ownerId, from_type: "communications", from_id: commId, to_type: "partner_reports", to_id: reportId, relation: "report sent" });
    await sb.from("change_log").insert({ owner_id: ctx.ownerId, table_name: "partner_reports", record_id: reportId, action: "insert", field: "email_sent", new_value: { request_id: requestId, kind: "end_of_day", to: p.email, subject, contact_id: p.id, day, communication_id: commId, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt, edited: !!edited, auto: actor === "auto" }, actor: "owner" });
    sentTo.push(p.first);
  }
  const after = await loadEndOfDay(sb, ctx, day);
  const result = await finishDay(sb, ctx, row, after, requestId);
  if (!result.ok) return result;
  // Also send to (2026-11-08): the people saved with the day get their copy right after the partners, then come off the list.
  const also = await sendExtras(sb, ctx, day, page, `${requestId.slice(0, 50)}-also`, intro);
  return { ...result, sentTo, alreadySent: false, ...also };
}

/** Marks the day sent once every copy on it went out (the first copy's email is kept on the day for older screens). */
async function finishDay(sb: SupabaseClient, ctx: Ctx, row: Row, page: EndOfDayPage, requestId: string): Promise<SendResult> {
  void requestId;
  // Fix list item 1: the day is sent once every ticked partner has it; an unticked one is not waited for.
  const left = page.copies.filter((c) => !c.sentAt && !c.skipped);
  if (left.length) return { ok: false, error: `Not sent yet to ${left.map((c) => c.partner.first).join(" and ")}. Press Approve and send again.`, reason: "partial", sentTo: page.copies.filter((c) => c.sentAt).map((c) => c.partner.first) };
  const sentCopies = page.copies.filter((c) => c.sentAt);
  if (!sentCopies.length) return { ok: false, error: "Every partner is unticked for today. Tick at least one partner to send.", reason: "partner" };
  const sentAt = sentCopies.map((c) => c.sentAt!).sort().slice(-1)[0] ?? new Date().toISOString();
  const first = sentCopies[0];
  const { data: rep } = await sb.from("partner_reports").select("id,snapshot").eq("owner_id", ctx.ownerId).eq("report_kind", "end_of_day").eq("period_start", page.day).eq("contact_id", first.partner.id).order("sent_at").limit(1).maybeSingle();
  const snap = ((rep as Row | null)?.snapshot ?? {}) as Row;
  const { error } = await sb.from("end_of_day").update({ status: "sent", sent_at: sentAt, report_id: rep ? String((rep as Row).id) : null, report_subject: typeof snap.subject === "string" ? snap.subject : reportSubject(first.report), report_html: first.html, report_edited: first.edited, report_edits: keptAfterSend(row.report_edits), judged: page.judged }).eq("id", row.id);
  if (error) return { ok: false, error: `The emails were sent, but the day could not be marked sent: ${error.message}`, reason: "invalid" };
  revalidatePath("/", "layout");
  return { ok: true, sentAt, sentTime: timeOf(sentAt, ctx.tz), sentTo: sentCopies.map((c) => c.partner.first) };
}

function timeOf(ts: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ts)).toLowerCase();
  } catch {
    return "";
  }
}

"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { isValidEmail } from "@/lib/email-address";
import { isGoogleConfigured } from "@/lib/env";
import { explainGoogleError } from "@/lib/google-errors";
import { getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { sendPermission } from "@/lib/google-scopes";
import { sentEmailCommunication } from "@/lib/calc/sent-email";
import { loadEndOfDay, loadPartners, type EndOfDayPage } from "@/lib/accountability/data";
import { REPORT_SECTIONS, type ReportSectionKey } from "@/lib/accountability/partners";
import { reportFor, reportInnerHtml, reportSubject, reportText, type ReportData } from "@/lib/accountability/report-email";
import { cleanChoices, cleanNotes, sentSections, type ReportChoices, type ReportNotes } from "@/lib/accountability/report-sections";
import { owedReasons, reportSummary } from "@/lib/accountability/targets";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

/**
 * Send a report (Bram, 2026-11-07; claude/2026-11-07-part-b-fix-list.md, design A). From End of day or Reports: today's
 * report (as it stands now) or an earlier sent day's, to partners, any contact with an email address, or a new address;
 * the sections to include; a short note of your own under the greeting. Each send goes through Gmail like Approve and
 * send, is kept as a partner report copy (so replies show on Reports and the person's timeline), and is logged on the
 * person's timeline. Sending today's report counts the day as sent; resending an earlier day changes nothing about it.
 * A new address is saved as a contact unless that box is unticked (then it is sent only, with nothing kept).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const INTRO_MAX = 1200;
const SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key) as ReportSectionKey[];

export type SendReportDay = { day: string; label: string; today: boolean; sent: boolean };
export type SendReportPerson = { id: string; name: string; email: string; partner: boolean; org: string | null };
export type SendReportSetup = { ok: true; today: string; days: SendReportDay[]; people: SendReportPerson[]; sections: { key: ReportSectionKey; label: string; hint: string | null }[] };
export type SendReportTo = { contactId: string } | { email: string; name: string; save: boolean };

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  try {
    const { supabase, ownerId } = await requireOwner();
    return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sign in again.");
  }
}

/** What the window offers: today and the sent days (newest first), everyone with an email address, the sections. */
export async function sendReportSetup(): Promise<SendReportSetup | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  const { sb, ctx } = s;
  const [{ data: days }, { data: people }, partners] = await Promise.all([
    sb.from("end_of_day").select("day,status").eq("owner_id", ctx.ownerId).eq("status", "sent").order("day", { ascending: false }).limit(90),
    sb.from("contacts").select("id,name,email,organization_id,archived_at").eq("owner_id", ctx.ownerId).not("email", "is", null).is("archived_at", null).order("name").limit(3000),
    loadPartners(sb, ctx.ownerId),
  ]);
  const orgIds = [...new Set(((people ?? []) as Row[]).map((p) => p.organization_id).filter(Boolean).map(String))];
  const { data: orgs } = orgIds.length ? await sb.from("organizations").select("id,name").in("id", orgIds) : { data: [] as Row[] };
  const orgName = new Map(((orgs ?? []) as Row[]).map((o) => [String(o.id), String(o.name)]));
  const partnerIds = new Set(partners.map((p) => p.id));
  const sent = ((days ?? []) as Row[]).map((r) => String(r.day).slice(0, 10)).filter((d) => d !== ctx.today);
  return {
    ok: true,
    today: ctx.today,
    days: [{ day: ctx.today, label: `Today, ${fmtDate(ctx.today, "EEE MMM d")}`, today: true, sent: false }, ...sent.map((d) => ({ day: d, label: fmtDate(d, "EEE MMM d, yyyy"), today: false, sent: true }))],
    people: ((people ?? []) as Row[])
      .filter((p) => isValidEmail(String(p.email ?? "")))
      .map((p) => ({ id: String(p.id), name: String(p.name ?? ""), email: String(p.email), partner: partnerIds.has(String(p.id)), org: p.organization_id ? (orgName.get(String(p.organization_id)) ?? null) : null }))
      .sort((a, b) => Number(b.partner) - Number(a.partner) || a.name.localeCompare(b.name)),
    sections: REPORT_SECTIONS.map((x) => ({ key: x.key, label: x.label, hint: x.hint })),
  };
}

/** Today's End of day page (the same build as the End of day screen). */
const todayPage = (sb: SupabaseClient, ctx: Ctx): Promise<EndOfDayPage> => loadEndOfDay(sb, ctx);

/** The report of a day as sent then: the fullest data kept with that day's copies, or its email as it went out. */
async function pastReport(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ data: ReportData | null; html: string | null; subject: string | null } | Fail> {
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
function copyData(data: ReportData, name: string, sections: readonly string[], intro: string, choices: ReportChoices | null, notes: ReportNotes | null): ReportData {
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

async function baseFor(sb: SupabaseClient, ctx: Ctx, day: string): Promise<{ base: { data: ReportData | null; html: string | null; subject: string | null }; page: EndOfDayPage | null } | Fail> {
  if (day === ctx.today) {
    const page = await todayPage(sb, ctx);
    return { base: { data: page.report, html: null, subject: null }, page };
  }
  const b = await pastReport(sb, ctx, day);
  if ("ok" in b) return b;
  return { base: b, page: null };
}

export type SendReportDayData = { ok: true; kind: "data"; report: ReportData; subject: string | null } | { ok: true; kind: "html"; html: string; subject: string | null };

/**
 * The report of a day for the window (Bram, 2026-11-08): its data, so the window shows the same review as End of day
 * (the include box, Change, Edit and + Note on each section), with today's notes from End of day to start; or, for an
 * older day kept only as its sent email, that email.
 */
export async function loadSendReportDay(day: string): Promise<SendReportDayData | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  const { sb, ctx } = s;
  if (!DATE.test(String(day ?? ""))) return fail("Pick a day.");
  const b = await baseFor(sb, ctx, day);
  if ("ok" in b) return b;
  if (b.base.data) return { ok: true, kind: "data", report: { ...b.base.data, choices: null, intro: null }, subject: b.base.subject };
  return { ok: true, kind: "html", html: String(b.base.html), subject: b.base.subject };
}

export type SendReportResult = { ok: true; sentTo: string[]; dayMarkedSent: boolean } | { ok: false; error: string; sentTo?: string[]; owed?: number };

/**
 * Sends the report to each person chosen. `force` sends today's report even when a missed commitment has no reason
 * yet (the same question as Approve and send). The same requestId never sends twice to one address.
 */
export async function sendReport(input: { day: string; sections: string[]; intro: string; to: SendReportTo[]; requestId: string; force?: boolean; choices?: unknown; notes?: unknown }): Promise<SendReportResult> {
  const s = await setup();
  if ("ok" in s) return s;
  const { sb, ctx } = s;
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return fail("The send request was not valid. Close the window and try again.");
  if (!DATE.test(String(input.day ?? ""))) return fail("Pick a day.");
  const sections = cleanSections(input.sections);
  if (!sections.length) return fail("Tick at least one section.");
  const intro = cleanIntro(input.intro);
  const choices = input.choices && typeof input.choices === "object" ? cleanChoices(input.choices) : null;
  const notes = input.notes && typeof input.notes === "object" ? cleanNotes(input.notes) : null;

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
  if (b.base.data && !sentSections(copyData(b.base.data, "", sections, intro, choices, notes)).length) return fail("Every section is left out. Tick at least one section.");
  if (isToday && b.page && !input.force) {
    const pg = b.page;
    const owed = owedReasons(pg.judged, pg.reasons).length + (pg.owed ? pg.owed.items.filter((j) => !String(pg.reasons[`owed:${pg.owed!.day}:${j.targetId}`] ?? "").trim()).length : 0);
    if (owed) return { ok: false, error: `${owed === 1 ? "One missed commitment has" : `${owed} missed commitments have`} no reason yet. Add the reason on End of day, or send anyway.`, owed };
  }
  const perm = isGoogleConfigured() ? sendPermission(await getGoogleConnection(sb, ctx.ownerId)) : "not_connected";
  if (perm === "reconnect") return fail("Sending from the app is not allowed yet. Reconnect Google once (1 minute) under Settings, Connections, then send again.");
  if (perm !== "allowed") return fail("Google is not connected. Connect Google in Settings, Connections, then send again.");

  // Addresses this same press already sent to (a double press or a retry) are not sent to again.
  const { data: prior } = await sb.from("change_log").select("new_value").eq("field", "email_sent").eq("new_value->>request_id", input.requestId).limit(100);
  const done = new Set(((prior ?? []) as Row[]).map((p) => String(((p.new_value as Row) ?? {}).to ?? "").toLowerCase()));
  const summary = b.page ? reportSummary(b.page.judged, b.page.numbers, b.page.friday) : null;
  const sentTo: string[] = [];
  let firstReport: { id: string | null; html: string; subject: string; sentAt: string } | null = null;
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
    firstReport ??= { id: reportId, html: built.inner, subject: built.subject, sentAt };
    sentTo.push(name || p.email);
  }

  // Today's report counts the day as sent (as Approve and send does); an earlier day stays as it is.
  let dayMarkedSent = false;
  if (isToday && b.page && b.page.state === "open" && firstReport) {
    let { data: row } = await sb.from("end_of_day").select("id").eq("owner_id", ctx.ownerId).eq("day", input.day).maybeSingle();
    if (!row) row = (await sb.from("end_of_day").insert({ owner_id: ctx.ownerId, day: input.day }).select("id").single()).data;
    if (row) {
      const { error } = await sb.from("end_of_day").update({ status: "sent", sent_at: firstReport.sentAt, report_id: firstReport.id, report_subject: firstReport.subject, report_html: firstReport.html, report_edited: !!intro, report_edits: {}, judged: b.page.judged }).eq("id", (row as Row).id);
      dayMarkedSent = !error;
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, sentTo, dayMarkedSent };
}

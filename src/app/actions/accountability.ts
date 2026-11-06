"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { isValidEmail } from "@/lib/email-address";
import { isGoogleConfigured } from "@/lib/env";
import { explainGoogleError } from "@/lib/google-errors";
import { getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { sendPermission } from "@/lib/google-scopes";
import { sentEmailCommunication } from "@/lib/calc/sent-email";
import { DB_UPDATE_NOTICE_0025, DB_UPDATE_NOTICE_PUSH_D, isMissingSchemaError } from "@/lib/schema-guard";
import { recordWorkEvent } from "@/lib/accountability/events";
import { buildEndOfDay, factsSince, loadEodRow, loadFacts, loadOwedFromSkipped, loadPartners, loadSentCopies, loadTargets, type EndOfDayPage, type PartnerCopy } from "@/lib/accountability/data";
import { cleanPartnerSettings } from "@/lib/accountability/partners";
import { replyTaskText } from "@/lib/gmail-replies";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition } from "@/lib/work/todos";
import { reasonsPrompt, validateReasonsReply, type ReasonDraft } from "@/lib/accountability/ask-ai";
import { reportInnerHtml, reportSubject, reportText } from "@/lib/accountability/report-email";
import { cleanChoices, cleanNotes, cleanReview, hasChoices, NOTE_MAX, NOTES_KEY, SECTION_ORDER, type ReportChoices, type ReportNotes, type SectionKey, type WeeklyReview } from "@/lib/accountability/report-sections";
import { personHref } from "@/lib/work/people";
import { countable, isCountKey, noReasonText, owedReasons, reportSummary, type Cadence } from "@/lib/accountability/targets";
import { loadWorkCtx } from "@/lib/work/data";
import { loadWeeklyFocus } from "@/lib/work/projects-data";
import type { Row } from "@/lib/types";

/**
 * Targets, End of day, and Reports (batch C, database update 0025): add, edit, remove (archive) a target and its
 * Commitment switch; the reasons, tomorrow's line, and the edited report of a day; Approve and send (the email goes
 * through the existing Gmail sending to the partner's address, the sent report becomes a partner report, and the day
 * is marked sent); Skip today; the Rosara focus marked done. Every action returns { ok: false, error } instead of
 * throwing.
 */

type Fail = { ok: false; error: string; reply?: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0025 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const notice = null;
  if (notice) return fail(notice);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function done() {
  revalidatePath("/", "layout");
}

// ---------- Targets ----------

type TargetInput = { name: string; key: string; cadence: string; number: number | string; commitment: boolean };

export async function addTarget(input: TargetInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!isCountKey(input.key)) return fail("Choose what the target counts.");
  const cadence: Cadence = input.cadence === "day" ? "day" : "week";
  const n = Math.round(Number(input.number));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return fail("The number must be between 1 and 1000.");
  const name = clean(input.name, 80) || countable(input.key).label;
  const { data: rows } = await sb.from("targets").select("id,name,counts_key,archived_at,sort_order").eq("owner_id", ctx.ownerId).limit(500);
  const all = (rows ?? []) as Row[];
  const same = all.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
  const sortOrder = all.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0) + 1;
  if (same) {
    if (!same.archived_at && same.counts_key) return fail(`A target named "${name}" is already on the list.`);
    // The name exists from an earlier version (or was removed): that row comes back with the new definition.
    const { error } = await sb.from("targets").update({ counts_key: input.key, period: cadence, minimum_count: n, is_commitment: !!input.commitment, active: true, archived_at: null, sort_order: sortOrder }).eq("id", same.id);
    if (error) return notSaved(error);
    done();
    return { ok: true, id: String(same.id) };
  }
  const { data, error } = await sb.from("targets").insert({ owner_id: ctx.ownerId, name, period: cadence, minimum_count: n, active_weekdays: [1, 2, 3, 4, 5], count_source: "manual", is_commitment: !!input.commitment, show_to_partners: false, active: true, sort_order: sortOrder, counts_key: input.key, notes: "Counted from what you do in the app (Targets, batch C)." }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

async function targetOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This target was not found.");
  const { data } = await sb.from("targets").select("id,name,counts_key,period,minimum_count,is_commitment,archived_at").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This target was not found.");
}

/** Edit: the number and the cadence. */
export async function editTarget(id: string, input: { number: number | string; cadence: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const n = Math.round(Number(input.number));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return fail("The number must be between 1 and 1000.");
  const { error } = await sb.from("targets").update({ minimum_count: n, period: input.cadence === "day" ? "day" : "week" }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Remove target: archived (nothing is deleted; its history stays and Add a target with the same name brings it back). */
export async function removeTarget(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const { error } = await sb.from("targets").update({ archived_at: new Date().toISOString(), active: false }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** The Commitment switch. */
export async function setCommitment(id: string, on: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const { error } = await sb.from("targets").update({ is_commitment: !!on }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- End of day ----------

/** The day's row, created when missing (open). */
async function ensureEod(sb: SupabaseClient, ctx: Ctx, day: string): Promise<Row | Fail> {
  if (!DATE.test(day)) return fail("The day was not valid.");
  const { data } = await sb.from("end_of_day").select("*").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle();
  if (data) return data as Row;
  const { data: made, error } = await sb.from("end_of_day").insert({ owner_id: ctx.ownerId, day }).select("*").single();
  if (error) return notSaved(error);
  return made as Row;
}

/** The reason boxes (one or all, from "Same reason for all"): merged into the day's reasons by target id. */
export async function saveReasons(day: string, reasons: Record<string, string>): Promise<{ ok: true; owed: number } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const current = (row.reasons && typeof row.reasons === "object" ? (row.reasons as Record<string, string>) : {}) ?? {};
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(reasons ?? {})) {
    if (!/^(owed:\d{4}-\d{2}-\d{2}:)?[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
    const text = clean(v, 300);
    if (text) next[k] = text;
    else delete next[k];
  }
  const { error } = await sb.from("end_of_day").update({ reasons: next }).eq("id", row.id);
  if (error) return notSaved(error);
  // A reason owed from a skipped day is written on that day's row too (its report never went; the record is kept there).
  for (const [k, v] of Object.entries(next)) {
    const m = k.match(/^owed:(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_-]{1,64})$/);
    if (!m) continue;
    const { data: prev } = await sb.from("end_of_day").select("id,reasons").eq("owner_id", ctx.ownerId).eq("day", m[1]).maybeSingle();
    if (prev) await sb.from("end_of_day").update({ reasons: { ...((prev as Row).reasons as Record<string, string>), [m[2]]: v } }).eq("id", (prev as Row).id);
  }
  const page = await loadPage(sb, ctx, day);
  done();
  return { ok: true, owed: owedCount(page) };
}

export async function saveTomorrow(day: string, text: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const line = String(text ?? "").replace(/\r\n/g, "\n").trim().slice(0, 600);
  const { error } = await sb.from("end_of_day").update({ tomorrow_line: line || null }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/**
 * The Weekly review on Friday's End of day (push D): the three answers, merged by key (what went well, what slipped,
 * next week's focus). They go into Friday's report to each partner who gets the Weekly review section.
 */
export async function saveWeeklyReview(day: string, patch: Partial<WeeklyReview>): Promise<{ ok: true; review: WeeklyReview } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  if (!("weekly_review" in row)) return fail(DB_UPDATE_NOTICE_PUSH_D);
  const review = cleanReview({ ...cleanReview(row.weekly_review), ...Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => ["well", "slipped", "focus"].includes(k))) });
  const { error } = await sb.from("end_of_day").update({ weekly_review: review }).eq("id", row.id);
  if (error) return fail(isMissingSchemaError(error) ? DB_UPDATE_NOTICE_PUSH_D : `Not saved: ${error.message}`);
  done();
  return { ok: true, review };
}

/** The copy a per-partner action is about: that partner's, or the first one when none is named. */
function copyOf(page: EndOfDayPage, contactId: string | null | undefined): PartnerCopy | null {
  return page.copies.find((c) => c.partner.id === contactId) ?? (contactId ? null : page.copies[0] ?? null);
}

/**
 * The review window (push B edits): one partner's choices for today's copy, saved with the day's End of day row by
 * contact id (the include boxes, what Change shows, the 3 deals of Top 3, each section's text from Edit). An empty
 * choice set goes back to the built report. The other partners' choices are kept. Applies to today only.
 */
export async function saveReportChoices(day: string, contactId: string | null, choices: ReportChoices): Promise<{ ok: true; html: string; choices: ReportChoices } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const before = await loadPage(sb, ctx, day);
  const copy = copyOf(before, contactId);
  if (!copy) return fail("No partner gets the report today, so there is nothing to change.");
  if (copy.sentAt) return fail(`The report to ${copy.partner.first} was already sent. A sent report never changes.`);
  const cleaned = cleanChoices(choices);
  const all = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
  if (hasChoices(cleaned)) all[copy.partner.id] = cleaned;
  else delete all[copy.partner.id];
  const { error } = await sb.from("end_of_day").update({ report_edits: all, report_html: null, report_edited: false }).eq("id", row.id);
  if (error) return notSaved(error);
  const page = await loadPage(sb, ctx, day);
  done();
  const after = copyOf(page, copy.partner.id);
  return { ok: true, html: after?.html ?? page.reportHtml, choices: cleaned };
}

/**
 * "+ Note" on a report section (approved 2026-11-05): a few lines under that section, for today's report only. Kept
 * once for the day by section key, in the End of day row's report_edits under "_notes" next to each partner's choices
 * (keyed by contact id), so every partner's copy that includes the section gets the same note. An empty text removes
 * the note. A note on a section left out of a copy stays saved but is not sent in that copy.
 */
export async function saveReportNote(day: string, section: string, text: string): Promise<{ ok: true; notes: ReportNotes } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!(SECTION_ORDER as string[]).includes(section)) return fail("This section was not found.");
  if (String(text ?? "").length > NOTE_MAX * 2) return fail(`A note can be up to ${NOTE_MAX} characters.`);
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const all = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
  const notes = cleanNotes({ ...cleanNotes(all[NOTES_KEY]), [section]: String(text ?? "") });
  if (!notes[section as SectionKey]) delete notes[section as SectionKey];
  if (Object.keys(notes).length) all[NOTES_KEY] = notes;
  else delete all[NOTES_KEY];
  const { error } = await sb.from("end_of_day").update({ report_edits: all, report_html: null, report_edited: false }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, notes };
}

/**
 * "Use the short version" (the Ask AI panel on the report): that partner's copy keeps Targets with the reasons, the
 * week, and the tomorrow line for today; the other sections are left out today (each can be ticked back).
 */
export async function putShortReport(day: string, contactId?: string | null): Promise<{ ok: true; html: string; choices: ReportChoices } | Fail> {
  const page = await (async () => {
    const s = await setup();
    if (isFail(s)) return s;
    return loadPage(s.sb, s.ctx, day);
  })();
  if (isFail(page)) return page;
  const copy = copyOf(page, contactId);
  if (!copy) return fail("No partner gets the report today.");
  const prev = copy.report.choices ?? {};
  return saveReportChoices(day, copy.partner.id, { ...prev, include: { ...(prev.include ?? {}), today: false, top: false, active: false, waiting: false, jobs: false, targets: true, week: true, tomorrow: true } });
}

async function loadPage(sb: SupabaseClient, ctx: Ctx, day: string): Promise<EndOfDayPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, row, partners, owed, sent] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(day)), loadEodRow(sb, ctx.ownerId, day), loadPartners(sb, ctx.ownerId), loadOwedFromSkipped(sb, ctx.ownerId, day), loadSentCopies(sb, ctx.ownerId, day)]);
  return buildEndOfDay({ targets, bundle, row, partners, sent, owed, day, tz: ctx.tz, threshold: wctx.threshold, eodTime: wctx.eodTime });
}

function owedCount(page: EndOfDayPage): number {
  const todays = owedReasons(page.judged, page.reasons).length;
  const prev = page.owed ? page.owed.items.filter((j) => !String(page.reasons[`owed:${page.owed!.day}:${j.targetId}`] ?? "").trim()).length : 0;
  return todays + prev;
}

type SendResult = { ok: true; sentAt: string; sentTime: string; sentTo: string[]; alreadySent?: boolean } | { ok: false; error: string; reason?: "reasons" | "partner" | "google" | "invalid" | "partial"; owed?: number; sentTo?: string[] };

/**
 * Approve and send (push B: to every partner due today, each getting only their own sections): one email per partner
 * through the existing Gmail sending (never by a job). Each sent copy is kept as a partner report with the partner and
 * its Gmail thread (so replies can be found), one communication on the partner, and a change log entry with the
 * click's request id. A second press of the same click, or a retry after one partner failed, skips every partner who
 * already got today's report; the day is marked sent once every partner due has it. With reasons still owed and
 * `force` false it stops with "N commitments have no reason yet".
 */
export async function approveAndSend(day: string, requestId: string, force = false): Promise<SendResult> {
  const s = await setup();
  if (isFail(s)) return { ok: false, error: s.error, reason: "invalid" };
  const { sb, ctx } = s;
  if (!REQUEST_ID.test(String(requestId ?? ""))) return { ok: false, error: "The send request was not valid. Reload the page and try again.", reason: "invalid" };
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return { ok: false, error: row.error, reason: "invalid" };
  if (row.status === "sent") return { ok: true, sentAt: String(row.sent_at), sentTime: timeOf(String(row.sent_at), ctx.tz), sentTo: [], alreadySent: true };
  if (row.status === "skipped") return { ok: false, error: "Today was skipped. Nothing is sent.", reason: "invalid" };
  const page = await loadPage(sb, ctx, day);
  const waiting = page.copies.filter((c) => !c.sentAt);
  // This click already sent (a double press or a retry): those partners are not sent to again.
  const { data: prior } = await sb.from("change_log").select("new_value").eq("field", "email_sent").eq("new_value->>request_id", requestId).limit(50);
  const sentThisClick = new Set(((prior ?? []) as Row[]).map((p) => String(((p.new_value as Row) ?? {}).contact_id ?? "")));
  const todo = waiting.filter((c) => !sentThisClick.has(c.partner.id));
  if (!page.copies.length) return { ok: false, error: page.partners.length ? "No partner gets the report today. Change a partner's days on their page under Contacts to send one." : "No accountability partner yet. Add a person under Contacts with the role Accountability partner and an email address.", reason: "partner" };
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
    await sb.from("change_log").insert({ owner_id: ctx.ownerId, table_name: "partner_reports", record_id: reportId, action: "insert", field: "email_sent", new_value: { request_id: requestId, kind: "end_of_day", to: p.email, subject, contact_id: p.id, day, communication_id: commId, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt, edited: !!edited }, actor: "owner" });
    sentTo.push(p.first);
  }
  const after = await loadPage(sb, ctx, day);
  const result = await finishDay(sb, ctx, row, after, requestId);
  return result.ok ? { ...result, sentTo, alreadySent: false } : result;
}

/** Marks the day sent once every copy on it went out (the first copy's email is kept on the day for older screens). */
async function finishDay(sb: SupabaseClient, ctx: Ctx, row: Row, page: EndOfDayPage, requestId: string): Promise<SendResult> {
  void requestId;
  const left = page.copies.filter((c) => !c.sentAt);
  if (left.length) return { ok: false, error: `Not sent yet to ${left.map((c) => c.partner.first).join(" and ")}. Press Approve and send again.`, reason: "partial", sentTo: page.copies.filter((c) => c.sentAt).map((c) => c.partner.first) };
  const sentAt = page.copies.map((c) => c.sentAt!).sort().slice(-1)[0] ?? new Date().toISOString();
  const first = page.copies[0];
  const { data: rep } = await sb.from("partner_reports").select("id,snapshot").eq("owner_id", ctx.ownerId).eq("report_kind", "end_of_day").eq("period_start", page.day).eq("contact_id", first.partner.id).order("sent_at").limit(1).maybeSingle();
  const snap = ((rep as Row | null)?.snapshot ?? {}) as Row;
  const { error } = await sb.from("end_of_day").update({ status: "sent", sent_at: sentAt, report_id: rep ? String((rep as Row).id) : null, report_subject: typeof snap.subject === "string" ? snap.subject : reportSubject(first.report), report_html: first.html, report_edited: first.edited, report_edits: {}, judged: page.judged }).eq("id", row.id);
  if (error) return { ok: false, error: `The emails were sent, but the day could not be marked sent: ${error.message}`, reason: "invalid" };
  done();
  return { ok: true, sentAt, sentTime: timeOf(sentAt, ctx.tz), sentTo: page.copies.map((c) => c.partner.first) };
}

function timeOf(ts: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ts)).toLowerCase();
  } catch {
    return "";
  }
}

/** Skip today with a reason: nothing is sent; the judgment is kept so the owed reasons are asked on the next End of day. */
export async function skipToday(day: string, reason: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const page = await loadPage(sb, ctx, day);
  const why = clean(reason, 200) || "No reason given";
  const { error } = await sb.from("end_of_day").update({ status: "skipped", skipped_at: new Date().toISOString(), skip_reason: why, judged: page.judged }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- The Rosara focus marked done ----------

/** "Done" on the Weekly focus bar: a work event for today (the Rosara focus done target counts it this week). */
export async function markFocusDone(): Promise<{ ok: true } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const focus = await loadWeeklyFocus(supabase, ownerId);
  const ok = await recordWorkEvent(supabase, ownerId, { kind: "focus_done", recordType: "inputs", recordId: null, label: focus || "Weekly focus", on: ctx.today });
  if (!ok) return fail(DB_UPDATE_NOTICE_0025);
  done();
  return { ok: true };
}

// ---------- The AI drafts on End of day ----------

function aiError(e: unknown): Fail {
  if (e instanceof AIInvalidReply) return e.cutOff ? fail(AI_REPLY_CUT_OFF) : { ok: false, error: `${AI_REPLY_UNUSABLE} Try again.`, reply: replySnippet(e.reply) };
  return fail(e instanceof AIUnavailable ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
}

/** "Draft the reasons for the missed commitments": one line per missed Commitment, from what the day shows. */
export async function draftReasons(day: string): Promise<{ ok: true; drafts: ReasonDraft[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!DATE.test(day)) return fail("The day was not valid.");
  const page = await loadPage(sb, ctx, day);
  const asked = page.judged.filter((j) => j.judged && !j.met && j.commitment);
  if (!asked.length) return fail("No missed commitment asks for a reason today.");
  try {
    const drafts = await callForJson<ReasonDraft[]>({ sb, ownerId: ctx.ownerId, purpose: "eod_reasons", prompt: reasonsPrompt(page, asked), maxTokens: 1500, shape: "items", validate: (v) => validateReasonsReply(cleanDeep(v), asked) });
    return { ok: true, drafts };
  } catch (e) {
    return aiError(e);
  }
}

// ---------- A partner's report settings (the Reports card on their page) and replies ----------

/** The Reports card: the weekdays the partner gets the End of day report and the sections they get. */
export async function savePartnerReports(contactId: string, input: { days: number[]; sections: string[] }): Promise<{ ok: true; days: number[]; sections: string[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(contactId ?? ""))) return fail("This person was not found.");
  const { data } = await sb.from("contacts").select("id,outreach_role,report_sections").eq("owner_id", ctx.ownerId).eq("id", contactId).maybeSingle();
  const c = data as Row | null;
  if (!c) return fail("This person was not found.");
  if (c.outreach_role !== "accountability_partner") return fail("Only an accountability partner gets the report. Set the role in Facts first.");
  const clean = cleanPartnerSettings(input, c.report_sections);
  if (!clean.ok) return fail(clean.error);
  const { error } = await sb.from("contacts").update({ report_days: clean.days, report_sections: clean.sections }).eq("id", contactId);
  if (error) return notSaved(error);
  done();
  return { ok: true, days: clean.days, sections: clean.sections };
}

/** "Make a task from this" under a reply on Reports: a task on the partner's page with the reply's first words. */
export async function taskFromReply(contactId: string, first: string, text: string): Promise<{ ok: true; href: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(contactId ?? ""))) return fail("The person who replied was not found.");
  const { data } = await sb.from("contacts").select("id,name").eq("owner_id", ctx.ownerId).eq("id", contactId).maybeSingle();
  if (!data) return fail("The person who replied was not found.");
  const line = replyTaskText(clean(first, 40) || String((data as Row).name).split(" ")[0], String(text ?? "")).slice(0, TODO_MAX_LENGTH);
  const { data: existing } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "contacts").eq("record_id", contactId).limit(500);
  const rows = ((existing ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
  if (rows.some((t) => !t.doneAt && t.text === line)) return { ok: true, href: personHref(contactId) };
  const { error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "contacts", record_id: contactId, text: line, position: nextTodoPosition(rows) });
  if (error) return notSaved(error);
  done();
  return { ok: true, href: personHref(contactId) };
}

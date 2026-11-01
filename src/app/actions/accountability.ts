"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { signatureHtmlToText, sanitizeHtml } from "@/lib/email-signature";
import { isValidEmail } from "@/lib/email-address";
import { isGoogleConfigured } from "@/lib/env";
import { explainGoogleError } from "@/lib/google-errors";
import { getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { sendPermission } from "@/lib/google-scopes";
import { sentEmailCommunication } from "@/lib/calc/sent-email";
import { DB_UPDATE_NOTICE_0025, isMissingSchemaError } from "@/lib/schema-guard";
import { recordWorkEvent } from "@/lib/accountability/events";
import { accountabilityNotice, buildEndOfDay, factsSince, loadEodRow, loadFacts, loadOwedFromSkipped, loadPartner, loadTargets, type EndOfDayPage } from "@/lib/accountability/data";
import { reasonsPrompt, validateReasonsReply, type ReasonDraft } from "@/lib/accountability/ask-ai";
import { reportInnerHtml, reportSubject, reportText } from "@/lib/accountability/report-email";
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
  const notice = await accountabilityNotice(supabase);
  if (notice) return fail(notice);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function done() {
  revalidatePath("/", "layout");
}

// ---------- Targets ----------

export type TargetInput = { name: string; key: string; cadence: string; number: number | string; commitment: boolean };

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

/** The style properties the report email uses beyond the signature sanitizer's set. */
const REPORT_STYLE_PROPS = ["display", "box-sizing", "overflow", "text-align", "white-space"];

/** The edited report HTML, cleaned (tables, lists, inline styles; nothing that runs). Null or empty clears the edit. */
function cleanReportHtml(html: string | null): string | null {
  const raw = String(html ?? "").trim();
  if (!raw) return null;
  const out = sanitizeHtml(raw, { extraTags: ["ul", "ol", "li"], extraStyleProps: REPORT_STYLE_PROPS, maxLength: 120000 });
  return out.replace(/<[^>]+>/g, "").trim() ? out : null;
}

/** Edit in place: the report as edited (Done editing), or null to go back to the built one. */
export async function saveReportEdit(day: string, html: string | null): Promise<{ ok: true; html: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const cleaned = cleanReportHtml(html);
  const { error } = await sb.from("end_of_day").update({ report_html: cleaned, report_edited: !!cleaned }).eq("id", row.id);
  if (error) return notSaved(error);
  const page = await loadPage(sb, ctx, day);
  done();
  return { ok: true, html: page.reportHtml };
}

/** "Use the short version" (the Ask AI panel on the report card): the short report goes into the preview as an edit. */
export async function putShortReport(day: string): Promise<{ ok: true; html: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const page = await loadPage(sb, ctx, day);
  const html = reportInnerHtml(page.report, true);
  const { error } = await sb.from("end_of_day").update({ report_html: html, report_edited: true }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, html };
}

async function loadPage(sb: SupabaseClient, ctx: Ctx, day: string): Promise<EndOfDayPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, row, partner, owed] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(day)), loadEodRow(sb, ctx.ownerId, day), loadPartner(sb, ctx.ownerId), loadOwedFromSkipped(sb, ctx.ownerId, day)]);
  return buildEndOfDay({ targets, bundle, row, partner, owed, day, tz: ctx.tz, threshold: wctx.threshold });
}

function owedCount(page: EndOfDayPage): number {
  const todays = owedReasons(page.judged, page.reasons).length;
  const prev = page.owed ? page.owed.items.filter((j) => !String(page.reasons[`owed:${page.owed!.day}:${j.targetId}`] ?? "").trim()).length : 0;
  return todays + prev;
}

export type SendResult = { ok: true; sentAt: string; sentTime: string; alreadySent?: boolean } | { ok: false; error: string; reason?: "reasons" | "partner" | "google" | "invalid"; owed?: number };

/**
 * Approve and send: the email goes to the partner through the existing Gmail sending (never by a job, never twice
 * for one click), the sent report is kept as a partner report (so Reviewed and the reply keep working), one
 * communication and a change log entry record the send, and the day is marked sent with the email exactly as sent.
 * With reasons still owed and `force` false it stops with "N commitments have no reason yet".
 */
export async function approveAndSend(day: string, requestId: string, force = false): Promise<SendResult> {
  const s = await setup();
  if (isFail(s)) return { ok: false, error: s.error, reason: "invalid" };
  const { sb, ctx } = s;
  if (!REQUEST_ID.test(String(requestId ?? ""))) return { ok: false, error: "The send request was not valid. Reload the page and try again.", reason: "invalid" };
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return { ok: false, error: row.error, reason: "invalid" };
  if (row.status === "sent") return { ok: true, sentAt: String(row.sent_at), sentTime: timeOf(String(row.sent_at), ctx.tz), alreadySent: true };
  if (row.status === "skipped") return { ok: false, error: "Today was skipped. Nothing is sent.", reason: "invalid" };
  const { data: prior } = await sb.from("change_log").select("new_value").eq("field", "email_sent").eq("new_value->>request_id", requestId).limit(1).maybeSingle();
  if (prior) {
    const v = (prior as Row).new_value as Row;
    return { ok: true, sentAt: String(v.sent_at), sentTime: timeOf(String(v.sent_at), ctx.tz), alreadySent: true };
  }
  const page = await loadPage(sb, ctx, day);
  const owed = owedCount(page);
  if (owed && !force) return { ok: false, error: noReasonText(owed, page.partner?.first ?? "Your partner"), reason: "reasons", owed };
  const partner = page.partner;
  if (!partner) return { ok: false, error: "No accountability partner yet. Add one under More, Partners (name and email), and the report goes to them.", reason: "partner" };
  if (!partner.email || !isValidEmail(partner.email)) return { ok: false, error: `${partner.name} has no valid email address. Add it under More, Partners.`, reason: "partner" };
  const perm = isGoogleConfigured() ? sendPermission(await getGoogleConnection(sb, ctx.ownerId)) : "not_connected";
  if (perm === "reconnect") return { ok: false, error: "Sending from the app is not allowed yet. Reconnect Google once (1 minute) under Settings, Connections, then press Approve and send again.", reason: "google" };
  if (perm !== "allowed") return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections, then press Approve and send again.", reason: "google" };

  const edited = page.reportEdited ? cleanReportHtml(page.reportHtml) : null;
  const inner = edited ?? reportInnerHtml(page.report);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#f8fafc"><tr><td align="center" style="padding:12px 6px">${inner}</td></tr></table>`;
  const body = edited ? signatureHtmlToText(edited) : reportText(page.report);
  const subject = reportSubject(page.report);
  let sent: { id: string; threadId: string | null };
  try {
    const r = await sendGmailMessage(sb, ctx.ownerId, { to: partner.email, subject, body, html });
    if (!r) return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections.", reason: "google" };
    sent = r;
  } catch (e) {
    const x = explainGoogleError(e);
    return { ok: false, error: x.message, reason: "google" };
  }
  const sentAt = new Date().toISOString();
  const summary = reportSummary(page.judged, page.numbers, page.friday);
  // The sent report as a partner report (finalized: it never changes; Reviewed and the reply are recorded on it).
  const { data: report } = await sb
    .from("partner_reports")
    .insert({ owner_id: ctx.ownerId, partner_id: partner.id, period_start: day, period_end: day, status: "finalized", snapshot: { end_of_day: true, day, judged: page.judged, reasons: page.reasons, tomorrow: page.tomorrow, report: page.report, edited: !!edited }, summary, summary_source: "owner", finalized_at: sentAt, delivered_via: ["gmail_sent"], report_kind: "end_of_day", sent_at: sentAt, gmail_message_id: sent.id })
    .select("id")
    .single();
  const reportId = report ? String((report as Row).id) : null;
  let contact: Row | null = null;
  const { data: p } = await sb.from("partners").select("contact_id").eq("id", partner.id).maybeSingle();
  if ((p as Row | null)?.contact_id) contact = ((await sb.from("contacts").select("*").eq("id", (p as Row).contact_id).maybeSingle()).data as Row | null) ?? null;
  const comm = { ...sentEmailCommunication({ kind: "partner_report", ownerId: ctx.ownerId, to: partner.email, subject, body, sentAt, contact }), gmail_message_id: sent.id, gmail_thread_id: sent.threadId };
  let { data: c, error: ce } = await sb.from("communications").insert(comm).select("id").single();
  if (ce && isMissingSchemaError(ce)) ({ data: c, error: ce } = await sb.from("communications").insert(sentEmailCommunication({ kind: "partner_report", ownerId: ctx.ownerId, to: partner.email, subject, body, sentAt, contact })).select("id").single());
  const commId = c ? String((c as Row).id) : null;
  if (commId) {
    const links: Row[] = [{ owner_id: ctx.ownerId, from_type: "communications", from_id: commId, to_type: "partners", to_id: partner.id, relation: "partner report" }];
    if (reportId) links.push({ owner_id: ctx.ownerId, from_type: "communications", from_id: commId, to_type: "partner_reports", to_id: reportId, relation: "report sent" });
    await sb.from("record_links").insert(links);
  }
  await sb.from("change_log").insert({ owner_id: ctx.ownerId, table_name: "partner_reports", record_id: reportId, action: "insert", field: "email_sent", new_value: { request_id: requestId, kind: "end_of_day", to: partner.email, subject, partner_id: partner.id, day, communication_id: commId, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt, edited: !!edited }, actor: "owner" });
  const { error } = await sb.from("end_of_day").update({ status: "sent", sent_at: sentAt, report_id: reportId, report_subject: subject, report_html: inner, report_edited: !!edited, judged: page.judged }).eq("id", row.id);
  if (error) return { ok: false, error: `The email was sent, but the day could not be marked sent: ${error.message}`, reason: "invalid" };
  done();
  return { ok: true, sentAt, sentTime: timeOf(sentAt, ctx.tz) };
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

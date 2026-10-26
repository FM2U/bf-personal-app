"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { activeLinkFor, reportText } from "@/lib/engine/partners";
import { createGmailDraft, getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { sendPermission } from "@/lib/google-scopes";
import { explainGoogleError } from "@/lib/google-errors";
import { isValidEmail } from "@/lib/gmail-mime";
import { prepareOutreachEmail, sentEmailCommunication, type SentEmailInput } from "@/lib/calc/sent-email";
import { isCheckViolation, isMissingSchemaError } from "@/lib/schema-guard";
import { isGoogleConfigured } from "@/lib/env";
import type { Row } from "@/lib/types";

/**
 * Send now: one email per confirmed click. Never called by a job and never for more than one message.
 * After Gmail accepts it: one communication is saved, the send is written to the change log (actor owner),
 * and a partner report is marked sent with the date.
 */

export type SendResult =
  | { ok: true; sentAt: string; messageId: string; alreadySent?: boolean; note?: string }
  | { ok: false; reason: "reconnect" | "not_connected" | "invalid" | "google"; message: string; googleText?: string | null };

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A send already done for this click (a retry or a second submit): returns it instead of sending again. */
async function previousSend(sb: SupabaseClient, requestId: string): Promise<{ sentAt: string; messageId: string } | null> {
  const { data } = await sb.from("change_log").select("new_value,created_at").eq("field", "email_sent").eq("new_value->>request_id", requestId).limit(1).maybeSingle();
  const v = (data as Row | null)?.new_value as Row | undefined;
  return v ? { sentAt: String(v.sent_at ?? (data as Row).created_at), messageId: String(v.gmail_message_id ?? "") } : null;
}

/** Saves the communication, adding the Gmail ids after update 0013 and stepping down for older databases. */
async function saveCommunication(sb: SupabaseClient, input: SentEmailInput, gmail: { id: string; threadId: string | null }): Promise<string | null> {
  const base = sentEmailCommunication(input);
  const attempt = async (row: Record<string, unknown>) => sb.from("communications").insert(row).select("id").single();
  let row: Record<string, unknown> = { ...base, gmail_message_id: gmail.id, gmail_thread_id: gmail.threadId };
  let { data, error } = await attempt(row);
  // Before update 0013: no Gmail id columns (the id is still kept in the change log).
  if (error && isMissingSchemaError(error)) {
    row = { ...base };
    ({ data, error } = await attempt(row));
  }
  // Before update 0011 the consulting purpose is not allowed: save it as general (same as Log outreach).
  if (error && isCheckViolation(error) && row.purpose === "consulting") {
    row = { ...row, purpose: "general" };
    ({ data, error } = await attempt(row));
  }
  // Before update 0009: no purpose or pipeline item columns.
  if (error && isMissingSchemaError(error)) {
    const { purpose: _p, pipeline_item_id: _i, ...rest } = row;
    void _p;
    void _i;
    ({ data, error } = await attempt(rest));
  }
  return error ? null : ((data as Row | null)?.id as string | undefined) ?? null;
}

async function writeChangeLog(sb: SupabaseClient, ownerId: string, entry: { table: string; recordId: string | null; value: Record<string, unknown> }) {
  await sb.from("change_log").insert({ owner_id: ownerId, table_name: entry.table, record_id: entry.recordId, action: "insert", field: "email_sent", new_value: entry.value, actor: "owner" });
}

async function permissionProblem(sb: SupabaseClient, ownerId: string): Promise<SendResult | null> {
  const perm = isGoogleConfigured() ? sendPermission(await getGoogleConnection(sb, ownerId)) : "not_connected";
  if (perm === "allowed") return null;
  if (perm === "reconnect") return { ok: false, reason: "reconnect", message: "Sending from the app is not allowed yet. Reconnect Google once (1 minute), then press Send now again." };
  return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections, or save the message another way." };
}

async function sendOne(sb: SupabaseClient, ownerId: string, msg: { to: string; subject: string; body: string; threadId?: string | null }): Promise<{ id: string; threadId: string | null } | SendResult> {
  try {
    const res = await sendGmailMessage(sb, ownerId, msg);
    if (!res) return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections." };
    return res;
  } catch (e) {
    const x = explainGoogleError(e);
    return { ok: false, reason: x.kind === "reconnect" || x.kind === "no_permission" ? "reconnect" : "google", message: x.message, googleText: x.googleText };
  }
}

/** Outreach Queue, Draft message: sends the approved text to the contact and logs it as outreach. */
export async function sendOutreachEmail(input: { contactId: string; subject: string; body: string; requestId: string; pipelineItemId?: string | null; purpose?: string | null; threadId?: string | null }): Promise<SendResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return { ok: false, reason: "invalid", message: "The send request was not valid. Reload the page and try again." };
  const done = await previousSend(supabase, input.requestId);
  if (done) return { ok: true, ...done, alreadySent: true };
  const { data: c } = await supabase.from("contacts").select("*").eq("id", input.contactId).maybeSingle();
  const contact = c as Row | null;
  if (!contact) return { ok: false, reason: "invalid", message: "Contact not found." };
  if (!contact.email || !isValidEmail(String(contact.email))) return { ok: false, reason: "invalid", message: "This contact has no valid email address. Add one on the contact page, or copy the message instead." };
  const msg = prepareOutreachEmail(input.subject, input.body);
  if (!msg.body.trim()) return { ok: false, reason: "invalid", message: "The message is empty." };
  const problem = await permissionProblem(supabase, ownerId);
  if (problem) return problem;

  const sent = await sendOne(supabase, ownerId, { to: String(contact.email), ...msg, threadId: input.threadId ?? null });
  if ("ok" in sent) return sent;

  const sentAt = new Date().toISOString();
  const commId = await saveCommunication(
    supabase,
    { kind: "outreach", ownerId, to: String(contact.email), subject: msg.subject, body: msg.body, sentAt, contact, pipelineItemId: input.pipelineItemId ?? null, purpose: input.purpose ?? null },
    sent,
  );
  if (commId && input.pipelineItemId) {
    await supabase.from("record_links").insert({ owner_id: ownerId, from_type: "communications", from_id: commId, to_type: "pipeline_items", to_id: input.pipelineItemId, relation: "concerns" });
  }
  await writeChangeLog(supabase, ownerId, {
    table: commId ? "communications" : "contacts",
    recordId: commId ?? String(contact.id),
    value: { request_id: input.requestId, kind: "outreach", to: contact.email, subject: msg.subject, contact_id: contact.id, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt },
  });
  const ctx = await loadCtx(supabase, ownerId);
  await evaluateConditions(ctx);
  revalidatePath("/", "layout");
  return {
    ok: true,
    sentAt,
    messageId: sent.id,
    note: commId ? `Logged as outreach to ${contact.name}.` : `The email was sent, but the communication could not be saved. Press Log outreach to record it.`,
  };
}

/** Partner report page: sends the finalized report email to the accountability partner and marks the report sent. */
export async function sendPartnerReportEmail(input: { reportId: string; requestId: string }): Promise<SendResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return { ok: false, reason: "invalid", message: "The send request was not valid. Reload the page and try again." };
  const done = await previousSend(supabase, input.requestId);
  if (done) return { ok: true, ...done, alreadySent: true };
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", input.reportId).maybeSingle();
  if (!report) return { ok: false, reason: "invalid", message: "Report not found." };
  if (report.status !== "finalized") return { ok: false, reason: "invalid", message: "Finalize the report first. Only a finalized report can be sent." };
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).maybeSingle();
  if (!partner?.email || !isValidEmail(String(partner.email))) return { ok: false, reason: "invalid", message: "Add a valid email address to the accountability partner first." };
  const problem = await permissionProblem(supabase, ownerId);
  if (problem) return problem;

  const link = await activeLinkFor({ sb: supabase }, partner.id);
  const text = reportText(partner, report, link, "email");
  const sent = await sendOne(supabase, ownerId, { to: String(partner.email), subject: text.subject, body: text.body });
  if ("ok" in sent) return sent;

  const sentAt = new Date().toISOString();
  let contact: Row | null = null;
  if (partner.contact_id) contact = ((await supabase.from("contacts").select("*").eq("id", partner.contact_id).maybeSingle()).data as Row | null) ?? null;
  const commId = await saveCommunication(supabase, { kind: "partner_report", ownerId, to: String(partner.email), subject: text.subject, body: text.body, sentAt, contact }, sent);
  if (commId) await supabase.from("record_links").insert({ owner_id: ownerId, from_type: "communications", from_id: commId, to_type: "partners", to_id: partner.id, relation: "partner report" });

  const delivered = [...new Set([...((report.delivered_via as string[] | null) ?? []), "gmail_sent"])];
  let { error } = await supabase.from("partner_reports").update({ delivered_via: delivered, sent_at: sentAt, gmail_message_id: sent.id }).eq("id", report.id);
  // Before update 0013: no sent_at column. The date stays in the change log and the page reads it from there.
  if (error && isMissingSchemaError(error)) ({ error } = await supabase.from("partner_reports").update({ delivered_via: delivered }).eq("id", report.id));
  await writeChangeLog(supabase, ownerId, {
    table: "partner_reports",
    recordId: String(report.id),
    value: { request_id: input.requestId, kind: "partner_report", to: partner.email, subject: text.subject, partner_id: partner.id, communication_id: commId, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, sent_at: sentAt },
  });
  await supabase.from("tasks").update({ status: "done" }).eq("source_key", `partner-report:${report.id}`).eq("status", "todo");
  revalidatePath("/", "layout");
  return { ok: true, sentAt, messageId: sent.id, note: error ? "The email was sent, but the report could not be marked sent." : undefined };
}

/** Partner report page: Save to Gmail drafts (the existing behavior), returning a message instead of an error page. */
export async function saveReportToGmailDrafts(reportId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, ownerId } = await requireOwner();
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, message: "Report not found." };
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).maybeSingle();
  if (!partner?.email) return { ok: false, message: "Add an email address to the accountability partner first." };
  try {
    const link = await activeLinkFor({ sb: supabase }, partner.id);
    const text = reportText(partner, report, link, "email");
    const gmailId = await createGmailDraft(supabase, ownerId, { to: partner.email, subject: text.subject, body: text.body });
    if (!gmailId) return { ok: false, message: "Google is not connected. Connect Google in Settings, Connections." };
    await supabase.from("partner_reports").update({ gmail_draft_id: gmailId, delivered_via: [...new Set([...((report.delivered_via as string[] | null) ?? []), "gmail_draft"])] }).eq("id", report.id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Gmail draft created for ${partner.name}. Open Gmail, Drafts to review and send it.` };
  } catch (e) {
    return { ok: false, message: `The Gmail draft could not be created. ${explainGoogleError(e).message}` };
  }
}

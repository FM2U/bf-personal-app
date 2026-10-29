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
import { emailAddressProblem, isValidEmail } from "@/lib/email-address";
import { composePurpose } from "@/lib/calc/compose-email";
import { AI_SYSTEM_MESSAGE, AIUnavailable, callClaude, cleanText, parseJsonFromText, textOf } from "@/lib/ai/claude";
import { prepareEmailMessage, sentEmailCommunication, type SentEmailInput } from "@/lib/calc/sent-email";
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

async function sendOne(sb: SupabaseClient, ownerId: string, msg: { to: string; subject: string; body: string; bodyHtml?: string | null; threadId?: string | null; includeSignature?: boolean }): Promise<{ id: string; threadId: string | null } | SendResult> {
  try {
    const res = await sendGmailMessage(sb, ownerId, msg);
    if (!res) return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections." };
    return res;
  } catch (e) {
    const x = explainGoogleError(e);
    return { ok: false, reason: x.kind === "reconnect" || x.kind === "no_permission" ? "reconnect" : "google", message: x.message, googleText: x.googleText };
  }
}

type OutreachDelivery = {
  requestId: string;
  to: string;
  subject: string;
  body: string;
  /** The formatted editor's HTML (the text part is made from it). */
  bodyHtml?: string | null;
  contact: Row | null;
  pipelineItemId?: string | null;
  organizationId?: string | null;
  purpose?: string | null;
  threadId?: string | null;
  /** The Include signature checkbox (omitted: the setting in Settings, Email signature). */
  includeSignature?: boolean;
};

/**
 * Sends one approved outreach email and logs it: one communication (counts as outreach), a record link to the
 * pipeline item when there is one, and a change log entry. Shared by Draft message and the Email button.
 */
async function deliverOutreach(sb: SupabaseClient, ownerId: string, d: OutreachDelivery): Promise<SendResult> {
  const msg = prepareEmailMessage(d.subject, d.body, d.bodyHtml);
  if (!msg.body.trim()) return { ok: false, reason: "invalid", message: "The message is empty." };
  const problem = await permissionProblem(sb, ownerId);
  if (problem) return problem;

  const sent = await sendOne(sb, ownerId, { to: d.to, ...msg, threadId: d.threadId ?? null, includeSignature: d.includeSignature });
  if ("ok" in sent) return sent;

  const sentAt = new Date().toISOString();
  const commId = await saveCommunication(
    sb,
    { kind: "outreach", ownerId, to: d.to, subject: msg.subject, body: msg.body, sentAt, contact: d.contact, pipelineItemId: d.pipelineItemId ?? null, organizationId: d.organizationId ?? null, purpose: d.purpose ?? null },
    sent,
  );
  if (commId && d.pipelineItemId) {
    await sb.from("record_links").insert({ owner_id: ownerId, from_type: "communications", from_id: commId, to_type: "pipeline_items", to_id: d.pipelineItemId, relation: "concerns" });
  }
  await writeChangeLog(sb, ownerId, {
    table: commId ? "communications" : d.contact ? "contacts" : "communications",
    recordId: commId ?? (d.contact ? String(d.contact.id) : null),
    value: {
      request_id: d.requestId,
      kind: "outreach",
      to: d.to,
      subject: msg.subject,
      contact_id: d.contact?.id ?? null,
      pipeline_item_id: d.pipelineItemId ?? null,
      organization_id: d.organizationId ?? null,
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      sent_at: sentAt,
    },
  });
  const ctx = await loadCtx(sb, ownerId);
  await evaluateConditions(ctx);
  revalidatePath("/", "layout");
  const who = d.contact ? String(d.contact.name) : d.to;
  return {
    ok: true,
    sentAt,
    messageId: sent.id,
    note: commId ? `Logged as outreach to ${who}.` : `The email was sent, but the communication could not be saved. Press Log outreach to record it.`,
  };
}

/** Outreach Queue, Draft message: sends the approved text to the contact and logs it as outreach. */
export async function sendOutreachEmail(input: { contactId: string; subject: string; body: string; bodyHtml?: string | null; requestId: string; pipelineItemId?: string | null; purpose?: string | null; threadId?: string | null; includeSignature?: boolean }): Promise<SendResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return { ok: false, reason: "invalid", message: "The send request was not valid. Reload the page and try again." };
  const done = await previousSend(supabase, input.requestId);
  if (done) return { ok: true, ...done, alreadySent: true };
  const { data: c } = await supabase.from("contacts").select("*").eq("id", input.contactId).maybeSingle();
  const contact = c as Row | null;
  if (!contact) return { ok: false, reason: "invalid", message: "Contact not found." };
  if (!contact.email || !isValidEmail(String(contact.email))) return { ok: false, reason: "invalid", message: "This contact has no valid email address. Add one on the contact page, or copy the message instead." };
  return deliverOutreach(supabase, ownerId, {
    requestId: input.requestId,
    to: String(contact.email).trim(),
    subject: input.subject,
    body: input.body,
    bodyHtml: input.bodyHtml ?? null,
    contact,
    pipelineItemId: input.pipelineItemId ?? null,
    purpose: input.purpose ?? null,
    threadId: input.threadId ?? null,
    includeSignature: typeof input.includeSignature === "boolean" ? input.includeSignature : undefined,
  });
}

/** What the Email button sends with: the typed To address and the record the email belongs to. */
export type ComposeInput = {
  to: string;
  subject: string;
  body: string;
  /** The formatted editor's HTML (the text part is made from it). */
  bodyHtml?: string | null;
  /** The listed person whose address is in To, or the contact page's contact. */
  contactId?: string | null;
  pipelineItemId?: string | null;
  organizationId?: string | null;
  /** The Include signature checkbox (omitted: the setting in Settings, Email signature). */
  includeSignature?: boolean;
};

/** Loads the contact and the pipeline item's kind for a compose request. Ids that do not exist are dropped. */
async function composeRecords(sb: SupabaseClient, input: ComposeInput) {
  const [{ data: c }, { data: item }] = await Promise.all([
    input.contactId ? sb.from("contacts").select("*").eq("id", input.contactId).maybeSingle() : Promise.resolve({ data: null }),
    input.pipelineItemId ? sb.from("pipeline_items").select("id,name,pipeline_id,organization_id,notes,stage_id").eq("id", input.pipelineItemId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pipelineItem = item as Row | null;
  const { data: pipe } = pipelineItem?.pipeline_id ? await sb.from("pipelines").select("kind,name").eq("id", pipelineItem.pipeline_id).maybeSingle() : { data: null };
  let organizationId = input.organizationId ?? null;
  if (organizationId) {
    const { data: org } = await sb.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (!org) organizationId = null;
  }
  return { contact: (c as Row | null) ?? null, pipelineItem, pipeline: (pipe as Row | null) ?? null, organizationId };
}

/**
 * The Email button (contact, organization, and pipeline item pages) and "Email them" (Outreach Queue): sends the
 * approved email to the typed address and logs it as outreach, linked to the contact and the record.
 */
export async function sendComposedEmail(input: ComposeInput & { requestId: string }): Promise<SendResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return { ok: false, reason: "invalid", message: "The send request was not valid. Reload the page and try again." };
  const done = await previousSend(supabase, input.requestId);
  if (done) return { ok: true, ...done, alreadySent: true };
  const to = String(input.to ?? "").trim();
  const bad = emailAddressProblem(to);
  if (bad) return { ok: false, reason: "invalid", message: bad };
  const { contact, pipelineItem, pipeline, organizationId } = await composeRecords(supabase, input);
  if (input.contactId && !contact) return { ok: false, reason: "invalid", message: "Contact not found." };
  return deliverOutreach(supabase, ownerId, {
    requestId: input.requestId,
    to,
    subject: input.subject,
    body: input.body,
    bodyHtml: input.bodyHtml ?? null,
    contact,
    pipelineItemId: pipelineItem?.id ?? null,
    organizationId,
    purpose: composePurpose({ contact, pipelineKind: (pipeline?.kind as string | null) ?? null }),
    includeSignature: typeof input.includeSignature === "boolean" ? input.includeSignature : undefined,
  });
}

/** The Email button: Save to Gmail drafts. Sends nothing and logs nothing (the owner sends it from Gmail). */
export async function saveComposedGmailDraft(input: { to: string; subject: string; body: string; bodyHtml?: string | null; includeSignature?: boolean }): Promise<{ ok: boolean; message: string }> {
  const { supabase, ownerId } = await requireOwner();
  const to = String(input.to ?? "").trim();
  const bad = emailAddressProblem(to);
  if (bad) return { ok: false, message: bad };
  const msg = prepareEmailMessage(input.subject, input.body, input.bodyHtml);
  if (!msg.body.trim()) return { ok: false, message: "The message is empty." };
  try {
    const id = await createGmailDraft(supabase, ownerId, { to, ...msg, includeSignature: typeof input.includeSignature === "boolean" ? input.includeSignature : undefined });
    if (!id) return { ok: false, message: "Google is not connected. Connect Google in Settings, Connections." };
    return { ok: true, message: `Gmail draft created for ${to}. Open Gmail, Drafts to review and send it. After sending it from Gmail, press Log outreach.` };
  } catch (e) {
    return { ok: false, message: `The Gmail draft could not be created. ${explainGoogleError(e).message}` };
  }
}

export type WriteResult = { ok: true; subject: string; body: string } | { ok: false; error: string };

/**
 * "Write with AI": the owner types one line ("ask about off-market deals"); the AI drafts the subject and message
 * in Bram's voice (the shared message format rule), using the contact and the record for context. Nothing is sent.
 */
export async function writeEmailWithAI(input: ComposeInput & { instruction: string }): Promise<WriteResult> {
  const { supabase, ownerId } = await requireOwner();
  const instruction = String(input.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!instruction) return { ok: false, error: "Type one line about what the email should say, then press Write with AI." };
  const { contact, pipelineItem, pipeline, organizationId } = await composeRecords(supabase, input);
  const orgId = organizationId ?? (contact?.organization_id as string | null) ?? (pipelineItem?.organization_id as string | null) ?? null;
  const [{ data: org }, { data: comms }, { data: stage }] = await Promise.all([
    orgId ? supabase.from("organizations").select("name,kind").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    contact ? supabase.from("communications").select("occurred_at,method,direction,subject,summary").eq("contact_id", contact.id).order("occurred_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
    pipelineItem?.stage_id ? supabase.from("pipeline_stages").select("name").eq("id", pipelineItem.stage_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const to = String(input.to ?? "").trim();
  const context = {
    to,
    recipient: contact ? { name: contact.name, title: contact.title, roles: contact.roles, notes: contact.notes, deal_source: !!contact.is_deal_source, consulting_lead: !!contact.is_consulting_lead } : null,
    organization: (org as Row | null)?.name ?? null,
    pipeline_item: pipelineItem ? { name: pipelineItem.name, pipeline: pipeline?.name ?? null, kind: pipeline?.kind ?? null, stage: (stage as Row | null)?.name ?? null, notes: pipelineItem.notes ?? null } : null,
    recent_communications: ((comms ?? []) as Row[]).map((m) => ({ date: String(m.occurred_at).slice(0, 10), method: m.method, direction: m.direction, subject: m.subject, summary: m.summary })),
  };
  const greetName = contact ? String(contact.name ?? "").split(/\s+/)[0] : "";
  try {
    const msg = await callClaude({
      sb: supabase,
      ownerId,
      purpose: "compose_email",
      system: AI_SYSTEM_MESSAGE,
      messages: [
        {
          role: "user",
          content: `TASK: compose_email\nDraft an email from Bram. What Bram wants the email to do: "${instruction}".\nKeep it short (under 150 words). Start with a greeting${greetName ? ` using the first name ${greetName}` : ""}. Use 2 to 4 short "- " bullets when the email lists questions, items, or next steps; otherwise short paragraphs. End with one clear ask and "Thanks," or "Best," then "Bram". Use only facts from the context below; do not invent numbers, dates, or past conversations. Return only JSON: {"subject": "short subject line", "body": "message text"}.\nContext (JSON): ${JSON.stringify(context).slice(0, 6000)}`,
        },
      ],
      maxTokens: 700,
    });
    const parsed = parseJsonFromText<{ subject?: string; body?: string }>(textOf(msg));
    if (!parsed?.body) return { ok: false, error: "The AI reply could not be read. Try again, or write the message yourself." };
    return { ok: true, subject: cleanText(String(parsed.subject ?? "")).slice(0, 200), body: cleanText(String(parsed.body)) };
  } catch (e) {
    const why = e instanceof AIUnavailable ? e.message : "The AI request failed.";
    return { ok: false, error: `${why} Write the message yourself, or try again later.` };
  }
}

/** Partner report page: sends the finalized report email to the accountability partner and marks the report sent. */
export async function sendPartnerReportEmail(input: { reportId: string; requestId: string; includeSignature?: boolean }): Promise<SendResult> {
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
  const sent = await sendOne(supabase, ownerId, { to: String(partner.email), subject: text.subject, body: text.body, includeSignature: typeof input.includeSignature === "boolean" ? input.includeSignature : undefined });
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
export async function saveReportToGmailDrafts(reportId: string, includeSignature?: boolean): Promise<{ ok: boolean; message: string }> {
  const { supabase, ownerId } = await requireOwner();
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, message: "Report not found." };
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).maybeSingle();
  if (!partner?.email) return { ok: false, message: "Add an email address to the accountability partner first." };
  try {
    const link = await activeLinkFor({ sb: supabase }, partner.id);
    const text = reportText(partner, report, link, "email");
    const gmailId = await createGmailDraft(supabase, ownerId, { to: partner.email, subject: text.subject, body: text.body, includeSignature: typeof includeSignature === "boolean" ? includeSignature : undefined });
    if (!gmailId) return { ok: false, message: "Google is not connected. Connect Google in Settings, Connections." };
    await supabase.from("partner_reports").update({ gmail_draft_id: gmailId, delivered_via: [...new Set([...((report.delivered_via as string[] | null) ?? []), "gmail_draft"])] }).eq("id", report.id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Gmail draft created for ${partner.name}. Open Gmail, Drafts to review and send it.` };
  } catch (e) {
    return { ok: false, message: `The Gmail draft could not be created. ${explainGoogleError(e).message}` };
  }
}

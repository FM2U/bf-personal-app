/**
 * The communication saved after an email is sent from the app (Send now).
 * Outreach emails (Outreach Queue, Draft message) are saved the same way "Log outreach" saves them:
 * is_outreach = true and the same purpose rule, so they count toward the Network outreach target and the
 * deal-sourcing and consulting shares. Partner report emails are not outreach.
 */

import { fixDashes, markdownToPlain } from "@/lib/markdown";
import { emailBodyHtmlToText, isEmailBodyEmpty, sanitizeEmailBodyHtml } from "@/lib/email-body";

/** The exact subject and text an outreach email is saved or sent with (the confirmation dialog shows the same). */
export function prepareOutreachEmail(subject: string, body: string): { subject: string; body: string } {
  return { subject: fixDashes(String(subject ?? "")).trim().slice(0, 200), body: markdownToPlain(fixDashes(String(body ?? "")).trim()) };
}

/**
 * The exact subject and message an email is sent or saved with, from the formatted editor when there is editor
 * HTML: the HTML is cleaned and the text is made from it (the text is not changed in any other way, so what the
 * editor shows is what is sent). Without editor HTML: prepareOutreachEmail.
 */
export function prepareEmailMessage(subject: string, body: string, bodyHtml?: string | null): { subject: string; body: string; bodyHtml: string | null } {
  const html = String(bodyHtml ?? "");
  if (!html.trim() || isEmailBodyEmpty(html)) return { ...prepareOutreachEmail(subject, body), bodyHtml: null };
  const clean = sanitizeEmailBodyHtml(html);
  return { subject: fixDashes(String(subject ?? "")).trim().slice(0, 200), body: emailBodyHtmlToText(clean), bodyHtml: clean };
}

export type OutreachPurpose = "general" | "deal_sourcing" | "consulting";

export const OUTREACH_PURPOSES: OutreachPurpose[] = ["general", "deal_sourcing", "consulting"];

/**
 * Purpose of an outreach communication: as chosen when valid; otherwise consulting for a consulting lead,
 * deal sourcing for a deal-source contact, general for anyone else. (Same rule as "Log outreach".)
 */
export function outreachPurpose(contact: { is_consulting_lead?: unknown; is_deal_source?: unknown } | null | undefined, chosen?: string | null): OutreachPurpose {
  if (chosen && (OUTREACH_PURPOSES as string[]).includes(chosen)) return chosen as OutreachPurpose;
  if (contact?.is_consulting_lead) return "consulting";
  if (contact?.is_deal_source) return "deal_sourcing";
  return "general";
}

/** Short summary for the communication: who it went to and the start of the message on one line. */
export function sentSummary(to: string, body: string, max = 240): string {
  const flat = String(body ?? "").replace(/\s+/g, " ").trim();
  const start = flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
  return `Sent from the app to ${to}.${start ? ` ${start}` : ""}`;
}

export type SentEmailInput = {
  kind: "outreach" | "partner_report";
  ownerId: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  contact: { id?: string | null; organization_id?: string | null; is_consulting_lead?: unknown; is_deal_source?: unknown } | null;
  pipelineItemId?: string | null;
  /** The organization the email is about (organization page). Otherwise the contact's organization. */
  organizationId?: string | null;
  purpose?: string | null;
};

/** The communications row (without the Gmail id columns, which are added only after update 0013). */
export function sentEmailCommunication(i: SentEmailInput): Record<string, unknown> {
  const outreach = i.kind === "outreach";
  return {
    owner_id: i.ownerId,
    occurred_at: i.sentAt,
    method: "email",
    direction: "outgoing",
    contact_id: i.contact?.id ?? null,
    organization_id: i.organizationId ?? i.contact?.organization_id ?? null,
    subject: String(i.subject ?? "").slice(0, 300) || "(No subject)",
    summary: sentSummary(i.to, i.body),
    is_outreach: outreach,
    outcome: null,
    purpose: outreach ? outreachPurpose(i.contact, i.purpose) : "general",
    pipeline_item_id: i.pipelineItemId ?? null,
  };
}

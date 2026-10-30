"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { sendPartnerReportEmail, type SendResult } from "@/app/actions/email";
import { NOTE_MAX } from "@/lib/calc/partner-report";
import { getSendPermission } from "@/lib/google";
import { isValidEmail } from "@/lib/email-address";

/**
 * The daily close's partner reports (database update 0018). Each daily draft is sent only when the owner presses
 * Approve and send (one partner) or Approve and send all (each partner in turn, one email each). Edit note changes the
 * short note shown under the numbers. Not today marks the draft as not sent today; nothing is deleted.
 */

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Finalizes the daily draft (it never changes after this) and sends it with the existing send path. */
export async function approveAndSendDailyReport(input: { reportId: string; requestId: string; attachPdf?: boolean }): Promise<SendResult> {
  const { supabase, ownerId } = await requireOwner();
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) return { ok: false, reason: "invalid", message: "The send request was not valid. Reload the page and try again." };
  const { data: report } = await supabase.from("partner_reports").select("id,status,report_kind,skipped_at,partner_id").eq("id", input.reportId).maybeSingle();
  if (!report || report.report_kind !== "daily") return { ok: false, reason: "invalid", message: "This daily report was not found." };
  // Checked before the report is finalized, so a report that cannot be sent stays a draft (its note can still change).
  const { data: partner } = await supabase.from("partners").select("email").eq("id", report.partner_id).maybeSingle();
  if (!partner?.email || !isValidEmail(String(partner.email))) return { ok: false, reason: "invalid", message: "Add a valid email address to the accountability partner first." };
  const permission = await getSendPermission(supabase, ownerId);
  if (permission === "not_connected") return { ok: false, reason: "not_connected", message: "Google is not connected. Connect Google in Settings, Connections, then press Approve and send again." };
  if (permission === "reconnect") return { ok: false, reason: "reconnect", message: "Sending from the app is not allowed yet. Reconnect Google once (1 minute), then press Approve and send again." };
  if (report.status === "draft") {
    const { error } = await supabase
      .from("partner_reports")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), skipped_at: null })
      .eq("id", report.id)
      .eq("status", "draft");
    if (error) return { ok: false, reason: "invalid", message: `Not sent: the report could not be finalized. ${error.message}` };
  }
  // Templates: the one saved with the draft (the partner's default when it was drafted), showing today's numbers.
  return sendPartnerReportEmail({ reportId: report.id, requestId: input.requestId, attachPdf: !!input.attachPdf });
}

/** Edit note: the short note under the numbers (the report summary). Only while the report is a draft. */
export async function saveDailyReportNote(reportId: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireOwner();
  const text = String(note ?? "").trim();
  if (text.length > NOTE_MAX * 2) return { ok: false, error: `Keep the note to ${NOTE_MAX * 2} characters or fewer.` };
  const { data, error } = await supabase
    .from("partner_reports")
    .update({ summary: text || null, summary_source: "owner" })
    .eq("id", reportId)
    .eq("report_kind", "daily")
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: `Not saved. ${error.message}` };
  if (!data?.length) return { ok: false, error: "This report was already sent, so its note cannot change." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Not today: the drafts (one partner, or every partner still waiting) are not sent today. They stay as drafts. */
export async function skipDailyReports(reportIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireOwner();
  const ids = (reportIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return { ok: false, error: "Nothing to skip." };
  const { error } = await supabase.from("partner_reports").update({ skipped_at: new Date().toISOString() }).in("id", ids).eq("report_kind", "daily").eq("status", "draft");
  if (error) return { ok: false, error: `Not saved. ${error.message}` };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo Not today (the draft can be approved again). */
export async function unskipDailyReport(reportId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("partner_reports").update({ skipped_at: null }).eq("id", reportId).eq("report_kind", "daily").eq("status", "draft");
  if (error) return { ok: false, error: `Not saved. ${error.message}` };
  revalidatePath("/", "layout");
  return { ok: true };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeLinkFor, templateReportEmail } from "@/lib/engine/partners";
import { chooseTemplates, loadReportTemplates } from "@/lib/report-templates";
import { getSendPermission } from "@/lib/google";
import { loadSignature } from "@/lib/signature-store";
import { emailHtml, type SignatureSetup } from "@/lib/email-signature";
import { hasUpdate0018 } from "@/lib/update-0018";
import type { SendPermission } from "@/lib/google-scopes";
import type { Row } from "@/lib/types";

/** One daily partner report on the daily close screen. */
export type DailyReportItem = {
  id: string;
  partnerName: string;
  to: string | null;
  state: "draft" | "sent" | "skipped" | "finalized";
  sentAt: string | null;
  note: string;
  subject: string;
  /** The email as it will be sent (with the signature when the setting adds it). */
  previewHtml: string;
  templateName: string;
};

export type DailyReports = { available: boolean; items: DailyReportItem[]; permission: SendPermission; signature: SignatureSetup | null };

/**
 * The daily partner reports drafted for one day (database update 0018), for the daily close completion screen.
 * Empty before the update, on weekends, and when no partner is set to Daily or Both.
 */
export async function loadDailyReports(sb: SupabaseClient, ownerId: string, day: string): Promise<DailyReports> {
  if (!(await hasUpdate0018(sb))) return { available: false, items: [], permission: "not_connected", signature: null };
  const { data } = await sb.from("partner_reports").select("*").eq("owner_id", ownerId).eq("report_kind", "daily").eq("period_end", day).order("created_at");
  const reports = (data ?? []) as Row[];
  if (!reports.length) return { available: true, items: [], permission: "not_connected", signature: null };
  const [{ data: partners }, { templates }, permission, signature] = await Promise.all([
    sb.from("partners").select("*").in("id", reports.map((r) => r.partner_id)),
    loadReportTemplates(sb, ownerId),
    getSendPermission(sb, ownerId),
    loadSignature(sb, ownerId),
  ]);
  const byId = new Map(((partners ?? []) as Row[]).map((p) => [String(p.id), p]));
  const items: DailyReportItem[] = [];
  for (const r of reports) {
    const p = byId.get(String(r.partner_id)) ?? { id: r.partner_id, name: "Accountability partner" };
    const chosen = chooseTemplates(templates, r.template_id ? [String(r.template_id)] : null, p);
    const link = await activeLinkFor({ sb }, String(p.id));
    const email = templateReportEmail(p, r, link, chosen);
    const sent = !!r.sent_at || ((r.delivered_via ?? []) as string[]).includes("gmail_sent");
    items.push({
      id: String(r.id),
      partnerName: String(p.name),
      to: (p.email as string | null) ?? null,
      state: sent ? "sent" : r.status === "finalized" ? "finalized" : r.skipped_at ? "skipped" : "draft",
      sentAt: (r.sent_at as string | null) ?? null,
      note: String(r.summary ?? ""),
      subject: email.subject,
      previewHtml: signature?.on ? emailHtml("", signature.html, email.html) : email.html,
      templateName: chosen.map((t) => t.name).join(" and "),
    });
  }
  return { available: true, items, permission, signature };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeLinkFor, reportForEmail } from "@/lib/engine/partners";
import { loadReportTemplates, chooseTemplates } from "@/lib/report-templates";
import { reportEmailHtml, reportEmailText, toTemplate, type ReportTemplate } from "@/lib/calc/partner-report";
import type { Row } from "@/lib/types";

/**
 * A communication that is a sent partner report: the report as it was sent. Communication history opens this view
 * (the window and the full page) instead of the plain communication details.
 *
 * Which report: the record link from the communication to the report (sends from Edit batch 7 on), otherwise the
 * change log entry of the send (it names the communication). Which templates: the templates saved in that change log
 * entry (measures and period, from Edit batch 7 on), otherwise the template names it lists matched to today's
 * templates, otherwise the partner's default. The numbers are the report's saved numbers (a sent report never changes).
 */
export type SentReport = {
  reportId: string;
  partnerName: string;
  subject: string;
  html: string;
  sentAt: string | null;
  templateNames: string[];
  pdfHref: string;
  reportHref: string;
  pdfAttached: boolean;
};

export async function loadSentReport(sb: SupabaseClient, ownerId: string, communicationId: string): Promise<SentReport | null> {
  const [{ data: link }, { data: logs }] = await Promise.all([
    sb.from("record_links").select("to_id").eq("from_type", "communications").eq("from_id", communicationId).eq("to_type", "partner_reports").limit(1),
    sb.from("change_log").select("record_id,new_value,created_at").eq("field", "email_sent").eq("table_name", "partner_reports").eq("new_value->>communication_id", communicationId).order("created_at", { ascending: false }).limit(1),
  ]);
  const log = ((logs ?? []) as Row[])[0] ?? null;
  const reportId = (((link ?? []) as Row[])[0]?.to_id as string | undefined) ?? (log?.record_id as string | undefined) ?? null;
  if (!reportId) return null;
  const { data: report } = await sb.from("partner_reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return null;
  const { data: partner } = await sb.from("partners").select("*").eq("id", report.partner_id).maybeSingle();
  const value = (log?.new_value ?? {}) as Row;
  const saved = Array.isArray(value.template_defs) ? (value.template_defs as Row[]).map((t) => toTemplate(t as Parameters<typeof toTemplate>[0])) : [];
  let templates: ReportTemplate[] = saved.slice(0, 2);
  if (!templates.length) {
    const { templates: all } = await loadReportTemplates(sb, ownerId);
    const names = Array.isArray(value.templates) ? (value.templates as string[]) : [];
    const byName = names.map((n) => all.find((t) => t.name === n)).filter((t): t is ReportTemplate => !!t);
    templates = byName.length ? byName.slice(0, 2) : chooseTemplates(all, report.template_id ? [String(report.template_id)] : null, (partner as Row | null) ?? null);
  }
  const linkUrl = partner ? await activeLinkFor({ sb }, String(partner.id)) : null;
  const input = { partnerName: String(partner?.name ?? "Accountability partner"), report: reportForEmail(report as Row), templates, link: linkUrl };
  return {
    reportId: String(report.id),
    partnerName: input.partnerName,
    subject: reportEmailText(input).subject,
    html: reportEmailHtml(input),
    sentAt: (value.sent_at as string | undefined) ?? (report.sent_at as string | undefined) ?? (log?.created_at as string | undefined) ?? null,
    templateNames: templates.map((t) => t.name),
    pdfHref: `/api/report-pdf/${report.id}?t=${templates.map((t) => encodeURIComponent(t.id)).join(",")}`,
    reportHref: `/accountability/reports/${report.id}`,
    pdfAttached: !!value.pdf_attached,
  };
}

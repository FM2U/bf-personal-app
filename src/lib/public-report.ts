import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { Row } from "@/lib/types";
import { defaultTemplateFor, type ReportTemplate } from "@/lib/calc/partner-report";
import { loadReportTemplates } from "@/lib/report-templates";

/**
 * Looks up a private partner link by the hash of its token, using the service role key.
 * Returns only the partner's display name and that partner's finalized reports. Nothing else is read.
 */
export async function resolvePartnerLink(token: string): Promise<{ link: Row; partnerName: string; ownerId: string } | null> {
  if (!env.supabaseServiceKey || !token || token.length < 20 || token.length > 100) return null;
  const sb = createServiceClient();
  const { data: link } = await sb.from("partner_links").select("id,partner_id,owner_id,expires_at,revoked_at").eq("token_hash", sha256(token)).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && link.expires_at < new Date().toISOString())) return null;
  const { data: partner } = await sb.from("partners").select("name,is_active").eq("id", link.partner_id).single();
  if (!partner || !partner.is_active) return null;
  return { link, partnerName: partner.name, ownerId: link.owner_id };
}

export async function partnerReports(partnerId: string): Promise<Row[]> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("partner_reports")
    .select("id,period_start,period_end,snapshot,summary,finalized_at,reviewed_at,partner_comment,comment_at,call_requested_at,owner_id")
    .eq("partner_id", partnerId)
    .eq("status", "finalized")
    .order("period_end", { ascending: false })
    .limit(52);
  return (data ?? []) as Row[];
}

/**
 * The partner's report template for the public page (the partner's default template, otherwise Standard). Reads only
 * the owner's templates and this partner's template choice. Before database update 0017: the starter Standard template.
 */
export async function partnerTemplate(partnerId: string, ownerId: string): Promise<ReportTemplate> {
  const sb = createServiceClient();
  const [{ templates }, { data: partner }] = await Promise.all([loadReportTemplates(sb, ownerId), sb.from("partners").select("report_template_id").eq("id", partnerId).maybeSingle()]);
  return defaultTemplateFor(templates, ((partner as Row | null)?.report_template_id as string | null | undefined) ?? null);
}

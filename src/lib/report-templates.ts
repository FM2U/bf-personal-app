import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTemplateFor, STARTER_TEMPLATES, toTemplate, type ReportTemplate } from "@/lib/calc/partner-report";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/**
 * Partner report templates (database update 0017). Before the update, the three starter templates from the code are
 * used (they cannot be edited then) and every partner gets Standard.
 */
export async function loadReportTemplates(sb: SupabaseClient, ownerId?: string): Promise<{ available: boolean; templates: ReportTemplate[]; error?: string }> {
  let q = sb.from("partner_report_templates").select("id,name,measures,period,note,starter_key,sort_order");
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q.order("sort_order").order("name");
  // Before update 0017 (or when the read fails): the starter templates from the code, not editable.
  if (error) return { available: false, templates: STARTER_TEMPLATES, ...(isMissingSchemaError(error) ? {} : { error: error.message }) };
  const list = ((data ?? []) as Row[]).map((r) => toTemplate(r as Parameters<typeof toTemplate>[0]));
  return { available: true, templates: list.length ? list : STARTER_TEMPLATES };
}

/** The templates chosen for a send: up to two known ids, otherwise the partner's default template. */
export function chooseTemplates(templates: ReportTemplate[], ids: (string | null | undefined)[] | null | undefined, partner: Row | null): ReportTemplate[] {
  const picked: ReportTemplate[] = [];
  for (const id of ids ?? []) {
    const t = templates.find((x) => x.id === id);
    if (t && !picked.some((p) => p.id === t.id)) picked.push(t);
    if (picked.length === 2) break;
  }
  return picked.length ? picked : [defaultTemplateFor(templates, (partner?.report_template_id as string | null | undefined) ?? null)];
}

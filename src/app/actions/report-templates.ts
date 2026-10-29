"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { isMeasureKey, MEASURE_KEYS, NOTE_MAX, templateProblems } from "@/lib/calc/partner-report";
import { hasUpdate0017 } from "@/lib/update-0017";
import { DB_UPDATE_NOTICE_0017 } from "@/lib/schema-guard";

/**
 * Accountability, Report templates: add, edit (also rename), and delete partner report templates, and choose each
 * partner's default template. Needs database update 0017; before it every action answers with the update notice.
 */

export type TemplateResult = { ok: true; id: string; message: string } | { ok: false; error: string };

const PAGE = "/accountability/report-templates";

export async function saveReportTemplate(input: { id?: string | null; name: string; measures: string[]; period: string; note?: string | null }): Promise<TemplateResult> {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0017(supabase))) return { ok: false, error: DB_UPDATE_NOTICE_0017 };
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  const note = String(input.note ?? "").trim().slice(0, NOTE_MAX + 1);
  const wanted = new Set((input.measures ?? []).filter(isMeasureKey));
  const measures = MEASURE_KEYS.filter((k) => wanted.has(k));
  const problems = templateProblems({ name, measures, period: String(input.period), note });
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const row = { name, measures, period: input.period, note: note || null };
  if (input.id) {
    const { data, error } = await supabase.from("partner_report_templates").update(row).eq("id", input.id).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: `Not saved. ${error?.message ?? "The template was not found. It may have been deleted."}` };
    revalidatePath(PAGE);
    return { ok: true, id: String(data.id), message: `Saved ${name}.` };
  }
  const { data: last } = await supabase.from("partner_report_templates").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("partner_report_templates").insert({ ...row, sort_order: Number(last?.sort_order ?? 3) + 1 }).select("id").single();
  if (error || !data) return { ok: false, error: `Not saved. ${error?.message ?? ""}`.trim() };
  revalidatePath(PAGE);
  return { ok: true, id: String(data.id), message: `Added ${name}.` };
}

export async function deleteReportTemplate(id: string): Promise<TemplateResult> {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0017(supabase))) return { ok: false, error: DB_UPDATE_NOTICE_0017 };
  const { count } = await supabase.from("partner_report_templates").select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) return { ok: false, error: "Keep at least one template. Add another before deleting this one." };
  const { data: t } = await supabase.from("partner_report_templates").select("name").eq("id", id).maybeSingle();
  // Partners that used it fall back to Standard (the column is cleared by the database: on delete set null).
  const { error } = await supabase.from("partner_report_templates").delete().eq("id", id);
  if (error) return { ok: false, error: `Not deleted. ${error.message}` };
  revalidatePath(PAGE);
  return { ok: true, id, message: `Deleted ${t?.name ?? "the template"}.` };
}

export async function setPartnerTemplate(partnerId: string, templateId: string | null): Promise<TemplateResult> {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0017(supabase))) return { ok: false, error: DB_UPDATE_NOTICE_0017 };
  const { error } = await supabase.from("partners").update({ report_template_id: templateId || null }).eq("id", partnerId);
  if (error) return { ok: false, error: `Not saved. ${error.message}` };
  revalidatePath(PAGE);
  return { ok: true, id: partnerId, message: "Saved." };
}

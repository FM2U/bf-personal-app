import { NextResponse } from "next/server";
import { getOwner } from "@/lib/auth";
import { activeLinkFor } from "@/lib/engine/partners";
import { chooseTemplates, loadReportTemplates } from "@/lib/report-templates";
import { reportPdf, reportPdfName } from "@/lib/report-pdf";
import type { Row } from "@/lib/types";

/**
 * The partner report as a PDF, for the "Open the PDF" link next to the email preview (signed-in owner only).
 * ?t=<template id>,<template id> picks up to two templates; otherwise the partner's default template.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const sb = owner.supabase;
  const { data: report } = await sb.from("partner_reports").select("*").eq("id", id).maybeSingle();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const { data: partner } = await sb.from("partners").select("*").eq("id", report.partner_id).maybeSingle();
  const ids = (new URL(req.url).searchParams.get("t") ?? "").split(",").filter(Boolean);
  const { templates } = await loadReportTemplates(sb, owner.ownerId);
  // A daily report uses the template saved with its draft when no template is named.
  const chosen = chooseTemplates(templates, ids.length ? ids : report.template_id ? [String(report.template_id)] : [], (partner as Row | null) ?? null);
  const link = partner ? await activeLinkFor({ sb }, String(partner.id)) : null;
  const bytes = await reportPdf({ partnerName: String(partner?.name ?? "Accountability partner"), report: { period_start: report.period_start, period_end: report.period_end, summary: report.summary ?? null, snapshot: report.snapshot ?? null }, templates: chosen, link });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${reportPdfName(String(report.period_start), String(report.period_end))}"`, "Cache-Control": "no-store" },
  });
}

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolvePartnerLink } from "@/lib/public-report";
import { alertPartnerResponse } from "@/lib/engine/partners";
import { env } from "@/lib/env";

/** Optional partner responses from the public report page: Reviewed, comment, Request a call. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePartnerLink(token);
  if (!resolved) return NextResponse.json({ error: "This link is not active." }, { status: 404 });
  const fd = await req.formData();
  const reportId = String(fd.get("report_id") ?? "");
  const action = String(fd.get("action") ?? "");
  const sb = createServiceClient();
  const { data: report } = await sb.from("partner_reports").select("id,partner_id,status").eq("id", reportId).maybeSingle();
  if (!report || report.partner_id !== resolved.link.partner_id || report.status !== "finalized") {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  const now = new Date().toISOString();
  if (action === "reviewed") await sb.from("partner_reports").update({ reviewed_at: now }).eq("id", reportId);
  else if (action === "comment") {
    const comment = String(fd.get("comment") ?? "").trim().slice(0, 2000);
    if (comment) await sb.from("partner_reports").update({ partner_comment: comment, comment_at: now }).eq("id", reportId);
  } else if (action === "call") await sb.from("partner_reports").update({ call_requested_at: now }).eq("id", reportId);
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  await alertPartnerResponse({ sb, ownerId: resolved.ownerId }, report, resolved.partnerName, action);
  return NextResponse.redirect(new URL(`/report/${token}?r=${reportId}&done=${action}`, env.appUrl), 303);
}

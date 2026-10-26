import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { activeLinkFor, reportText } from "@/lib/engine/partners";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DetailGrid, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { ReportView } from "@/components/app/report-view";
import { createGmailDraftForReport, finalizeReport, saveReportSummary } from "@/app/actions/domain";
import { date as fmtDate, dateTime } from "@/lib/format";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOwner();
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", id).maybeSingle();
  if (!report) notFound();
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).single();
  const link = partner ? await activeLinkFor({ sb: supabase }, partner.id) : null;
  const draft = report.status === "draft";
  const methods: string[] = partner?.delivery_methods ?? [];
  const script = partner ? reportText(partner, report, link, "phone").body : "";
  return (
    <div>
      <Link href="/accountability/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> Partner reports
      </Link>
      <PageHeader
        title={`Report for ${partner?.name ?? "accountability partner"}`}
        description={`${fmtDate(report.period_start)} to ${fmtDate(report.period_end)}. ${draft ? "Draft: edit the summary, then finalize. A finalized report never changes." : `Finalized ${dateTime(report.finalized_at)}. This saved copy does not change.`}`}
        actions={<Badge variant={draft ? "warning" : "success"}>{draft ? "Draft" : "Finalized"}</Badge>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {draft ? (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>{report.summary_source === "ai" ? "Drafted by the AI. Edit as needed." : report.summary_source === "owner" ? "Edited by you." : "Drafted from the numbers (AI not available)."}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={report.id} />
                  <Textarea name="summary" rows={6} defaultValue={report.summary ?? ""} />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton formAction={finalizeReport} pendingText="Finalizing...">
                      Finalize{methods.includes("email") ? " and create Gmail draft" : ""}
                    </SubmitButton>
                    <SubmitButton formAction={saveReportSummary} variant="outline">
                      Save summary
                    </SubmitButton>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <ReportView report={draft ? { ...report, summary: null } : report} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
              <CardDescription>Automatic sending is off. The app creates a Gmail draft and you press send.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailGrid
                items={[
                  { label: "Methods", value: methods.length ? methods.map((m) => (m === "email" ? "Gmail draft" : m === "phone" ? "Phone call" : "Printed letter")).join(", ") : "None chosen" },
                  { label: "Delivered", value: (report.delivered_via ?? []).length ? (report.delivered_via as string[]).join(", ").replace("gmail_draft", "Gmail draft created") : "Not yet" },
                  { label: "Private link", value: link ? <span className="break-all font-mono text-xs">{link}</span> : "No active link. Create one on the partner's page." },
                ]}
              />
              {!draft && methods.includes("email") ? (
                <form action={createGmailDraftForReport}>
                  <input type="hidden" name="id" value={report.id} />
                  <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Creating draft...">
                    {report.gmail_draft_id ? "Create another Gmail draft" : "Create Gmail draft"}
                  </SubmitButton>
                </form>
              ) : null}
              {!draft && methods.includes("mail") ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/accountability/reports/${report.id}/print`}>Open printable letter</Link>
                </Button>
              ) : null}
              {partner ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/records/partners/${partner.id}`}>Open accountability partner</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
          {methods.includes("phone") ? (
            <Card>
              <CardHeader>
                <CardTitle>Phone call script</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm">{script}</div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Partner responses (optional)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {!report.reviewed_at && !report.partner_comment && !report.call_requested_at ? <p className="text-muted-foreground">No responses. None are required.</p> : null}
              {report.reviewed_at ? <Notice tone="success">Reviewed on {dateTime(report.reviewed_at)}.</Notice> : null}
              {report.call_requested_at ? <Notice tone="warn">A call was requested on {dateTime(report.call_requested_at)}.</Notice> : null}
              {report.partner_comment ? (
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Comment, {dateTime(report.comment_at)}</p>
                  <p className="whitespace-pre-wrap">{report.partner_comment}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

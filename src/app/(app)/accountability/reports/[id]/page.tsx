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
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ReportView } from "@/components/app/report-view";
import { createGmailDraftForReport, finalizeReport, saveReportSummary } from "@/app/actions/domain";
import { date as fmtDate, dateTime } from "@/lib/format";
import { AiText } from "@/components/app/ai-text";
import { ReportEmailPanel } from "@/components/app/report-email-panel";
import { loadReportTemplates } from "@/lib/report-templates";
import { defaultTemplateFor } from "@/lib/calc/partner-report";
import { getGoogleConnection, getSendPermission } from "@/lib/google";
import { loadSignature } from "@/lib/signature-store";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const { data: report } = await supabase.from("partner_reports").select("*").eq("id", id).maybeSingle();
  if (!report) notFound();
  const { data: partner } = await supabase.from("partners").select("*").eq("id", report.partner_id).single();
  const link = partner ? await activeLinkFor({ sb: supabase }, partner.id) : null;
  const draft = report.status === "draft";
  const methods: string[] = partner?.delivery_methods ?? [];
  const script = partner ? reportText(partner, report, link, "phone").body : "";
  const emailText = partner ? reportText(partner, report, link, "email") : null;
  const [permission, google, signature, templateData] = await Promise.all([getSendPermission(supabase, ownerId), getGoogleConnection(supabase, ownerId), loadSignature(supabase, ownerId), loadReportTemplates(supabase, ownerId)]);
  const defaultTemplate = defaultTemplateFor(templateData.templates, (partner?.report_template_id as string | null | undefined) ?? null);
  const canSend = !draft && methods.includes("email") && !!partner?.email && permission !== "not_connected";
  const delivered = (report.delivered_via ?? []) as string[];
  // Sent from the app: the date is on the report after update 0013; before it, the change log has it.
  let sentAt: string | null = (report.sent_at as string | null | undefined) ?? null;
  if (!sentAt && delivered.includes("gmail_sent")) {
    const { data: logRow } = await supabase.from("change_log").select("created_at").eq("table_name", "partner_reports").eq("record_id", report.id).eq("field", "email_sent").order("created_at", { ascending: false }).limit(1).maybeSingle();
    sentAt = (logRow?.created_at as string | undefined) ?? null;
  }
  const deliveredText = delivered.length
    ? delivered
        .map((d) => (d === "gmail_draft" ? "Gmail draft created" : d === "gmail_sent" ? `Sent from the app${sentAt ? ` on ${dateTime(sentAt)}` : ""}` : d))
        .join(", ")
    : "Not yet";
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
                <GuardedForm
                  action={async (fd: FormData) => {
                    "use server";
                    if (fd.get("__intent") === "finalize") await finalizeReport(fd);
                    else await saveReportSummary(fd);
                  }}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="id" value={report.id} />
                  <Textarea name="summary" rows={6} defaultValue={report.summary ?? ""} aria-label="Summary" />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton name="__intent" value="finalize" pendingText="Finalizing...">
                      Finalize{methods.includes("email") ? " and create Gmail draft" : ""}
                    </SubmitButton>
                    <SubmitButton name="__intent" value="save" variant="outline" data-save-and-leave>
                      Save summary
                    </SubmitButton>
                  </div>
                </GuardedForm>
                {report.summary ? (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">How the partner sees the saved summary</p>
                    <AiText text={report.summary} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Report email</CardTitle>
              <CardDescription>
                Choose the template (which numbers the email shows), or two templates in one email. The preview is the email as it will be sent. Templates are set up in{" "}
                <Link href="/accountability/report-templates" className="text-primary-strong hover:underline">
                  Report templates
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {draft ? <Notice>Preview only. Finalize the report to send it.</Notice> : null}
              <ReportEmailPanel
                reportId={report.id}
                input={{ partnerName: String(partner?.name ?? "Accountability partner"), report: { period_start: report.period_start, period_end: report.period_end, summary: report.summary ?? null, snapshot: report.snapshot ?? null }, link }}
                templates={templateData.templates}
                defaultTemplateId={defaultTemplate.id}
                send={
                  canSend && partner?.email
                    ? { to: String(partner.email), permission, fromEmail: (google?.google_email as string | null) ?? null, alreadySent: delivered.includes("gmail_sent"), hasDraft: !!report.gmail_draft_id, signature }
                    : null
                }
              />
            </CardContent>
          </Card>
          <ReportView report={draft ? { ...report, summary: null } : report} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Delivery</CardTitle>
              <CardDescription>Nothing is sent automatically. Send now shows the email first and sends it only when you press Send email. Save to Gmail drafts sends nothing.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailGrid
                items={[
                  { label: "Methods", value: methods.length ? methods.map((m) => (m === "email" ? "Email" : m === "phone" ? "Phone call" : "Printed letter")).join(", ") : "None chosen" },
                  { label: "Delivered", value: deliveredText },
                  { label: "Private link", value: link ? <span className="break-all font-mono text-xs">{link}</span> : "No active link. Create one on the partner's page." },
                ]}
              />
              {!draft && methods.includes("email") && emailText ? (
                partner?.email ? (
                  permission === "not_connected" ? (
                    <GuardedForm action={createGmailDraftForReport}>
                      <input type="hidden" name="id" value={report.id} />
                      <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Creating draft...">
                        {report.gmail_draft_id ? "Create another Gmail draft" : "Create Gmail draft"}
                      </SubmitButton>
                    </GuardedForm>
                  ) : (
                    <p className="text-sm text-muted-foreground">Send now and Save to Gmail drafts are under the email preview.</p>
                  )
                ) : (
                  <Notice tone="warn">Add an email address to the accountability partner to send this report.</Notice>
                )
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

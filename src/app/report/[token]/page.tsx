import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/server";
import { partnerReports, partnerTemplate, resolvePartnerLink } from "@/lib/public-report";
import { ReportTiles } from "@/components/app/report-tiles";
import { ReportView } from "@/components/app/report-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/app/page-header";
import { date as fmtDate, dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Accountability report", robots: { index: false, follow: false } };

export default async function PublicReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string; done?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const resolved = await resolvePartnerLink(token);
  if (!resolved) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Notice tone="warn">This link is not active. It may have expired or been revoked. Ask for a new link.</Notice>
      </div>
    );
  }
  await createServiceClient().from("partner_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", resolved.link.id);
  const reports = await partnerReports(resolved.link.partner_id);
  const report = reports.find((r) => r.id === sp.r) ?? reports[0];
  const template = await partnerTemplate(resolved.link.partner_id, resolved.ownerId);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">Accountability report for {resolved.partnerName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{report ? `${fmtDate(report.period_start)} to ${fmtDate(report.period_end)}` : "No reports yet"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Nothing is required from you. The buttons below are optional.</p>
      </header>
      {sp.done ? (
        <div className="mb-4">
          <Notice tone="success">{sp.done === "call" ? "Call requested. Thank you." : sp.done === "comment" ? "Comment sent. Thank you." : "Marked as reviewed. Thank you."}</Notice>
        </div>
      ) : null}
      {report ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <ReportTiles input={{ partnerName: resolved.partnerName, report: { period_start: report.period_start, period_end: report.period_end, summary: report.summary ?? null, snapshot: report.snapshot ?? null }, templates: [template], link: null }} />
            <ReportView report={report} />
          </div>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Optional responses</CardTitle>
                <CardDescription>None are required.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <form action={`/api/report/${token}`} method="post">
                  <input type="hidden" name="report_id" value={report.id} />
                  <input type="hidden" name="action" value="reviewed" />
                  <Button type="submit" variant={report.reviewed_at ? "outline" : "default"} className="w-full">
                    {report.reviewed_at ? `Reviewed ${dateTime(report.reviewed_at)}` : "Reviewed"}
                  </Button>
                </form>
                <form action={`/api/report/${token}`} method="post" className="flex flex-col gap-2">
                  <input type="hidden" name="report_id" value={report.id} />
                  <input type="hidden" name="action" value="comment" />
                  <Textarea name="comment" rows={3} maxLength={2000} placeholder="Optional comment" defaultValue={report.partner_comment ?? ""} aria-label="Comment" />
                  <Button type="submit" variant="outline">
                    Send comment
                  </Button>
                </form>
                <form action={`/api/report/${token}`} method="post">
                  <input type="hidden" name="report_id" value={report.id} />
                  <input type="hidden" name="action" value="call" />
                  <Button type="submit" variant="outline" className="w-full">
                    {report.call_requested_at ? `Call requested ${dateTime(report.call_requested_at)}` : "Request a call"}
                  </Button>
                </form>
              </CardContent>
            </Card>
            {reports.length > 1 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Earlier reports</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {reports.map((r) => (
                      <li key={r.id}>
                        <a href={`?r=${r.id}`} className={r.id === report.id ? "font-medium" : "text-primary-strong hover:underline"}>
                          {fmtDate(r.period_start)} to {fmtDate(r.period_end)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : (
        <Notice>The first report has not been sent yet.</Notice>
      )}
    </div>
  );
}

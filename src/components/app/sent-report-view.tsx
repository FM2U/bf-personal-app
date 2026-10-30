"use client";

import Link from "next/link";
import { FileText, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailHtmlPreview } from "@/components/app/email-preview";
import { dateTime } from "@/lib/format";
import type { SentReport } from "@/lib/sent-report";

/**
 * A sent partner report, as it was sent: the subject, who it went to and when, "Open the PDF", "Open the report
 * record", and the visual report email in a frame that runs no scripts (the same builder as the email itself).
 * Used by the communication window and the communication page (Communication history).
 */
export function SentReportView({ r }: { r: SentReport }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="sent-report-view">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="clamp-2 text-sm font-semibold text-slate-900">{r.subject}</p>
          <p className="text-xs text-muted-foreground">
            Sent to {r.partnerName}
            {r.sentAt ? ` on ${dateTime(r.sentAt)}` : ""}. {r.templateNames.length > 1 ? "Templates" : "Template"}: {r.templateNames.join(" and ")}
            {r.pdfAttached ? ". The PDF was attached." : "."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={r.pdfHref} target="_blank" rel="noopener" data-testid="sent-report-pdf">
              <FileText /> Open the PDF
            </a>
          </Button>
          <Button asChild size="sm">
            <Link href={r.reportHref} data-full-page data-testid="sent-report-record">
              <ScrollText /> Open the report record
            </Link>
          </Button>
        </div>
      </div>
      <div className="max-w-[640px]">
        <EmailHtmlPreview html={r.html} title="The report as sent" testId="sent-report-frame" />
      </div>
    </div>
  );
}

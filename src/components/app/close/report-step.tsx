import { DailyReportsPanel } from "@/components/app/daily-reports-panel";
import { EmailHtmlPreview } from "@/components/app/email-preview";
import { SubmitButton } from "@/components/app/submit-button";
import { finishClose } from "@/app/actions/today";
import type { DailyReports } from "@/lib/daily-reports";

/**
 * Close the day, step 3: today's report for each partner set to Daily or Both, exactly as the daily close showed it
 * (Approve and send, Edit note, Not today). With no such partner, the report is shown anyway (nothing is sent).
 * Finish completes the close and returns to Today.
 */
export function ReportStep({ reports, preview, weekday }: { reports: DailyReports | null; preview: { subject: string; html: string } | null; weekday: boolean }) {
  const hasItems = !!reports?.items.length;
  return (
    <div className="flex flex-col gap-5" data-testid="close-report">
      {hasItems ? (
        <DailyReportsPanel items={reports!.items} permission={reports!.permission} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700" data-testid="close-report-note">
            {weekday ? "No partner is set to daily reports, so nothing is sent. This is what the report would say." : "Daily reports are sent on weekdays only. This is what the report would say."}
          </p>
          {preview ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                Preview: <span className="font-medium text-slate-800">{preview.subject}</span>
              </p>
              <div className="max-h-[60vh] max-w-[640px] overflow-y-auto rounded-md">
                <EmailHtmlPreview html={preview.html} title="Daily report preview" testId="daily-preview" />
              </div>
            </div>
          ) : null}
        </div>
      )}
      <form action={finishClose} className="flex justify-end border-t border-slate-200 pt-4">
        <SubmitButton pendingText="Finishing..." data-testid="close-finish">
          Finish
        </SubmitButton>
      </form>
    </div>
  );
}

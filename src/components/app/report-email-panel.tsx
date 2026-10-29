"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { NativeSelect } from "@/components/ui/input";
import { EmailHtmlPreview } from "@/components/app/email-preview";
import { ReportSendButtons } from "@/components/app/send-email";
import { reportEmailHtml, reportEmailText, PERIOD_LABEL, type ReportInput, type ReportTemplate } from "@/lib/calc/partner-report";
import type { SendPermission } from "@/lib/google-scopes";
import type { SignatureSetup } from "@/lib/email-signature";

/**
 * "Report email" card on the partner report page: choose the template (the partner's default is chosen first), an
 * optional second template sent in the same email, and whether to attach a PDF (off by default). The preview below
 * shows the email exactly as it is built (the same function the server uses to send it). Send now and Save to Gmail
 * drafts send this email; a draft report shows the preview only.
 */
export function ReportEmailPanel({
  reportId,
  input,
  templates,
  defaultTemplateId,
  send,
}: {
  reportId: string;
  input: Omit<ReportInput, "templates">;
  templates: ReportTemplate[];
  defaultTemplateId: string;
  /** Null when the report cannot be sent from here (draft, no email address, or Google not connected). */
  send: { to: string; permission: SendPermission; fromEmail: string | null; alreadySent: boolean; hasDraft: boolean; signature: SignatureSetup | null } | null;
}) {
  const [first, setFirst] = useState(defaultTemplateId);
  const [second, setSecond] = useState("");
  const [attachPdf, setAttachPdf] = useState(false);
  const chosen = useMemo(() => [first, second].filter(Boolean).map((id) => templates.find((t) => t.id === id)).filter((t): t is ReportTemplate => !!t), [first, second, templates]);
  const { html, text } = useMemo(() => {
    const full = { ...input, templates: chosen };
    return { html: reportEmailHtml(full), text: reportEmailText(full) };
  }, [input, chosen]);
  const pdfName = `Accountability report ${input.report.period_start} to ${input.report.period_end}.pdf`;
  const pdfHref = `/api/report-pdf/${reportId}?t=${chosen.map((t) => encodeURIComponent(t.id)).join(",")}`;
  const describe = (t: ReportTemplate) => `${t.name} (${PERIOD_LABEL[t.period].split(" (")[0].toLowerCase()}, ${t.measures.length} measures)`;
  return (
    <div className="flex flex-col gap-4" data-testid="report-email-panel">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800">
          Template
          <NativeSelect value={first} onChange={(e) => {
              setFirst(e.target.value);
              if (e.target.value === second) setSecond("");
            }} data-testid="report-template-first">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {describe(t)}
                {t.id === defaultTemplateId ? ", partner's default" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-slate-800">
          Second template (optional)
          <NativeSelect value={second} onChange={(e) => setSecond(e.target.value)} data-testid="report-template-second">
            <option value="">None</option>
            {templates
              .filter((t) => t.id !== first)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {describe(t)}
                </option>
              ))}
          </NativeSelect>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="w-full text-xs text-muted-foreground">A second template is added below the first, in the same email.</p>
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={attachPdf} onChange={(e) => setAttachPdf(e.target.checked)} data-testid="report-attach-pdf" />
          Attach a PDF of the report
        </label>
        <a href={pdfHref} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm text-primary-strong hover:underline" data-testid="report-pdf-link">
          <FileText className="h-4 w-4" aria-hidden /> Open the PDF
        </a>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">
          Preview: <span className="font-medium text-slate-800">{text.subject}</span>
          {attachPdf ? `, with ${pdfName}` : ""}
        </p>
        <div className="max-h-[70vh] overflow-y-auto rounded-md">
          <EmailHtmlPreview html={html} testId="report-email-preview" title="The report email" />
        </div>
      </div>
      {send ? (
        <ReportSendButtons
          reportId={reportId}
          permission={send.permission}
          fromEmail={send.fromEmail}
          preview={() => ({ to: send.to, subject: text.subject, body: text.body, html, attachment: attachPdf ? pdfName : null })}
          alreadySent={send.alreadySent}
          hasDraft={send.hasDraft}
          signature={send.signature}
          options={{ templateIds: chosen.map((t) => t.id), attachPdf }}
        />
      ) : null}
    </div>
  );
}

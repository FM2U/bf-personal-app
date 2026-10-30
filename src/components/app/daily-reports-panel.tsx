"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmailHtmlPreview } from "@/components/app/email-preview";
import { approveAndSendDailyReport, saveDailyReportNote, skipDailyReports, unskipDailyReport } from "@/app/actions/daily-reports";
import { dateTime } from "@/lib/format";
import type { DailyReportItem } from "@/lib/daily-reports";
import type { SendPermission } from "@/lib/google-scopes";
import { cn } from "@/lib/utils";

const requestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `r${Date.now()}${Math.random().toString(36).slice(2)}`);

const STATE_BADGE: Record<DailyReportItem["state"], { text: string; variant: "success" | "warning" | "neutral" | "default" }> = {
  draft: { text: "Waiting for approval", variant: "warning" },
  finalized: { text: "Approved, not sent yet", variant: "warning" },
  sent: { text: "Sent", variant: "success" },
  skipped: { text: "Not today", variant: "neutral" },
};

/**
 * Today's partner reports on the daily close (after it is completed): one preview per partner set to Daily or Both,
 * with Approve and send, Edit note, and Not today, and Approve and send all when more than one is waiting. Nothing
 * is sent without one of the Approve buttons.
 */
export function DailyReportsPanel({ items, permission }: { items: DailyReportItem[]; permission: SendPermission }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [attachPdf, setAttachPdf] = useState(false);
  const waiting = items.filter((i) => i.state === "draft" || i.state === "finalized");
  const say = (id: string, ok: boolean, text: string) => setMessages((m) => ({ ...m, [id]: { ok, text } }));

  const send = async (item: DailyReportItem) => {
    setBusy(item.id);
    try {
      const r = await approveAndSendDailyReport({ reportId: item.id, requestId: requestId(), attachPdf });
      say(item.id, r.ok, r.ok ? `Sent to ${item.partnerName}. It is in Gmail, Sent.` : r.message);
      return r.ok;
    } catch {
      say(item.id, false, "Not sent. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const sendOne = (item: DailyReportItem) =>
    start(async () => {
      if (await send(item)) router.refresh();
    });
  const sendAll = () =>
    start(async () => {
      let any = false;
      for (const item of waiting) any = (await send(item)) || any;
      if (any) router.refresh();
    });
  const skip = (ids: string[]) =>
    start(async () => {
      const r = await skipDailyReports(ids);
      if (!r.ok) ids.forEach((id) => say(id, false, r.error));
      router.refresh();
    });
  const unskip = (id: string) =>
    start(async () => {
      const r = await unskipDailyReport(id);
      if (!r.ok) say(id, false, r.error);
      router.refresh();
    });
  const saveNote = (id: string) =>
    start(async () => {
      const r = await saveDailyReportNote(id, note);
      if (!r.ok) return say(id, false, r.error);
      setEditing(null);
      say(id, true, "Note saved. The preview shows it.");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4" data-testid="daily-reports-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-slate-700">
          {waiting.length
            ? `${waiting.length} ${waiting.length === 1 ? "report is" : "reports are"} waiting for your approval. Nothing is sent until you press Approve and send.`
            : "Every report for today is sent or set to Not today."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={attachPdf} onChange={(e) => setAttachPdf(e.target.checked)} data-testid="daily-attach-pdf" />
            Attach a PDF
          </label>
          {waiting.length > 1 ? (
            <>
              <Button size="sm" onClick={sendAll} disabled={pending || permission === "not_connected"} data-testid="daily-send-all">
                <Send /> Approve and send all
              </Button>
              <Button size="sm" variant="outline" onClick={() => skip(waiting.map((w) => w.id))} disabled={pending} data-testid="daily-skip-all">
                Not today for all
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {permission !== "allowed" && waiting.length ? (
        <p className="rounded-md bg-status-soon-bg px-3 py-2 text-sm text-status-soon">
          {permission === "reconnect" ? "Reconnect Google once (Settings, Connections) to send from the app." : "Google is not connected. Connect Google in Settings, Connections to send from the app."}
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {items.map((item) => {
          const badge = STATE_BADGE[item.state];
          const msg = messages[item.id];
          const open = item.state === "draft" || item.state === "finalized";
          return (
            <li key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 p-3" data-testid="daily-report" data-state={item.state}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="clamp-1">{item.partnerName}</span>
                    <Badge variant={badge.variant}>{badge.text}</Badge>
                  </p>
                  <p className="clamp-2 text-xs text-muted-foreground">
                    {item.to ? `To ${item.to}` : "No email address"}. Template: {item.templateName}, today&apos;s numbers.
                    {item.state === "sent" && item.sentAt ? ` Sent ${dateTime(item.sentAt)}.` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {open ? (
                    <>
                      <Button size="sm" onClick={() => sendOne(item)} disabled={pending || !item.to || permission === "not_connected"} data-testid="daily-send">
                        {busy === item.id ? "Sending..." : (
                          <>
                            <CheckCircle2 /> Approve and send
                          </>
                        )}
                      </Button>
                      {item.state === "draft" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(editing === item.id ? null : item.id);
                            setNote(item.note);
                          }}
                          disabled={pending}
                          data-testid="daily-edit-note"
                        >
                          <Pencil /> Edit note
                        </Button>
                      ) : null}
                      {item.state === "draft" ? (
                        <Button size="sm" variant="ghost" onClick={() => skip([item.id])} disabled={pending} data-testid="daily-skip">
                          Not today
                        </Button>
                      ) : null}
                    </>
                  ) : item.state === "skipped" ? (
                    <Button size="sm" variant="outline" onClick={() => unskip(item.id)} disabled={pending} data-testid="daily-unskip">
                      Send it after all
                    </Button>
                  ) : null}
                </div>
              </div>
              {editing === item.id ? (
                <div className="flex flex-col gap-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={600} placeholder="Example: - Two broker calls moved to Monday." aria-label={`Note for ${item.partnerName}`} data-testid="daily-note" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveNote(item.id)} disabled={pending} data-testid="daily-note-save">
                      Save note
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Shown under Summary in the email. Start a line with &quot;- &quot; for a bullet.</p>
                </div>
              ) : null}
              {msg ? (
                <p role={msg.ok ? "status" : "alert"} className={cn("rounded-md px-3 py-2 text-sm", msg.ok ? "bg-status-met-bg text-status-met" : "bg-status-missed-bg text-status-missed")} data-testid="daily-message">
                  {msg.text}
                </p>
              ) : null}
              {item.state !== "skipped" ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground">
                    Preview: <span className="font-medium text-slate-800">{item.subject}</span>
                  </p>
                  <div className="max-h-[60vh] max-w-[640px] overflow-y-auto rounded-md">
                    <EmailHtmlPreview html={item.previewHtml} title={`Report for ${item.partnerName}`} testId="daily-preview" />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

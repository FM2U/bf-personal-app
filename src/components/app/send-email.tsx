"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/app/page-header";
import { useRouter } from "next/navigation";
import { saveReportToGmailDrafts, sendPartnerReportEmail, type SendResult } from "@/app/actions/email";
import type { SendPermission } from "@/lib/google-scopes";
import { STATUS_BOX, STATUS_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";
import { emailHtml, type SignatureSetup } from "@/lib/email-signature";
import { EmailHtmlPreview } from "@/components/app/email-preview";

export type EmailPreview = { to: string; subject: string; body: string };

/** "Include signature": shown only when a signature is saved. Checked by default when the setting is on. */
export function IncludeSignature({ checked, onChange, disabled, testId = "include-signature" }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-slate-800">
      <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} data-testid={testId} />
      Include signature
    </label>
  );
}

function newRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function sentTime(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return iso;
  }
}

/** The Reconnect Google button with its one-line reason. */
export function ReconnectGoogle({ message, stacked = false }: { message?: string; stacked?: boolean }) {
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm", !stacked && "sm:flex-row sm:items-center sm:justify-between", STATUS_BOX.soon, STATUS_TEXT.soon)}
      data-testid="send-reconnect"
    >
      <span>{message ?? "Reconnect Google to allow sending from the app (1 minute)."}</span>
      <Button asChild size="sm" className={cn("shrink-0 self-start", !stacked && "sm:self-auto")}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the Google sign-in must be a full page load, not an app link */}
        <a href="/api/google/connect">Reconnect Google</a>
      </Button>
    </div>
  );
}

/**
 * "Send now" and "Save to Gmail drafts". Send now opens a dialog with From, To, Subject, and the full message
 * (read only). Only "Send email" in the dialog sends, once per click; Edit returns to the editor.
 */
export function SendOrSaveButtons({
  permission,
  fromEmail,
  preview,
  send,
  saveDraft,
  editable = true,
  onEdit,
  disabled = false,
  sendLabel = "Send now",
  saveLabel = "Save to Gmail drafts",
  afterSendNote,
  readOnlyNote,
  extra,
  signature = null,
}: {
  permission: SendPermission;
  fromEmail: string | null;
  /** The exact email that will be sent (the dialog shows it as is). */
  preview: () => EmailPreview;
  send: (requestId: string, includeSignature: boolean) => Promise<SendResult>;
  /** Existing behavior: creates a Gmail draft. Omit when Gmail drafts are not available. */
  saveDraft?: (includeSignature: boolean) => Promise<{ ok: boolean; message: string }>;
  /** The saved Gmail signature (Settings, Email signature). Null: none saved, no checkbox. */
  signature?: SignatureSetup | null;
  editable?: boolean;
  onEdit?: () => void;
  disabled?: boolean;
  sendLabel?: string;
  saveLabel?: string;
  /** Shown under "Sent", for example a reminder that an older Gmail draft still exists. */
  afterSendNote?: string | null;
  /** Shown in the dialog when the text cannot be edited here. */
  readOnlyNote?: string;
  /** Another button shown in the same row (for example Copy to clipboard). */
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<EmailPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [draftStatus, setDraftStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [needReconnect, setNeedReconnect] = useState<string | null>(null);
  const [withSignature, setWithSignature] = useState(!!signature?.on);
  const lock = useRef(false);
  const editAfterClose = useRef(false);
  const requestId = useRef<string>("");

  function openConfirm() {
    setDraftStatus(null);
    if (permission !== "allowed") {
      setNeedReconnect(
        permission === "reconnect"
          ? "Sending from the app is not allowed yet. Reconnect Google once (1 minute), then press Send now again."
          : "Google is not connected. Connect Google to send from the app.",
      );
      return;
    }
    setNeedReconnect(null);
    setResult(null);
    setShown(preview());
    requestId.current = newRequestId();
    setOpen(true);
  }

  async function confirmSend() {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    try {
      const r = await send(requestId.current, !!signature && withSignature);
      setResult(r);
      if (!r.ok && r.reason === "reconnect") setNeedReconnect(r.message);
      setOpen(false);
    } catch {
      setResult({ ok: false, reason: "google", message: "The app could not finish the request. Check Gmail Sent before trying again." });
      setOpen(false);
    } finally {
      setSending(false);
      lock.current = false;
    }
  }

  async function save() {
    if (!saveDraft || saving) return;
    setSaving(true);
    try {
      setDraftStatus(await saveDraft(!!signature && withSignature));
    } finally {
      setSaving(false);
    }
  }

  const sent = result?.ok ? result : null;
  const failed = result && !result.ok && result.reason !== "reconnect" ? result : null;

  return (
    <div className="flex flex-col gap-2">
      {sent ? (
        <Notice tone="success">
          <span className="flex flex-col gap-0.5" data-testid="send-success">
            <span className="font-semibold">Sent {sentTime(sent.sentAt)}</span>
            <span>
              {sent.alreadySent ? "This email was already sent. It was not sent again. " : "It is in Gmail, Sent. "}
              {sent.note ?? ""}
            </span>
            {afterSendNote ? <span>{afterSendNote}</span> : null}
          </span>
        </Notice>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {signature ? (
            <span className="w-full">
              <IncludeSignature checked={withSignature} onChange={setWithSignature} disabled={sending || saving} />
            </span>
          ) : null}
          <Button type="button" size="sm" onClick={openConfirm} disabled={disabled || sending} data-testid="send-now">
            <Send /> {sendLabel}
          </Button>
          {saveDraft ? (
            <Button type="button" size="sm" variant="outline" onClick={save} disabled={disabled || saving} data-testid="save-draft">
              <Mail /> {saving ? "Saving..." : saveLabel}
            </Button>
          ) : null}
          {extra}
        </div>
      )}
      {needReconnect ? <ReconnectGoogle message={needReconnect} /> : null}
      {failed ? (
        <Notice tone="error">
          <span className="flex flex-col gap-0.5" data-testid="send-failed">
            <span className="font-semibold">Not sent. {failed.message}</span>
            {failed.googleText ? <span>Google said: {failed.googleText}</span> : null}
            <span>Your text is kept.{saveDraft ? " You can press Save to Gmail drafts instead." : ""}</span>
          </span>
        </Notice>
      ) : null}
      {draftStatus ? <Notice tone={draftStatus.ok ? "success" : "error"}>{draftStatus.message}</Notice> : null}

      <Dialog open={open} onOpenChange={(v) => (!sending ? setOpen(v) : undefined)}>
        <DialogContent
          className="max-w-2xl"
          aria-describedby="send-confirm-desc"
          onCloseAutoFocus={(e) => {
            // Edit: put the cursor in the message instead of on the Send now button.
            if (editAfterClose.current) {
              e.preventDefault();
              editAfterClose.current = false;
              onEdit?.();
            }
          }}
        >
          <DialogTitle>Send this email?</DialogTitle>
          <DialogDescription id="send-confirm-desc">Check the email. Nothing is sent until you press Send email.</DialogDescription>
          {shown ? (
            <div className="flex flex-col gap-3" data-testid="send-preview">
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                {fromEmail ? (
                  <>
                    <dt className="text-muted-foreground">From</dt>
                    <dd className="break-all text-slate-900">{fromEmail}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">To</dt>
                <dd className="break-all font-medium text-slate-900">{shown.to}</dd>
                <dt className="text-muted-foreground">Subject</dt>
                <dd className="font-medium text-slate-900">{shown.subject || "(No subject)"}</dd>
              </dl>
              <div className="flex flex-col gap-1.5">
                <div className="flex min-h-8 items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Message{signature && withSignature ? " with signature" : ""}</span>
                  {signature ? <IncludeSignature checked={withSignature} onChange={setWithSignature} disabled={sending} testId="confirm-include-signature" /> : null}
                </div>
                <div className="max-h-[45vh] overflow-y-auto rounded-md" data-testid="send-preview-body">
                  <EmailHtmlPreview html={emailHtml(shown.body, signature && withSignature ? signature.html : null)} testId="send-preview-frame" title="The email as it will be sent" />
                </div>
              </div>
              {!editable && readOnlyNote ? <p className="text-xs text-muted-foreground">{readOnlyNote}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button type="button" onClick={confirmSend} disabled={sending} data-testid="send-confirm">
              <Send /> {sending ? "Sending..." : "Send email"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => {
                editAfterClose.current = editable;
                setOpen(false);
              }}
              data-testid="send-edit"
            >
              {editable ? "Edit" : "Cancel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Partner report page (finalized report): Send now and Save to Gmail drafts. The text cannot be edited here. */
export function ReportSendButtons({
  reportId,
  permission,
  fromEmail,
  preview,
  alreadySent,
  hasDraft,
  signature = null,
}: {
  reportId: string;
  permission: SendPermission;
  fromEmail: string | null;
  preview: EmailPreview;
  alreadySent: boolean;
  hasDraft: boolean;
  signature?: SignatureSetup | null;
}) {
  const router = useRouter();
  return (
    <SendOrSaveButtons
      permission={permission}
      fromEmail={fromEmail}
      preview={() => preview}
      editable={false}
      readOnlyNote="A finalized report does not change. To change the wording, press Save to Gmail drafts and edit it in Gmail."
      sendLabel={alreadySent ? "Send again" : "Send now"}
      signature={signature}
      send={async (requestId, includeSignature) => {
        const r = await sendPartnerReportEmail({ reportId, requestId, includeSignature });
        if (r.ok) router.refresh();
        return r;
      }}
      saveDraft={async (includeSignature) => {
        const r = await saveReportToGmailDrafts(reportId, includeSignature);
        if (r.ok) router.refresh();
        return r;
      }}
      afterSendNote={hasDraft ? "A Gmail draft of this report was created earlier. Delete it in Gmail, Drafts so it is not sent twice." : null}
    />
  );
}

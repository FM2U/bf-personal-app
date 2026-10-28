"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import Link from "next/link";
import { Check, Copy, Mail, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { Notice } from "@/components/app/page-header";
import { createOutreachGmailDraft, draftOutreachMessage, logOutreach, type DraftResult } from "@/app/actions/targets";
import { markdownToPlain } from "@/lib/markdown";
import { prepareOutreachEmail } from "@/lib/calc/sent-email";
import { sendOutreachEmail } from "@/app/actions/email";
import { SendOrSaveButtons } from "@/components/app/send-email";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup, GmailSetup } from "@/lib/compose-email";

export type QueueItem = {
  id: string;
  name: string;
  organization: string | null;
  groupLabel: string;
  overdueText: string;
  overdueTone: "bad" | "warn" | "none";
  lastOutcome: string;
  lastContact: string;
  isDealSource?: boolean;
  /** Marked "Consulting lead" (database update 0011). */
  isConsultingLead?: boolean;
  /** "Introduced 2 deals" when the contact is "Deal came from" or "Introduced by" on deals or consulting leads. */
  introducedNote?: string | null;
};

type Purpose = "general" | "deal_sourcing" | "consulting";

const METHODS = [
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

const OUTCOMES = [
  { value: "", label: "No outcome yet" },
  { value: "replied", label: "Replied" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "referral", label: "Referral" },
  { value: "no_response", label: "No response" },
];

const FIELD_LABEL = "clamp-1 text-xs font-medium leading-4 text-slate-700";

/**
 * The small "Log outreach" form: method, optional summary, optional outcome. Creates one outreach communication.
 * Shown in a light panel with its title and a Close button (16px inside the panel edge). The fields sit in one row
 * when the panel is wide (Outreach Queue rows) and wrap to two columns when it is narrow (side cards, contact page),
 * so every label stays directly above its field and no field is squeezed (container queries, not screen width).
 */
export function LogOutreachForm({
  contactId,
  back,
  onCancel,
  purposeAvailable = false,
  consultingAvailable = false,
  defaultPurpose = "general",
}: {
  contactId: string | null;
  back: string;
  onCancel?: () => void;
  purposeAvailable?: boolean;
  /** The consulting purpose (database update 0011). */
  consultingAvailable?: boolean;
  defaultPurpose?: Purpose;
}) {
  const id = useId();
  return (
    <div className="@container rounded-lg border border-slate-200 bg-slate-50/70 p-4" data-testid="log-outreach-form">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">Log outreach</p>
        {onCancel ? <PanelClose onClick={onCancel} label="Close Log outreach" /> : null}
      </div>
      <GuardedForm
        action={logOutreach}
        className={cn(
          "grid grid-cols-1 items-end gap-x-3 gap-y-3 @sm:grid-flow-row-dense @sm:grid-cols-2",
          purposeAvailable ? "@4xl:grid-flow-row @4xl:grid-cols-[8rem_10rem_minmax(12rem,1fr)_11rem_auto]" : "@3xl:grid-flow-row @3xl:grid-cols-[8rem_minmax(12rem,1fr)_11rem_auto]",
        )}
      >
        {contactId ? <input type="hidden" name="contact_id" value={contactId} /> : null}
        <input type="hidden" name="back" value={back} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-method`} className={FIELD_LABEL}>
            Method
          </label>
          <NativeSelect id={`${id}-method`} name="method" defaultValue="email">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {purposeAvailable ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-purpose`} className={FIELD_LABEL}>
              Purpose
            </label>
            <NativeSelect id={`${id}-purpose`} name="purpose" defaultValue={defaultPurpose}>
              <option value="general">General</option>
              <option value="deal_sourcing">Deal sourcing</option>
              {consultingAvailable ? <option value="consulting">Consulting</option> : null}
            </NativeSelect>
          </div>
        ) : null}
        <div className={cn("flex min-w-0 flex-col gap-1.5 @sm:col-span-2", purposeAvailable ? "@4xl:col-span-1" : "@3xl:col-span-1")}>
          <label htmlFor={`${id}-summary`} className={FIELD_LABEL}>
            Summary (optional)
          </label>
          <Input id={`${id}-summary`} name="summary" maxLength={500} placeholder="What you sent or discussed" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-outcome`} className={FIELD_LABEL}>
            Outcome (optional)
          </label>
          <NativeSelect id={`${id}-outcome`} name="outcome" defaultValue="">
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex">
          <SubmitButton pendingText="Saving...">Save</SubmitButton>
        </div>
      </GuardedForm>
    </div>
  );
}

/** The Close button in the top right of an inline panel: a 32px square, so the icon sits well inside the edge. */
export function PanelClose({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" size="icon" variant="ghost" onClick={onClick} aria-label={label} className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-900">
      <X />
    </Button>
  );
}

/**
 * "Draft message": the AI drafts, Bram edits and approves. Then: Send now (a dialog shows the exact email; only
 * "Send email" sends, one email per click), Save to Gmail drafts, or copy the text.
 */
export function DraftMessagePanel({ contactId, onClose, back = "/people/outreach" }: { contactId: string; onClose: () => void; back?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [savedDraft, setSavedDraft] = useState(false);
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    start(async () => {
      const r = await draftOutreachMessage(contactId);
      setDraft(r);
      if (r.ok) {
        setSubject(r.subject);
        setBody(r.body);
      }
    });
  }, [contactId]);

  async function copy() {
    const text = `Subject: ${subject}\n\n${markdownToPlain(body)}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ ok: true, message: "Copied. Paste it into your email or text app, send it, then press Log outreach." });
    } catch {
      setStatus({ ok: false, message: "Copy did not work in this browser. Select the text and copy it by hand." });
    }
  }

  const showSend = !!draft?.ok && !!draft.email && draft.sendPermission !== "not_connected";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">Draft message (review before sending)</p>
        <PanelClose onClick={onClose} label="Close draft" />
      </div>
      {pending && !draft ? <p className="text-sm text-muted-foreground">Writing the draft...</p> : null}
      {draft && !draft.ok ? <Notice tone="error">{draft.error}</Notice> : null}
      {draft?.ok ? (
        <>
          {draft.note ? <Notice tone="warn">{draft.note}</Notice> : null}
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Subject
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Message
            <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
          </label>
          {showSend ? (
            <SendOrSaveButtons
              permission={draft.sendPermission}
              fromEmail={draft.fromEmail}
              disabled={!body.trim()}
              preview={() => ({ to: draft.email ?? "", ...prepareOutreachEmail(subject, body) })}
              signature={draft.signature}
              send={async (requestId, includeSignature) => {
                const r = await sendOutreachEmail({ contactId, subject, body, requestId, includeSignature });
                if (r.ok) {
                  const when = format(new Date(r.sentAt), "MMM d, yyyy 'at' h:mm a");
                  const msg = r.alreadySent
                    ? `Already sent to ${draft.email} on ${when}. It was not sent again.`
                    : `Sent to ${draft.email} on ${when}. It is in Gmail, Sent. ${r.note ?? ""}${savedDraft ? " A Gmail draft of this message was saved earlier: delete it in Gmail so it is not sent twice." : ""}`;
                  const clean = back.replace(/([?&])notice=[^&]*/g, "$1").replace(/[?&]$/, "");
                  router.replace(`${clean}${clean.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg.trim())}`, { scroll: true });
                }
                return r;
              }}
              saveDraft={
                draft.canGmail
                  ? async (includeSignature) => {
                      const r = await createOutreachGmailDraft(contactId, subject, body, includeSignature);
                      if (r.ok) setSavedDraft(true);
                      return r;
                    }
                  : undefined
              }
              onEdit={() => bodyRef.current?.focus()}
              afterSendNote={savedDraft ? "A Gmail draft of this message was saved earlier. Delete it in Gmail so it is not sent twice." : null}
              extra={
                <Button type="button" size="sm" variant="outline" onClick={copy} disabled={!body.trim()}>
                  <Copy /> Copy to clipboard
                </Button>
              }
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {draft.canGmail ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !body.trim()}
                  onClick={() =>
                    start(async () => {
                      setStatus(await createOutreachGmailDraft(contactId, subject, body));
                    })
                  }
                >
                  <Mail /> {pending ? "Saving..." : "Save to Gmail drafts"}
                </Button>
              ) : null}
              <Button type="button" size="sm" variant={draft.canGmail ? "outline" : "default"} onClick={copy} disabled={!body.trim()}>
                <Copy /> Copy to clipboard
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {showSend
              ? `Send now shows the email to ${draft.email} first; it is sent only when you press Send email, then logged as outreach. Save to Gmail drafts sends nothing.`
              : draft.canGmail
                ? `The Gmail draft goes to ${draft.email}. Nothing is sent until you press send in Gmail.`
                : draft.email
                  ? "Google is not connected, so the message is copied instead. Nothing is sent by the app."
                  : "This contact has no email address, so the message is copied instead. Nothing is sent by the app."}
          </p>
        </>
      ) : null}
      {status ? <Notice tone={status.ok ? "success" : "error"}>{status.message}</Notice> : null}
    </div>
  );
}

/** One row of the Outreach Queue, with the two actions. Columns line up with the header row on desktop. */
export function OutreachQueueRow({ item, back, purposeAvailable = false, consultingAvailable = false }: { item: QueueItem; back: string; purposeAvailable?: boolean; consultingAvailable?: boolean }) {
  const [mode, setMode] = useState<"none" | "log" | "draft">("none");
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_6.5rem_7.5rem_8.5rem_18.5rem] md:gap-3">
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link href={`/records/contacts/${item.id}`} className="clamp-1 min-w-0 text-sm font-medium text-slate-900 hover:underline">
              {item.name}
            </Link>
            {item.isDealSource ? (
              <Badge variant="default" className="shrink-0" title="Can refer off-market deals">
                Deal source
              </Badge>
            ) : null}
            {item.isConsultingLead ? (
              <Badge variant="default" className="shrink-0" title="Could hire you or refer consulting work">
                Consulting lead
              </Badge>
            ) : null}
          </span>
          {item.introducedNote ? <p className="clamp-1 text-xs font-medium text-primary-strong">{item.introducedNote}</p> : null}
          <p className="text-xs text-muted-foreground md:hidden"><span className="clamp-1">{item.organization ?? "No organization"}</span></p>
        </div>
        <span className="hidden text-sm text-slate-700 md:block"><span className="clamp-1">{item.organization ?? "None"}</span></span>
        <div className="grid grid-cols-3 gap-2 md:contents">
          <Cell label="Group" value={item.groupLabel} />
          <Cell label="Days overdue" value={item.overdueText} tone={item.overdueTone} />
          <Cell label="Last outcome" value={item.lastOutcome} />
        </div>
        <div className="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
          <Button type="button" size="sm" variant={mode === "log" ? "default" : "outline"} onClick={() => setMode(mode === "log" ? "none" : "log")}>
            <Check /> Log outreach
          </Button>
          <Button type="button" size="sm" variant={mode === "draft" ? "default" : "outline"} onClick={() => setMode(mode === "draft" ? "none" : "draft")}>
            <PenLine /> Draft message
          </Button>
        </div>
      </div>
      {mode === "log" ? (
        <LogOutreachForm
          contactId={item.id}
          back={back}
          onCancel={() => setMode("none")}
          purposeAvailable={purposeAvailable}
          consultingAvailable={consultingAvailable}
          defaultPurpose={item.isConsultingLead && consultingAvailable ? "consulting" : item.isDealSource ? "deal_sourcing" : "general"}
        />
      ) : null}
      {mode === "draft" ? <DraftMessagePanel contactId={item.id} back={back} onClose={() => setMode("none")} /> : null}
    </div>
  );
}

function Cell({ label, value, tone = "none" }: { label: string; value: string; tone?: "bad" | "warn" | "none" }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11px] text-muted-foreground md:hidden">{label}</span>
      <span className={cn("clamp-2 tabular text-sm leading-5", tone === "bad" && "font-medium text-status-missed", tone === "warn" && "font-medium text-status-soon")}>{value}</span>
    </div>
  );
}

/** "Log outreach" button that opens the small form (used on contact pages and for outreach without a contact). */
export function LogOutreachButton({
  contactId,
  back,
  label = "Log outreach",
  purposeAvailable = false,
  consultingAvailable = false,
  defaultPurpose = "general",
}: {
  contactId: string | null;
  back: string;
  label?: string;
  purposeAvailable?: boolean;
  consultingAvailable?: boolean;
  defaultPurpose?: Purpose;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <LogOutreachForm contactId={contactId} back={back} onCancel={() => setOpen(false)} purposeAvailable={purposeAvailable} consultingAvailable={consultingAvailable} defaultPurpose={defaultPurpose} />
  ) : (
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="self-start">
      <Check /> {label}
    </Button>
  );
}

/**
 * Outreach Queue, "Outreach to someone not in the queue": an optional email address, then "Email them" (the same
 * compose box as the Email button, logged as outreach without a contact) or "Log outreach" (the small form).
 */
export function NotInQueueOutreach({
  back,
  gmail,
  purposeAvailable = false,
  consultingAvailable = false,
}: {
  back: string;
  gmail: GmailSetup;
  purposeAvailable?: boolean;
  consultingAvailable?: boolean;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"none" | "log" | "email">("none");
  const setup: ComposeSetup = {
    ...gmail,
    title: "Email someone not in the queue",
    recipients: [],
    defaultTo: email.trim(),
    contactId: null,
    pipelineItemId: null,
    organizationId: null,
    toNote: "Type the address the email goes to.",
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-md flex-col gap-1.5">
        <label htmlFor={`${id}-email`} className={FIELD_LABEL}>
          Email address (optional)
        </label>
        <Input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" data-testid="not-in-queue-email" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setMode("email")} data-testid="email-them">
          <Mail /> Email them
        </Button>
        <Button type="button" size="sm" variant={mode === "log" ? "default" : "outline"} onClick={() => setMode(mode === "log" ? "none" : "log")}>
          <Check /> Log outreach
        </Button>
      </div>
      {mode === "log" ? (
        <LogOutreachForm contactId={null} back={back} onCancel={() => setMode("none")} purposeAvailable={purposeAvailable} consultingAvailable={consultingAvailable} />
      ) : null}
      {mode === "email" ? <ComposeEmailDialog setup={setup} open onOpenChange={(v) => setMode(v ? "email" : "none")} /> : null}
    </div>
  );
}

"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/app/page-header";
import { SendOrSaveButtons } from "@/components/app/send-email";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { saveComposedGmailDraft, sendComposedEmail, writeEmailWithAI } from "@/app/actions/email";
import { emailAddressProblem } from "@/lib/email-address";
import { matchRecipient } from "@/lib/calc/compose-email";
import { prepareOutreachEmail } from "@/lib/calc/sent-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { STATUS_BOX, STATUS_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

const TYPED = "__typed";
const LABEL = "clamp-1 text-sm font-medium leading-5 text-slate-800";

/**
 * The compose box behind every "Email" button: To (prefilled, editable, checked), Subject, Message, and
 * "Write with AI" (one line in, a draft out). Send now uses the shared confirmation dialog (SendOrSaveButtons);
 * a sent email is logged as outreach by the server. While text is typed and not sent or saved, leaving asks first.
 */
export function ComposeEmailDialog({ setup, open, onOpenChange }: { setup: ComposeSetup; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const ids = useId();
  const [to, setTo] = useState(setup.defaultTo);
  const [toTouched, setToTouched] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [sent, setSent] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const aiRef = useRef<HTMLInputElement>(null);
  // "Send to" is shown when there is a choice to make: several people, or one person on an organization or item page.
  const showChooser = setup.recipients.length > 1 || (setup.recipients.length === 1 && !setup.contactId);

  const chosen = matchRecipient(to, setup.recipients);
  const contactId = chosen?.contactId ?? setup.contactId;
  const toProblem = emailAddressProblem(to);
  const snapshot = `${to}\n${subject}\n${body}`;
  const dirty = !sent && (subject.trim() !== "" || body.trim() !== "") && savedAs !== snapshot;

  useUnsavedWork(open && dirty, "This email is not sent or saved to Gmail drafts yet. Leaving discards it.");

  function reset() {
    setTo(setup.defaultTo);
    setToTouched(false);
    setSubject("");
    setBody("");
    setInstruction("");
    setAiError(null);
    setSent(false);
    setSavedAs(null);
    setAskDiscard(false);
  }

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true);
    if (dirty) return setAskDiscard(true);
    onOpenChange(false);
    reset();
  }

  function writeWithAI() {
    setAiError(null);
    startWriting(async () => {
      const r = await writeEmailWithAI({ to, contactId, pipelineItemId: setup.pipelineItemId, organizationId: setup.organizationId, instruction, subject: "", body: "" });
      if (!r.ok) return setAiError(r.error);
      setSubject(r.subject);
      setBody(r.body);
    });
  }

  const context = { contactId, pipelineItemId: setup.pipelineItemId, organizationId: setup.organizationId };
  const toError = (toTouched || !!to) && toProblem ? toProblem : null;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-2xl"
        aria-describedby={`${ids}-desc`}
        data-testid="compose-dialog"
        onOpenAutoFocus={(e) => {
          // Start in "Write with AI" when the address is filled; otherwise in To.
          if (setup.defaultTo) {
            e.preventDefault();
            aiRef.current?.focus();
          }
        }}
      >
        <DialogTitle>{setup.title}</DialogTitle>
        <DialogDescription id={`${ids}-desc`}>Nothing is sent until you press Send now and then Send email. A sent email is logged as outreach.</DialogDescription>

        {askDiscard ? (
          <div className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", STATUS_BOX.soon, STATUS_TEXT.soon)} data-testid="compose-discard">
            <span>Close and discard this email? It is not sent or saved.</span>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setAskDiscard(false)}>
                Keep writing
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Discard email
              </Button>
            </div>
          </div>
        ) : null}

        <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3", showChooser && "sm:grid-cols-2")}>
          {showChooser ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${ids}-who`} className={LABEL}>
                Send to
              </label>
              <NativeSelect
                id={`${ids}-who`}
                value={chosen ? chosen.contactId : TYPED}
                onChange={(e) => {
                  const r = setup.recipients.find((x) => x.contactId === e.target.value);
                  setTo(r ? r.email : "");
                  setToTouched(false);
                }}
                aria-label="Send to"
                data-testid="compose-recipient"
              >
                {chosen ? null : <option value={TYPED}>{to ? "Typed address" : "Choose a person"}</option>}
                {setup.recipients.map((r) => (
                  <option key={r.contactId} value={r.contactId}>
                    {r.name} ({r.role})
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${ids}-to`} className={LABEL}>
              To
            </label>
            <Input
              id={`${ids}-to`}
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => setToTouched(true)}
              placeholder="name@example.com"
              aria-invalid={!!toError}
              autoComplete="off"
              data-testid="compose-to"
            />
          </div>
        </div>
        {toError ? (
          <p className="-mt-2 text-xs font-medium text-status-missed" data-testid="compose-to-error">
            {toError}
          </p>
        ) : !to && setup.toNote ? (
          <p className="-mt-2 text-xs text-muted-foreground">{setup.toNote}</p>
        ) : null}

        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
          <label htmlFor={`${ids}-ai`} className={LABEL}>
            Write with AI (optional)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`${ids}-ai`}
                ref={aiRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && instruction.trim() && !writing) {
                    e.preventDefault();
                    writeWithAI();
                  }
                }}
                maxLength={500}
                placeholder="Example: ask about off-market deals"
                className="min-w-0 flex-1"
                data-testid="compose-ai-line"
              />
              <Button type="button" variant="outline" onClick={writeWithAI} disabled={writing || !instruction.trim() || sent} className="shrink-0" data-testid="compose-ai-write">
                <Sparkles /> {writing ? "Writing..." : "Write with AI"}
              </Button>
          </div>
          <p className="text-xs text-muted-foreground">The AI fills Subject and Message below, replacing what is there. Read and edit it before sending.</p>
          {aiError ? <Notice tone="error">{aiError}</Notice> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-subject`} className={LABEL}>
            Subject
          </label>
          <Input id={`${ids}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} data-testid="compose-subject" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-body`} className={LABEL}>
            Message
          </label>
          <Textarea id={`${ids}-body`} ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={10} data-testid="compose-body" />
        </div>

        <SendOrSaveButtons
          permission={setup.permission}
          fromEmail={setup.fromEmail}
          disabled={!body.trim() || !!toProblem}
          preview={() => ({ to: to.trim(), ...prepareOutreachEmail(subject, body) })}
          signature={setup.signature}
          send={async (requestId, includeSignature) => {
            const r = await sendComposedEmail({ to: to.trim(), subject, body, requestId, includeSignature, ...context });
            if (r.ok) {
              setSent(true);
              router.refresh();
            }
            return r;
          }}
          saveDraft={
            setup.canGmail
              ? async (includeSignature) => {
                  const r = await saveComposedGmailDraft({ to: to.trim(), subject, body, includeSignature });
                  if (r.ok) setSavedAs(snapshot);
                  return r;
                }
              : undefined
          }
          onEdit={() => bodyRef.current?.focus()}
          afterSendNote={savedAs ? "A Gmail draft of this email was saved earlier. Delete it in Gmail so it is not sent twice." : null}
        />
        {toProblem && body.trim() && !sent ? <p className="-mt-2 text-xs text-muted-foreground">Send now and Save to Gmail drafts become available once To holds one valid email address.</p> : null}
        {sent ? (
          <Button type="button" variant="outline" className="self-start" onClick={() => requestClose(false)} data-testid="compose-close">
            Close
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The "Email" button on contact, organization, and pipeline item pages. Opens the compose box. */
export function EmailButton({ setup, label = "Email", variant = "outline" }: { setup: ComposeSetup; label?: string; variant?: "outline" | "default" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)} data-testid="email-button">
        <Mail /> {label}
      </Button>
      {open ? <ComposeEmailDialog setup={setup} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

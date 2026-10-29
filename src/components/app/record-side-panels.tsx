"use client";

/**
 * The right-panel cards of a record: Linked records, Documents, Notes, Change history. The record page loads their
 * data on the server (src/components/app/record-panels.tsx); the task window loads the same data with
 * loadTaskWindow (src/app/actions/window.ts). Both show these cards.
 *
 * Add steps (Link, Upload, Add note) need a second press after choosing or typing. The button is a gray outline
 * while nothing is chosen or typed and turns solid cobalt once something is, and leaving before pressing it names the
 * step ("You chose a file but did not press Upload.") with a button that finishes it (src/components/app/unsaved-changes.tsx).
 *
 * Documents go straight from the browser to Supabase Storage (a signed upload address from startDocumentUpload), then
 * saveDocumentRecord saves the record. Files over 25 MB, and any failure, show a message under the form.
 *
 * In a window (`win`), every action is sent with __quiet (no revalidation) and the window reloads its own data.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, History, Link2, StickyNote, Trash2 } from "lucide-react";
import { CollapsibleCard } from "@/components/app/collapsible";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { formHasChanges, GuardedForm } from "@/components/app/unsaved-changes";
import { addLink, addNote, deleteDocument, deleteNote, removeLink, saveDocumentRecord, startDocumentUpload } from "@/app/actions/records";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_KINDS, documentSizeError, MAX_DOCUMENT_LABEL } from "@/lib/documents";
import type { DocumentItem, HistoryItem, LinkedData, NoteItem } from "@/lib/record-panels-data";
import { cn } from "@/lib/utils";

export type PanelWindowMode = { onChanged: () => void };
type Result = { ok: boolean; error?: string } | null | undefined;

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Runs a panel action and turns any thrown error into a message under the form (never a crash page). */
function safely(fn: (fd: FormData) => Promise<Result>) {
  return async (fd: FormData): Promise<Result> => {
    try {
      return await fn(fd);
    } catch (err) {
      if (isRedirect(err)) throw err;
      return { ok: false, error: "Not saved. The connection or the server did not answer. Try again." };
    }
  };
}

/** True while the form holds something chosen or typed (its add button turns cobalt). */
function useFilled() {
  const ref = useRef<HTMLFormElement>(null);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const check = () => setFilled(formHasChanges(f));
    // The reset event comes before the fields are cleared.
    const later = () => setTimeout(check, 0);
    f.addEventListener("input", check);
    f.addEventListener("change", check);
    f.addEventListener("reset", later);
    return () => {
      f.removeEventListener("input", check);
      f.removeEventListener("change", check);
      f.removeEventListener("reset", later);
    };
  }, []);
  return { ref, filled };
}

/** The add button of a step: gray outline until something is chosen or typed, then solid cobalt. */
function StepButton({ filled, children, pendingText, testId, className }: { filled: boolean; children: React.ReactNode; pendingText: string; testId: string; className?: string }) {
  return (
    <SubmitButton size="sm" variant={filled ? "default" : "outline"} pendingText={pendingText} className={cn("shrink-0", !filled && "text-slate-600", className)} data-testid={testId} data-filled={filled ? "" : undefined}>
      {children}
    </SubmitButton>
  );
}

function FormMessage({ error, ok }: { error: string | null; ok?: string | null }) {
  if (error)
    return (
      <p role="alert" className="rounded-md bg-status-missed-bg px-3 py-2 text-sm text-status-missed" data-testid="panel-error">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="text-sm font-medium text-status-met" data-testid="panel-ok">
        {ok}
      </p>
    );
  return null;
}

/** Hidden fields every panel form sends inside a window. */
function Quiet({ win }: { win?: PanelWindowMode }) {
  return win ? <input type="hidden" name="__quiet" value="1" /> : null;
}

/** A small delete button (remove link, delete document, delete note). */
function DeleteForm({ action, id, label, win, onError, children }: { action: (fd: FormData) => Promise<Result>; id: string; label: string; win?: PanelWindowMode; onError: (e: string | null) => void; children: React.ReactNode }) {
  return (
    <GuardedForm
      action={safely(action)}
      onResult={(r) => {
        const res = r as Result;
        onError(res && res.ok === false ? res.error ?? "Not saved." : null);
        if (res?.ok) win?.onChanged();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Quiet win={win} />
      <Button variant="ghost" size="icon" aria-label={label}>
        {children}
      </Button>
    </GuardedForm>
  );
}

// ---------- Linked records ----------

export function LinkedRecordsCard({ table, id, data, win, storageKey }: { table: string; id: string; data: LinkedData; win?: PanelWindowMode; storageKey?: string }) {
  const { ref, filled } = useFilled();
  const [error, setError] = useState<string | null>(null);
  const links = data.links;
  return (
    <CollapsibleCard id="linked" storageKey={storageKey ?? `record:${table}`} title="Linked records" icon={<Link2 className="h-4 w-4" />} meta={links.length || undefined} defaultOpen={links.length > 0} summary="None yet. Open to link a person, deal, goal, or document." testId="panel-linked">
      <div className="flex flex-col gap-3">
        {links.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link href={l.href} className="min-w-0 text-sm hover:underline">
                  <span className="block text-xs text-muted-foreground">
                    {l.typeLabel}
                    {l.relation ? ` (${l.relation})` : ""}
                  </span>
                  <span className="clamp-1 font-medium text-primary-strong">{l.title}</span>
                </Link>
                <DeleteForm action={removeLink} id={l.id} label="Remove link" win={win} onError={setError}>
                  <Trash2 />
                </DeleteForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No linked records. Link this record to the people, deals, goals, or documents it relates to.</p>
        )}
        <GuardedForm
          ref={ref}
          action={safely(addLink)}
          onResult={(r) => {
            const res = r as Result;
            setError(res && res.ok === false ? res.error ?? "Not saved." : null);
            if (res?.ok) win?.onChanged();
          }}
          className="flex flex-col gap-2"
          data-step="You chose a record but did not press Link."
          data-step-finish="Link"
          data-testid="link-form"
        >
          <input type="hidden" name="from_type" value={table} />
          <input type="hidden" name="from_id" value={id} />
          <Quiet win={win} />
          <NativeSelect name="target" required defaultValue="" aria-label="Record to link">
            <option value="" disabled>
              Choose a record to link
            </option>
            {data.candidates.map((c) => (
              <optgroup key={c.t} label={c.label}>
                {c.rows.map((r) => (
                  <option key={r.id} value={`${c.t}:${r.id}`}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          <div className="flex gap-2">
            <Input name="relation" placeholder="Relation (optional), example: lender" aria-label="Relation" data-unsaved-ignore="" />
            <StepButton filled={filled} pendingText="Linking..." testId="link-submit">
              Link
            </StepButton>
          </div>
          <FormMessage error={error} />
        </GuardedForm>
      </div>
    </CollapsibleCard>
  );
}

// ---------- Documents ----------

export function DocumentsCard({ table, id, docs, win, storageKey }: { table: string; id: string; docs: DocumentItem[]; win?: PanelWindowMode; storageKey?: string }) {
  const { ref, filled } = useFilled();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [stage, setStage] = useState("Uploading...");

  const upload = async (fd: FormData): Promise<Result> => {
    setOk(null);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.name) return { ok: false, error: "Choose a file first." };
    const tooBig = documentSizeError(file.size);
    if (tooBig) return { ok: false, error: tooBig };
    setStage("Preparing...");
    const start = await startDocumentUpload({ recordType: table, recordId: id, fileName: file.name, size: file.size });
    if (!start.ok) return start;
    setStage("Uploading...");
    const { error: upErr } = await createClient().storage.from("documents").uploadToSignedUrl(start.path, start.token, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) return { ok: false, error: `The file was not uploaded: ${upErr.message}. Try again.` };
    setStage("Saving...");
    const saved = await saveDocumentRecord({ recordType: table, recordId: id, path: start.path, fileName: file.name, size: file.size, mimeType: file.type, kind: String(fd.get("kind") ?? "other"), quiet: !!win });
    if (saved.ok) setOk(`Uploaded ${file.name}.`);
    return saved;
  };

  return (
    <CollapsibleCard id="documents" storageKey={storageKey ?? `record:${table}`} title="Documents" icon={<FileText className="h-4 w-4" />} meta={docs.length || undefined} defaultOpen={docs.length > 0} summary="None yet. Open to upload an agreement, statement, or proof." testId="panel-documents">
      <div className="flex flex-col gap-3">
        {docs.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <a href={`/api/documents/${d.id}`} className="min-w-0 text-sm hover:underline" target="_blank" rel="noreferrer">
                  <span className="clamp-1 font-medium text-primary-strong">{d.fileName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.kind} . {d.when}
                  </span>
                </a>
                <DeleteForm action={deleteDocument} id={d.id} label="Delete document" win={win} onError={setError}>
                  <Trash2 />
                </DeleteForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents. Upload signed agreements, statements, or proof here.</p>
        )}
        <GuardedForm
          ref={ref}
          action={safely(upload)}
          onResult={(r) => {
            const res = r as Result;
            setError(res && res.ok === false ? res.error ?? "Not uploaded." : null);
            if (res?.ok) win?.onChanged();
          }}
          className="flex flex-col gap-2"
          data-step="You chose a file but did not press Upload."
          data-step-finish="Upload"
          data-testid="upload-form"
        >
          <Input
            type="file"
            name="file"
            required
            aria-label="File"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setOk(null);
              setError(f ? documentSizeError(f.size) : null);
            }}
          />
          <div className="flex gap-2">
            <NativeSelect name="kind" defaultValue="other" aria-label="Document kind" data-unsaved-ignore="">
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
            <StepButton filled={filled} pendingText={stage} testId="upload-submit">
              Upload
            </StepButton>
          </div>
          <p className="text-xs text-muted-foreground">Up to {MAX_DOCUMENT_LABEL} per file.</p>
          <FormMessage error={error} ok={ok} />
        </GuardedForm>
      </div>
    </CollapsibleCard>
  );
}

// ---------- Notes ----------

export function NotesCard({ table, id, notes, win, storageKey }: { table: string; id: string; notes: NoteItem[]; win?: PanelWindowMode; storageKey?: string }) {
  const { ref, filled } = useFilled();
  const [error, setError] = useState<string | null>(null);
  return (
    <CollapsibleCard id="notes" storageKey={storageKey ?? `record:${table}`} title="Notes" icon={<StickyNote className="h-4 w-4" />} meta={notes.length || undefined} defaultOpen summary={notes.length ? `Latest: ${notes[0].body.slice(0, 80)}` : "No notes yet."} testId="panel-notes">
      <div className="flex flex-col gap-3">
        <GuardedForm
          ref={ref}
          action={safely(addNote)}
          onResult={(r) => {
            const res = r as Result;
            setError(res && res.ok === false ? res.error ?? "Not saved." : null);
            if (res?.ok) win?.onChanged();
          }}
          className="flex flex-col gap-2"
          data-step="You typed a note but did not press Add note."
          data-step-finish="Add note"
          data-testid="note-form"
        >
          <input type="hidden" name="record_type" value={table} />
          <input type="hidden" name="record_id" value={id} />
          <Quiet win={win} />
          <Textarea name="body" rows={2} placeholder="Add a note" aria-label="Note" required />
          <StepButton filled={filled} pendingText="Saving..." testId="note-submit" className="self-start">
            Add note
          </StepButton>
          <FormMessage error={error} />
        </GuardedForm>
        {notes.map((n) => (
          <div key={n.id} className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              {n.when}
              <GuardedForm
                action={safely(deleteNote)}
                onResult={(r) => {
                  const res = r as Result;
                  setError(res && res.ok === false ? res.error ?? "Not saved." : null);
                  if (res?.ok) win?.onChanged();
                }}
              >
                <input type="hidden" name="id" value={n.id} />
                <Quiet win={win} />
                <button className="hover:text-status-missed" aria-label="Delete note">
                  Delete
                </button>
              </GuardedForm>
            </div>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

// ---------- Change history ----------

export function HistoryCard({ table, history, storageKey }: { table: string; history: HistoryItem[]; storageKey?: string }) {
  return (
    <CollapsibleCard id="history" storageKey={storageKey ?? `record:${table}`} title="Change history" icon={<History className="h-4 w-4" />} meta={history.length || undefined} defaultOpen={false} summary={history.length ? `Last change ${history[0].when}` : "No changes recorded."} testId="panel-history">
      <div>
        {history.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {history.map((c) => (
              <li key={c.id} className="border-b border-slate-100 pb-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{c.when}</span>
                  <Badge variant={c.actor === "ai" ? "default" : "neutral"}>{c.actor === "ai" ? "AI (approved)" : c.actor === "system" ? "Scheduled job" : "Owner"}</Badge>
                </div>
                <p className="mt-0.5">
                  {c.field ? <span className="font-medium">{c.field}: </span> : null}
                  {c.text}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No changes recorded.</p>
        )}
      </div>
    </CollapsibleCard>
  );
}

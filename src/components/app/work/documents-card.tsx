"use client";
// The Documents card on a deal or listing page: upload (browser straight to Supabase Storage), list, delete.
// Moved out of the old record side panels on 2026-11-02 when the old record pages were removed.
import { useEffect, useRef, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { CollapsibleCard } from "@/components/app/collapsible";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { formHasChanges, GuardedForm } from "@/components/app/unsaved-changes";
import { deleteDocument, saveDocumentRecord, startDocumentUpload } from "@/app/actions/documents";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_KINDS, documentSizeError, MAX_DOCUMENT_LABEL } from "@/lib/documents";
import type { DocumentItem } from "@/lib/work/documents-data";
import { cn } from "@/lib/utils";


type PanelWindowMode = { onChanged: () => void };
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

export function DocumentsCard({ table, id, docs, win, storageKey, defaultOpen: openOverride }: { table: string; id: string; docs: DocumentItem[]; win?: PanelWindowMode; storageKey?: string; /** Overrides the default open state (for example closed under a sent report). */ defaultOpen?: boolean }) {
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
    <CollapsibleCard id="documents" storageKey={storageKey ?? `record:${table}`} title="Documents" icon={<FileText className="h-4 w-4" />} meta={docs.length || undefined} defaultOpen={openOverride ?? docs.length > 0} summary="None yet. Open to upload an agreement, statement, or proof." testId="panel-documents">
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

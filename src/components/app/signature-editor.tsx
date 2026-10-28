"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/app/page-header";
import { ReconnectGoogle } from "@/components/app/send-email";
import { EmailHtmlPreview } from "@/components/app/email-preview";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { copySignatureFromGmail, saveEmailSignature } from "@/app/actions/signature";
import { emailHtml, sanitizeSignatureHtml, signatureHtmlToText } from "@/lib/email-signature";

const LABEL = "clamp-1 text-sm font-medium leading-5 text-slate-800";
const SAMPLE_BODY = "Your message appears here.";

/**
 * Settings, Email signature: Copy from Gmail (or Refresh from Gmail), the HTML in a plain box with a live preview,
 * the plain text version (made from the HTML), and "Add signature to emails sent or drafted from the app".
 * Nothing is stored until Save signature.
 */
export function SignatureEditor({
  initialHtml,
  initialEnabled,
  available,
  googleState,
  savedAtText,
}: {
  initialHtml: string;
  initialEnabled: boolean;
  /** False before database update 0015. */
  available: boolean;
  /** Copy from Gmail: allowed, reconnect needed, or Google not connected. */
  googleState: "allowed" | "reconnect" | "not_connected";
  savedAtText: string | null;
}) {
  const router = useRouter();
  const ids = useId();
  const [html, setHtml] = useState(initialHtml);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saved, setSaved] = useState({ html: initialHtml, enabled: initialEnabled });
  const [status, setStatus] = useState<{ tone: "success" | "error" | "warn"; text: string; googleText?: string | null } | null>(null);
  const [needReconnect, setNeedReconnect] = useState<string | null>(null);
  const [copying, startCopy] = useTransition();
  const [saving, startSave] = useTransition();

  const clean = useMemo(() => sanitizeSignatureHtml(html), [html]);
  const text = useMemo(() => (clean ? signatureHtmlToText(clean) : ""), [clean]);
  const dirty = html !== saved.html || enabled !== saved.enabled;
  const hasSaved = !!saved.html.trim();
  useUnsavedWork(dirty, "The signature changes are not saved yet. Leaving discards them.");

  function copy() {
    setStatus(null);
    startCopy(async () => {
      const r = await copySignatureFromGmail();
      if (r.ok) {
        setHtml(r.html);
        setNeedReconnect(null);
        setStatus({ tone: "success", text: r.message });
      } else if (r.reason === "reconnect") {
        setNeedReconnect(r.message);
      } else {
        setStatus({ tone: "error", text: r.message, googleText: r.googleText });
      }
    });
  }

  function save() {
    setStatus(null);
    startSave(async () => {
      const r = await saveEmailSignature({ html, enabled });
      if (!r.ok) return setStatus({ tone: "error", text: r.message });
      const stored = r.html ?? "";
      setHtml(stored);
      setSaved({ html: stored, enabled });
      setStatus({ tone: "success", text: r.message });
      router.refresh();
    });
  }

  const copyLabel = hasSaved ? "Refresh from Gmail" : "Copy from Gmail";

  return (
    <div className="flex flex-col gap-4">
      {needReconnect || googleState === "reconnect" ? <ReconnectGoogle message={needReconnect ?? "Reconnect Google to use your Gmail signature (1 minute)."} /> : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card data-testid="signature-card">
          <CardHeader>
            <CardTitle>Email signature</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={copy} disabled={!available || copying || googleState !== "allowed"} data-testid="signature-copy">
                <Download /> {copying ? "Reading Gmail..." : copyLabel}
              </Button>
              <span className="text-xs text-muted-foreground">
                {googleState === "not_connected" ? "Connect Google in Settings, Connections to copy it." : savedAtText ? `Saved ${savedAtText}.` : "No signature saved yet."}
              </span>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!available} data-testid="signature-enabled" />
              <span>
                Add signature to emails sent or drafted from the app
                <span className="block text-xs text-muted-foreground">Each email still has an Include signature box you can uncheck.</span>
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-html`} className={LABEL}>
                Signature HTML
              </label>
              <Textarea
                id={`${ids}-html`}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                rows={10}
                spellCheck={false}
                disabled={!available}
                className="font-mono text-xs leading-5"
                placeholder="Press Copy from Gmail, or type the signature here."
                data-testid="signature-html"
              />
              <p className="text-xs text-muted-foreground">Links, images with an https address, and basic formatting are kept. Scripts and anything unsafe are removed when you save.</p>
            </div>
            {status ? (
              <Notice tone={status.tone}>
                <span data-testid="signature-status">{status.text}</span>
                {status.googleText ? <span className="block">Google said: {status.googleText}</span> : null}
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={save} disabled={!available || saving || !dirty} data-testid="signature-save">
                <Save /> {saving ? "Saving..." : "Save signature"}
              </Button>
              {dirty ? <span className="text-xs text-muted-foreground">Not saved yet.</span> : null}
            </div>
          </CardContent>
        </Card>
        <Card data-testid="signature-preview-card">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {clean ? (
              <EmailHtmlPreview html={emailHtml(SAMPLE_BODY, clean)} testId="signature-preview" title="Signature preview" />
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="signature-preview-empty">
                No signature yet. Press {copyLabel}, or type it in Signature HTML.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Plain text version</span>
              <pre className="min-h-12 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-sm leading-6 text-slate-900" data-testid="signature-text">
                {text || "None"}
              </pre>
            </div>
          </CardContent>
          <CardNote>How the signature appears below your message. Email apps that show only text get the plain text version.</CardNote>
        </Card>
      </div>
    </div>
  );
}

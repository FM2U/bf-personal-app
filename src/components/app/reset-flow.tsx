"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { resetAllData } from "@/app/actions/data-tools";
import { EXPORT_COOKIE, exportIsRecent } from "@/lib/reset";
import { cn } from "@/lib/utils";

function exportCookie(): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${EXPORT_COOKIE}=`));
  return hit ? hit.slice(EXPORT_COOKIE.length + 1) : null;
}

/**
 * Reset all data in two steps: step 1 downloads the full export in this browser session (the download sets a
 * session cookie that the server checks again); step 2 is enabled after that, and the button only after RESET is typed.
 */
export function ResetFlow({ exportedAt, disabled }: { exportedAt: string | null; disabled: boolean }) {
  const [downloadedAt, setDownloadedAt] = useState<string | null>(exportedAt);
  const [waiting, setWaiting] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const v = exportCookie();
      if (v && exportIsRecent(v)) {
        setDownloadedAt(decodeURIComponent(v));
        setWaiting(false);
      } else if (Date.now() - started > 120_000) setWaiting(false);
    }, 500);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const step1 = !!downloadedAt;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("rounded-lg border p-4", step1 ? "border-status-met/40 bg-status-met-bg/40" : "border-border")} data-testid="reset-step-1">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Step 1 of 2</p>
        <p className="mt-1 text-sm font-medium">Download the full export (a backup of every record).</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button asChild variant={step1 ? "outline" : "default"} size="sm">
            {/* A file download, not a page: a plain link is correct here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/export/full" onClick={() => setWaiting(true)} data-testid="reset-download-export" aria-disabled={disabled}>
              <Download /> Download full export
            </a>
          </Button>
          {step1 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-status-met" data-testid="reset-export-done">
              <CheckCircle2 className="h-4 w-4" /> Downloaded at {new Date(downloadedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : waiting ? (
            <span className="text-sm text-muted-foreground">Preparing the export...</span>
          ) : (
            <span className="text-sm text-muted-foreground">Needed in this session before step 2.</span>
          )}
        </div>
      </div>
      <div className={cn("rounded-lg border border-border p-4", !step1 && "opacity-60")} data-testid="reset-step-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Step 2 of 2</p>
        <GuardedForm action={resetAllData} className="mt-1 flex flex-col gap-3" data-unsaved="off">
          <label htmlFor="reset-confirm" className="text-sm font-medium">
            Type RESET to delete every record you created or imported. This cannot be undone.
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_auto] sm:justify-start">
            <Input id="reset-confirm" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!step1 || disabled} autoComplete="off" placeholder="RESET" aria-describedby="reset-help" />
            <SubmitButton variant="destructive" disabled={!step1 || disabled || typed !== "RESET"} pendingText="Deleting..." data-testid="reset-submit">
              Reset all data
            </SubmitButton>
          </div>
          <p id="reset-help" className="text-xs text-muted-foreground">
            {step1 ? "The button works only when exactly RESET (capital letters) is typed." : "Step 2 is available after the export is downloaded in this session."}
          </p>
        </GuardedForm>
      </div>
    </div>
  );
}

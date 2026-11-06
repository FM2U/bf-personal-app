"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A download button for the full export zip (2026-11-05): "Download the export" on the monthly review and "Download
 * full export" under Settings. The zip takes a while to build, so the instant it is pressed it reads "Preparing…"
 * with a small spinner and is grayed until the file starts downloading or an error shows. The press only sets that
 * state; the request starts after the next paint, so the pending look shows at once. The file is fetched, then saved
 * with the name the server gives it.
 */
export function ExportDownload({ href, children, icon, className, onStarted, testId }: { href: string; children: React.ReactNode; icon?: React.ReactNode; className?: string; onStarted?: () => void; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    try {
      const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "You are signed out. Sign in again, then press it again." : `The server answered ${res.status}. Try again.`);
      const blob = await res.blob();
      const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "bf-personal-app-export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setBusy(false);
      onStarted?.();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error && e.message && !/fetch/i.test(e.message) ? e.message : "The export did not download. Check the connection and try again.");
    }
  };
  const press = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Two frames: the grayed "Preparing…" paints before the request and the file handling start.
    requestAnimationFrame(() => setTimeout(run, 0));
  };
  return (
    <>
      <button type="button" onClick={press} disabled={busy} aria-busy={busy} className={cn(className, busy && "cursor-progress")} data-testid={testId} data-busy={busy ? "1" : "0"}>
        {busy ? (
          <>
            <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin" aria-hidden />
            <span role="status">Preparing…</span>
          </>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </button>
      {error ? (
        <span className="basis-full text-[12.5px] text-status-missed" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </span>
      ) : null}
    </>
  );
}

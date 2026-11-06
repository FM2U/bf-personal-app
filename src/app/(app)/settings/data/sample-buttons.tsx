"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/app/page-header";
import { loadSampleData, removeSampleData } from "@/app/actions/data-tools";

/**
 * Settings, Sample data: Load sample data and Remove sample data (2026-11-05). The instant either is pressed it reads
 * "Loading…" or "Removing…" with a small spinner and is grayed, and the other one is grayed too, until the page comes
 * back with the result notice. The click only sets that state and starts the action in a transition, so the pending
 * look paints before any work. Remove asks first on the page itself (no browser dialog, which held the page frozen
 * while it was open), and its Remove button takes the pending look.
 */
type Kind = "load" | "remove";
const Busy = createContext<{ busy: Kind | null; run: (kind: Kind, work: () => Promise<unknown>) => void; error: { kind: Kind; text: string } | null }>({ busy: null, run: () => {}, error: null });

const isRedirect = (err: unknown) => {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
};

export function SampleBusy({ children }: { children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<Kind | null>(null);
  const [error, setError] = useState<{ kind: Kind; text: string } | null>(null);
  const run = (k: Kind, work: () => Promise<unknown>) => {
    setKind(k);
    setError(null);
    start(async () => {
      try {
        await work();
      } catch (err) {
        // The action answers with a redirect to this page and its notice; Next.js follows it.
        if (isRedirect(err)) throw err;
        setError({ kind: k, text: "The server did not finish this. Check the connection and try again; if it keeps happening, reload the page." });
      }
    });
  };
  return <Busy.Provider value={{ busy: pending ? kind : null, run, error }}>{children}</Busy.Provider>;
}

function Pending({ label }: { label: string }) {
  return (
    <>
      <Loader2 className="animate-spin" aria-hidden />
      <span role="status">{label}</span>
    </>
  );
}

function ErrorLine({ kind }: { kind: Kind }) {
  const { busy, error } = useContext(Busy);
  return error?.kind === kind && !busy ? <Notice tone="error">{error.text}</Notice> : null;
}

/** Load sample data, with the "next to my real records" box when real records exist. */
export function LoadSampleForm({ realTotal }: { realTotal: number }) {
  const { busy, run } = useContext(Busy);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run("load", () => loadSampleData(fd));
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-unsaved="off">
      {realTotal ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm_real" className="mt-0.5 h-4 w-4 accent-primary" data-testid="sample-confirm-real" required disabled={!!busy} />
          Load sample data next to my real records
        </label>
      ) : null}
      <Button type="submit" disabled={!!busy} className="self-start" data-testid="sample-load" data-busy={busy === "load" ? "1" : "0"}>
        {busy === "load" ? <Pending label="Loading…" /> : "Load sample data"}
      </Button>
      <ErrorLine kind="load" />
    </form>
  );
}

/** Remove sample data: a press asks on the page, then Remove runs it. */
export function RemoveSampleForm({ sampleTotal }: { sampleTotal: number }) {
  const { busy, run } = useContext(Busy);
  const [asking, setAsking] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run("remove", () => removeSampleData());
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-unsaved="off">
      {asking ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-status-soon-border bg-status-soon-bg px-3.5 py-3" data-testid="sample-remove-ask">
          <p className="text-sm text-slate-800">Remove all sample data? Your real records are not changed.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={!!busy} autoFocus data-testid="sample-remove-confirm" data-busy={busy === "remove" ? "1" : "0"}>
              {busy === "remove" ? <Pending label="Removing…" /> : "Remove"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => setAsking(false)} data-testid="sample-remove-cancel">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" disabled={!sampleTotal || !!busy} onClick={() => setAsking(true)} className="self-start" data-testid="sample-remove">
          Remove sample data
        </Button>
      )}
      <ErrorLine kind="remove" />
    </form>
  );
}

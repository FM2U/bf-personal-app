"use client";

/**
 * Close the day, step 1: each outcome with Complete, Partial, or Incomplete (a segmented control: green, amber, red
 * when chosen), a one-line result, and "Add actual time" (optional, folded). Every change saves by itself.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { finishOutcomesStep, saveOutcomeClose } from "@/app/actions/today";
import { CLOSE_CHOICES, type Outcome, type OutcomeStatus } from "@/lib/calc/today";
import { cn } from "@/lib/utils";

const CHOSEN: Record<string, string> = {
  complete: "border-status-met-border bg-status-met-bg text-status-met",
  partial: "border-status-soon-border bg-status-soon-bg text-status-soon",
  incomplete: "border-status-missed-border bg-status-missed-bg text-status-missed",
};

type RowState = Outcome & { actualText: string; showActual: boolean };

export function OutcomesStep({ outcomes, initiatives }: { outcomes: Outcome[]; initiatives: Record<string, string> }) {
  const [rows, setRows] = useState<RowState[]>(() => outcomes.map((o) => ({ ...o, actualText: o.actualMinutes === null ? "" : String(o.actualMinutes), showActual: o.actualMinutes !== null })));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
  }, [rows]);

  const persist = (id: string) => {
    const row = latest.current.find((r) => r.id === id);
    if (!row) return;
    clearTimeout(timers.current[id]);
    start(async () => {
      const r = await saveOutcomeClose({ id, status: row.status, resultNote: row.resultNote, actualMinutes: row.actualText });
      setNote(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    });
  };
  const update = (id: string, patch: Partial<RowState>, now = false) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    clearTimeout(timers.current[id]);
    if (now) setTimeout(() => persist(id), 0);
    else timers.current[id] = setTimeout(() => persist(id), 1000);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="close-outcomes">
      {rows.length ? (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-white p-4" data-testid="close-outcome" data-status={r.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 text-sm font-medium text-slate-900">
                  <span className="tabular mr-2 text-slate-400">{r.position}</span>
                  {r.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[r.initiativeId ? initiatives[r.initiativeId] : null, r.blockMinutes !== null ? `${r.blockMinutes} min planned` : null].filter(Boolean).join(", ")}
                </p>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="inline-flex rounded-md border border-input bg-white p-0.5" role="group" aria-label={`Status of outcome ${r.position}`}>
                  {CLOSE_CHOICES.map((c) => {
                    const on = r.status === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => update(r.id!, { status: c.value as OutcomeStatus }, true)}
                        aria-pressed={on}
                        className={cn("h-8 rounded px-3 text-xs font-medium transition-colors", on ? cn("border", CHOSEN[c.value]) : "text-slate-600 hover:bg-slate-100")}
                        data-testid={`close-status-${c.value}`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <Input value={r.resultNote} onChange={(e) => update(r.id!, { resultNote: e.target.value })} onBlur={() => persist(r.id!)} placeholder="Result in one line (optional)" maxLength={300} aria-label={`Result of outcome ${r.position}`} data-testid="close-result" />
              </div>
              {r.showActual ? (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  Actual minutes
                  <Input value={r.actualText} onChange={(e) => update(r.id!, { actualText: e.target.value })} onBlur={() => persist(r.id!)} inputMode="numeric" className="h-8 w-24 text-right" aria-label={`Actual minutes for outcome ${r.position}`} data-testid="close-actual" />
                </label>
              ) : (
                <button type="button" onClick={() => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, showActual: true } : x)))} className="flex items-center gap-1 self-start text-xs text-primary-strong hover:underline" data-testid="close-add-actual">
                  <ChevronRight aria-hidden className="h-3.5 w-3.5" /> Add actual time
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="close-no-outcomes">
          No outcomes were planned today.
        </p>
      )}
      {note ? (
        <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-status-missed")} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      ) : null}
      <form action={finishOutcomesStep} className="flex justify-end">
        <SubmitButton pendingText="Saving..." data-testid="close-next">
          Next
        </SubmitButton>
      </form>
    </div>
  );
}

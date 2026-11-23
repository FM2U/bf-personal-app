"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { addReviewed, editReviewed, listReviewed, removeReviewed } from "@/app/actions/listings-reviewed";
import { reviewedWords, type ReviewedEntry } from "@/lib/accountability/listings-reviewed";
import { clock12 } from "@/lib/accountability/activity";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { Drawer } from "@/components/app/work/drawer";
import { RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * "+ Listings reviewed" (push J, Bram 2026-11-23): a link that opens a side panel to enter how many listings were
 * reviewed and where they came from. The panel lists the day's entries (each with Edit and Remove) and their total.
 * Entries add up; 0 is a valid entry ("none today"). Used on End of day (Today's activity) and Home (Targets card).
 * The entries are read when the panel opens, so the pages it sits on read nothing more.
 */

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const LABEL = "text-[13px] font-medium text-slate-700";

export function ListingsReviewedButton({ day, className, children, testId = "reviewed-open" }: { day?: string | null; className?: string; children?: React.ReactNode; testId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && changed) {
      setChanged(false);
      router.refresh();
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "text-[12.5px] font-medium text-primary-strong hover:underline"} data-testid={testId}>
        {children ?? "+ Listings reviewed"}
      </button>
      <Drawer open={open} onOpenChange={close} title="Listings reviewed" sub="How many listings you looked at today, and where they came from" testId="reviewed-drawer">
        {open ? <ReviewedPanel day={day ?? null} onChanged={() => setChanged(true)} /> : null}
      </Drawer>
    </>
  );
}

function ReviewedPanel({ day, onChanged }: { day: string | null; onChanged: () => void }) {
  const ids = useId();
  const [entries, setEntries] = useState<ReviewedEntry[] | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [count, setCount] = useState("");
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useUnsavedWork(count.trim() !== "", "The listings reviewed are not added yet.");
  useEffect(() => {
    let live = true;
    listReviewed(day).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setError(r.error);
        setEntries([]);
        return;
      }
      setEntries(r.entries);
      setSources(r.sources);
    });
    return () => {
      live = false;
    };
  }, [day]);
  const total = (entries ?? []).reduce((s, e) => s + e.reviewed, 0);
  const reset = () => {
    setCount("");
    setSource("");
    setEditing(null);
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = editing ? await editReviewed(editing, { reviewed: count, source }) : await addReviewed({ day, reviewed: count, source });
      if (!r.ok) return setError(r.error);
      setEntries((list) => (editing ? (list ?? []).map((e) => (e.id === editing ? r.entry : e)) : [...(list ?? []), r.entry]));
      if (r.entry.source && !sources.some((s) => s.toLowerCase() === r.entry.source!.toLowerCase())) setSources((s) => [r.entry.source!, ...s].slice(0, 8));
      reset();
      onChanged();
    });
  const remove = (id: string) =>
    start(async () => {
      setError(null);
      const r = await removeReviewed(id);
      if (!r.ok) return setError(r.error);
      setEntries((list) => (list ?? []).filter((e) => e.id !== id));
      if (editing === id) reset();
      onChanged();
    });
  const startEdit = (e: ReviewedEntry) => {
    setEditing(e.id);
    setCount(String(e.reviewed));
    setSource(e.source ?? "");
    setError(null);
  };
  return (
    <div data-testid="reviewed-panel">
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 sm:grid-cols-[96px_minmax(0,1fr)]">
        <label htmlFor={`${ids}-n`} className={LABEL}>
          How many
        </label>
        <input
          id={`${ids}-n`}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          inputMode="numeric"
          placeholder="15"
          className={cn(INPUT, "w-[120px]")}
          autoFocus
          data-testid="reviewed-count"
        />
        <label htmlFor={`${ids}-s`} className={cn(LABEL, "self-start pt-2")}>
          Source
        </label>
        <div className="min-w-0">
          <input id={`${ids}-s`} value={source} onChange={(e) => setSource(e.target.value)} maxLength={80} placeholder="BizBuySell" className={INPUT} data-testid="reviewed-source" />
          {sources.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="reviewed-sources">
              {sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  aria-pressed={source === s}
                  className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", source === s ? "border-slate-800 bg-slate-800 text-white" : "border-border bg-white text-slate-700 hover:bg-slate-50")}
                  data-testid="reviewed-source-choice"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[13px] text-status-missed" role="alert" data-testid="reviewed-error">
            {error}
          </span>
        ) : null}
        {editing ? (
          <RowButton onClick={reset} className="h-9 px-3.5 text-[13px]" disabled={pending}>
            Cancel
          </RowButton>
        ) : null}
        <RowButton tone="primary" onClick={save} className="h-9 px-3.5 text-[13px]" disabled={pending || !count.trim()} data-testid="reviewed-save">
          {pending ? "Saving..." : editing ? "Save" : "Add"}
        </RowButton>
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground">Several entries a day add up. None today? Add 0, so the End of day reminder knows you did not forget.</p>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-slate-900">Today</h3>
          <span className="text-[13px] text-slate-700" data-testid="reviewed-total">
            {entries === null ? "Reading..." : entries.length ? `${total} in all` : "Nothing entered yet"}
          </span>
        </div>
        {(entries ?? []).map((e) => (
          <div key={e.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-slate-100 py-2 first:border-t-0", editing === e.id && "bg-slate-50")} data-testid="reviewed-row" data-id={e.id}>
            <span className="min-w-0 text-[13px] leading-[1.45] text-slate-900">
              {reviewedWords(e.reviewed)}
              <span className="block text-[12px] text-muted-foreground">{[e.source, timeOfDay(e.createdAt) ? clock12(timeOfDay(e.createdAt)) : null].filter(Boolean).join(" · ") || "No source"}</span>
            </span>
            <span className="flex gap-3 text-[12.5px] font-medium">
              <button type="button" onClick={() => startEdit(e)} className="text-primary-strong hover:underline" aria-label={`Edit ${reviewedWords(e.reviewed)}`} data-testid="reviewed-edit">
                Edit
              </button>
              <button type="button" onClick={() => remove(e.id)} disabled={pending} className="text-muted-foreground hover:text-slate-900 hover:underline" aria-label={`Remove ${reviewedWords(e.reviewed)}`} data-testid="reviewed-remove">
                Remove
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "14:05" from a saved time, in the browser's time zone (the owner's own computer). */
function timeOfDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

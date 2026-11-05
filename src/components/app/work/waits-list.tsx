"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { addWait, removeWait } from "@/app/actions/waiting";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_NOTICE_PUSH_E2 } from "@/lib/schema-guard";
import type { WaitLine } from "@/lib/work/waiting";
import { repliedLabel, replyWaitName } from "@/lib/work/reply-wait";
import { Pill, RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

const INPUT = "h-9 w-full min-w-0 rounded-[7px] border border-input bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60";
/** One wait line: the text (wraps in its own column), Since in a fixed column, and the × in a fixed column. */
const LINE = "grid grid-cols-[minmax(0,1fr)_88px_28px] items-center gap-x-2.5";

/**
 * The waits of a deal, a job or consulting item, or a person (push E2, approved 2026-11-05), as the Waiting on field of
 * the deal page's Next action card, the item page's Next action card, and the person page's Next follow-up card. A
 * short list, longest wait first: each line shows what is waited on, Since, and an × that removes it at once. "+ Add"
 * opens a line with the text and Since (today unless changed) and adds it at once; the Save button of the card is
 * for the other fields. Nothing waited on reads "Nobody". The label sits in the card's label column, at the top.
 * Edits of Nov 5 (item 6): a wait whose email has a reply shows, under its text, the green "Dana replied Nov 4" pill and
 * Clear (which removes the wait), as on the Waiting card; Clear takes the place of the × on that line.
 */
export function WaitsField({ kind, recordId, waits, today, ready, labelClassName }: { kind: "deal" | "item" | "person"; recordId: string; waits: readonly WaitLine[]; today: string; /** False before UPDATE_PREVIEW_PUSH_E2.sql: the list says so and cannot save. */ ready: boolean; labelClassName: string }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [since, setSince] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const textRef = useRef<HTMLInputElement>(null);
  useUnsavedWork(adding && !!text.trim(), "The wait is not added yet.");
  useEffect(() => {
    if (adding) textRef.current?.focus();
  }, [adding]);
  const shown = waits.filter((w) => !gone[w.id]);
  const close = () => {
    setAdding(false);
    setText("");
    setSince(today);
  };
  const add = () =>
    start(async () => {
      setError(null);
      const r = await addWait(kind, recordId, { text, since });
      if (!r.ok) return setError(r.error);
      close();
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      setError(null);
      setRemoving(id);
      const r = await removeWait(id);
      setRemoving(null);
      if (!r.ok) return setError(r.error);
      setGone((m) => ({ ...m, [id]: true }));
      router.refresh();
    });
  return (
    <>
      <span className={cn(labelClassName, "self-start pt-2")} data-testid="waits-label">
        Waiting on
      </span>
      <div className="flex min-w-0 flex-col gap-1.5" data-testid="waits-list" data-count={shown.length}>
        {shown.length ? (
          shown.map((w) => (
            <div key={w.id} className={cn(LINE, "min-h-9 gap-y-1.5 rounded-[7px] border border-slate-200 bg-slate-50/60 py-1 pl-2.5", w.repliedOn && "pb-1.5")} data-testid="wait-line" data-wait={w.id} data-replied={w.repliedOn ? "1" : "0"}>
              <span className="min-w-0 text-sm leading-5 text-slate-900" data-testid="wait-text">
                {w.text}
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground" data-testid="wait-since">
                {w.since ? `Since ${fmtDate(w.since, "MMM d")}` : ""}
              </span>
              {w.repliedOn ? (
                <span aria-hidden />
              ) : (
                <button type="button" onClick={() => remove(w.id)} disabled={pending} aria-label={`Remove: ${w.text}`} title="Remove" className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-slate-400 transition-colors hover:bg-white hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50" data-testid="wait-remove">
                  {removing === w.id ? <span className="text-[11px]">...</span> : <X className="h-4 w-4" aria-hidden />}
                </button>
              )}
              {w.repliedOn ? (
                <span className="col-span-3 flex items-center justify-end gap-2 pr-2.5">
                  <Pill tone="green" testId="wait-replied">
                    {repliedLabel(replyWaitName(w.text) ?? w.repliedBy, fmtDate(w.repliedOn, "MMM d"))}
                  </Pill>
                  <RowButton tone="cobalt" onClick={() => remove(w.id)} disabled={pending} data-testid="wait-clear">
                    {removing === w.id ? "Clearing..." : "Clear"}
                  </RowButton>
                </span>
              ) : null}
            </div>
          ))
        ) : !adding ? (
          <span className="flex h-9 items-center text-sm text-slate-400" data-testid="waits-empty">
            Nobody
          </span>
        ) : null}
        {adding ? (
          <div className="flex flex-col gap-1.5" data-testid="wait-add-form">
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                ref={textRef}
                id={`${ids}-t`}
                aria-label="What you are waiting on"
                value={text}
                maxLength={120}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && text.trim()) add();
                  if (e.key === "Escape") close();
                }}
                placeholder="What, and from whom"
                className={INPUT}
                data-testid="wait-add-text"
              />
              <div className="flex items-center gap-2">
                <label htmlFor={`${ids}-s`} className="text-xs font-medium text-muted-foreground">
                  Since
                </label>
                <input id={`${ids}-s`} type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} className={cn(INPUT, "w-auto")} data-testid="wait-add-since" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <RowButton onClick={close} disabled={pending} data-testid="wait-add-cancel">
                Cancel
              </RowButton>
              <RowButton tone="primary" onClick={add} disabled={pending || !text.trim()} data-testid="wait-add-save">
                {pending ? "Adding..." : "Add"}
              </RowButton>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => (ready ? setAdding(true) : setError(DB_UPDATE_NOTICE_PUSH_E2))} className="self-start rounded-[6px] px-0.5 text-[13px] font-medium text-primary-strong hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="wait-add">
            + Add
          </button>
        )}
        {error ? (
          <span className="text-[13px] text-status-missed" role="alert" data-testid="waits-error">
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}

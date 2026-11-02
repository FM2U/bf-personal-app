"use client";

import { useEffect, useRef, useState } from "react";
import { SHOW_LANES, showLabel, toggleShow, type ShowLane } from "@/lib/work/lanes";
import { cn } from "@/lib/utils";

/**
 * The Show pill on Home (Edit batch C, item 2): "Show: All" after the filter pills. It opens a small checklist of
 * the lanes under the heading "Show only" (several allowed, each with its count), and Reset at the bottom puts every
 * lane back. With lanes ticked the pill reads "Show: 2" in the soft blue of an active filter. The board remembers the
 * choice in this browser; this component only shows it and reports changes.
 */
export function ShowFilter({ choice, counts, onChange, prefix = "home" }: { choice: ShowLane[] | null; /** Rows per lane (Next actions and Waiting on someone together). */ counts: Record<ShowLane, number>; onChange: (c: ShowLane[] | null) => void; prefix?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  // Closes on a click outside the pill and its list, and on Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const on = !!choice;
  return (
    <span ref={box} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", on ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")}
        data-testid={`${prefix}-show`}
        data-label={showLabel(choice)}
      >
        {showLabel(choice)}
        <svg viewBox="0 0 10 10" className={cn("h-2 w-2.5 transition-transform", open && "rotate-180")} aria-hidden>
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-[220px] rounded-[10px] border border-border bg-white py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.12)]" role="group" aria-label="Show only" data-testid={`${prefix}-show-menu`}>
          <div className="label-caps px-3.5 pt-1 pb-1.5">Show only</div>
          {SHOW_LANES.map((lane) => {
            const ticked = !!choice && choice.includes(lane);
            return (
              <label key={lane} className="flex cursor-pointer items-center gap-2.5 px-3.5 py-[7px] text-[13px] text-slate-800 hover:bg-slate-50" data-testid={`${prefix}-show-option`} data-lane={lane}>
                <input type="checkbox" checked={ticked} onChange={() => onChange(toggleShow(choice, lane))} className="h-3.5 w-3.5 shrink-0 accent-[var(--primary)]" />
                <span className="min-w-0 flex-1">{lane}</span>
                <span className="tabular text-xs text-slate-400">{counts[lane]}</span>
              </label>
            );
          })}
          <div className="mt-1 border-t border-slate-100 px-3.5 pt-2 pb-1">
            <button type="button" onClick={() => onChange(null)} disabled={!on} className="text-[12.5px] font-medium text-primary-strong hover:underline disabled:text-slate-400 disabled:no-underline" data-testid={`${prefix}-show-reset`}>
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

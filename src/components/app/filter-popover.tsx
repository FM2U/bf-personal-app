"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { FilterGroup, Ticks } from "@/lib/filters";
import { cn } from "@/lib/utils";

/**
 * The small Filter dropdown (approved 2026-11-04) for lists with one or two filter groups: Work on now (Area), Contacts
 * Follow-ups (Role, Project) and To-dos (Area). The button says what is on ("Area: All", "Area: Deals, Rosara +2");
 * it opens a small box right under it with the checkboxes and their counts. A tick applies at once; Clear unticks
 * everything; Escape or a click anywhere else closes it (Escape puts the cursor back on the button). The slim bar's
 * filter icon opens the same box under the icon. Lists with three or more groups keep the large Filter window
 * (src/components/app/filter-window.tsx).
 */

export function FilterMenuButton({ label, ticked, open, onOpen, testId = "filter-open" }: { label: string; ticked: number; open: boolean; onOpen: (anchor: HTMLElement) => void; testId?: string }) {
  return (
    <button type="button" onClick={(e) => onOpen(e.currentTarget)} aria-haspopup="dialog" aria-expanded={open} className={cn("inline-flex h-8 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[7px] border px-3 text-[13px] font-medium whitespace-nowrap", ticked ? "border-primary-border bg-primary-soft text-primary-strong" : "border-input bg-white text-slate-800 hover:bg-slate-50")} data-testid={testId} data-ticked={ticked} data-label={label}>
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

const GAP = 6;
const EDGE = 12;

export function FilterPopover<T>({ anchor, onClose, groups, ticks, counts, onToggle, onClear, note, testId = "filter-popover" }: { /** The button the box hangs under; null: closed. */ anchor: HTMLElement | null; onClose: () => void; groups: readonly FilterGroup<T>[]; ticks: Ticks; counts: Record<string, Record<string, number>>; onToggle: (group: string, value: string) => void; onClear: () => void; /** A quiet line at the bottom ("Waiting on someone is not filtered."). */ note?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = !!anchor;

  // Hangs under the button, its right edge on the button's right edge, kept inside the window.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? 280;
      const left = Math.max(EDGE, Math.min(a.right - w, window.innerWidth - w - EDGE));
      setPos({ top: a.bottom + GAP, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [anchor]);

  // The cursor moves into the box; Escape closes it and returns to the button; a click outside closes it.
  useEffect(() => {
    if (!anchor) return;
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true }));
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
      anchor.focus({ preventScroll: true });
    };
    // Tabbing out of the box closes it too.
    const out = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !ref.current?.contains(to) && !anchor.contains(to)) onClose();
    };
    const box = ref.current;
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    box?.addEventListener("focusout", out);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      box?.removeEventListener("focusout", out);
    };
  }, [anchor, onClose]);

  if (!open) return null;
  const any = groups.some((g) => (ticks[g.key] ?? []).length);
  const two = groups.length > 1;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Filter"
      className={cn("fixed z-[60] flex max-h-[min(72vh,520px)] max-w-[calc(100vw-24px)] flex-col rounded-[10px] border border-border bg-white shadow-[0_12px_32px_rgba(15,23,42,0.16)]", two ? "w-[480px]" : "w-[264px]")}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      data-testid={testId}
    >
      <div className={cn("min-h-0 overflow-y-auto overscroll-contain px-3.5 pt-3 pb-2", two && "grid grid-cols-1 gap-x-6 gap-y-3 min-[561px]:grid-cols-2")}>
        {groups.map((g) => {
          const on = ticks[g.key] ?? [];
          return (
            <div key={g.key} className="min-w-0" data-testid="filter-group" data-group={g.key}>
              <h3 className="mb-1 border-b border-rule pb-1.5 text-[11px] font-semibold tracking-[0.09em] text-heading uppercase">{g.title}</h3>
              {g.options.map((o) => {
                const ticked = on.includes(o.value);
                const n = counts[g.key]?.[o.value] ?? 0;
                const id = `fp-${g.key}-${o.value}`;
                return (
                  <label key={o.value} htmlFor={id} className={cn("-mx-1 grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[5px] px-1 py-[5px] text-[13.5px] hover:bg-slate-100", ticked ? "font-medium text-primary-strong" : n ? "text-slate-900" : "text-slate-400")} data-testid="filter-option" data-group={g.key} data-value={o.value} data-count={n} data-on={ticked ? "1" : "0"}>
                    <input id={id} type="checkbox" checked={ticked} onChange={() => onToggle(g.key, o.value)} className="mt-[3px] h-4 w-4 accent-[var(--primary)]" />
                    <span className="min-w-0">{o.label}</span>
                    <span className={cn("tabular min-w-[18px] pt-0.5 text-right text-[12.5px]", ticked ? "text-primary-strong" : n ? "text-muted-foreground" : "text-slate-400")}>{n}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-3.5 py-2.5">
        {note ? <span className="min-w-0 text-[12px] text-muted-foreground">{note}</span> : <span />}
        <button type="button" onClick={onClear} disabled={!any} className="shrink-0 text-[13px] font-medium text-primary-strong hover:underline disabled:text-slate-400 disabled:no-underline" data-testid="filter-clear">
          Clear
        </button>
      </div>
    </div>,
    document.body,
  );
}

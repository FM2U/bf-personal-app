"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Area selector (approved 2026-11-04) above the tiles on Work on now and To-dos: one area at a time, or All. A
 * slim segmented control in the look of the Contacts view choice, one size smaller so it reads as secondary: "All 21 ·
 * Deals 5 · Contacts 5 ...", each with its number in gray; an area with nothing in it is grayed and cannot be picked.
 * A radio group: the arrow keys move between the areas that can be picked (and pick them). On a phone it scrolls
 * sideways inside its own row. AreaChip is the same choice in the slim pinned bar: "Deals" with a small arrow,
 * opening the areas in a small menu under it.
 */
export type AreaOption<K extends string> = { value: K | null; label: string; count: number };

const pickable = <K extends string>(o: AreaOption<K>, selected: K | null) => o.value === selected || o.value === null || o.count > 0;

export function AreaSelector<K extends string>({ options, selected, onPick, testId = "area-selector" }: { /** All first (value null), then the areas. */ options: readonly AreaOption<K>[]; selected: K | null; onPick: (k: K | null) => void; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idOf = (v: K | null) => `${testId}-${v ?? "all"}`;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const ok = options.filter((o) => pickable(o, selected));
    const at = ok.findIndex((o) => o.value === selected);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % ok.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at - 1 + ok.length) % ok.length : e.key === "Home" ? 0 : e.key === "End" ? ok.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(ok[to].value);
    const el = document.getElementById(idOf(ok[to].value));
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" data-testid={`${testId}-row`}>
      <div ref={ref} role="radiogroup" aria-label="Area" onKeyDown={onKeyDown} className="inline-flex rounded-full border border-border bg-white p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId}>
        {options.map((o) => {
          const on = o.value === selected;
          const can = pickable(o, selected);
          return (
            <button
              key={o.value ?? "all"}
              id={idOf(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={!can || undefined}
              disabled={!can}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                if (!on) onPick(o.value);
              }}
              className={cn(
                "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                on ? "cursor-default bg-primary-soft text-primary-strong shadow-[inset_0_0_0_1.5px_var(--primary)]" : can ? "text-heading hover:bg-slate-100" : "cursor-default text-slate-300",
              )}
              data-testid="area-option"
              data-value={o.value ?? "all"}
              data-count={o.count}
              data-selected={on ? "1" : "0"}
            >
              {o.label}
              <span className={cn("tabular font-medium", on ? "text-primary-strong" : can ? "text-slate-400" : "text-slate-300")}>{o.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GAP = 6;
const EDGE = 12;

export function AreaChip<K extends string>({ options, selected, onPick, testId = "slim-area" }: { options: readonly AreaOption<K>[]; selected: K | null; onPick: (k: K | null) => void; testId?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const current = options.find((o) => o.value === selected) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const a = btn.current!.getBoundingClientRect();
      const w = menu.current?.offsetWidth ?? 220;
      setPos({ top: a.bottom + GAP, left: Math.max(EDGE, Math.min(a.left, window.innerWidth - w - EDGE)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true }));
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]:not([disabled])") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Area: ${current.label}`} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-medium whitespace-nowrap", selected ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-heading hover:bg-slate-100")} data-testid={testId} data-value={selected ?? "all"}>
        {current.label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div ref={menu} role="menu" aria-label="Area" onKeyDown={onMenuKey} className="fixed z-[60] w-[220px] rounded-[10px] border border-border bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)]" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} data-testid={`${testId}-menu`}>
              {options.map((o) => {
                const on = o.value === selected;
                const can = pickable(o, selected);
                return (
                  <button
                    key={o.value ?? "all"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    disabled={!can}
                    onClick={() => {
                      onPick(o.value);
                      setOpen(false);
                      btn.current?.focus({ preventScroll: true });
                    }}
                    className={cn("grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-[7px] text-left text-[13px] focus-visible:bg-slate-100 focus-visible:outline-none", on ? "font-medium text-primary-strong" : can ? "text-slate-800 hover:bg-slate-100" : "cursor-default text-slate-300")}
                    data-testid="area-menu-option"
                    data-value={o.value ?? "all"}
                  >
                    {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span />}
                    <span>{o.label}</span>
                    <span className={cn("tabular text-[12.5px]", on ? "text-primary-strong" : can ? "text-slate-400" : "text-slate-300")}>{o.count}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

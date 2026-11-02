"use client";

import { useEffect, useRef, useState } from "react";
import { PASS_REASONS, type PassReason } from "@/lib/work/buy-box";
import { RowButton } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Pass menu: one button that opens the seven reasons; one click passes. Used on listing rows and on the deal page.
 * `onPick` runs the save; the menu closes itself on a click outside or Escape.
 */
export function PassMenu({ onPick, label = "Pass", pending, tone = "outline", testId = "pass-button", align = "right", up = false, className }: { onPick: (reason: PassReason) => void; label?: string; pending?: boolean; tone?: "outline" | "primary"; testId?: string; align?: "right" | "left"; /** The menu opens above the button (the foot of the listing popup). */ up?: boolean; /** The button's size (the page header uses the taller 36px buttons). */ className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-block">
      <RowButton tone={tone} onClick={() => setOpen((o) => !o)} disabled={pending} aria-haspopup="menu" aria-expanded={open} className={className} data-testid={testId}>
        {label}
      </RowButton>
      {open ? (
        <div role="menu" className={cn("absolute z-20 min-w-[230px]", up ? "bottom-full mb-1" : "top-full mt-1", "rounded-[10px] border border-border bg-white p-1.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.12)]", align === "right" ? "right-0" : "left-0")} data-testid="pass-menu">
          <div className="label-caps px-2.5 pt-1.5 pb-1">Pass because</div>
          {PASS_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="menuitem"
              className="block w-full rounded-md px-2.5 py-[7px] text-left text-[13px] text-slate-800 hover:bg-slate-100"
              onClick={() => {
                setOpen(false);
                onPick(r.value);
              }}
              data-testid={`pass-reason-${r.value}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A large centered window (Push B edits, 2026-11-03): a scrim over the page, a white window about 940px wide with the
 * title and a quiet line under it, a close mark at the top right, a body that scrolls on its own, and a footer that
 * stays at the bottom. Escape or the close mark closes it, and the page stays where it was. On the phone it takes the
 * full screen with 16px gutters. Used by the Filter window, Show all on record-page cards, the report window on End of
 * day, and the sent report on Reports.
 *
 * `size`: "wide" (940px, the default), "report" (820px with 64px side padding, the email inside), or "work" (860px,
 * Work through on Home, push C).
 *
 * `overlay` (2026-11-06): a small box laid over the whole window (the window's own content behind a light veil), used
 * by the report window to ask about text typed but not saved.
 */
export function CenteredWindow({ open, onOpenChange, title, sub, children, footer, testId, size = "wide", bodyRef, bodyClassName, overlay }: { open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; testId?: string; size?: "wide" | "report" | "work"; bodyRef?: React.Ref<HTMLDivElement>; bodyClassName?: string; overlay?: React.ReactNode }) {
  const pad = size === "report" ? "px-4 min-[701px]:px-16" : "px-4 min-[701px]:px-8";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/[0.38]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col bg-white focus:outline-none",
            "inset-0 h-[100dvh] w-full",
            "min-[701px]:inset-auto min-[701px]:top-1/2 min-[701px]:left-1/2 min-[701px]:h-auto min-[701px]:max-h-[88vh] min-[701px]:w-[calc(100%-48px)] min-[701px]:-translate-x-1/2 min-[701px]:-translate-y-1/2 min-[701px]:rounded-[14px] min-[701px]:shadow-[0_20px_60px_rgba(15,23,42,0.25)]",
            size === "report" ? "min-[701px]:max-w-[820px]" : size === "work" ? "min-[701px]:max-w-[860px]" : "min-[701px]:max-w-[940px]",
          )}
          data-testid={testId}
          data-window={size}
        >
          <div className={cn("flex shrink-0 items-start justify-between gap-3 border-b border-rule pt-[18px] pb-3 min-[701px]:pt-[22px] min-[701px]:pb-4", pad)}>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[17px] font-semibold text-heading">{title}</DialogPrimitive.Title>
              {sub ? <DialogPrimitive.Description className="mt-[3px] text-[13px] text-muted-foreground">{sub}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="-mt-1 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-status-missed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Close" data-testid="window-close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div ref={bodyRef} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", size === "report" ? "pt-4 pb-[22px]" : "pt-[22px] pb-7", pad, bodyClassName)} data-testid="window-body">
            {children}
          </div>
          {footer ? <div className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule bg-white pt-3.5 pb-4 min-[701px]:rounded-b-[14px]", pad)} data-testid="window-footer">{footer}</div> : null}
          {overlay ? <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 p-4 min-[701px]:rounded-[14px]">{overlay}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

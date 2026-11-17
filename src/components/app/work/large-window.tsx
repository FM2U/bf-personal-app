"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * A large window over Home (Bram, 2026-11-17, decision 6 of claude/2026-11-17-home-redesign-build-plan.md): wide, with
 * its top edge about 20% down the screen (not centered), a soft scrim over the page, the title with an optional line
 * under it and Close at the right; the content scrolls inside the window. Close, Escape or a click on the scrim goes
 * back to Home. On the phone it takes the full width, from near the top.
 */
export function LargeWindow({ open, onOpenChange, title, sub, actions, children, testId }: { open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; sub?: React.ReactNode; /** Buttons at the top right, before Close. */ actions?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(28,25,23,0.28)]" />
        <DialogPrimitive.Content className="fixed top-[20vh] left-1/2 z-50 flex max-h-[76vh] w-[min(1040px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_12px_40px_rgba(28,25,23,0.18)] focus:outline-none max-sm:top-[6vh] max-sm:max-h-[90vh]" data-testid={testId}>
          <div className="flex items-start justify-between gap-4 border-b border-[#ecebe8] px-[26px] pt-5 pb-3.5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[16px] font-semibold text-[#1c1917]">{title}</DialogPrimitive.Title>
              {sub ? <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-[#635d58]">{sub}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <DialogPrimitive.Close className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#d6d3d1] bg-white px-2.5 text-[12.5px] text-[#1c1917] hover:border-[#635d58] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="large-window-close">
                <X className="h-3.5 w-3.5" aria-hidden />
                Close
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[26px] pt-4 pb-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A right-side drawer (batch B, approved 2026-10-31): about 480px wide with 28px gutters, a scrim over the page, a
 * title with a quiet line under it, and a close mark at the top right. Used by Log a call and the Ask AI panel. On
 * the phone it takes the full width.
 */
export function Drawer({ open, onOpenChange, title, sub, children, testId }: { open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/30" />
        <DialogPrimitive.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col overflow-y-auto bg-white shadow-[-8px_0_24px_rgba(15,23,42,0.12)] focus:outline-none")} data-testid={testId}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-7 pt-5 pb-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[17px] font-semibold text-slate-900">{title}</DialogPrimitive.Title>
              {sub ? <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted-foreground">{sub}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="-mt-1 -mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Close" data-testid="drawer-close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-1 flex-col px-7 pt-5 pb-7">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

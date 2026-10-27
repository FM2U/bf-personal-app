"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Centered windows (the app's "windows", built on the Radix dialog):
 * - large: 85% of the screen width, at most 1400px wide and 90% of the screen height (summary, daily close, weekly review).
 * - medium: 60% of the screen width, at most 960px (quick view of a linked record).
 * The title row and the action row stay in place; only the content between them scrolls.
 * On the phone (under 640px) every window fills the screen.
 * Rule: a window never opens on top of another window. Inside a window, links open in the same window (with Back)
 * or go to the full page.
 */
export const WINDOW_SIZE = {
  large: "sm:w-[85vw] sm:max-w-[1400px]",
  medium: "sm:w-[60vw] sm:min-w-[36rem] sm:max-w-[960px]",
} as const;

export type WindowSize = keyof typeof WINDOW_SIZE;

export function WindowFrame({
  open,
  onOpenChange,
  size = "large",
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  headerActions,
  footer,
  children,
  testId,
  onEscapeKeyDown,
  onCloseAutoFocus,
  host = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: WindowSize;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onCloseAutoFocus?: (e: Event) => void;
  /** The shared window of the app (summary and quick view): links inside it open in the same window. */
  host?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/35" />
        <DialogPrimitive.Content
          data-app-window=""
          data-window-host={host ? "" : undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          data-testid={testId}
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(
            "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-2xl outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-border",
            WINDOW_SIZE[size],
          )}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-border bg-white px-4 py-3 sm:px-6">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="-ml-1 mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-slate-600 hover:bg-accent hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="window-back"
              >
                <ChevronLeft className="h-4 w-4" /> {backLabel}
              </button>
            ) : null}
            <div className="min-w-0 flex-1 py-0.5">
              <DialogPrimitive.Title className="clamp-2 text-lg font-semibold leading-7 text-slate-900">{title}</DialogPrimitive.Title>
              {subtitle ? <div className="clamp-1 text-sm text-muted-foreground">{subtitle}</div> : null}
            </div>
            {headerActions ? <div className="hidden shrink-0 items-center gap-2 sm:flex">{headerActions}</div> : null}
            <DialogPrimitive.Close
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-accent hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5" data-window-body="">
            {children}
          </div>
          {footer ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-white px-4 py-3 sm:px-6">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

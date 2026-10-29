"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatState } from "@/components/app/chat-bus";

/**
 * Centered windows (the app's "windows", built on the Radix dialog):
 * - large: 85% of the screen width, at most 1400px wide and 90% of the screen height (overviews, editors, the
 *   initiative setup, Work through tasks, the daily close, reviews).
 * - medium: 60% of the screen width, at most 960px (quick view of a task, contact, organization, milestone).
 * The title row (and a toolbar under it, such as the setup's step bar) and the action row stay in place; only the
 * content between them scrolls. On the phone (under 640px) every window fills the screen.
 * When a question is asked in Ask AI inside a window, the window grows to about 85% of the screen height.
 * Rule: a window never opens on top of another window. Inside a window, links open in the same window (with Back)
 * or go to the full page.
 */
export const WINDOW_SIZE = {
  large: "sm:w-[85vw] sm:max-w-[1400px]",
  medium: "sm:w-[60vw] sm:min-w-[36rem] sm:max-w-[960px]",
} as const;

export type WindowSize = keyof typeof WINDOW_SIZE;

/** The window itself: the shaded page behind it and the centered box. Its content is a WindowLayout. */
export function WindowShell({
  open,
  onOpenChange,
  size = "large",
  children,
  testId,
  onEscapeKeyDown,
  onCloseAutoFocus,
  onInteractOutside,
  host = false,
  urlWindow = false,
  minHeight = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: WindowSize;
  children: React.ReactNode;
  testId?: string;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  onCloseAutoFocus?: (e: Event) => void;
  onInteractOutside?: (e: Event) => void;
  /** The shared window of the app: links inside it open in the same window. */
  host?: boolean;
  /** The window named in the page address (src/components/app/window-host.tsx). */
  urlWindow?: boolean;
  /** A steady height while moving between steps (less jumping), still no taller than the content needs above it. */
  minHeight?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/35" />
        <DialogPrimitive.Content
          data-app-window=""
          data-window-host={host ? "" : undefined}
          data-url-window={urlWindow ? "" : undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={onInteractOutside}
          data-testid={testId}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // The AI chat open inside the window closes first; the window stays.
            if (chatState.openInWindow) {
              e.preventDefault();
              chatState.close?.();
              return;
            }
            onEscapeKeyDown?.(e);
          }}
          className={cn(
            "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-2xl outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-border",
            // A question in Ask AI (the chat inside the window) grows the window to about 85% of the screen height,
            // smoothly; the chat sets data-chat-tall (src/components/app/chat-panel.tsx).
            "transition-[min-height] duration-300 ease-out motion-reduce:transition-none sm:data-[chat-tall]:min-h-[85vh]",
            minHeight ? "sm:min-h-[min(36rem,90vh)]" : "sm:min-h-0",
            WINDOW_SIZE[size],
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Title row (Back, title, header actions, Close), optional toolbar, scrolling content, and the action row. */
export function WindowLayout({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  headerActions,
  toolbar,
  footer,
  children,
  onClose,
  ask,
}: {
  /** "Ask AI about this" (always shown, also on the phone, next to Close). */
  ask?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  headerActions?: React.ReactNode;
  /** Stays in view under the title row (the setup's step bar). */
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Close button handler; without it the Close button closes the dialog the usual way. */
  onClose?: () => void;
}) {
  const closeClass =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-accent hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      {/* The divider under the window title is a thin gold line (README UI rules). */}
      <div className="flex shrink-0 items-start gap-3 border-b border-gold-rule bg-white px-4 py-3 sm:px-6">
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
        {ask ? <div className="shrink-0">{ask}</div> : null}
        {onClose ? (
          <button type="button" onClick={onClose} className={closeClass} aria-label="Close" data-testid="window-close">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <DialogPrimitive.Close className={closeClass} aria-label="Close" data-testid="window-close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </div>
      {toolbar ? <div className="shrink-0 border-b border-border bg-white px-4 py-2.5 sm:px-6">{toolbar}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5" data-window-body="">
        {children}
      </div>
      {footer ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-white px-4 py-3 sm:px-6">{footer}</div> : null}
    </>
  );
}

/** A window with its layout in one piece (the daily close and review windows). */
export function WindowFrame({
  open,
  onOpenChange,
  size = "large",
  title,
  subtitle,
  onBack,
  backLabel,
  headerActions,
  footer,
  children,
  testId,
  onEscapeKeyDown,
  onCloseAutoFocus,
  host = false,
  ask,
}: {
  ask?: React.ReactNode;
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
  host?: boolean;
}) {
  return (
    <WindowShell open={open} onOpenChange={onOpenChange} size={size} testId={testId} onEscapeKeyDown={onEscapeKeyDown} onCloseAutoFocus={onCloseAutoFocus} host={host}>
      <WindowLayout title={title} subtitle={subtitle} onBack={onBack} backLabel={backLabel} headerActions={headerActions} footer={footer} ask={ask}>
        {children}
      </WindowLayout>
    </WindowShell>
  );
}

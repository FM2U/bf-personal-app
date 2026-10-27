import * as React from "react";
import { cn } from "@/lib/utils";
import { STATUS_BOX, STATUS_TEXT, toneStatus } from "@/lib/status";
import { AskAiButton } from "@/components/app/ask-ai-button";
import type { ChatContext } from "@/lib/ai/context";

/**
 * Page title, one-line description, and the page's buttons. Every page header has "Ask AI about this" (the AI chat
 * about this page, or about the record when `ask` names one); `ask={false}` leaves it out.
 */
export function PageHeader({ title, description, actions, className, ask }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string; ask?: ChatContext | false }) {
  const context = ask === false ? null : ask ?? { label: title };
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 sm:flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions || context ? (
        <div className="no-print flex flex-wrap items-start gap-2 sm:max-w-[60%] sm:shrink-0 sm:justify-end">
          {context ? <AskAiButton context={context} /> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Label style for every metric (Stat, Home tiles): dark gray, medium weight, held to 2 lines. */
export const METRIC_LABEL = "clamp-2 min-h-8 text-xs font-medium leading-4 text-slate-700";

/** A small labeled number. Labels are held to 2 lines so values line up across a row. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={METRIC_LABEL}>{label}</span>
      <span
        className={cn(
          "tabular mt-1 text-lg font-semibold leading-tight text-slate-900",
          tone && STATUS_TEXT[toneStatus(tone)],
        )}
      >
        {value}
      </span>
      {hint ? <span className="clamp-1 mt-0.5 text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * Grid of metrics with a thin light line between rows (1px, slate-200, 12px above and below).
 * Each line runs the full width of the grid, also above a row that is not full; the first row has no line.
 * Works for any column count: the top line of the first row is hidden (styles: .stat-grid in globals.css).
 */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <div className={cn("stat-grid -mt-[13px] grid grid-cols-2 content-start gap-y-3", className)}>{children}</div>
    </div>
  );
}

/** Empty state: what to add, and the button to add it. `compact`: one short row (empty sections in lists and tables). */
export function EmptyState({ title, body, action, compact = false }: { title: string; body?: string; action?: React.ReactNode; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-2.5" data-testid="empty-compact">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium text-slate-800">{title}</span>
          {body ? <span className="text-muted-foreground"> {body}</span> : null}
        </p>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-5">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {body ? <p className="max-w-prose text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "info" && cn(STATUS_BOX.neutral, "text-slate-800"),
        tone === "warn" && cn(STATUS_BOX.soon, STATUS_TEXT.soon),
        tone === "error" && cn(STATUS_BOX.missed, STATUS_TEXT.missed),
        tone === "success" && cn(STATUS_BOX.met, STATUS_TEXT.met),
      )}
    >
      <div className="max-w-[75ch]">{children}</div>
    </div>
  );
}

/** Responsive card grid. Single cards never stretch the full desktop width. */
export function Bento({ children, cols = 3, className }: { children: React.ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        cols === 2 && "md:grid-cols-2",
        cols === 3 && "md:grid-cols-2 xl:grid-cols-3",
        cols === 4 && "sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Label and value list for record details: each label sits directly above its value, in a compact grid that fills
 * the width with as many columns as fit (at least 12rem each), so no value is far from its label.
 * Labels are held to 2 lines and values in a row start on the same line (subgrid). `wide` items (long text) take
 * the whole row. `cols` is kept for older callers and is not needed.
 */
export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode; wide?: boolean }[]; cols?: 1 | 2 }) {
  // Short values first (they fill the columns), long text after them, so no row is left half empty.
  items = [...items.filter((i) => !i.wide), ...items.filter((i) => i.wide)];
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(min(12rem,100%),1fr))] gap-x-6">
      {items.map((it, i) => (
        <div key={i} className={cn("row-span-2 grid min-w-0 grid-rows-subgrid border-b border-slate-100 pb-2.5 mb-2.5", it.wide && "col-span-full")}>
          <dt className="clamp-2 self-end text-xs font-medium leading-4 text-slate-500">{it.label}</dt>
          <dd className={cn("mt-1 min-w-0 break-words text-sm text-slate-900", it.wide && "max-w-[75ch]")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

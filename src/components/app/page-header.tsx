import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 sm:flex-1">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap gap-2 sm:max-w-[55%] sm:shrink-0 sm:justify-end">{actions}</div> : null}
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
          tone === "good" && "text-emerald-700",
          tone === "bad" && "text-red-700",
          tone === "warn" && "text-amber-700",
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

/** Empty state: what to add, and the button to add it. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
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
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-900",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "error" && "border-red-200 bg-red-50 text-red-900",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}
    >
      {children}
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

/** Aligned label and value list for record details. Labels wrap to at most 2 lines. */
export function DetailGrid({ items, cols = 1 }: { items: { label: string; value: React.ReactNode }[]; cols?: 1 | 2 }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", cols === 2 && "md:grid-cols-2")}>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] items-start gap-3 border-b border-slate-100 pb-2">
          <dt className="clamp-2 text-xs leading-4 text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words text-sm text-slate-900">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

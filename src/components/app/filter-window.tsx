"use client";

import { ListFilter, Search, X } from "lucide-react";
import { CenteredWindow } from "@/components/app/window";
import { CollapseAllButton } from "@/components/app/work/ui";
import type { FilterGroup, Ticks } from "@/lib/filters";
import { cn } from "@/lib/utils";

/**
 * The filter row and the Filter window (Push B edits, 2026-11-03), shared by every list that filters (Contacts now;
 * Screen listings, Deals, Job search, Consulting, and Sent reports later). The row: the view choice (each view with
 * the number of rows it shows), Find, and the Filter button ("Filter · 2" while boxes are ticked); the ticked choices
 * as removable chips under it, only while set. The window: the same view choice at the top, one column of
 * checkboxes per group with live counts, and Clear all, the summary line, and the solid Show button at the bottom.
 * The logic is in src/lib/filters.ts.
 */

export type FilterView<K extends string> = { key: K; label: string; count: number };

/** The view choice: a pill group, each view with its count (the counts are left out inside the window). */
export function ViewChoice<K extends string>({ views, active, onPick, counts = true, testId = "view-choice" }: { views: readonly FilterView<K>[]; active: K; onPick: (k: K) => void; counts?: boolean; testId?: string }) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full border border-border bg-white" role="group" aria-label="View" data-testid={testId}>
      {views.map((v, i) => (
        <button key={v.key} type="button" onClick={() => onPick(v.key)} aria-pressed={active === v.key} className={cn("inline-flex items-center px-[13px] py-[5px] text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", active === v.key ? "bg-primary-soft text-primary-strong" : "text-heading hover:bg-slate-50")} data-testid={`${testId}-${v.key}`} data-count={v.count}>
          {v.label}
          {counts ? <span className={cn("tabular ml-[5px]", active === v.key ? "text-primary-strong" : "text-slate-400")}>{v.count}</span> : null}
        </button>
      ))}
    </span>
  );
}

/** The top row: the view choice, Find, and the Filter button. */
export function FilterRow<K extends string>({ views, view, onView, query, onQuery, placeholder, ticked, onOpen, testId = "filter-row", collapse }: { views: readonly FilterView<K>[]; view: K; onView: (k: K) => void; query: string; onQuery: (q: string) => void; placeholder: string; ticked: number; onOpen: () => void; testId?: string; /** Collapse all / Expand all, for a view with sections (Follow-ups). */ collapse?: { allCollapsed: boolean; onClick: () => void } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2" data-testid={testId}>
      <ViewChoice views={views} active={view} onPick={onView} testId="people-view" />
      <span className="relative ml-0 min-w-[160px] flex-1 basis-[160px] sm:ml-auto sm:max-w-[240px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 w-full rounded-[7px] border border-input bg-white pr-2.5 pl-[30px] text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="filter-search" />
      </span>
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className={cn("inline-flex h-8 items-center gap-[7px] rounded-[7px] border px-3 text-[13px] font-medium whitespace-nowrap", ticked ? "border-primary-border bg-primary-soft text-primary-strong" : "border-input bg-white text-slate-800 hover:bg-slate-50")} data-testid="filter-open" data-ticked={ticked}>
        <ListFilter className="h-[15px] w-[15px]" aria-hidden />
        Filter{ticked ? ` · ${ticked}` : ""}
      </button>
      {collapse ? <CollapseAllButton allCollapsed={collapse.allCollapsed} onClick={collapse.onClick} className="ml-1" /> : null}
    </div>
  );
}

/** The ticked choices as chips ("Role: Broker ×") with Clear all, only while a box is ticked. */
export function FilterChips({ chips, onRemove, onClear }: { chips: { group: string; groupTitle: string; value: string; label: string }[]; onRemove: (group: string, value: string) => void; onClear: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="filter-chips">
      {chips.map((c) => (
        <span key={`${c.group}:${c.value}`} className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-soft py-0.5 pr-1 pl-2.5 text-[12.5px] whitespace-nowrap text-primary-strong" data-testid="filter-chip" data-group={c.group} data-value={c.value}>
          <span className="text-muted-foreground">{c.groupTitle}:</span>
          {c.label}
          <button type="button" onClick={() => onRemove(c.group, c.value)} className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full hover:bg-primary-soft-hover" aria-label={`Remove ${c.groupTitle} ${c.label}`} data-testid="filter-chip-remove">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="ml-1 text-[12.5px] font-medium text-primary-strong hover:underline" data-testid="filter-chips-clear">
        Clear all
      </button>
    </div>
  );
}

/**
 * The Filter window: the view choice (switching changes the groups and the list behind), the groups in columns of
 * checkboxes (four across, two on a tablet, one on the phone), the count beside each choice, a Clear link on a group
 * with ticks; the footer with Clear all, the summary line, and "Show 12 people".
 */
export function FilterWindow<T, K extends string>({ open, onOpenChange, views, view, onView, groups, ticks, counts, onToggle, onClearGroup, onClearAll, summary, show }: { open: boolean; onOpenChange: (o: boolean) => void; views: readonly FilterView<K>[]; view: K; onView: (k: K) => void; groups: readonly FilterGroup<T>[]; ticks: Ticks; counts: Record<string, Record<string, number>>; onToggle: (group: string, value: string) => void; onClearGroup: (group: string) => void; onClearAll: () => void; summary: string; show: string }) {
  return (
    <CenteredWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Filter"
      sub="Ticks in one column mean either one. Ticks in different columns must all match. The number beside each choice is how many you would see."
      testId="filter-window"
      footer={
        <>
          <button type="button" onClick={onClearAll} className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="filter-clear-all">
            Clear all
          </button>
          <span className="order-first min-w-0 flex-1 basis-full text-left text-[12.5px] text-muted-foreground min-[701px]:order-none min-[701px]:basis-[220px] min-[701px]:text-right" data-testid="filter-summary">
            {summary}
          </span>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-[38px] items-center rounded-[7px] border border-primary-solid bg-primary-solid px-4 text-sm font-medium whitespace-nowrap text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover" data-testid="filter-show">
            {show}
          </button>
        </>
      }
    >
      <div className="mb-5">
        <ViewChoice views={views} active={view} onPick={onView} counts={false} testId="filter-view" />
      </div>
      <div className="grid grid-cols-1 gap-x-7 gap-y-[22px] min-[561px]:grid-cols-2 min-[901px]:grid-cols-4" data-testid="filter-groups">
        {groups.map((g) => {
          const on = ticks[g.key] ?? [];
          return (
            <div key={g.key} className="min-w-0" data-testid="filter-group" data-group={g.key}>
              <h3 className="mb-1 flex items-center justify-between gap-2 border-b border-rule pb-[7px] text-[11px] font-semibold tracking-[0.09em] text-heading uppercase">
                <span>{g.title}</span>
                {on.length ? (
                  <button type="button" onClick={() => onClearGroup(g.key)} className="text-xs font-medium tracking-normal text-primary-strong normal-case hover:underline" data-testid="filter-group-clear">
                    Clear
                  </button>
                ) : null}
              </h3>
              {g.options.map((o) => {
                const ticked = on.includes(o.value);
                const n = counts[g.key]?.[o.value] ?? 0;
                const id = `fo-${g.key}-${o.value}`;
                return (
                  <label key={o.value} htmlFor={id} className={cn("-mx-1 grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[5px] px-1 py-1.5 text-[13.5px] hover:bg-slate-100", ticked ? "font-medium text-primary-strong" : n ? "text-slate-900" : "text-slate-400")} data-testid="filter-option" data-group={g.key} data-value={o.value} data-count={n} data-on={ticked ? "1" : "0"}>
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
    </CenteredWindow>
  );
}

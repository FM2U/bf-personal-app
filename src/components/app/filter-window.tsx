"use client";

import { X } from "lucide-react";
import { CenteredWindow } from "@/components/app/window";
import type { FilterGroup, Ticks } from "@/lib/filters";
import { cn } from "@/lib/utils";

/**
 * The Filter window (Push B edits, 2026-11-03), shared by every list that filters (Contacts and Work on now; Screen
 * listings, Deals, Job search, Consulting, and Sent reports later), and the ticked choices as removable chips under
 * the title row, only while set. The window: an optional view choice at the top, one column of checkboxes per group
 * with live counts (a single group lists its choices in two columns), and Clear all, the summary line, and the solid
 * Show button at the bottom. Find and the Filter button are in src/components/app/work/title-row.tsx. The logic is in
 * src/lib/filters.ts.
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
export function FilterWindow<T, K extends string>({ open, onOpenChange, views, view, onView, groups, ticks, counts, onToggle, onClearGroup, onClearAll, summary, show, sub }: { open: boolean; onOpenChange: (o: boolean) => void; /** The view choice at the top (left out when the page has it). */ views?: readonly FilterView<K>[]; view?: K; onView?: (k: K) => void; groups: readonly FilterGroup<T>[]; ticks: Ticks; counts: Record<string, Record<string, number>>; onToggle: (group: string, value: string) => void; onClearGroup: (group: string) => void; onClearAll: () => void; summary: string; show: string; /** The line under the title. */ sub?: string }) {
  const one = groups.length === 1;
  return (
    <CenteredWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Filter"
      sub={sub ?? "Ticks in one column mean either one. Ticks in different columns must all match. The number beside each choice is how many you would see."}
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
      {views && view && onView ? (
        <div className="mb-5">
          <ViewChoice views={views} active={view} onPick={onView} counts={false} testId="filter-view" />
        </div>
      ) : null}
      <div className={cn("grid grid-cols-1 gap-x-8 gap-y-[22px]", !one && "min-[561px]:grid-cols-2", groups.length >= 3 && "min-[901px]:grid-cols-4")} data-testid="filter-groups">
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
              <div className={cn(one && "min-[701px]:grid min-[701px]:grid-cols-2 min-[701px]:gap-x-8")}>
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
            </div>
          );
        })}
      </div>
    </CenteredWindow>
  );
}

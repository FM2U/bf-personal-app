"use client";

import { ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The title row of Work on now, Contacts and To-dos (approved 2026-11-04): the page title on the left; on the right
 * the date (Work on now), Find, Filter ("Filter · 2" while boxes are ticked), and Ask AI; on Contacts the add button
 * stays in the row and Find and Filter sit beside the view choice under it. Under 1024px Ask AI stays on the title
 * line and Find with Filter take the next line; under 700px the date is short ("Wed, Nov 4").
 */
export function TitleRow({ title, date, tools, add, askAi, testId = "title-row" }: { title: string; date?: { long: string; short: string }; /** Find and Filter. */ tools?: React.ReactNode; /** A button that stays on the title line (Add a person). */ add?: React.ReactNode; askAi?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 max-lg:gap-x-3" data-testid={testId}>
      <h1 className="mr-auto text-[22px] font-semibold tracking-[-0.01em] whitespace-nowrap text-slate-900">{title}</h1>
      {date ? (
        <span className="text-[13px] whitespace-nowrap text-muted-foreground" data-testid="work-date">
          <span className="max-[700px]:hidden">{date.long}</span>
          <span className="hidden max-[700px]:inline">{date.short}</span>
        </span>
      ) : null}
      {add ? <div className="flex shrink-0 items-center gap-2.5">{add}</div> : null}
      {tools ? <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2 max-lg:order-2 max-lg:basis-full max-lg:justify-start">{tools}</div> : null}
      {askAi ? <div className="flex shrink-0 items-center max-lg:order-1">{askAi}</div> : null}
    </div>
  );
}

/** The Find box: 200px with the magnifier; it takes the free width under 1024px. */
export function FindBox({ id, value, onChange, placeholder = "Find", testId = "find" }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <span className="relative w-[200px] min-w-[120px] shrink max-lg:w-auto max-lg:flex-1 max-lg:basis-[140px]">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" className="h-8 w-full rounded-[7px] border border-input bg-white pr-2.5 pl-[30px] text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid={testId} />
    </span>
  );
}

/** The Filter button: "Filter", or "Filter · 2" in soft blue while boxes are ticked. */
export function FilterButton({ ticked, onOpen, testId = "filter-open" }: { ticked: number; onOpen: () => void; testId?: string }) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" className={cn("inline-flex h-8 shrink-0 items-center gap-[7px] rounded-[7px] border px-3 text-[13px] font-medium whitespace-nowrap", ticked ? "border-primary-border bg-primary-soft text-primary-strong" : "border-input bg-white text-slate-800 hover:bg-slate-50")} data-testid={testId} data-ticked={ticked}>
      <ListFilter className="h-[15px] w-[15px]" aria-hidden />
      Filter{ticked ? ` · ${ticked}` : ""}
    </button>
  );
}

/**
 * The view choice of Contacts as the page's main control (2026-11-04): a larger segmented control right under the
 * title, each view with its number (the numbers hide under 480px). `compact`: the small one in the slim bar.
 */
export function ViewSelector<K extends string>({ views, active, onPick, compact = false, testId = "people-view" }: { views: readonly { key: K; label: string; count: number }[]; active: K; onPick: (k: K) => void; compact?: boolean; testId?: string }) {
  if (compact) {
    return (
      <span className="inline-flex shrink-0 rounded-full border border-border bg-white p-px" role="group" aria-label="View" data-testid={testId}>
        {views.map((v) => (
          <button key={v.key} type="button" onClick={() => onPick(v.key)} aria-pressed={active === v.key} className={cn("rounded-full px-2.5 py-[3px] text-xs font-medium whitespace-nowrap", active === v.key ? "bg-primary-soft text-primary-strong shadow-[inset_0_0_0_1.5px_var(--primary)]" : "text-heading hover:bg-slate-100")} data-testid={`${testId}-${v.key}`}>
            {v.label}
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-border bg-white p-[3px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] max-[700px]:flex max-[700px]:basis-full" role="group" aria-label="View" data-testid={testId}>
      {views.map((v) => (
        <button key={v.key} type="button" onClick={() => onPick(v.key)} aria-pressed={active === v.key} className={cn("inline-flex h-9 items-center justify-center gap-[7px] rounded-full px-[18px] text-sm font-semibold whitespace-nowrap max-[700px]:min-w-0 max-[700px]:flex-1 max-[700px]:px-2 max-[700px]:text-[13.5px]", active === v.key ? "bg-primary-soft text-primary-strong shadow-[inset_0_0_0_1.5px_var(--primary)]" : "text-heading hover:bg-slate-100")} data-testid={`${testId}-${v.key}`} data-count={v.count}>
          {v.label}
          <span className={cn("tabular font-medium max-[480px]:hidden", active === v.key ? "text-primary-strong" : "text-slate-400")}>{v.count}</span>
        </button>
      ))}
    </span>
  );
}

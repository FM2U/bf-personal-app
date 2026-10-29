"use client";

/**
 * The Filter button and panel used by every filtered list (Task lists, contacts, organizations, communications,
 * reviews, pipeline item lists, commitments, expenses). The panel shows columns of checkboxes with thin gold lines
 * between the columns, then Clear all and Apply. Active filters show as small labels next to the button; each label's x
 * removes that filter, and Reset goes back to the list's default. The filters live in the page address.
 *
 * - FilterPanel: the panel itself; the caller says how a filter state becomes an address (hrefFor).
 * - ListFilter: for server pages; builds addresses with filterHref (src/lib/list-filters.ts).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeLabels, filterHref, isDefaultFilters, type FilterColumn, type FilterLayout, type FilterState } from "@/lib/list-filters";
import { cn } from "@/lib/utils";

function Column({ col, picked, toggle }: { col: FilterColumn; picked: string[]; toggle: (key: string, v: string) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{col.title}</legend>
      <div className={cn("flex flex-col gap-1", col.options.length > 10 && "max-h-60 overflow-y-auto pr-1")}>
        {col.options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm text-slate-800 hover:bg-slate-50">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={picked.includes(o.value)} onChange={() => toggle(col.key, o.value)} data-testid={`filter-${col.key}-${o.value}`} />
            <span className="clamp-2 min-w-0">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const GRID_COLS = ["sm:grid-cols-1", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4"];
const WIDTH = ["sm:w-[min(16rem,calc(100vw-2rem))]", "sm:w-[min(16rem,calc(100vw-2rem))]", "sm:w-[min(30rem,calc(100vw-2rem))]", "sm:w-[min(40rem,calc(100vw-2rem))]", "sm:w-[min(50rem,calc(100vw-2rem))]"];

export function FilterPanel({
  layout,
  state,
  hrefFor,
  resetHref,
  isDefault,
  label = "Filter",
  testId = "task-filter",
}: {
  layout: FilterLayout;
  state: FilterState;
  hrefFor: (s: FilterState) => string;
  /** Where Reset goes (the list's default). */
  resetHref: string;
  /** True when the filters are at the list's default (Reset is hidden). */
  isDefault: boolean;
  label?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterState>(state);
  const box = useRef<HTMLDivElement>(null);
  const columns = layout.flat();
  const labels = activeLabels(state, columns, hrefFor);
  const count = labels.length;
  const n = Math.min(4, Math.max(1, layout.length));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: (d[key] ?? []).includes(v) ? d[key].filter((x) => x !== v) : [...(d[key] ?? []), v] }));
  const apply = (f: FilterState) => {
    setOpen(false);
    router.push(hrefFor(f));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      <div className="relative" ref={box}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(state);
            setOpen((o) => !o);
          }}
          data-testid="filter-button"
        >
          <Filter /> {label}
          {count ? <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-white">{count}</span> : null}
        </Button>
        {open ? (
          <div
            role="dialog"
            aria-label={label}
            className={cn("fixed inset-x-4 top-20 z-40 max-h-[75vh] overflow-y-auto rounded-xl border border-border bg-white p-4 shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:overflow-visible", WIDTH[n])}
            data-testid="filter-popover"
          >
            {/* Columns side by side with thin gold lines between them (stacked with gold lines between on the phone). */}
            <div className={cn("grid grid-cols-1 divide-y divide-gold-rule sm:divide-x sm:divide-y-0", GRID_COLS[n])} data-testid="filter-columns">
              {layout.map((group, i) => (
                <div key={i} className={cn("flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0")} data-testid="filter-column">
                  {group.map((col) => (
                    <Column key={col.key} col={col} picked={draft[col.key] ?? []} toggle={toggle} />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-muted-foreground">No box checked in a column means any.</span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(Object.fromEntries(columns.map((c) => [c.key, []])))} data-testid="filter-clear">
                  Clear all
                </Button>
                <Button type="button" size="sm" onClick={() => apply(draft)} data-testid="filter-apply">
                  Apply
                </Button>
              </span>
            </div>
          </div>
        ) : null}
      </div>
      {labels.map((l) => (
        <Link key={l.key} href={l.href} className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary-strong hover:bg-white" aria-label={`Remove filter: ${l.label}`} data-testid="filter-label">
          {l.label} <X aria-hidden className="h-3 w-3" />
        </Link>
      ))}
      {!isDefault ? (
        <Link href={resetHref} className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" data-testid="filter-reset">
          Reset
        </Link>
      ) : null}
    </div>
  );
}

/** The filter panel for a list on a server page: addresses on `path`, keeping the page's other parameters (`keep`). */
export function ListFilter({ path, layout, state, keep = {}, testId = "list-filter" }: { path: string; layout: FilterLayout; state: FilterState; keep?: Record<string, string>; testId?: string }) {
  const columns = layout.flat();
  const hrefFor = (s: FilterState) => filterHref(path, s, columns, keep);
  const defaults = Object.fromEntries(columns.map((c) => [c.key, c.defaults ?? []]));
  return <FilterPanel layout={layout} state={state} hrefFor={hrefFor} resetHref={hrefFor(defaults)} isDefault={isDefaultFilters(state, columns)} testId={testId} />;
}

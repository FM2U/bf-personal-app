"use client";

/**
 * Lists of repeated editable items (goals, milestones, recurring tasks, checklists, target and budget, plan) in the
 * initiative setup and on the draft review screen. Each item is one compact row while collapsed: its number, its
 * name, small labeled facts, Include, Remove, and Edit. Edit opens the item's fields in a grid below the row.
 * Expand all and Collapse all sit at the top of the list. Each viewer's choice is remembered per draft and list in
 * this browser (localStorage, wrapped so blocked storage only means "not remembered"). Which items start open, and
 * the facts, come from src/lib/initiative/items.ts (tested).
 *
 * Fields inside a collapsed item stay in the page (hidden), so typed text is kept. A field reached from the summary
 * window opens its item first (the "bf:reveal" event sent by focusField in window-host.tsx).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSavedOpen } from "@/components/app/collapsible";
import { DISCLOSURE_PREFIX, writeSaved } from "@/lib/disclosure";
import { itemsOpen, shiftAfterRemove, type Fact } from "@/lib/initiative/items";
import { cn } from "@/lib/utils";

type ListCtx = { isOpen: (i: number) => boolean; setOpen: (i: number, open: boolean) => void; removed: (i: number) => void };
const List = createContext<ListCtx | null>(null);

/** The event a field's container listens for to open before the field is focused. */
export const REVEAL_EVENT = "bf:reveal";

/**
 * Open state for one list of `count` items. `attention[i]` opens item i (a problem to fix) and keeps it open while it
 * is fixed, until the viewer closes it.
 */
function useItemsOpen(storageKey: string | null, count: number, attention: boolean[]) {
  const saved = useSavedOpen(storageKey ? DISCLOSURE_PREFIX + storageKey : null);
  const [initialCount] = useState(count);
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  // An item that needs attention stays open on this page view, even once the problem is fixed while typing.
  const latch = attention.map((a, i) => a && typeof changed[String(i)] !== "boolean");
  if (latch.some(Boolean)) {
    setChanged((m) => {
      const next = { ...m };
      latch.forEach((l, i) => {
        if (l && typeof next[String(i)] !== "boolean") next[String(i)] = true;
      });
      return next;
    });
  }
  const open = useMemo(() => itemsOpen({ count, initialCount, attention, saved, changed }), [count, initialCount, attention, saved, changed]);
  const setOpen = useCallback(
    (i: number, o: boolean) => {
      if (storageKey) writeSaved(storageKey, { [String(i)]: o });
      setChanged((m) => ({ ...m, [String(i)]: o }));
    },
    [storageKey],
  );
  const all = useCallback(
    (o: boolean) => {
      const next = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), o]));
      if (storageKey) writeSaved(storageKey, next);
      setChanged(next);
    },
    [count, storageKey],
  );
  const removed = useCallback(
    (i: number) => {
      const shifted = shiftAfterRemove({ ...(saved ?? {}), ...changed }, i);
      if (storageKey) {
        try {
          window.localStorage.setItem(DISCLOSURE_PREFIX + storageKey, JSON.stringify(shifted));
        } catch {
          // Not remembered; the list still opens and closes.
        }
      }
      setChanged(shifted);
    },
    [saved, changed, storageKey],
  );
  return { open, setOpen, all, removed };
}

/**
 * A list of repeated items with "N of M selected" and Expand all | Collapse all at the top (when it has 2 or more).
 * `storageKey` is per draft and list ("items:<draft id>:milestones"); null when there is nothing to remember it by.
 */
export function RepeatList({
  title,
  count,
  countText,
  attention,
  storageKey,
  hideTitle = false,
  testId,
  children,
}: {
  title: string;
  count: number;
  countText?: string;
  attention: boolean[];
  storageKey: string | null;
  hideTitle?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const { open, setOpen, all, removed } = useItemsOpen(storageKey, count, attention);
  const ctx = useMemo<ListCtx>(() => ({ isOpen: (i) => open[i] ?? true, setOpen, removed }), [open, setOpen, removed]);
  const controls =
    count >= 2 ? (
      <div className="ml-auto flex items-center gap-1 text-xs" data-testid="expand-all-controls">
        <button type="button" className="rounded px-2 py-1 font-medium text-primary-strong hover:bg-primary-soft" onClick={() => all(true)} data-testid="expand-all">
          Expand all
        </button>
        <span aria-hidden className="text-slate-300">
          |
        </span>
        <button type="button" className="rounded px-2 py-1 font-medium text-primary-strong hover:bg-primary-soft" onClick={() => all(false)} data-testid="collapse-all">
          Collapse all
        </button>
      </div>
    ) : null;
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      {hideTitle && !controls && !countText ? null : (
        <div className="flex min-h-7 items-center gap-2">
          {hideTitle ? (
            countText ? <span className="text-xs text-muted-foreground">{countText}</span> : null
          ) : (
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
              {title} {countText ? <span className="font-normal normal-case text-muted-foreground">{countText}</span> : null}
            </h2>
          )}
          {controls}
        </div>
      )}
      <List.Provider value={ctx}>
        <div className="flex flex-col gap-2">{children}</div>
      </List.Provider>
    </section>
  );
}

// Narrower columns on a medium item (the review page), wider on a wide one (the setup window).
const FACT_WIDTH: Record<Fact["size"], string> = { sm: "w-[6.5rem] shrink-0 @5xl/item:w-[7.5rem]", md: "w-[9rem] shrink-0 @5xl/item:w-[11rem]", long: "min-w-0 flex-1" };

/** The small labeled facts of a collapsed row, in fixed widths so they line up from row to row. */
function Facts({ facts }: { facts: Fact[] }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-x-4 gap-y-0.5 overflow-hidden text-xs @max-2xl/item:flex-wrap" data-testid="item-facts">
      {facts.map((f) => (
        <span key={f.label} className={cn("flex min-w-0 items-baseline gap-1.5 @max-2xl/item:w-auto @max-2xl/item:flex-none", FACT_WIDTH[f.size], f.size === "long" && "@max-2xl/item:basis-full")} title={`${f.label}: ${f.value}`}>
          <span className="shrink-0 font-medium text-slate-500">{f.label}</span>
          <span className={cn("min-w-0 truncate text-slate-800", f.value === "Not set" && "text-muted-foreground")}>{f.value}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * One repeated item: a compact row (number, name, facts, Include, Remove, Edit) and, when open, its fields below.
 * Inside a RepeatList it follows the list's open state; `index` is its place in the list.
 */
export function RepeatItem({
  index,
  name,
  facts,
  kind,
  badge,
  included,
  onInclude,
  onRemove,
  locked = false,
  testId,
  children,
}: {
  index: number;
  name: string;
  facts: Fact[];
  /** "Milestone", "Goal": used in button names ("Include milestone: ..."). */
  kind: string;
  /** A small badge after the name ("Commitment"). */
  badge?: string;
  included: boolean;
  onInclude?: (v: boolean) => void;
  onRemove?: () => void;
  locked?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const list = useContext(List);
  const [own, setOwn] = useState(true);
  const open = list ? list.isOpen(index) : own;
  const setOpen = (o: boolean) => (list ? list.setOpen(index, o) : setOwn(o));
  const ref = useRef<HTMLDivElement>(null);
  // A field reached from the summary window opens this item before it is focused.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    setOpenRef.current = setOpen;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onReveal = () => {
      if (!openRef.current) flushSync(() => setOpenRef.current(true));
    };
    el.addEventListener(REVEAL_EVENT, onReveal);
    return () => el.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);
  const label = `${kind} ${index + 1}${name ? `: ${name}` : ""}`;
  return (
    <div
      ref={ref}
      className={cn("@container/item rounded-xl border border-border bg-card shadow-sm transition-opacity", !included && "opacity-60", open && "border-slate-300")}
      data-testid={testId ?? "repeat-item"}
      data-repeat-item=""
      data-open={open ? "" : undefined}
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex min-w-0 flex-1 items-center gap-3 text-left @max-2xl/item:flex-wrap @max-2xl/item:gap-y-1" data-testid="repeat-item-toggle" aria-label={`${open ? "Collapse" : "Edit"} ${label.toLowerCase()}`}>
          <span className={cn("flex min-w-0 items-center gap-2.5 @max-2xl/item:basis-full", !open && "@2xl/item:w-[13rem] @2xl/item:shrink-0 @5xl/item:w-[17rem]")}>
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular", open ? "bg-primary text-white" : "bg-primary-soft text-primary-strong")}>{index + 1}</span>
            <span className={cn(open ? "clamp-2" : "clamp-1", "min-w-0 text-sm font-semibold text-slate-900 group-hover:text-primary-strong", !name && "font-normal italic text-muted-foreground")}>{name || "Untitled"}</span>
            {badge ? (
              <Badge variant="neutral" className="shrink-0">
                {badge}
              </Badge>
            ) : null}
          </span>
          {open ? <span className="flex-1" /> : <Facts facts={facts} />}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {locked ? (
            <Badge variant="neutral">Always created</Badge>
          ) : (
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
              <input type="checkbox" checked={included} onChange={(e) => onInclude?.(e.target.checked)} className="h-4 w-4 accent-primary" aria-label={`Include ${label.toLowerCase()}`} />
              Include
            </label>
          )}
          {onRemove ? (
            <button
              type="button"
              onClick={() => {
                list?.removed(index);
                onRemove();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100 hover:text-slate-900"
              aria-label={`Remove ${kind.toLowerCase()} ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-strong hover:bg-primary-soft"
            data-testid="repeat-item-edit"
            tabIndex={-1}
          >
            <span className="@max-md/item:sr-only">{open ? "Collapse" : "Edit"}</span>
            <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>
      <div hidden={!open} className={cn("border-t border-slate-100 px-4 pb-1 pt-3", !included && "pointer-events-none")} data-testid="repeat-item-body">
        {children}
      </div>
    </div>
  );
}

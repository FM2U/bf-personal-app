"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { DISCLOSURE_PREFIX, parseSaved, readRaw, resolveOpen, writeSaved } from "@/lib/disclosure";
import { cn } from "@/lib/utils";

/**
 * Cards and sections that open and close (progressive disclosure). A group remembers each viewer's choice per page
 * kind (`storageKey`) in this browser; the defaults open the most-used sections. A closed card shows its one-line
 * summary, so the page can be scanned without opening anything. "Expand all" and "Collapse all" act on the group.
 */
const noSubscribe = () => () => {};

/**
 * A saved open-state map from this browser's storage (null on the server and on the first render, so the page
 * matches what the server sent; the saved choice shows right after).
 */
export function useSavedOpen(fullKey: string | null): Record<string, boolean> | null {
  const raw = useSyncExternalStore(noSubscribe, () => (fullKey ? readRaw(fullKey) : null), () => null);
  return useMemo(() => parseSaved(raw), [raw]);
}

type GroupCtx = { isOpen: (id: string) => boolean; toggle: (id: string) => void; all: (open: boolean) => void };
const Group = createContext<GroupCtx | null>(null);

export function DisclosureGroup({ storageKey, defaults, children }: { storageKey: string; defaults: Record<string, boolean>; children: React.ReactNode }) {
  const saved = useSavedOpen(DISCLOSURE_PREFIX + storageKey);
  // Choices made on this page view (also saved, for the next visit).
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const open = useMemo(() => ({ ...resolveOpen(defaults, saved), ...changed }), [defaults, saved, changed]);
  const toggle = useCallback(
    (id: string) => {
      const next = !(open[id] ?? true);
      writeSaved(storageKey, { [id]: next });
      setChanged((m) => ({ ...m, [id]: next }));
    },
    [open, storageKey],
  );
  const all = useCallback(
    (o: boolean) => {
      const next = Object.fromEntries(Object.keys(open).map((k) => [k, o]));
      writeSaved(storageKey, next);
      setChanged(next);
    },
    [open, storageKey],
  );
  const ctx = useMemo<GroupCtx>(() => ({ isOpen: (id) => open[id] ?? true, toggle, all }), [open, toggle, all]);
  return <Group.Provider value={ctx}>{children}</Group.Provider>;
}

/** "Expand all | Collapse all" for the group around it. */
export function ExpandAllControls({ className }: { className?: string }) {
  const g = useContext(Group);
  if (!g) return null;
  return (
    <div className={cn("flex items-center gap-1 text-xs", className)} data-testid="expand-all-controls">
      <button type="button" className="rounded px-2 py-1 font-medium text-primary-strong hover:bg-primary-soft" onClick={() => g.all(true)} data-testid="expand-all">
        Expand all
      </button>
      <span aria-hidden className="text-slate-300">
        |
      </span>
      <button type="button" className="rounded px-2 py-1 font-medium text-primary-strong hover:bg-primary-soft" onClick={() => g.all(false)} data-testid="collapse-all">
        Collapse all
      </button>
    </div>
  );
}

/**
 * A card whose content opens and closes from its title row. Inside a DisclosureGroup it follows the group; alone it
 * remembers its own state under `storageKey`. Closed content stays in the page (hidden), so typed text is kept.
 */
export function CollapsibleCard({
  id,
  title,
  icon,
  summary,
  meta,
  actions,
  defaultOpen = true,
  storageKey,
  className,
  children,
  testId,
  openOnHash,
}: {
  /** Opens (without remembering) when the page address ends with this #anchor (a summary line links here). */
  openOnHash?: string;
  id: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Shown on the title row while the card is closed (one line). */
  summary?: React.ReactNode;
  /** Small text after the title ("5 numbers", "3 items"). */
  meta?: React.ReactNode;
  /** Buttons on the right of the title row (always visible). */
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const g = useContext(Group);
  const saved = useSavedOpen(!g && storageKey ? DISCLOSURE_PREFIX + storageKey : null);
  const [changed, setChanged] = useState<boolean | null>(null);
  const own = changed ?? (saved && typeof saved[id] === "boolean" ? saved[id] : defaultOpen);
  const setOwn = (v: boolean) => setChanged(v);
  useEffect(() => {
    if (!openOnHash || g) return;
    const check = () => {
      if (window.location.hash === `#${openOnHash}`) setChanged(true);
    };
    // A link to this anchor on the same page (Next.js changes the address without a hashchange event).
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && a.hash === `#${openOnHash}` && a.pathname === window.location.pathname) setChanged(true);
    };
    window.addEventListener("hashchange", check);
    document.addEventListener("click", onClick, true);
    const t = setTimeout(check, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", check);
      document.removeEventListener("click", onClick, true);
    };
  }, [openOnHash, g]);
  const open = g ? g.isOpen(id) : own;
  const toggle = () => {
    if (g) return g.toggle(id);
    setOwn(!own);
    if (storageKey) writeSaved(storageKey, { [id]: !own });
  };
  return (
    <section className={cn("flex break-inside-avoid flex-col rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)} data-testid={testId ?? "collapsible-card"} data-open={open ? "" : undefined}>
      <div className={cn("flex items-start gap-2 px-5 pt-4", open ? "pb-3" : "pb-4")}>
        <button type="button" onClick={toggle} aria-expanded={open} className="group flex min-w-0 flex-1 items-start gap-2 text-left" data-testid="collapsible-toggle">
          <ChevronRight aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:text-primary-strong", open && "rotate-90")} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-slate-900 group-hover:text-primary-strong">
              {icon}
              <span className="min-w-0">{title}</span>
              {meta !== undefined && meta !== null ? <span className="whitespace-nowrap text-xs font-normal text-muted-foreground tabular">{meta}</span> : null}
            </span>
            {!open && summary ? (
              <span className="clamp-1 text-xs font-normal text-muted-foreground" data-testid="collapsible-summary">
                {summary}
              </span>
            ) : null}
          </span>
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div hidden={!open} className="flex-1 px-5 pb-5">
        {children}
      </div>
    </section>
  );
}

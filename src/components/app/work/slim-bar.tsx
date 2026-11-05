"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header that shrinks while scrolling (approved 2026-11-04). At rest a page shows its full header (the title row,
 * the Contacts view choice, the tiles); this slim bar slides in at the top only once the WHOLE full header has
 * scrolled off under it, and leaves as soon as any of it comes back, so the two are never on screen together. The
 * bottom of the full header is the element marked data-header-end (the tiles, or the record header); without one, the
 * block the bar sits in. The bar: the small title, the tiles as one row of chips, Find and Filter as icon buttons, on
 * Contacts the compact view choice, and on record pages the page's own buttons (DockingActions). Content scrolls under
 * it. It sits below the iPhone notch (env(safe-area-inset-top)), beside the left menu from 1024px, and has no slide
 * under prefers-reduced-motion (.slim-bar in globals.css).
 *
 * `mode`: "always" at every width; "narrow" only under 1024px (the list pages that keep their pinned block on
 * desktop). While the bar can show, its height is kept in --mini-h on the page, so the band of a list stays pinned
 * right under it.
 */

/** True once the bottom of the full header is at or above the bottom edge of the slim bar (the notch plus the bar). */
function useHeaderGone(bar: React.RefObject<HTMLDivElement | null>, active: boolean): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = bar.current;
      if (!el) return;
      const end = document.querySelector<HTMLElement>("[data-header-end]") ?? el.parentElement;
      if (!end) return;
      const edge = (parseFloat(getComputedStyle(el).top) || 0) + el.offsetHeight;
      setGone(end.getBoundingClientRect().bottom <= edge);
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    // The header moves without a scroll too (a tile picks a shorter list, a form opens above).
    const ro = new ResizeObserver(soon);
    ro.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      ro.disconnect();
    };
  }, [bar, active]);
  return gone;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const set = () => setNarrow(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  return narrow;
}

/** The narrowest the small title gets beside the docked buttons before they turn into icons. */
const TITLE_ROOM = 140;

export function SlimBar({ title, mode = "always", seg, chips, tools, onShown, testId = "slim-bar" }: { title: React.ReactNode; mode?: "always" | "narrow"; /** The compact view choice (Contacts). */ seg?: React.ReactNode; /** The tiles as chips. */ chips?: React.ReactNode; /** Find and Filter as icon buttons. */ tools?: React.ReactNode; /** Told when the bar comes and goes (record pages move their buttons into it). */ onShown?: (shown: boolean) => void; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const active = mode === "always" || narrow;
  const shown = useHeaderGone(ref, active) && active;
  // The bar's height in --mini-h while it can show at this width (0 otherwise), for the pinned bands.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || !active) {
      root.style.setProperty("--mini-h", "0px");
      return;
    }
    // The bar sits under the iPhone notch, so a band pins at the notch plus the bar.
    const set = () => root.style.setProperty("--mini-h", `calc(env(safe-area-inset-top, 0px) + ${el.offsetHeight}px)`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--mini-h", "0px");
    };
  }, [active]);
  useEffect(() => {
    onShown?.(shown);
  }, [shown, onShown]);
  return (
    <div ref={ref} className="slim-bar no-print border-b border-border bg-background px-4 shadow-[0_4px_14px_rgba(15,23,42,0.08)] sm:px-6 lg:px-8" data-slim-bar data-shown={shown ? "1" : "0"} data-mode={mode} inert={!shown} aria-hidden={!shown} data-testid={testId}>
      <div className="mx-auto flex min-h-[50px] max-w-[1120px] flex-wrap items-center gap-x-3.5 gap-y-1.5 py-2 max-[700px]:pt-1.5">
        <h2 className={cn("min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-900 max-[700px]:flex-1", seg && "max-[700px]:hidden")} data-testid="slim-title">
          {title}
        </h2>
        {seg}
        {chips ? <div className="min-w-0 flex-1 max-[700px]:order-3 max-[700px]:basis-full">{chips}</div> : null}
        {tools ? <div className="ml-auto flex shrink-0 items-center gap-2">{tools}</div> : null}
      </div>
    </div>
  );
}

/**
 * The buttons at the right of a record page's title row (Email, Log a call, Advance, Ask AI...) with the slim bar
 * they move into once the header has scrolled off (2026-11-04).
 */
export function DockingActions({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // While the bar shows, the buttons sit at its right end (the same buttons, so an open window or menu keeps working);
  // their place in the title row keeps its size. Too wide for the bar: the buttons with an icon show only the icon.
  useLayoutEffect(() => {
    const d = dock.current;
    const h = holder.current;
    const bar = document.querySelector<HTMLElement>("[data-slim-bar]");
    const inner = bar?.firstElementChild as HTMLElement | null | undefined;
    if (!shown || !d || !h || !bar || !inner) return;
    const r = d.getBoundingClientRect();
    h.style.minWidth = `${r.width}px`;
    h.style.minHeight = `${r.height}px`;
    d.classList.add("slim-docked");
    const place = () => {
      d.classList.remove("slim-docked-icons", "slim-docked-stacked");
      inner.style.paddingRight = "";
      inner.style.paddingBottom = "";
      d.style.left = "";
      const box = inner.getBoundingClientRect();
      if (box.width - d.offsetWidth < TITLE_ROOM) d.classList.add("slim-docked-icons");
      // From the bar's resting place (it may still be sliding in).
      const top = (parseFloat(getComputedStyle(bar).top) || 0) + inner.offsetTop;
      d.style.right = `${window.innerWidth - box.right}px`;
      if (box.width - d.offsetWidth < TITLE_ROOM) {
        // Still too wide (a phone with several buttons): the buttons take their own line under the small title.
        d.classList.add("slim-docked-stacked");
        d.style.left = `${box.left}px`;
        const line = inner.offsetHeight;
        d.style.top = `${top + line - 6}px`;
        inner.style.paddingBottom = `${d.offsetHeight + 12}px`;
        return;
      }
      d.style.top = `${top + (inner.offsetHeight - d.offsetHeight) / 2}px`;
      inner.style.paddingRight = `${d.offsetWidth + 14}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      d.classList.remove("slim-docked", "slim-docked-icons", "slim-docked-stacked");
      d.style.top = "";
      d.style.right = "";
      d.style.left = "";
      inner.style.paddingRight = "";
      inner.style.paddingBottom = "";
      h.style.minWidth = "";
      h.style.minHeight = "";
    };
  }, [shown]);
  return (
    <>
      <SlimBar title={title} onShown={setShown} />
      <div ref={holder}>
        <div ref={dock} className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground" data-testid="record-actions" data-docked={shown ? "1" : "0"}>
          {children}
        </div>
      </div>
    </>
  );
}

const ICON_BTN = "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border text-slate-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Find and Filter as icon buttons in the slim bar. Find goes back to the top and puts the cursor in the Find box. */
export function SlimTools({ findId, filterCount, onFilter, filterOpen }: { /** The id of the page's Find box. */ findId?: string; filterCount?: number; /** Gets the icon, so the small Filter box can hang under it. */ onFilter?: (anchor: HTMLElement) => void; filterOpen?: boolean }) {
  const find = () => {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (findId) requestAnimationFrame(() => document.getElementById(findId)?.focus({ preventScroll: true }));
  };
  return (
    <>
      {findId ? (
        <button type="button" onClick={find} className={cn(ICON_BTN, "border-input bg-white hover:bg-slate-50")} title="Find" aria-label="Find" data-testid="slim-find">
          <Search className="h-[15px] w-[15px]" aria-hidden />
        </button>
      ) : null}
      {onFilter ? (
        <button type="button" onClick={(e) => onFilter(e.currentTarget)} aria-haspopup="dialog" aria-expanded={filterOpen} className={cn(ICON_BTN, filterCount ? "border-primary-border bg-primary-soft text-primary-strong" : "border-input bg-white hover:bg-slate-50")} title="Filter" aria-label={filterCount ? `Filter, ${filterCount} ticked` : "Filter"} data-testid="slim-filter">
          <ListFilter className="h-[15px] w-[15px]" aria-hidden />
          {filterCount ? <span className="tabular absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10.5px] leading-4 font-semibold text-white">{filterCount}</span> : null}
        </button>
      ) : null}
    </>
  );
}

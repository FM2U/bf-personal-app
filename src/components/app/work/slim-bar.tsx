"use client";

import { useEffect, useRef, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The header that shrinks while scrolling (approved 2026-11-04). At rest a page shows its full title row (and tiles);
 * after about 40px of scroll this slim bar slides in at the top (and leaves again under 20px, so it does not flicker
 * at the edge): the small title, the tiles as one row of chips, Find and Filter as icon buttons, and on Contacts the
 * compact view choice. Content scrolls under it. It sits below the iPhone notch (env(safe-area-inset-top)), beside
 * the left menu from 1024px, and has no slide under prefers-reduced-motion (.slim-bar in globals.css).
 *
 * `mode`: "always" at every width (Contacts, To-dos, record pages, and Work on now, whose desktop cards scroll on their
 * own, so its page only scrolls in a short window); "narrow" only under 1024px (the list pages that keep their
 * pinned block on desktop). While the bar can show, its height is kept in --mini-h on the page, so the band of a list
 * stays pinned right under it.
 */
const SHOW_AFTER = 40;
const HIDE_UNDER = 20;

export function useScrolledPast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const check = () => {
      const y = window.scrollY;
      setOn((prev) => (prev ? y > HIDE_UNDER : y > SHOW_AFTER));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  return on;
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

export function SlimBar({ title, mode = "always", seg, chips, tools, testId = "slim-bar" }: { title: React.ReactNode; mode?: "always" | "narrow"; /** The compact view choice (Contacts). */ seg?: React.ReactNode; /** The tiles as chips. */ chips?: React.ReactNode; /** Find and Filter as icon buttons. */ tools?: React.ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledPast();
  const narrow = useNarrow();
  const active = mode === "always" || narrow;
  const shown = active && scrolled;
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

const ICON_BTN = "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border text-slate-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Find and Filter as icon buttons in the slim bar. Find goes back to the top and puts the cursor in the Find box. */
export function SlimTools({ findId, filterCount, onFilter }: { /** The id of the page's Find box. */ findId?: string; filterCount?: number; onFilter?: () => void }) {
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
        <button type="button" onClick={onFilter} aria-haspopup="dialog" className={cn(ICON_BTN, filterCount ? "border-primary-border bg-primary-soft text-primary-strong" : "border-input bg-white hover:bg-slate-50")} title="Filter" aria-label={filterCount ? `Filter, ${filterCount} ticked` : "Filter"} data-testid="slim-filter">
          <ListFilter className="h-[15px] w-[15px]" aria-hidden />
          {filterCount ? <span className="tabular absolute -top-1.5 -right-1.5 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10.5px] leading-4 font-semibold text-white">{filterCount}</span> : null}
        </button>
      ) : null}
    </>
  );
}

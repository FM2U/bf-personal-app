"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { CenteredWindow } from "@/components/app/window";

/**
 * The long-list rule for cards (Push B edits, 2026-11-03), app-wide: a card whose list can grow (Timeline, Deals,
 * People, Tasks, replies) shows the first 8 rows (newest or most urgent first, as the list is given), then
 * "Show all (N)". Show all opens a large centered window that scrolls, with a search box when there are more than
 * 15; Escape or the close mark closes it and the page stays where it was. With 8 or fewer there is no link.
 * Full-page lists are not capped.
 */
export const CARD_LIST_CAP = 8;
const SEARCH_FROM = 15;

/** How many of a list a card shows, and whether "Show all" is needed. */
export function capped<T>(items: readonly T[], cap = CARD_LIST_CAP): { shown: T[]; more: boolean } {
  return { shown: items.slice(0, cap), more: items.length > cap };
}

/** "newest 8 of 14": the note a card hint adds when its list is cut (empty when it is not). */
export function cappedNote(n: number, word = "newest", cap = CARD_LIST_CAP): string {
  return n > cap ? `${word} ${cap} of ${n}` : "";
}

export function ShowAll<T>({ items, render, title, sub, text, testId = "show-all", wrap, cap = CARD_LIST_CAP, className }: {
  items: readonly T[];
  /** One row; `inWindow` is true inside the window. */
  render: (item: T, i: number, inWindow: boolean) => React.ReactNode;
  /** The window's title ("Timeline · Transworld Business Advisors") and the quiet line under it. */
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** The words the search box matches on. */
  text?: (item: T) => string;
  testId?: string;
  /** Wraps the rows (the card's list container); the window uses the same wrapper. */
  wrap?: (rows: React.ReactNode, inWindow: boolean) => React.ReactNode;
  cap?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { shown, more } = capped(items, cap);
  const w = wrap ?? ((rows: React.ReactNode) => <>{rows}</>);
  const q = query.trim().toLowerCase();
  const all = q && text ? items.filter((x) => text(x).toLowerCase().includes(q)) : items;
  return (
    <>
      {w(shown.map((x, i) => render(x, i, false)), false)}
      {more ? (
        <div className={className ?? "flex justify-center px-[22px] pt-2 pb-1 text-[13px]"}>
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="font-medium text-primary-strong hover:underline" data-testid={`${testId}-link`} data-total={items.length}>
            Show all ({items.length})
          </button>
        </div>
      ) : null}
      {more ? (
        <CenteredWindow
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQuery("");
          }}
          title={title}
          sub={sub}
          testId={`${testId}-window`}
          footer={
            <>
              <span className="text-[12.5px] text-muted-foreground">Escape or × closes this and leaves the page where it was.</span>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex h-8 items-center rounded-[7px] border border-input bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50" data-testid={`${testId}-close`}>
                Close
              </button>
            </>
          }
        >
          {items.length > SEARCH_FROM && text ? (
            <span className="relative mb-4 block max-w-[320px]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in this list" aria-label="Find in this list" className="h-8 w-full rounded-[7px] border border-input bg-white pr-2.5 pl-[30px] text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid={`${testId}-search`} />
            </span>
          ) : null}
          <div className="-mx-[22px]" data-testid={`${testId}-all`}>
            {all.length ? w(all.map((x, i) => render(x, i, true)), true) : <p className="px-[22px] text-[13px] text-muted-foreground">Nothing matches.</p>}
          </div>
        </CenteredWindow>
      ) : null}
    </>
  );
}

"use client";

import { useRef } from "react";
import type { Tile } from "@/lib/work/tiles";
import { cn } from "@/lib/utils";

/**
 * The status tiles that work like tabs (approved 2026-11-04; the rules are in src/lib/work/tiles.ts): Work on now
 * (Overdue, Due today, Needs a next action), Contacts Follow-ups (Overdue, Due today, Next 7 days, Later, No date) and
 * To-dos (Today, Next 7 days, Later, Done today). Each tile: the number (24px semibold; Overdue's in red) on one line,
 * a plain 8px dot (electric blue, red for Overdue) and the small-caps label on the next; white, the app border, 12px
 * corners, about 70px tall; the selected tile has a cobalt outline. A tab list: the arrow keys move between tiles
 * (and select them), Home and End go to the first and last. `selected` null: no tile selected (By the AI).
 * TileChips is the same list as one row of chips for the slim pinned bar.
 */
type TilesProps<K extends string> = { tiles: readonly Tile<K>[]; selected: K | null; onPick: (k: K) => void; label: string; idPrefix: string; panelId?: string; testId?: string; className?: string };

function useTabKeys<K extends string>(tiles: readonly Tile<K>[], onPick: (k: K) => void, idPrefix: string) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = tiles.map((t) => t.key);
    const at = keys.findIndex((k) => `${idPrefix}-${k}` === (e.target as HTMLElement).id);
    if (at < 0) return;
    const to = e.key === "ArrowRight" ? (at + 1) % keys.length : e.key === "ArrowLeft" ? (at - 1 + keys.length) % keys.length : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(keys[to]);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-${keys[to]}`)?.focus());
  };
  return { ref, onKeyDown };
}

const dot = (red?: boolean) => <span className={cn("mt-[3px] h-2 w-2 shrink-0 rounded-full", red ? "bg-[#ef4444]" : "bg-electric")} aria-hidden data-dot={red ? "red" : "blue"} />;

export function StatusTiles<K extends string>({ tiles, selected, onPick, label, idPrefix, panelId, testId = "status-tiles", className }: TilesProps<K>) {
  const { ref, onKeyDown } = useTabKeys(tiles, onPick, idPrefix);
  const n = tiles.length;
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "grid gap-3 max-[700px]:gap-2.5",
        n === 3 && "grid-cols-3",
        n === 4 && "grid-cols-4 max-[700px]:grid-cols-2",
        n === 5 && "grid-cols-5 max-[700px]:grid-cols-6 max-[700px]:[&>*]:col-span-2 max-[700px]:[&>*:nth-child(n+4)]:col-span-3",
        className,
      )}
      data-testid={testId}
    >
      {tiles.map((t, i) => {
        const on = selected === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${idPrefix}-${t.key}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on || (selected === null && i === 0) ? 0 : -1}
            onClick={() => {
              if (!on) onPick(t.key);
            }}
            className={cn(
              "flex min-h-[70px] min-w-0 flex-col items-start rounded-xl border bg-white px-4 pt-[11px] pb-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none max-[700px]:px-3 max-[700px]:pt-2.5 max-[700px]:pb-[11px]",
              on ? "cursor-default border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border hover:border-input",
            )}
            data-testid="status-tile"
            data-key={t.key}
            data-count={t.count}
            data-selected={on ? "1" : "0"}
          >
            <span className={cn("tabular text-[24px] leading-[1.15] font-semibold", t.red ? "text-status-missed" : "text-slate-900")} data-testid="status-tile-count">
              {t.count}
            </span>
            <span className="mt-1.5 flex min-w-0 items-start gap-2 text-[11px] leading-[14px] font-semibold tracking-[0.09em] text-heading uppercase">
              {dot(t.red)}
              <span className="min-w-0">{t.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TileChips<K extends string>({ tiles, selected, onPick, label, idPrefix, panelId, testId = "slim-chips" }: TilesProps<K>) {
  const { ref, onKeyDown } = useTabKeys(tiles, onPick, idPrefix);
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex min-w-0 flex-wrap items-center gap-y-1" data-testid={testId}>
      {tiles.map((t, i) => {
        const on = selected === t.key;
        return (
          <span key={t.key} className="inline-flex items-center">
            <button
              type="button"
              role="tab"
              id={`${idPrefix}-${t.key}`}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on || (selected === null && i === 0) ? 0 : -1}
              onClick={() => {
                if (!on) onPick(t.key);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-[7px] rounded-full border px-[9px] text-[12.5px] font-medium whitespace-nowrap text-heading focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                on ? "cursor-default border-primary bg-white shadow-[0_0_0_1px_var(--primary)]" : "border-transparent hover:bg-slate-100",
              )}
              data-testid="slim-chip"
              data-key={t.key}
              data-selected={on ? "1" : "0"}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", t.red ? "bg-[#ef4444]" : "bg-electric")} aria-hidden />
              {t.label}
              <b className={cn("tabular font-semibold", t.red ? "text-status-missed" : "text-slate-900")}>{t.count}</b>
            </button>
            {i < tiles.length - 1 ? (
              <span className="px-px text-slate-400 select-none" aria-hidden>
                ·
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

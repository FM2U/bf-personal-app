"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { moneyShort } from "@/lib/work/buy-box";
import type { DealRow, StageGroup } from "@/lib/work/data";
import { DEAL_FILTERS, dealsLabel, filterCounts, groupByPhase, matchesFilter, matchesSearch, type DealFilter } from "@/lib/work/phases";
import { daysShort, dueLabel } from "@/lib/work/stages";
import { useSavedOpen } from "@/components/app/collapsible";
import { shortName } from "@/components/app/work/deal-list-row";
import { Due, Pill, waitTone } from "@/components/app/work/ui";
import { DISCLOSURE_PREFIX, writeSaved } from "@/lib/disclosure";
import { cn } from "@/lib/utils";

/**
 * Deals as three phase columns (approved 2026-10-30): Early, Evaluate, Decide, each a white card with its three
 * stages. The page title, the Work tabs, and the filter row stay at the top while the columns scroll on their own
 * (desktop); on the phone the columns stack. A stage heading collapses its stage; the collapsed set is remembered in
 * this browser. A filter other than All shows only the matching deals, opens every stage with a match and collapses
 * the rest; back on All the person's own collapsed set returns.
 */

/** The stages the person collapsed are saved under this key (the same storage as the other collapsible sections). */
const STORAGE_KEY = "work-deals-stages";

export function DealColumns({ header, groups, today }: { /** The title and the Work tabs (server-rendered), kept in the sticky block above the filters. */ header: React.ReactNode; groups: StageGroup[]; today: string }) {
  const [filter, setFilter] = useState<DealFilter>("all");
  const [query, setQuery] = useState("");
  /** The stages the person collapsed (All view), remembered per browser: saved choice, then this page view's changes. */
  const saved = useSavedOpen(DISCLOSURE_PREFIX + STORAGE_KEY);
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  /** Headings toggled while a filter is on (not remembered; cleared when the filter changes). */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const deals = useMemo(() => groups.flatMap((g) => g.deals), [groups]);
  const counts = useMemo(() => filterCounts(deals, today), [deals, today]);
  const phases = useMemo(() => groupByPhase(groups), [groups]);

  const shown = (d: DealRow) => matchesFilter(d, filter, today) && matchesSearch(d, query);

  const isCollapsed = (g: StageGroup): boolean => {
    if (!g.deals.length) return false;
    const name = g.stage.name;
    if (filter === "all") return (changed[name] ?? saved?.[name] ?? true) === false;
    if (name in overrides) return overrides[name];
    return !g.deals.some(shown);
  };

  const toggle = (name: string) => {
    if (filter === "all") {
      const open = (changed[name] ?? saved?.[name] ?? true) === false;
      writeSaved(STORAGE_KEY, { [name]: open });
      setChanged((prev) => ({ ...prev, [name]: open }));
    } else {
      const g = groups.find((x) => x.stage.name === name);
      const now = g ? isCollapsed(g) : false;
      setOverrides((prev) => ({ ...prev, [name]: !now }));
    }
  };

  const pick = (f: DealFilter) => {
    setFilter(f);
    setOverrides({});
  };

  return (
    <>
      <div className="z-10 bg-background lg:sticky lg:top-0 lg:-mt-6 lg:pt-6" data-testid="deals-sticky">
        {header}
        <div className="-mt-2 flex flex-wrap items-center gap-2 pb-4" data-testid="deals-filters">
          {DEAL_FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => pick(f.key)}
                className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", on ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-status-neutral hover:bg-slate-50")}
                aria-pressed={on}
                data-testid={`deals-filter-${f.key}`}
                data-count={counts[f.key]}
              >
                {f.label}
                <span className={cn("tabular ml-[5px] font-medium", on ? "text-primary-strong" : "text-slate-400")}>{counts[f.key]}</span>
              </button>
            );
          })}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a deal"
            aria-label="Find a deal"
            className="h-[30px] w-full rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:ml-auto sm:w-[200px]"
            data-testid="deals-search"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-[18px] lg:h-[calc(100vh-250px)] lg:min-h-[460px] lg:grid-cols-3" data-testid="deals-columns">
        {phases.map(({ phase, groups: own, count }) => (
          <section key={phase.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:overflow-y-auto" data-testid="deals-phase" data-phase={phase.key} data-count={count}>
            <div className="flex items-end justify-between gap-2.5 border-b-2 border-gold-rule bg-white px-[18px] pt-4 pb-3.5 lg:sticky lg:top-0 lg:z-[2]">
              <div className="min-w-0">
                <h2 className="text-[17px] leading-[1.2] font-bold tracking-[0.02em] text-slate-900">{phase.name}</h2>
                <p className="mt-[5px] text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-muted-foreground">{phase.tagline}</p>
              </div>
              <span className="tabular shrink-0 pb-0.5 text-[12.5px] text-muted-foreground" data-testid="phase-count">
                {dealsLabel(count)}
              </span>
            </div>
            <div className="pb-2">
              {own.map((g) => {
                const empty = !g.deals.length;
                const closed = isCollapsed(g);
                const hint = g.hint ? `Next by default: ${g.hint.charAt(0).toLowerCase()}${g.hint.slice(1)}` : undefined;
                const headingClass = cn(
                  "group mt-3 mb-1 flex w-full items-center gap-2 border-b py-1.5 pb-[7px] text-left text-[12.5px] font-medium tracking-[0.09em] uppercase select-none",
                  empty ? "cursor-default border-slate-100 text-slate-400" : "cursor-pointer border-gold-rule text-gold-strong",
                );
                const headingBody = (
                  <>
                    <svg viewBox="0 0 10 10" className={cn("h-[9px] w-3 shrink-0 text-gold-rule transition-transform group-hover:text-gold", closed && "-rotate-90", empty && "invisible")} aria-hidden>
                      <path d="M1 2.5h8L5 8z" fill="currentColor" />
                    </svg>
                    <span className="min-w-0 truncate">{g.stage.name}</span>
                    {empty ? (
                      <span className="tabular ml-auto text-xs font-normal tracking-normal normal-case">none</span>
                    ) : (
                      <span className="tabular ml-auto text-[12.5px] font-medium tracking-normal text-muted-foreground">{g.deals.length}</span>
                    )}
                  </>
                );
                return (
                  <div key={g.stage.name} className="px-[18px] pb-1.5" data-testid="stage-group" data-stage={g.stage.name} data-collapsed={closed ? "1" : "0"}>
                    {empty ? (
                      <div title={hint} className={headingClass} data-testid="stage-heading" data-stage={g.stage.name} data-count={0}>
                        {headingBody}
                      </div>
                    ) : (
                      <button type="button" onClick={() => toggle(g.stage.name)} aria-expanded={!closed} title={hint} className={headingClass} data-testid="stage-heading" data-stage={g.stage.name} data-count={g.deals.length}>
                        {headingBody}
                      </button>
                    )}
                    {!empty && !closed ? (
                      <div data-testid="stage-body">
                        {g.deals.map((deal) => (
                          <DealCard key={deal.id} deal={deal} today={today} hidden={!shown(deal)} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** One deal in a column: the name with the wait pill, the figure and location, the next action with its due, the key finding. */
function DealCard({ deal, today, hidden }: { deal: DealRow; today: string; hidden: boolean }) {
  const due = deal.nextAction ? dueLabel(deal.nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  const waiting = deal.waitLevel !== "none" && deal.status === "open";
  const figure = deal.earnings === null ? null : moneyShort(deal.earnings);
  return (
    <Link
      href={`/work/deals/${deal.id}`}
      className={cn("-mx-2.5 mt-0.5 mb-1.5 block min-w-0 rounded-[9px] border border-transparent px-2.5 py-[9px] hover:border-slate-100 hover:bg-[#fbfcfe]", hidden && "hidden")}
      data-testid="deal-row"
      data-deal={deal.id}
      data-hidden={hidden ? "1" : "0"}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-slate-900">{deal.name}</span>
        {waiting ? (
          <Pill tone={waitTone(deal.waitLevel)} className="tabular shrink-0" testId="deal-wait">
            {daysShort(deal.waitDays)}
            {deal.contactName ? ` · ${shortName(deal.contactName)}` : ""}
          </Pill>
        ) : !deal.nextAction ? (
          <Pill tone="amber" className="shrink-0" testId="needs-action">
            Needs a next action
          </Pill>
        ) : null}
      </div>
      <div className="mt-px text-xs text-muted-foreground">
        {figure ? (
          <>
            <b className="tabular mr-0.5 text-[13px] font-semibold text-slate-900">{figure}</b> {deal.earningsLabel === "SDE" ? "SDE" : "EBITDA"}
          </>
        ) : (
          <b className="mr-0.5 text-[13px] font-semibold text-slate-900">No figure</b>
        )}
        {deal.location ? ` · ${deal.location}` : ""}
      </div>
      {deal.nextAction ? (
        <div className="mt-1 text-[13px] text-slate-700">
          {deal.nextAction}
          {due ? (
            <span className="whitespace-nowrap">
              {" "}
              <Due text={`· ${waiting && due.tone === "later" ? "waiting" : due.text}`} tone={waiting && due.tone === "later" ? "none" : due.tone} />
              {deal.nextActionMinutes ? <Due text={`· ${deal.nextActionMinutes} min`} tone={due.tone} className="ml-1" /> : null}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 text-[13px] font-medium text-status-soon" data-testid="no-next-action">
          No next action set
        </div>
      )}
      {deal.keyFinding ? <div className="mt-[3px] text-[12.5px] text-muted-foreground italic">{deal.keyFinding}</div> : null}
    </Link>
  );
}

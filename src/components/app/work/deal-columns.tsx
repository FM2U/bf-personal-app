"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { moneyShort } from "@/lib/work/buy-box";
import type { DealRow, StageGroup } from "@/lib/work/data";
import { DEAL_FILTERS, dealsLabel, filterCounts, groupByPhase, matchesFilter, matchesSearch, type DealFilter } from "@/lib/work/phases";
import { daysShort, dueLabel } from "@/lib/work/stages";
import { shortName } from "@/components/app/work/deal-list-row";
import { useSections } from "@/components/app/work/sections";
import { Due, FilterRow, Pill, PINNED_CARD_HEADER, PinnedBlock, SectionHeading, waitTone } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Deals as three phase columns (approved 2026-10-30, Collapse all and the filter in the address added 2026-10-31):
 * Early, Evaluate, Decide, each a white card with its three stages. The page title, the Work tabs, and the filter row
 * stay at the top while the columns scroll on their own (desktop); on the phone the columns stack. A stage heading
 * collapses its stage; the collapsed set is remembered in this browser. A filter other than All shows only the
 * matching deals, opens every stage with a match and collapses the rest; back on All the person's own collapsed set
 * returns. "Collapse all" at the right end of the filter row collapses every stage with deals (then reads "Expand
 * all"). Home's Deals at a glance opens this page with a filter preselected (?filter=wait).
 */

/** The stages the person collapsed are saved under this key (the same storage as the other collapsible sections). */
const STORAGE_KEY = "work-deals-stages";

export function DealColumns({ header, groups, today, initialFilter = "all" }: { /** The title and the Work tabs (server-rendered), kept in the sticky block above the filters. */ header: React.ReactNode; groups: StageGroup[]; today: string; /** The filter named in the address (from Home). */ initialFilter?: DealFilter }) {
  const [filter, setFilter] = useState<DealFilter>(initialFilter);
  const [query, setQuery] = useState("");

  const deals = useMemo(() => groups.flatMap((g) => g.deals), [groups]);
  const counts = useMemo(() => filterCounts(deals, today), [deals, today]);
  const phases = useMemo(() => groupByPhase(groups), [groups]);

  const shown = (d: DealRow) => matchesFilter(d, filter, today) && matchesSearch(d, query);
  // The filter decides which stages open; Find a deal narrows the cards inside them.
  const states = useMemo(() => groups.map((g) => ({ name: g.stage.name, count: g.deals.length, hasMatch: g.deals.some((d) => matchesFilter(d, filter, today)) })), [groups, filter, today]);
  const sections = useSections(STORAGE_KEY, states, filter !== "all");

  const pick = (f: DealFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };

  return (
    <>
      <PinnedBlock testId="deals-sticky">
        {header}
        <FilterRow prefix="deals" filters={DEAL_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find a deal" collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </PinnedBlock>

      <div className="grid grid-cols-1 items-stretch gap-[18px] lg:h-[calc(100vh-272px)] lg:min-h-[460px] lg:grid-cols-3" data-testid="deals-columns">
        {phases.map(({ phase, groups: own, count }) => (
          <section key={phase.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:overflow-y-auto" data-testid="deals-phase" data-phase={phase.key} data-count={count}>
            <div className={cn("flex items-end justify-between gap-2.5 px-[18px] pt-4 pb-3.5", PINNED_CARD_HEADER, "border-b-2")} data-pinned="card">
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
                const closed = sections.isCollapsed(g.stage.name);
                const hint = g.hint ? `Next by default: ${g.hint.charAt(0).toLowerCase()}${g.hint.slice(1)}` : undefined;
                return (
                  <div key={g.stage.name} className="px-[18px] pb-1.5" data-testid="stage-group" data-stage={g.stage.name} data-collapsed={closed ? "1" : "0"}>
                    <SectionHeading name={g.stage.name} count={g.deals.length} collapsed={closed} onToggle={() => sections.toggle(g.stage.name)} title={hint} testId="stage-heading" dataAttrs={{ "data-stage": g.stage.name }} countRight />
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
      {deal.keyFinding ? <div className="mt-[3px] line-clamp-2 text-[12.5px] text-muted-foreground italic">{deal.keyFinding}</div> : null}
    </Link>
  );
}

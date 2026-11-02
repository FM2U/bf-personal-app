"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { date as fmtDate } from "@/lib/format";
import { moneyShort } from "@/lib/work/buy-box";
import type { DealRow, StageGroup } from "@/lib/work/data";
import { DEAL_FILTERS, dealsLabel, filterCounts, groupByPhase, matchesFilter, matchesSearch, PHASES, type DealFilter, type FilterableDeal, type PhaseDef } from "@/lib/work/phases";
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
 * Batch B2: the same columns serve Job search with two phases (PhaseColumns, its own card per row).
 */

/** The stages the person collapsed are saved under this key (the same storage as the other collapsible sections). */
const STORAGE_KEY = "work-deals-stages";

export function DealColumns({ header, groups, today, initialFilter = "all" }: { /** The title and the Work tabs (server-rendered), kept in the sticky block above the filters. */ header: React.ReactNode; groups: StageGroup[]; today: string; /** The filter named in the address (from Home). */ initialFilter?: DealFilter }) {
  return <PhaseColumns header={header} groups={groups} today={today} initialFilter={initialFilter} phases={PHASES} storageKey={STORAGE_KEY} prefix="deals" placeholder="Find a deal" card={(deal, hidden) => <DealCard deal={deal} today={today} hidden={hidden} />} />;
}

export type ColumnItem = FilterableDeal & { id: string; stageName: string | null; searchText?: string | null };

/** The phase columns for any pipeline: the groups (one per open stage, in order), the phases that hold them, and how to draw a row. */
export function PhaseColumns<T extends ColumnItem>({ header, before, groups, today, initialFilter = "all", phases, storageKey, prefix, placeholder, card, noun = "deal", gridClassName, testId = "deals-columns" }: {
  header: React.ReactNode;
  /** A card between the pinned block and the columns (the Add form when open). */
  before?: React.ReactNode;
  groups: { stage: { name: string }; hint: string | null; deals: T[] }[];
  today: string;
  initialFilter?: DealFilter;
  phases: readonly PhaseDef[];
  storageKey: string;
  prefix: string;
  placeholder: string;
  card: (item: T, hidden: boolean) => React.ReactNode;
  /** "deal" ("4 deals") or "open" ("3 open") in the phase header count. */
  noun?: "deal" | "open";
  gridClassName?: string;
  testId?: string;
}) {
  const [filter, setFilter] = useState<DealFilter>(initialFilter);
  const [query, setQuery] = useState("");

  const all = useMemo(() => groups.flatMap((g) => g.deals), [groups]);
  const counts = useMemo(() => filterCounts(all, today), [all, today]);
  const phased = useMemo(() => groupByPhase(groups, phases), [groups, phases]);

  const shown = (d: T) => matchesFilter(d, filter, today) && matchesSearch(d, query);
  // The filter decides which stages open; Find narrows the cards inside them.
  const states = useMemo(() => groups.map((g) => ({ name: g.stage.name, count: g.deals.length, hasMatch: g.deals.some((d) => matchesFilter(d, filter, today)) })), [groups, filter, today]);
  const sections = useSections(storageKey, states, filter !== "all");

  const pick = (f: DealFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };

  return (
    <>
      <PinnedBlock testId={`${prefix}-sticky`}>
        {header}
        <FilterRow prefix={prefix} filters={DEAL_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder={placeholder} collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </PinnedBlock>
      {before ? <div className="mb-[18px]">{before}</div> : null}

      <div className={cn("grid grid-cols-1 items-stretch gap-[18px] lg:h-[calc(100vh-272px)] lg:min-h-[460px]", gridClassName ?? "lg:grid-cols-3")} data-testid={testId}>
        {phased.map(({ phase, groups: own, count }) => (
          <section key={phase.key} className="flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:overflow-y-auto" data-testid={`${prefix}-phase`} data-phase={phase.key} data-count={count}>
            <div className={cn("flex items-end justify-between gap-2.5 px-[18px] pt-4 pb-3.5", PINNED_CARD_HEADER, "border-b-2")} data-pinned="card">
              <div className="min-w-0">
                <h2 className="text-[17px] leading-[1.2] font-bold tracking-[0.02em] text-slate-900">{phase.name}</h2>
                <p className="mt-[5px] text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-muted-foreground">{phase.tagline}</p>
              </div>
              <span className="tabular shrink-0 pb-0.5 text-[12.5px] text-muted-foreground" data-testid="phase-count">
                {dealsLabel(count, noun)}
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
                    {!empty && !closed ? <div data-testid="stage-body">{g.deals.map((item) => <span key={item.id} className="contents">{card(item, !shown(item))}</span>)}</div> : null}
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

/** The card of one row in a column: the link, the shared hover (.row-hover, Edit batch C round 3), and the hidden state shared by deals, opportunities, and consulting items. */
export function ColumnCard({ href, hidden, children, testId = "deal-row", id }: { href: string; hidden: boolean; children: React.ReactNode; testId?: string; id: string }) {
  return (
    <Link href={href} className={cn("row-hover -mx-2.5 mt-0.5 mb-1.5 block min-w-0 border border-transparent px-2.5 py-[9px]", hidden && "hidden")} data-testid={testId} data-deal={id} data-hidden={hidden ? "1" : "0"}>
      {children}
    </Link>
  );
}

/** The next action line of a column card: the text, the due (or "waiting"), the minutes; or "No next action set" in amber. */
export function ColumnAction({ nextAction, nextActionDue, nextActionMinutes, waiting, today }: { nextAction: string | null; nextActionDue: string | null; nextActionMinutes: number | null; waiting: boolean; today: string }) {
  const due = nextAction ? dueLabel(nextActionDue, today, (x) => fmtDate(x, "MMM d")) : null;
  if (!nextAction) {
    return (
      <div className="mt-1 text-[13px] font-medium text-status-soon" data-testid="no-next-action">
        No next action set
      </div>
    );
  }
  return (
    <div className="mt-1 text-[13px] text-slate-700">
      {nextAction}
      {due ? (
        <span className="whitespace-nowrap">
          {" "}
          <Due text={`· ${waiting && due.tone === "later" ? "waiting" : due.text}`} tone={waiting && due.tone === "later" ? "none" : due.tone} />
          {nextActionMinutes ? <Due text={`· ${nextActionMinutes} min`} tone={due.tone} className="ml-1" /> : null}
        </span>
      ) : null}
    </div>
  );
}

/** One deal in a column: the name with the wait pill, the figure and location, the next action with its due, the key finding. */
function DealCard({ deal, today, hidden }: { deal: DealRow; today: string; hidden: boolean }) {
  const waiting = deal.waitLevel !== "none" && deal.status === "open";
  const figure = deal.earnings === null ? null : moneyShort(deal.earnings);
  return (
    <ColumnCard href={`/work/deals/${deal.id}`} hidden={hidden} id={deal.id}>
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
      <ColumnAction nextAction={deal.nextAction} nextActionDue={deal.nextActionDue} nextActionMinutes={deal.nextActionMinutes} waiting={waiting} today={today} />
      {deal.keyFinding ? <div className="mt-[3px] line-clamp-2 text-[12.5px] text-muted-foreground italic">{deal.keyFinding}</div> : null}
    </ColumnCard>
  );
}

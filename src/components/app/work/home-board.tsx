"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { resetWaiting } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import type { DealRow, ListingTile, WorkNowData } from "@/lib/work/data";
import { HOME_SECTIONS, homeFilterCounts, homeRowShown, nextActionSections, waitSections, type HomeRowRef } from "@/lib/work/home";
import { compareNames } from "@/lib/work/names";
import { DEAL_FILTERS, type DealFilter } from "@/lib/work/phases";
import { followUpDraft, STAGE_DEFAULTS, type WorkStageName } from "@/lib/work/stages";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { useSections } from "@/components/app/work/sections";
import { FilterRow, Line1, Line2, Name, Pill, ProgressMark, RowShell, SectionHeading, What, WorkCard } from "@/components/app/work/ui";
import { WaitingRow } from "@/components/app/work/waiting-row";
import { cn } from "@/lib/utils";

/**
 * Home (Work on now) as the bento of mockup v6 (approved 2026-10-31). The title, the date, the Work tabs, and the
 * filter row (All, Due today, Waiting on someone, Needs a next action, Find, Collapse all) stay at the top. Left two
 * thirds: the Next actions card with the sections Overdue, Due today, and Needs a next action. Right third, stacked:
 * Waiting on someone (Over and Under the threshold, Follow up), the Screen listings tile (count, newest three, a
 * link), and Deals at a glance (Early, Evaluate, Decide, Waiting over the threshold, Needs a next action; each a link
 * to Deals with that filter on). On desktop the two columns scroll on their own with pinned card titles; on the
 * phone everything stacks and the page scrolls as one. A filter hides the rows that do not match, opens the sections
 * with a match and collapses the rest; the sections the person collapses are remembered in this browser.
 */
const STORAGE_KEY = "work-home-sections";

export function HomeBoard({ header, data, composes }: { /** The title, the date, and the Work tabs (server-rendered). */ header: React.ReactNode; data: WorkNowData; /** The email setup per waiting deal (Follow up). */ composes: Record<string, ComposeSetup> }) {
  const [filter, setFilter] = useState<DealFilter>("all");
  const [query, setQuery] = useState("");
  /** Deals followed up on this visit: the row keeps its "Followed up" line after it moves under the threshold. */
  const [followedUp, setFollowedUp] = useState<Record<string, boolean>>({});
  /** The deal whose Follow up editor is open (held here, so the editor survives the row moving after the send). */
  const [followUp, setFollowUp] = useState<DealRow | null>(null);
  const { deals, today, threshold } = data;

  const byDue = (a: DealRow, b: DealRow) => ((a.nextActionDue ?? "") < (b.nextActionDue ?? "") ? -1 : (a.nextActionDue ?? "") > (b.nextActionDue ?? "") ? 1 : compareNames(a.name, b.name));
  const actions = useMemo(() => {
    const s = nextActionSections(deals, today);
    return { overdue: [...s.overdue].sort(byDue), today: [...s.today].sort(byDue), needs: [...s.needs].sort((a, b) => compareNames(a.name, b.name)) };
  }, [deals, today]);
  const waiting = useMemo(() => waitSections(deals, threshold).map((w) => ({ ...w, deals: [...w.deals].sort((a, b) => b.waitDays - a.waitDays || compareNames(a.name, b.name)) })), [deals, threshold]);

  const rows = useMemo<HomeRowRef[]>(() => [...[...actions.overdue, ...actions.today, ...actions.needs].map((deal) => ({ card: "actions" as const, deal })), ...waiting.flatMap((w) => w.deals.map((deal) => ({ card: "waiting" as const, deal })))], [actions, waiting]);
  const counts = useMemo(() => homeFilterCounts(rows, today), [rows, today]);
  const shown = (d: DealRow) => homeRowShown(d, filter, query, today);

  // The filter decides which sections open; Find narrows the rows inside them.
  const states = useMemo(
    () => [
      ...HOME_SECTIONS.map((s) => ({ name: s.label, count: actions[s.key].length, hasMatch: actions[s.key].some((d) => homeRowShown(d, filter, "", today)) })),
      ...waiting.map((w) => ({ name: w.label, count: w.deals.length, hasMatch: w.deals.some((d) => homeRowShown(d, filter, "", today)) })),
    ],
    [actions, waiting, filter, today],
  );
  const sections = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: DealFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };

  const actionCount = actions.overdue.length + actions.today.length + actions.needs.length;
  const waitCount = waiting.reduce((s, w) => s + w.deals.length, 0);

  return (
    <>
      <div className="z-10 bg-background lg:sticky lg:top-0 lg:-mt-6 lg:pt-6" data-testid="home-sticky">
        {header}
        <FilterRow prefix="home" filters={DEAL_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find" collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </div>

      <div className="grid grid-cols-1 items-start gap-[18px] lg:h-[calc(100vh-250px)] lg:min-h-[460px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch" data-testid="home-bento">
        <WorkCard id="now-actions" title="Next actions" count={actionCount} sub="Due today or earlier, soonest first" testId="now-actions" pinned scroll className="lg:h-full">
          {actionCount ? (
            <div className="px-[22px] pt-1 pb-3">
              {HOME_SECTIONS.map((s) => {
                const list = actions[s.key];
                const closed = sections.isCollapsed(s.label);
                return (
                  <div key={s.key} data-testid="home-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
                    <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => sections.toggle(s.label)} />
                    {list.length && !closed ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                        {list.map((deal) => (
                          <div key={deal.id} className={cn("border-t border-slate-100 first:border-t-0", !shown(deal) && "hidden")} data-testid="home-row" data-hidden={shown(deal) ? "0" : "1"}>
                            {s.key === "needs" ? <NeedsActionRow deal={deal} /> : <NextActionRow deal={deal} today={today} />}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="now-actions-empty">
              Nothing is due today and every deal has a next action. Deals lists every next action.
            </p>
          )}
        </WorkCard>

        <div className="flex min-w-0 flex-col gap-[18px] lg:h-full lg:overflow-y-auto" data-testid="home-right">
          <WorkCard id="now-wait" title="Waiting on someone" count={waitCount} sub={`Amber at ${threshold} days, red at ${threshold * 2}`} testId="now-wait" pinned>
            {waitCount ? (
              <div className="px-[22px] pt-1 pb-3">
                {waiting.map((w) => {
                  const closed = sections.isCollapsed(w.label);
                  return (
                    <div key={w.key} data-testid="home-section" data-section={`wait-${w.key}`} data-collapsed={closed ? "1" : "0"}>
                      <SectionHeading name={w.label} count={w.deals.length} collapsed={closed} onToggle={() => sections.toggle(w.label)} />
                      {w.deals.length && !closed ? (
                        <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                          {w.deals.map((deal) => (
                            <div key={deal.id} className={cn("border-t border-slate-100 first:border-t-0", !shown(deal) && "hidden")} data-testid="home-row" data-hidden={shown(deal) ? "0" : "1"}>
                              <WaitingRow deal={deal} followedUp={!!followedUp[deal.id]} onFollowUp={() => setFollowUp(deal)} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="now-wait-empty">
                Nobody is keeping you waiting.
              </p>
            )}
          </WorkCard>

          <ListingsTile count={data.toScreen} listings={data.listings} />
          <GlanceTile glance={data.glance} threshold={threshold} />
        </div>
      </div>
      {followUp && composes[followUp.id] ? (
        <ComposeEmailDialog
          key={followUp.id}
          setup={composes[followUp.id]}
          open
          onOpenChange={(o) => {
            if (!o) setFollowUp(null);
          }}
          initial={followUpDraft({ dealName: followUp.name, waitingOn: followUp.waitingOn, contactName: followUp.contactName, days: followUp.waitDays })}
          onSent={async () => {
            await resetWaiting(followUp.id);
            setFollowedUp((m) => ({ ...m, [followUp.id]: true }));
          }}
        />
      ) : null}
    </>
  );
}

/** A deal with no next action: the stage default as a hint and a link to set one on the deal page. */
function NeedsActionRow({ deal }: { deal: DealRow }) {
  const def = deal.stageName && (STAGE_DEFAULTS as Record<string, { hint: string }>)[deal.stageName as WorkStageName]?.hint;
  return (
    <RowShell
      testId="needs-action-row"
      dataAttrs={{ "data-deal": deal.id }}
      right={
        <>
          {def ? <span className="text-xs text-muted-foreground">Stage default: {def}</span> : null}
          <Link href={`/work/deals/${deal.id}`} className="inline-flex h-[30px] items-center rounded-[7px] border border-primary bg-primary px-[11px] text-[12.5px] font-medium whitespace-nowrap text-white hover:border-primary-hover hover:bg-primary-hover" data-testid="set-next-action">
            Set next action
          </Link>
        </>
      }
    >
      <Line1>
        <ProgressMark stage={deal.stageName} />
        <Link href={`/work/deals/${deal.id}`} className="hover:underline">
          <Name>{deal.name}</Name>
        </Link>
        <What>
          {deal.stageName}
          {deal.whatItDoes || deal.location ? ` · ${[deal.whatItDoes, deal.location].filter(Boolean).join(", ")}` : ""}
        </What>
      </Line1>
      <Line2 className="font-medium text-status-soon">No next action set</Line2>
    </RowShell>
  );
}

/** The Screen listings tile: the count to screen, the newest three names, and the link. */
function ListingsTile({ count, listings }: { count: number; listings: ListingTile[] }) {
  return (
    <WorkCard title="Screen listings" hint="Newest first" testId="home-listings">
      <div className="px-[22px] pt-3 pb-1 text-[13px] text-muted-foreground">
        <b className="tabular mr-1 text-[22px] leading-none font-semibold text-slate-900" data-testid="home-to-screen">
          {count}
        </b>
        to screen
      </div>
      <div className="flex flex-col">
        {listings.map((l) => (
          <Link key={l.id} href="/work/listings" className="flex flex-col gap-0.5 border-t border-slate-100 px-[22px] py-[9px] hover:bg-[#fbfcfe]" data-testid="home-listing">
            <Name>{l.name}</Name>
            {l.meta ? <span className="text-[12.5px] text-muted-foreground italic">{l.meta}</span> : null}
          </Link>
        ))}
      </div>
      <div className="px-[22px] pt-2 pb-4">
        <Link href="/work/listings" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-listings">
          {count ? "Open Screen listings" : "Add a listing"}
        </Link>
      </div>
    </WorkCard>
  );
}

/** Deals at a glance: one row per phase and two amber rows, each a link to Deals with that filter on. */
function GlanceTile({ glance, threshold }: { glance: WorkNowData["glance"]; threshold: number }) {
  const rows: { label: string; n: number; href: string; warn?: boolean; key: string }[] = [
    { key: "early", label: "Early", n: glance.early, href: "/work/deals" },
    { key: "evaluate", label: "Evaluate", n: glance.evaluate, href: "/work/deals" },
    { key: "decide", label: "Decide", n: glance.decide, href: "/work/deals" },
    { key: "wait", label: `Waiting over ${threshold} days`, n: glance.waitingOver, href: "/work/deals?filter=wait", warn: true },
    { key: "needs", label: "Needs a next action", n: glance.needsAction, href: "/work/deals?filter=needs", warn: true },
  ];
  return (
    <WorkCard title="Deals at a glance" hint={`${glance.active} active`} testId="home-glance">
      <div className="flex flex-col pt-1 pb-2">
        {rows.map((r) => (
          <Link key={r.key} href={r.href} className="flex items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-[9px] text-sm text-slate-900 first:border-t-0 hover:bg-[#fbfcfe]" data-testid="glance-row" data-key={r.key} data-count={r.n}>
            <span>{r.label}</span>
            <Pill tone={r.warn && r.n > 0 ? "amber" : "gray"} className="tabular min-w-[32px] justify-center">
              {r.n}
            </Pill>
          </Link>
        ))}
      </div>
    </WorkCard>
  );
}

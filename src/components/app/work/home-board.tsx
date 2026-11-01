"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetWaiting } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import type { DealRow, ListingTile, WorkNowData } from "@/lib/work/data";
import { HOME_SECTIONS, homeFilterCounts, homeRowShown, nextActionSections, waitSections, type HomeRowRef } from "@/lib/work/home";
import { compareNames } from "@/lib/work/names";
import { contactKindLabel, matchesPersonSearch, overdueLabel } from "@/lib/work/outreach";
import type { PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { DEAL_FILTERS, type DealFilter } from "@/lib/work/phases";
import { followUpDraft, STAGE_DEFAULTS, type WorkStageName } from "@/lib/work/stages";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { OutreachActionRow, PurposePills } from "@/components/app/work/person-row";
import { useSections } from "@/components/app/work/sections";
import { FilterRow, Line1, Line2, Name, Pill, PinnedBlock, ProgressMark, RowButton, RowShell, SectionHeading, TargetBar, What, WorkCard } from "@/components/app/work/ui";
import { WaitingRow } from "@/components/app/work/waiting-row";
import { cn } from "@/lib/utils";

/**
 * Home (Work on now) as the bento of mockup v6 (approved 2026-10-31). The title, the date, the Work tabs, and the
 * filter row (All, Due today, Waiting on someone, Needs a next action, Find, Collapse all) stay at the top. Left two
 * thirds: the Next actions card with the sections Overdue, Due today, and Needs a next action. Right third, stacked:
 * Waiting on someone (Over and Under the threshold, Follow up), the Screen listings tile (count, newest three, a
 * link), Outreach (batch B: the weekly counter, up to three people due today with Email and Log a call, a link),
 * Job search (batch B2 fills it), and Deals at a glance (Early, Evaluate, Decide, Waiting over the threshold, Needs
 * a next action; each a link to Deals with that filter on). Next actions also lists the people whose follow-up is
 * due today or overdue, with an Outreach lane pill. On desktop the two columns scroll on their own with pinned card titles; on the
 * phone everything stacks and the page scrolls as one. A filter hides the rows that do not match, opens the sections
 * with a match and collapses the rest; the sections the person collapses are remembered in this browser.
 */
const STORAGE_KEY = "work-home-sections";

export function HomeBoard({ header, data, composes, personComposes }: { /** The title, the date, and the Work tabs (server-rendered). */ header: React.ReactNode; data: WorkNowData; /** The email setup per waiting deal (Follow up). */ composes: Record<string, ComposeSetup>; /** The email setup per person on the Outreach tile. */ personComposes: Record<string, ComposeSetup> }) {
  const router = useRouter();
  const [filter, setFilter] = useState<DealFilter>("all");
  const [query, setQuery] = useState("");
  const [personEmail, setPersonEmail] = useState<PersonRowData | null>(null);
  const [personCall, setPersonCall] = useState<PersonRowData | null>(null);
  const [personLogged, setPersonLogged] = useState<Record<string, string>>({});
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
  // The people due today or overdue join Next actions (Overdue and Due today); they count under All and Due today.
  const people = useMemo(() => ({ overdue: data.outreach.due.filter((p) => (p.nextFollowUp ?? "") < today), today: data.outreach.due.filter((p) => p.nextFollowUp === today) }), [data.outreach.due, today]);
  const counts = useMemo(() => {
    const c = homeFilterCounts(rows, today);
    const n = people.overdue.length + people.today.length;
    return { ...c, all: c.all + n, today: c.today + n };
  }, [rows, today, people]);
  const shown = (d: DealRow) => homeRowShown(d, filter, query, today);
  const personShown = (p: PersonRowData) => (filter === "all" || filter === "today") && matchesPersonSearch(p, query);

  // The filter decides which sections open; Find narrows the rows inside them.
  const states = useMemo(
    () => [
      ...HOME_SECTIONS.map((s) => {
        const ppl = s.key === "overdue" ? people.overdue : s.key === "today" ? people.today : [];
        return { name: s.label, count: actions[s.key].length + ppl.length, hasMatch: actions[s.key].some((d) => homeRowShown(d, filter, "", today)) || (ppl.length > 0 && (filter === "all" || filter === "today")) };
      }),
      ...waiting.map((w) => ({ name: w.label, count: w.deals.length, hasMatch: w.deals.some((d) => homeRowShown(d, filter, "", today)) })),
    ],
    [actions, waiting, filter, today, people],
  );
  const sections = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: DealFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };

  const actionCount = actions.overdue.length + actions.today.length + actions.needs.length + people.overdue.length + people.today.length;
  const waitCount = waiting.reduce((s, w) => s + w.deals.length, 0);

  return (
    <>
      <PinnedBlock testId="home-sticky">
        {header}
        <FilterRow prefix="home" filters={DEAL_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find" collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </PinnedBlock>

      <div className="grid grid-cols-1 items-start gap-[18px] lg:h-[calc(100vh-272px)] lg:min-h-[460px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch" data-testid="home-bento">
        <WorkCard id="now-actions" title="Next actions" count={actionCount} sub="Due today or earlier, soonest first" testId="now-actions" pinned scroll className="lg:h-full">
          {actionCount ? (
            <div className="px-[22px] pt-1 pb-3">
              {HOME_SECTIONS.map((s) => {
                const list = actions[s.key];
                const ppl = s.key === "overdue" ? people.overdue : s.key === "today" ? people.today : [];
                const closed = sections.isCollapsed(s.label);
                return (
                  <div key={s.key} data-testid="home-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
                    <SectionHeading name={s.label} count={list.length + ppl.length} collapsed={closed} onToggle={() => sections.toggle(s.label)} />
                    {(list.length || ppl.length) && !closed ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                        {list.map((deal) => (
                          <div key={deal.id} className={cn("border-t border-slate-100 first:border-t-0", !shown(deal) && "hidden")} data-testid="home-row" data-hidden={shown(deal) ? "0" : "1"}>
                            {s.key === "needs" ? <NeedsActionRow deal={deal} /> : <NextActionRow deal={deal} today={today} />}
                          </div>
                        ))}
                        {ppl.map((p) => (
                          <div key={p.id} className={cn("border-t border-slate-100 first:border-t-0", !personShown(p) && "hidden")} data-testid="home-row" data-lane="outreach" data-hidden={personShown(p) ? "0" : "1"}>
                            <OutreachActionRow person={p} today={today} />
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

          <OutreachTile outreach={data.outreach} today={today} logged={personLogged} onEmail={setPersonEmail} onCall={setPersonCall} />
          <JobSearchTile />
          <ListingsTile count={data.toScreen} listings={data.listings} />
          <GlanceTile glance={data.glance} threshold={threshold} />
        </div>
      </div>
      {personEmail && personComposes[personEmail.id] ? (
        <ComposeEmailDialog
          key={`p-${personEmail.id}`}
          setup={personComposes[personEmail.id]}
          open
          onOpenChange={(o) => {
            if (!o) setPersonEmail(null);
          }}
          onSent={() => {
            setPersonLogged((m) => ({ ...m, [personEmail.id]: "Email sent and logged" }));
            router.refresh();
          }}
        />
      ) : null}
      {personCall ? (
        <LogCallDrawer
          target={{ contactId: personCall.id, dealId: null, who: personCall.name, from: "From Home", currentDate: personCall.nextFollowUp }}
          today={today}
          tz={data.tz}
          open
          onOpenChange={(o) => {
            if (!o) setPersonCall(null);
          }}
          onSaved={(r) => {
            setPersonLogged((m) => ({ ...m, [personCall.id]: `Call logged, ${r.minutes} min` }));
            setTimeout(() => router.refresh(), 1200);
          }}
        />
      ) : null}
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

/** The Outreach tile (batch B): the weekly counter with its gold bar, up to three people due today with Email and Log a call, the link, and the overdue count. */
function OutreachTile({ outreach, today, logged, onEmail, onCall }: { outreach: WorkNowData["outreach"]; today: string; logged: Record<string, string>; onEmail: (p: PersonRowData) => void; onCall: (p: PersonRowData) => void }) {
  return (
    <WorkCard title="Outreach" hint={`${outreach.due.length} due`} testId="home-outreach" pinned>
      <TargetBar count={outreach.counter.count} target={outreach.counter.target} pct={outreach.counter.pct} className="py-2.5" testId="home-outreach-counter" />
      <div className="px-[22px] pb-1">
        <SectionHeading name="Due for follow-up today" count={outreach.dueToday.length} collapsed={false} className="mt-0" />
      </div>
      <div className="flex flex-col">
        {outreach.dueToday.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5 border-t border-slate-100 px-[22px] py-[9px]" data-testid="home-outreach-row" data-person={p.id}>
            <Line1>
              <Link href={`/work/outreach/${p.id}`} className="hover:underline">
                <Name>{p.name}</Name>
              </Link>
              <PurposePills purposes={p.purposes.slice(0, 1)} />
            </Line1>
            <Line2 className="mt-0 text-[12.5px] text-slate-600">{[p.organization, p.followUpFor ?? p.note].filter(Boolean).join(" · ")}</Line2>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {logged[p.id] ? (
                <Pill tone="green" testId="person-logged">
                  {logged[p.id]}
                </Pill>
              ) : (
                <span className="text-xs text-muted-foreground" data-testid="home-outreach-last">
                  {p.lastContactOn ? `Last: ${contactKindLabel(p.lastContactKind)} ${p.lastContactOn === today ? "today" : fmtDate(p.lastContactOn, "MMM d")}` : "Not contacted yet"}
                </span>
              )}
              <div className="flex gap-1.5">
                <RowButton onClick={() => onEmail(p)} className="h-7 px-2.5 text-xs" data-testid="home-person-email">
                  Email
                </RowButton>
                <RowButton onClick={() => onCall(p)} className="h-7 px-2.5 text-xs" data-testid="home-person-log-call">
                  Log a call
                </RowButton>
              </div>
            </div>
          </div>
        ))}
        {!outreach.dueToday.length ? <p className="border-t border-slate-100 px-[22px] py-3 text-[13px] text-muted-foreground">Nobody is due today.</p> : null}
      </div>
      <div className="flex items-center gap-2.5 border-t border-slate-100 px-[22px] pt-2.5 pb-4">
        <Link href="/work/outreach" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-outreach">
          Open Outreach
        </Link>
        {outreach.overdue ? (
          <span className="text-xs font-medium text-status-missed" data-testid="home-outreach-overdue">
            {overdueLabel(outreach.overdue)}
          </span>
        ) : null}
      </div>
    </WorkCard>
  );
}

/** The Job search tile (batch B): next conversation, next interview, counts. Filled in batch B2. */
function JobSearchTile() {
  return (
    <WorkCard title="Job search" hint="Comes with the next update" testId="home-jobs" pinned>
      <div className="flex flex-col pt-1 pb-2">
        {["Next conversation", "Next interview", "Open opportunities", "Needs a next action"].map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-[9px] text-sm text-slate-900 first:border-t-0" data-testid="jobs-row">
            <span>{k}</span>
            <Pill tone="quiet">Soon</Pill>
          </div>
        ))}
      </div>
      <div className="px-[22px] pt-1 pb-4">
        <Link href="/work/jobs" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-jobs">
          Open Job search
        </Link>
      </div>
    </WorkCard>
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

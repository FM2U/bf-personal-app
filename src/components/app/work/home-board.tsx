"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { aiOrderToday } from "@/app/actions/ask-ai";
import { resetWaiting } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { readRaw } from "@/lib/disclosure";
import { date as fmtDate } from "@/lib/format";
import type { AskContext } from "@/lib/work/ask-ai";
import type { DealRow, ListingTile, WorkNowData } from "@/lib/work/data";
import { waitSections } from "@/lib/work/home";
import type { HomeData } from "@/lib/work/home-data";
import { actionKey, applyAiOrder, compareActions, laneSectionOf, matchesActionSearch, ORDER_STORAGE_KEY, orderedAtLabel, parseOrderChoice, type AiOrder, type HomeAction, type Lane, type LaneSectionKey, type OrderChoice } from "@/lib/work/lanes";
import { compareNames } from "@/lib/work/names";
import { contactKindLabel, orgRoleLine, overdueLabel } from "@/lib/work/outreach";
import type { PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { DEAL_FILTERS, matchesFilter, type DealFilter } from "@/lib/work/phases";
import type { ItemRow } from "@/lib/work/pipelines-data";
import { dueThisWeekLabel } from "@/lib/work/projects";
import type { ProjectRow } from "@/lib/work/projects-data";
import { dueLabel, followUpDraft, STAGE_DEFAULTS, type WorkStageName } from "@/lib/work/stages";
import { AiCardStar } from "@/components/app/work/ask-ai";
import { ItemActionRow, itemHref } from "@/components/app/work/item-row";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { OutreachActionRow, PurposePills } from "@/components/app/work/person-row";
import { ProjectActionRow } from "@/components/app/work/project-row";
import { useSections } from "@/components/app/work/sections";
import { Due, FilterRow, Line1, Line2, Name, Pill, PinnedBlock, ProgressMark, RowButton, RowShell, SectionHeading, TargetBar, What, WorkCard } from "@/components/app/work/ui";
import { WaitingRow } from "@/components/app/work/waiting-row";
import { cn } from "@/lib/utils";

/**
 * Home (Work on now) as the bento of mockup v6 (approved 2026-10-31), batch B2: Next actions merges every lane (a
 * deal row has no pill; Outreach, Rosara, Job search, and Consulting rows carry a lane pill) in the sections
 * Overdue, Due today, Needs a next action. The card header holds "Order: Soonest first | By the AI": By the AI asks
 * the AI once a day for the order of the day's actions (cached; "Order again" asks again) and shows one purple
 * reason under each row; Soonest first is the default and costs nothing; the choice is remembered in this browser.
 * Right third, stacked: Waiting on someone, Outreach, Rosara (the weekly focus, the next project action, the
 * counts), Job search (the next conversation, the next interview, the counts), Screen listings, Deals at a glance.
 */
const STORAGE_KEY = "work-home-sections";
const HOME_ASK: AskContext = { page: "home", label: "Work on now" };
const noSubscribe = () => () => {};

type Row = { key: string; lane: Lane; section: LaneSectionKey; action: HomeAction; /** The filters read these. */ status: string; waitLevel: string; nextAction: string | null; nextActionDue: string | null; name: string; render: (reason: string | null) => React.ReactNode };

export function HomeBoard({ header, data, composes, personComposes, askCompose }: { /** The title, the date, and the Work tabs (server-rendered). */ header: React.ReactNode; data: HomeData; /** The email setup per waiting deal (Follow up). */ composes: Record<string, ComposeSetup>; /** The email setup per person on the Outreach tile. */ personComposes: Record<string, ComposeSetup>; /** The email setup for "Open in email" in the Ask AI panel (a typed address). */ askCompose?: ComposeSetup | null }) {
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

  // ---------- The AI order ----------
  // The choice is remembered in this browser (read once, without an effect, as the other saved choices).
  const savedOrder = useSyncExternalStore(noSubscribe, () => parseOrderChoice(readRaw(ORDER_STORAGE_KEY)), () => "soonest" as OrderChoice);
  const [chosenOrder, setOrder] = useState<OrderChoice | null>(null);
  const order: OrderChoice = chosenOrder ?? savedOrder;
  const [aiOrder, setAiOrder] = useState<AiOrder | null>(data.aiOrder);
  const [prevAi, setPrevAi] = useState(data.aiOrder);
  if (prevAi !== data.aiOrder) {
    setPrevAi(data.aiOrder);
    if (data.aiOrder) setAiOrder(data.aiOrder);
  }
  const [ordering, startOrder] = useTransition();
  const [orderError, setOrderError] = useState<string | null>(null);
  const askOrder = (force: boolean) => {
    setOrderError(null);
    startOrder(async () => {
      const r = await aiOrderToday(force);
      if (!r.ok) return setOrderError(r.error);
      setAiOrder(r.order);
    });
  };
  const pickOrder = (c: OrderChoice) => {
    setOrder(c);
    try {
      window.localStorage.setItem(ORDER_STORAGE_KEY, c);
    } catch {
      /* no storage */
    }
    if (c === "ai" && !aiOrder) askOrder(false);
  };

  // ---------- The rows of every lane ----------
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (lane: Lane, id: string, action: HomeAction, extra: Pick<Row, "status" | "waitLevel" | "nextAction" | "nextActionDue" | "name">, render: Row["render"]) => {
      const section = laneSectionOf(action, today);
      if (section) out.push({ key: actionKey(lane, id), lane, section, action, ...extra, render });
    };
    for (const d of deals) {
      push("Deals", d.id, { key: actionKey("Deals", d.id), lane: "Deals", id: d.id, name: d.name, action: d.nextAction, due: d.nextActionDue, minutes: d.nextActionMinutes, meta: [d.stageName, d.whatItDoes, d.location].filter(Boolean).join(", ") }, { status: d.status, waitLevel: d.waitLevel, nextAction: d.nextAction, nextActionDue: d.nextActionDue, name: d.name }, (reason) => (d.nextAction ? <NextActionRow deal={d} today={today} reason={reason} /> : <NeedsActionRow deal={d} />));
    }
    for (const p of data.outreach.due) {
      push("Outreach", p.id, { key: actionKey("Outreach", p.id), lane: "Outreach", id: p.id, name: p.name, action: p.followUpFor ?? "Follow up", due: p.nextFollowUp, minutes: null, meta: orgRoleLine(p) }, { status: "open", waitLevel: "none", nextAction: p.followUpFor ?? "Follow up", nextActionDue: p.nextFollowUp, name: p.name }, (reason) => <OutreachActionRow person={p} today={today} reason={reason} />);
    }
    for (const pr of data.rosara.actions) {
      push("Rosara", pr.id, { key: actionKey("Rosara", pr.id), lane: "Rosara", id: pr.id, name: pr.name, action: pr.nextAction, due: pr.nextActionDue, minutes: pr.nextActionMinutes, meta: pr.milestone ?? "" }, { status: "open", waitLevel: "none", nextAction: pr.nextAction, nextActionDue: pr.nextActionDue, name: pr.name }, (reason) => <ProjectActionRow project={pr} today={today} reason={reason} />);
    }
    for (const i of [...data.pipelines.jobs, ...data.pipelines.consulting]) {
      const lane: Lane = i.kind === "job" ? "Job search" : "Consulting";
      push(lane, i.id, { key: actionKey(lane, i.id), lane, id: i.id, name: i.name, action: i.nextAction, due: i.nextActionDue, minutes: i.nextActionMinutes, meta: [i.stageName, i.title].filter(Boolean).join(", ") }, { status: i.status, waitLevel: i.waitLevel, nextAction: i.nextAction, nextActionDue: i.nextActionDue, name: i.name }, (reason) => <ItemActionRow item={i} today={today} reason={reason} />);
    }
    return out;
  }, [deals, data.outreach.due, data.rosara.actions, data.pipelines.jobs, data.pipelines.consulting, today]);

  const sectionsOf = useMemo(() => {
    const by: Record<LaneSectionKey, Row[]> = { overdue: [], today: [], needs: [] };
    for (const r of rows) by[r.section].push(r);
    by.overdue.sort((a, b) => compareActions(a.action, b.action));
    by.today.sort((a, b) => compareActions(a.action, b.action));
    by.needs.sort((a, b) => compareNames(a.name, b.name));
    return by;
  }, [rows]);
  const waiting = useMemo(() => waitSections(deals, threshold).map((w) => ({ ...w, deals: [...w.deals].sort((a, b) => b.waitDays - a.waitDays || compareNames(a.name, b.name)) })), [deals, threshold]);

  const rowMatches = (r: Row, f: DealFilter) => matchesFilter({ name: r.name, status: r.status, nextAction: r.nextAction, nextActionDue: r.nextActionDue, waitLevel: r.waitLevel }, f, today);
  const counts = useMemo(() => {
    const waitRows = waiting.flatMap((w) => w.deals);
    const count = (f: DealFilter) => rows.filter((r) => rowMatches(r, f)).length + waitRows.filter((d) => matchesFilter(d, f, today)).length;
    return { all: rows.length + waitRows.length, today: count("today"), wait: count("wait"), needs: count("needs") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, waiting, today]);
  const shownRow = (r: Row) => rowMatches(r, filter) && matchesActionSearch(r.action, query);
  const shownDeal = (d: DealRow) => matchesFilter(d, filter, today) && (!query.trim() || d.name.toLowerCase().includes(query.trim().toLowerCase()));

  const SECTIONS: { key: LaneSectionKey; label: string }[] = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due today" },
    { key: "needs", label: "Needs a next action" },
  ];
  // The filter decides which sections open; Find narrows the rows inside them.
  const states = useMemo(
    () => [...SECTIONS.map((s) => ({ name: s.label, count: sectionsOf[s.key].length, hasMatch: sectionsOf[s.key].some((r) => rowMatches(r, filter)) })), ...waiting.map((w) => ({ name: w.label, count: w.deals.length, hasMatch: w.deals.some((d) => matchesFilter(d, filter, today)) }))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionsOf, waiting, filter, today],
  );
  const sections = useSections(STORAGE_KEY, states, filter !== "all");
  const pick = (f: DealFilter) => {
    setFilter(f);
    sections.resetOverrides();
  };

  const actionCount = rows.length;
  const waitCount = waiting.reduce((s, w) => s + w.deals.length, 0);
  const aiRows = useMemo(() => (aiOrder ? applyAiOrder([...sectionsOf.overdue, ...sectionsOf.today], aiOrder.order) : []), [aiOrder, sectionsOf]);
  const byAi = order === "ai" && !!aiOrder;

  /** One row box; with a number (the AI order) the row sits beside a small purple badge. */
  const rowBox = (r: Row, number?: number) => (
    <div key={r.key} className={cn("border-t border-slate-100 first:border-t-0", number !== undefined && "grid grid-cols-[40px_minmax(0,1fr)]", !shownRow(r) && "hidden")} data-testid="home-row" data-lane={r.lane.toLowerCase().replace(" ", "-")} data-key={r.key} data-hidden={shownRow(r) ? "0" : "1"}>
      {number !== undefined ? (
        <span className="pt-[15px] pl-[22px]">
          <span className="tabular inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-violet/30 bg-violet-soft text-[11px] font-semibold text-violet" aria-hidden data-testid="ai-order-number">
            {number}
          </span>
        </span>
      ) : null}
      <div className={cn("min-w-0", number !== undefined && "-ml-[22px]")}>{r.render(byAi ? (aiOrder?.reasons[r.key] ?? null) : null)}</div>
    </div>
  );

  return (
    <>
      <PinnedBlock testId="home-sticky">
        {header}
        <FilterRow prefix="home" filters={DEAL_FILTERS} active={filter} counts={counts} onPick={pick} query={query} onQuery={setQuery} placeholder="Find" collapse={{ allCollapsed: sections.allCollapsed, onClick: sections.toggleAll }} className="-mt-2" />
      </PinnedBlock>

      <div className="grid grid-cols-1 items-start gap-[18px] lg:h-[calc(100vh-272px)] lg:min-h-[460px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-stretch" data-testid="home-bento">
        <WorkCard
          id="now-actions"
          title="Next actions"
          count={actionCount}
          sub={byAi ? "Every lane, in the AI's order; one reason under each row" : "Every lane, due today or earlier, soonest first"}
          actions={
            <>
              <span className="text-[13px] text-muted-foreground">Order:</span>
              <div className="inline-flex rounded-full border border-border bg-slate-50 p-0.5" role="radiogroup" aria-label="Order" data-testid="home-order">
                {(["soonest", "ai"] as OrderChoice[]).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={order === c} onClick={() => pickOrder(c)} className={cn("rounded-full px-3 py-[3px] text-[12.5px] font-medium whitespace-nowrap", order === c ? "bg-white text-primary-strong shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-slate-600 hover:text-slate-900")} data-testid={`home-order-${c}`}>
                    {c === "soonest" ? "Soonest first" : "By the AI"}
                  </button>
                ))}
              </div>
              <AiCardStar context={{ ...HOME_ASK, card: "Next actions" }} compose={askCompose} />
            </>
          }
          testId="now-actions"
          pinned
          scroll
          className="lg:h-full"
        >
          {actionCount ? (
            <div className="px-[22px] pt-1 pb-3">
              {order === "ai" ? (
                <div className="mt-3 mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-1.5 pb-[7px]" data-testid="ai-order-heading">
                  <span className="text-[12.5px] font-medium tracking-[0.09em] text-violet uppercase">{aiOrder ? orderedAtLabel(aiOrder.createdAt, today, data.hourLocal) : ordering ? "Asking the AI for the order..." : "By the AI"}</span>
                  <span className="flex items-center gap-3 text-xs text-slate-400">
                    {aiOrder ? <span className="hidden sm:inline">One reason under each row</span> : null}
                    <button type="button" onClick={() => askOrder(true)} disabled={ordering} className="font-medium text-violet hover:underline disabled:opacity-50" data-testid="ai-order-again">
                      {ordering ? "Ordering..." : aiOrder ? "Order again" : "Ask now"}
                    </button>
                  </span>
                </div>
              ) : null}
              {order === "ai" && orderError ? (
                <p className="rounded-lg border border-status-missed-border bg-status-missed-bg px-3.5 py-2 text-[13px] text-status-missed" role="alert" data-testid="ai-order-error">
                  {orderError} Showing soonest first.
                </p>
              ) : null}
              {byAi ? (
                <div className="-mx-[22px] flex flex-col" data-testid="ai-order-rows">
                  {aiRows.map((r, n) => rowBox(r, n + 1))}
                </div>
              ) : null}
              {SECTIONS.filter((s) => !byAi || s.key === "needs").map((s) => {
                const list = sectionsOf[s.key];
                const closed = sections.isCollapsed(s.label);
                return (
                  <div key={s.key} data-testid="home-section" data-section={s.key} data-collapsed={closed ? "1" : "0"}>
                    <SectionHeading name={s.label} count={list.length} collapsed={closed} onToggle={() => sections.toggle(s.label)} />
                    {list.length && !closed ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                        {list.map((r) => rowBox(r))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="now-actions-empty">
              Nothing is due today and every record has a next action. Deals, Outreach, Rosara, Job search, and Consulting list every next action.
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
                            <div key={deal.id} className={cn("border-t border-slate-100 first:border-t-0", !shownDeal(deal) && "hidden")} data-testid="home-row" data-hidden={shownDeal(deal) ? "0" : "1"}>
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
          <RosaraTile rosara={data.rosara} today={today} />
          <JobSearchTile pipelines={data.pipelines} today={today} />
          <ListingsTile count={data.toScreen} listings={data.listings} />
          <GlanceTile glance={data.glance} threshold={threshold} />
        </div>
      </div>
      {personEmail && personComposes[personEmail.id] ? (
        <ComposeEmailDialog
          key={`p-${personEmail.id}`}
          setup={personComposes[personEmail.id]}
          open
          ask={{ page: "person", recordId: personEmail.id, label: personEmail.name }}
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
          ask={{ page: "deal", recordId: followUp.id, label: followUp.name }}
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

/** A labeled block in a tile: a bold label, a pill at the right, and one or two quiet lines. */
function TileBlock({ label, right, children, testId }: { label: string; right?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-slate-100 px-[22px] py-[9px] first:border-t-0" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        {right}
      </div>
      <div className="text-[12.5px] text-slate-600 italic">{children}</div>
    </div>
  );
}

/** The Rosara tile (batch B2): the weekly focus, the next project action with its due, the open project count and how many are due this week. */
function RosaraTile({ rosara, today }: { rosara: HomeData["rosara"]; today: string }) {
  const next: ProjectRow | null = rosara.next;
  const due = next?.nextActionDue ? dueLabel(next.nextActionDue, today, (d) => fmtDate(d, "MMM d")) : null;
  return (
    <WorkCard title="Rosara" hint={rosara.open ? `${rosara.open} open` : "No projects"} testId="home-rosara" pinned>
      <div className="flex flex-col pt-1">
        <TileBlock label="This week" testId="home-rosara-focus">
          {rosara.focus || <span className="not-italic text-slate-400">No weekly focus set. Set it on Rosara.</span>}
        </TileBlock>
        <TileBlock label="Next" right={due ? <Pill tone={due.tone === "today" ? "amber" : due.tone === "over" ? "red" : "gray"}>{due.text}</Pill> : null} testId="home-rosara-next">
          {next ? (
            <>
              <Link href={`/work/rosara/${next.id}`} className="not-italic hover:underline">
                {next.nextAction}
              </Link>
              {` · ${next.name}`}
            </>
          ) : (
            <span className="not-italic text-slate-400">No project has a next action.</span>
          )}
        </TileBlock>
        <TileBlock
          label="Projects"
          right={
            <Pill tone="gray" className="tabular min-w-[32px] justify-center" testId="home-rosara-count">
              {rosara.open}
            </Pill>
          }
          testId="home-rosara-projects"
        >
          {dueThisWeekLabel(rosara.dueThisWeek)}
        </TileBlock>
      </div>
      <div className="border-t border-slate-100 px-[22px] pt-2.5 pb-4">
        <Link href="/work/rosara" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-rosara">
          Open Rosara
        </Link>
      </div>
    </WorkCard>
  );
}

/** The Job search tile (batch B2): the next conversation, the next interview, the counts. */
function JobSearchTile({ pipelines, today }: { pipelines: HomeData["pipelines"]; today: string }) {
  const t = pipelines.tile;
  const line = (i: ItemRow | null, none: string) => {
    if (!i) return <span className="not-italic text-slate-400">{none}</span>;
    const due = i.nextActionDue ? dueLabel(i.nextActionDue, today, (d) => fmtDate(d, "MMM d")) : null;
    return (
      <>
        <Link href={itemHref(i)} className="not-italic hover:underline">
          {i.name}
        </Link>
        {i.title ? `, ${i.title}` : ""}
        {i.nextAction ? ` · ${i.nextAction}` : ""}
        {due ? (
          <>
            {" "}
            <Due text={`· ${due.text}`} tone={due.tone} className="not-italic" />
          </>
        ) : null}
      </>
    );
  };
  return (
    <WorkCard title="Job search" hint={t.open ? `${t.open} open` : "None open"} testId="home-jobs" pinned>
      <div className="flex flex-col pt-1">
        <TileBlock label="Next conversation" testId="jobs-row">
          {line(t.nextConversation, "Nothing at Conversation yet.")}
        </TileBlock>
        <TileBlock label="Next interview" testId="jobs-row">
          {line(t.nextInterview, "No interview booked.")}
        </TileBlock>
        {[
          { key: "open", label: "Open opportunities", n: t.open, href: "/work/jobs", warn: false },
          { key: "needs", label: "Needs a next action", n: t.needsAction, href: "/work/jobs?filter=needs", warn: true },
          { key: "wait", label: "Waiting on someone", n: t.waiting, href: "/work/jobs?filter=wait", warn: true },
        ].map((r) => (
          <Link key={r.key} href={r.href} className="flex items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-[9px] text-sm text-slate-900 hover:bg-[#fbfcfe]" data-testid="jobs-row" data-key={r.key} data-count={r.n}>
            <span>{r.label}</span>
            <Pill tone={r.warn && r.n > 0 ? "amber" : "gray"} className="tabular min-w-[32px] justify-center">
              {r.n}
            </Pill>
          </Link>
        ))}
      </div>
      <div className="border-t border-slate-100 px-[22px] pt-2.5 pb-4">
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

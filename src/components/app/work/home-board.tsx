"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { aiOrderToday } from "@/app/actions/ask-ai";
import { resetWaiting } from "@/app/actions/work";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import { FilterMenuButton, FilterPopover } from "@/components/app/filter-popover";
import type { ComposeSetup } from "@/lib/compose-email";
import { readRaw } from "@/lib/disclosure";
import { filterButtonLabel, optionCounts, parseTicks, ticksToParam, toggleTick, type FilterGroup, type Ticks } from "@/lib/filters";
import { date as fmtDate } from "@/lib/format";
import type { AskContext } from "@/lib/work/ask-ai";
import type { DealRow, ListingTile, WorkNowData } from "@/lib/work/data";
import { waitSections } from "@/lib/work/home";
import type { HomeData } from "@/lib/work/home-data";
import { actionKey, applyAiOrder, AREA_STORAGE_KEY, AREAS, areaOf, compareActions, laneSectionOf, matchesActionSearch, ORDER_STORAGE_KEY, orderedAtLabel, orderToStore, parseOrderChoice, type AiOrder, type AreaKey, type HomeAction, type Lane, type LaneSectionKey, type OrderChoice } from "@/lib/work/lanes";
import { compareNames } from "@/lib/work/names";
import { contactKindLabel, orgRoleLine, overdueLabel } from "@/lib/work/outreach";
import type { PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { PEOPLE_HREF, personHref } from "@/lib/work/people";
import type { ItemRow } from "@/lib/work/pipelines-data";
import { dueThisWeekLabel } from "@/lib/work/projects";
import type { ProjectRow } from "@/lib/work/projects-data";
import { dueLabel, followUpDraft, STAGE_DEFAULTS, type WorkStageName } from "@/lib/work/stages";
import { clickTile, selectedTile, tileAfterFilter, type Tile } from "@/lib/work/tiles";
import { AiCardStar } from "@/components/app/work/ask-ai";
import { ItemActionRow, itemHref } from "@/components/app/work/item-row";
import { LogCallDrawer } from "@/components/app/work/log-call-drawer";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { OutreachActionRow, PurposePills } from "@/components/app/work/person-row";
import { ProjectActionRow } from "@/components/app/work/project-row";
import { TodoActionRow } from "@/components/app/work/todo-row";
import { StickySections } from "@/components/app/work/sticky-sections";
import { SlimBar, SlimTools } from "@/components/app/work/slim-bar";
import { StatusTiles, TileChips } from "@/components/app/work/status-tiles";
import { FindBox, TitleRow } from "@/components/app/work/title-row";
import { BAND_CLS, Due, Figure, Line1, Line2, ListBand, Name, Pill, ProgressMark, RowButton, RowButtons, RowLink, RowShell, SectionHeading, TargetBar, Thinking, What, WorkCard, type PillTone } from "@/components/app/work/ui";
import { WaitingRow } from "@/components/app/work/waiting-row";
import { BlockTimeProvider } from "@/components/app/work/block-time";
import { CalendarTile } from "@/components/app/work/calendar-tile";
import { WorkThrough, type WorkStep } from "@/components/app/work/work-through";
import { recordPillText } from "@/lib/work/task-records";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Work on now (Home; the bento of mockup v6, approved 2026-10-31, with the header of 2026-11-04). The title row: the
 * title, the date, Find, Filter, Ask AI. Then three tiles that work like tabs over the Next actions column (Overdue,
 * Due today, Needs a next action; src/lib/work/tiles.ts): exactly one is selected and the card under them shows only
 * its list under one pinned band. The Filter has one column, Area (Deals, Contacts, Rosara, Job search, Consulting,
 * To-dos, Tasks); it narrows Next actions and its tile numbers, and is remembered in this browser.
 * The Filter button says what is on ("Area: All", "Area: Deals, Rosara +2") and opens a small box under it; a tick
 * applies at once. Next actions merges every area (a deal row has no pill; the others carry an area pill). "Order: Soonest first | By
 * the AI": By the AI asks the AI once a day for the order (cached; "Order again" asks again), shows the full ranked list
 * of all three kinds with one purple reason under each row, and leaves no tile selected; a tile click goes back to
 * Soonest first. Each new day starts on Soonest first. Push C: the solid "Work through" button opens the step-by-step
 * window (work-through.tsx); every row with Done has the block icon (block-time.tsx) and "Blocked 2:00" under its date.
 * Right third, level with the tiles: Waiting on someone (never filtered; its two groups start closed and the card
 * scrolls on its own), Today's calendar, Targets today, Contacts, Rosara, Job search, Screen listings, Deals at a
 * glance. In a desktop window at least 720px tall the two columns scroll inside; under 1024px or in a shorter window
 * the page scrolls, and the slim pinned bar slides in once the title row and the tiles are gone.
 */
const HOME_ASK: AskContext = { page: "home", label: "Work on now" };
const noSubscribe = () => () => {};
const PANEL_ID = "now-actions-panel";
const FIND_ID = "home-find";
/** A desktop window tall enough for the cards to scroll on their own (the desk variant in globals.css); otherwise the page scrolls. */
const DESK = "(min-width: 1024px) and (min-height: 720px)";

type Row = { key: string; lane: Lane; area: AreaKey; section: LaneSectionKey; action: HomeAction; render: (reason: string | null) => React.ReactNode; /** Work through's view of the row (push C). */ step: WorkStep | null };

const TILE_LABEL: Record<LaneSectionKey, string> = { overdue: "Overdue", today: "Due today", needs: "Needs a next action" };
const TILE_KEYS: LaneSectionKey[] = ["overdue", "today", "needs"];
const TILE_EMPTY: Record<LaneSectionKey, string> = { overdue: "Nothing is overdue.", today: "Nothing else is due today.", needs: "Every item has a next action." };
const AREA_GROUP: FilterGroup<Row>[] = [{ key: "area", title: "Area", options: AREAS.map((a) => ({ value: a.value, label: a.label })), test: (r, v) => r.area === v }];

export function HomeBoard({ data, dateLabel, askAi, tabs, composes, personComposes, askCompose }: { data: HomeData; /** The date at the right of the title, long and short. */ dateLabel: { long: string; short: string }; /** Ask AI (server-rendered). */ askAi: React.ReactNode; /** The top menu row (under 1024px). */ tabs: React.ReactNode; /** The email setup per waiting deal (Follow up). */ composes: Record<string, ComposeSetup>; /** The email setup per person on the Outreach tile. */ personComposes: Record<string, ComposeSetup>; /** The email setup for "Open in email" in the Ask AI panel (a typed address). */ askCompose?: ComposeSetup | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [personEmail, setPersonEmail] = useState<PersonRowData | null>(null);
  const [personCall, setPersonCall] = useState<PersonRowData | null>(null);
  const [personLogged, setPersonLogged] = useState<Record<string, string>>({});
  /** Deals followed up on this visit: the row keeps its "Followed up" line after it moves under the threshold. */
  const [followedUp, setFollowedUp] = useState<Record<string, boolean>>({});
  /** The deal whose Follow up editor is open (held here, so the editor survives the row moving after the send). */
  const [followUp, setFollowUp] = useState<DealRow | null>(null);
  /** The button the small Filter box hangs under (the title row's or the slim bar's), or null while it is closed. */
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const { deals, today, threshold } = data;

  // ---------- The AI order: By the AI is remembered for the rest of the day it was picked (read once, without an effect) ----------
  const savedOrder = useSyncExternalStore(noSubscribe, () => parseOrderChoice(readRaw(ORDER_STORAGE_KEY), today), () => "soonest" as OrderChoice);
  const [chosenOrder, setOrder] = useState<OrderChoice | null>(null);
  const order: OrderChoice = chosenOrder ?? savedOrder;
  const [aiOrder, setAiOrder] = useState<AiOrder | null>(data.aiOrder);
  const [prevAi, setPrevAi] = useState(data.aiOrder);
  if (prevAi !== data.aiOrder) {
    setPrevAi(data.aiOrder);
    if (data.aiOrder) setAiOrder(data.aiOrder);
  }
  const [ordering, startOrder] = useTransition();
  const [orderError, setOrderError] = useState<{ error: string; reply?: string | null } | null>(null);
  const askOrder = (force: boolean) => {
    setOrderError(null);
    startOrder(async () => {
      const r = await aiOrderToday(force);
      if (!r.ok) return setOrderError({ error: r.error, reply: r.reply });
      setAiOrder(r.order);
    });
  };
  const listRef = useRef<HTMLElement>(null);
  const toListTop = () => {
    if (listRef.current && window.matchMedia(DESK).matches) listRef.current.scrollTop = 0;
  };
  const pickOrder = (c: OrderChoice) => {
    if (c === order) return;
    setOrder(c);
    try {
      window.localStorage.setItem(ORDER_STORAGE_KEY, orderToStore(c, today));
    } catch {
      /* no storage */
    }
    toListTop();
    if (c === "ai" && !aiOrder) askOrder(false);
  };

  // ---------- The Area filter, remembered in this browser ----------
  const savedAreaRaw = useSyncExternalStore(noSubscribe, () => readRaw(AREA_STORAGE_KEY), () => null);
  const savedTicks = useMemo(() => parseTicks(savedAreaRaw, AREA_GROUP), [savedAreaRaw]);
  const [chosenTicks, setChosenTicks] = useState<Ticks | null>(null);
  const ticks = chosenTicks ?? savedTicks;
  const ticked = useMemo(() => ticks.area ?? [], [ticks]);

  // ---------- The rows of every area ----------
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (lane: Lane, area: AreaKey, action: HomeAction, render: Row["render"], step: WorkStep | null = null) => {
      const section = laneSectionOf(action, today);
      if (section) out.push({ key: action.key, lane, area, section, action, render, step });
    };
    // Edit batch C round 3: a listing to screen with a next action (optional on a listing) shows with the deals.
    for (const d of [...deals, ...(data.listingActions ?? [])]) {
      push("Deals", "deals", { key: actionKey("Deals", d.id), lane: "Deals", id: d.id, name: d.name, action: d.nextAction, due: d.nextActionDue, minutes: d.nextActionMinutes, meta: [d.stageName, d.whatItDoes, d.location].filter(Boolean).join(", ") }, (reason) => (d.nextAction ? <NextActionRow deal={d} today={today} reason={reason} /> : <NeedsActionRow deal={d} />), d.nextAction ? { kind: "deal", key: actionKey("Deals", d.id), deal: d } : null);
    }
    for (const p of data.outreach.due) {
      push("People", "contacts", { key: actionKey("People", p.id), lane: "People", id: p.id, name: p.name, action: p.followUpFor ?? "Follow up", due: p.nextFollowUp, minutes: null, meta: orgRoleLine(p) }, (reason) => <OutreachActionRow person={p} today={today} reason={reason} />, { kind: "person", key: actionKey("People", p.id), person: p });
    }
    for (const pr of data.rosara.actions) {
      push("Rosara", "rosara", { key: actionKey("Rosara", pr.id), lane: "Rosara", id: pr.id, name: pr.name, action: pr.nextAction, due: pr.nextActionDue, minutes: pr.nextActionMinutes, meta: pr.milestone ?? "" }, (reason) => <ProjectActionRow project={pr} today={today} reason={reason} />, pr.nextAction ? { kind: "project", key: actionKey("Rosara", pr.id), project: pr } : null);
    }
    for (const i of [...data.pipelines.jobs, ...data.pipelines.consulting]) {
      const lane: Lane = i.kind === "job" ? "Job search" : "Consulting";
      push(lane, areaOf(lane), { key: actionKey(lane, i.id), lane, id: i.id, name: i.name, action: i.nextAction, due: i.nextActionDue, minutes: i.nextActionMinutes, meta: [i.stageName, i.title].filter(Boolean).join(", ") }, (reason) => <ItemActionRow item={i} today={today} reason={reason} />, i.nextAction ? { kind: "item", key: actionKey(lane, i.id), item: i } : null);
    }
    // Personal to-dos due today or earlier (the To-do pill) and dated record tasks (the Task pill and the gray record pill).
    for (const t of data.todos) {
      push("To-dos", areaOf("To-dos", !!t.record), { key: actionKey("To-dos", t.id), lane: "To-dos", id: t.id, name: t.text, action: t.text, due: t.dueOn, minutes: null, meta: t.record ? recordPillText(t.record) : "Personal to-do" }, (reason) => <TodoActionRow todo={t} today={today} reason={reason} />, { kind: "todo", key: actionKey("To-dos", t.id), todo: t });
    }
    return out;
  }, [deals, data.listingActions, data.outreach.due, data.rosara.actions, data.pipelines.jobs, data.pipelines.consulting, data.todos, today]);
  const rows = useMemo(() => allRows.filter((r) => !ticked.length || ticked.includes(r.area)), [allRows, ticked]);

  // The three lists, each sorted (Soonest first); the tile numbers follow the Area ticks, not Find.
  const sectionsOf = useMemo(() => {
    const by: Record<LaneSectionKey, Row[]> = { overdue: [], today: [], needs: [] };
    for (const r of rows) by[r.section].push(r);
    by.overdue.sort((a, b) => compareActions(a.action, b.action));
    by.today.sort((a, b) => compareActions(a.action, b.action));
    by.needs.sort((a, b) => compareNames(a.action.name, b.action.name));
    return by;
  }, [rows]);
  const tiles: Tile<LaneSectionKey>[] = TILE_KEYS.map((k) => ({ key: k, label: TILE_LABEL[k], count: sectionsOf[k].length, red: k === "overdue" }));
  const found = (r: Row) => matchesActionSearch(r.action, query);

  // ---------- The tiles ----------
  const [chosenTile, setChosenTile] = useState<LaneSectionKey | null>(null);
  const selected = selectedTile(chosenTile, tiles, order);
  const pickTile = (k: LaneSectionKey) => {
    const next = clickTile({ order, selected }, k);
    if (!next.changed) return;
    if (order !== next.order) pickOrder(next.order);
    setChosenTile(next.selected);
    toListTop();
  };
  const setTicks = (t: Ticks) => {
    setChosenTicks(t);
    try {
      const v = ticksToParam(t);
      if (v) window.localStorage.setItem(AREA_STORAGE_KEY, v);
      else window.localStorage.removeItem(AREA_STORAGE_KEY);
    } catch {
      /* no storage: the choice holds until the page reloads */
    }
    // A Filter tick that drops the selected tile to 0 selects the first tile with items.
    const nextRows = allRows.filter((r) => !(t.area ?? []).length || (t.area ?? []).includes(r.area));
    const nextTiles = TILE_KEYS.map((k) => ({ key: k, count: nextRows.filter((r) => r.section === k).length }));
    if (selected) setChosenTile(tileAfterFilter(selected, nextTiles));
  };

  // ---------- Waiting on someone: never filtered ----------
  const waiting = useMemo(() => waitSections(deals, threshold).map((w) => ({ ...w, deals: [...w.deals].sort((a, b) => b.waitDays - a.waitDays || compareNames(a.name, b.name)) })), [deals, threshold]);
  const waitCount = waiting.reduce((s, w) => s + w.deals.length, 0);
  const [waitOpen, setWaitOpen] = useState<Record<string, boolean>>({});

  const shownCount = rows.filter(found).length;
  const aiRows = useMemo(() => (aiOrder ? applyAiOrder([...sectionsOf.overdue, ...sectionsOf.today, ...sectionsOf.needs], aiOrder.order) : []), [aiOrder, sectionsOf]);
  const byAi = order === "ai" && !!aiOrder;
  // Work through (push C): every row due today or earlier, in the order Next actions shows them.
  const [working, setWorking] = useState(false);
  const steps = useMemo(() => (byAi ? aiRows.filter((r) => r.section !== "needs") : [...sectionsOf.overdue, ...sectionsOf.today]).map((r) => r.step).filter((x): x is WorkStep => !!x), [byAi, aiRows, sectionsOf]);

  // The desktop bento fills the window under the header: its top is measured once the page is at the top.
  const bentoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const set = () => {
      const b = bentoRef.current;
      if (b && window.scrollY === 0) b.style.setProperty("--bento-top", `${b.getBoundingClientRect().top}px`);
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  // The Filter window: the count beside each area is how many next actions would show (with Find).
  const filterCounts = optionCounts(allRows.filter(found), AREA_GROUP, ticks);
  const toggleFilter = (el: HTMLElement) => setFilterAnchor((a) => (a === el ? null : el));
  const closeFilter = useCallback(() => setFilterAnchor(null), []);
  const filterLabel = filterButtonLabel("Area", AREA_GROUP, ticks);

  /**
   * One row box; with a number (the AI order) the row sits beside a small purple badge in its own 54px column (the
   * card's 22px edge, the 18px badge, a 14px gap), level with the name line, so it never touches the stage mark or the
   * area pill (Edit batch C, item 1).
   */
  const rowBox = (r: Row, number?: number) => (
    <div key={r.key} className={cn("border-t border-slate-100 first:border-t-0", number !== undefined && "grid grid-cols-[54px_minmax(0,1fr)] items-start")} data-testid="home-row" data-lane={r.lane.toLowerCase().replace(" ", "-")} data-area={r.area} data-key={r.key} data-section={r.section}>
      {number !== undefined ? (
        <span className="pt-[11px] pl-[22px]" data-col="ai-number">
          <span className="tabular inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-violet/30 bg-violet-soft text-[11px] font-semibold text-violet" aria-hidden data-testid="ai-order-number">
            {number}
          </span>
        </span>
      ) : null}
      <div className={cn("min-w-0", number !== undefined && "-ml-[22px]")}>{r.render(byAi ? (aiOrder?.reasons[r.key] ?? null) : null)}</div>
    </div>
  );

  const narrowed = ticked.length > 0 || !!query.trim();
  const empty = (k: LaneSectionKey | null) => (
    <div className="px-[22px] py-[22px] text-[13px] text-muted-foreground" data-testid="now-actions-empty">
      <b className="mb-0.5 block text-[13.5px] font-semibold text-heading">{narrowed ? "Nothing matches." : k ? TILE_EMPTY[k] : "Nothing is due today."}</b>
      {narrowed ? "Change the filter or the Find box." : "Pick another tile above."}
    </div>
  );
  const list = selected ? sectionsOf[selected].filter(found) : [];
  const aiList = aiRows.filter(found);

  return (
    <BlockTimeProvider today={today} nowLocal={data.nowLocal} blockMinutes={data.blockMinutes} rowBlocks={data.rowBlocks} calendar={data.calendar}>
      <SlimBar title="Work on now" chips={<TileChips tiles={tiles} selected={selected} onPick={pickTile} label="Next actions" idPrefix="home-chip" panelId={PANEL_ID} />} tools={<SlimTools findId={FIND_ID} filterCount={ticked.length} onFilter={toggleFilter} filterOpen={!!filterAnchor} />} />
      <header className="pb-5" data-testid="home-header">
        <TitleRow
          title="Work on now"
          date={dateLabel}
          tools={
            <>
              <FindBox id={FIND_ID} value={query} onChange={setQuery} testId="home-search" />
              <FilterMenuButton label={filterLabel} ticked={ticked.length} open={!!filterAnchor} onOpen={toggleFilter} />
            </>
          }
          askAi={askAi}
        />
        {tabs}
      </header>
      <FilterPopover anchor={filterAnchor} onClose={closeFilter} groups={AREA_GROUP} ticks={ticks} counts={filterCounts} onToggle={(g, v) => setTicks(toggleTick(ticks, g, v))} onClear={() => setTicks({})} note="Waiting on someone is not filtered." />

      <div ref={bentoRef} className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] desk:-mb-[72px] desk:h-[calc(100vh-var(--bento-top,104px)-24px)] desk:min-h-[460px] desk:items-stretch" data-testid="home-bento">
        <div className="flex min-h-0 min-w-0 flex-col gap-6" data-testid="home-left">
          <StatusTiles tiles={tiles} selected={selected} onPick={pickTile} label="Next actions" idPrefix="home-tile" panelId={PANEL_ID} testId="home-tiles" />
          <WorkCard
            id={PANEL_ID}
            ref={listRef}
            role="tabpanel"
            labelledBy={selected ? `home-tile-${selected}` : undefined}
            title="Next actions"
            count={shownCount}
            sub={byAi ? "Every area, in the AI's order; one reason under each row" : "Every area, due today or earlier, soonest first"}
            actions={
              <>
                <button type="button" onClick={() => setWorking(true)} disabled={!steps.length} className="mr-1 inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[13px] font-medium whitespace-nowrap text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover disabled:opacity-50" data-testid="work-through-open" title={steps.length ? `Step through the ${steps.length} due today or earlier, one at a time` : "Nothing is due today"}>
                  <Play className="h-3 w-3 fill-current" aria-hidden />
                  Work through
                </button>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <span className="text-[12.5px] text-muted-foreground">Order:</span>
                <div className="inline-flex rounded-full border border-border bg-white p-px" role="radiogroup" aria-label="Order" data-testid="home-order">
                  {(["soonest", "ai"] as OrderChoice[]).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={order === c} onClick={() => pickOrder(c)} className={cn("rounded-full px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", order === c ? "bg-primary-soft text-primary-strong shadow-[inset_0_0_0_1.5px_var(--primary)]" : "text-heading hover:bg-slate-100")} data-testid={`home-order-${c}`}>
                      {c === "soonest" ? "Soonest first" : "By the AI"}
                    </button>
                  ))}
                </div>
                </span>
                <AiCardStar context={{ ...HOME_ASK, card: "Next actions" }} compose={askCompose} />
              </>
            }
            testId="now-actions"
            pinned
            scroll
            pinAt="desk"
            className="desk:min-h-0 desk:flex-1 desk:overscroll-contain"
          >
            <StickySections under="card" media={DESK} className="px-[22px] pb-3">
              {order === "ai" ? (
                <>
                  <div className={cn(BAND_CLS, "cursor-default flex-wrap justify-between gap-x-3 gap-y-1 text-violet")} data-testid="ai-order-heading">
                    <span>{aiOrder ? orderedAtLabel(aiOrder.createdAt, today, data.hourLocal) : ordering ? "Asking the AI for the order..." : "By the AI"}</span>
                    <span className="flex items-center gap-3 text-[12.5px] font-normal tracking-normal text-slate-400 normal-case">
                      {aiOrder ? <span className="hidden sm:inline">One reason under each row</span> : null}
                      <button type="button" onClick={() => askOrder(true)} disabled={ordering} className="font-medium text-violet hover:underline disabled:text-slate-400 disabled:no-underline" data-testid="ai-order-again">
                        {ordering ? <Thinking /> : aiOrder ? "Order again" : "Ask now"}
                      </button>
                    </span>
                  </div>
                  {orderError ? (
                    <p className="mt-3 rounded-lg border border-status-missed-border bg-status-missed-bg px-3.5 py-2 text-[13px] text-status-missed" role="alert" data-testid="ai-order-error">
                      {orderError.error}
                      {orderError.reply ? (
                        <>
                          {" "}
                          Its reply: <q className="text-slate-700 italic" data-testid="ai-order-error-reply">{orderError.reply}</q>
                        </>
                      ) : null}{" "}
                      Pick a tile to see the lists soonest first.{" "}
                      <button type="button" onClick={() => askOrder(true)} disabled={ordering} className="font-medium text-primary-strong hover:underline" data-testid="ai-order-retry">
                        Try again
                      </button>
                    </p>
                  ) : null}
                  {byAi ? (
                    aiList.length ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="ai-order-rows">
                        {aiList.map((r, n) => rowBox(r, n + 1))}
                      </div>
                    ) : (
                      <div className="-mx-[22px]">{empty(null)}</div>
                    )
                  ) : null}
                </>
              ) : selected ? (
                <div data-testid="home-list" data-section={selected}>
                  <ListBand name={TILE_LABEL[selected]} count={list.length} urgent={selected === "overdue"} testId="home-band" />
                  {list.length ? (
                    <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                      {list.map((r) => rowBox(r))}
                    </div>
                  ) : (
                    <div className="-mx-[22px]">{empty(selected)}</div>
                  )}
                </div>
              ) : null}
            </StickySections>
          </WorkCard>
        </div>

        <div className="flex min-w-0 flex-col gap-[18px] desk:h-full desk:overflow-y-auto desk:overscroll-contain desk:pb-0.5" data-testid="home-right">
          <WorkCard id="now-wait" title="Waiting on someone" count={waitCount} sub={`Amber at ${threshold} days, red at ${threshold * 2}`} testId="now-wait" pinned headerClassName="sticky top-0 z-[2]" className="max-h-[340px] shrink-0 overflow-y-auto overscroll-contain">
            {waitCount ? (
              <StickySections under="card" always className="px-[22px] pb-3">
                {waiting.map((w) => {
                  const closed = !waitOpen[w.key];
                  return (
                    <div key={w.key} data-testid="home-section" data-section={`wait-${w.key}`} data-collapsed={closed ? "1" : "0"}>
                      <SectionHeading name={w.label} count={w.deals.length} collapsed={closed} onToggle={() => setWaitOpen((m) => ({ ...m, [w.key]: !m[w.key] }))} band />
                      {w.deals.length && !closed ? (
                        <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                          {w.deals.map((deal) => (
                            <div key={deal.id} className="border-t border-slate-100 first:border-t-0" data-testid="home-row">
                              <WaitingRow deal={deal} followedUp={!!followedUp[deal.id]} onFollowUp={() => setFollowUp(deal)} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </StickySections>
            ) : (
              <p className="px-[22px] py-4 text-[13px] text-muted-foreground" data-testid="now-wait-empty">
                Nobody is keeping you waiting.
              </p>
            )}
          </WorkCard>

          <CalendarTile calendar={data.calendar} />
          <TargetsTodayTile tile={data.targets} />
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
      {working ? <WorkThrough steps={steps} today={today} onClose={() => setWorking(false)} /> : null}
    </BlockTimeProvider>
  );
}

/** A deal with no next action: the stage default as a hint and a link to set one on the deal page. */
function NeedsActionRow({ deal }: { deal: DealRow }) {
  const def = deal.stageName && (STAGE_DEFAULTS as Record<string, { hint: string }>)[deal.stageName as WorkStageName]?.hint;
  return (
    <RowShell
      testId="needs-action-row"
      dataAttrs={{ "data-deal": deal.id }}
      open={`/work/deals/${deal.id}`}
      openLabel={`Open ${deal.name}`}
      right={
        <>
          {def ? <span className="max-w-[260px] truncate text-xs text-muted-foreground" title={def}>Stage default: {def}</span> : null}
          <RowButtons pair>
            <RowLink href={`/work/deals/${deal.id}`} tone="cobalt" className="w-full" data-testid="set-next-action">
              Set next action
            </RowLink>
          </RowButtons>
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

/** The People tile (batch B; Outreach renamed in push B): the weekly counter with its bar, up to three people due today with Email and Log a call, the link, and the overdue count. */
function OutreachTile({ outreach, today, logged, onEmail, onCall }: { outreach: WorkNowData["outreach"]; today: string; logged: Record<string, string>; onEmail: (p: PersonRowData) => void; onCall: (p: PersonRowData) => void }) {
  return (
    <WorkCard title="Contacts" hint={`${outreach.due.length} due`} testId="home-outreach" pinned pinAt="desk">
      <TargetBar count={outreach.counter.count} target={outreach.counter.target} pct={outreach.counter.pct} className="py-2.5" testId="home-outreach-counter" />
      <div className="px-[22px] pb-1">
        <SectionHeading name="Due for follow-up today" count={outreach.dueToday.length} collapsed={false} className="mt-0" />
      </div>
      <div className="flex flex-col">
        {outreach.dueToday.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5 border-t border-slate-100 px-[22px] py-[9px]" data-testid="home-outreach-row" data-person={p.id}>
            <Line1>
              <Link href={personHref(p.id)} className="hover:underline">
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
        <Link href={PEOPLE_HREF} className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-outreach">
          Open Contacts
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

/**
 * The Targets today tile (batch C, approved 2026-10-31): two or three target lines (the Commitments first) with their
 * figure, Targets met this week, and End of day with its badge (5:30, Sent, Skipped) and the reasons-left line, then
 * Open End of day. Before database update 0025 it shows the update notice line.
 */
function TargetsTodayTile({ tile }: { tile: HomeData["targets"] }) {
  const eodTone: PillTone = tile.eod.state === "sent" ? "green" : tile.eod.state === "skipped" ? "gray" : "amber";
  return (
    <WorkCard title="Targets today" hint={tile.available ? (tile.lines.length ? "Counted from the app" : "No targets yet") : "Update needed"} testId="home-targets" pinned pinAt="desk">
      {!tile.available ? (
        <p className="px-[22px] py-3 text-[13px] text-muted-foreground" data-testid="home-targets-notice">
          {tile.notice ?? "Targets are not available yet."}
        </p>
      ) : (
        <>
          <div className="flex flex-col pt-1" data-testid="home-targets-rows">
            {tile.lines.map((l) => (
              <Link key={l.id} href="/work/targets" className="row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-slate-100 px-[22px] py-[10px] first:border-t-0" data-testid="home-target-line" data-target={l.name}>
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-slate-900">{l.name}</span>
                  <div className="text-[12.5px] text-slate-600 italic">{l.sub}</div>
                </div>
                <Figure value={l.figure} label={l.label} tone={l.tone === "missed" ? "red" : "plain"} className={cn("w-[82px]", l.tone === "met" && "[&>b]:text-status-met")} testId="home-target-figure" />
              </Link>
            ))}
            <Link href="/work/targets" className="row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-slate-100 px-[22px] py-[10px]" data-testid="home-targets-met">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-slate-900">Targets met</span>
                <div className="truncate text-[12.5px] text-slate-600 italic">{tile.met.names}</div>
              </div>
              <Figure value={`${tile.met.met} of ${tile.met.total}`} label="This week" className={cn("w-[82px]", tile.met.total && tile.met.met === tile.met.total && "[&>b]:text-status-met")} testId="home-targets-met-figure" />
            </Link>
            <Link href="/work/end-of-day" className="row-hover flex flex-col gap-0.5 border-t border-slate-100 px-[22px] py-[10px]" data-testid="home-eod" data-state={tile.eod.state}>
              <span className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-slate-900">End of day</span>
                <Pill tone={eodTone} testId="home-eod-pill">
                  {tile.eod.badge}
                </Pill>
              </span>
              <span className="text-[12.5px] text-slate-600 italic" data-testid="home-eod-line">
                {tile.eod.line}
              </span>
            </Link>
          </div>
          <div className="border-t border-slate-100 px-[22px] pt-2.5 pb-4">
            <Link href="/work/end-of-day" className="text-[13px] font-medium text-primary-strong hover:underline" data-testid="home-open-eod">
              Open End of day
            </Link>
          </div>
        </>
      )}
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
    <WorkCard title="Rosara" hint={rosara.open ? `${rosara.open} open` : "No projects"} testId="home-rosara" pinned pinAt="desk">
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
    <WorkCard title="Job search" hint={t.open ? `${t.open} open` : "None open"} testId="home-jobs" pinned pinAt="desk">
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
          <Link key={r.key} href={r.href} className="row-hover flex items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-[9px] text-sm text-slate-900" data-testid="jobs-row" data-key={r.key} data-count={r.n}>
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
          <Link key={l.id} href={`/work/deals/${l.id}`} className="row-hover flex flex-col gap-0.5 border-t border-slate-100 px-[22px] py-[9px]" data-testid="home-listing">
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
          <Link key={r.key} href={r.href} className="row-hover flex items-center justify-between gap-3 border-t border-slate-100 px-[22px] py-[9px] text-sm text-slate-900 first:border-t-0" data-testid="glance-row" data-key={r.key} data-count={r.n}>
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

"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { aiOrderToday } from "@/app/actions/ask-ai";
import { addToWaiting, dismissNoReply, followedUp as followedUpWait, removeWait } from "@/app/actions/waiting";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import { readRaw } from "@/lib/disclosure";
import { date as fmtDate } from "@/lib/format";
import type { AskContext } from "@/lib/work/ask-ai";
import type { DealRow, ListingTile, WorkNowData } from "@/lib/work/data";
import type { HomeData } from "@/lib/work/home-data";
import { actionKey, applyAiOrder, AREA_STORAGE_KEY, AREAS, areaOf, areaToStore, compareActions, HOME_SECTION_KEYS, HOME_TILE_KEYS, homeSectionOf, matchesActionSearch, ORDER_STORAGE_KEY, orderedAtLabel, orderToStore, parseAreaChoice, parseOrderChoice, parseTileChoice, TILE_STORAGE_KEY, tileToStore, type AiOrder, type AreaKey, type HomeAction, type HomeSectionKey, type HomeTileKey, type Lane, type OrderChoice } from "@/lib/work/lanes";
import { compareNames } from "@/lib/work/names";
import { contactKindLabel, orgRoleLine, overdueLabel } from "@/lib/work/outreach";
import type { PersonRow as PersonRowData } from "@/lib/work/outreach-data";
import { PEOPLE_HREF, personHref } from "@/lib/work/people";
import type { ItemRow } from "@/lib/work/pipelines-data";
import { dueThisWeekLabel } from "@/lib/work/projects";
import type { ProjectRow } from "@/lib/work/projects-data";
import { dueLabel, followUpDraft, STAGE_DEFAULTS, type WorkStageName } from "@/lib/work/stages";
import { personFollowUpDraft, waitGroups, waitItem, type NoReplyRow as NoReplyData, type WaitItem, type WaitItemLine } from "@/lib/work/waiting";
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
import { AreaChip, AreaSelector, type AreaOption } from "@/components/app/work/area-selector";
import { FindBox, TitleRow } from "@/components/app/work/title-row";
import { ActionFigures, BAND_CLS, Due, Figure, Line1, Line2, ListBand, Name, Pill, ProgressMark, RowButton, RowButtons, RowLink, RowShell, SectionHeading, TargetBar, Thinking, What, WorkCard, type PillTone } from "@/components/app/work/ui";
import { NoReplyRow, WaitingRow } from "@/components/app/work/waiting-row";
import { ShowAll } from "@/components/app/work/show-all";
import { OpenRow } from "@/components/app/work/open-row";
import { BlockTimeProvider } from "@/components/app/work/block-time";
import { CalendarTile } from "@/components/app/work/calendar-tile";
import { WorkThrough, type WorkStep } from "@/components/app/work/work-through";
import { recordPillText } from "@/lib/work/task-records";
import { blockSlots } from "@/components/app/work/block-time";
import type { MonthlyDue } from "@/lib/accountability/monthly-data";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Work on now (Home; the bento of mockup v6, approved 2026-10-31, with the header of 2026-11-04). The title row: the
 * title, the date, Find, Ask AI. Then five tiles that work like tabs over the Next actions column (All, Overdue,
 * Due today, Needs a next action, Due later; fix list items 2 and 3, 2026-11-06): All is selected by default and shows
 * every row in the four sections, each under its grey band; another tile shows only its list. The tile picked is kept
 * for the rest of the day. Above the tiles the Area selector picks one area or All (Deals, Contacts, Rosara,
 * Job search, Consulting, To-dos, Tasks); it narrows Next actions and its tile numbers, and is remembered for the rest
 * of the day only (each day starts on All).
 * Next actions merges every area (a deal row has no pill; the others carry an area pill). "Order: Soonest first | By
 * the AI": By the AI asks the AI once a day for the order (cached; "Order again" asks again), shows the full ranked list
 * of all three kinds with one purple reason under each row, and leaves no tile selected; a tile click goes back to
 * Soonest first. Each new day starts on Soonest first. Push C: the solid "Work through" button opens the step-by-step
 * window (work-through.tsx); every row with Done has the block icon (block-time.tsx) and "Blocked 2:00" under its date.
 * Right third, level with the tiles: Waiting on someone (never filtered; its groups start closed and the card scrolls
 * on its own; push E: deals and people in "N+ days" and "< N days", then "No reply yet", each showing 8 rows, then
 * Show all; push E2: one row per deal or person with a line per wait, in the group of its longest wait; edits of Nov 5:
 * the card and each group count the waits, not the rows, while Show all (N) counts the rows it opens), Today's calendar, Targets today, Contacts, Rosara, Job search, Screen listings, Deals at a
 * glance. In a desktop window at least 720px tall the two columns scroll inside; under 1024px or in a shorter window
 * the page scrolls, and the slim pinned bar slides in once the title row and the tiles are gone.
 *
 * Push D (approved 2026-11-04): from the first workday of a month until it is finished, the row "Monthly review:
 * October" leads Due today (Open goes to the review page; the block icon blocks time for it). It belongs to no single
 * area, so it shows under All only and counts in Due today's and All's numbers; it stays out of By the AI's ranking
 * and Work through (it is a page to open, not a Done).
 */
const HOME_ASK: AskContext = { page: "home", label: "Work on now" };
const noSubscribe = () => () => {};
const PANEL_ID = "now-actions-panel";
const FIND_ID = "home-find";
/** A desktop window tall enough for the cards to scroll on their own (the desk variant in globals.css); otherwise the page scrolls. */
const DESK = "(min-width: 1024px) and (min-height: 720px)";

type Row = { key: string; lane: Lane; area: AreaKey; section: HomeSectionKey; action: HomeAction; render: (reason: string | null) => React.ReactNode; /** Work through's view of the row (push C). */ step: WorkStep | null };

// Fix list items 2 and 3 (approved 2026-11-06): All first and selected by default, then the four sections.
const TILE_LABEL: Record<HomeTileKey, string> = { all: "All", overdue: "Overdue", today: "Due today", needs: "Needs a next action", later: "Due later" };
const TILE_EMPTY: Record<HomeTileKey, string> = { all: "Nothing to do.", overdue: "Nothing is overdue.", today: "Nothing else is due today.", needs: "Every item has a next action.", later: "Nothing is due later." };

export function HomeBoard({ data, dateLabel, askAi, tabs, composes, personComposes, askCompose }: { data: HomeData; /** The date at the right of the title, long and short. */ dateLabel: { long: string; short: string }; /** Ask AI (server-rendered). */ askAi: React.ReactNode; /** The top menu row (under 1024px). */ tabs: React.ReactNode; /** The email setup of each wait's Follow up (push E2: by the wait's id). */ composes: Record<string, ComposeSetup>; /** The email setup per person on the Outreach tile. */ personComposes: Record<string, ComposeSetup>; /** The email setup for "Open in email" in the Ask AI panel (a typed address). */ askCompose?: ComposeSetup | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [personEmail, setPersonEmail] = useState<PersonRowData | null>(null);
  const [personCall, setPersonCall] = useState<PersonRowData | null>(null);
  const [personLogged, setPersonLogged] = useState<Record<string, string>>({});
  /** Deals and people followed up on this visit (by row key): the row keeps its "Followed up" line after it moves under the threshold. */
  const [followedUp, setFollowedUp] = useState<Record<string, boolean>>({});
  /** The waiting row whose Follow up editor is open (held here, so the editor survives the row moving after the send). */
  const [followUp, setFollowUp] = useState<{ item: WaitItem; line: WaitItemLine } | null>(null);
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

  // ---------- The Area selector: one area or All, remembered for the rest of the day only ----------
  const savedArea = useSyncExternalStore(noSubscribe, () => parseAreaChoice(readRaw(AREA_STORAGE_KEY), today), () => null);
  const [chosenArea, setChosenArea] = useState<{ area: AreaKey | null } | null>(null);
  const area = chosenArea ? chosenArea.area : savedArea;

  // ---------- The rows of every area ----------
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (lane: Lane, area: AreaKey, action: HomeAction, render: Row["render"], step: WorkStep | null = null) => {
      const section = homeSectionOf(action, today);
      if (section) out.push({ key: action.key, lane, area, section, action, render, step });
    };
    // Edit batch C round 3: a listing to screen with a next action (optional on a listing) shows with the deals.
    for (const d of [...deals, ...(data.listingActions ?? [])]) {
      push("Deals", "deals", { key: actionKey("Deals", d.id), lane: "Deals", id: d.id, name: d.name, action: d.nextAction, due: d.nextActionDue, minutes: d.nextActionMinutes, meta: [d.stageName, d.whatItDoes, d.location].filter(Boolean).join(", ") }, (reason) => (d.nextAction ? <NextActionRow deal={d} today={today} reason={reason} /> : <NeedsActionRow deal={d} />), d.nextAction ? { kind: "deal", key: actionKey("Deals", d.id), deal: d } : null);
    }
    // Fix list item 3: people with a follow-up after today are Due later rows.
    for (const p of [...data.outreach.due, ...(data.outreach.later ?? [])]) {
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
    // Fix list item 3: items due after today are Due later rows.
    for (const t of [...data.todos, ...(data.laterTodos ?? [])]) {
      push("To-dos", areaOf("To-dos", !!t.record), { key: actionKey("To-dos", t.id), lane: "To-dos", id: t.id, name: t.text, action: t.text, due: t.dueOn, minutes: null, meta: t.record ? recordPillText(t.record) : "Personal to-do" }, (reason) => <TodoActionRow todo={t} today={today} reason={reason} />, { kind: "todo", key: actionKey("To-dos", t.id), todo: t });
    }
    return out;
  }, [deals, data.listingActions, data.outreach.due, data.outreach.later, data.rosara.actions, data.pipelines.jobs, data.pipelines.consulting, data.todos, data.laterTodos, today]);
  const rows = useMemo(() => allRows.filter((r) => !area || r.area === area), [allRows, area]);

  // The four lists, each sorted (Soonest first; Due later soonest first too); the tile numbers follow the Area choice, not Find.
  const sectionsOf = useMemo(() => {
    const by: Record<HomeSectionKey, Row[]> = { overdue: [], today: [], needs: [], later: [] };
    for (const r of rows) by[r.section].push(r);
    by.overdue.sort((a, b) => compareActions(a.action, b.action));
    by.today.sort((a, b) => compareActions(a.action, b.action));
    by.needs.sort((a, b) => compareNames(a.action.name, b.action.name));
    by.later.sort((a, b) => compareActions(a.action, b.action));
    return by;
  }, [rows]);
  // Push D: the Monthly review row, under the All area only (it belongs to no single area). Fix list item 4
  // (2026-11-06): it sits first under Due later ("Open since Nov 2") and no longer counts in Due today.
  const review = data.monthlyReview;
  const reviewShown = !!review && !area && matchesActionSearch({ name: `Monthly review: ${review.name}`, meta: "review export targets" }, query);
  const reviewCount = review && !area ? 1 : 0;
  const sectionCount = (k: HomeSectionKey) => sectionsOf[k].length + (k === "later" ? reviewCount : 0);
  const tiles: Tile<HomeTileKey>[] = HOME_TILE_KEYS.map((k) => ({ key: k, label: TILE_LABEL[k], count: k === "all" ? HOME_SECTION_KEYS.reduce((n, x) => n + sectionCount(x), 0) : sectionCount(k), red: k === "overdue" }));
  const found = (r: Row) => matchesActionSearch(r.action, query);

  // ---------- The tiles: the choice is kept for the rest of the day (like Area); each day starts on All ----------
  const savedTile = useSyncExternalStore(noSubscribe, () => parseTileChoice(readRaw(TILE_STORAGE_KEY), today), () => null);
  const [chosenTile, setChosenTile] = useState<HomeTileKey | null>(null);
  const selected = selectedTile(chosenTile ?? savedTile, tiles, order);
  const keepTile = (k: HomeTileKey) => {
    setChosenTile(k);
    try {
      window.localStorage.setItem(TILE_STORAGE_KEY, tileToStore(k, today));
    } catch {
      /* no storage: the choice holds until the page reloads */
    }
  };
  const pickTile = (k: HomeTileKey) => {
    const next = clickTile({ order, selected }, k);
    if (!next.changed) return;
    if (order !== next.order) pickOrder(next.order);
    keepTile(next.selected);
    toListTop();
  };
  const pickArea = (a: AreaKey | null) => {
    setChosenArea({ area: a });
    try {
      window.localStorage.setItem(AREA_STORAGE_KEY, areaToStore(a, today));
    } catch {
      /* no storage: the choice holds until the page reloads */
    }
    // An area that leaves the selected tile at 0 selects the first tile with items (All, while anything is left).
    const nextRows = allRows.filter((r) => !a || r.area === a);
    const nextCount = (k: HomeTileKey) => (k === "all" ? nextRows.length : nextRows.filter((r) => r.section === k).length) + ((k === "later" || k === "all") && review && !a ? 1 : 0);
    const nextTiles = HOME_TILE_KEYS.map((k) => ({ key: k, count: nextCount(k) }));
    if (selected) {
      const t = tileAfterFilter(selected, nextTiles);
      if (t !== selected) keepTile(t);
    }
    toListTop();
  };
  // The choices with their numbers (every next action in that area, as the tiles count them).
  const areaOptions: AreaOption<AreaKey>[] = [{ value: null, label: "All", count: allRows.length + (review ? 1 : 0) }, ...AREAS.map((x) => ({ value: x.value, label: x.label, count: allRows.filter((r) => r.area === x.value).length }))];

  // ---------- Waiting on someone: never filtered (push E: deals and people, and No reply yet) ----------
  /** No reply rows and wait lines saved away on this visit (Add to Waiting, Dismiss, Clear): gone at once, before the page re-reads. */
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [waitBusy, setWaitBusy] = useState<string | null>(null);
  const [waitError, setWaitError] = useState<string | null>(null);
  // A row whose last line was cleared goes; a row with lines left keeps its place by its longest remaining wait.
  const waitItems = useMemo(() => data.waiting.items.map((w) => waitItem({ key: w.key, kind: w.kind, id: w.id, name: w.name, href: w.href, context: w.context }, w.lines.filter((l) => !gone[l.waitId]))).filter((w): w is WaitItem => !!w), [data.waiting.items, gone]);
  const noReply = useMemo(() => data.waiting.noReply.filter((r) => !gone[r.commId]), [data.waiting.noReply, gone]);
  const waiting = useMemo(() => waitGroups(waitItems, threshold), [waitItems, threshold]);
  // Edits of Nov 5: the card and each group count the waits (a deal with two waits counts 2), not the rows.
  const waitsIn = (list: readonly WaitItem[]) => list.reduce((n, w) => n + w.lines.length, 0);
  const waitCount = waitsIn(waitItems);
  const [waitOpen, setWaitOpen] = useState<Record<string, boolean>>({});
  const waitSave = (key: string, save: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setWaitError(null);
    setWaitBusy(key);
    void save().then((r) => {
      setWaitBusy(null);
      if (!r.ok) return setWaitError(r.error);
      setGone((m) => ({ ...m, [key]: true }));
      router.refresh();
    });
  };
  type WaitLine = { key: string; item: WaitItem | null; mail: NoReplyData | null };
  const waitGroupList: { key: string; label: string; count: number; rows: WaitLine[] }[] = [
    ...waiting.map((w) => ({ key: w.key, label: w.label, count: waitsIn(w.items), rows: w.items.map((it) => ({ key: it.key, item: it, mail: null })) })),
    { key: "no-reply", label: "No reply yet", count: noReply.length, rows: noReply.map((r) => ({ key: r.commId, item: null, mail: r })) },
  ];

  const shownCount = rows.filter(found).length + (reviewShown ? 1 : 0);
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

  const narrowed = !!area || !!query.trim();
  // The line under Next actions names the chosen area (or "Every area" on All).
  const areaWord = area ? (AREAS.find((x) => x.value === area)?.label ?? "Every area") : "Every area";
  const empty = (k: HomeTileKey | null) => (
    <div className="px-[22px] py-[22px] text-[13px] text-muted-foreground" data-testid="now-actions-empty">
      <b className="mb-0.5 block text-[13.5px] font-semibold text-heading">{narrowed ? "Nothing matches." : k ? TILE_EMPTY[k] : "Nothing is due today."}</b>
      {narrowed ? "Pick All above or clear the Find box." : "Pick another tile above."}
    </div>
  );
  const list = selected && selected !== "all" ? sectionsOf[selected].filter(found) : [];
  /** One section with its grey band and count badge; Due later starts with the Monthly review row when it is open. */
  const sectionBlock = (k: HomeSectionKey, rowsIn: Row[], solo: boolean) => {
    const withReview = k === "later" && reviewShown && !!review;
    const count = rowsIn.length + (withReview ? 1 : 0);
    return (
      <div key={k} data-testid={solo ? "home-list" : "home-all-section"} data-section={k}>
        <ListBand name={TILE_LABEL[k]} count={count} urgent={k === "overdue"} testId={solo ? "home-band" : "home-all-band"} />
        {count ? (
          <div className="-mx-[22px] flex flex-col" data-testid="section-body">
            {withReview && review ? <MonthlyReviewRow review={review} /> : null}
            {rowsIn.map((r) => rowBox(r))}
          </div>
        ) : solo ? (
          <div className="-mx-[22px]">{empty(k)}</div>
        ) : null}
      </div>
    );
  };
  const allFoundCount = HOME_SECTION_KEYS.reduce((n, k) => n + sectionsOf[k].filter(found).length, 0) + (reviewShown ? 1 : 0);
  const aiList = aiRows.filter(found);

  return (
    <BlockTimeProvider today={today} nowLocal={data.nowLocal} blockMinutes={data.blockMinutes} rowBlocks={data.rowBlocks} calendar={data.calendar}>
      <SlimBar
        title="Work on now"
        chips={
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <AreaChip options={areaOptions} selected={area} onPick={pickArea} />
            <TileChips tiles={tiles} selected={selected} onPick={pickTile} label="Next actions" idPrefix="home-chip" panelId={PANEL_ID} />
          </div>
        }
        tools={<SlimTools findId={FIND_ID} />}
      />
      <header className="pb-5" data-testid="home-header">
        <TitleRow
          title="Work on now"
          date={dateLabel}
          tools={<FindBox id={FIND_ID} value={query} onChange={setQuery} testId="home-search" />}
          askAi={askAi}
        />
        {tabs}
        <div className="mt-4" data-testid="home-area">
          <AreaSelector options={areaOptions} selected={area} onPick={pickArea} />
        </div>
      </header>

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
            lead={
                <button type="button" onClick={() => setWorking(true)} disabled={!steps.length} className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-primary-solid bg-primary-solid px-3 text-[13px] font-medium whitespace-nowrap text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover disabled:opacity-50" data-testid="work-through-open" title={steps.length ? `Step through the ${steps.length} due today or earlier, one at a time` : "Nothing is due today"}>
                  <Play className="h-3 w-3 fill-current" aria-hidden />
                  Work through
                </button>
            }
            sub={`${areaWord}, ${byAi ? "in the AI's order; one reason under each row" : "soonest first"}`}
            actions={
              <>
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
                    aiList.length || reviewShown ? (
                      <div className="-mx-[22px] flex flex-col" data-testid="ai-order-rows">
                        {reviewShown && review ? <MonthlyReviewRow review={review} /> : null}
                        {aiList.map((r, n) => rowBox(r, n + 1))}
                      </div>
                    ) : (
                      <div className="-mx-[22px]">{empty(null)}</div>
                    )
                  ) : null}
                </>
              ) : selected === "all" ? (
                // Fix list item 2: under All, every row in four sections, in tile order, each under its grey band.
                allFoundCount ? (
                  <div data-testid="home-all" data-section="all">
                    {HOME_SECTION_KEYS.map((k) => sectionBlock(k, sectionsOf[k].filter(found), false))}
                  </div>
                ) : (
                  <div className="-mx-[22px]" data-testid="home-all" data-section="all">
                    {empty("all")}
                  </div>
                )
              ) : selected ? (
                sectionBlock(selected, list, true)
              ) : null}
            </StickySections>
          </WorkCard>
        </div>

        <div className="flex min-w-0 flex-col gap-[18px] desk:h-full desk:overflow-y-auto desk:overscroll-contain desk:pb-0.5" data-testid="home-right">
          <WorkCard id="now-wait" title="Waiting on someone" count={waitCount} sub="Items waiting on external parties" testId="now-wait" pinned headerClassName="sticky top-0 z-[2]" className="max-h-[340px] shrink-0 overflow-y-auto overscroll-contain">
            {waitError ? (
              <p className="border-b border-status-missed-border bg-status-missed-bg px-[22px] py-2 text-[13px] text-status-missed" role="alert" data-testid="now-wait-error">
                {waitError}
              </p>
            ) : null}
            {waitCount || noReply.length ? (
              <StickySections under="card" always className="px-[22px] pb-3">
                {waitGroupList.map((w) => {
                  const closed = !waitOpen[w.key];
                  return (
                    <div key={w.key} data-testid="home-section" data-section={`wait-${w.key}`} data-collapsed={closed ? "1" : "0"}>
                      <SectionHeading name={w.label} count={w.count} collapsed={closed} onToggle={() => setWaitOpen((m) => ({ ...m, [w.key]: !m[w.key] }))} band />
                      {w.count && !closed ? (
                        <ShowAll
                          items={w.rows}
                          testId={`wait-${w.key}-all`}
                          title={`Waiting on someone · ${w.label}`}
                          sub={w.key === "no-reply" ? `Emails the app sent with no reply after ${data.waiting.noReplyDays} ${data.waiting.noReplyDays === 1 ? "day" : "days"}` : undefined}
                          text={(r) => (r.item ? `${r.item.name} ${r.item.lines.map((l) => `${l.waitingOn} ${l.who ?? ""}`).join(" ")}` : `${r.mail?.subject ?? ""} ${r.mail?.to ?? ""} ${r.mail?.recordName ?? ""}`)}
                          wrap={(rows) => (
                            <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                              {rows}
                            </div>
                          )}
                          render={(r) => (
                            <div key={r.key} className="border-t border-slate-100 first:border-t-0" data-testid="home-row">
                              {r.item ? (
                                <WaitingRow item={r.item} followedUp={followedUp} onFollowUp={(line) => setFollowUp({ item: r.item!, line })} onClear={(line) => waitSave(line.waitId, () => removeWait(line.waitId))} clearing={waitBusy} />
                              ) : r.mail ? (
                                <NoReplyRow row={r.mail} busy={waitBusy === r.mail.commId} onAdd={() => waitSave(r.mail!.commId, () => addToWaiting(r.mail!.commId))} onDismiss={() => waitSave(r.mail!.commId, () => dismissNoReply(r.mail!.commId))} />
                              ) : null}
                            </div>
                          )}
                        />
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
      {followUp && composes[followUp.line.waitId] ? (
        <ComposeEmailDialog
          key={followUp.line.waitId}
          setup={composes[followUp.line.waitId]}
          open
          ask={{ page: followUp.item.kind === "deal" ? "deal" : "person", recordId: followUp.item.id, label: followUp.item.name }}
          onOpenChange={(o) => {
            if (!o) setFollowUp(null);
          }}
          initial={followUp.item.kind === "deal" ? followUpDraft({ dealName: followUp.item.name, waitingOn: followUp.line.waitingOn, contactName: followUp.line.contactName, days: followUp.line.days, signName: composes[followUp.line.waitId]?.signName }) : personFollowUpDraft({ name: followUp.item.name, waitingOn: followUp.line.waitingOn, days: followUp.line.days, signName: composes[followUp.line.waitId]?.signName })}
          onSent={async () => {
            // Push E2: that wait starts again today and also watches the follow-up email.
            await followedUpWait(followUp.line.waitId);
            setFollowedUp((m) => ({ ...m, [followUp.line.waitId]: true }));
          }}
        />
      ) : null}
      {working ? <WorkThrough steps={steps} today={today} onClose={() => setWorking(false)} /> : null}
    </BlockTimeProvider>
  );
}

/**
 * The Monthly review row (push D, approved mockup V.home "This month"): the gray Review pill, "Monthly review:
 * October", the line under it, "Today" on the first workday (then "Since Nov 2"), 15 min, the block icon, and Open.
 * A click on the row opens the review too.
 */
function MonthlyReviewRow({ review }: { review: MonthlyDue }) {
  const href = `/work/reports/monthly/${review.slug}?from=home`;
  // Fix list item 4 (2026-11-06): under Due later, "Open since Nov 2" (the month's first workday).
  const due = { text: `Open since ${fmtDate(review.opensOn, "MMM d")}`, tone: "later" as const, wrap: true };
  return (
    <div className="border-t border-slate-100 first:border-t-0" data-testid="home-row" data-lane="review" data-area="all" data-key={`review:${review.slug}`} data-section="later">
      <RowShell
        testId="monthly-review-home-row"
        dataAttrs={{ "data-month": review.slug }}
        open={href}
        openLabel={`Open the monthly review of ${review.name}`}
        right={
          <ActionFigures due={due} minutes={15} block={blockSlots({ rowKey: `review:${review.slug}`, lane: "Review", name: `Monthly review: ${review.name}`, action: `See how ${review.name} went, set ${review.nextName}'s targets, download the export`, minutes: 15, recordType: null, recordId: null, href: "/work/reports?view=monthly" })}>
            <RowButtons pair>
              <RowLink href={href} tone="cobalt" className="w-full" data-testid="monthly-review-open">
                Open
              </RowLink>
            </RowButtons>
          </ActionFigures>
        }
      >
        <Line1>
          <Pill tone="gray" testId="lane-pill">
            Review
          </Pill>
          <Link href={href} className="hover:underline">
            <Name>Monthly review: {review.name}</Name>
          </Link>
        </Line1>
        <Line2>
          See how {review.name} went, set {review.nextName}&apos;s targets and commitments, download the export
        </Line2>
      </RowShell>
    </div>
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
          // Push D (fix): a click anywhere on the row (outside Email, Log a call, and the name link) opens the person page.
          <OpenRow key={p.id} href={personHref(p.id)} label={`Open ${p.name}`} className="flex flex-col gap-1.5 border-t border-slate-100 px-[22px] py-[9px]" testId="home-outreach-row" dataAttrs={{ "data-person": p.id }}>
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
          </OpenRow>
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
    { key: "wait", label: `Waiting ${threshold}+ days`, n: glance.waitingOver, href: "/work/deals?filter=wait", warn: true },
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

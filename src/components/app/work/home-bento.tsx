"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeData } from "@/lib/work/home-data";
import type { WaitingBoard } from "@/lib/work/waiting-data";
import type { TargetsTile } from "@/lib/accountability/data";
import type { DayCalendar } from "@/lib/work/calendar-data";
import type { PrioritiesData } from "@/lib/work/priorities-data";
import type { ComposeSetup } from "@/lib/compose-email";
import { PRIORITY_TRACKS, MAX_PICKS, type PriorityKind, type PriorityPick } from "@/lib/work/priorities";
import { compareActions, type HomeSectionKey, type HomeTileKey } from "@/lib/work/lanes";
import { dueLabel } from "@/lib/work/stages";
import { todoDueLabel } from "@/lib/work/personal-todos";
import { recordHref } from "@/lib/work/task-records";
import { personHref, PEOPLE_HREF } from "@/lib/work/people";
import { contactKindLabel, orgRoleLine } from "@/lib/work/outreach";
import { date as fmtDate } from "@/lib/format";
import { buildHomeRows, HomeBoard, TargetsTodayTile, WaitingCard, type Row, type WaitingCardData } from "@/components/app/work/home-board";
import { HomeDayCalendar } from "@/components/app/work/home-day-calendar";
import { BlockTimeProvider } from "@/components/app/work/block-time";
import { WorkThrough, type WorkStep } from "@/components/app/work/work-through";
import { FindBox, TitleRow } from "@/components/app/work/title-row";
import { LargeWindow } from "@/components/app/work/large-window";
import { useContactActions } from "@/components/app/work/contact-actions";
import { TodoActionRow } from "@/components/app/work/todo-row";
import { cn } from "@/lib/utils";

/** The full list page, still reachable (the old checks use it); Home opens the same list in a large window. */
export const NEXT_ACTIONS_HREF = "/work/next-actions";
const FIND_ID = "home-find";

/** What a large window over Home shows (Bram, 2026-11-17, decisions 6 and 9). */
type Win = { kind: "next"; tile: HomeTileKey } | { kind: "contacts" } | { kind: "todos" } | { kind: "waiting" } | { kind: "targets" } | null;
const NEXT_TITLE: Record<HomeTileKey, string> = { all: "Next actions", overdue: "Next actions · Overdue", today: "Next actions · Today", needs: "Next actions · Needs a next action", later: "Next actions · Later" };

/**
 * Home, "Work on now" (layout v5 of the Home redesign, approved by Bram 2026-11-17 3:41 pm; mockup
 * 2026-11-17-home-layout-v5-laptop-1440.png; decisions 8 to 23 of claude/2026-11-17-home-redesign-build-plan.md).
 * A bento of calm cards on a warm off-white page, the calendar down the right side as tall as the cards:
 * - Next actions (Overdue and Today open with their first row, Later closed; Work through, Open all) beside Contacts
 *   due today (exactly as tall; its rows scroll inside).
 * - To-dos and Waiting on someone (layout v8), then Targets today and Top priorities (3 rows each, scrolling inside).
 * - Then Screen listings, Rosara, Job search, Consulting. (Deals and End of day left Home, decision 25.)
 * Every list card has Open: a large window, 20% down the screen, with the whole list and its buttons (Done, Later,
 * Block time; Email, Log a call, Log a meeting; Follow up). Colors as named in globals.css (`.home-v2`). On the phone
 * the cards stack in one column, the calendar after Next actions and Contacts.
 */
export function HomeBento({ data, priorities, waitingCard, personComposes, askCompose, dateLabel, askAi, tabs }: { data: HomeData; priorities: PrioritiesData; /** Waiting on someone with each wait's Follow up email setup; arrives after the page. */ waitingCard: Promise<WaitingCardData>; /** The email setup per person due (Contacts window). */ personComposes: Record<string, ComposeSetup>; askCompose: ComposeSetup; dateLabel: { long: string; short: string }; askAi: React.ReactNode; tabs: React.ReactNode }) {
  const router = useRouter();
  const [find, setFind] = useState("");
  const [win, setWin] = useState<Win>(null);
  const { today } = data;
  const close = (o: boolean) => {
    if (!o) setWin(null);
  };
  return (
    <BlockTimeProvider today={today} nowLocal={data.nowLocal} blockMinutes={data.blockMinutes} rowBlocks={data.rowBlocks} calendar={data.calendar}>
      <div className="home-v2 flex flex-col" data-testid="home-v2">
        <header className="pb-2.5" data-testid="home-header">
          <TitleRow
            title="Work on now"
            date={dateLabel}
            tools={
              <form
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  router.push(`${NEXT_ACTIONS_HREF}${find.trim() ? `?find=${encodeURIComponent(find.trim())}` : ""}`);
                }}
              >
                <FindBox id={FIND_ID} value={find} onChange={setFind} placeholder="Find a next action" testId="home-search" />
              </form>
            }
            askAi={askAi}
          />
          {tabs}
        </header>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(270px,23%)] lg:gap-x-5" data-testid="home-bento">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.55fr_1fr] lg:col-start-1" data-testid="home-row-1">
            <NextActionsCard data={data} onOpen={(tile) => setWin({ kind: "next", tile })} />
            <ContactsCard data={data} onOpen={() => setWin({ kind: "contacts" })} />
          </div>
          <div className="relative min-h-[560px] lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:min-h-0" data-testid="home-calendar-column">
            <div className="flex h-full flex-col lg:absolute lg:inset-0">
              <Suspense fallback={<CalendarWaiting />}>
                <Arrived value={data.calendar} render={(c: DayCalendar) => <HomeDayCalendar calendar={c} nowLocal={data.nowLocal} blockHref={NEXT_ACTIONS_HREF} />} />
              </Suspense>
            </div>
          </div>
          {/* Layout v8 (Bram, 2026-11-17): To-dos and Waiting share row 2 with row 1's split; row 3 is a deliberate stagger. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.55fr_1fr] lg:col-start-1" data-testid="home-row-2">
            <TodosCard data={data} onOpen={() => setWin({ kind: "todos" })} />
            <Suspense fallback={<Loading title="Waiting on someone" testId="home-waiting" />}>
              <Arrived value={data.waiting} render={(w: WaitingBoard) => <WaitingSummary board={w} threshold={data.threshold} onOpen={() => setWin({ kind: "waiting" })} />} />
            </Suspense>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.55fr] lg:col-start-1" data-testid="home-row-3">
            <Suspense fallback={<Loading title="Targets today" testId="home-targets" />}>
              <Arrived value={data.targets} render={(t: TargetsTile) => <TargetsCard tile={t} onOpen={() => setWin({ kind: "targets" })} />} />
            </Suspense>
            <PrioritiesCard data={priorities} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:col-start-1" data-testid="home-row-4">
            <ListingsCard data={data} />
            <RosaraCard data={data} />
            <JobsCard data={data} />
            <ConsultingCard data={data} />
          </div>
        </div>
      </div>
      <LargeWindow open={win?.kind === "next"} onOpenChange={close} title={win?.kind === "next" ? NEXT_TITLE[win.tile] : "Next actions"} testId="window-next">
        {win?.kind === "next" ? <HomeBoard key={win.tile} data={data} listOnly startTile={win.tile} dateLabel={dateLabel} askAi={null} tabs={null} waitingCard={waitingCard} personComposes={personComposes} askCompose={askCompose} /> : null}
      </LargeWindow>
      <LargeWindow open={win?.kind === "contacts"} onOpenChange={close} title="Contacts due today" sub="Everyone due today or overdue" actions={<WindowLink href={PEOPLE_HREF}>Open Contacts</WindowLink>} testId="window-contacts">
        {win?.kind === "contacts" ? <ContactsWindow data={data} composes={personComposes} /> : null}
      </LargeWindow>
      <LargeWindow open={win?.kind === "todos"} onOpenChange={close} title="To-dos" sub="Due today or earlier, then later" actions={<WindowLink href="/work/todos">Open To-dos</WindowLink>} testId="window-todos">
        {win?.kind === "todos" ? <TodosWindow data={data} /> : null}
      </LargeWindow>
      <LargeWindow open={win?.kind === "waiting"} onOpenChange={close} title="Waiting on someone" testId="window-waiting">
        {win?.kind === "waiting" ? (
          <Suspense fallback={null}>
            <WaitingCard data={waitingCard} threshold={data.threshold} className="border-0 shadow-none" />
          </Suspense>
        ) : null}
      </LargeWindow>
      <LargeWindow open={win?.kind === "targets"} onOpenChange={close} title="Targets today" actions={<WindowLink href="/work/targets">Open Targets</WindowLink>} testId="window-targets">
        {win?.kind === "targets" ? (
          <Suspense fallback={null}>
            <Arrived value={data.targets} render={(t: TargetsTile) => <TargetsTodayTile tile={t} />} />
          </Suspense>
        ) : null}
      </LargeWindow>
    </BlockTimeProvider>
  );
}

function WindowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-8 items-center rounded-[6px] px-2 text-[12.5px] text-[#635d58] underline decoration-[#d6d3d1] underline-offset-[3px] hover:text-[#1c1917]">
      {children}
    </Link>
  );
}

/** Shows a part of Home once its data has arrived (page speed 2026-11-07); until then the Suspense placeholder shows. */
function Arrived<T>({ value, render }: { value: Promise<T>; render: (v: T) => React.ReactNode }) {
  return <>{render(use(value))}</>;
}

// ---------- The card frame ----------

const CARD = "flex min-w-0 flex-col rounded-[10px] border border-[var(--h-line)] bg-white px-[18px] py-[11px]";
const CARD_LINK = "transition-colors hover:border-[#d6d3d1] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** A small card that opens its page: the title (and a quiet figure at the right), then its lines. */
function CardLink({ href, title, right, children, testId, small = false }: { href: string; title: string; right?: React.ReactNode; children: React.ReactNode; testId: string; small?: boolean }) {
  return (
    <Link href={href} className={cn(CARD, CARD_LINK, small && "py-3")} data-testid={testId}>
      <CardTitle title={title} right={right} />
      {children}
    </Link>
  );
}

function CardTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="truncate text-[13px] font-semibold">{title}</h2>
      {right ? <span className="shrink-0 text-[12px] text-[var(--h-ink2)]">{right}</span> : null}
    </div>
  );
}

function Sub({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("mt-2 text-[12px] leading-[1.45] text-[var(--h-ink2)]", className)} data-testid={testId}>
      {children}
    </div>
  );
}

function Loading({ title, testId }: { title: string; testId: string }) {
  return (
    <div className={CARD} data-testid={`${testId}-loading`} aria-busy="true" aria-label={`${title} is loading`}>
      <CardTitle title={title} />
      <div className="mt-3.5 h-[18px] w-10 rounded bg-[var(--h-hair)]" />
      <div className="mt-2.5 h-[8px] w-3/4 rounded bg-[var(--h-hair)]" />
    </div>
  );
}

function CalendarWaiting() {
  return (
    <div className={cn(CARD, "min-h-[560px] lg:min-h-0 lg:flex-1")} data-testid="home-calendar-loading" aria-busy="true" aria-label="Today's calendar is loading">
      <CardTitle title="Today" />
    </div>
  );
}

// ---------- Next actions (decisions 13, 15, 20) ----------

const SECTIONS: { key: "overdue" | "today" | "later"; word: string; color: string; open: boolean }[] = [
  { key: "overdue", word: "Overdue", color: "var(--h-late)", open: true },
  { key: "today", word: "Today", color: "var(--h-today)", open: true },
  { key: "later", word: "Later", color: "var(--h-ink2)", open: false },
];

/**
 * Next actions: Overdue and Today open with their first row, Later closed (its arrow opens it to 1 row); each heading
 * has its count and Open (the large window with that section's whole list); "N more" opens the same window. Work
 * through steps through the due actions one at a time; Open all opens the whole list with the areas and the order.
 */
function NextActionsCard({ data, onOpen }: { data: HomeData; onOpen: (tile: HomeTileKey) => void }) {
  const { today } = data;
  const rows = useMemo(() => buildHomeRows(data), [data]);
  const by = useMemo(() => {
    const out: Record<HomeSectionKey, Row[]> = { overdue: [], today: [], needs: [], later: [] };
    for (const r of rows) out[r.section].push(r);
    out.overdue.sort((a, b) => compareActions(a.action, b.action));
    out.today.sort((a, b) => compareActions(a.action, b.action));
    out.later.sort((a, b) => compareActions(a.action, b.action));
    return out;
  }, [rows]);
  const steps = useMemo(() => [...by.overdue, ...by.today].map((r) => r.step).filter((x): x is WorkStep => !!x), [by]);
  const [working, setWorking] = useState(false);
  const [openSec, setOpenSec] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map((s) => [s.key, s.open])));
  const [run, setRun] = useState<{ key: string; which: "done" | "later" } | null>(null);
  const shown = SECTIONS.filter((s) => openSec[s.key]).flatMap((s) => by[s.key].slice(0, 1));
  // A row that left the card (saved) ends its run, so it never presses again if it comes back later.
  if (run && !shown.some((r) => r.key === run.key)) setRun(null);
  const linkBtn = "text-[11.5px] text-[var(--h-ink2)] underline decoration-[#d6d3d1] underline-offset-[3px] hover:text-[var(--h-ink)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <section className={CARD} data-testid="home-next" aria-labelledby="home-next-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-next-title" className="text-[13px] font-semibold">
          Next actions
        </h2>
        <div className="flex items-center gap-3">
          {steps.length ? (
            <button type="button" onClick={() => setWorking(true)} className="rounded-[6px] border border-[var(--h-ink)] bg-[var(--h-ink)] px-2.5 py-1 text-[12px] text-[#fafaf9] hover:bg-[#292524] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="work-through-open">
              Work through
            </button>
          ) : null}
          <button type="button" onClick={() => onOpen("all")} className={linkBtn} aria-label="Open all next actions" data-testid="home-next-all">
            Open all
          </button>
        </div>
      </div>
      {SECTIONS.map((s, i) => {
        const list = by[s.key];
        const open = openSec[s.key];
        // Later also counts the Monthly review row while it is open (it shows first under Due later in the window).
        const count = list.length + (s.key === "later" && data.monthlyReview ? 1 : 0);
        return (
          <div key={s.key} className={i === 0 ? "mt-2" : s.key === "today" ? "mt-3.5" : "mt-2.5"} data-testid="home-next-section" data-section={s.key} data-open={open ? "1" : "0"}>
            <div className={cn("flex items-center justify-between gap-3 pb-1", open && "border-b border-[#f0efed]")}>
              <button type="button" onClick={() => setOpenSec((m) => ({ ...m, [s.key]: !m[s.key] }))} aria-expanded={open} className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.07em] uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" style={{ color: s.color }} data-testid="home-next-toggle">
                <span aria-hidden className="inline-block w-2.5 text-[9px] text-[var(--h-faint)]">
                  {open ? "▾" : "▸"}
                </span>
                {s.word} · <span data-testid="home-next-count">{count}</span>
              </button>
              <button type="button" onClick={() => onOpen(s.key)} className={linkBtn} aria-label={`Open ${s.word} next actions`} data-testid="home-next-open">
                Open
              </button>
            </div>
            {open ? (
              list.length ? (
                <>
                  {list.slice(0, 1).map((r) => (run?.key === r.key ? <RunRow key={r.key} row={r} which={run.which} onClose={() => setRun(null)} /> : <NextRow key={r.key} row={r} today={today} onRun={(which) => setRun({ key: r.key, which })} />))}
                  {list.length > 1 ? (
                    <button type="button" onClick={() => onOpen(s.key)} className="pt-1 text-[11.5px] text-[var(--h-ink2)] hover:text-[var(--h-ink)] hover:underline" data-testid="home-next-more">
                      {list.length - 1} more
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="pt-1.5 text-[12px] text-[var(--h-faint)]" data-testid="home-next-empty">
                  {s.key === "overdue" ? "Nothing is overdue." : s.key === "today" ? "Nothing else is due today." : "Nothing is due later."}
                </p>
              )
            ) : null}
          </div>
        );
      })}
      {working ? <WorkThrough steps={steps} today={today} onClose={() => setWorking(false)} /> : null}
    </section>
  );
}

// ---------- The list cards (decisions 9, 11, 14, 16) ----------

/** A list card: the title (with a quiet figure) and Open at the right, then rows that scroll inside the card. */
function ListCard({ title, right, onOpen, extra, children, testId, fill = false, empty }: { title: string; right?: React.ReactNode; onOpen: () => void; extra?: React.ReactNode; children: React.ReactNode; testId: string; /** Take the height of the row (Contacts beside Next actions); otherwise show 3 rows. */ fill?: boolean; empty?: React.ReactNode }) {
  return (
    <section className={cn(CARD, fill && "min-h-[220px]")} data-testid={testId} aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[13px] font-semibold">{title}</h2>
        <span className="flex shrink-0 items-baseline gap-3 text-[12px] text-[var(--h-ink2)]">
          {right}
          <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className="text-[11.5px] underline decoration-[#d6d3d1] underline-offset-[3px] hover:text-[var(--h-ink)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid={`${testId}-open`}>
            Open
          </button>
        </span>
      </div>
      {extra}
      <div className={cn("mt-1.5 overflow-y-auto overscroll-contain pr-1", fill ? "min-h-0 flex-1 basis-0 max-sm:max-h-[260px] max-sm:basis-auto" : "max-h-[120px]")} data-testid={`${testId}-rows`}>
        {children}
        {empty}
      </div>
    </section>
  );
}

/** One row of a list card: the name over a quiet line, and the due word in a fixed column at the right. */
function ListRow({ href, name, line, right, tone, testId }: { href: string; name: React.ReactNode; line?: React.ReactNode; right: React.ReactNode; tone?: "late" | "today" | "ok" | "plain"; testId: string }) {
  return (
    <Link href={href} className="grid h-[40px] grid-cols-[minmax(0,1fr)_84px] content-center items-baseline gap-6 border-b border-[#f5f5f4] last:border-b-0 hover:bg-[#fafaf9] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid={testId}>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] leading-[17px]">{name}</span>
        {line ? <span className="block truncate text-[11.5px] leading-[16px] text-[var(--h-ink2)]">{line}</span> : null}
      </span>
      <span className={cn("text-right text-[12px]", tone === "late" && "text-[var(--h-late)]", tone === "today" && "text-[var(--h-today)]", tone === "ok" && "text-[var(--h-ok)]", (!tone || tone === "plain") && "text-[var(--h-ink2)]")}>{right}</span>
    </Link>
  );
}
const toneOf = (t: string): "late" | "today" | "plain" => (t === "over" ? "late" : t === "today" ? "today" : "plain");

function ContactsCard({ data, onOpen }: { data: HomeData; onOpen: () => void }) {
  const o = data.outreach;
  return (
    <ListCard
      title="Contacts due today"
      onOpen={onOpen}
      testId="home-contacts"
      fill
      extra={
        <>
          <Bar parts={[{ pct: Math.min(100, o.counter.pct), color: "var(--h-indigo)" }]} testId="home-contacts-bar" />
          <div className="mt-1.5 text-[11px] text-[var(--h-ink2)]" data-testid="home-contacts-week">
            Outreach {o.counter.count} of {o.counter.target} this week
          </div>
        </>
      }
      empty={!o.due.length ? <p className="pt-2 text-[12px] text-[var(--h-faint)]">Nobody is due today.</p> : null}
    >
      {o.due.map((p) => {
        const due = dueLabel(p.nextFollowUp, data.today, (d) => fmtDate(d, "MMM d"));
        return <ListRow key={p.id} href={personHref(p.id)} name={p.name} line={[orgRoleLine(p), p.followUpFor].filter(Boolean).join(" · ")} right={due.text} tone={toneOf(due.tone)} testId="home-contact" />;
      })}
    </ListCard>
  );
}

/** The Contacts window: everyone due today or overdue, each with Email, Log a call and Log a meeting. */
function ContactsWindow({ data, composes }: { data: HomeData; composes: Record<string, ComposeSetup> }) {
  const people = useContactActions({ composes, today: data.today, tz: data.tz });
  const overdue = data.outreach.due.filter((p) => !!p.nextFollowUp && p.nextFollowUp < data.today);
  const groups = [
    { key: "overdue", word: "Overdue", color: "var(--h-late)", people: overdue },
    { key: "today", word: "Today", color: "var(--h-today)", people: data.outreach.due.filter((p) => !overdue.includes(p)) },
  ];
  const btn = "rounded-[6px] border border-[#d6d3d1] bg-white px-2.5 py-[3px] text-[12px] hover:border-[var(--h-ink2)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <div className="home-v2" data-testid="window-contacts-rows">
      {/* No numbers on the rows (Bram, 2026-11-17, decision 29): two headed groups carry the counts. */}
      {groups.map((g) =>
        g.people.length ? (
          <div key={g.key} className="mb-4 last:mb-0" data-testid="window-contacts-group" data-group={g.key}>
            <div className="border-b border-[#f0efed] pb-1.5 text-[10.5px] font-medium tracking-[0.07em] uppercase" style={{ color: g.color }}>
              {g.word} · {g.people.length}
            </div>
            {g.people.map((p) => {
        const due = dueLabel(p.nextFollowUp, data.today, (d) => fmtDate(d, "MMM d"));
        return (
          <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-6 border-b border-[#f5f5f4] py-2.5 last:border-b-0" data-testid="window-contact" data-person={p.id}>
            <div className="min-w-0">
              <Link href={personHref(p.id)} className="block truncate text-[13px] hover:underline">
                {p.name}
              </Link>
              <div className="truncate text-[12px] text-[var(--h-ink2)]">{[orgRoleLine(p), p.followUpFor].filter(Boolean).join(" · ")}</div>
              <div className="text-[11.5px] text-[var(--h-faint)]">{people.logged[p.id] ?? (p.lastContactOn ? `Last: ${contactKindLabel(p.lastContactKind)} ${p.lastContactOn === data.today ? "today" : fmtDate(p.lastContactOn, "MMM d")}` : "Not contacted yet")}</div>
            </div>
            <span className={cn("text-right text-[12px]", due.tone === "over" ? "text-[var(--h-late)]" : due.tone === "today" ? "text-[var(--h-today)]" : "text-[var(--h-ink2)]")}>{due.text}</span>
            <span className="flex gap-1.5">
              <button type="button" className={btn} onClick={() => people.onEmail(p)} data-testid="home-person-email">
                Email
              </button>
              <button type="button" className={btn} onClick={() => people.onCall(p)} data-testid="home-person-log-call">
                Log a call
              </button>
              <button type="button" className={btn} onClick={() => people.onMeeting(p)} data-testid="home-person-log-meeting">
                Log a meeting
              </button>
            </span>
          </div>
        );
      })}
          </div>
        ) : null,
      )}
      {!data.outreach.due.length ? <p className="text-[13px] text-[var(--h-ink2)]">Nobody is due today.</p> : null}
      {people.dialogs}
    </div>
  );
}

function TodosCard({ data, onOpen }: { data: HomeData; onOpen: () => void }) {
  const list = [...data.todos].sort((a, b) => String(a.dueOn ?? "").localeCompare(String(b.dueOn ?? "")));
  return (
    <ListCard title="To-dos" onOpen={onOpen} testId="home-todos" empty={!list.length ? <p className="pt-2 text-[12px] text-[var(--h-faint)]">Nothing is due today.</p> : null}>
      {list.map((t) => {
        const due = todoDueLabel(t.dueOn, data.today, (d) => fmtDate(d, "MMM d"));
        return <ListRow key={t.id} href={t.record ? recordHref(t.record) : "/work/todos"} name={t.text} line={t.record ? `Task · ${t.record.name}` : "Personal to-do"} right={due.text || "No date"} tone={toneOf(due.tone)} testId="home-todo" />;
      })}
    </ListCard>
  );
}

/** The To-dos window: due today or earlier, then later, each row with Done, Later and Block time. */
function TodosWindow({ data }: { data: HomeData }) {
  const later = data.laterTodos ?? [];
  return (
    <div data-testid="window-todos-rows">
      <div className="text-[10.5px] font-medium tracking-[0.07em] text-[#b5650d] uppercase">Due today or earlier · {data.todos.length}</div>
      <div className="-mx-[22px]">
        {data.todos.map((t) => (
          <div key={t.id} className="border-t border-slate-100 first:border-t-0">
            <TodoActionRow todo={t} today={data.today} />
          </div>
        ))}
      </div>
      {later.length ? (
        <>
          <div className="mt-4 text-[10.5px] font-medium tracking-[0.07em] text-[#635d58] uppercase">Later · {later.length}</div>
          <div className="-mx-[22px]">
            {later.map((t) => (
              <div key={t.id} className="border-t border-slate-100 first:border-t-0">
                <TodoActionRow todo={t} today={data.today} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Waiting on someone: each wait, longest first, red at the threshold; the number at the top right is red when any is. */
function WaitingSummary({ board, threshold, onOpen }: { board: WaitingBoard; threshold: number; onOpen: () => void }) {
  const t = Math.max(1, Math.round(threshold));
  const lines = board.items.flatMap((w) => w.lines.map((l) => ({ w, l }))).sort((a, b) => b.l.days - a.l.days);
  const over = lines.some((x) => x.l.days >= t);
  // Emails with no reply yet are waits too: the card counts and lists them after the waits (2026-11-17).
  const noReply = board.noReply;
  return (
    <ListCard
      title="Waiting on someone"
      right={
        <span className={over ? "text-[var(--h-late)]" : undefined} data-testid="home-waiting-count">
          {lines.length + noReply.length}
        </span>
      }
      onOpen={onOpen}
      testId="home-waiting"
      empty={!board.available ? <p className="pt-2 text-[12px] text-[var(--h-faint)]">Waiting on someone is not available yet.</p> : !lines.length && !noReply.length ? <p className="pt-2 text-[12px] text-[var(--h-faint)]">Nobody is keeping you waiting.</p> : null}
    >
      {lines.map(({ w, l }) => (
        <ListRow key={l.waitId} href={w.href} name={w.name} line={l.waitingOn} right={`${l.days} ${l.days === 1 ? "day" : "days"}`} tone={l.days >= t ? "late" : "plain"} testId="home-wait" />
      ))}
      {noReply.map((r) => (
        <ListRow key={r.commId} href={r.href} name={r.to ?? r.recordName ?? r.subject} line={`No reply yet · ${r.subject}`} right={`${r.days} ${r.days === 1 ? "day" : "days"}`} tone="plain" testId="home-no-reply" />
      ))}
    </ListCard>
  );
}

function TargetsCard({ tile, onOpen }: { tile: TargetsTile; onOpen: () => void }) {
  return (
    <ListCard
      title="Targets today"
      right={
        tile.available ? (
          <span data-testid="home-targets-met">
            <span className={tile.met.met ? "text-[var(--h-ok)]" : undefined}>{`${tile.met.met} of ${tile.met.total}`}</span> this week
          </span>
        ) : null
      }
      onOpen={onOpen}
      testId="home-targets"
      empty={!tile.available ? <p className="pt-2 text-[12px] text-[var(--h-faint)]" data-testid="home-targets-notice">{tile.notice ?? "Targets are not available yet."}</p> : !tile.lines.length ? <p className="pt-2 text-[12px] text-[var(--h-faint)]">No targets yet.</p> : null}
    >
      {tile.lines.map((l) => {
        const m = /^(\d+)(.*)$/.exec(l.figure);
        return (
          <ListRow
            key={l.id}
            href="/work/targets"
            name={l.name}
            line={l.label}
            right={
              <span className="text-[var(--h-ink)]">
                <span className={cn(l.tone === "missed" && "text-[var(--h-late)]", l.tone === "met" && "text-[var(--h-ok)]")}>{m ? m[1] : l.figure}</span>
                {m ? m[2] : ""}
              </span>
            }
            testId="home-target"
          />
        );
      })}
    </ListCard>
  );
}

/**
 * One next action: the action, the record and its kind under it, and the due word at the right; under the pointer (or
 * when a button in it has focus) Done and Later take the due word's place. On the phone the two buttons always show.
 * A click elsewhere on the row opens the record.
 */
function NextRow({ row, today, onRun }: { row: Row; today: string; onRun: (which: "done" | "later") => void }) {
  const router = useRouter();
  const due = dueLabel(row.action.due, today, (d) => fmtDate(d, "MMM d"));
  const dueCls = due.tone === "over" ? "text-[var(--h-late)]" : due.tone === "today" ? "text-[var(--h-today)]" : "text-[var(--h-ink2)]";
  const btn = "rounded-[6px] border border-[#d6d3d1] bg-white px-2.5 py-[3px] text-[12px] text-[var(--h-ink)] hover:border-[var(--h-ink2)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    // A click anywhere on the row opens the record (the mouse); the keyboard reaches the title link and the two buttons.
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button,a")) return;
        router.push(row.brief.href);
      }}
      className="group -mx-2.5 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[6px] border-b border-[#f5f5f4] px-2.5 py-[5px] last:border-b-0 hover:bg-[#fafaf9] lg:grid-cols-[minmax(0,1fr)_150px]"
      data-testid="home-next-row"
      data-key={row.key}
      data-section={row.section}
      data-lane={row.lane.toLowerCase().replace(" ", "-")}
    >
      <div className="min-w-0">
        <Link href={row.brief.href} className="block text-[13px] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:truncate" data-testid="home-next-title">
          {row.brief.title}
        </Link>
        <div className="mt-0.5 truncate text-[12px] text-[var(--h-ink2)]">
          {[row.brief.record, row.brief.kind].filter(Boolean).join("  ·  ")}
          <span className={cn("lg:hidden", dueCls)}>{`  ·  ${due.text}`}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <span className={cn("hidden text-[12px] lg:inline lg:group-focus-within:hidden lg:group-hover:hidden", dueCls)} data-testid="home-next-due">
          {due.text}
        </span>
        {row.step ? (
          <span className="flex gap-1.5 lg:hidden lg:group-focus-within:flex lg:group-hover:flex">
            <button type="button" className={btn} onClick={() => onRun("done")} data-testid="home-next-done">
              Done
            </button>
            <button type="button" className={btn} onClick={() => onRun("later")} data-testid="home-next-later">
              Later
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row after Done or Later: the row's full version from the Next actions list, with its own Done or Later already
 * pressed, so every question it asks (move the deal to the next stage, when to follow up, which date) works the same
 * as on the list. The page reads again after the save and the row leaves the card.
 */
function RunRow({ row, which, onClose }: { row: Row; which: "done" | "later"; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  useEffect(() => {
    // Once only, also when React runs the effect twice in development.
    if (fired.current) return;
    fired.current = true;
    const b = ref.current?.querySelector<HTMLButtonElement>(`[data-testid="${which === "done" ? "next-action-done" : "next-action-later"}"]`);
    b?.click();
  }, [which]);
  return (
    <div className="-mx-[18px] border-b border-[#f5f5f4] bg-white last:border-b-0" data-testid="home-next-run" data-key={row.key}>
      <div ref={ref}>{row.render(null)}</div>
      <div className="px-[22px] pb-2 text-right">
        <button type="button" onClick={onClose} className="text-[12px] text-[var(--h-ink2)] underline underline-offset-[3px]" data-testid="home-next-run-close">
          Close
        </button>
      </div>
    </div>
  );
}

/** A thin bar (indigo, Bram 2026-11-17): one or more parts side by side on the hairline track. */
function Bar({ parts, testId }: { parts: { pct: number; color: string }[]; testId?: string }) {
  return (
    <div className="mt-2.5 flex h-[3px] overflow-hidden rounded-[2px] bg-[#f0efed]" data-testid={testId} aria-hidden>
      {parts.map((p, i) => (
        <i key={i} className="block h-full" style={{ width: `${p.pct}%`, background: p.color }} />
      ))}
    </div>
  );
}

// ---------- Top priorities (row 3, beside Targets today) ----------

const STRENGTH_COLOR = { hot: "var(--h-hot)", warm: "var(--h-today)", cold: "var(--h-faint)" } as const;
const STRENGTH_WORD = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

function PrioritiesCard({ data }: { data: PrioritiesData }) {
  if (!data.ready) {
    return (
      <div className={CARD} data-testid="home-priorities">
        <CardTitle title="Top priorities" />
        <Sub testId="priority-notice">{data.notice}</Sub>
      </div>
    );
  }
  const main: PriorityKind = "acquisition";
  const picks = data.columns[main];
  const others = (Object.keys(PRIORITY_TRACKS) as PriorityKind[]).filter((k) => k !== main && data.columns[k].length);
  return (
    <div className={CARD} data-testid="home-priorities">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">
          <Link href={NEXT_ACTIONS_HREF} className="hover:underline" data-testid="home-priorities-open">
            Top priorities
          </Link>
        </h2>
        <span className="text-[11px] text-[var(--h-faint)]">{PRIORITY_TRACKS[main].label}</span>
      </div>
      <div className="mt-2">
        {Array.from({ length: MAX_PICKS }, (_, i) => picks[i] ?? null).map((p, i) => (p ? <PickLine key={p.id} pick={p} /> : <EmptyPick key={`empty-${i}`} n={i + 1} />))}
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--h-faint)]" data-testid="home-priorities-other">
        Other tracks: {others.length ? others.map((k) => `${PRIORITY_TRACKS[k].label}, ${data.columns[k][0].name}`).join("; ") : "none chosen"}
      </div>
    </div>
  );
}

function PickLine({ pick }: { pick: PriorityPick }) {
  return (
    <Link href={pick.href} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-[#f5f5f4] py-[4px] last:border-b-0 hover:underline" data-testid="home-priority" data-number={pick.number}>
      <span className={cn("text-[12.5px]", pick.number === 1 ? "font-semibold text-[var(--h-indigo)]" : "text-[var(--h-ink2)]")}>{pick.number}</span>
      <span className="truncate text-[12.5px]">{pick.name}</span>
      <span className="text-[11px] whitespace-nowrap text-[var(--h-ink2)]">
        {pick.stage ?? ""}
        {pick.strength ? (
          <>
            {pick.stage ? "  " : ""}
            <span aria-hidden className="mr-[3px] ml-1 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle" style={{ background: STRENGTH_COLOR[pick.strength] }} />
            {STRENGTH_WORD[pick.strength]}
          </>
        ) : null}
      </span>
    </Link>
  );
}

function EmptyPick({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] items-baseline gap-2 border-b border-[#f5f5f4] py-[4px] text-[12.5px] text-[var(--h-faint)] last:border-b-0" data-testid="home-priority-empty">
      <span className="text-[12.5px]">{n}</span>
      <span>Not chosen</span>
    </div>
  );
}

// ---------- Row 4: Screen listings, Rosara, Job search, Consulting ----------

function Small({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="mt-1 truncate text-[11.5px] text-[var(--h-ink2)]" data-testid={testId}>
      {children}
    </div>
  );
}
const Faint = ({ children }: { children: React.ReactNode }) => <span className="text-[var(--h-faint)]">{children}</span>;

function ListingsCard({ data }: { data: HomeData }) {
  const newest = data.listings[0];
  return (
    <CardLink href="/work/listings" title="Screen listings" right={data.toScreen} testId="home-listings" small>
      <Small testId="home-listings-line">{data.toScreen && newest ? `Newest: ${newest.name}` : <Faint>Nothing to screen</Faint>}</Small>
    </CardLink>
  );
}

function RosaraCard({ data }: { data: HomeData }) {
  const r = data.rosara;
  return (
    <CardLink href="/work/rosara" title="Rosara" right={r.open || null} testId="home-rosara" small>
      <Small testId="home-rosara-focus">{r.focus ? r.focus : <Faint>No focus set this week</Faint>}</Small>
    </CardLink>
  );
}

function JobsCard({ data }: { data: HomeData }) {
  const t = data.pipelines.tile;
  const i = t.nextInterview;
  return (
    <CardLink href="/work/jobs" title="Job search" right={t.open || null} testId="home-jobs" small>
      <Small testId="home-jobs-interview">{i ? `${i.name} (Interview)${i.nextActionDue ? `, next step ${fmtDate(i.nextActionDue, "MMM d")}` : ""}` : <Faint>No interview booked</Faint>}</Small>
    </CardLink>
  );
}

function ConsultingCard({ data }: { data: HomeData }) {
  const items = data.pipelines.consulting;
  const due = items.filter((i) => i.nextAction && i.nextActionDue && i.nextActionDue <= data.today);
  const next = due[0] ?? null;
  return (
    <CardLink href="/work/consulting" title="Consulting" right={due.length || null} testId="home-consulting" small>
      <Small testId="home-consulting-line">{next ? `Due: ${next.name}` : <Faint>Nothing due today</Faint>}</Small>
    </CardLink>
  );
}

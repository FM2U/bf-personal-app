"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeData } from "@/lib/work/home-data";
import type { WaitingBoard } from "@/lib/work/waiting-data";
import type { TargetsTile } from "@/lib/accountability/data";
import type { DayCalendar } from "@/lib/work/calendar-data";
import type { PrioritiesData } from "@/lib/work/priorities-data";
import { PRIORITY_TRACKS, MAX_PICKS, type PriorityKind, type PriorityPick } from "@/lib/work/priorities";
import { compareActions, type HomeSectionKey } from "@/lib/work/lanes";
import { dueLabel } from "@/lib/work/stages";
import { waitGroups } from "@/lib/work/waiting";
import { date as fmtDate } from "@/lib/format";
import { buildHomeRows, type Row } from "@/components/app/work/home-board";
import { HomeDayCalendar } from "@/components/app/work/home-day-calendar";
import { BlockTimeProvider } from "@/components/app/work/block-time";
import { WorkThrough, type WorkStep } from "@/components/app/work/work-through";
import { FindBox, TitleRow } from "@/components/app/work/title-row";
import { cn } from "@/lib/utils";

/** Where "All N next actions" and the Waiting card go until the large windows of release H3. */
export const NEXT_ACTIONS_HREF = "/work/next-actions";
/** How many next actions the card shows (overdue first, then today). */
const SHOWN = 5;
const FIND_ID = "home-find";

/**
 * Home, "Work on now" (release H1 of the Home redesign, approved by Bram 2026-11-17; the mockups
 * 2026-11-17-home-final-v2-1440.png and -1280.png). A bento of calm cards on a warm off-white page:
 * - Next actions (the 5 most urgent rows, overdue first, then today; Done and Later on the row under the pointer;
 *   Work through; "All N next actions") at the top left, and Today's calendar as a day view down the right side.
 * - Then Waiting on someone, Contacts due today, Targets today; then Top priorities, Deals, End of day; then To-dos,
 *   Screen listings, Rosara, Job search, Consulting.
 * Colors: red late, amber due today or needs you, green positive only, indigo for fixed points and every thin bar
 * (the named colors in globals.css, `.home-v2`). On the phone the cards stack in one column, the calendar right after
 * Next actions. A click on a card opens its page; the large windows and side panels come in release H3.
 */
export function HomeBento({ data, priorities, waiting, dateLabel, askAi, tabs }: { data: HomeData; priorities: PrioritiesData; waiting: Promise<WaitingBoard>; dateLabel: { long: string; short: string }; askAi: React.ReactNode; tabs: React.ReactNode }) {
  const router = useRouter();
  const [find, setFind] = useState("");
  const { today } = data;
  return (
    <BlockTimeProvider today={today} nowLocal={data.nowLocal} blockMinutes={data.blockMinutes} rowBlocks={data.rowBlocks} calendar={data.calendar}>
      <div className="home-v2 flex flex-col" data-testid="home-v2">
        <header className="pb-4" data-testid="home-header">
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
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,27%)] lg:grid-rows-[auto_1fr] lg:gap-x-5" data-testid="home-bento">
          <NextActionsCard data={data} />
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col">
            <Suspense fallback={<CalendarWaiting />}>
              <Arrived value={data.calendar} render={(c: DayCalendar) => <HomeDayCalendar calendar={c} nowLocal={data.nowLocal} blockHref={NEXT_ACTIONS_HREF} />} />
            </Suspense>
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:col-start-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="home-row-2">
              <Suspense fallback={<Loading title="Waiting on someone" testId="home-waiting" />}>
                <Arrived value={waiting} render={(w: WaitingBoard) => <WaitingSummary board={w} threshold={data.threshold} />} />
              </Suspense>
              <ContactsCard data={data} />
              <Suspense fallback={<Loading title="Targets today" testId="home-targets" />}>
                <Arrived value={data.targets} render={(t: TargetsTile) => <TargetsCard tile={t} />} />
              </Suspense>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr_1fr]" data-testid="home-row-3">
              <PrioritiesCard data={priorities} />
              <DealsCard data={data} />
              <Suspense fallback={<Loading title="End of day" testId="home-eod" />}>
                <Arrived value={data.targets} render={(t: TargetsTile) => <EodCard tile={t} />} />
              </Suspense>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" data-testid="home-row-4">
              <TodosCard data={data} />
              <ListingsCard data={data} />
              <RosaraCard data={data} />
              <JobsCard data={data} />
              <ConsultingCard data={data} />
            </div>
          </div>
        </div>
      </div>
    </BlockTimeProvider>
  );
}

/** Shows a part of Home once its data has arrived (page speed 2026-11-07); until then the Suspense placeholder shows. */
function Arrived<T>({ value, render }: { value: Promise<T>; render: (v: T) => React.ReactNode }) {
  return <>{render(use(value))}</>;
}

// ---------- The card frame ----------

const CARD = "flex min-w-0 flex-col rounded-[10px] border border-[var(--h-line)] bg-white px-[18px] py-3.5";
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
    <div className="flex items-baseline justify-between gap-2.5">
      <h2 className="truncate text-[13px] font-semibold">{title}</h2>
      {right ? <span className="shrink-0 text-[12px] text-[var(--h-ink2)]">{right}</span> : null}
    </div>
  );
}

/** The big number of a card. */
function Big({ children, tone, testId }: { children: React.ReactNode; tone?: "late" | "indigo" | "ok"; testId?: string }) {
  return (
    <div className={cn("mt-2.5 text-[24px] leading-none font-medium tracking-[-0.02em]", tone === "late" && "text-[var(--h-late)]", tone === "indigo" && "text-[var(--h-indigo)]", tone === "ok" && "text-[var(--h-ok)]")} data-testid={testId}>
      {children}
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
    <div className={cn(CARD, "min-h-[560px] lg:flex-1")} data-testid="home-calendar-loading" aria-busy="true" aria-label="Today's calendar is loading">
      <CardTitle title="Today" />
    </div>
  );
}

// ---------- Next actions ----------

const SECTION_WORD: Record<"overdue" | "today", string> = { overdue: "Overdue", today: "Today" };

function NextActionsCard({ data }: { data: HomeData }) {
  const { today } = data;
  const rows = useMemo(() => buildHomeRows(data), [data]);
  const by = useMemo(() => {
    const out: Record<HomeSectionKey, Row[]> = { overdue: [], today: [], needs: [], later: [] };
    for (const r of rows) out[r.section].push(r);
    out.overdue.sort((a, b) => compareActions(a.action, b.action));
    out.today.sort((a, b) => compareActions(a.action, b.action));
    return out;
  }, [rows]);
  const urgent = [...by.overdue, ...by.today];
  const shown = urgent.slice(0, SHOWN);
  const total = rows.length + (data.monthlyReview ? 1 : 0);
  const steps = useMemo(() => [...by.overdue, ...by.today].map((r) => r.step).filter((x): x is WorkStep => !!x), [by]);
  const [working, setWorking] = useState(false);
  const [run, setRun] = useState<{ key: string; which: "done" | "later" } | null>(null);
  // A row that left the card (saved) ends its run, so it never presses again if it comes back later.
  if (run && !shown.some((r) => r.key === run.key)) setRun(null);
  const sections = (["overdue", "today"] as const).map((k) => ({ key: k, rows: shown.filter((r) => r.section === k) })).filter((s) => s.rows.length);
  return (
    <section className={cn(CARD, "lg:col-start-1")} data-testid="home-next" aria-labelledby="home-next-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="home-next-title" className="text-[13px] font-semibold">
          Next actions
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--h-ink2)]" data-testid="home-next-counts">
          {by.overdue.length ? (
            <span className="text-[var(--h-late)]" data-testid="home-next-overdue">
              <Dot color="var(--h-late)" />
              {by.overdue.length} overdue
            </span>
          ) : null}
          <span className={by.today.length ? "text-[var(--h-today)]" : undefined} data-testid="home-next-today">
            {by.today.length ? <Dot color="var(--h-today)" /> : null}
            {by.today.length} today
          </span>
          {by.needs.length ? <span data-testid="home-next-needs">{by.needs.length} need a next action</span> : null}
          <span data-testid="home-next-later">{by.later.length + (data.monthlyReview ? 1 : 0)} later</span>
          {steps.length ? (
            <button type="button" onClick={() => setWorking(true)} className="rounded-[6px] border border-[var(--h-ink)] bg-[var(--h-ink)] px-2.5 py-1 text-[12px] text-[#fafaf9] hover:bg-[#292524] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="work-through-open">
              Work through
            </button>
          ) : null}
        </div>
      </div>
      {sections.length ? (
        sections.map((s) => (
          <div key={s.key} className="mt-2.5" data-testid="home-next-section" data-section={s.key}>
            <div className="border-b border-[#f0efed] pb-1.5">
              <span className={cn("text-[10.5px] font-medium tracking-[0.07em] uppercase", s.key === "overdue" ? "text-[var(--h-late)]" : "text-[var(--h-today)]")}>{SECTION_WORD[s.key]}</span>
            </div>
            {s.rows.map((r) => (run?.key === r.key ? <RunRow key={r.key} row={r} which={run.which} onClose={() => setRun(null)} /> : <NextRow key={r.key} row={r} today={today} onRun={(which) => setRun({ key: r.key, which })} />))}
          </div>
        ))
      ) : (
        <p className="mt-3 text-[12.5px] text-[var(--h-ink2)]" data-testid="home-next-empty">
          Nothing is overdue or due today.
        </p>
      )}
      <div className="mt-2.5 text-[12px]">
        <Link href={`${NEXT_ACTIONS_HREF}?view=all`} className="underline decoration-[#d6d3d1] underline-offset-[3px] hover:decoration-[var(--h-ink2)]" data-testid="home-next-all">
          All {total} next actions
        </Link>
      </div>
      {working ? <WorkThrough steps={steps} today={today} onClose={() => setWorking(false)} /> : null}
    </section>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="mr-[7px] inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle" style={{ background: color }} />;
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
      className="group -mx-2.5 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[6px] border-b border-[#f5f5f4] px-2.5 py-[7px] last:border-b-0 hover:bg-[#fafaf9] lg:grid-cols-[minmax(0,1fr)_150px]"
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

// ---------- Row 2: Waiting on someone, Contacts due today, Targets today ----------

/**
 * Waiting on someone: the number of waits, red when any deal or person is in the "N+ days" group. The groups and
 * their counts are the Next actions page's (a deal or person sits in the group of its longest wait; its waits count).
 */
function WaitingSummary({ board, threshold }: { board: WaitingBoard; threshold: number }) {
  if (!board.available) {
    return (
      <CardLink href={`${NEXT_ACTIONS_HREF}#now-wait`} title="Waiting on someone" testId="home-waiting">
        <Sub testId="home-waiting-line">Waiting on someone is not available yet.</Sub>
      </CardLink>
    );
  }
  const groups = waitGroups(board.items, threshold);
  const waitsIn = (key: string) => groups.find((g) => g.key === key)?.items.reduce((n, w) => n + w.lines.length, 0) ?? 0;
  const over = waitsIn("over");
  const under = waitsIn("under");
  const t = Math.max(1, Math.round(threshold));
  return (
    <CardLink href={`${NEXT_ACTIONS_HREF}#now-wait`} title="Waiting on someone" testId="home-waiting">
      <Big tone={over ? "late" : undefined} testId="home-waiting-count">
        {over + under}
      </Big>
      <Sub testId="home-waiting-line">
        {over + under ? (
          <>
            {over ? <span className="text-[var(--h-late)]">{over} at {t}+ days</span> : null}
            {over && under ? ", " : null}
            {under ? `${under} under ${t} days` : null}
          </>
        ) : (
          "Nobody is keeping you waiting."
        )}
        {board.noReply.length ? <div>No reply yet: {board.noReply.length}</div> : null}
      </Sub>
    </CardLink>
  );
}

function ContactsCard({ data }: { data: HomeData }) {
  const o = data.outreach;
  const names = o.dueToday.map((p) => p.name).join(", ");
  return (
    <CardLink href="/work/people" title="Contacts due today" testId="home-contacts">
      <Big testId="home-contacts-count">{o.dueToday.length}</Big>
      <Sub className="truncate" testId="home-contacts-names">
        {names || "Nobody is due today."}
      </Sub>
      <Bar parts={[{ pct: Math.min(100, o.counter.pct), color: "var(--h-indigo)" }]} testId="home-contacts-bar" />
      <div className="mt-1.5 text-[11px] text-[var(--h-ink2)]" data-testid="home-contacts-week">
        Outreach {o.counter.count} of {o.counter.target} this week
        {o.overdue ? <span className="text-[var(--h-late)]">{`, ${o.overdue} overdue`}</span> : null}
      </div>
    </CardLink>
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

function TargetsCard({ tile }: { tile: TargetsTile }) {
  if (!tile.available) {
    return (
      <CardLink href="/work/targets" title="Targets today" testId="home-targets">
        <Sub testId="home-targets-notice">{tile.notice ?? "Targets are not available yet."}</Sub>
      </CardLink>
    );
  }
  const [first, ...rest] = tile.lines;
  const lead = first ? /^(\d+)(.*)$/.exec(first.figure) : null;
  return (
    <CardLink href="/work/targets" title="Targets today" testId="home-targets">
      {first ? (
        <Big testId="home-target-first">
          <span className={cn(first.tone === "missed" && "text-[var(--h-late)]", first.tone === "met" && "text-[var(--h-ok)]")}>{lead ? lead[1] : first.figure}</span>
          <span className="text-[16px] text-[var(--h-faint)]">{lead ? `${lead[2]} ` : " "}</span>
          <span className="text-[16px] text-[var(--h-faint)]">{first.name}</span>
        </Big>
      ) : (
        <Sub>No targets yet.</Sub>
      )}
      <Sub testId="home-targets-rest">
        {rest.length ? <div className="truncate">{rest.map((l) => `${l.name} ${l.figure}`).join("  ·  ")}</div> : null}
        <div data-testid="home-targets-met">
          This week, <span className={tile.met.met ? "text-[var(--h-ok)]" : undefined}>{`${tile.met.met} of ${tile.met.total} targets met`}</span>
        </div>
      </Sub>
    </CardLink>
  );
}

// ---------- Row 3: Top priorities, Deals, End of day ----------

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
      <div className="flex items-baseline justify-between gap-2.5">
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
    <Link href={pick.href} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-[#f5f5f4] py-[5px] last:border-b-0 hover:underline" data-testid="home-priority" data-number={pick.number}>
      <span className={cn("text-[12.5px]", pick.number === 1 ? "font-semibold text-[var(--h-indigo)]" : "text-[var(--h-ink2)]")}>{pick.number}</span>
      <span className="truncate text-[13px]">{pick.name}</span>
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
    <div className="grid grid-cols-[16px_minmax(0,1fr)] items-baseline gap-2 border-b border-[#f5f5f4] py-[5px] text-[13px] text-[var(--h-faint)] last:border-b-0" data-testid="home-priority-empty">
      <span className="text-[12.5px]">{n}</span>
      <span>Not chosen</span>
    </div>
  );
}

function DealsCard({ data }: { data: HomeData }) {
  const g = data.glance;
  const all = g.early + g.evaluate + g.decide || 1;
  const words = [g.early ? `${g.early} early` : null, g.evaluate ? `${g.evaluate} evaluating` : null, g.decide ? `${g.decide} deciding` : null].filter(Boolean).join(", ");
  return (
    <CardLink href="/work/deals" title="Deals" testId="home-deals">
      <Big testId="home-deals-count">{g.active}</Big>
      <Bar
        parts={[
          { pct: (g.early / all) * 100, color: "var(--h-indigo-pale)" },
          { pct: (g.evaluate / all) * 100, color: "var(--h-indigo-mid)" },
          { pct: (g.decide / all) * 100, color: "var(--h-indigo)" },
        ]}
        testId="home-deals-bar"
      />
      <Sub testId="home-deals-line">
        {words || "No active deals."}
        {g.needsAction ? <div className="text-[var(--h-today)]">{g.needsAction} {g.needsAction === 1 ? "needs" : "need"} a next action</div> : null}
      </Sub>
    </CardLink>
  );
}

const EOD_STATE: Record<string, string> = { sent: "Report sent", skipped: "Day skipped" };

function EodCard({ tile }: { tile: TargetsTile }) {
  const state = tile.eod.state;
  return (
    <CardLink href="/work/end-of-day" title="End of day" testId="home-eod">
      <Big tone={state === "sent" ? "ok" : state === "skipped" ? undefined : "indigo"} testId="home-eod-badge">
        {tile.eod.badge}
      </Big>
      <Sub testId="home-eod-line">
        <div>{EOD_STATE[state] ?? "Report not sent"}</div>
        {tile.eod.line ? <div>{tile.eod.line}</div> : null}
      </Sub>
    </CardLink>
  );
}

// ---------- Row 4: To-dos, Screen listings, Rosara, Job search, Consulting ----------

function Small({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="mt-1 truncate text-[11.5px] text-[var(--h-ink2)]" data-testid={testId}>
      {children}
    </div>
  );
}
const Faint = ({ children }: { children: React.ReactNode }) => <span className="text-[var(--h-faint)]">{children}</span>;

function TodosCard({ data }: { data: HomeData }) {
  const late = data.todos.filter((t) => t.dueOn && t.dueOn < data.today).length;
  return (
    <CardLink href="/work/todos" title="To-dos" right={data.todos.length} testId="home-todos" small>
      <Small testId="home-todos-line">{late ? <span className="text-[var(--h-late)]">{late} late</span> : data.todos.length ? `${data.todos.length} due today` : <Faint>Nothing due today</Faint>}</Small>
    </CardLink>
  );
}

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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PeriodKey, PeriodView, ReportsPage, SentRow, WeekTile } from "@/lib/accountability/data";
import { pastWeekPeriodKey, periodPills } from "@/lib/accountability/periods";
import { shortTargetName } from "@/lib/accountability/targets";
import { date as fmtDate } from "@/lib/format";
import { Drawer } from "@/components/app/work/drawer";
import { useSections } from "@/components/app/work/sections";
import { CollapseAllButton, Figure, Line1, Line2, Name, Pill, PinnedBlock, Rows, SectionHeading, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Reports (batch C, approved 2026-10-31): the segmented choice "The week | Sent reports" with the period pills (This
 * week, Last week, the month) and Find; "The week" shows six figure tiles (Targets met, Deals moved, Listings
 * screened, Outreach, Follow-ups on time, Days waiting on brokers) and the cards Targets, Waiting on brokers, Deals
 * moved, Passed by reason; "Sent reports" lists the reports by week (Find, Collapse all) with "Daily, Fri Oct 31 ·
 * Sent 5:41 pm · <partner> reviewed / Sent / Skipped · <partner> replied"; a row opens the report as sent in the
 * right drawer with when it was opened and the reply. Edit batch C (item 7): the Past weeks tiles moved here from
 * Targets, under "The week": the met count, the week, and each miss on its own line (red dot, target, figure); a
 * tile opens that week (its pill shows while it is open). Most missed sits on the Past weeks heading.
 * Edit batch C round 2 (item 6): The week in four groups with one short heading each (WeekView); Sent reports unchanged.
 */
const STORAGE_KEY = "work-reports-sent-sections";
const FIG = "w-[82px]";

export function ReportsBoard({ data, title, tabs, view: viewAtStart, period: periodAtStart }: { data: ReportsPage; title: React.ReactNode; tabs: React.ReactNode; view: "week" | "sent"; period: PeriodKey }) {
  const router = useRouter();
  const [view, setView] = useState<"week" | "sent">(viewAtStart);
  const [period, setPeriod] = useState<PeriodKey>(periodAtStart);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<SentRow | null>(null);
  const first = data.partner?.first ?? "Partner";
  const p = data.periods.find((x) => x.key === period) ?? data.periods[0];
  const q = query.trim().toLowerCase();
  const matches = (r: SentRow) => !q || r.title.toLowerCase().includes(q) || r.searchText.includes(q);
  const states = useMemo(() => data.sent.map((s) => ({ name: s.label, count: s.rows.length, hasMatch: s.rows.some(matches), defaultOpen: !s.collapsed })), [data.sent, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useSections(STORAGE_KEY, states, !!q);
  const pick = (v: "week" | "sent") => {
    setView(v);
    router.replace(v === "sent" ? "/work/reports?view=sent" : period === "this" ? "/work/reports" : `/work/reports?period=${period}`, { scroll: false });
  };
  /** A period pill or a Past weeks tile: the period shows, and the address keeps it (a reload or a link opens it again). */
  const pickPeriod = (k: PeriodKey, toTop = false) => {
    setPeriod(k);
    if (view === "week") router.replace(k === "this" ? "/work/reports" : `/work/reports?period=${k}`, { scroll: false });
    if (toTop) window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <>
      <PinnedBlock testId="reports-sticky">
        {title}
        {tabs}
        <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="reports-filters">
          <span className="inline-flex overflow-hidden rounded-full border border-border bg-white" role="group" aria-label="View" data-testid="reports-view">
            {(["week", "sent"] as const).map((v, i) => (
              <button key={v} type="button" onClick={() => pick(v)} aria-pressed={view === v} className={cn("px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", view === v ? "bg-primary-soft text-primary-strong" : "text-slate-600 hover:bg-slate-50")} data-testid={`reports-view-${v}`}>
                {v === "week" ? "The week" : "Sent reports"}
              </button>
            ))}
          </span>
          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />
          {periodPills(data.periods, period).map((per) => (
            <button key={per.key} type="button" onClick={() => pickPeriod(per.key)} aria-pressed={period === per.key} className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", period === per.key ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")} data-testid={`reports-period-${per.key}`}>
              {per.label}
            </button>
          ))}
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim() && view !== "sent") pick("sent");
            }}
            placeholder="Find a report"
            aria-label="Find a report"
            className="h-[30px] w-full rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:ml-auto sm:w-[200px]"
            data-testid="reports-search"
          />
          {view === "sent" ? <CollapseAllButton allCollapsed={ui.allCollapsed} onClick={ui.toggleAll} /> : null}
        </div>
      </PinnedBlock>

      {view === "week" ? (
        <WeekView p={p} first={first} past={data.past} mostMissed={data.mostMissed} active={period} onOpen={(k) => pickPeriod(k, true)} />
      ) : (
        <WorkCard title="Sent reports" hint={`To ${first} by email · a sent report never changes`} testId="sent-reports-card">
          <div className="px-[22px] pb-2" data-testid="sent-sections">
            {data.sent.map((s) => {
              const rows = s.rows.filter(matches);
              const collapsed = ui.isCollapsed(s.label);
              return (
                <div key={s.key} data-testid="sent-section" data-section={s.key}>
                  <SectionHeading name={s.label} count={s.rows.length} collapsed={collapsed} onToggle={() => ui.toggle(s.label)} hint={s.hint} />
                  {!collapsed ? (
                    <div className="-mx-[22px] flex flex-col" data-testid="section-body">
                      {rows.length ? (
                        rows.map((r) => (
                          <button key={r.id} type="button" onClick={() => setOpen(r)} className="grid w-full cursor-pointer grid-cols-1 items-center gap-x-[18px] gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] text-left first:border-t-0 hover:bg-[#fbfcfe] sm:grid-cols-[minmax(0,1fr)_auto]" data-testid="sent-row" data-state={r.state} data-day={r.day}>
                            <div className="min-w-0">
                              <Line1>
                                <Name>{r.title}</Name>
                                {r.comment ? <Pill tone="blue">{first} replied</Pill> : null}
                              </Line1>
                              <Line2>{r.summary}</Line2>
                            </div>
                            <div className="flex items-center gap-x-3.5 whitespace-nowrap" data-row-right>
                              <span className="w-[92px] text-right text-xs text-muted-foreground" data-col="sent">
                                {r.state === "sent" ? `Sent ${r.sentTime}` : "Not sent"}
                              </span>
                              <span className="flex w-[118px] justify-end" data-col="pill">
                                <Pill tone={r.state === "skipped" ? "gray" : r.reviewedAt ? "green" : "gray"} testId="sent-pill">
                                  {r.state === "skipped" ? "Skipped" : r.reviewedAt ? `${first} reviewed` : "Sent"}
                                </Pill>
                              </span>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="px-[22px] py-3 text-[13px] text-muted-foreground">{q ? "No report matches." : "No report this week yet."}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </WorkCard>
      )}

      {open ? <SentReportDrawer row={open} first={first} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * One short heading over each group of The week (Edit batch C round 2, item 6): charcoal small caps on a hairline, with
 * an optional quiet note at the right.
 */
function GroupHeading({ children, note, testId }: { children: React.ReactNode; note?: React.ReactNode; testId: string }) {
  return (
    <h2 className="label-caps mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule pb-[7px]" data-testid="reports-group-heading" data-group={testId}>
      <span>{children}</span>
      {note ? <span className="text-xs font-normal tracking-normal text-muted-foreground normal-case sm:ml-auto">{note}</span> : null}
    </h2>
  );
}

/**
 * The week, in four groups (Edit batch C round 2, item 6), the same for This week, Last week, a past week, and the
 * month: "How the week went" (six tiles: Deals moved, Listings screened, Network outreach, Follow-ups on time, Days
 * waiting on brokers, Most missed), "What needs you" (the targets missed, or at risk while the week is open, and who
 * keeps you waiting), "What moved" (deals moved, passed by reason), and "Trend" (the past weeks tiles with Most missed
 * over 7 weeks). Nothing repeats between a tile and a card: the tiles carry last week's figures, the cards the names.
 */
function WeekView({ p, first, past, mostMissed, active, onOpen }: { p: PeriodView; first: string; past: WeekTile[]; mostMissed: ReportsPage["mostMissed"]; active: PeriodKey; onOpen: (k: PeriodKey) => void }) {
  const needs = p.targets.filter((t) => !t.met);
  const month = p.key === "month";
  return (
    <div className="flex flex-col gap-6" data-testid="week-view" data-period={p.key}>
      <section data-testid="reports-group-went">
        <GroupHeading testId="went" note={<span data-testid="period-lead">{p.lead}</span>}>
          {month ? "How the month went" : "How the week went"}
        </GroupHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" data-testid="week-tiles">
          {p.tiles.map((t) => (
            <div key={t.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:px-5 md:py-4" data-testid="week-tile" data-label={t.label}>
              <b className={cn("tabular truncate text-[22px] leading-tight font-semibold tracking-[-0.01em] md:text-[26px]", t.status === "met" ? "text-status-met" : t.status === "missed" ? "text-status-missed" : t.value === "None" ? "text-slate-400" : "text-slate-900")}>
                {t.value}
                {t.small ? <span className="ml-1 text-[13px] font-medium text-muted-foreground">{t.small}</span> : null}
              </b>
              <span className="label-caps mt-0.5">{t.label}</span>
              <span className="mt-1 min-h-[19px] text-[12.5px] text-muted-foreground">{t.note}</span>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="reports-group-needs">
        <GroupHeading testId="needs">What needs you</GroupHeading>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <WorkCard title={p.open ? `Targets at risk ${p.words}` : `Targets missed ${p.words}`} hint={`${p.met} of ${p.targets.length} met`} testId="report-targets">
            <Rows>
              {needs.map((t) => (
                <Row key={t.name} name={t.name} line={t.line} figure={t.figure} label={p.open ? "Under way" : "Missed"} tone={p.open ? "plain" : "missed"} />
              ))}
              {!p.targets.length ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">No targets yet.</p> : !needs.length ? <p className="px-[22px] py-3 text-[13px] text-status-met" data-testid="report-targets-all-met">Every target is met {p.words}.</p> : null}
            </Rows>
          </WorkCard>
          <WorkCard title={`Waiting on brokers ${p.key === "this" ? "" : "now"}`.trim()} hint="Amber at 5 days, red at 10" testId="report-waits">
            <Rows>
              {p.waits.map((w) => (
                <Row key={w.dealId} name={w.who ?? w.name} line={`${w.who ? `${w.name} · ` : ""}${w.what}${w.since ? ` · since ${w.since}` : ""}`} figure={String(w.days)} label="Days" tone={w.days >= 10 ? "missed" : w.days >= 5 ? "amber" : "plain"} />
              ))}
              {!p.waits.length ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">Nobody is keeping you waiting.</p> : null}
            </Rows>
          </WorkCard>
        </div>
      </section>

      <section data-testid="reports-group-moved">
        <GroupHeading testId="moved">What moved</GroupHeading>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <WorkCard title={`Deals moved ${p.words}`} hint={`${p.moves.length} ${p.moves.length === 1 ? "move" : "moves"}${month ? ", newest first" : ""}`} testId="report-moves">
            <Rows>
              {p.moves.slice(0, 8).map((m, i) => (
                <Row key={`${m.name}-${i}`} name={m.name} line={m.line} figure={m.when} label="Day" tone="plain" />
              ))}
              {p.moves.length > 8 ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">{p.moves.length - 8} more</p> : null}
              {!p.moves.length ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">No stage move {p.words}.</p> : null}
            </Rows>
          </WorkCard>
          <WorkCard title={`Passed ${p.words}`} hint={`${p.passed.reduce((s, x) => s + x.count, 0)} passes, by reason`} testId="report-passed">
            <Rows>
              {p.passed.map((x) => (
                <Row key={x.reason} name={x.reason} line={x.line} figure={String(x.count)} label="Passed" tone="plain" />
              ))}
              {!p.passed.length ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">Nothing passed {p.words}.</p> : null}
            </Rows>
          </WorkCard>
        </div>
      </section>

      <PastWeeks past={past} mostMissed={mostMissed} active={active} onOpen={onOpen} />
      <p className="sr-only">{first}</p>
    </div>
  );
}

function Row({ name, line, figure, label, tone }: { name: string; line: string; figure: string; label: string; tone: "met" | "missed" | "amber" | "plain" }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[18px] gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0" data-testid="report-row">
      <div className="min-w-0">
        <Line1>
          <Name>{name}</Name>
        </Line1>
        <Line2>{line}</Line2>
      </div>
      <Figure value={figure} label={label} tone={tone === "missed" ? "red" : tone === "amber" ? "amber" : "plain"} className={cn(FIG, tone === "met" && "[&>b]:text-status-met")} testId="report-figure" />
    </div>
  );
}

/**
 * The Past weeks tiles (moved from Targets, Edit batch C item 7): "2 of 6", the week, then each miss on its own line
 * with a red dot, the target's short name, and its figure ("Listings 21 of 25"). A tile opens that week above.
 */
function PastWeeks({ past, mostMissed, active, onOpen }: { past: WeekTile[]; mostMissed: ReportsPage["mostMissed"]; active: PeriodKey; onOpen: (k: PeriodKey) => void }) {
  if (!past.length) return null;
  return (
    <section data-testid="past-weeks">
      <GroupHeading
        testId="trend"
        note={
          <span data-testid="most-missed">{mostMissed ? `Most missed over ${mostMissed.of} weeks: ${mostMissed.name}, ${mostMissed.n} of ${mostMissed.of}` : "Every week met"}</span>
        }
      >
        Trend
        <span className="ml-2 text-[12.5px] font-medium tracking-normal text-muted-foreground normal-case">past weeks, targets met of {past[0].total}</span>
      </GroupHeading>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:gap-4 xl:grid-cols-4">
        {past.map((w, i) => {
          const key = pastWeekPeriodKey(i + 1);
          return (
            <button key={w.weekStart} type="button" onClick={() => onOpen(key)} aria-pressed={active === key} className={cn("flex min-w-0 flex-col gap-0.5 rounded-xl border bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-[#fbfcfe] md:px-5 md:py-4", active === key ? "border-primary-border" : "border-border")} data-testid="past-week" data-period={key} data-met={w.met}>
              <b className={cn("tabular text-[22px] leading-tight font-semibold tracking-[-0.01em] md:text-[26px]", w.total && w.met === w.total ? "text-status-met" : w.total && w.met * 2 < w.total ? "text-status-missed" : "text-slate-900")}>
                {w.met} of {w.total}
              </b>
              <span className="label-caps mt-0.5">Week of {fmtDate(w.weekStart, "MMM d")}</span>
              {w.missed.length ? (
                <ul className="mt-1.5 flex flex-col gap-1" data-testid="past-week-misses">
                  {w.missed.map((m) => (
                    <li key={m.name} className="flex items-center gap-2 text-[12.5px] text-slate-700" data-testid="past-week-miss">
                      <i className="block h-1.5 w-1.5 shrink-0 rounded-full bg-status-missed-solid" aria-hidden />
                      <span className="min-w-0 flex-1">{shortTargetName(m.name)}</span>
                      <span className="tabular shrink-0 font-medium text-status-missed">{m.figure}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="mt-1.5 text-[12.5px] font-medium text-status-met">Every target met</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The report as the partner received it, with when it was sent and opened, and the reply when there is one. */
function SentReportDrawer({ row, first, onClose }: { row: SentRow; first: string; onClose: () => void }) {
  const sub = row.state === "skipped" ? `Skipped · ${row.skipReason ?? "no reason given"}` : `Sent ${row.sentTime}${row.reviewedTime ? ` · ${first} reviewed ${row.reviewedTime}` : " · not opened yet"}${row.comment ? " · replied" : ""}`;
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={row.title} sub={sub} testId="sent-report-drawer">
      <div className="mb-3 flex flex-wrap gap-x-8 gap-y-3 border-b border-slate-100 pb-3" data-testid="sent-meta">
        <Figure value={row.state === "skipped" ? "Not sent" : row.sentTime ?? ""} label={row.state === "skipped" ? "Skipped" : "Sent"} className="items-start sm:items-start" />
        <Figure value={row.state === "skipped" ? "Nothing" : row.reviewedTime ?? "Not yet"} label={`${first} opened`} tone={row.reviewedTime ? "plain" : "none"} className={cn("items-start sm:items-start", row.reviewedTime && "[&>b]:text-status-met")} />
        {row.comment ? <Figure value="1" label="Reply" className="items-start sm:items-start" /> : null}
      </div>
      {row.state === "skipped" ? (
        <p className="text-sm text-slate-800" data-testid="sent-skipped-text">
          No report was sent. Reason: {row.skipReason ?? "no reason given"}. The day is not counted on the per-weekday targets; the next End of day asked for any reason still owed.
        </p>
      ) : row.html ? (
        <div className="report-preview min-w-0 overflow-x-auto text-[13.5px] text-slate-900" dangerouslySetInnerHTML={{ __html: row.html }} data-testid="sent-html" />
      ) : (
        <p className="text-sm text-muted-foreground">The email of this report was not kept.</p>
      )}
      {row.comment ? (
        <div className="mt-4 rounded-[10px] border border-primary-border bg-primary-soft px-4 py-3 text-[13px] text-slate-800" data-testid="sent-reply">
          <div className="mb-1 text-xs font-semibold text-primary-strong">
            {first} replied{row.commentTime ? `, ${row.commentTime}` : ""}
          </div>
          {row.comment}
        </div>
      ) : null}
      <p className="mt-4 text-[12.5px] text-muted-foreground">The report as {first} received it. A sent report never changes.</p>
    </Drawer>
  );
}

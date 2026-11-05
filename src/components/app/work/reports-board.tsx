"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { taskFromReply } from "@/app/actions/accountability";
import { ComposeEmailDialog } from "@/components/app/compose-email";
import type { ComposeSetup } from "@/lib/compose-email";
import type { PeriodKey, PeriodView, ReportsPage, SentReply, SentRow, WeekTile } from "@/lib/accountability/data";
import type { MonthlyListItem } from "@/lib/accountability/monthly-data";
import { pastWeekPeriodKey, periodPills } from "@/lib/accountability/periods";
import { shortTargetName } from "@/lib/accountability/targets";
import { date as fmtDate } from "@/lib/format";
import { CenteredWindow } from "@/components/app/window";
import type { TileHistory } from "@/lib/accountability/week-history";
import { useSections } from "@/components/app/work/sections";
import { CollapseAllButton, Confirm, Figure, Line1, Line2, Name, Pill, PinnedBlock, RowButton, Rows, SectionHeading, WorkCard } from "@/components/app/work/ui";
import { StatusMark } from "@/components/app/work/targets-ui";
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
 * Push D (approved 2026-11-04): a third view, Monthly reviews: one row per month (To do or Finished); a row opens the
 * review page, read only once finished.
 */
const STORAGE_KEY = "work-reports-sent-sections";
const FIG = "w-[82px]";

/** The pill at the right of a sent row (push B): Replied, 2 replies, Opened, Sent, or Skipped. */
function sentPill(r: SentRow): { text: string; tone: "blue" | "green" | "gray" } {
  if (r.state === "skipped") return { text: "Skipped", tone: "gray" };
  if (r.replies.length > 1) return { text: `${r.replies.length} replies`, tone: "blue" };
  if (r.replies.length) return { text: "Replied", tone: "blue" };
  if (r.reviewedAt) return { text: "Opened", tone: "green" };
  return { text: "Sent", tone: "gray" };
}

type SentFilter = "all" | "replies" | `p:${string}`;
type View = "week" | "sent" | "monthly";
const VIEW_LABEL: Record<View, string> = { week: "The week", sent: "Sent reports", monthly: "Monthly reviews" };

export function ReportsBoard({ data, title, tabs, view: viewAtStart, period: periodAtStart, openDay, partnerAtStart, composes, replyNote, monthly }: { data: ReportsPage; title: React.ReactNode; tabs: React.ReactNode; view: View; /** Push D: the months under Monthly reviews. */ monthly: MonthlyListItem[]; period: PeriodKey; /** ?day=YYYY-MM-DD opens that day's sent report (a partner's timeline links here). */ openDay?: string | null; /** ?partner=<id> narrows Sent reports to one partner (a partner's page links here). */ partnerAtStart?: string | null; /** The email box per partner, for Reply under a reply. */ composes: Record<string, ComposeSetup>; /** "Reconnect Google to see replies", when the read permission is missing. */ replyNote: string | null }) {
  const router = useRouter();
  const [view, setView] = useState<View>(viewAtStart);
  const [period, setPeriod] = useState<PeriodKey>(periodAtStart);
  const [query, setQuery] = useState("");
  const allRows = useMemo(() => data.sent.flatMap((s) => s.rows), [data.sent]);
  const [open, setOpen] = useState<SentRow | null>(() => (openDay ? allRows.find((r) => r.day === openDay) ?? null : null));
  const recipients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allRows) for (const t of r.to) if (t.contactId && !seen.has(t.contactId)) seen.set(t.contactId, t.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [allRows]);
  const [sentFilter, setSentFilter] = useState<SentFilter>(partnerAtStart && recipients.some((x) => x.id === partnerAtStart) ? `p:${partnerAtStart}` : "all");
  const first = data.partners.length > 1 ? "Partners" : (data.partner?.first ?? "Partner");
  const p = data.periods.find((x) => x.key === period) ?? data.periods[0];
  const q = query.trim().toLowerCase();
  const passesFilter = (r: SentRow, f: SentFilter) => (f === "all" ? true : f === "replies" ? r.replies.length > 0 : r.to.some((t) => t.contactId === f.slice(2)));
  const matches = (r: SentRow) => passesFilter(r, sentFilter) && (!q || r.title.toLowerCase().includes(q) || r.searchText.includes(q));
  const sentFilters: { key: SentFilter; label: string; n: number | null }[] = [{ key: "all", label: "All", n: null }, { key: "replies", label: "With replies", n: allRows.filter((r) => r.replies.length).length }, ...recipients.map((x) => ({ key: `p:${x.id}` as SentFilter, label: x.name, n: null }))];
  const states = useMemo(() => data.sent.map((s) => ({ name: s.label, count: s.rows.length, hasMatch: s.rows.some(matches), defaultOpen: !s.collapsed })), [data.sent, q, sentFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useSections(STORAGE_KEY, states, !!q || sentFilter !== "all");
  const pick = (v: View) => {
    setView(v);
    router.replace(v !== "week" ? `/work/reports?view=${v}` : period === "this" ? "/work/reports" : `/work/reports?period=${period}`, { scroll: false });
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
            {(["week", "sent", "monthly"] as const).map((v, i) => (
              <button key={v} type="button" onClick={() => pick(v)} aria-pressed={view === v} className={cn("px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", view === v ? "bg-primary-soft text-primary-strong" : "text-slate-600 hover:bg-slate-50")} data-testid={`reports-view-${v}`}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </span>
          {view !== "monthly" ? <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden /> : null}
          {view === "sent"
            ? sentFilters.map((f) => (
                <button key={f.key} type="button" onClick={() => setSentFilter(f.key)} aria-pressed={sentFilter === f.key} className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", sentFilter === f.key ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")} data-testid={`sent-filter-${f.key.replace(/^p:/, "partner-")}`}>
                  {f.label}
                  {f.n !== null ? <span className={cn("tabular ml-[5px]", sentFilter === f.key ? "text-primary-strong" : "text-slate-400")}>{f.n}</span> : null}
                </button>
              ))
            : null}
          {view === "week" && periodPills(data.periods, period).map((per) => (
            <button key={per.key} type="button" onClick={() => pickPeriod(per.key)} aria-pressed={period === per.key} className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", period === per.key ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")} data-testid={`reports-period-${per.key}`}>
              {per.label}
            </button>
          ))}
          {view !== "monthly" ? (
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
          ) : null}
          {view === "sent" ? <CollapseAllButton allCollapsed={ui.allCollapsed} onClick={ui.toggleAll} /> : null}
        </div>
      </PinnedBlock>

      {view === "monthly" ? (
        <MonthlyList items={monthly} />
      ) : view === "week" ? (
        <WeekView p={p} first={first} past={data.past} mostMissed={data.mostMissed} threshold={data.threshold} active={period} onOpen={(k) => pickPeriod(k, true)} />
      ) : (
        <WorkCard title="Sent reports" hint={replyNote ? undefined : "By email · a sent report never changes · replies from Gmail"} actions={replyNote ? <span className="text-[12.5px] text-status-soon" data-testid="replies-reconnect">{replyNote} <Link href="/settings" className="font-medium underline">Open Settings</Link></span> : undefined} testId="sent-reports-card">
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
                          <button key={r.id} type="button" onClick={() => setOpen(r)} className="row-hover grid w-full grid-cols-1 items-center gap-x-[18px] gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] text-left first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-8" data-testid="sent-row" data-state={r.state} data-day={r.day} data-replies={r.replies.length}>
                            <div className="min-w-0">
                              <Line1>
                                <Name>{r.dayLabel}</Name>
                                <span className="text-[13px] text-muted-foreground">
                                  {r.kind}
                                  {r.to.length ? ` · to ${r.to.map((t) => t.name).join(", ")}` : ""}
                                </span>
                              </Line1>
                              {r.state === "skipped" ? <Line2 className="text-muted-foreground">{r.summary}</Line2> : r.summary ? <Line2>{r.summary}</Line2> : null}
                              {r.replies.length ? (
                                <div className="mt-1 text-[13px] text-slate-700 italic" data-testid="sent-row-replies">
                                  {r.replies.map((x, i) => (
                                    <span key={x.id}>
                                      {i ? <span className="text-slate-400 not-italic"> · </span> : null}
                                      <b className="font-semibold not-italic text-primary-strong">{x.first}:</b> &ldquo;{shortQuote(x.text)}&rdquo;
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-x-3.5 whitespace-nowrap" data-row-right>
                              <span className="w-[92px] text-right text-xs text-muted-foreground" data-col="sent">
                                {r.state === "sent" ? `Sent ${r.sentTime}` : "Not sent"}
                              </span>
                              <span className="flex w-[96px] justify-end" data-col="pill">
                                <Pill tone={sentPill(r).tone} className="min-w-[84px] justify-center" testId="sent-pill">
                                  {sentPill(r).text}
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

      {open ? <SentReportDrawer key={open.id} row={open} composes={composes} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * Monthly reviews (push D, approved mockup V.reports): one row per month, newest first, with its line ("Not finished
 * yet · also on Work on now", "Finished Nov 4 · read only") and its pill (To do, Finished, Not finished). A row opens
 * the review page. Half the page wide at desktop width, like the mockup.
 */
function MonthlyList({ items }: { items: MonthlyListItem[] }) {
  const router = useRouter();
  return (
    <div className="w-full min-[1000px]:max-w-[760px]">
      <WorkCard title="Monthly reviews" hint="One per month, opened on its first workday" testId="monthly-reviews-card">
        <div className="flex flex-col pt-1 pb-2">
          {items.length ? (
            items.map((m) => (
              <button key={m.month} type="button" onClick={() => router.push(`/work/reports/monthly/${m.slug}`)} className="row-hover grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 border-t border-slate-100 px-[22px] py-[12px] text-left first:border-t-0" data-testid="monthly-review-row" data-month={m.slug} data-finished={m.finished ? "1" : "0"}>
                <div className="min-w-0">
                  <Name>{m.label}</Name>
                  <Line2 className="text-muted-foreground">{m.line}</Line2>
                </div>
                <Pill tone={m.finished ? "green" : m.current ? "amber" : "gray"} className="min-w-[96px] justify-center" testId="monthly-review-pill">
                  {m.finished ? "Finished" : m.current ? "To do" : "Not finished"}
                </Pill>
              </button>
            ))
          ) : (
            <p className="px-[22px] py-3 text-[13px] text-muted-foreground" data-testid="monthly-reviews-empty">
              No monthly review yet. The first one opens on the first workday of next month.
            </p>
          )}
        </div>
      </WorkCard>
    </div>
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
function WeekView({ p, first, past, mostMissed, threshold, active, onOpen }: { p: PeriodView; first: string; past: WeekTile[]; mostMissed: ReportsPage["mostMissed"]; /** The waiting threshold from Settings (days). */ threshold: number; active: PeriodKey; onOpen: (k: PeriodKey) => void }) {
  const needs = p.targets.filter((t) => !t.met);
  const month = p.key === "month";
  return (
    <div className="flex flex-col gap-6" data-testid="week-view" data-period={p.key}>
      <section data-testid="reports-group-went">
        <GroupHeading testId="went" note={<span data-testid="period-lead">{p.lead}</span>}>
          {month ? "How the month went" : "How the week went"}
        </GroupHeading>
        <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2 min-[1001px]:grid-cols-3 md:gap-4" data-testid="week-tiles">
          {p.tiles.map((t) => (
            <div key={t.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:px-5 md:py-4" data-testid="week-tile" data-label={t.label}>
              <b className={cn("tabular truncate text-[22px] leading-tight font-semibold tracking-[-0.01em] md:text-[26px]", t.status === "met" ? "text-status-met" : t.status === "missed" ? "text-status-missed" : t.value === "None" ? "text-slate-400" : "text-slate-900")}>
                {t.value}
                {t.small ? <span className="ml-1 text-[13px] font-medium text-muted-foreground">{t.small}</span> : null}
              </b>
              <span className="label-caps mt-0.5">{t.label}</span>
              <span className="mt-0.5 min-h-[19px] text-[12.5px] text-muted-foreground">{t.note}</span>
              {p.history[t.label] ? <Spark h={p.history[t.label]} /> : null}
            </div>
          ))}
        </div>
        <TargetsMetRow past={past} mostMissed={mostMissed} active={active} onOpen={onOpen} />
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
          <WorkCard title={`Waiting on brokers ${p.key === "this" ? "" : "now"}`.trim()} hint={`Day count turns amber at ${threshold}+ days, red at ${threshold * 2}+`} testId="report-waits">
            <Rows>
              {p.waits.map((w) => (
                <Row key={w.dealId} name={w.who ?? w.name} line={`${w.who ? `${w.name} · ` : ""}${w.what}${w.since ? ` · since ${w.since}` : ""}`} figure={String(w.days)} label="Days" tone={w.days >= threshold * 2 ? "missed" : w.days >= threshold ? "amber" : "plain"} />
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

/** The last 4 weeks under a tile: small bars drawn to scale with the value and the week, or done and not done marks. */
function Spark({ h }: { h: TileHistory }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-2.5" data-testid="tile-history" data-kind={h.kind}>
      {h.kind === "bars"
        ? h.weeks.map((w) => (
            <div key={w.weekStart} className="flex min-w-0 flex-col items-center gap-[3px] text-[10.5px] text-muted-foreground" data-testid="tile-history-week">
              <span className="flex h-[26px] w-full items-end justify-center border-b border-rule" aria-hidden>
                <i className={cn("block w-full max-w-[30px] rounded-t-[3px]", w.red ? "bg-status-missed-border" : "bg-[#b9cdf5]")} style={{ height: `${Math.round(w.share * 100)}%`, minHeight: w.value === "none" ? 0 : 1 }} />
              </span>
              <span className={cn("tabular text-xs font-semibold", w.value === "none" ? "font-medium text-slate-400" : "text-heading")}>{w.value}</span>
              {fmtDate(w.weekStart, "MMM d")}
            </div>
          ))
        : h.weeks.map((w) => (
            <div key={w.weekStart} className="flex min-w-0 flex-col items-center gap-[3px] text-[10.5px] text-muted-foreground" data-testid="tile-history-week">
              <span className="flex h-[26px] items-center justify-center">
                <StatusMark mark={w.done ? "met" : "missed"} size={16} testId="tile-history-mark" />
              </span>
              <span className="text-[10.5px] font-medium text-heading">{w.word}</span>
              {fmtDate(w.weekStart, "MMM d")}
            </div>
          ))}
    </div>
  );
}

/**
 * The slim "Targets met" row under the tiles (push B edits, in place of the Trend section): each of the past 4 weeks
 * with its met count and small segments, newest first, and "Most missed over 7 weeks: ..." at the right. A week
 * opens that week above.
 */
function TargetsMetRow({ past, mostMissed, active, onOpen }: { past: WeekTile[]; mostMissed: ReportsPage["mostMissed"]; active: PeriodKey; onOpen: (k: PeriodKey) => void }) {
  if (!past.length) return null;
  return (
    <div className="mt-4 grid grid-cols-2 items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-white px-5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] min-[901px]:grid-cols-[minmax(150px,auto)_repeat(4,minmax(0,1fr))_minmax(0,1.6fr)]" data-testid="past-weeks">
      <div className="col-span-2 text-[12.5px] font-medium text-heading min-[901px]:col-span-1">
        Targets met
        <small className="block text-xs font-normal text-muted-foreground">Past {past.length} weeks, of {past[0].total}</small>
      </div>
      {past.map((w, i) => {
        const key = pastWeekPeriodKey(i + 1);
        const low = w.total > 0 && w.met * 3 < w.total * 2;
        return (
          <button key={w.weekStart} type="button" onClick={() => onOpen(key)} aria-pressed={active === key} className={cn("flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-slate-50", active === key && "bg-primary-soft")} data-testid="past-week" data-period={key} data-met={w.met} title={w.missed.length ? `Missed: ${w.missed.map((m) => `${shortTargetName(m.name)} ${m.figure}`).join(", ")}` : "Every target met"}>
            <b className={cn("tabular text-sm font-semibold whitespace-nowrap", low ? "text-status-missed" : "text-slate-900")}>
              {w.met} of {w.total}
            </b>
            <span className="inline-flex gap-[2px]" aria-hidden>
              {Array.from({ length: w.total }, (_, n) => (
                <i key={n} className={cn("block h-3 w-1.5 rounded-[2px]", n < w.met ? (low ? "bg-status-missed-border" : "bg-[#b9cdf5]") : "bg-border")} />
              ))}
            </span>
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">{fmtDate(w.weekStart, "MMM d")}</span>
          </button>
        );
      })}
      <div className="col-span-2 text-left text-[12.5px] text-muted-foreground min-[901px]:col-span-1 min-[901px]:text-right" data-testid="most-missed">
        {mostMissed ? `Most missed over ${mostMissed.of} weeks: ${mostMissed.name}, ${mostMissed.n} of ${mostMissed.of}` : "Every week met"}
      </div>
    </div>
  );
}

/** A reply cut for a row (the drawer shows it in full). */
function shortQuote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 137).replace(/\s+\S*$/, "")}...` : t;
}

/**
 * The sent report (push B; push B edits: a large centered window, the same size as the report window on End of day):
 * the email as sent (a tab per partner when it went to two), then the replies read from Gmail, each with Reply
 * (which answers in the same Gmail thread) and "Make a task from this" (a task on that person's page).
 */
function SentReportDrawer({ row, composes, onClose }: { row: SentRow; composes: Record<string, ComposeSetup>; onClose: () => void }) {
  const [copyId, setCopyId] = useState<string | null>(row.to[0]?.reportId ?? null);
  const copy = row.to.find((t) => t.reportId === copyId) ?? row.to[0] ?? null;
  const html = copy?.html ?? row.html;
  const toLine = row.to.map((t) => t.name).join(", ");
  const opened = row.to.length > 1 ? row.to.map((t) => `${t.first} ${t.reviewedTime ?? "not yet"}`).join(" · ") : (row.reviewedTime ?? "not yet");
  const sub = row.state === "skipped" ? `Skipped · ${row.skipReason ?? "no reason given"}` : `Sent ${row.sentTime}${toLine ? ` to ${toLine}` : ""} · opened ${opened} · ${row.replies.length === 1 ? "1 reply" : `${row.replies.length} replies`}`;
  return (
    <CenteredWindow
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${fmtDate(row.day, "EEEE, MMM d")} · ${row.kind}`}
      sub={sub}
      size="report"
      testId="sent-report-drawer"
      footer={
        <>
          <span className="text-[12.5px] text-muted-foreground">A sent report never changes. Escape or × closes this.</span>
          <button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-[7px] border border-input bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50" data-testid="sent-close">
            Close
          </button>
        </>
      }
    >
      {row.state === "skipped" ? (
        <p className="text-sm text-slate-800" data-testid="sent-skipped-text">
          No report was sent. Reason: {row.skipReason ?? "no reason given"}. The day is not counted on the per-weekday targets; the next End of day asked for any reason still owed.
        </p>
      ) : (
        <>
          <div className="label-caps mb-2.5 flex flex-wrap items-center gap-2 border-b border-rule pb-[7px]" data-testid="sent-meta">
            The report as sent
            {row.to.length > 1 ? (
              <span className="ml-auto inline-flex overflow-hidden rounded-full border border-border bg-white tracking-normal normal-case" role="group" aria-label="Copy" data-testid="sent-copy-choice">
                {row.to.map((t, i) => (
                  <button key={t.reportId} type="button" onClick={() => setCopyId(t.reportId)} aria-pressed={t.reportId === copy?.reportId} className={cn("px-[13px] py-[5px] text-[12.5px] font-medium whitespace-nowrap", i ? "border-l border-border" : "", t.reportId === copy?.reportId ? "bg-primary-soft text-primary-strong" : "text-heading hover:bg-slate-50")}>
                    {t.name}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          {html ? (
            <div className="report-preview report-window report-sent min-w-0 overflow-x-auto text-[13px] text-slate-900" dangerouslySetInnerHTML={{ __html: html }} data-testid="sent-html" />
          ) : (
            <p className="text-sm text-muted-foreground">The email of this report was not kept.</p>
          )}
          <div className="label-caps mt-[22px] mb-1 flex items-center gap-2 border-b border-rule pb-[7px]" data-testid="sent-replies-heading">
            Replies <span className="tabular tracking-normal text-muted-foreground">{row.replies.length}</span>
            <span className="ml-auto text-xs font-normal tracking-normal text-muted-foreground normal-case">From Gmail</span>
          </div>
          {row.replies.length ? (
            <div className="flex flex-col" data-testid="sent-replies">
              {row.replies.map((x) => (
                <ReplyItem key={x.id} reply={x} compose={x.contactId ? composes[x.contactId] ?? null : null} subject={row.to.find((t) => t.reportId === x.reportId)?.subject ?? row.subject} />
              ))}
            </div>
          ) : (
            <p className="py-2 text-[13px] text-muted-foreground" data-testid="sent-no-replies">
              No replies yet. A reply to this email in Gmail shows here.
            </p>
          )}
        </>
      )}
    </CenteredWindow>
  );
}

/** One reply: who and when, the words, then Reply and "Make a task from this". */
function ReplyItem({ reply, compose, subject }: { reply: SentReply; compose: ComposeSetup | null; subject: string | null }) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [done, setDone] = useState<{ tone: "ok" | "warn"; text: string; href?: string } | null>(null);
  const [pending, start] = useTransition();
  const makeTask = () =>
    start(async () => {
      if (!reply.contactId) return setDone({ tone: "warn", text: "The person who replied is not on Contacts." });
      const r = await taskFromReply(reply.contactId, reply.first, reply.text);
      if (!r.ok) return setDone({ tone: "warn", text: r.error });
      setDone({ tone: "ok", text: `Added to ${reply.first}'s tasks.`, href: r.href });
      router.refresh();
    });
  const setup = compose ? { ...compose, threadId: reply.threadId } : null;
  return (
    <div className="grid grid-cols-[52px_24px_minmax(0,1fr)] gap-x-2 border-t border-slate-100 py-3 first:border-t-0" data-testid="sent-reply">
      <span className="pt-0.5 text-xs text-muted-foreground">{reply.dateLabel}</span>
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-primary-border bg-primary-soft text-[8.5px] font-bold text-primary-strong" aria-hidden>
        Re
      </span>
      <div className="min-w-0">
        <div className="text-sm text-slate-900">
          <b className="font-semibold">{reply.name}</b> <span className="text-[12.5px] text-muted-foreground">· {reply.time}</span>
        </div>
        <div className="mt-0.5 text-[13.5px] whitespace-pre-line text-slate-800 italic" data-testid="sent-reply-text">
          &ldquo;{reply.text}&rdquo;
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {setup ? (
            <RowButton tone="cobalt" onClick={() => setReplying(true)} data-testid="reply-button">
              Reply
            </RowButton>
          ) : null}
          <RowButton onClick={makeTask} disabled={pending} data-testid="reply-make-task">
            Make a task from this
          </RowButton>
        </div>
        {done ? (
          <Confirm tone={done.tone === "ok" ? "ok" : "warn"} className="mt-2" testId="reply-task-result">
            <span>{done.text}</span>
            {done.href ? (
              <Link href={done.href} className="font-medium underline">
                Open {reply.first}&apos;s page
              </Link>
            ) : null}
          </Confirm>
        ) : null}
      </div>
      {setup && replying ? (
        <ComposeEmailDialog
          setup={setup}
          open={replying}
          onOpenChange={setReplying}
          initial={{ subject: subject ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : "Re: your reply", body: "" }}
          onSent={() => {
            setDone({ tone: "ok", text: `Reply sent to ${reply.first} in the same Gmail thread.` });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

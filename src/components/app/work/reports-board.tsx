"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PeriodKey, PeriodView, ReportsPage, SentRow } from "@/lib/accountability/data";
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
 * right drawer with when it was opened and the reply.
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
  const matches = (r: SentRow) => !q || r.title.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q);
  const states = useMemo(() => data.sent.map((s) => ({ name: s.label, count: s.rows.length, hasMatch: s.rows.some(matches), defaultOpen: !s.collapsed })), [data.sent, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const ui = useSections(STORAGE_KEY, states, !!q);
  const pick = (v: "week" | "sent") => {
    setView(v);
    router.replace(v === "sent" ? "/work/reports?view=sent" : "/work/reports", { scroll: false });
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
          {data.periods.map((per) => (
            <button key={per.key} type="button" onClick={() => setPeriod(per.key)} aria-pressed={period === per.key} className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", period === per.key ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")} data-testid={`reports-period-${per.key}`}>
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
        <WeekView p={p} first={first} />
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

function WeekView({ p, first }: { p: PeriodView; first: string }) {
  return (
    <div data-testid="week-view" data-period={p.key}>
      <p className="mb-3 text-[13px] text-muted-foreground" data-testid="period-lead">
        {p.lead}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" data-testid="week-tiles">
        {p.tiles.map((t) => (
          <div key={t.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:px-5 md:py-4" data-testid="week-tile" data-label={t.label}>
            <b className={cn("tabular text-[22px] leading-tight font-semibold tracking-[-0.01em] md:text-[26px]", t.status === "met" ? "text-status-met" : t.status === "missed" ? "text-status-missed" : "text-slate-900")}>
              {t.value}
              {t.small ? <span className="ml-1 text-[13px] font-medium text-muted-foreground">{t.small}</span> : null}
            </b>
            <span className="label-caps mt-0.5">{t.label}</span>
            <span className="mt-1 min-h-[19px] text-[12.5px] text-muted-foreground">{t.note}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <WorkCard title={`Targets ${p.words}`} hint={`${p.targets.filter((t) => t.met).length} of ${p.targets.length} met`} testId="report-targets">
            <Rows>
              {p.targets.map((t) => (
                <Row key={t.name} name={t.name} line={t.line} figure={t.figure} label={t.met ? "Met" : "Missed"} tone={t.met ? "met" : "missed"} />
              ))}
              {!p.targets.length ? <p className="px-[22px] py-3 text-[13px] text-muted-foreground">No targets yet.</p> : null}
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
        <div className="flex flex-col gap-4">
          <WorkCard title={`Deals moved ${p.words}`} hint={`${p.moves.length} ${p.moves.length === 1 ? "move" : "moves"}${p.key === "month" ? ", newest first" : ""}`} testId="report-moves">
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
      </div>
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

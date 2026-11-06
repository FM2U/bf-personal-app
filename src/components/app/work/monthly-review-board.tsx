"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { finishMonthlyReview } from "@/app/actions/monthly";
import { ExportDownload } from "@/components/app/export-download";
import { useUnsavedWork } from "@/components/app/unsaved-changes";
import { date as fmtDate } from "@/lib/format";
import { nextTargetText, targetLineOf, type MonthResult, type NextTarget } from "@/lib/accountability/monthly";
import type { MonthlyReviewPage } from "@/lib/accountability/monthly-data";
import { StatusMark, Switch } from "@/components/app/work/targets-ui";
import { Confirm, Figure, Line1, Line2, Name, Pill, PinnedBlock, ROW_GRIDS, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The monthly review page (push D, approved mockup 2026-11-02 V.monthly; the app's components and tokens). Under the
 * pinned title, the line "Before you finish" (How October went, November targets and commitments, Export with "not
 * yet" or "done"), then two columns at desktop width (stacked on the phone):
 *   left:  How October went (each target: the status mark, weeks met of the month's full weeks, the average; the
 *          summary line under it) and Export (downloads the full export and notes it on the review);
 *   right: November targets (each target's October number, the November number to type, per weekday or per week,
 *          and the Commitment switch) and Finish the review (allowed without the export, with a note).
 * A finished review (or an older month) is read only: the same left card from the copy kept when it was finished, and
 * "November targets, as set".
 */
const INPUT = "tabular h-8 w-[72px] rounded-[7px] border border-input bg-white px-2 text-right text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const HEAD = "min-h-[76px]";

type Draft = Record<string, { number: string; commitment: boolean }>;

export function MonthlyReviewBoard({ data, title, tabs }: { data: MonthlyReviewPage; title: React.ReactNode; tabs: React.ReactNode }) {
  const router = useRouter();
  const editable = data.canFinish;
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(data.next.map((t) => [t.targetId, { number: String(t.number), commitment: t.commitment }])));
  const [downloaded, setDownloaded] = useState(false);
  const [finished, setFinished] = useState<{ exported: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const exported = downloaded || !!data.exportedOn;
  const changed = data.next.filter((t) => draft[t.targetId] && (draft[t.targetId].number !== String(t.number) || draft[t.targetId].commitment !== t.commitment)).length;
  useUnsavedWork(editable && changed > 0 && !finished, `Your ${data.nextName} targets are not saved yet. Press Finish the review to save them.`);
  const goCard = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const pad = (document.querySelector<HTMLElement>("[data-testid=monthly-sticky]")?.offsetHeight ?? 0) + 16;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - pad), behavior: "smooth" });
  };
  const finish = () =>
    start(async () => {
      setError(null);
      const r = await finishMonthlyReview(data.slug, data.next.map((t) => ({ id: t.targetId, number: draft[t.targetId]?.number ?? t.number, commitment: draft[t.targetId]?.commitment ?? t.commitment })));
      if (!r.ok) return setError(r.error);
      setFinished({ exported: r.exported || downloaded });
      router.refresh();
    });
  const download = () => {
    setDownloaded(true);
    // The export route noted the download on the review before the file came back; the page reads it again.
    router.refresh();
  };
  const readOnly = !editable;
  const status = [
    { key: "went", label: `How ${data.name} went`, word: null as string | null, tone: "off", card: "monthly-went" },
    { key: "targets", label: `${data.nextName} targets and commitments`, word: readOnly ? null : changed ? `${changed} changed` : null, tone: "off", card: "monthly-next" },
    { key: "export", label: "Export", word: exported ? "done" : "not yet", tone: exported ? "done" : "left", card: "monthly-export" },
  ];

  return (
    <>
      <PinnedBlock testId="monthly-sticky">
        {title}
        {tabs}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground" data-testid="monthly-status" data-exported={exported ? "1" : "0"} data-read-only={readOnly ? "1" : "0"}>
          <span className="whitespace-nowrap">{readOnly ? "Read only:" : "Before you finish:"}</span>
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {status.map((it, i) => (
              <span key={it.key} className="inline-flex items-center gap-2 whitespace-nowrap" data-testid={`monthly-step-${it.key}`}>
                {i ? <span className="hidden text-slate-400 sm:inline">·</span> : null}
                <button type="button" onClick={() => goCard(it.card)} className="font-medium text-primary-strong hover:underline">
                  {it.label}
                </button>
                {it.word ? <em className={cn("not-italic font-medium", it.tone === "left" ? "text-status-soon" : it.tone === "done" ? "text-status-met" : "text-muted-foreground")}>({it.word})</em> : null}
              </span>
            ))}
          </span>
        </div>
      </PinnedBlock>

      {finished ? (
        <Confirm tone="ok" className="mb-4" testId="monthly-finished">
          Review finished. {data.nextName} targets are saved and the row leaves Work on now. It stays under Reports, Monthly reviews.
        </Confirm>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-lg border border-status-missed-border bg-status-missed-bg px-3.5 py-2.5 text-[13px] text-status-missed" role="alert" data-testid="monthly-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="monthly-columns">
        <div className="flex min-w-0 flex-col gap-4">
          <WentCard data={data} />
          <WorkCard id="monthly-export" title="Export" hint={downloaded ? "Downloaded just now" : data.exportedOn ? `Downloaded ${data.exportedOn === data.today ? "today" : fmtDate(data.exportedOn, "MMM d")}` : data.lastExportOn ? `Last export ${fmtDate(data.lastExportOn, "MMM d")}` : "Not downloaded yet"} testId="monthly-export">
            {readOnly ? (
              <p className="px-[22px] pt-3 pb-4 text-[13px] text-muted-foreground" data-testid="monthly-export-read-only">
                {data.exportedOn ? `The export was downloaded ${fmtDate(data.exportedOn, "MMM d")} with this review.` : "No export was downloaded with this review."} Settings, Profile and export downloads one any time.
              </p>
            ) : (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-[22px] pt-3 pb-4">
              <ExportDownload
                href={`/api/export/full?review=${data.slug}`}
                onStarted={download}
                icon={<Download className="h-[15px] w-[15px]" aria-hidden />}
                className={cn("inline-flex h-[34px] items-center gap-2 rounded-[7px] border px-3.5 text-[13px] font-medium whitespace-nowrap disabled:border-border disabled:bg-slate-50 disabled:text-slate-400", exported ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary-strong bg-white text-primary-strong hover:bg-primary-soft")}
                testId="monthly-export-download"
              >
                Download the export
              </ExportDownload>
              <span className="min-w-0 flex-1 basis-[240px] text-[12.5px] text-muted-foreground">Every record: a zip file with one spreadsheet (CSV) per kind of record. Keep it as the monthly backup.</span>
            </div>
            )}
          </WorkCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {readOnly ? (
            <AsSetCard data={data} />
          ) : (
            <WorkCard id="monthly-next" title={`${data.nextName} targets`} sub="Change a number or a commitment. Starts when you finish." headerClassName={HEAD} testId="monthly-next">
              <div className="px-[22px] pt-1 pb-1" role="table" aria-label={`${data.nextName} targets`} data-testid="monthly-next-table">
                <div className="hidden grid-cols-[minmax(0,1fr)_64px_84px_88px_128px] items-center gap-x-3 border-b border-slate-100 py-2 sm:grid" role="row">
                  {["Target", data.name, data.nextName, "Per", "Commitment"].map((h, i) => (
                    <span key={h} role="columnheader" className={cn("label-caps text-slate-500", (i === 1 || i === 2) && "text-right")}>
                      {h}
                    </span>
                  ))}
                </div>
                {data.next.map((t) => (
                  <NextRow key={t.targetId} t={t} value={draft[t.targetId]} monthName={data.name} nextName={data.nextName} onChange={(v) => setDraft((d) => ({ ...d, [t.targetId]: v }))} />
                ))}
              </div>
              <p className="px-[22px] pt-2 pb-4 text-[12.5px] text-muted-foreground">A commitment asks for a one-line reason on End of day when it is missed.</p>
            </WorkCard>
          )}
          {readOnly ? (
            <section className="rounded-xl border border-border bg-white px-[22px] py-4 text-[13px] text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="monthly-read-only">
              <p data-testid="monthly-read-only-line">
                {data.finishedOn ? `Read only. Finished ${fmtDate(data.finishedOn, "MMM d")}; ${data.exportedOn ? `export downloaded ${fmtDate(data.exportedOn, "MMM d")}` : "finished without the export"}.` : `Read only. This review was not finished; only the review of the month just ended can be finished.`}
              </p>
            </section>
          ) : (
            <section className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-border bg-white px-[22px] py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="monthly-finish-card">
              <button type="button" onClick={finish} disabled={pending || !!finished} className="inline-flex h-[38px] items-center gap-2 rounded-[7px] border border-primary-solid bg-primary-solid px-4 text-sm font-medium whitespace-nowrap text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover disabled:opacity-50" data-testid="monthly-finish" data-busy={pending ? "1" : "0"}>
                {pending ? (
                  <>
                    <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin" aria-hidden />
                    <span role="status">Saving…</span>
                  </>
                ) : (
                  "Finish the review"
                )}
              </button>
              <span className={cn("min-w-0 flex-1 basis-[220px] text-[12.5px]", exported ? "text-muted-foreground" : "text-status-soon")} data-testid="monthly-finish-note">
                {exported ? `Saves ${data.nextName} targets and commitments.` : "Export not downloaded yet. You can still finish."}
              </span>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** How the month went: one row per target (the mark, weeks met, the average), the summary under it. */
function WentCard({ data }: { data: MonthlyReviewPage }) {
  return (
    <WorkCard id="monthly-went" title={`How ${data.name} went`} sub={data.weeks ? `Weeks met, of ${data.weeks} full ${data.weeks === 1 ? "week" : "weeks"}` : "No full work week in this month"} headerClassName={HEAD} testId="monthly-went">
      <div className="flex flex-col pt-1">
        {data.results.map((r) => (
          <WentRow key={r.targetId || r.name} r={r} />
        ))}
      </div>
      <p className="border-t border-slate-100 px-[22px] pt-2.5 pb-4 text-[12.5px] text-muted-foreground" data-testid="monthly-summary">
        {data.summary}
      </p>
    </WorkCard>
  );
}

function WentRow({ r }: { r: MonthResult }) {
  const allMet = r.weeks > 0 && r.weeksMet === r.weeks;
  return (
    <div className={cn("grid items-center gap-y-1 border-t border-slate-100 px-[22px] py-[11px] first:border-t-0", ROW_GRIDS.monthlyWent.cls, ROW_GRIDS.monthlyWent.gapCls)} data-testid="monthly-went-row" data-target={r.name} data-met={allMet ? "1" : "0"}>
      <div className={cn("min-w-0", ROW_GRIDS.monthlyWent.textMarginCls)} data-row-text>
        <Line1>
          <Name>{r.name}</Name>
          {r.commitment ? <Pill tone="blue">Commitment</Pill> : null}
        </Line1>
        <Line2 className="text-[12.5px] text-muted-foreground">{targetLineOf(r)}</Line2>
      </div>
      <StatusMark mark={allMet ? "met" : "missed"} />
      <Figure value={`${r.weeksMet} of ${r.weeks}`} label="Weeks met" className={cn("w-[82px]", allMet && "[&>b]:text-status-met")} testId="monthly-weeks-met" />
      <Figure value={r.average} label="Average" className="col-start-3 w-[86px] sm:col-start-auto" testId="monthly-average" />
    </div>
  );
}

/** One target in the next month's table: the number to type and the Commitment switch (stacked on the phone). */
function NextRow({ t, value, monthName, nextName, onChange }: { t: NextTarget; value: { number: string; commitment: boolean } | undefined; monthName: string; nextName: string; onChange: (v: { number: string; commitment: boolean }) => void }) {
  const v = value ?? { number: String(t.number), commitment: t.commitment };
  const per = t.cadence === "day" ? "weekday" : "week";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_60px_80px_72px_96px]" role="row" data-testid="monthly-next-row" data-target={t.name}>
      <span role="cell" className="col-span-2 min-w-0 text-sm font-semibold text-slate-900 sm:col-span-1">
        {t.name}
        <span className="block text-[12.5px] font-normal text-muted-foreground sm:hidden">
          {monthName}: {nextTargetText(t)} per {per}
        </span>
      </span>
      <span role="cell" className="tabular hidden text-right text-sm text-slate-600 sm:block" data-testid="monthly-next-before">
        {nextTargetText(t)}
      </span>
      <span role="cell" className="flex items-center gap-2 sm:justify-end">
        <input type="number" inputMode="numeric" min={1} max={t.unit === "percent" ? 100 : 1000} value={v.number} onChange={(e) => onChange({ ...v, number: e.target.value })} className={INPUT} aria-label={`${nextName} target for ${t.name}`} data-testid="monthly-next-number" />
        <span className="text-[12.5px] text-muted-foreground sm:hidden">{t.unit === "percent" ? "% per week" : `per ${per}`}</span>
      </span>
      <span role="cell" className="hidden text-[13px] text-slate-600 sm:block">
        {t.unit === "percent" ? "Week, %" : t.cadence === "day" ? "Weekday" : "Week"}
      </span>
      <span role="cell" className="justify-self-end sm:justify-self-start">
        <span className="flex items-center gap-2">
          <span className={cn("text-[12.5px] sm:hidden", v.commitment ? "font-semibold text-primary-strong" : "text-muted-foreground")} aria-hidden>
            Commitment
          </span>
          <Switch on={v.commitment} onChange={(on) => onChange({ ...v, commitment: on })} label={`Commitment: ${t.name}`} hideLabel testId="monthly-next-commitment" />
        </span>
      </span>
    </div>
  );
}

/** A finished review: next month's targets as they were set. */
function AsSetCard({ data }: { data: MonthlyReviewPage }) {
  return (
    <WorkCard id="monthly-next" title={`${data.nextName} targets, as set`} sub={data.finishedOn ? `Set when the review was finished, ${fmtDate(data.finishedOn, "MMM d")}` : "The targets as they are now"} headerClassName={HEAD} testId="monthly-as-set">
      <div className="flex flex-col pt-1 pb-2">
        {data.next.map((t) => (
          <div key={t.targetId || t.name} className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-x-4 border-t border-slate-100 px-[22px] py-[11px] first:border-t-0" data-testid="monthly-as-set-row" data-target={t.name}>
            <Line1>
              <Name>{t.name}</Name>
              {t.commitment ? <Pill tone="blue">Commitment</Pill> : null}
            </Line1>
            <Figure value={nextTargetText(t)} label={t.cadence === "day" ? "Per weekday" : "Per week"} className="w-[104px]" testId="monthly-as-set-figure" />
          </div>
        ))}
      </div>
    </WorkCard>
  );
}

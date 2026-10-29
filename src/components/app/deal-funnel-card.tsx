import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { suggestionText, targetTimeText, type FunnelStep } from "@/lib/calc/deal-funnel";
import { FUNNEL_WINDOWS, type DealPlan, type FunnelData } from "@/lib/deal-funnel";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_FILE_0016 } from "@/lib/schema-guard";
import { cn } from "@/lib/utils";

/**
 * Deal funnel on the Acquisitions page: six steps in one row on desktop (Listings screened, Deals sourced, NDAs signed,
 * CIMs reviewed, Calls, LOIs), each with its count, the percent of the previous step, and proprietary and brokered
 * counts. Two columns on a tablet; one row per step on the phone. A 30 or 90 day choice in the header.
 * Under the steps: the suggested targets line and, after 14 days of data, how actual conversion compares with the targets.
 */
export function DealFunnelCard({ data, hrefFor }: { data: FunnelData; hrefFor: (days: number) => string }) {
  return (
    <Card data-testid="deal-funnel">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-3">
        <CardTitle>Deal funnel, last {data.days} days</CardTitle>
        <div className="flex rounded-md border border-border bg-white p-0.5" role="group" aria-label="Days shown">
          {FUNNEL_WINDOWS.map((d) => (
            <Button key={d} asChild size="sm" variant={data.days === d ? "default" : "ghost"} className="h-7 px-2.5">
              <Link href={hrefFor(d)} aria-current={data.days === d ? "true" : undefined} scroll={false}>
                {d} days
              </Link>
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!data.available ? <DbUpdateNotice compact file={DB_UPDATE_FILE_0016} /> : null}
        <ol className="grid grid-cols-1 overflow-hidden rounded-lg border border-slate-200 sm:grid-cols-3 xl:grid-cols-6" data-testid="funnel-steps">
          {data.steps.map((s, i) => (
            <StepCell key={s.key} step={s} index={i} counted={s.key !== "listings" || data.available} />
          ))}
        </ol>
        {/* Suggested targets and the conversion comparison side by side from 1024px, so no wide blank space is left. */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SuggestedTargets plan={data.plan} />
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm" data-testid="funnel-notes">
            <p className="font-semibold text-slate-900">Conversion compared with your targets</p>
            {data.notes.map((n) => (
              <p key={n} className="text-slate-800">
                {n}
              </p>
            ))}
            {data.dataDays < 14 ? (
              <p className="text-xs leading-5 text-slate-600">Deals to CIMs shows after 14 days with deals ({data.dataDays} so far).</p>
            ) : null}
            {data.available && data.listingsDays < 14 ? (
              <p className="text-xs leading-5 text-slate-600">Listings to deals shows after 14 days of counting listings ({data.listingsDays} so far).</p>
            ) : null}
          </div>
        </div>
      </CardContent>
      <CardNote>
        {fmtDate(data.from, "MMM d")} to {fmtDate(data.to, "MMM d")}. Stage steps count each deal once, on the day it first moved to that stage or a later one
        (not the stage it was added in). Calls are calls and meetings logged on a deal, one per deal per day. The percent is this step divided by the step
        before it.
      </CardNote>
    </Card>
  );
}

function StepCell({ step, index, counted }: { step: FunnelStep; index: number; counted: boolean }) {
  const pct = step.conversionPct;
  return (
    <li
      className={cn(
        "relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-slate-200 px-3 py-2.5 sm:flex sm:flex-col sm:items-stretch sm:gap-0 sm:py-3",
        index > 0 && "border-t sm:border-t-0",
        // Tablet: 3 columns (a line between columns and between the two rows). Desktop: one row of 6.
        index % 3 !== 0 && "sm:border-l",
        index >= 3 && "sm:border-t xl:border-t-0",
        index === 3 && "xl:border-l",
      )}
      data-testid={`funnel-${step.key}`}
    >
      {index > 0 ? (
        <ChevronRight aria-hidden className={cn("absolute -left-2 top-1/2 hidden size-4 -translate-y-1/2 rounded-full bg-white text-gold", index % 3 !== 0 && "sm:block", index === 3 && "xl:block")} />
      ) : null}
      <span className="clamp-2 text-xs font-medium leading-4 text-slate-700 sm:min-h-8">{step.label}</span>
      <span className="tabular row-span-2 text-right text-2xl font-semibold leading-tight text-slate-900 sm:mt-1 sm:text-left" data-testid="funnel-count">
        {counted ? step.count : <span className="text-base font-medium text-muted-foreground">Not counted yet</span>}
      </span>
      <span className="text-xs leading-5 text-slate-600">
        {index === 0 ? (
          "First step"
        ) : pct === null ? (
          "No previous step count"
        ) : (
          <>
            <span className="tabular font-semibold text-primary-strong">{pct}%</span> of previous
          </>
        )}
      </span>
      {step.split ? (
        <span className="col-span-2 text-[11px] leading-4 text-slate-600 sm:col-span-1">
          <span className="tabular font-medium text-gold-strong">{step.split.proprietary}</span> proprietary,{" "}
          <span className="tabular font-medium text-slate-800">{step.split.brokered}</span> brokered
          {step.split.notSet ? `, ${step.split.notSet} not set` : ""}
        </span>
      ) : (
        <span className="col-span-2 text-[11px] leading-4 text-muted-foreground sm:col-span-1">Counted with +1 and +5</span>
      )}
    </li>
  );
}

/** "Suggested targets: With 2 hours a day: ..." plus how long the current targets take, with links to change them. */
export function SuggestedTargets({ plan, className }: { plan: DealPlan; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-lg border border-gold-border bg-gold-soft/60 px-3 py-2 text-sm", className)} data-testid="suggested-targets">
      <p className="text-slate-900">
        <span className="font-semibold text-gold-strong">Suggested targets:</span> {suggestionText(plan.suggestion)}
      </p>
      <p className="text-xs leading-5 text-slate-700">
        {targetTimeText(plan.suggestion)} Change the hours and minutes in{" "}
        <Link href="/plan/inputs" className="text-primary-strong underline">
          Plan, Inputs
        </Link>
        ; edit targets on{" "}
        <Link href="/accountability/targets" className="text-primary-strong underline">
          Targets
        </Link>
        . Suggestions only: nothing changes on its own.
      </p>
    </div>
  );
}

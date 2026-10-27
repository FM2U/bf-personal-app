"use client";

/**
 * Scenario summary window (large): what changed, the results, savings targets, and job vs acquisition with the bridge,
 * side by side in 3 columns, with two small charts. Every line opens what it summarizes: an input's quick view in the
 * same window, or that section of the full scenario page. Data: loadScenarioSummary (src/lib/scenario-summary.ts).
 */
import Link from "next/link";
import { ArrowRightLeft, Briefcase, LineChart as LineIcon, PiggyBank, SlidersHorizontal } from "lucide-react";
import { LineSeriesChart } from "@/components/app/charts";
import { useWindowNav } from "@/components/app/window-host";
import { ErrorView, FullPageButton, LoadingView, ViewLayout, useLoad } from "@/components/app/windows/views";
import { loadScenarioSummary } from "@/app/actions/window";
import { parseWindowParam } from "@/lib/window-route";
import type { DrillLine, ScenarioSummaryData } from "@/lib/scenario-summary";
import { CHART_BASELINE, seriesColor } from "@/lib/status";
import { cn } from "@/lib/utils";

type Data = ({ ok: true } & ScenarioSummaryData) | { ok: false; error: string };

const LINE = "-mx-2 grid w-[calc(100%+1rem)] items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Tile({ title, icon: Icon, children, className, testId }: { title: string; icon: typeof LineIcon; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-white px-4 pb-3 pt-3.5", className)} data-testid={testId}>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon aria-hidden className="h-4 w-4 text-gold" strokeWidth={1.75} />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A line that opens a window view (same window) or a page section. */
function Drill({ line, cols, children }: { line: { window?: string; href?: string }; cols: string; children: React.ReactNode }) {
  const nav = useWindowNav();
  const target = line.window ? parseWindowParam(line.window) : null;
  if (target) {
    return (
      <button type="button" className={LINE} style={{ gridTemplateColumns: cols }} onClick={() => nav.push(target)} data-testid="summary-line">
        {children}
      </button>
    );
  }
  if (line.href) {
    return (
      <Link href={line.href} className={LINE} style={{ gridTemplateColumns: cols }} data-testid="summary-line">
        {children}
      </Link>
    );
  }
  return (
    <div className="grid gap-3 py-1.5" style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}

function ValueTable({ columns, lines, testId }: { columns: string[]; lines: DrillLine[]; testId?: string }) {
  const cols = `minmax(0,1.5fr) repeat(${columns.length}, minmax(0,1fr))`;
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="grid gap-3 border-b border-slate-100 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns: cols }}>
        <span>Result</span>
        {columns.map((c, i) => (
          <span key={i} className="clamp-1 text-right" title={c}>
            {i === 0 ? "Now" : c}
          </span>
        ))}
      </div>
      {lines.map((l) => (
        <Drill key={l.label} line={l} cols={cols}>
          <span className="clamp-2 text-sm text-slate-700">{l.label}</span>
          {l.values.map((v, i) => (
            <span key={i} className={cn("tabular text-right text-sm", i === 0 ? "text-slate-600" : "font-medium text-slate-900")}>
              {v}
            </span>
          ))}
        </Drill>
      ))}
    </div>
  );
}

export function ScenarioSummaryWindow({ ids }: { ids: string[] }) {
  const { data } = useLoad<Data>(`ss:${ids.join(",")}`, () => loadScenarioSummary(ids));
  const full = ids.length === 1 ? `/plan/scenarios/${ids[0]}` : `/plan/scenarios/compare?ids=${ids.join(",")}`;
  if (!data) return <LoadingView title="Scenario summary" />;
  if (!data.ok) return <ErrorView error={data.error} href={full} />;
  const many = data.columns.length > 2;
  const series = data.columns.map((name, i) => ({ key: `c${i}`, label: i === 0 ? "Current" : name, color: i === 0 ? CHART_BASELINE : seriesColor(i - 1) }));
  return (
    <ViewLayout title={data.title} subtitle={data.subtitle} askLabel={data.title.replace(/^Summary: /, "Scenario: ")} footer={<><span className="flex-1" /><FullPageButton href={data.fullHref} variant="default" /></>}>
      <div className={cn("grid grid-cols-1 items-start gap-4", many ? "lg:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-3")} data-testid="scenario-summary">
        <div className="flex min-w-0 flex-col gap-4">
          <Tile title="Numbers changed" icon={SlidersHorizontal} testId="summary-changed">
            {data.changed.map((g) => (
              <div key={g.scenario} className="flex flex-col">
                {data.changed.length > 1 ? <p className="mt-1 text-xs font-semibold text-slate-700">{g.scenario}</p> : null}
                {g.lines.length ? (
                  g.lines.map((l) => (
                    <Drill key={l.label} line={l} cols="minmax(0,1fr) auto">
                      <span className="clamp-2 text-sm text-slate-900">{l.label}</span>
                      <span className="tabular whitespace-nowrap text-sm">
                        <span className="text-slate-500">{l.from}</span> <span aria-hidden className="text-slate-400">to</span> <span className="font-medium text-slate-900">{l.to}</span>
                      </span>
                    </Drill>
                  ))
                ) : (
                  <p className="py-1 text-sm text-muted-foreground">No numbers changed yet.</p>
                )}
              </div>
            ))}
          </Tile>
          <Tile title="Savings targets" icon={PiggyBank} testId="summary-savings">
            <ValueTable columns={data.columns} lines={data.savings} />
          </Tile>
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4", many && "lg:col-span-2")}>
          <Tile title="Results" icon={LineIcon} testId="summary-results">
            <ValueTable columns={data.columns} lines={data.results} />
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-xs font-medium text-slate-700">Cash by month</p>
              <LineSeriesChart data={data.cash} xKey="month" series={series} height={150} zeroLine />
            </div>
          </Tile>
        </div>
        <Tile title="Job vs acquisition and the bridge" icon={Briefcase} className={cn(many ? "lg:col-span-3" : "md:col-span-2 xl:col-span-1")} testId="summary-paths">
          <ValueTable columns={data.columns} lines={data.paths} />
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <ArrowRightLeft aria-hidden className="h-3.5 w-3.5 text-slate-500" /> Acquisition minus job, by year
            </p>
            <LineSeriesChart data={data.pathGap} xKey="year" series={series} height={150} zeroLine />
          </div>
        </Tile>
      </div>
    </ViewLayout>
  );
}

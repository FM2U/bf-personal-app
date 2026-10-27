import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { computeMetrics } from "@/lib/metrics";
import { baselineFromSnapshot, loadScenario, runScenario } from "@/lib/scenarios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { LineSeriesChart } from "@/components/app/charts";
import { ScenarioComparisonTable, mergeSeries } from "@/components/app/scenario-results";
import { CHART_BASELINE, CHART_SERIES } from "@/lib/status";

const COLORS = CHART_SERIES;

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? sp.ids.split(",") : []).slice(0, 5);
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const base = baselineFromSnapshot((await computeMetrics(supabase, ctx.today)).snapshot);
  const loaded = (await Promise.all(ids.map((id) => loadScenario(supabase, id)))).filter((x) => x !== null);
  const horizon = Math.max(12, ...loaded.map((l) => Number(l.scenario.horizon_months) || 60));
  const current = runScenario(base, {}, horizon).result;
  const cols = loaded.map((l, i) => ({ key: `s${i}`, name: l.scenario.name as string, result: runScenario(base, l.overrides, horizon).result }));
  return (
    <div>
      <Link href="/plan/scenarios" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> Scenarios
      </Link>
      <PageHeader title="Compare scenarios" description={`Current numbers and ${cols.length} scenario(s), projected ${horizon} months.`} />
      {cols.length ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Results side by side</CardTitle>
            </CardHeader>
            <CardContent>
              <ScenarioComparisonTable columns={[{ name: "Current numbers", result: current, horizon }, ...cols.map((c) => ({ name: c.name, result: c.result, horizon }))]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cash balance by month</CardTitle>
            </CardHeader>
            <CardContent>
              <LineSeriesChart
                height={280}
                zeroLine
                data={mergeSeries([{ key: "current", result: current }, ...cols], "cash")}
                xKey="month"
                series={[{ key: "current", label: "Current", color: CHART_BASELINE }, ...cols.map((c, i) => ({ key: c.key, label: c.name, color: COLORS[i % COLORS.length] }))]}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState title="No scenarios selected." body="Go back and select the scenarios to compare." />
      )}
    </div>
  );
}

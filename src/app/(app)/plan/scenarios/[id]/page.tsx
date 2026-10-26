import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { computeMetrics } from "@/lib/metrics";
import { baselineFromSnapshot, loadScenario, runScenario } from "@/lib/scenarios";
import { BASELINE_OVERRIDE_KEYS } from "@/lib/calc/scenario";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { LineSeriesChart } from "@/components/app/charts";
import { ScenarioComparisonTable, mergeSeries } from "@/components/app/scenario-results";
import { saveScenarioOverrides } from "@/app/actions/domain";
import { money } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const loaded = await loadScenario(supabase, id);
  if (!loaded) notFound();
  const { scenario, overrides } = loaded;
  const ctx = await loadCtx(supabase, ownerId);
  const metrics = await computeMetrics(supabase, ctx.today);
  const base = baselineFromSnapshot(metrics.snapshot);
  const horizon = Number(scenario.horizon_months) || 60;
  const current = runScenario(base, {}, horizon);
  const sc = runScenario(base, overrides, horizon);
  const inputs = metrics.snapshot.inputs.rows.filter((i: Row) => !["text", "date"].includes(i.unit));
  const baselineValues: Record<string, number> = {
    starting_cash: base.cash,
    monthly_spending: base.monthlySpending,
    monthly_income: base.monthlyIncome,
    monthly_investment_contribution: 0,
    one_time_amount: 0,
    one_time_month: 0,
  };
  const jva = sc.jobVsAcquisition;
  const bridge = sc.bridge;
  const showJva = scenario.kind === "job_vs_acquisition";
  const cashData = mergeSeries([{ key: "current", result: current.result }, { key: "scenario", result: sc.result }], "cash");
  const nwData = mergeSeries([{ key: "current", result: current.result }, { key: "scenario", result: sc.result }], "netWorth");
  return (
    <div>
      <Link href="/plan/scenarios" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> Scenarios
      </Link>
      <PageHeader
        title={scenario.name}
        description={`${showJva ? "Job vs acquisition scenario" : "Scenario"}. ${Object.keys(overrides).length} numbers changed from the current numbers. Projected ${horizon} months.`}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`/records/scenarios/${id}?edit=1`}>
              <Pencil /> Rename or change months
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Results side by side</CardTitle>
            </CardHeader>
            <CardContent>
              <ScenarioComparisonTable columns={[{ name: "Current numbers", result: current.result, horizon }, { name: scenario.name, result: sc.result, horizon }]} />
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cash balance by month</CardTitle>
              </CardHeader>
              <CardContent>
                <LineSeriesChart data={cashData} xKey="month" zeroLine series={[{ key: "current", label: "Current", color: "#94a3b8" }, { key: "scenario", label: scenario.name, color: "#0f766e" }]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Net worth by month</CardTitle>
              </CardHeader>
              <CardContent>
                <LineSeriesChart data={nwData} xKey="month" series={[{ key: "current", label: "Current", color: "#94a3b8" }, { key: "scenario", label: scenario.name, color: "#0f766e" }]} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Job vs acquisition</CardTitle>
              <CardDescription>Salary-only take-home pay compared with acquisition take-home salary plus the estimated value of your equity, by year. Equity value = your share x (business value after growth minus remaining purchase debt).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {jva.missing.length ? <Notice tone="warn">Set these numbers (below or in Inputs) to complete the comparison: {jva.missing.map((k) => inputs.find((i: Row) => i.key === k)?.label ?? k).join(", ")}.</Notice> : null}
              <LineSeriesChart
                data={jva.rows.map((r) => ({ year: `Year ${r.year}`, job: r.jobCumulative, acquisition: r.acquisitionTotal, salary: r.acquisitionSalaryCumulative }))}
                xKey="year"
                series={[
                  { key: "job", label: "Job: cumulative take-home pay", color: "#64748b" },
                  { key: "acquisition", label: "Acquisition: salary plus equity value", color: "#0f766e" },
                  { key: "salary", label: "Acquisition: salary only", color: "#5eead4" },
                ]}
              />
              <p className="text-sm">{jva.crossoverYear ? `The acquisition path is ahead from year ${jva.crossoverYear}.` : "The acquisition path does not pass the job path within the years compared."}</p>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Year</TH>
                    <TH className="text-right">Job</TH>
                    <TH className="text-right">Acquisition salary</TH>
                    <TH className="text-right">Equity value</TH>
                    <TH className="text-right">Acquisition total</TH>
                    <TH className="text-right">Difference</TH>
                  </TR>
                </THead>
                <TBody>
                  {jva.rows.map((r) => (
                    <TR key={r.year}>
                      <TD>{r.year}</TD>
                      <TD className="tabular text-right">{money(r.jobCumulative)}</TD>
                      <TD className="tabular text-right">{money(r.acquisitionSalaryCumulative)}</TD>
                      <TD className="tabular text-right">{money(r.acquisitionEquityValue)}</TD>
                      <TD className="tabular text-right">{money(r.acquisitionTotal)}</TD>
                      <TD className={`tabular text-right ${r.difference < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(r.difference)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bridge: job vs acquisition search with consulting income</CardTitle>
              <CardDescription>
                The job, compared with an acquisition search that pays no salary for {bridge.searchMonths} months (Months allowed for the acquisition search), plus consulting income of {money(bridge.consultingMonthly)} per month for {bridge.consultingMonths} months, then the acquisition salary and equity value. Take-home amounts after the effective tax rate.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {bridge.missing.length ? <Notice tone="warn">Set these numbers (below or in Inputs) to complete the comparison: {bridge.missing.map((k) => inputs.find((i: Row) => i.key === k)?.label ?? k).join(", ")}.</Notice> : null}
              {!bridge.consultingMonthly ? <Notice>Consulting income is 0. Set &quot;Consulting: monthly income&quot; below or in Inputs to see the bridge.</Notice> : null}
              <LineSeriesChart
                data={bridge.rows.map((r) => ({ year: `Year ${r.year}`, job: r.jobCumulative, bridge: r.bridgeTotal, without: r.withoutConsultingTotal }))}
                xKey="year"
                series={[
                  { key: "job", label: "Job: cumulative take-home pay", color: "#64748b" },
                  { key: "bridge", label: "Search with consulting, then acquisition", color: "#0f766e" },
                  { key: "without", label: "Search without consulting, then acquisition", color: "#5eead4" },
                ]}
              />
              <p className="text-sm">{bridge.crossoverYear ? `The bridge path is ahead from year ${bridge.crossoverYear}.` : "The bridge path does not pass the job path within the years compared."}</p>
              <p className="text-xs text-muted-foreground">Salary = acquisition salary after the search. Equity = equity value. Total = consulting plus salary plus equity. All cumulative.</p>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Year</TH>
                    <TH className="text-right">Job</TH>
                    <TH className="text-right">Consulting</TH>
                    <TH className="text-right">Salary</TH>
                    <TH className="text-right">Equity</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Difference</TH>
                  </TR>
                </THead>
                <TBody>
                  {bridge.rows.map((r) => (
                    <TR key={r.year}>
                      <TD>{r.year}</TD>
                      <TD className="tabular text-right">{money(r.jobCumulative)}</TD>
                      <TD className="tabular text-right">{money(r.consultingCumulative)}</TD>
                      <TD className="tabular text-right">{money(r.acquisitionSalaryCumulative)}</TD>
                      <TD className="tabular text-right">{money(r.acquisitionEquityValue)}</TD>
                      <TD className="tabular text-right">{money(r.bridgeTotal)}</TD>
                      <TD className={`tabular text-right ${r.difference < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(r.difference)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Numbers changed in this scenario</CardTitle>
            <CardDescription>Leave a field empty to use the current number (shown in grey).</CardDescription>
          </CardHeader>
          <CardContent>
            <GuardedForm action={saveScenarioOverrides} className="flex flex-col gap-4">
              <input type="hidden" name="scenario_id" value={id} />
              <OverrideGroup title="Current figures" items={BASELINE_OVERRIDE_KEYS.map((b) => ({ key: b.key, label: b.label, current: baselineValues[b.key] }))} overrides={overrides} />
              {base.debts.length ? (
                <OverrideGroup
                  title="Debts"
                  items={base.debts.flatMap((d) => [
                    { key: `debt.${d.id}.apr`, label: `${d.name}: interest rate (%)`, current: d.apr },
                    { key: `debt.${d.id}.min_payment`, label: `${d.name}: monthly payment`, current: d.minPayment },
                  ])}
                  overrides={overrides}
                />
              ) : null}
              <OverrideGroup title="Inputs and Assumptions" items={inputs.map((i: Row) => ({ key: i.key, label: i.label, current: i.value_number === null ? null : Number(i.value_number) }))} overrides={overrides} />
              <SubmitButton>Save and recalculate</SubmitButton>
            </GuardedForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverrideGroup({ title, items, overrides }: { title: string; items: { key: string; label: string; current: number | null }[]; overrides: Record<string, number> }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</legend>
      {items.map((it) => (
        <label key={it.key} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
          <span className="clamp-2 leading-tight">{it.label}</span>
          <Input name={`ov:${it.key}`} type="number" step="any" defaultValue={overrides[it.key] ?? ""} placeholder={it.current === null ? "Not set" : String(Math.round(it.current * 100) / 100)} className={overrides[it.key] !== undefined ? "border-teal-600 bg-teal-50/40" : ""} />
        </label>
      ))}
    </fieldset>
  );
}

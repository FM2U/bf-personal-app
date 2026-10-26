import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadFinanceSnapshot } from "@/lib/finance";
import { budgetVariance } from "@/lib/calc/savings";
import { monthBounds, previousMonthKeys } from "@/lib/calc/dates";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { BarSeriesChart } from "@/components/app/charts";
import { ListCard } from "@/components/app/list-card";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : ctx.today.slice(0, 7);
  const snap = await loadFinanceSnapshot(supabase, ctx.today);
  const [{ data: budgets }, { data: lines }, { data: cats }, { data: reductions }] = await Promise.all([
    supabase.from("budgets").select("*").eq("is_active", true).order("created_at"),
    supabase.from("budget_lines").select("*"),
    supabase.from("categories").select("id,name"),
    supabase.from("reduction_actions").select("*"),
  ]);
  const budget = ((budgets ?? []) as Row[])[0] ?? null;
  const catName = Object.fromEntries(((cats ?? []) as Row[]).map((c) => [c.id, c.name]));
  const myLines = ((lines ?? []) as Row[]).filter((l) => budget && l.budget_id === budget.id);
  const actualFor = (m: string) => {
    const b = monthBounds(`${m}-01`);
    const out: Record<string, number> = {};
    for (const t of snap.transactions) {
      if (t.is_transfer || Number(t.amount) >= 0 || !t.category_id || t.date < b.start || t.date > b.end) continue;
      out[t.category_id] = (out[t.category_id] ?? 0) - Number(t.amount);
    }
    return out;
  };
  const v = budgetVariance(
    myLines.map((l) => ({ category_id: l.category_id, current_monthly: Number(l.current_monthly), target_monthly: Number(l.target_monthly) })),
    actualFor(month),
  );
  const lineId = Object.fromEntries(myLines.map((l) => [l.category_id, l.id]));
  const red = (reductions ?? []) as Row[];
  const projected = red.filter((r) => ["chosen", "in_progress", "completed"].includes(r.status)).reduce((s, r) => s + Number(r.projected_monthly_savings ?? 0), 0);
  const actual = red.filter((r) => r.status === "completed").reduce((s, r) => s + Number(r.actual_monthly_savings ?? 0), 0);
  const history = [...previousMonthKeys(ctx.today, 5), ctx.today.slice(0, 7)].map((m) => {
    const a = actualFor(m);
    const spent = Object.values(a).reduce((s, x) => s + x, 0);
    return { month: fmtDate(`${m}-01`, "MMM"), actual: Math.round(spent), budget: Math.round(v.totals.current), target: Math.round(v.totals.target) };
  });
  const months = [ctx.today.slice(0, 7), ...previousMonthKeys(ctx.today, 11).reverse()];
  return (
    <div>
      <PageHeader
        title="Budget"
        description="Current budget, target budget, actual vs. budget by month, and the reduction actions that close the difference."
        actions={
          budget ? (
            <Button asChild size="sm">
              <Link href={`/records/budget_lines/new?budget_id=${budget.id}`}>Add budget line</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/records/budgets/new">Create budget</Link>
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Actual vs. budget</CardTitle>
              <form method="get" className="flex gap-2">
                <NativeSelect name="month" defaultValue={month} aria-label="Month">
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {fmtDate(`${m}-01`, "MMMM yyyy")}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" variant="outline" size="sm">
                  Show
                </Button>
              </form>
            </div>
            <StatGrid className="md:grid-cols-4">
              <Stat label="Current budget" value={money(v.totals.current)} />
              <Stat label="Target budget" value={money(v.totals.target)} />
              <Stat label="Actual" value={money(v.totals.actual)} tone={v.totals.actual > v.totals.current && v.totals.current > 0 ? "bad" : undefined} />
              <Stat label="Difference to close (current minus target)" value={money(v.totals.gapToTarget)} />
            </StatGrid>
          </CardHeader>
          <CardContent>
            {v.rows.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Category</TH>
                    <TH className="text-right">Current</TH>
                    <TH className="text-right">Target</TH>
                    <TH className="text-right">Actual</TH>
                    <TH className="text-right">Over (+) or under (-)</TH>
                  </TR>
                </THead>
                <TBody>
                  {v.rows.map((r) => (
                    <TR key={r.category_id}>
                      <TD>
                        <Link href={`/records/budget_lines/${lineId[r.category_id]}`} className="font-medium hover:underline">
                          {catName[r.category_id] ?? "Category"}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{money(r.current)}</TD>
                      <TD className="tabular text-right">{money(r.target)}</TD>
                      <TD className="tabular text-right">
                        <Link href={`/finance/expenses?month=${month}&category=${r.category_id}`} className="hover:underline">
                          {money(r.actual)}
                        </Link>
                      </TD>
                      <TD className={`tabular text-right ${r.variance > 0 ? "text-status-missed" : "text-status-met"}`}>{money(r.variance)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState
                title="No budget lines yet."
                body="Add a line for each spending category with the current monthly amount and the target amount."
                action={budget ? <Button asChild size="sm"><Link href={`/records/budget_lines/new?budget_id=${budget.id}`}>Add budget line</Link></Button> : <Button asChild size="sm"><Link href="/records/budgets/new">Create budget</Link></Button>}
              />
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Reduction actions</CardTitle>
            </CardHeader>
            <CardContent>
<StatGrid>
              <Stat label="Projected monthly savings" value={money(projected)} />
              <Stat label="Actual monthly savings (completed)" value={money(actual)} tone="good" />
              <Stat label="Difference still to close" value={money(Math.max(0, v.totals.gapToTarget - projected))} />
              <Stat label="Open actions" value={red.filter((r) => r.status === "chosen" || r.status === "in_progress").length} />
            </StatGrid>
</CardContent>
            <CardNote>Projected and actual monthly savings from chosen actions.</CardNote>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Last 6 months</CardTitle>
            </CardHeader>
            <CardContent>
              <BarSeriesChart data={history} xKey="month" series={[{ key: "actual", label: "Actual", color: "#0f766e" }, { key: "budget", label: "Current budget", color: "#cbd5e1" }]} />
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="mt-4">
        <ListCard sb={supabase} table="reduction_actions" description="Open an expense or recurring charge and press Get 3 suggestions to add more." emptyTitle="No reduction actions yet." emptyBody="Open an expense or a recurring charge in Expenses and press Get 3 suggestions. Choose one, set a deadline, and track projected vs. actual savings." />
      </div>
    </div>
  );
}

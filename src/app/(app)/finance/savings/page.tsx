import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadFinanceSnapshot, netWorthByMonth } from "@/lib/finance";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { LineSeriesChart, Progress } from "@/components/app/charts";
import { ListCard } from "@/components/app/list-card";
import { date as fmtDate, money, pct, titleCase } from "@/lib/format";
import { CHART_BASELINE, CHART_STATUS, seriesColor } from "@/lib/status";

export const metadata = { title: "Savings and Financial Security" };

export default async function SavingsPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const snap = await loadFinanceSnapshot(supabase, ctx.today);
  const nw = await netWorthByMonth(supabase, ctx.today, 12);
  const ef = snap.emergencyFund;
  const ret = snap.retirement;
  const invest = snap.accounts.filter((a) => a.kind === "investment" || a.kind === "retirement");
  return (
    <div>
      <PageHeader title="Savings and Financial Security" description="Emergency fund, retirement target, required monthly savings, net worth by month, and retirement and investment balances. Targets are calculated from Inputs and Assumptions." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Emergency fund</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={ef.pct} />
            <StatGrid>
              <Stat label="Balance in emergency fund accounts" value={money(ef.balance)} />
              <Stat label="Target" value={money(ef.target)} />
              <Stat label="Progress" value={pct(ef.pct ?? 0, 0)} />
              <Stat label="Months of spending covered" value={ef.monthsCovered ?? "Not available"} />
            </StatGrid>
            {!snap.accounts.some((a) => a.is_emergency_fund) ? <p className="text-xs text-muted-foreground">Mark an account as the emergency fund on its page.</p> : null}
          </CardContent>
          <CardNote>Target = {snap.inputs.num.emergency_fund_months ?? 6} months x average monthly spending.</CardNote>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Retirement target</CardTitle>
            <CardDescription>
              Yearly spending in retirement ({money(snap.inputs.num.retirement_annual_spending)}) divided by the withdrawal rate ({pct(snap.inputs.num.withdrawal_rate_pct)}).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={ret.pct} />
            <StatGrid>
              <Stat label="Target" value={money(ret.target)} />
              <Stat label="Retirement and investment balances" value={money(ret.current)} />
              <Stat label="Progress" value={pct(ret.pct ?? 0, 1)} />
              <Stat label="Years until retirement age" value={ret.yearsLeft ?? "Set current age"} />
            </StatGrid>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Required monthly savings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="tabular text-3xl font-semibold">{ret.requiredMonthly === null ? "Not available" : money(ret.requiredMonthly)}</p>
            {ret.requiredMonthly === null ? (
              <Notice tone="warn">
                Set your current age in <Link href="/plan/inputs" className="underline">Inputs and Assumptions</Link>.
              </Notice>
            ) : (
              <p className="text-sm text-muted-foreground">Set this as a goal in Plan, Goals, with milestones, to track it.</p>
            )}
          </CardContent>
          <CardNote>Amount needed each month to reach the retirement target by the retirement age, at {pct(snap.inputs.num.expected_annual_return_pct)} yearly return.</CardNote>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Net worth by month</CardTitle>
          </CardHeader>
          <CardContent>
            <LineSeriesChart data={nw.map((r) => ({ month: fmtDate(`${r.month}-01`, "MMM yy"), netWorth: r.netWorth, assets: r.assets, liabilities: r.liabilities }))} xKey="month" series={[{ key: "netWorth", label: "Net worth", color: seriesColor(0) }, { key: "assets", label: "Assets", color: CHART_BASELINE }, { key: "liabilities", label: "Debts", color: CHART_STATUS.negative }]} />
          </CardContent>
          <CardNote>Assets minus debts, from recorded balances.</CardNote>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Retirement and investment accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {invest.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Account</TH>
                    <TH className="text-right">Balance</TH>
                  </TR>
                </THead>
                <TBody>
                  {invest.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={`/records/accounts/${a.id}`} className="font-medium hover:underline">
                          {a.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{titleCase(a.kind)}</span>
                      </TD>
                      <TD className="tabular text-right">{money(a.balance)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                No retirement or investment accounts. <Link href="/records/accounts/new?kind=retirement" className="underline">Add one</Link>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="mt-4">
        <ListCard sb={supabase} table="savings_targets" />
      </div>
    </div>
  );
}

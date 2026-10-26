import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadFinanceSnapshot } from "@/lib/finance";
import { debtPayoff } from "@/lib/calc/debt";
import { addMonthsISO } from "@/lib/calc/dates";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { LineSeriesChart } from "@/components/app/charts";
import { ListCard } from "@/components/app/list-card";
import { date as fmtDate, money, pct } from "@/lib/format";

export const metadata = { title: "Debt" };

export default async function DebtPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const snap = await loadFinanceSnapshot(supabase, ctx.today);
  const extra = snap.inputs.num.debt_extra_monthly_payment ?? 0;
  const chosen = snap.inputs.text.debt_payoff_method === "snowball" ? "snowball" : "avalanche";
  const av = debtPayoff(snap.debtInputs, "avalanche", extra);
  const sn = debtPayoff(snap.debtInputs, "snowball", extra);
  const plan = chosen === "avalanche" ? av : sn;
  const total = snap.debts.reduce((s, d) => s + d.effective_balance, 0);
  const minTotal = snap.debts.reduce((s, d) => s + Number(d.minimum_payment), 0);
  const len = Math.max(av.schedule.length, sn.schedule.length);
  const step = Math.max(1, Math.ceil(len / 60));
  const chart = Array.from({ length: Math.ceil(len / step) }, (_, i) => {
    const m = i * step;
    return { month: fmtDate(addMonthsISO(ctx.today, m + 1), "MMM yy"), avalanche: av.schedule[m]?.totalBalance ?? 0, snowball: sn.schedule[m]?.totalBalance ?? 0 };
  });
  const inputId = snap.inputs.rows.find((r) => r.key === "debt_extra_monthly_payment")?.id;
  return (
    <div>
      <PageHeader
        title="Debt"
        description="Balance, interest rate, minimum payment, and payoff schedule per card or loan. Payoff order: highest interest first (avalanche) or smallest balance first (snowball)."
        actions={
          <Button asChild size="sm">
            <Link href="/records/debts/new">Add debt</Link>
          </Button>
        }
      />
      {snap.debts.length ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Totals</CardTitle>
              </CardHeader>
              <CardContent>
<StatGrid>
                <Stat label="Total balance" value={money(total)} />
                <Stat label="Minimum payments per month" value={money(minTotal)} />
                <Stat label="Extra payment per month" value={money(extra)} hint={inputId ? undefined : ""} />
                <Stat label="Payoff order in use" value={chosen === "avalanche" ? "Highest interest first" : "Smallest balance first"} />
              </StatGrid>
                <Link href="/plan/inputs" className="mt-3 inline-block text-xs text-teal-800 hover:underline">
                  Change the extra payment or payoff order in Inputs and Assumptions
                </Link>
              </CardContent>
            </Card>
            {[av, sn].map((r) => (
              <Card key={r.method} className={r.method === chosen ? "border-teal-600" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {r.method === "avalanche" ? "Highest interest first" : "Smallest balance first"} {r.method === chosen ? <Badge>In use</Badge> : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
<StatGrid>
                  <Stat label="Debt-free date" value={r.feasible ? fmtDate(addMonthsISO(ctx.today, r.months), "MMM yyyy") : "Not paid off"} tone={r.feasible ? undefined : "bad"} />
                  <Stat label="Months" value={r.feasible ? r.months : "Payments do not cover interest"} />
                  <Stat label="Total interest" value={money(r.totalInterest)} />
                  <Stat label="Total paid" value={money(r.totalPaid)} />
                </StatGrid>
</CardContent>
                <CardNote>{r.method === "avalanche" ? "Pays the least interest overall." : "Closes individual debts sooner."}</CardNote>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Payoff schedule ({chosen === "avalanche" ? "highest interest first" : "smallest balance first"})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Order</TH>
                      <TH>Debt</TH>
                      <TH className="text-right">Balance</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Minimum</TH>
                      <TH>Paid off</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {plan.order.map((id, i) => {
                      const d = snap.debts.find((x) => x.id === id)!;
                      const m = plan.payoffMonthByDebt[id];
                      return (
                        <TR key={id}>
                          <TD>{i + 1}</TD>
                          <TD>
                            <Link href={`/records/debts/${id}`} className="font-medium hover:underline">
                              {d.name}
                            </Link>
                          </TD>
                          <TD className="tabular text-right">{money(d.effective_balance)}</TD>
                          <TD className="tabular text-right">{pct(d.apr, 2)}</TD>
                          <TD className="tabular text-right">{money(d.minimum_payment)}</TD>
                          <TD className="whitespace-nowrap">{m ? fmtDate(addMonthsISO(ctx.today, m), "MMM yyyy") : "Not paid off"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Total balance over time</CardTitle>
              </CardHeader>
              <CardContent>
                <LineSeriesChart data={chart} xKey="month" series={[{ key: "avalanche", label: "Highest interest first", color: "#0f766e" }, { key: "snowball", label: "Smallest balance first", color: "#d97706" }]} />
              </CardContent>
            </Card>
          </div>
          <ListCard sb={supabase} table="debts" title="All debts" />
          <ListCard sb={supabase} table="debt_payments" title="Payments" limit={50} emptyTitle="No payments recorded yet." emptyBody="Record each payment from the debt's page. The monthly review asks you to confirm debt payments." />
        </div>
      ) : (
        <EmptyState title="No debts yet." body="Add each card and loan with balance, interest rate, and minimum payment to see the payoff schedule." action={<Button asChild size="sm"><Link href="/records/debts/new">Add debt</Link></Button>} />
      )}
    </div>
  );
}

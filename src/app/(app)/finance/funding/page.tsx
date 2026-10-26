import Link from "next/link";
import { dueClass } from "@/components/ui/badge";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Funding" };

export default async function FundingPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: sources }, { data: sched }] = await Promise.all([supabase.from("funding_sources").select("*"), supabase.from("repayment_schedules").select("*").order("due_date")]);
  const list = (sources ?? []) as Row[];
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  const rows = (sched ?? []) as Row[];
  const unpaid = rows.filter((r) => Number(r.paid_amount) < Number(r.amount_due));
  const received = list.filter((s) => s.status === "received" || s.status === "repaid").reduce((s, f) => s + Number(f.amount), 0);
  const offered = list.filter((s) => s.status === "offered" || s.status === "accepted").reduce((s, f) => s + Number(f.amount), 0);
  return (
    <div>
      <PageHeader title="Funding" description="Loans, gifts, and investments received or offered. Each records the lender or giver (real name or pseudonym), amount, type, rate, term, repayment schedule, conditions, and signed document." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent>
<StatGrid>
            <Stat label="Received" value={money(received)} />
            <Stat label="Offered or accepted, not yet received" value={money(offered)} />
            <Stat label="Repayments still due" value={money(unpaid.reduce((s, r) => s + Number(r.amount_due) - Number(r.paid_amount), 0))} />
            <Stat label="Overdue repayments" value={unpaid.filter((r) => r.due_date < ctx.today).length} tone={unpaid.some((r) => r.due_date < ctx.today) ? "bad" : undefined} />
          </StatGrid>
</CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming repayments</CardTitle>
          </CardHeader>
          <CardContent>
            {unpaid.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Due</TH>
                    <TH>Funding source</TH>
                    <TH className="text-right">Amount due</TH>
                    <TH className="text-right">Paid</TH>
                  </TR>
                </THead>
                <TBody>
                  {unpaid.slice(0, 12).map((r) => (
                    <TR key={r.id}>
                      <TD className={dueClass(r.due_date, ctx.today)}>
                        <Link href={`/records/repayment_schedules/${r.id}`} className="hover:underline">
                          {fmtDate(r.due_date)}
                        </Link>
                      </TD>
                      <TD>{byId[r.funding_source_id]?.giver_name ?? ""}</TD>
                      <TD className="tabular text-right">{money(r.amount_due, true)}</TD>
                      <TD className="tabular text-right">{money(r.paid_amount, true)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No repayments due. Create a schedule from a loan&apos;s page.</p>
            )}
          </CardContent>
          <CardNote>Payments due, oldest first. Open one to record the amount paid.</CardNote>
        </Card>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <ListCard sb={supabase} table="funding_sources" title="Funding sources" rows={list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))} />
      </div>
    </div>
  );
}

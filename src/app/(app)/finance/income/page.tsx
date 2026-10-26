import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { previousMonthKeys } from "@/lib/calc/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { ListCard } from "@/components/app/list-card";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Income Received" };

export default async function IncomePage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const months = [...previousMonthKeys(ctx.today, 5), ctx.today.slice(0, 7)];
  const [{ data: sources }, { data: txns }] = await Promise.all([
    supabase.from("income_sources").select("*").order("name"),
    supabase.from("transactions").select("id,date,amount,description,merchant_name,income_source_id").gt("amount", 0).eq("is_transfer", false).gte("date", `${months[0]}-01`).order("date", { ascending: false }).limit(1000),
  ]);
  const srcs = (sources ?? []) as Row[];
  const list = (txns ?? []) as Row[];
  const sum = (sourceId: string | null, m: string) => list.filter((t) => (t.income_source_id ?? null) === sourceId && t.date.startsWith(m)).reduce((s, t) => s + Number(t.amount), 0);
  const unassigned = list.filter((t) => !t.income_source_id);
  return (
    <div>
      <PageHeader title="Income Received" description="Salary, consulting income, and other money received. Money received is read from transactions (money in, excluding transfers)." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Received by month</CardTitle>
            <CardDescription>Assign money received to an income source from the transaction&apos;s page.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Source</TH>
                  {months.map((m) => (
                    <TH key={m} className="text-right">
                      {fmtDate(`${m}-01`, "MMM yy")}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {[...srcs.map((s) => ({ id: s.id as string | null, name: s.name as string })), { id: null, name: "Not assigned to a source" }].map((s) => (
                  <TR key={s.id ?? "none"}>
                    <TD className="font-medium">{s.id ? <Link href={`/records/income_sources/${s.id}`} className="hover:underline">{s.name}</Link> : s.name}</TD>
                    {months.map((m) => (
                      <TD key={m} className="tabular text-right">
                        {money(sum(s.id, m))}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ListCard sb={supabase} table="income_sources" rows={srcs} />
          <Card>
            <CardHeader>
              <CardTitle>Money received not assigned to a source</CardTitle>
            </CardHeader>
            <CardContent>
              {unassigned.length ? (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {unassigned.slice(0, 20).map((t) => (
                    <li key={t.id} className="grid grid-cols-[5rem_1fr_auto] gap-2 py-1.5 text-sm">
                      <span className="text-xs text-muted-foreground">{fmtDate(t.date, "MMM d")}</span>
                      <Link href={`/records/transactions/${t.id}?edit=1`} className="clamp-1 hover:underline">
                        {t.merchant_name || t.description}
                      </Link>
                      <span className="tabular text-emerald-700">{money(t.amount, true)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">All money received in the last 6 months is assigned.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

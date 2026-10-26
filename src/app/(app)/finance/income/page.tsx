import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO, monthBounds, previousMonthKeys } from "@/lib/calc/dates";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/app/page-header";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { loadConsulting, loadConsultingIncome } from "@/lib/consulting";
import { paymentSummary } from "@/lib/calc/consulting";
import { DB_UPDATE_FILE_0011 } from "@/lib/schema-guard";
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
    supabase.from("transactions").select("*").gt("amount", 0).eq("is_transfer", false).gte("date", `${months[0]}-01`).order("date", { ascending: false }).limit(1000),
  ]);
  const srcs = (sources ?? []) as Row[];
  const list = (txns ?? []) as Row[];
  // Rows: each income source; money linked only to a consulting engagement; money not assigned to either.
  const ENGAGEMENT = "__engagement";
  const rowOf = (t: Row) => t.income_source_id ?? (t.pipeline_item_id ? ENGAGEMENT : null);
  const sum = (sourceId: string | null, m: string) => list.filter((t) => rowOf(t) === sourceId && t.date.startsWith(m)).reduce((s, t) => s + Number(t.amount), 0);
  const unassigned = list.filter((t) => !t.income_source_id && !t.pipeline_item_id);
  // Consulting (database update 0011): income this month and last month, signed work, pipeline value, engagements.
  const consulting = await loadConsulting(supabase, { ownerId, today: ctx.today });
  const thisMonth = monthBounds(ctx.today);
  const lastMonth = monthBounds(addDaysISO(thisMonth.start, -1));
  const itemIds = consulting.items.map((c) => c.item.id);
  const [cThis, cLast, cSix] = await Promise.all([
    loadConsultingIncome(supabase, { ownerId, from: thisMonth.start, to: thisMonth.end, itemIds }),
    loadConsultingIncome(supabase, { ownerId, from: lastMonth.start, to: lastMonth.end, itemIds }),
    loadConsultingIncome(supabase, { ownerId, from: `${months[0]}-01`, to: thisMonth.end, itemIds }),
  ]);
  const { data: orgRows } = await supabase.from("organizations").select("id,name");
  const orgName = Object.fromEntries(((orgRows ?? []) as Row[]).map((o) => [o.id, o.name]));
  const engagements = consulting.items
    .filter((c) => c.item.status !== "lost")
    .map((c) => ({ ...c, paid: paymentSummary(cSix.transactions.filter((t) => t.pipeline_item_id === c.item.id).map((t) => ({ date: t.date, amount: t.amount }))) }))
    .sort((a, b) => Number(b.signedStage) - Number(a.signedStage) || b.paid.total - a.paid.total || String(a.item.name).localeCompare(String(b.item.name)));
  return (
    <div>
      <PageHeader title="Income Received" description="Salary, consulting income, and other money received. Money received is read from transactions (money in, excluding transfers)." />
      <div className="flex flex-col gap-4">
        {!consulting.available ? (
          <DbUpdateNotice compact file={DB_UPDATE_FILE_0011} features="Consulting income and engagements appear after the update." />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Consulting income</CardTitle>
              </CardHeader>
              <CardContent>
                <StatGrid className="grid-cols-2">
                  <Stat label="Received this month" value={money(cThis.total)} tone={cThis.total ? "good" : undefined} />
                  <Stat label="Received last month" value={money(cLast.total)} />
                  <Stat label="Signed work per month (expected)" value={money(consulting.signedMonthly)} hint={`${consulting.activeEngagements} signed or active`} />
                  <Stat label="Pipeline value per month" value={money(consulting.pipelineValue)} hint="Expected x probability" />
                </StatGrid>
              </CardContent>
              <CardNote>Consulting income = money in linked to a consulting engagement, or assigned to a consulting income source.</CardNote>
            </Card>
            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 pb-2">
                <CardTitle>Consulting engagements</CardTitle>
                {consulting.pipelines[0] ? (
                  <Link href={`/opportunities/${consulting.pipelines[0].id}`} className="text-sm text-teal-800 hover:underline">
                    Open the Consulting pipeline
                  </Link>
                ) : null}
              </CardHeader>
              <CardContent>
                {engagements.length ? (
                  <Table className="table-fixed">
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Engagement</TH>
                        <TH className="w-[22%]">Stage</TH>
                        <TH className="w-[6.5rem] text-right">Per month</TH>
                        <TH className="w-[6.5rem] text-right">Received</TH>
                        <TH className="w-[5.5rem]">Last paid</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {engagements.slice(0, 12).map((c) => (
                        <TR key={c.item.id}>
                          <TD>
                            <Link href={`/records/pipeline_items/${c.item.id}`} className="clamp-2 font-medium hover:underline">
                              {c.item.name}
                            </Link>
                            {c.item.organization_id ? <span className="clamp-1 text-xs text-muted-foreground">{orgName[c.item.organization_id]}</span> : null}
                          </TD>
                          <TD>
                            <span className="clamp-2">{c.stage?.name ?? "None"}</span>
                          </TD>
                          <TD className="tabular text-right">{c.expectedMonthly === null ? <span className="text-muted-foreground">Not set</span> : money(c.expectedMonthly)}</TD>
                          <TD className="tabular text-right">{money(c.paid.total)}</TD>
                          <TD className="tabular whitespace-nowrap">{c.paid.lastDate ? fmtDate(c.paid.lastDate, "MMM d") : "None"}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground">No consulting items yet. Add one in the Consulting pipeline.</p>
                )}
              </CardContent>
              <CardNote>Per month = expected monthly income (calculated). Received = the last 6 months. Link a payment to an engagement on the transaction&apos;s page.</CardNote>
            </Card>
          </div>
        )}
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
                {[
                  ...srcs.map((s) => ({ id: s.id as string | null, name: s.name as string })),
                  ...(list.some((t) => rowOf(t) === ENGAGEMENT) ? [{ id: ENGAGEMENT as string | null, name: "Consulting engagements (no income source)" }] : []),
                  { id: null, name: "Not assigned to a source or engagement" },
                ].map((s) => (
                  <TR key={s.id ?? "none"}>
                    <TD className="font-medium">{s.id && s.id !== ENGAGEMENT ? <Link href={`/records/income_sources/${s.id}`} className="hover:underline">{s.name}</Link> : s.name}</TD>
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
              <CardTitle>Money received not assigned to a source or engagement</CardTitle>
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
                      <span className="tabular text-status-met">{money(t.amount, true)}</span>
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

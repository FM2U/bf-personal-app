import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadBalanceSheet } from "@/lib/balance-sheet";
import { netWorthChange, trendReady, type SheetGroup } from "@/lib/calc/balance-sheet";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { LineSeriesChart } from "@/components/app/charts";
import { CHART_SERIES } from "@/lib/status";
import { date as fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Balance Sheet" };

const SCOPE_LABEL = { personal: "Personal", business: "Cyan Arc LLC", all: "Personal and Cyan Arc LLC" } as const;

function GroupTable({ groups, empty, testId }: { groups: SheetGroup[]; empty: React.ReactNode; testId: string }) {
  if (!groups.length) return <>{empty}</>;
  return (
    <Table className="table-fixed" data-testid={testId}>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Account or debt</TH>
          <TH className="hidden w-[6.5rem] sm:table-cell">As of</TH>
          <TH className="w-[8.5rem] text-right">Amount</TH>
        </TR>
      </THead>
      <TBody>
        {groups.map((g) => (
          <GroupRows key={g.key} g={g} />
        ))}
      </TBody>
    </Table>
  );
}

function GroupRows({ g }: { g: SheetGroup }) {
  return (
    <>
      <TR className="bg-slate-50 hover:bg-slate-50" data-testid={`sheet-group-${g.key}`}>
        <TD className="font-semibold text-slate-900">{g.label}</TD>
        <TD className="hidden sm:table-cell" />
        <TD className="tabular text-right font-semibold text-slate-900">{money(g.total, true)}</TD>
      </TR>
      {g.rows.map((r) => (
        <TR key={`${r.table}:${r.id}`}>
          <TD>
            <Link href={`/records/${r.table}/${r.id}`} className="clamp-1 pl-3 hover:underline">
              {r.name}
            </Link>
            <span className="block pl-3 text-xs text-muted-foreground sm:hidden">{r.as_of ? `As of ${fmtDate(r.as_of, "MMM d, yyyy")}` : "No balance"}</span>
          </TD>
          <TD className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{r.as_of ? fmtDate(r.as_of, "MMM d, yyyy") : "No balance"}</TD>
          <TD className="tabular text-right">{money(r.amount, true)}</TD>
        </TR>
      ))}
    </>
  );
}

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const data = await loadBalanceSheet(supabase, { today: ctx.today, scope: sp.scope });
  const { sheet, series, scope } = data;
  const change = netWorthChange(series);
  const ready = trendReady(series);
  const chartData = series.map((p) => ({ label: fmtDate(`${p.month}-01`, "MMM yy"), netWorth: p.netWorth }));
  const scopes = (["personal", "business", "all"] as const).filter((s) => s === "personal" || data.hasBusiness);
  return (
    <div>
      <PageHeader
        title="Balance Sheet"
        description="What you own, what you owe, and your net worth, from the latest balance of each account and the balance on each debt."
        actions={
          <div className="flex rounded-md border border-border bg-white p-0.5" role="group" aria-label="Which accounts" data-testid="sheet-scope">
            {scopes.map((s) => (
              <Button key={s} asChild size="sm" variant={scope === s ? "default" : "ghost"} className="h-7">
                <Link href={`/finance/balance-sheet?scope=${s}`} aria-current={scope === s ? "page" : undefined}>
                  {s === "all" ? "Both" : SCOPE_LABEL[s]}
                </Link>
              </Button>
            ))}
          </div>
        }
      />
      <Card className="mb-4">
        <CardContent className="pt-5">
          <StatGrid className="md:grid-cols-4">
            <Stat label="Net worth" value={<span data-testid="sheet-net-worth">{money(sheet.netWorth, true)}</span>} hint={SCOPE_LABEL[scope]} tone={sheet.netWorth < 0 ? "bad" : undefined} />
            <Stat label="Assets" value={money(sheet.totalAssets, true)} hint={`${sheet.assets.reduce((n, g) => n + g.rows.length, 0)} accounts`} />
            <Stat label="Liabilities" value={money(sheet.totalLiabilities, true)} hint={`${sheet.liabilities.reduce((n, g) => n + g.rows.length, 0)} owed`} />
            <Stat
              label={change ? `Change since ${fmtDate(`${change.from}-01`, "MMM yyyy")}` : "Change over time"}
              value={change ? `${change.amount >= 0 ? "+" : "-"}${money(Math.abs(change.amount), true)}` : "Not yet"}
              tone={change ? (change.amount >= 0 ? "good" : "bad") : undefined}
              hint={change ? "Month-end balances" : "Needs two months"}
            />
          </StatGrid>
        </CardContent>
        <CardNote>
          {scope === "personal"
            ? `Personal accounts only, the same accounts runway counts${data.includeBusinessInRunway ? " (runway also counts Cyan Arc LLC cash now)" : ""}. Press ${data.hasBusiness ? `${data.businessName} or Both` : "Both"} to include business accounts.`
            : scope === "business"
              ? `${data.businessName} accounts and debts only. Runway counts ${data.includeBusinessInRunway ? "both Personal and business cash" : "Personal accounts only"}.`
              : `Personal and ${data.businessName} together. Runway counts ${data.includeBusinessInRunway ? "both" : "Personal accounts only"}.`}
        </CardNote>
      </Card>
      <div className="mb-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>Grouped by account type. Total {money(sheet.totalAssets, true)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupTable
              groups={sheet.assets}
              testId="sheet-assets"
              empty={<EmptyState compact title="No asset accounts in this view." action={<Button asChild size="sm"><Link href="/records/accounts/new">Add account</Link></Button>} />}
            />
          </CardContent>
          {sheet.noBalance ? <CardNote>{sheet.noBalance === 1 ? "1 account has" : `${sheet.noBalance} accounts have`} no balance recorded and counts as $0. Open it and add a balance.</CardNote> : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Liabilities</CardTitle>
            <CardDescription>Cards and loans from their account balance; other debts from the balance on the debt. Total {money(sheet.totalLiabilities, true)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupTable
              groups={sheet.liabilities}
              testId="sheet-liabilities"
              empty={<EmptyState compact title="No debts in this view." action={<Button asChild size="sm" variant="outline"><Link href="/finance/debt">Open Debt</Link></Button>} />}
            />
          </CardContent>
          <CardNote>A debt linked to a card or loan account is counted once, through the account.</CardNote>
        </Card>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="sheet-trend">
          <CardHeader>
            <CardTitle>Net worth over time</CardTitle>
            <CardDescription>Net worth at the end of each month for the last 12 months, from balance history.</CardDescription>
          </CardHeader>
          <CardContent>
            {ready ? (
              <LineSeriesChart data={chartData} xKey="label" series={[{ key: "netWorth", label: "Net worth", color: CHART_SERIES[0] }]} height={220} />
            ) : (
              <p className={cn("rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground")} data-testid="sheet-trend-empty">
                The trend starts when balances are recorded in two different months. Plaid records each linked balance every morning; for other accounts, add a balance on the account page.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>How it is counted</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-slate-700">
              <li>Each account counts at its latest recorded balance. Inactive accounts are left out.</li>
              <li>Cards and loans count as the amount owed.</li>
              <li>Debts with no account count at the balance on the debt, in every month of the trend.</li>
              <li>Each month uses the latest balance on or before its last day.</li>
            </ul>
          </CardContent>
          <CardNote>
            <Link href="/finance" className="text-primary-strong hover:underline">
              Accounts and Cash
            </Link>{" "}
            lists every account with its balance date.
          </CardNote>
        </Card>
      </div>
    </div>
  );
}

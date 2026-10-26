import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadFinanceSnapshot } from "@/lib/finance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, PageHeader, Stat } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { recordTransfer } from "@/app/actions/finance";
import { date as fmtDate, money, titleCase } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Accounts and Cash" };

export default async function AccountsPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const snap = await loadFinanceSnapshot(supabase, ctx.today);
  const { data: transfers } = await supabase.from("transactions").select("*").eq("is_transfer", true).not("transfer_pair_id", "is", null).order("date", { ascending: false }).limit(200);
  const accById = Object.fromEntries(snap.accounts.map((a) => [a.id, a]));
  const pairs: Record<string, Row[]> = {};
  for (const t of (transfers ?? []) as Row[]) (pairs[t.transfer_pair_id] ??= []).push(t);
  const transferRows = Object.values(pairs)
    .filter((p) => p.length === 2)
    .map((p) => {
      const out = p.find((t) => Number(t.amount) < 0)!;
      const inn = p.find((t) => Number(t.amount) > 0)!;
      return { id: out?.id, date: out?.date, from: accById[out?.account_id], to: accById[inn?.account_id], amount: Math.abs(Number(out?.amount ?? 0)), description: out?.description };
    })
    .filter((t) => t.from && t.to);
  const crossEntity = transferRows.filter((t) => t.from.entity_id !== t.to.entity_id);
  return (
    <div>
      <PageHeader
        title="Accounts and Cash"
        description="Every bank account, card, loan, and investment account, each marked Personal or Cyan Arc LLC. Transfers between Personal and Cyan Arc LLC are tracked."
        actions={
          <Button asChild size="sm">
            <Link href="/records/accounts/new">Add account</Link>
          </Button>
        }
      />
      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-4 pt-5 md:grid-cols-4">
          <Stat label="Available cash (counted in runway)" value={money(snap.cash)} hint={snap.includeBusiness ? "Personal and Cyan Arc LLC" : "Personal accounts only"} />
          <Stat label="Net worth" value={money(snap.netWorth.netWorth)} />
          <Stat label="Assets" value={money(snap.netWorth.assets)} />
          <Stat label="Debts" value={money(snap.netWorth.liabilities)} />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {snap.entities.map((e) => {
          const list = snap.accounts.filter((a) => a.entity_id === e.id);
          return (
            <Card key={e.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>{e.name}</CardTitle>
                  <CardDescription>{e.kind === "business" ? "Business accounts" : "Personal accounts"}</CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/records/accounts/new?entity_id=${e.id}`}>Add account</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {list.length ? (
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Account</TH>
                        <TH>Kind</TH>
                        <TH className="text-right">Balance</TH>
                        <TH>As of</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {list.map((a) => (
                        <TR key={a.id} className={a.is_active ? "" : "opacity-50"}>
                          <TD>
                            <Link href={`/records/accounts/${a.id}`} className="font-medium hover:underline">
                              {a.name}
                            </Link>
                            <span className="block text-xs text-muted-foreground">
                              {a.institution ?? ""}
                              {a.last4 ? ` ...${a.last4}` : ""}
                              {a.plaid_account_id ? " . Plaid" : ""}
                            </span>
                          </TD>
                          <TD>
                            {titleCase(a.kind)}
                            {a.is_emergency_fund ? <Badge variant="neutral" className="ml-1">Emergency fund</Badge> : null}
                          </TD>
                          <TD className="tabular text-right">{a.balance_as_of ? money(a.balance, true) : "No balance"}</TD>
                          <TD className="text-xs">
                            {a.balance_as_of ? (
                              fmtDate(a.balance_as_of)
                            ) : (
                              <Link href={`/records/account_balances/new?account_id=${a.id}`} className="text-teal-800 underline">
                                Record balance
                              </Link>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <EmptyState title={`No ${e.name} accounts yet.`} body="Add checking, savings, cards, loans, and investment accounts." action={<Button asChild size="sm"><Link href={`/records/accounts/new?entity_id=${e.id}`}>Add account</Link></Button>} />
                )}
              </CardContent>
            </Card>
          );
        })}
        <Card>
          <CardHeader>
            <CardTitle>Transfers between Personal and Cyan Arc LLC</CardTitle>
            <CardDescription>Transfers are not counted as spending or income.</CardDescription>
          </CardHeader>
          <CardContent>
            {crossEntity.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Date</TH>
                    <TH>From</TH>
                    <TH>To</TH>
                    <TH className="text-right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {crossEntity.slice(0, 30).map((t) => (
                    <TR key={t.id}>
                      <TD className="whitespace-nowrap">{fmtDate(t.date)}</TD>
                      <TD>
                        {t.from.name} <span className="text-xs text-muted-foreground">({t.from.entity_name})</span>
                      </TD>
                      <TD>
                        {t.to.name} <span className="text-xs text-muted-foreground">({t.to.entity_name})</span>
                      </TD>
                      <TD className="tabular text-right">{money(t.amount, true)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No transfers between entities recorded yet. Use the form to record one.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Record a transfer</CardTitle>
            <CardDescription>Creates the money-out and money-in rows together.</CardDescription>
          </CardHeader>
          <CardContent>
            {snap.accounts.length >= 2 ? (
              <form action={recordTransfer} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  From account
                  <NativeSelect name="from_account" required>
                    {snap.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.entity_name})
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  To account
                  <NativeSelect name="to_account" required defaultValue={snap.accounts[1]?.id}>
                    {snap.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.entity_name})
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Amount
                  <Input name="amount" type="number" step="0.01" min="0.01" required />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Date
                  <Input name="date" type="date" defaultValue={ctx.today} required />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                  Description
                  <Input name="description" placeholder="Example: Owner contribution to Cyan Arc LLC" />
                </label>
                <SubmitButton className="self-start">Record transfer</SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Add at least two accounts to record a transfer.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

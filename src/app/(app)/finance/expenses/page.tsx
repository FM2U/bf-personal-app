import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { CategorySelect } from "@/components/app/category-select";
import { suggestCategories } from "@/app/actions/ai";
import { detectRecurringNow } from "@/app/actions/domain";
import { monthBounds } from "@/lib/calc/dates";
import { isAIConfigured } from "@/lib/env";
import { date as fmtDate, money, titleCase } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : ctx.today.slice(0, 7);
  const mb = monthBounds(`${month}-01`);
  let q = supabase.from("transactions").select("*").gte("date", mb.start).lte("date", mb.end).order("date", { ascending: false }).limit(1000);
  if (sp.category === "none") q = q.is("category_id", null).eq("is_transfer", false);
  else if (sp.category) q = q.eq("category_id", sp.category);
  if (sp.account) q = q.eq("account_id", sp.account);
  if (sp.kind === "out") q = q.lt("amount", 0);
  if (sp.kind === "in") q = q.gt("amount", 0);
  const [{ data: txns }, { data: cats }, { data: accounts }, { data: series }, { count: uncategorized }, { count: pendingCats }] = await Promise.all([
    q,
    supabase.from("categories").select("id,name,kind").order("name"),
    supabase.from("accounts").select("id,name").order("name"),
    supabase.from("recurring_series").select("*").neq("status", "cancelled").order("monthly_cost", { ascending: false }),
    supabase.from("transactions").select("id", { count: "exact", head: true }).is("category_id", null).eq("is_transfer", false),
    supabase.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending").eq("source", "category_suggestion"),
  ]);
  const rows = (txns ?? []) as Row[];
  const catList = (cats ?? []) as { id: string; name: string; kind: string }[];
  const catName = Object.fromEntries(catList.map((c) => [c.id, c.name]));
  const accName = Object.fromEntries(((accounts ?? []) as Row[]).map((a) => [a.id, a.name]));
  const out = rows.filter((t) => Number(t.amount) < 0 && !t.is_transfer).reduce((s, t) => s - Number(t.amount), 0);
  const inn = rows.filter((t) => Number(t.amount) > 0 && !t.is_transfer).reduce((s, t) => s + Number(t.amount), 0);
  const seriesList = (series ?? []) as Row[];
  const flagged = seriesList.filter((s) => s.review_flag && s.review_status === "unreviewed");
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(`${ctx.today.slice(0, 7)}-01T12:00:00`);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Every transaction, with category, merchant, and recurring status. Open an expense to get 3 reduction suggestions."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/finance/import">Import CSV</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/records/transactions/new">Add transaction</Link>
            </Button>
          </>
        }
      />
      {pendingCats ? (
        <div className="mb-4">
          <Notice>
            {pendingCats} AI category suggestions are waiting. <Link href="/proposals" className="font-medium underline">Review and approve them</Link>.
          </Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="gap-3">
            <form className="grid grid-cols-2 gap-2 md:grid-cols-5" method="get">
              <NativeSelect name="month" defaultValue={month} aria-label="Month">
                {months.map((m) => (
                  <option key={m} value={m}>
                    {fmtDate(`${m}-01`, "MMMM yyyy")}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect name="category" defaultValue={sp.category ?? ""} aria-label="Category">
                <option value="">All categories</option>
                <option value="none">Uncategorized</option>
                {catList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect name="account" defaultValue={sp.account ?? ""} aria-label="Account">
                <option value="">All accounts</option>
                {((accounts ?? []) as Row[]).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect name="kind" defaultValue={sp.kind ?? ""} aria-label="Money in or out">
                <option value="">Money in and out</option>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </NativeSelect>
              <Button type="submit" variant="outline">
                Show
              </Button>
            </form>
            <StatGrid className="grid-cols-3">
              <Stat label="Money out (excluding transfers)" value={money(out)} />
              <Stat label="Money in (excluding transfers)" value={money(inn)} />
              <Stat label="Uncategorized (all months)" value={uncategorized ?? 0} tone={uncategorized ? "warn" : undefined} />
            </StatGrid>
          </CardHeader>
          <CardContent>
            {rows.length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Category</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((t) => (
                    <TR key={t.id}>
                      <TD className="whitespace-nowrap text-xs">{fmtDate(t.date, "MMM d")}</TD>
                      <TD className="max-w-[18rem]">
                        <Link href={`/records/transactions/${t.id}`} className="clamp-1 font-medium hover:underline">
                          {t.merchant_name || t.description}
                        </Link>
                        <span className="clamp-1 text-xs text-muted-foreground">
                          {accName[t.account_id] ?? ""} . {t.source}
                          {t.recurring_series_id ? " . recurring" : ""}
                          {t.is_transfer ? " . transfer" : ""}
                          {t.pending ? " . pending" : ""}
                        </span>
                      </TD>
                      <TD className={`tabular whitespace-nowrap text-right ${Number(t.amount) > 0 ? "text-status-met" : ""}`}>{money(t.amount, true)}</TD>
                      <TD>{t.is_transfer ? <Badge variant="neutral">{catName[t.category_id] ?? "Transfer"}</Badge> : <CategorySelect transactionId={t.id} value={t.category_id} categories={catList} source={t.category_source} />}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState
                title="No transactions for these filters."
                body="Import a CSV file from your bank or card, or add a transaction by hand. Plaid adds transactions automatically once connected."
                action={<Button asChild size="sm"><Link href="/finance/import">Import CSV</Link></Button>}
              />
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Categorize</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <GuardedForm action={suggestCategories}>
                <input type="hidden" name="back" value="/finance/expenses" />
                <SubmitButton size="sm" className="w-full" disabled={!isAIConfigured() || !uncategorized} pendingText="Asking the AI...">
                  Suggest categories ({uncategorized ?? 0} uncategorized)
                </SubmitButton>
              </GuardedForm>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings/categories">Categories and rules</Link>
              </Button>
              {sp.notice ? <p className="text-xs text-teal-800">{sp.notice}</p> : null}
            </CardContent>
            <CardNote>Rules run on every import. The AI can suggest categories for the rest; you approve each one.</CardNote>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Recurring charges</CardTitle>
              </div>
              <GuardedForm action={detectRecurringNow}>
                <SubmitButton size="sm" variant="outline" pendingText="Checking...">
                  Check now
                </SubmitButton>
              </GuardedForm>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {flagged.length ? <Notice tone="warn">{flagged.length} software subscriptions are marked for review. Confirm each one is still used.</Notice> : null}
              {seriesList.length ? (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {seriesList.slice(0, 25).map((s) => (
                    <li key={s.id} className="grid grid-cols-[1fr_auto] gap-2 py-2">
                      <Link href={`/records/recurring_series/${s.id}`} className="min-w-0 hover:underline">
                        <span className="clamp-1 text-sm font-medium">{s.merchant_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {titleCase(s.frequency)} . next {fmtDate(s.next_expected_date, "MMM d")}
                          {s.status === "ended" ? " . ended" : ""}
                        </span>
                      </Link>
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="tabular text-sm">{money(s.monthly_cost)}/mo</span>
                        {s.review_flag && s.review_status === "unreviewed" ? <Badge variant="warning">Review</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No recurring charges found yet. They appear after at least 2 to 3 matching charges are imported.</p>
              )}
            </CardContent>
            <CardNote>Found automatically: repeating charges and their frequency.</CardNote>
          </Card>
        </div>
      </div>
    </div>
  );
}

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
import { SavingsIdeasSection } from "@/components/app/savings-ideas";
import { SuggestionLine } from "@/components/app/suggestion-line";
import { savingsIdeasSuggestion } from "@/lib/suggestions";
import { firstSuggestion } from "@/lib/suggestions-server";
import { loadSavingsIdeas } from "@/lib/engine/savings-ideas";
import { ListFilter } from "@/components/app/filter-panel";
import { applyFilters, isDefaultFilters, plainParams, readFilters, type FilterSpec } from "@/lib/list-filters";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : ctx.today.slice(0, 7);
  const mb = monthBounds(`${month}-01`);
  const q = supabase.from("transactions").select("*").gte("date", mb.start).lte("date", mb.end).order("date", { ascending: false }).limit(1000);
  const [{ data: txns }, { data: cats }, { data: accounts }, { data: series }, { count: uncategorized }, { count: pendingCats }] = await Promise.all([
    q,
    supabase.from("categories").select("id,name,kind").order("name"),
    supabase.from("accounts").select("id,name").order("name"),
    supabase.from("recurring_series").select("*").neq("status", "cancelled").order("monthly_cost", { ascending: false }),
    supabase.from("transactions").select("id", { count: "exact", head: true }).is("category_id", null).eq("is_transfer", false),
    supabase.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending").eq("source", "category_suggestion"),
  ]);
  const catList = (cats ?? []) as { id: string; name: string; kind: string }[];
  // Filter panel: Category, Account, Money in or out (in the address; the month stays a dropdown).
  const txFilters: FilterSpec[] = [
    {
      column: { key: "category", title: "Category", options: [{ value: "none", label: "Uncategorized" }, ...catList.map((c) => ({ value: c.id, label: c.name }))] },
      test: (t, p) => (t.category_id ? p.includes(String(t.category_id)) : p.includes("none") && !t.is_transfer),
    },
    { column: { key: "account", title: "Account", options: ((accounts ?? []) as Row[]).map((a) => ({ value: String(a.id), label: String(a.name) })) }, test: (t, p) => p.includes(String(t.account_id)) },
    {
      column: { key: "kind", title: "Money in or out", options: [{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }, { value: "transfer", label: "Transfers" }, { value: "recurring", label: "Recurring charges" }] },
      test: (t, p) => (p.includes("out") && Number(t.amount) < 0 && !t.is_transfer) || (p.includes("in") && Number(t.amount) > 0 && !t.is_transfer) || (p.includes("transfer") && !!t.is_transfer) || (p.includes("recurring") && !!t.recurring_series_id),
    },
  ];
  const txCols = txFilters.map((f) => f.column);
  const txState = readFilters(sp, txCols);
  const txFiltering = !isDefaultFilters(txState, txCols);
  const rows = applyFilters((txns ?? []) as Row[], txFilters, txState, ctx.today);
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
  const ideas = await loadSavingsIdeas(supabase);
  const suggestion = await firstSuggestion([savingsIdeasSuggestion(ideas.pending as { id: string; estimated_monthly_savings: number }[], (n) => money(n))]);
  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Every transaction, with category, merchant, and recurring status. Savings ideas from the AI are at the top; open an expense to get 3 reduction suggestions."
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
      {suggestion ? <SuggestionLine s={suggestion} context={{ label: "Expenses and savings ideas" }} className="mb-4" /> : null}
      {pendingCats ? (
        <div className="mb-4">
          <Notice>
            {pendingCats} AI category suggestions are waiting. <Link href="/proposals" className="font-medium underline">Review and approve them</Link>.
          </Notice>
        </div>
      ) : null}
      <SavingsIdeasSection sb={supabase} ownerId={ownerId} notice={sp.notice} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <form className="flex items-center gap-2" method="get">
                {Object.entries(plainParams(sp))
                  .filter(([k]) => ["category", "account", "kind"].includes(k))
                  .map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v} />
                  ))}
                <NativeSelect name="month" defaultValue={month} aria-label="Month" className="h-8 w-44">
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {fmtDate(`${m}-01`, "MMMM yyyy")}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" size="sm" variant="outline">
                  Show month
                </Button>
              </form>
              <ListFilter path="/finance/expenses" layout={[[txCols[0]], [txCols[1]], [txCols[2]]]} state={txState} keep={plainParams(sp)} testId="expenses-filter" />
            </div>
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
                title={txFiltering ? "No transactions match these filters." : "No transactions this month."}
                body={txFiltering ? "Remove a filter label above, or press Reset." : "Import a CSV file from your bank or card, or add a transaction by hand. Plaid adds transactions automatically once connected."}
                action={txFiltering ? undefined : <Button asChild size="sm"><Link href="/finance/import">Import CSV</Link></Button>}
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

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthBounds, previousMonthKeys } from "@/lib/calc/dates";
import { buildBalanceSheet, defaultScope, inScope, netWorthSeries, type BalanceScope, type BalanceSheet, type NetWorthPoint, type SheetAccount, type SheetDebt } from "@/lib/calc/balance-sheet";
import { fetchAll } from "@/lib/data";
import type { Row } from "@/lib/types";

export type BalanceSheetData = {
  scope: BalanceScope;
  sheet: BalanceSheet;
  series: NetWorthPoint[];
  /** Runway counts business (Cyan Arc LLC) cash too (Inputs: runway_include_business_cash). */
  includeBusinessInRunway: boolean;
  businessName: string;
  hasBusiness: boolean;
};

/**
 * Loads the balance sheet: accounts with their latest balances, active debts, and 12 months of balance history
 * (account_balances, written by Plaid each morning, CSV imports, and balances added by hand). No database update.
 */
export async function loadBalanceSheet(sb: SupabaseClient, opts: { today: string; scope?: string | null; months?: number }): Promise<BalanceSheetData> {
  const months = Math.max(2, opts.months ?? 12);
  const [entRes, accRes, balRes, debtRes, inputRes] = await Promise.all([
    sb.from("entities").select("id,name,kind"),
    sb.from("accounts").select("id,name,kind,entity_id,is_active"),
    sb.from("account_current_balances").select("account_id,balance,as_of"),
    sb.from("debts").select("id,name,kind,account_id,entity_id,current_balance,balance_as_of").eq("is_active", true),
    sb.from("inputs").select("value_number").eq("key", "runway_include_business_cash").maybeSingle(),
  ]);
  const entities = (entRes.data ?? []) as Row[];
  const business = new Set(entities.filter((e) => e.kind === "business").map((e) => e.id));
  const current = new Map(((balRes.data ?? []) as Row[]).map((b) => [b.account_id, b]));
  const accounts: SheetAccount[] = ((accRes.data ?? []) as Row[]).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    balance: Number(current.get(a.id)?.balance ?? 0),
    as_of: (current.get(a.id)?.as_of as string | undefined) ?? null,
    business: business.has(a.entity_id),
    is_active: a.is_active !== false,
  }));
  const accountBusiness = new Map(accounts.map((a) => [a.id, a.business]));
  const debts: SheetDebt[] = ((debtRes.data ?? []) as Row[]).map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    account_id: d.account_id ?? null,
    balance: Number(d.current_balance ?? 0),
    as_of: d.balance_as_of ?? null,
    // A debt with no entity of its own belongs where its account belongs, otherwise to Personal.
    business: d.entity_id ? business.has(d.entity_id) : d.account_id ? !!accountBusiness.get(d.account_id) : false,
  }));
  const includeBusinessInRunway = Number((inputRes.data as Row | null)?.value_number ?? 0) >= 1;
  const scope = defaultScope(opts.scope, includeBusinessInRunway);
  const sheet = buildBalanceSheet(accounts, debts, scope);

  const shownAccounts = accounts.filter((a) => a.is_active !== false && inScope(a.business, scope));
  const ids = shownAccounts.map((a) => a.id);
  const keys = [...previousMonthKeys(opts.today, months - 1), opts.today.slice(0, 7)];
  const since = `${keys[0]}-01`;
  // History before the first month shown still sets that month's starting balances.
  const balances = ids.length
    ? ((await fetchAll((a, b) => sb.from("account_balances").select("account_id,as_of,balance").in("account_id", ids).order("as_of").range(a, b))) as Row[])
    : [];
  const unlinkedDebt = sheet.liabilities.flatMap((g) => g.rows).filter((r) => r.table === "debts").reduce((s, r) => s + r.amount, 0);
  const series = netWorthSeries({
    months: keys.map((k) => ({ key: k, end: monthBounds(`${k}-01`).end })),
    balances: balances.map((b) => ({ account_id: b.account_id, as_of: String(b.as_of), balance: Number(b.balance) })),
    accounts: shownAccounts.map((a) => ({ id: a.id, kind: a.kind })),
    unlinkedDebt,
  }).filter((p) => p.month >= since.slice(0, 7));
  const biz = entities.find((e) => e.kind === "business");
  return { scope, sheet, series, includeBusinessInRunway, businessName: String(biz?.name ?? "Cyan Arc LLC"), hasBusiness: !!biz };
}

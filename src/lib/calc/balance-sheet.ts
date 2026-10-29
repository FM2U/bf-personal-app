import { round2 } from "./runway";

/**
 * Personal balance sheet (Finance, Balance Sheet): assets grouped by account type, liabilities (debts), net worth,
 * and net worth at the end of each month from balance history (account_balances). Pure: the page loads the records.
 *
 * Rules (the same as the net worth on Accounts and Cash, src/lib/calc/savings.ts):
 * - Only active accounts count. A liability account (credit card, loan) counts as the amount owed (its balance as a
 *   positive number).
 * - A debt linked to an account is counted through that account, never twice. A debt with no account (or whose
 *   account is not in the chosen scope) counts from its recorded balance.
 * - Scope: Personal, Cyan Arc LLC (a business entity), or both. The default follows the runway setting
 *   (Inputs: runway_include_business_cash): Personal only unless business cash counts in runway.
 */

export type BalanceScope = "personal" | "business" | "all";

export type SheetAccount = { id: string; name: string; kind: string; balance: number; as_of: string | null; business: boolean; is_active?: boolean };
export type SheetDebt = { id: string; name: string; kind: string; account_id: string | null; balance: number; as_of: string | null; business: boolean };

export type SheetRow = { id: string; table: "accounts" | "debts"; name: string; amount: number; as_of: string | null; kind: string; business: boolean };
export type SheetGroup = { key: string; label: string; total: number; rows: SheetRow[] };

export type BalanceSheet = {
  scope: BalanceScope;
  assets: SheetGroup[];
  liabilities: SheetGroup[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  /** Active accounts in scope with no recorded balance (shown as "No balance recorded"). */
  noBalance: number;
};

/** Asset groups in the order shown. Property and other assets use the account kind "other_asset". */
export const ASSET_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "cash", label: "Cash (checking, savings, cash)", kinds: ["checking", "savings", "cash"] },
  { key: "investments", label: "Investments", kinds: ["investment"] },
  { key: "retirement", label: "Retirement", kinds: ["retirement"] },
  { key: "other", label: "Property and other assets", kinds: ["other_asset"] },
];

export const LIABILITY_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "credit_cards", label: "Credit cards", kinds: ["credit_card"] },
  { key: "loans", label: "Loans", kinds: ["loan"] },
  { key: "other_debts", label: "Other debts", kinds: ["other"] },
];

const LIABILITY_ACCOUNT_KINDS = ["credit_card", "loan"];

export function inScope(business: boolean, scope: BalanceScope): boolean {
  return scope === "all" || (scope === "business" ? business : !business);
}

/** The scope shown first: Personal only, unless business cash counts in runway. A valid ?scope= wins. */
export function defaultScope(requested: string | null | undefined, includeBusinessInRunway: boolean): BalanceScope {
  if (requested === "personal" || requested === "business" || requested === "all") return requested;
  return includeBusinessInRunway ? "all" : "personal";
}

export function buildBalanceSheet(accounts: SheetAccount[], debts: SheetDebt[], scope: BalanceScope): BalanceSheet {
  const shown = accounts.filter((a) => a.is_active !== false && inScope(a.business, scope));
  const shownIds = new Set(shown.map((a) => a.id));
  const assetRows: SheetRow[] = [];
  const liabilityRows: SheetRow[] = [];
  for (const a of shown) {
    const row: SheetRow = { id: a.id, table: "accounts", name: a.name, amount: 0, as_of: a.as_of, kind: a.kind, business: a.business };
    if (LIABILITY_ACCOUNT_KINDS.includes(a.kind)) liabilityRows.push({ ...row, amount: round2(Math.abs(a.balance)) });
    else assetRows.push({ ...row, amount: round2(a.balance) });
  }
  for (const d of debts) {
    if (d.account_id && shownIds.has(d.account_id)) continue;
    // A debt linked to an account that is outside the scope belongs to that account's side: leave it out.
    if (d.account_id && accounts.some((a) => a.id === d.account_id && !inScope(a.business, scope))) continue;
    if (!inScope(d.business, scope)) continue;
    liabilityRows.push({ id: d.id, table: "debts", name: d.name, amount: round2(Math.abs(d.balance)), as_of: d.as_of, kind: d.kind === "credit_card" || d.kind === "loan" ? d.kind : "other", business: d.business });
  }
  const group = (defs: typeof ASSET_GROUPS, rows: SheetRow[], fallback: string): SheetGroup[] =>
    defs
      .map((g) => {
        const list = rows.filter((r) => (g.kinds.includes(r.kind) ? true : g.key === fallback && !defs.some((x) => x.kinds.includes(r.kind)))).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
        return { key: g.key, label: g.label, total: round2(list.reduce((s, r) => s + r.amount, 0)), rows: list };
      })
      .filter((g) => g.rows.length);
  const assets = group(ASSET_GROUPS, assetRows, "other");
  const liabilities = group(LIABILITY_GROUPS, liabilityRows, "other_debts");
  const totalAssets = round2(assets.reduce((s, g) => s + g.total, 0));
  const totalLiabilities = round2(liabilities.reduce((s, g) => s + g.total, 0));
  return { scope, assets, liabilities, totalAssets, totalLiabilities, netWorth: round2(totalAssets - totalLiabilities), noBalance: shown.filter((a) => !a.as_of).length };
}

export type NetWorthPoint = { month: string; assets: number; liabilities: number; netWorth: number };

/**
 * Net worth at the end of each month (YYYY-MM keys with their last day), from balance history: each account's latest
 * balance on or before the month end. Debts with no account have no history and count at their current balance in
 * every month. Months before the first recorded balance are left out, so the line starts where the history starts.
 */
export function netWorthSeries(p: {
  months: { key: string; end: string }[];
  balances: { account_id: string; as_of: string; balance: number }[];
  /** Accounts in scope (active), with their kind. */
  accounts: { id: string; kind: string }[];
  /** Debts in scope that are not counted through an account in scope. */
  unlinkedDebt: number;
}): NetWorthPoint[] {
  const kind = new Map(p.accounts.map((a) => [a.id, a.kind]));
  const sorted = p.balances.filter((b) => kind.has(b.account_id)).sort((a, b) => a.as_of.localeCompare(b.as_of));
  const first = sorted[0]?.as_of ?? null;
  const out: NetWorthPoint[] = [];
  for (const m of p.months) {
    if (!first || first > m.end) continue;
    const latest = new Map<string, number>();
    for (const b of sorted) if (b.as_of <= m.end) latest.set(b.account_id, Number(b.balance));
    let assets = 0;
    let liabilities = p.unlinkedDebt;
    for (const [id, bal] of latest) {
      if (LIABILITY_ACCOUNT_KINDS.includes(kind.get(id) ?? "")) liabilities += Math.abs(bal);
      else assets += bal;
    }
    out.push({ month: m.key, assets: round2(assets), liabilities: round2(liabilities), netWorth: round2(assets - liabilities) });
  }
  return out;
}

/** True when the trend has at least two months to compare (otherwise the page says when it starts). */
export function trendReady(points: NetWorthPoint[]): boolean {
  return points.length >= 2;
}

/** Change in net worth from the first month shown to the last, or null with fewer than two months. */
export function netWorthChange(points: NetWorthPoint[]): { amount: number; from: string } | null {
  if (points.length < 2) return null;
  return { amount: round2(points[points.length - 1].netWorth - points[0].netWorth), from: points[0].month };
}

/**
 * Home, "This month": spending by week against the budget, and the top categories this month. The same transactions
 * as the month's spending total (money out, not transfers, in the accounts counted in runway). Pure, tested in
 * src/lib/calc/month-spending.test.ts.
 */
import { round2 } from "./runway";

export type MonthWeek = { label: string; spent: number | null; budget: number | null; current: boolean };
export type MonthCategory = { id: string | null; name: string; spent: number; budget: number | null };

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function monthSpendingBreakdown(p: {
  transactions: { date: string; amount: number | string; is_transfer?: boolean | null; category_id?: string | null; account_id?: string | null }[];
  accountIds: string[];
  today: string;
  budgetTotal: number;
  categoryNames: Record<string, string>;
  categoryBudgets: Record<string, number>;
  top?: number;
}): { weeks: MonthWeek[]; categories: MonthCategory[] } {
  const y = Number(p.today.slice(0, 4));
  const m = Number(p.today.slice(5, 7));
  const prefix = p.today.slice(0, 7);
  const days = daysIn(y, m);
  const todayDay = Number(p.today.slice(8, 10));
  const accounts = new Set(p.accountIds);
  const out = p.transactions.filter((t) => t.date.startsWith(prefix) && !t.is_transfer && Number(t.amount) < 0 && (!t.account_id || accounts.has(t.account_id)));
  const weeks: MonthWeek[] = [];
  for (let start = 1; start <= days; start += 7) {
    const end = Math.min(days, start + 6);
    const spent = out.filter((t) => {
      const d = Number(t.date.slice(8, 10));
      return d >= start && d <= end;
    });
    const future = start > todayDay;
    weeks.push({
      label: `${start}-${end}`,
      spent: future ? null : round2(spent.reduce((s, t) => s - Number(t.amount), 0)),
      budget: p.budgetTotal > 0 ? round2((p.budgetTotal * (end - start + 1)) / days) : null,
      current: todayDay >= start && todayDay <= end,
    });
  }
  const byCat = new Map<string | null, number>();
  for (const t of out) byCat.set(t.category_id ?? null, (byCat.get(t.category_id ?? null) ?? 0) - Number(t.amount));
  const categories = [...byCat.entries()]
    .map(([id, spent]) => ({ id, name: id ? p.categoryNames[id] ?? "Other" : "Not categorized", spent: round2(spent), budget: id && p.categoryBudgets[id] !== undefined ? p.categoryBudgets[id] : null }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, p.top ?? 3);
  return { weeks, categories };
}

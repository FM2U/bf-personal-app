import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, monthBounds, previousMonthKeys } from "@/lib/calc/dates";
import { computeRunway, monthlyAverages, round2 } from "@/lib/calc/runway";
import { CASH_KINDS, emergencyFundProgress, netWorth, requiredMonthlySavings, retirementTarget, type AccountKind } from "@/lib/calc/savings";
import type { DebtInput } from "@/lib/calc/debt";
import type { Row } from "@/lib/types";
import { fetchAll } from "@/lib/data";
import { loadConsulting } from "@/lib/consulting";

export type Inputs = { num: Record<string, number | null>; text: Record<string, string | null>; rows: Row[] };

export async function loadInputs(sb: SupabaseClient): Promise<Inputs> {
  const { data } = await sb.from("inputs").select("*").order("sort_order");
  const rows = (data ?? []) as Row[];
  const num: Record<string, number | null> = {};
  const text: Record<string, string | null> = {};
  for (const r of rows) {
    num[r.key] = r.value_number === null || r.value_number === undefined ? null : Number(r.value_number);
    text[r.key] = r.value_text ?? null;
  }
  return { num, text, rows };
}

export type AccountWithBalance = Row & { balance: number; balance_as_of: string | null; entity_kind: string | null; entity_name: string | null };

export type FinanceSnapshot = {
  today: string;
  inputs: Inputs;
  entities: Row[];
  accounts: AccountWithBalance[];
  debts: (Row & { effective_balance: number })[];
  debtInputs: DebtInput[];
  cash: number;
  runway: ReturnType<typeof computeRunway>;
  averages: ReturnType<typeof monthlyAverages>;
  netWorth: ReturnType<typeof netWorth>;
  emergencyFund: ReturnType<typeof emergencyFundProgress>;
  retirement: { target: number | null; current: number; pct: number | null; requiredMonthly: number | null; yearsLeft: number | null };
  investmentBalance: number;
  otherAssets: number;
  monthSpending: number;
  lastMonthSpending: number;
  transactions: Row[];
  includeBusiness: boolean;
  /** Runway setting runway_include_signed_consulting is on (signed consulting income is added to income). */
  includeSignedConsulting: boolean;
};

/**
 * Loads accounts, latest balances, debts, and recent transactions, and calculates runway, net worth,
 * emergency fund, and retirement figures. Works with the owner's client or the service client (pass ownerId).
 */
export async function loadFinanceSnapshot(sb: SupabaseClient, today: string, ownerId?: string): Promise<FinanceSnapshot> {
  const scope = <Q,>(q: Q): Q => scoped(q, ownerId);
  const inputs = await loadInputsScoped(sb, ownerId);
  const lookback = Math.max(1, Math.round(inputs.num.runway_lookback_months ?? 3));
  const since = `${previousMonthKeys(today, Math.max(lookback, 12))[0]}-01`;

  const [entitiesRes, accountsRes, balancesRes, debtsRes, txRes] = await Promise.all([
    scope(sb.from("entities").select("*")),
    scope(sb.from("accounts").select("*")),
    scope(sb.from("account_current_balances").select("*")),
    scope(sb.from("debts").select("*").eq("is_active", true)),
    fetchAll((from, to) =>
      scope(sb.from("transactions").select("id,date,amount,is_transfer,account_id,category_id,description,merchant_name").gte("date", since))
        .order("date")
        .range(from, to),
    ),
  ]);
  const entities = (entitiesRes.data ?? []) as Row[];
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]));
  const balByAccount = Object.fromEntries(((balancesRes.data ?? []) as Row[]).map((b) => [b.account_id, b]));
  const accounts: AccountWithBalance[] = ((accountsRes.data ?? []) as Row[]).map((a) => ({
    ...a,
    balance: Number(balByAccount[a.id]?.balance ?? 0),
    balance_as_of: balByAccount[a.id]?.as_of ?? null,
    entity_kind: entityById[a.entity_id]?.kind ?? null,
    entity_name: entityById[a.entity_id]?.name ?? null,
  }));
  const includeBusiness = (inputs.num.runway_include_business_cash ?? 0) >= 1;
  const runwayAccounts = accounts.filter(
    (a) => a.is_active && a.include_in_runway && (includeBusiness || a.entity_kind !== "business"),
  );
  const runwayAccountIds = new Set(runwayAccounts.map((a) => a.id));
  const cash = round2(runwayAccounts.filter((a) => CASH_KINDS.includes(a.kind as AccountKind)).reduce((s, a) => s + a.balance, 0));

  const transactions = txRes;
  const runwayTxns = transactions
    .filter((t) => runwayAccountIds.has(t.account_id))
    .map((t) => ({ date: t.date, amount: Number(t.amount), is_transfer: t.is_transfer }));
  const averages = monthlyAverages(runwayTxns, today, lookback);
  // Input runway_include_signed_consulting (update 0011): add expected income from signed consulting work
  // that has not had its first payment yet.
  const includeSignedConsulting = (inputs.num.runway_include_signed_consulting ?? 0) >= 1;
  let signedConsultingMonthly = 0;
  if (includeSignedConsulting) {
    try {
      // Only engagements with no payment received yet; paid ones are already in average income.
      signedConsultingMonthly = (await loadConsulting(sb, { ownerId, today })).runwaySignedMonthly;
    } catch {
      signedConsultingMonthly = 0;
    }
  }
  const runway = computeRunway({
    cash,
    avgSpending: averages.avgSpending,
    avgIncome: averages.avgIncome,
    subtractIncome: (inputs.num.runway_subtract_income ?? 1) >= 1,
    signedConsultingMonthly,
  });

  const debtsRaw = (debtsRes.data ?? []) as Row[];
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const debts: (Row & { effective_balance: number })[] = debtsRaw.map((d): Row & { effective_balance: number } => ({
    ...d,
    effective_balance: d.account_id && accById[d.account_id]?.balance_as_of ? Math.abs(accById[d.account_id].balance) : Number(d.current_balance),
  }));
  const debtInputs: DebtInput[] = debts.map((d) => ({
    id: d.id,
    name: d.name,
    balance: d.effective_balance,
    apr: Number(d.apr),
    minPayment: Number(d.minimum_payment),
  }));

  const activeAccounts = accounts.filter((a) => a.is_active);
  const nw = netWorth(
    activeAccounts.map((a) => ({ id: a.id, kind: a.kind as AccountKind, balance: a.balance })),
    debts.map((d) => ({ account_id: d.account_id, balance: d.effective_balance })),
  );

  const efBalance = activeAccounts.filter((a) => a.is_emergency_fund).reduce((s, a) => s + a.balance, 0);
  const emergencyFund = emergencyFundProgress(efBalance, averages.avgSpending, inputs.num.emergency_fund_months ?? 6);

  const investmentBalance = round2(activeAccounts.filter((a) => a.kind === "investment" || a.kind === "retirement").reduce((s, a) => s + a.balance, 0));
  const otherAssets = round2(activeAccounts.filter((a) => a.kind === "other_asset").reduce((s, a) => s + a.balance, 0));
  const target = retirementTarget(inputs.num.retirement_annual_spending ?? 0, inputs.num.withdrawal_rate_pct ?? 0);
  const yearsLeft =
    inputs.num.current_age !== null && inputs.num.retirement_age !== null && inputs.num.current_age !== undefined && inputs.num.retirement_age !== undefined
      ? (inputs.num.retirement_age as number) - (inputs.num.current_age as number)
      : null;
  const requiredMonthly =
    target !== null && yearsLeft !== null && yearsLeft > 0
      ? requiredMonthlySavings({ target, currentBalance: investmentBalance, annualReturnPct: inputs.num.expected_annual_return_pct ?? 0, years: yearsLeft })
      : null;

  const mb = monthBounds(today);
  const lastMonth = monthBounds(addDaysISO(mb.start, -1));
  const spentBetween = (a: string, b: string) =>
    round2(runwayTxns.filter((t) => !t.is_transfer && t.amount < 0 && t.date >= a && t.date <= b).reduce((s, t) => s - t.amount, 0));

  return {
    today,
    inputs,
    entities,
    accounts,
    debts,
    debtInputs,
    cash,
    runway,
    averages,
    netWorth: nw,
    emergencyFund,
    retirement: {
      target,
      current: investmentBalance,
      pct: target ? Math.min(100, round2((investmentBalance / target) * 100)) : null,
      requiredMonthly,
      yearsLeft,
    },
    investmentBalance,
    otherAssets,
    monthSpending: spentBetween(mb.start, mb.end),
    lastMonthSpending: spentBetween(lastMonth.start, lastMonth.end),
    transactions,
    includeBusiness,
    includeSignedConsulting,
  };
}

/** Adds owner_id = ownerId to a query when a service client is used. */
export function scoped<Q>(q: Q, ownerId?: string): Q {
  return ownerId ? (q as unknown as { eq: (c: string, v: string) => Q }).eq("owner_id", ownerId) : q;
}

async function loadInputsScoped(sb: SupabaseClient, ownerId?: string): Promise<Inputs> {
  if (!ownerId) return loadInputs(sb);
  const { data } = await sb.from("inputs").select("*").eq("owner_id", ownerId).order("sort_order");
  const rows = (data ?? []) as Row[];
  const num: Record<string, number | null> = {};
  const text: Record<string, string | null> = {};
  for (const r of rows) {
    num[r.key] = r.value_number === null || r.value_number === undefined ? null : Number(r.value_number);
    text[r.key] = r.value_text ?? null;
  }
  return { num, text, rows };
}

/** Net worth at the end of each of the last N months, from balance history. */
export async function netWorthByMonth(sb: SupabaseClient, today: string, monthsBack = 12, ownerId?: string) {
  let q = sb.from("account_balances").select("account_id,as_of,balance,created_at").order("as_of");
  if (ownerId) q = q.eq("owner_id", ownerId);
  const [{ data: balances }, { data: accounts }, { data: debts }] = await Promise.all([
    q,
    ownerId ? sb.from("accounts").select("id,kind").eq("owner_id", ownerId) : sb.from("accounts").select("id,kind"),
    ownerId ? sb.from("debts").select("account_id,current_balance,is_active").eq("owner_id", ownerId) : sb.from("debts").select("account_id,current_balance,is_active"),
  ]);
  const kinds = Object.fromEntries(((accounts ?? []) as Row[]).map((a) => [a.id, a.kind]));
  const unlinkedDebt = ((debts ?? []) as Row[]).filter((d) => d.is_active && !d.account_id).reduce((s, d) => s + Number(d.current_balance), 0);
  const keys = [...previousMonthKeys(today, monthsBack - 1), today.slice(0, 7)];
  return keys.map((k) => {
    const end = monthBounds(`${k}-01`).end;
    const latest: Record<string, number> = {};
    for (const b of (balances ?? []) as Row[]) if (b.as_of <= end) latest[b.account_id] = Number(b.balance);
    let assets = 0;
    let liabilities = 0;
    for (const [id, bal] of Object.entries(latest)) {
      if (["credit_card", "loan"].includes(kinds[id])) liabilities += Math.abs(bal);
      else assets += bal;
    }
    return { month: k, assets: round2(assets), liabilities: round2(liabilities + unlinkedDebt), netWorth: round2(assets - liabilities - unlinkedDebt) };
  });
}

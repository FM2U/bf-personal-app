import { describe, expect, it } from "vitest";
import { buildBalanceSheet, defaultScope, netWorthChange, netWorthSeries, trendReady, type SheetAccount, type SheetDebt } from "./balance-sheet";
import { netWorth } from "./savings";

const accounts: SheetAccount[] = [
  { id: "chk", name: "Checking", kind: "checking", balance: 8000, as_of: "2026-10-28", business: false },
  { id: "sav", name: "Savings", kind: "savings", balance: 12000, as_of: "2026-10-28", business: false },
  { id: "brk", name: "Brokerage", kind: "investment", balance: 30000, as_of: "2026-10-01", business: false },
  { id: "ira", name: "IRA", kind: "retirement", balance: 50000, as_of: "2026-10-01", business: false },
  { id: "car", name: "Car", kind: "other_asset", balance: 9000, as_of: null, business: false },
  { id: "cc", name: "Visa", kind: "credit_card", balance: -2500, as_of: "2026-10-28", business: false },
  { id: "llc", name: "LLC checking", kind: "checking", balance: 4000, as_of: "2026-10-28", business: true },
  { id: "old", name: "Closed savings", kind: "savings", balance: 999, as_of: "2026-01-01", business: false, is_active: false },
];
const debts: SheetDebt[] = [
  { id: "d-cc", name: "Visa debt", kind: "credit_card", account_id: "cc", balance: 2500, as_of: "2026-10-28", business: false },
  { id: "d-loan", name: "Family loan", kind: "loan", account_id: null, balance: 6000, as_of: "2026-09-30", business: false },
  { id: "d-llc", name: "LLC line", kind: "other", account_id: null, balance: 1000, as_of: null, business: true },
];

describe("balance sheet: groups and totals", () => {
  const s = buildBalanceSheet(accounts, debts, "personal");
  it("groups assets by account type in a fixed order", () => {
    expect(s.assets.map((g) => [g.key, g.total])).toEqual([
      ["cash", 20000],
      ["investments", 30000],
      ["retirement", 50000],
      ["other", 9000],
    ]);
    expect(s.assets[0].rows.map((r) => r.name)).toEqual(["Savings", "Checking"]);
  });
  it("counts a linked debt through its account only, and an unlinked debt from its balance", () => {
    expect(s.liabilities.map((g) => [g.key, g.total, g.rows.map((r) => r.table)])).toEqual([
      ["credit_cards", 2500, ["accounts"]],
      ["loans", 6000, ["debts"]],
    ]);
    expect(s.totalLiabilities).toBe(8500);
  });
  it("matches the net worth rule used on Accounts and Cash", () => {
    const personal = accounts.filter((a) => !a.business && a.is_active !== false);
    const nw = netWorth(personal.map((a) => ({ id: a.id, kind: a.kind as never, balance: a.balance })), debts.filter((d) => !d.business).map((d) => ({ account_id: d.account_id, balance: d.balance })));
    expect(s.netWorth).toBe(nw.netWorth);
    expect(s.totalAssets).toBe(nw.assets);
  });
  it("leaves out inactive accounts and counts accounts with no balance", () => {
    expect(s.assets.flatMap((g) => g.rows).some((r) => r.id === "old")).toBe(false);
    expect(s.noBalance).toBe(1);
  });
});

describe("balance sheet: Personal and Cyan Arc LLC", () => {
  it("shows only the business entity's accounts and debts for Cyan Arc LLC", () => {
    const b = buildBalanceSheet(accounts, debts, "business");
    expect(b.totalAssets).toBe(4000);
    expect(b.liabilities.map((g) => g.key)).toEqual(["other_debts"]);
    expect(b.netWorth).toBe(3000);
  });
  it("adds both for All", () => {
    const all = buildBalanceSheet(accounts, debts, "all");
    expect(all.netWorth).toBe(buildBalanceSheet(accounts, debts, "personal").netWorth + 3000);
  });
  it("follows the runway setting unless the address names a scope", () => {
    expect(defaultScope(null, false)).toBe("personal");
    expect(defaultScope(undefined, true)).toBe("all");
    expect(defaultScope("business", false)).toBe("business");
    expect(defaultScope("nonsense", false)).toBe("personal");
  });
});

describe("balance sheet: net worth over time", () => {
  const months = [
    { key: "2026-07", end: "2026-07-31" },
    { key: "2026-08", end: "2026-08-31" },
    { key: "2026-09", end: "2026-09-30" },
    { key: "2026-10", end: "2026-10-31" },
  ];
  const kinds = [
    { id: "chk", kind: "checking" },
    { id: "cc", kind: "credit_card" },
  ];
  it("starts at the first recorded balance and carries the latest balance forward", () => {
    const pts = netWorthSeries({
      months,
      accounts: kinds,
      unlinkedDebt: 1000,
      balances: [
        { account_id: "chk", as_of: "2026-08-15", balance: 5000 },
        { account_id: "cc", as_of: "2026-08-20", balance: -500 },
        { account_id: "chk", as_of: "2026-10-05", balance: 7000 },
        { account_id: "other", as_of: "2026-06-01", balance: 99999 },
      ],
    });
    expect(pts).toEqual([
      { month: "2026-08", assets: 5000, liabilities: 1500, netWorth: 3500 },
      { month: "2026-09", assets: 5000, liabilities: 1500, netWorth: 3500 },
      { month: "2026-10", assets: 7000, liabilities: 1500, netWorth: 5500 },
    ]);
    expect(trendReady(pts)).toBe(true);
    expect(netWorthChange(pts)).toEqual({ amount: 2000, from: "2026-08" });
  });
  it("is empty without balance history, and not ready with one month", () => {
    expect(netWorthSeries({ months, accounts: kinds, unlinkedDebt: 0, balances: [] })).toEqual([]);
    const one = netWorthSeries({ months, accounts: kinds, unlinkedDebt: 0, balances: [{ account_id: "chk", as_of: "2026-10-28", balance: 10 }] });
    expect(one).toHaveLength(1);
    expect(trendReady(one)).toBe(false);
    expect(netWorthChange(one)).toBeNull();
  });
});

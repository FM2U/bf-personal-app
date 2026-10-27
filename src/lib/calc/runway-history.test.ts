import { describe, expect, it } from "vitest";
import { runwayAtMonthEnds } from "./runway";

describe("runway at each month end", () => {
  const txns = [
    // August to October: spending 4,000 a month, income 1,000 a month.
    ...["2026-08", "2026-09", "2026-10"].flatMap((m) => [
      { date: `${m}-05`, amount: -4000 },
      { date: `${m}-15`, amount: 1000 },
    ]),
    { date: "2026-09-20", amount: -500, is_transfer: true },
  ];
  const balances = [
    { account_id: "chk", as_of: "2026-08-31", balance: 30000 },
    { account_id: "chk", as_of: "2026-09-30", balance: 27000 },
    { account_id: "sav", as_of: "2026-09-15", balance: 9000 },
    { account_id: "card", as_of: "2026-09-30", balance: -2000 },
  ];
  it("uses cash at each month end and the burn over the months up to then", () => {
    const pts = runwayAtMonthEnds({ monthKeys: ["2026-07", "2026-08", "2026-09"], balances, cashAccountIds: ["chk", "sav"], txns, lookbackMonths: 3, subtractIncome: true });
    expect(pts[0]).toEqual({ month: "2026-07", months: null, cash: null, burn: null });
    // August: cash 30,000; burn 3,000 (one month of history counted).
    expect(pts[1]).toEqual({ month: "2026-08", months: 10, cash: 30000, burn: 3000 });
    // September: cash 27,000 + 9,000; burn 3,000 (the transfer is ignored; the card is not cash).
    expect(pts[2]).toEqual({ month: "2026-09", months: 12, cash: 36000, burn: 3000 });
  });
  it("no runway number when income covers spending; spending only when income is not subtracted", () => {
    const rich = [...txns, { date: "2026-09-25", amount: 9000 }];
    const pts = runwayAtMonthEnds({ monthKeys: ["2026-09"], balances, cashAccountIds: ["chk", "sav"], txns: rich, lookbackMonths: 2, subtractIncome: true });
    expect(pts[0].months).toBeNull();
    const spendOnly = runwayAtMonthEnds({ monthKeys: ["2026-09"], balances, cashAccountIds: ["chk", "sav"], txns: rich, lookbackMonths: 2, subtractIncome: false });
    expect(spendOnly[0].months).toBe(9);
  });
});

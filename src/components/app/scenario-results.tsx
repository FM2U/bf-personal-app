import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { date as fmtDate, money, months as fmtMonths, pct } from "@/lib/format";
import type { ScenarioResult } from "@/lib/calc/scenario";

/** Side-by-side results for the current numbers and one or more scenarios. */
export function ScenarioComparisonTable({ columns }: { columns: { name: string; result: ScenarioResult; horizon: number }[] }) {
  const rows: { label: string; get: (r: ScenarioResult, h: number) => string }[] = [
    { label: "Monthly spending", get: (r) => money(r.monthlySpending) },
    { label: "Monthly income", get: (r) => money(r.monthlyIncome) },
    { label: "Runway (formula)", get: (r) => fmtMonths(r.runwayFormulaMonths) },
    { label: "Cash falls below zero in", get: (r, h) => (r.cashRunsOutMonth ? `Month ${r.cashRunsOutMonth} (${fmtDate(r.rows[r.cashRunsOutMonth - 1]?.date, "MMM yyyy")})` : `Not within ${h} months`) },
    { label: "Cash at end of projection", get: (r) => money(r.rows[r.rows.length - 1]?.cash ?? 0) },
    { label: "Debt payoff date", get: (r) => (r.debtPayoffDate ? fmtDate(r.debtPayoffDate, "MMM yyyy") : r.debtFeasible ? "No debt" : "Not paid off (payments do not cover interest)") },
    { label: "Total interest paid", get: (r) => money(r.totalInterest) },
    { label: "Net worth now", get: (r) => money(r.netWorthStart) },
    { label: "Net worth at end of projection", get: (r) => money(r.netWorthEnd) },
    { label: "Emergency fund target", get: (r) => money(r.emergencyFund.target) },
    { label: "Emergency fund progress", get: (r) => pct(r.emergencyFund.pct ?? 0, 0) },
    { label: "Retirement target", get: (r) => money(r.retirementTarget) },
    { label: "Required monthly retirement savings", get: (r) => (r.requiredMonthlyRetirementSavings === null ? "Set current age in Inputs" : money(r.requiredMonthlyRetirementSavings)) },
  ];
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="w-56">Result</TH>
          {columns.map((c) => (
            <TH key={c.name} className="text-right">
              {c.name}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.label}>
            <TD className="text-muted-foreground">{row.label}</TD>
            {columns.map((c) => (
              <TD key={c.name} className="tabular text-right">
                {row.get(c.result, c.horizon)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function mergeSeries(columns: { key: string; result: ScenarioResult }[], field: "cash" | "netWorth") {
  const len = Math.max(...columns.map((c) => c.result.rows.length), 0);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) {
    const row: Record<string, unknown> = { month: fmtDate(columns[0].result.rows[i]?.date, "MMM yy") };
    for (const c of columns) row[c.key] = c.result.rows[i]?.[field] ?? null;
    out.push(row);
  }
  return out;
}

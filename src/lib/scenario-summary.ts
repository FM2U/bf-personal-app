/**
 * Scenario summary window ("View summary" on a scenario and on the scenarios comparison). Pure: builds every line and
 * chart from the projection results, so the window (src/components/app/windows/scenario-summary.tsx) only lays them
 * out. Tested in src/lib/scenario-summary.test.ts. Every line names where it drills down to: an input's quick view (a
 * window address) or the section of the full scenario page (a page link).
 */
import { BASELINE_OVERRIDE_KEYS, type BridgeRow, type JobVsAcqRow, type ScenarioResult } from "@/lib/calc/scenario";
import { date as fmtDate, money, months as fmtMonths, num, pct } from "@/lib/format";

export type SummaryColumn = {
  /** null for the current numbers. */
  id: string | null;
  name: string;
  result: ScenarioResult;
  horizon: number;
  overrides: Record<string, number>;
  jva: { rows: JobVsAcqRow[]; crossoverYear: number | null; missing: string[] };
  bridge: { rows: BridgeRow[]; crossoverYear: number | null; missing: string[] };
};

/** A line that drills down: `window` is a window address (opens in the same window), `href` a page link. */
export type DrillLine = { label: string; values: string[]; window?: string; href?: string };

export type ChangedLine = { label: string; from: string; to: string; window?: string; href?: string };

export type ScenarioSummaryData = {
  title: string;
  subtitle: string;
  /** Column names: "Current numbers", then each scenario. */
  columns: string[];
  changed: { scenario: string; lines: ChangedLine[] }[];
  results: DrillLine[];
  savings: DrillLine[];
  paths: DrillLine[];
  /** Cash at each month for the small chart: { month, c0, c1, ... } (c0 = current numbers). */
  cash: Record<string, string | number | null>[];
  /** Acquisition total minus job by year for the small chart: { year, c0, c1, ... }. */
  pathGap: Record<string, string | number | null>[];
  /** Where "Open full page" goes. */
  fullHref: string;
};

const valueText = (unitOf: (key: string) => string | undefined, key: string, v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "Not set";
  const unit = unitOf(key);
  if (unit === "usd" || ["starting_cash", "monthly_spending", "monthly_income", "monthly_investment_contribution", "one_time_amount"].includes(key) || /\.min_payment$/.test(key)) return money(v);
  if (unit === "percent" || /\.apr$/.test(key)) return pct(v, 2);
  if (unit === "months") return `${num(v)} months`;
  if (unit === "years") return `${num(v)} years`;
  return num(v, 2);
};

/** Cash at the end of month 12 (or the last month projected, when shorter). */
export function cashAt12(r: ScenarioResult): number | null {
  if (!r.rows.length) return null;
  return r.rows[Math.min(11, r.rows.length - 1)].cash;
}

export function buildScenarioSummary(p: {
  columns: SummaryColumn[];
  current: SummaryColumn;
  /** Inputs and Assumptions: key to id, label, unit, and current value. */
  inputs: Record<string, { id: string; label: string; unit?: string | null; value: number | null }>;
  /** Current values of the figures that are not inputs (starting cash, monthly spending, ...). */
  baseline: Record<string, number>;
  debts: { id: string; name: string; apr: number; minPayment: number }[];
}): ScenarioSummaryData {
  const all = [p.current, ...p.columns];
  const single = p.columns.length === 1 ? p.columns[0] : null;
  const pageFor = (c: SummaryColumn | null, hash: string) => (single?.id ? `/plan/scenarios/${single.id}#${hash}` : c?.id ? `/plan/scenarios/${c.id}#${hash}` : `/plan/scenarios/compare?ids=${p.columns.map((x) => x.id).filter(Boolean).join(",")}`);
  const resultsHref = single?.id ? `/plan/scenarios/${single.id}#results` : `/plan/scenarios/compare?ids=${p.columns.map((x) => x.id).filter(Boolean).join(",")}`;
  const unitOf = (k: string) => p.inputs[k]?.unit ?? undefined;
  const labelOf = (k: string) => {
    if (p.inputs[k]) return p.inputs[k].label;
    const base = BASELINE_OVERRIDE_KEYS.find((b) => b.key === k);
    if (base) return base.label;
    const m = k.match(/^debt\.([^.]+)\.(apr|min_payment|balance)$/);
    if (m) {
      const d = p.debts.find((x) => x.id === m[1]);
      return `${d?.name ?? "Debt"}: ${m[2] === "apr" ? "interest rate" : m[2] === "min_payment" ? "monthly payment" : "balance"}`;
    }
    return k.replace(/_/g, " ");
  };
  const currentOf = (k: string): number | null => {
    if (p.inputs[k]) return p.inputs[k].value;
    if (k in p.baseline) return p.baseline[k];
    const m = k.match(/^debt\.([^.]+)\.(apr|min_payment)$/);
    if (m) {
      const d = p.debts.find((x) => x.id === m[1]);
      return d ? (m[2] === "apr" ? d.apr : d.minPayment) : null;
    }
    return null;
  };

  const changed = p.columns.map((c) => ({
    scenario: c.name,
    lines: Object.entries(c.overrides)
      .sort(([a], [b]) => labelOf(a).localeCompare(labelOf(b)))
      .map(([k, v]) => ({
        label: labelOf(k),
        from: valueText(unitOf, k, currentOf(k)),
        to: valueText(unitOf, k, v),
        ...(p.inputs[k] ? { window: `r/inputs/${p.inputs[k].id}` } : { href: c.id ? `/plan/scenarios/${c.id}#overrides` : undefined }),
      })),
  }));

  const runsOut = (r: ScenarioResult, h: number) => (r.cashRunsOutMonth ? fmtDate(r.rows[r.cashRunsOutMonth - 1]?.date, "MMM yyyy") : `Not within ${h} months`);
  const payoff = (r: ScenarioResult) => (r.debtPayoffDate ? fmtDate(r.debtPayoffDate, "MMM yyyy") : r.debtFeasible ? "No debt" : "Not paid off");
  const results: DrillLine[] = [
    { label: "Runway", values: all.map((c) => fmtMonths(c.result.runwayFormulaMonths)), href: resultsHref },
    { label: "Cash at 12 months", values: all.map((c) => money(cashAt12(c.result))), href: pageFor(null, "cash") },
    { label: "Cash falls below zero", values: all.map((c) => runsOut(c.result, c.horizon)), href: pageFor(null, "cash") },
    { label: "Debt payoff date", values: all.map((c) => payoff(c.result)), href: "/finance/debt" },
    { label: "Net worth at the end", values: all.map((c) => money(c.result.netWorthEnd)), href: pageFor(null, "net-worth") },
    { label: "Monthly spending", values: all.map((c) => money(c.result.monthlySpending)), href: resultsHref },
    { label: "Monthly income", values: all.map((c) => money(c.result.monthlyIncome)), href: resultsHref },
  ];
  const savings: DrillLine[] = [
    { label: "Emergency fund target", values: all.map((c) => money(c.result.emergencyFund.target)), href: "/finance/savings" },
    { label: "Emergency fund progress", values: all.map((c) => pct(c.result.emergencyFund.pct ?? 0, 0)), href: "/finance/savings" },
    { label: "Required monthly retirement savings", values: all.map((c) => (c.result.requiredMonthlyRetirementSavings === null ? "Set current age" : money(c.result.requiredMonthlyRetirementSavings))), href: "/finance/savings" },
  ];
  const last = <T,>(rows: T[]) => rows[rows.length - 1];
  const ahead = (y: number | null, missing: string[]) => (missing.length ? "Numbers missing" : y ? `Year ${y}` : "Not within the years compared");
  const paths: DrillLine[] = [
    { label: "Job: take-home pay by the final year", values: all.map((c) => money(last(c.jva.rows)?.jobCumulative ?? 0)), href: pageFor(null, "job-vs-acquisition") },
    { label: "Acquisition: salary plus equity", values: all.map((c) => money(last(c.jva.rows)?.acquisitionTotal ?? 0)), href: pageFor(null, "job-vs-acquisition") },
    { label: "Acquisition ahead from", values: all.map((c) => ahead(c.jva.crossoverYear, c.jva.missing)), href: pageFor(null, "job-vs-acquisition") },
    { label: "Bridge: search with consulting", values: all.map((c) => money(last(c.bridge.rows)?.bridgeTotal ?? 0)), href: pageFor(null, "bridge") },
    { label: "Bridge ahead from", values: all.map((c) => ahead(c.bridge.crossoverYear, c.bridge.missing)), href: pageFor(null, "bridge") },
  ];

  const len = Math.max(...all.map((c) => c.result.rows.length), 0);
  const cash: ScenarioSummaryData["cash"] = [];
  for (let i = 0; i < len; i++) {
    const row: Record<string, string | number | null> = { month: fmtDate(all.find((c) => c.result.rows[i])?.result.rows[i]?.date, "MMM yy") };
    all.forEach((c, j) => (row[`c${j}`] = c.result.rows[i]?.cash ?? null));
    cash.push(row);
  }
  const years = Math.max(...all.map((c) => c.jva.rows.length), 0);
  const pathGap: ScenarioSummaryData["pathGap"] = [];
  for (let y = 0; y < years; y++) {
    const row: Record<string, string | number | null> = { year: `Year ${y}` };
    all.forEach((c, j) => (row[`c${j}`] = c.jva.rows[y]?.difference ?? null));
    pathGap.push(row);
  }

  const horizon = Math.max(...all.map((c) => c.horizon));
  return {
    title: single ? `Summary: ${single.name}` : `Summary: ${p.columns.length} scenarios`,
    subtitle: `Current numbers and ${single ? "this scenario" : p.columns.map((c) => c.name).join(", ")}, projected ${horizon} months. Select a line to open it.`,
    columns: all.map((c) => c.name),
    changed,
    results,
    savings,
    paths,
    cash,
    pathGap,
    fullHref: single?.id ? `/plan/scenarios/${single.id}` : `/plan/scenarios/compare?ids=${p.columns.map((x) => x.id).filter(Boolean).join(",")}`,
  };
}

/** Measured numbers that decision conditions and goals can use. Values are calculated in src/lib/metrics.ts. */
export const METRICS: { key: string; label: string; unit: "usd" | "months" | "percent" | "count" | "days"; params?: string }[] = [
  { key: "runway_months", label: "Runway (months)", unit: "months" },
  { key: "cash_available", label: "Available cash", unit: "usd" },
  { key: "avg_monthly_spending", label: "Average monthly spending", unit: "usd" },
  { key: "avg_monthly_income", label: "Average monthly income", unit: "usd" },
  { key: "month_spending", label: "Spending this month so far", unit: "usd" },
  { key: "last_month_spending", label: "Spending last month", unit: "usd" },
  { key: "budget_variance_last_month", label: "Spending over budget last month", unit: "usd" },
  { key: "net_worth", label: "Net worth", unit: "usd" },
  { key: "total_debt", label: "Total debt", unit: "usd" },
  { key: "emergency_fund_pct", label: "Emergency fund progress (%)", unit: "percent" },
  { key: "retirement_progress_pct", label: "Retirement target progress (%)", unit: "percent" },
  { key: "savings_achieved_monthly", label: "Monthly savings from completed reduction actions", unit: "usd" },
  { key: "commitment_score_week", label: "Commitment completion score this week (%), including daily targets marked as commitments", unit: "percent" },
  { key: "missed_commitments_30d", label: "Missed commitments in the last 30 days", unit: "count" },
  { key: "overdue_tasks", label: "Overdue tasks", unit: "count" },
  { key: "days_until_acquisition_decision", label: "Days until the acquisition search decision date", unit: "days" },
  {
    key: "pipeline_items_at_or_past_stage",
    label: "Pipeline items at or past a stage",
    unit: "count",
    params: 'Requires pipeline and stage, for example {"pipeline":"Acquisitions","stage":"LOI signed"}',
  },
  { key: "pipeline_open_items", label: "Open items in a pipeline", unit: "count", params: 'Requires pipeline, for example {"pipeline":"Jobs"}' },
  {
    key: "target_count_last_days",
    label: "Daily target: count in the last N days",
    unit: "count",
    params: 'Target name and days, for example {"target":"Network outreach","days":7}',
  },
  {
    key: "target_count_last_weeks",
    label: "Daily target: count in the last N weeks",
    unit: "count",
    params: 'Target name and weeks, for example {"target":"Network outreach","weeks":4}',
  },
  { key: "target_missed_in_a_row", label: "Daily target: periods missed in a row", unit: "count", params: 'Target name, for example {"target":"Network outreach"}' },
  { key: "target_met_in_a_row", label: "Daily target: periods met in a row", unit: "count", params: 'Target name, for example {"target":"Network outreach"}' },
];

export const metricLabel = (key: string) => METRICS.find((m) => m.key === key)?.label ?? key;

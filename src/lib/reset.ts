/**
 * "Reset all data" (Settings, Sample data and reset). The database function public.reset_all_data('RESET')
 * (supabase/migrations/0014_initiative_builder_reset.sql) deletes the tables in RESET_DELETE_TABLES, in this order,
 * in one transaction, and keeps RESET_KEEP_TABLES. src/lib/reset.test.ts checks that these lists match the SQL
 * function and that every table in the app is in exactly one list.
 */

/** Deleted completely, in this order (children before parents). */
export const RESET_DELETE_TABLES = [
  "ai_messages", "ai_proposals", "ai_conversations", "initiative_drafts", "savings_ideas",
  "checklist_items", "checklists", "plan_documents", "sample_records",
  "record_links", "notes", "documents", "alerts", "calendar_events", "daily_plans",
  "missed_commitments", "commitments", "reviews", "target_entries", "target_misses",
  "partner_links", "partner_reports", "partners", "tasks",
  "raw_import_rows", "import_batches", "repayment_schedules", "funding_sources", "debt_payments", "debts",
  "reduction_actions", "budget_lines", "budgets", "savings_targets",
  "transactions", "recurring_series", "merchants", "account_balances", "accounts", "income_sources",
  "scenario_input_changes", "scenarios", "decision_options", "decisions", "decision_conditions",
  "milestone_options", "milestones", "goals",
  "pipeline_item_stage_extensions", "stage_history", "diligence_items", "deal_financials", "job_details",
  "investor_details", "consulting_details", "pipeline_items",
  "communications", "contacts", "organizations",
] as const;

/** Partly deleted: initiatives the owner created. The default initiatives (and any initiative a pipeline belongs to) stay. */
export const RESET_PARTIAL_TABLES = ["initiatives"] as const;

export const DEFAULT_INITIATIVES = ["Personal Finance", "Acquisition Search", "Employment", "Rosara", "Other Income", "Consulting"];

/** Kept: the setup. */
export const RESET_KEEP_TABLES = [
  "owner_profile", "entities", "inputs", "input_history", "change_log",
  "categories", "categorization_rules", "import_layouts",
  "pipelines", "pipeline_stages", "stage_tasks", "targets", "task_templates",
  "google_connections", "plaid_items", "ai_usage",
] as const;

/** Deleted with their table, then created again as for a new owner. */
export const RESET_RECREATED_DEFAULTS = ["Monthly budget (budget)", "Emergency fund and Retirement (savings targets)", "Runway under 6 months (decision condition)"];

/** Plain names for the summary of what was deleted. */
export const RESET_TABLE_LABELS: Record<string, string> = {
  transactions: "Transactions",
  accounts: "Accounts",
  account_balances: "Account balances",
  budgets: "Budgets",
  budget_lines: "Budget lines",
  debts: "Debts",
  debt_payments: "Debt payments",
  funding_sources: "Funding",
  repayment_schedules: "Repayment schedule rows",
  income_sources: "Income sources",
  savings_targets: "Savings targets",
  recurring_series: "Recurring charges",
  merchants: "Merchants",
  reduction_actions: "Reduction actions",
  pipeline_items: "Pipeline items",
  stage_history: "Stage history",
  deal_financials: "Deal financials",
  diligence_items: "Diligence items",
  job_details: "Job details",
  investor_details: "Investor details",
  consulting_details: "Consulting terms",
  pipeline_item_stage_extensions: "Stage time extensions",
  contacts: "Contacts",
  organizations: "Organizations",
  communications: "Communications",
  tasks: "Tasks",
  commitments: "Commitments",
  missed_commitments: "Missed commitments",
  reviews: "Reviews",
  target_entries: "Target counts",
  target_misses: "Missed target periods",
  partners: "Accountability partners",
  partner_links: "Partner links",
  partner_reports: "Partner reports",
  documents: "Documents",
  notes: "Notes",
  checklists: "Checklists",
  checklist_items: "Checklist items",
  plan_documents: "Plan documents",
  decisions: "Decisions",
  decision_options: "Decision options",
  decision_conditions: "Decision conditions",
  alerts: "Alerts",
  ai_conversations: "AI conversations",
  ai_messages: "AI messages",
  ai_proposals: "AI proposals",
  initiative_drafts: "Initiative drafts",
  savings_ideas: "Savings ideas",
  record_links: "Record links",
  import_batches: "Imports",
  raw_import_rows: "Imported rows",
  scenarios: "Scenarios",
  scenario_input_changes: "Scenario changes",
  goals: "Goals",
  milestones: "Milestones",
  milestone_options: "Milestone options",
  initiatives: "Initiatives you created",
  calendar_events: "Calendar time blocks",
  daily_plans: "Morning plans",
  sample_records: "Sample data markers",
};

/** Rows of the deleted-counts summary, largest first, without zero rows. */
export function resetSummaryRows(deleted: Record<string, number> | null | undefined): { table: string; label: string; count: number }[] {
  return Object.entries(deleted ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([table, n]) => ({ table, label: RESET_TABLE_LABELS[table] ?? table.replace(/_/g, " "), count: Number(n) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The export must be downloaded in this browser session, within this many minutes, before a reset. */
export const RESET_EXPORT_MAX_AGE_MINUTES = 120;
export const EXPORT_COOKIE = "bf_export_downloaded_at";

/** True when the export cookie is a time within the last RESET_EXPORT_MAX_AGE_MINUTES minutes. */
export function exportIsRecent(cookieValue: string | null | undefined, now: Date = new Date()): boolean {
  if (!cookieValue) return false;
  const t = Date.parse(decodeURIComponent(cookieValue));
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= -60_000 && age <= RESET_EXPORT_MAX_AGE_MINUTES * 60_000;
}

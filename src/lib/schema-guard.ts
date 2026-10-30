/**
 * Database updates 0008 (Daily Targets and Outreach Queue), 0009 (pipeline accountability and deal source),
 * 0010 (commitment rule: tasks.times_moved, released commitments), 0011 (deal source chain and Consulting), and
 * 0012 (contact options: relationship groups Friend and Other) may not be applied yet on the live database.
 * Every query that reads or writes the new tables or columns checks for "does not exist" errors with
 * isMissingSchemaError and shows DB_UPDATE_NOTICE (or skips the step) instead of failing.
 * All updates are in one file: supabase/UPDATE_RUN_ONCE.sql (0008 to 0012).
 * The live database has 0001 to 0010 (or 0001 to 0011): it uses supabase/UPDATE_0011_0012_RUN_ONCE.sql (0011, then 0012).
 * Features from 0011 and 0012 name that file in their notice.
 */

export const DB_UPDATE_FILE = "supabase/UPDATE_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE = `Database update needed: paste ${DB_UPDATE_FILE} into the Supabase SQL Editor and run it.`;

/** The file for the live database (0001 to 0010, or 0001 to 0011): updates 0011 and 0012 in one paste. */
export const DB_UPDATE_FILE_0011 = "supabase/UPDATE_0011_0012_RUN_ONCE.sql";
export const DB_UPDATE_FILE_0012 = DB_UPDATE_FILE_0011;
export const DB_UPDATE_NOTICE_0011 = `Database update needed: paste ${DB_UPDATE_FILE_0011} into the Supabase SQL Editor and run it.`;

/** Columns added by 0008, 0009, and 0011 to tables that already existed. Saving drops them when the update is not applied yet. */
export const NEW_COLUMNS: Record<string, string[]> = {
  contacts: ["relationship_group", "outreach_every_days", "is_deal_source", "is_consulting_lead"],
  communications: ["is_outreach", "outcome", "purpose", "pipeline_item_id"],
  pipeline_items: ["deal_source_type", "source_contact_id", "source_notes", "introduced_by_contact_id"],
  pipeline_stages: ["max_days_in_stage", "required_fields", "default_probability_pct", "counts_as_signed"],
  targets: ["stage_id"],
  transactions: ["pipeline_item_id"],
  initiatives: ["parent_initiative_id"],
  goals: ["metric_params"],
};

/** Kept for existing imports. */
export const COLUMNS_0008 = NEW_COLUMNS;

/** Columns added by 0009. Forms leave them out until the update is applied. */
export const COLUMNS_0009: Record<string, string[]> = {
  contacts: ["is_deal_source"],
  communications: ["purpose", "pipeline_item_id"],
  pipeline_items: ["deal_source_type", "source_contact_id", "source_notes"],
  pipeline_stages: ["max_days_in_stage", "required_fields"],
  targets: ["stage_id"],
};

/** Columns added by 0011. Forms leave them out until the update is applied. */
export const COLUMNS_0011: Record<string, string[]> = {
  contacts: ["is_consulting_lead"],
  pipeline_items: ["introduced_by_contact_id"],
  pipeline_stages: ["default_probability_pct", "counts_as_signed"],
  transactions: ["pipeline_item_id"],
};

export const NEW_TABLES = ["targets", "target_entries", "target_misses", "stage_tasks", "pipeline_item_stage_extensions", "consulting_details", "plan_documents", "checklists", "checklist_items", "savings_ideas", "initiative_drafts"];

/** Option values that need database update 0012 (a check constraint allows them only after it). */
export const OPTIONS_0012: Record<string, Record<string, string[]>> = {
  contacts: { relationship_group: ["friend", "other"] },
};

/** Function added by 0012, called to check whether the update is applied. */
export const PROBE_0012 = "schema_has_0012";

/** Tables added by 0011. */
export const TABLES_0011 = ["consulting_details"];

/** Kept for existing imports. */
export const TABLES_0008 = NEW_TABLES;

type PgError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * True when the error means a table, column, or function does not exist yet
 * (Postgres 42P01 / 42703 / 42883, or the API's "schema cache" errors PGRST200 / 202 / 204 / 205).
 */
export function isMissingSchemaError(e: PgError): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  if (["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return true;
  const msg = String(e.message ?? "");
  return /(relation|column|table|function) .*does not exist|could not find the .*(table|column|function)|schema cache/i.test(msg);
}

/** A check constraint rejected a value (for example a new count source before the update): Postgres 23514. */
export function isCheckViolation(e: PgError): boolean {
  return String(e?.code ?? "") === "23514";
}

/** Database update 0013 (send email from the app): Gmail ids on communications, partner reports marked sent. */
export const DB_UPDATE_FILE_0013 = "supabase/UPDATE_0013_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0013 = `Database update needed: paste ${DB_UPDATE_FILE_0013} into the Supabase SQL Editor and run it.`;
export const COLUMNS_0013: Record<string, string[]> = {
  communications: ["gmail_message_id", "gmail_thread_id"],
  partner_reports: ["sent_at", "gmail_message_id"],
};

/**
 * Database update 0014 (Start an initiative, savings ideas, checklists, sample data, Reset data).
 * The live database has 0001 to 0012 (or 0013): it runs supabase/UPDATE_0013_0014_RUN_ONCE.sql (0013, then 0014).
 * Before it, these features show DB_UPDATE_NOTICE_0014 and every other screen and both scheduled jobs keep working.
 */
export const DB_UPDATE_FILE_0014 = "supabase/UPDATE_0013_0014_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0014 = `Database update needed: paste ${DB_UPDATE_FILE_0014} into the Supabase SQL Editor and run it.`;
export const PROBE_0014 = "schema_has_0014";
export const TABLES_0014 = ["plan_documents", "checklists", "checklist_items", "savings_ideas", "initiative_drafts", "sample_records"];
/** Columns added by 0014 to tables that already existed. Forms leave them out until the update is applied. */
export const COLUMNS_0014: Record<string, string[]> = {
  initiatives: ["parent_initiative_id"],
  goals: ["metric_params"],
};

/**
 * Database update 0015 (Gmail signature on app emails): four columns on owner_profile.
 * Before it, Settings, Email signature shows DB_UPDATE_NOTICE_0015 and every email is sent without a signature.
 */
export const DB_UPDATE_FILE_0015 = "supabase/UPDATE_0015_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0015 = `Database update needed: paste ${DB_UPDATE_FILE_0015} into the Supabase SQL Editor and run it.`;
export const COLUMNS_0015: Record<string, string[]> = {
  owner_profile: ["email_signature_html", "email_signature_text", "email_signature_enabled", "email_signature_updated_at"],
};

/**
 * Database update 0016 (deal funnel): count sources cims_reviewed and deal_calls, the targets "Listings screened",
 * "CIMs reviewed", and "Broker or owner calls", the search hours and minutes-per-step inputs, and schema_has_0016().
 * Before it, the funnel card shows its other steps with "Database update needed" naming this file for Listings
 * screened, the suggested targets use the default numbers, and every other screen and both scheduled jobs keep working.
 */
export const DB_UPDATE_FILE_0016 = "supabase/UPDATE_0016_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0016 = `Database update needed: paste ${DB_UPDATE_FILE_0016} into the Supabase SQL Editor and run it.`;
export const PROBE_0016 = "schema_has_0016";
/** Count sources that need update 0016 (the check constraint allows them only after it). */
export const COUNT_SOURCES_0016 = ["cims_reviewed", "deal_calls"];

/**
 * Database update 0017 (partner report templates): the partner_report_templates table with the starter templates
 * Summary, Standard, and Detailed, partners.report_template_id, and schema_has_0017(). Before it, the report email
 * and the public page use the three starter templates from the code (STARTER_TEMPLATES in
 * src/lib/calc/partner-report.ts), Accountability, Report templates shows DB_UPDATE_NOTICE_0017 instead of the
 * editor, and every other screen and both scheduled jobs keep working. The balance sheet and the deal scorecard need
 * no database change.
 */
export const DB_UPDATE_FILE_0017 = "supabase/UPDATE_0017_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0017 = `Database update needed: paste ${DB_UPDATE_FILE_0017} into the Supabase SQL Editor and run it.`;
export const PROBE_0017 = "schema_has_0017";
export const TABLES_0017 = ["partner_report_templates"];
export const COLUMNS_0017: Record<string, string[]> = { partners: ["report_template_id"] };

/**
 * Database update 0018 (Done late and daily partner reports): missed_commitments.done_on and the resolution and
 * commitment status "done_late", the template period "day", partners.report_frequency, partner_reports.report_kind,
 * template_id, and skipped_at, and schema_has_0018(). Before it, Resolve offers Done late with DB_UPDATE_NOTICE_0018
 * (the other choices work), the partner form leaves out Report frequency, no daily report is drafted after the daily
 * close, and every other screen and both scheduled jobs keep working.
 */
export const DB_UPDATE_FILE_0018 = "supabase/UPDATE_0018_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0018 = `Database update needed: paste ${DB_UPDATE_FILE_0018} into the Supabase SQL Editor and run it.`;
export const PROBE_0018 = "schema_has_0018";
export const COLUMNS_0018: Record<string, string[]> = {
  partners: ["report_frequency"],
  missed_commitments: ["done_on"],
  partner_reports: ["report_kind", "template_id", "skipped_at"],
};

/**
 * Database update 0019 (the focused version, batch 1): the daily_outcomes table, daily_plans.focused_hours,
 * changes_note, and tomorrow_priority, tasks.waiting_on and waiting_since, and schema_has_0019(). Before it, Today
 * and Close the day show DB_UPDATE_NOTICE_0019 instead of their content, the task window leaves out Waiting on, and
 * every other screen and both scheduled jobs keep working.
 */
export const DB_UPDATE_FILE_0019 = "supabase/UPDATE_0019_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0019 = `Database update needed: paste ${DB_UPDATE_FILE_0019} into the Supabase SQL Editor and run it.`;
export const PROBE_0019 = "schema_has_0019";
export const TABLES_0019 = ["daily_outcomes"];
export const COLUMNS_0019: Record<string, string[]> = {
  daily_plans: ["focused_hours", "changes_note", "tomorrow_priority"],
  tasks: ["waiting_on", "waiting_since"],
};

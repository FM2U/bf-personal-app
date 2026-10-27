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

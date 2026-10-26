/**
 * Database updates 0008 (Daily Targets and Outreach Queue), 0009 (pipeline accountability and deal source), and
 * 0010 (commitment rule: tasks.times_moved, released commitments) may not be applied yet on the live database.
 * Every query that reads or writes the new tables or columns checks for "does not exist" errors with
 * isMissingSchemaError and shows DB_UPDATE_NOTICE (or skips the step) instead of failing.
 * All three updates are in one file: supabase/UPDATE_RUN_ONCE.sql.
 */

export const DB_UPDATE_FILE = "supabase/UPDATE_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE = `Database update needed: paste ${DB_UPDATE_FILE} into the Supabase SQL Editor and run it.`;

/** Columns added by 0008 and 0009 to tables that already existed. Saving drops them when the update is not applied yet. */
export const NEW_COLUMNS: Record<string, string[]> = {
  contacts: ["relationship_group", "outreach_every_days", "is_deal_source"],
  communications: ["is_outreach", "outcome", "purpose", "pipeline_item_id"],
  pipeline_items: ["deal_source_type", "source_contact_id", "source_notes"],
  pipeline_stages: ["max_days_in_stage", "required_fields"],
  targets: ["stage_id"],
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

export const NEW_TABLES = ["targets", "target_entries", "target_misses", "stage_tasks", "pipeline_item_stage_extensions"];

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

/**
 * Database update 0008 (Daily Targets and Outreach Queue) may not be applied yet on the live database.
 * Every query that reads or writes the new tables or columns checks for "does not exist" errors with
 * isMissingSchemaError and shows DB_UPDATE_NOTICE instead of failing.
 */

export const DB_UPDATE_FILE = "supabase/UPDATE_0008_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE = `Database update needed: paste ${DB_UPDATE_FILE} into the Supabase SQL Editor and run it.`;

/** Columns added by 0008 to tables that already existed. Saving drops them when the update is not applied yet. */
export const COLUMNS_0008: Record<string, string[]> = {
  contacts: ["relationship_group", "outreach_every_days"],
  communications: ["is_outreach", "outcome"],
};

export const TABLES_0008 = ["targets", "target_entries", "target_misses"];

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

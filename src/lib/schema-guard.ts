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

/**
 * Database update 0015 (Gmail signature on app emails): four columns on owner_profile.
 * Before it, Settings, Email signature shows DB_UPDATE_NOTICE_0015 and every email is sent without a signature.
 */
const DB_UPDATE_FILE_0015 = "supabase/UPDATE_0015_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0015 = `Database update needed: paste ${DB_UPDATE_FILE_0015} into the Supabase SQL Editor and run it.`;
/**
 * Database update 0020 (the Work module, batch A): the listing and deal columns on pipeline_items (what it does,
 * location, industry, link, broker, why selling, key finding, open questions, waiting on and since, pass reason,
 * screened, buy box note, block minutes), the acquisition stages (Interested to Diligence, Passed, Lost), their default
 * next actions, the waiting setting, and schema_has_0020(). Before it, Work on now, Screen listings, Deals, and the
 * deal page show DB_UPDATE_NOTICE_0020 instead of their content, and every other screen and both scheduled jobs keep
 * working.
 */
const DB_UPDATE_FILE_0020 = "supabase/UPDATE_0020_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0020 = `Database update needed: paste ${DB_UPDATE_FILE_0020} into the Supabase SQL Editor and run it.`;
export const PROBE_0020 = "schema_has_0020";
/**
 * Database update 0021 (Edit batch A): pipeline_items.company_name and open_questions_json (three groups of lines),
 * the deal_todos table ("Also to do" per deal), "Chase" renamed "Follow up" in the stage defaults, and
 * schema_has_0021(). Before it, Work on now, Screen listings, Deals, and the deal page show DB_UPDATE_NOTICE_0021
 * instead of their content, and every other screen and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0021 = "supabase/UPDATE_0021_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0021 = `Database update needed: paste ${DB_UPDATE_FILE_0021} into the Supabase SQL Editor and run it.`;
export const PROBE_0021 = "schema_has_0021";
/**
 * Database update 0022 (batch B): contacts.outreach_role, purposes, linkedin_url, last_contact_at, last_contact_kind,
 * archived_at; communications.call_minutes, call_outcome, awaiting_log; the todos, projects, and ai_order_cache tables;
 * deal_todos.record_type and record_id; pipeline_items.role_title, contact_name, fee; the Job search and Consulting
 * stages; the outreach target and Rosara weekly focus settings; and schema_has_0022(). Before it, every Work screen
 * shows DB_UPDATE_NOTICE_0022 instead of its content, and every other screen and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0022 = "supabase/UPDATE_0022_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0022 = `Database update needed: paste ${DB_UPDATE_FILE_0022} into the Supabase SQL Editor and run it.`;
export const PROBE_0022 = "schema_has_0022";
/**
 * Database update 0023 (batch B2): notes.kind ('note' or 'finding') and notes.source_url (a finding with its source
 * on a project's timeline), pipeline_items.pay_range (a job opportunity), and schema_has_0023(). Before it, every
 * Work screen shows DB_UPDATE_NOTICE_0023 instead of its content, and every other screen and both scheduled jobs
 * keep working.
 */
const DB_UPDATE_FILE_0023 = "supabase/UPDATE_0023_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0023 = `Database update needed: paste ${DB_UPDATE_FILE_0023} into the Supabase SQL Editor and run it.`;
export const PROBE_0023 = "schema_has_0023";
/**
 * Database update 0024 (Edit batch B): in the acquisition pipeline Broker call moves after CIM review (positions
 * 3 and 4 swapped by UPDATE, stage ids and every deal's stage kept), the NDA signed default becomes "Ask the broker
 * for the CIM" (on the stage and on the deals that still carried the old text), the seed for future owners follows,
 * and schema_has_0024(). Before it, every Work screen shows DB_UPDATE_NOTICE_0024 instead of its content, and every
 * other screen and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0024 = "supabase/UPDATE_0024_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0024 = `Database update needed: paste ${DB_UPDATE_FILE_0024} into the Supabase SQL Editor and run it.`;
export const PROBE_0024 = "schema_has_0024";

/**
 * Database update 0025 (batch C: Targets, End of day, Reports): targets.counts_key and archived_at, the work_events
 * and end_of_day tables, partner_reports.report_kind 'end_of_day', and schema_has_0025(). Before it, Targets, End of
 * day, Reports, and the Targets today tile on Home show DB_UPDATE_NOTICE_0025 instead of their content, Done on a
 * next action or a follow-up records no work event (nothing else changes), and every other screen and both scheduled
 * jobs keep working.
 */
const DB_UPDATE_FILE_0025 = "supabase/UPDATE_0025_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0025 = `Database update needed: paste ${DB_UPDATE_FILE_0025} into the Supabase SQL Editor and run it.`;
/**
 * Database update 0026 (Edit batch C round 2): the outreach role "Former colleague" becomes "Personal network". The
 * contacts that carry former_colleague move to personal_network by UPDATE (nothing is deleted), the role check allows
 * the new key instead of the old one, and schema_has_0026(). Before it, Outreach shows DB_UPDATE_NOTICE_0026 as one line
 * under the tabs, Personal network is saved under the old key (it reads back as Personal network), and every screen
 * and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0026 = "supabase/UPDATE_0026_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0026 = `Database update needed: paste ${DB_UPDATE_FILE_0026} into the Supabase SQL Editor and run it. Until then, Personal network is saved under its old name.`;
export const PROBE_0026 = "schema_has_0026";

/**
 * Database update 0027 (Fix, approved 2026-11-02): pipeline_items.listing_text (the original listing text pasted into
 * Add a listing, shown in the Original listing text card and read by every AI action on the record), and
 * pipeline_items.year_established and employees (Facts), and schema_has_0027(). Before it, the Work screens read the
 * records without these columns (they show as not known), a listing saves without them (the pasted text is not kept),
 * and saving listing text on a record shows DB_UPDATE_NOTICE_0027; every other screen and both scheduled jobs keep
 * working.
 */
const DB_UPDATE_FILE_0027 = "supabase/UPDATE_0027_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0027 = `Database update needed: paste ${DB_UPDATE_FILE_0027} into the Supabase SQL Editor and run it. Until then, the original listing text is not kept.`;
/**
 * Database update 0028 (AI instructions and Findings, approved 2026-11-02): pipeline_items.strengths and
 * pipeline_items.risks (the Findings card's two lists, jsonb arrays of up to 3 lines, read by every later AI action as
 * facts), the three Buy box settings as inputs rows (owner-operator yes, financing and growth goals empty), and
 * schema_has_0028(). Before it, the Findings card shows DB_UPDATE_NOTICE_0028 under Strengths and Risks and saves the
 * key finding and the questions without them; the Buy box settings save anyway (the rows are added on Save); every
 * other screen and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0028 = "supabase/UPDATE_0028_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0028 = `Database update needed: paste ${DB_UPDATE_FILE_0028} into the Supabase SQL Editor and run it. Until then, strengths and risks are not kept.`;
export const PROBE_0028 = "schema_has_0028";
/**
 * Database update 0029 (AI instructions revision 1, approved 2026-11-02): pipeline_items.growth_paths (the Findings
 * card's Growth paths, a jsonb array of up to 3 lines, the first is the main one) and pipeline_items.financing (Facts,
 * Financing: 'equity' by default or 'equity_plus_debt'), the Buy box settings rows (core and stretch ranges, industries,
 * excluded types, regions) with today's values for each owner, the removal of the two settings revision 1 replaced
 * (financing and growth goals; their rows only), and schema_has_0029(). Before it, the Findings card shows
 * DB_UPDATE_NOTICE_0029 under Growth paths and saves everything else; Facts has no Financing field; the Buy box page
 * saves anyway (it adds the rows); every other screen and both scheduled jobs keep working.
 */
const DB_UPDATE_FILE_0029 = "supabase/UPDATE_0029_RUN_ONCE.sql";
export const DB_UPDATE_NOTICE_0029 = `Database update needed: paste ${DB_UPDATE_FILE_0029} into the Supabase SQL Editor and run it. Until then, growth paths and financing are not kept.`;
export const PROBE_0029 = "schema_has_0029";

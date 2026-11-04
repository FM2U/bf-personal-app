import "server-only";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "@/lib/types";

/** The tables in the full export (Settings, Export): every table of the final app except the Google tokens. */
export const EXPORT_TABLES = [
  "owner_profile", "inputs", "organizations", "contacts", "communications", "notes", "documents", "record_links",
  "pipelines", "pipeline_stages", "stage_tasks", "pipeline_items", "stage_history", "deal_financials", "consulting_details", "deal_todos",
  "tasks", "projects", "work_events", "time_blocks",
  "targets", "target_entries", "target_misses", "end_of_day", "partner_reports",
  "ai_usage", "change_log",
];

/** Columns never exported (tokens and secrets). */
const SECRET_COLUMNS = ["refresh_token_enc", "access_token_enc", "token_hash", "token_encrypted", "sync_cursor"];

/** Reads every row of a query page by page (the API returns at most 1000 rows per request). */
async function fetchAll(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>, pageSize = 1000, maxRows = 100000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function readTable(sb: SupabaseClient, table: string): Promise<Row[]> {
  const order = table === "owner_profile" ? "owner_id" : table === "stage_history" ? "entered_at" : "created_at";
  const rows = await fetchAll((from, to) => sb.from(table).select("*").order(order).range(from, to));
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMNS.includes(k))));
}

export function toCsv(rows: Row[]): string {
  return Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))));
}

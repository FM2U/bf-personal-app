import "server-only";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/data";
import { SECRET_COLUMNS } from "@/lib/resources";
import type { Row } from "@/lib/types";

export async function readTable(sb: SupabaseClient, table: string): Promise<Row[]> {
  const order = table === "owner_profile" ? "owner_id" : "created_at";
  const rows = await fetchAll((from, to) => sb.from(table).select("*").order(table === "input_history" ? "changed_at" : table === "stage_history" ? "entered_at" : order).range(from, to));
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMNS.includes(k))));
}

export function toCsv(rows: Row[]): string {
  return Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))));
}

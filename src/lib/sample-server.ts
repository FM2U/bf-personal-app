import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SAMPLE_TABLES } from "@/lib/sample-data";

/** Tables checked for real (not sample) records before sample data is loaded. */
export const REAL_RECORD_TABLES = ["accounts", "transactions", "contacts", "organizations", "pipeline_items", "debts", "funding_sources", "partners", "communications", "goals", "milestones", "income_sources"];

const countOf = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

/** Records that are not sample data, per table (sample rows are listed in sample_records). */
export async function countRealRecords(sb: SupabaseClient): Promise<{ total: number; byTable: Record<string, number> }> {
  const rows = await Promise.all(
    REAL_RECORD_TABLES.map(async (t) => {
      const [all, sample] = await Promise.all([
        countOf(sb.from(t).select("id", { count: "exact", head: true })),
        countOf(sb.from("sample_records").select("id", { count: "exact", head: true }).eq("table_name", t)),
      ]);
      return [t, Math.max(0, all - sample)] as const;
    }),
  );
  const byTable = Object.fromEntries(rows.filter(([, n]) => n > 0));
  return { total: Object.values(byTable).reduce((s, n) => s + n, 0), byTable };
}

/** Sample rows per table (zero before database update 0014). */
export async function countSampleRecords(sb: SupabaseClient): Promise<{ total: number; byTable: Record<string, number> }> {
  const tables = [...SAMPLE_TABLES, "recurring_series"];
  const rows = await Promise.all(tables.map(async (t) => [t, await countOf(sb.from("sample_records").select("id", { count: "exact", head: true }).eq("table_name", t))] as const));
  const byTable = Object.fromEntries(rows.filter(([, n]) => n > 0));
  return { total: Object.values(byTable).reduce((s, n) => s + n, 0), byTable };
}

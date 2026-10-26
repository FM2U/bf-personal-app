import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResource, RESOURCES } from "@/lib/resources";
import type { Row } from "@/lib/types";
import { date as fmtDate } from "@/lib/format";

export type RefOption = { id: string; label: string; extra?: Row };

/** Display title for any row of a known table. */
export function titleOf(table: string, row: Row | null | undefined, refLabels?: Record<string, Record<string, string>>): string {
  if (!row) return "";
  const r = getResource(table);
  if (table === "budget_lines" && refLabels?.categories) return refLabels.categories[row.category_id] ?? "Budget line";
  if (table === "reviews") return `${cap(row.kind)} review, ${row.period_start}${row.period_end !== row.period_start ? ` to ${row.period_end}` : ""}`;
  if (table === "partner_reports") return `Report for ${row.period_start} to ${row.period_end}`;
  if (table === "account_balances") return `Balance on ${row.as_of}`;
  if (table === "deal_financials" || table === "job_details" || table === "investor_details") return r?.singular ?? table;
  const v = r ? row[r.titleField] : row.name ?? row.title;
  const tf = r?.fields.find((f) => f.name === r.titleField);
  if (v && tf?.type === "date") return fmtDate(String(v));
  return v ? String(v) : r?.singular ?? "Record";
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Load id + title for the given tables, for selects and for showing linked names. */
export async function loadRefOptions(sb: SupabaseClient, tables: string[]): Promise<Record<string, RefOption[]>> {
  const unique = [...new Set(tables)].filter((t) => RESOURCES[t]);
  const out: Record<string, RefOption[]> = {};
  await Promise.all(
    unique.map(async (t) => {
      const r = RESOURCES[t];
      const { data } = await sb.from(t).select("*").order(r.order[0], { ascending: r.order[1] }).limit(1000);
      out[t] = (data ?? []).map((row: Row) => ({ id: row.id, label: titleOf(t, row), extra: row }));
    }),
  );
  if (out.budget_lines || out.pipeline_stages) {
    // add context to labels that are not unique on their own
    if (out.pipeline_stages) {
      const { data: pipes } = await sb.from("pipelines").select("id,name");
      const pn = Object.fromEntries((pipes ?? []).map((p: Row) => [p.id, p.name]));
      out.pipeline_stages = out.pipeline_stages.map((s) => ({ ...s, label: `${pn[s.extra?.pipeline_id] ?? ""}: ${s.label}` }));
    }
  }
  return out;
}

export function labelMap(options: Record<string, RefOption[]>): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(options).map(([t, list]) => [t, Object.fromEntries(list.map((o) => [o.id, o.label]))]));
}

/** Insert and ignore a duplicate (unique key already used). Returns the new id or null. */
export async function insertIgnoreDuplicate(sb: SupabaseClient, table: string, row: Row): Promise<string | null> {
  const { data, error } = await sb.from(table).insert(row).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`${table}: ${error.message}`);
  }
  return (data as Row | null)?.id ?? null;
}

export async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what = "query"): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** Reads every row of a query page by page (the API returns at most 1000 rows per request). */
export async function fetchAll(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 100000,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

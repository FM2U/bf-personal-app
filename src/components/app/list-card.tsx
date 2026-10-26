import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResourceTable } from "@/components/app/resource-table";
import { getResource, newRecordHref, RESOURCES } from "@/lib/resources";
import { labelMap, loadRefOptions } from "@/lib/data";
import type { Row } from "@/lib/types";

export type Filter = [column: string, op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "is" | "in", value: unknown];

/** A card with a table of records, filters, and an add button. Used by most list screens. */
export async function ListCard({
  sb,
  table,
  title,
  description,
  filters = [],
  columns,
  prefill,
  limit = 500,
  order,
  emptyTitle,
  emptyBody,
  rows: givenRows,
}: {
  sb: SupabaseClient;
  table: string;
  title?: string;
  description?: string;
  filters?: Filter[];
  columns?: string[];
  prefill?: Record<string, string>;
  limit?: number;
  order?: [string, boolean];
  emptyTitle?: string;
  emptyBody?: string;
  rows?: Row[];
}) {
  const r = getResource(table)!;
  let rows = givenRows;
  if (!rows) {
    let q = sb.from(table).select("*");
    for (const [c, op, v] of filters) {
      if (op === "is") q = q.is(c, v as null);
      else if (op === "in") q = q.in(c, v as string[]);
      else q = q.filter(c, op, v as string);
    }
    const [col, asc] = order ?? r.order;
    const { data } = await q.order(col, { ascending: asc, nullsFirst: false }).limit(limit);
    rows = (data ?? []) as Row[];
  }
  const cols = columns ?? r.columns;
  const refTables = cols.map((c) => r.fields.find((f) => f.name === c)?.ref).filter((x): x is string => !!x && !!RESOURCES[x]);
  if (table === "budget_lines") refTables.push("categories");
  const labels = labelMap(await loadRefOptions(sb, refTables));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title ?? r.plural}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {!r.noCreate && rows.length ? (
          <Button asChild size="sm">
            <Link href={newRecordHref(table, prefill)}>Add {r.singular.toLowerCase()}</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <ResourceTable table={table} rows={rows} labels={labels} columns={cols} prefill={prefill} emptyTitle={emptyTitle} emptyBody={emptyBody} />
      </CardContent>
    </Card>
  );
}

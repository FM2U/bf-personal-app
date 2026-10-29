import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResourceTable } from "@/components/app/resource-table";
import { getResource, newRecordHref, RESOURCES } from "@/lib/resources";
import { labelMap, loadRefOptions } from "@/lib/data";
import type { Row } from "@/lib/types";
import { MODULE_ICONS, ModuleTitle, type ModuleKey } from "@/components/app/module-icon";
import { ListFilter } from "@/components/app/filter-panel";
import { applyFilters, fieldFilter, isDefaultFilters, plainParams, readFilters, type DateMode, type FilterSpec } from "@/lib/list-filters";

/**
 * The Filter panel on a list card: `columns` names the record fields to filter by, one visual column each (or a few
 * stacked: ["direction", "occurred_at"]). The filters live in the address of `path`; `sp` is the page's search
 * parameters (the others are kept). Dates use `dateModes` ("due": Overdue to Later; "past": Last 7 days to Older).
 */
export type ListFilterSetup = {
  path: string;
  sp: Record<string, string | string[] | undefined>;
  today: string;
  columns: (string | string[])[];
  dateModes?: Record<string, DateMode>;
  titles?: Record<string, string>;
};

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
  hideAdd = false,
  filter,
}: {
  /** Adds the Filter button and panel (src/components/app/filter-panel.tsx). */
  filter?: ListFilterSetup;
  /** No "Add" button (a second list of the same records on the page already has one). */
  hideAdd?: boolean;
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
  // Filters (in memory, on the rows loaded above).
  let filterUi: React.ReactNode = null;
  let filtered = false;
  if (filter) {
    const names = filter.columns.flat();
    const refOpts = await loadRefOptions(sb, names.map((n) => r.fields.find((f) => f.name === n)?.ref).filter((x): x is string => !!x && !!RESOURCES[x]));
    const specs: Record<string, FilterSpec> = {};
    for (const n of names) {
      const f = r.fields.find((x) => x.name === n);
      const spec = f ? fieldFilter(f, { refOptions: f.ref ? refOpts[f.ref] : undefined, dateMode: filter.dateModes?.[n], title: filter.titles?.[n] }) : null;
      if (spec) specs[n] = spec;
    }
    const layout = filter.columns.map((c) => ([] as string[]).concat(c).filter((n) => specs[n]).map((n) => specs[n].column)).filter((g) => g.length);
    const flat = layout.flat();
    const state = readFilters(filter.sp, flat);
    filtered = !isDefaultFilters(state, flat);
    rows = applyFilters(rows, Object.values(specs), state, filter.today);
    filterUi = <ListFilter path={filter.path} layout={layout} state={state} keep={plainParams(filter.sp)} />;
  }
  const cols = columns ?? r.columns;
  const seg = r.listHref.split("/")[1] ?? "";
  const moduleKey = seg in MODULE_ICONS ? (seg as ModuleKey) : null;
  const refTables = cols.map((c) => r.fields.find((f) => f.name === c)?.ref).filter((x): x is string => !!x && !!RESOURCES[x]);
  if (table === "budget_lines") refTables.push("categories");
  const labels = labelMap(await loadRefOptions(sb, refTables));
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>
            {/* The module's icon in its color, as in the sidebar (one accent per card header). */}
            {moduleKey ? <ModuleTitle module={moduleKey}>{title ?? r.plural}</ModuleTitle> : title ?? r.plural}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
          {filterUi ? <div className="mt-2">{filterUi}</div> : null}
        </div>
        {!r.noCreate && !hideAdd && (rows.length || filtered) ? (
          <Button asChild size="sm">
            <Link href={newRecordHref(table, prefill)}>Add {r.singular.toLowerCase()}</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <ResourceTable
          table={table}
          rows={rows}
          labels={labels}
          columns={cols}
          prefill={prefill}
          emptyTitle={filtered && !rows.length ? `No ${(title ?? r.plural).toLowerCase()} match these filters.` : emptyTitle}
          emptyBody={filtered && !rows.length ? "Remove a filter label above, or press Reset." : emptyBody}
          hideAdd={hideAdd || (filtered && !rows.length)}
        />
      </CardContent>
    </Card>
  );
}

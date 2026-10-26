import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FieldValue } from "@/components/app/field-value";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getResource, newRecordHref, recordHref } from "@/lib/resources";
import { titleOf } from "@/lib/data";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

/** Table of records with the title linking to each record page. Shows an empty state with an add button. */
export function ResourceTable({
  table,
  rows,
  labels,
  columns,
  prefill,
  emptyTitle,
  emptyBody,
  addLabel,
  hideAdd,
}: {
  table: string;
  rows: Row[];
  labels: Record<string, Record<string, string>>;
  columns?: string[];
  prefill?: Record<string, string>;
  emptyTitle?: string;
  emptyBody?: string;
  addLabel?: string;
  hideAdd?: boolean;
}) {
  const r = getResource(table);
  if (!r) return null;
  const cols = columns ?? r.columns;
  const canAdd = !r.noCreate && !hideAdd;
  if (!rows.length) {
    return (
      <EmptyState
        title={emptyTitle ?? `No ${r.plural.toLowerCase()} yet.`}
        body={emptyBody ?? r.empty}
        action={canAdd ? <Button asChild size="sm"><Link href={newRecordHref(table, prefill)}>{addLabel ?? `Add ${r.singular.toLowerCase()}`}</Link></Button> : undefined}
      />
    );
  }
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {cols.map((c) => (
            <TH key={c}>{c === "created_at" ? "Created" : r.fields.find((f) => f.name === c)?.label ?? c}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            {cols.map((c, i) => {
              const field = r.fields.find((f) => f.name === c);
              return (
                <TD key={c} className={i === 0 ? "max-w-[22rem]" : field?.type === "money" ? "text-right" : undefined}>
                  {i === 0 ? (
                    <Link href={recordHref(table, row.id)} className="clamp-2 font-medium text-slate-900 hover:text-teal-800 hover:underline">
                      {c === "created_at" ? (
                        dateTime(row[c])
                      ) : c === r.titleField ? (
                        titleOf(table, row, labels) || "Open"
                      ) : field?.type === "ref" ? (
                        labels[field.ref!]?.[row[c]] ?? "Open"
                      ) : (
                        <FieldValue field={field} value={row[c]} labels={labels} />
                      )}
                    </Link>
                  ) : c === "created_at" ? (
                    dateTime(row[c])
                  ) : (
                    <FieldValue field={field} value={row[c]} labels={labels} />
                  )}
                </TD>
              );
            })}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

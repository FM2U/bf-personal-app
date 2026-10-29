import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CollapsibleCard } from "@/components/app/collapsible";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/page-header";
import { ResourceTable } from "@/components/app/resource-table";
import { getResource, newRecordHref, recordHref, RESOURCES } from "@/lib/resources";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";
import { DocumentsCard, HistoryCard, LinkedRecordsCard, NotesCard } from "@/components/app/record-side-panels";
import { loadDocuments, loadHistory, loadLinked, loadNotes } from "@/lib/record-panels-data";

export { NextActionCard } from "@/components/app/next-action-card";

/** Linked records in both directions, with one-click navigation, plus a form to add a link. */
export async function LinkedRecordsPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  return <LinkedRecordsCard table={table} id={id} data={await loadLinked(sb, table, id)} />;
}

/** Uploaded documents, with an upload form (the file goes straight to storage from the browser). */
export async function DocumentsPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  return <DocumentsCard table={table} id={id} docs={await loadDocuments(sb, table, id)} />;
}

export async function NotesPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  return <NotesCard table={table} id={id} notes={await loadNotes(sb, table, id)} />;
}

export async function CommunicationsPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  const [{ data: l1 }, { data: l2 }] = await Promise.all([
    sb.from("record_links").select("from_id").eq("from_type", "communications").eq("to_type", table).eq("to_id", id),
    sb.from("record_links").select("to_id").eq("to_type", "communications").eq("from_type", table).eq("from_id", id),
  ]);
  const ids = [...((l1 ?? []) as Row[]).map((x) => x.from_id), ...((l2 ?? []) as Row[]).map((x) => x.to_id)];
  let q = sb.from("communications").select("*").order("occurred_at", { ascending: false }).limit(20);
  if (table === "contacts") q = q.or(`contact_id.eq.${id}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`);
  else if (table === "organizations") q = q.or(`organization_id.eq.${id}${ids.length ? `,id.in.(${ids.join(",")})` : ""}`);
  else if (ids.length) q = q.in("id", ids);
  else q = q.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data } = await q;
  const comms = (data ?? []) as Row[];
  return (
    <CollapsibleCard id="communications" storageKey={`record:${table}`} title="Communication history" meta={comms.length || undefined} defaultOpen={comms.length > 0} summary={comms.length ? `Last: ${dateTime(comms[0].occurred_at)}` : "None logged yet."}>
      <div className="flex flex-col gap-2">
        {comms.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {comms.map((c) => (
              <li key={c.id} className="py-1.5">
                <Link href={recordHref("communications", c.id)} className="text-sm hover:underline">
                  <span className="block text-xs text-muted-foreground">
                    {dateTime(c.occurred_at)} . {c.method}
                  </span>
                  <span className="clamp-1 font-medium text-primary-strong">{c.subject ?? "Communication"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No emails, calls, letters, or meetings logged for this record.</p>
        )}
        <Button asChild size="sm" variant="outline" className="self-start">
          <Link href={newRecordHref("communications", { __link_type: table, __link_id: id, ...(table === "contacts" ? { contact_id: id } : {}), ...(table === "organizations" ? { organization_id: id } : {}) })}>
            Log a communication
          </Link>
        </Button>
      </div>
    </CollapsibleCard>
  );
}

export async function HistoryPanel({ sb, table, id, labels = {} }: { sb: SupabaseClient; table: string; id: string; labels?: Record<string, Record<string, string>> }) {
  return <HistoryCard table={table} history={await loadHistory(sb, table, id, labels)} />;
}

/** Shorter column sets for child lists that sit in the narrower main column of a record page. */
const CHILD_COLUMNS: Record<string, string[]> = { communications: ["occurred_at", "method", "direction", "subject", "outcome"] };

/** Child records (example: payments under a debt) with an add button that fills in the parent. */
export async function ChildrenSections({ sb, table, id, labels }: { sb: SupabaseClient; table: string; id: string; labels: Record<string, Record<string, string>> }) {
  const r = getResource(table);
  if (!r?.children?.length) return null;
  const sections = await Promise.all(
    r.children.map(async (c) => {
      const cr = RESOURCES[c.table];
      const { data } = await sb.from(c.table).select("*").eq(c.fk, id).order(cr.order[0], { ascending: cr.order[1] }).limit(200);
      return { c, cr, rows: (data ?? []) as Row[] };
    }),
  );
  return (
    <>
      {sections.map(({ c, cr, rows }) => (
        <CollapsibleCard
          key={c.table + c.fk}
          id={`child:${c.table}:${c.fk}`}
          storageKey={`record:${table}`}
          title={c.label}
          meta={rows.length || undefined}
          defaultOpen={rows.length > 0}
          summary={`None yet. ${cr.empty ?? ""}`.trim()}
          actions={
            !cr.noCreate ? (
              <Button asChild size="sm" variant="outline">
                <Link href={newRecordHref(c.table, { [c.fk]: id })}>Add</Link>
              </Button>
            ) : null
          }
        >
          <ResourceTable table={c.table} rows={rows} labels={labels} columns={(CHILD_COLUMNS[c.table] ?? cr.columns).filter((col) => col !== c.fk)} prefill={{ [c.fk]: id }} />
        </CollapsibleCard>
      ))}
    </>
  );
}

export function NoRecord({ table }: { table: string }) {
  return <EmptyState title="This record was not found." body="It may have been deleted." action={<Button asChild size="sm"><Link href={getResource(table)?.listHref ?? "/"}>Back to the list</Link></Button>} />;
}

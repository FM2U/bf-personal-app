import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileText, Link2, Trash2 } from "lucide-react";
import { CollapsibleCard } from "@/components/app/collapsible";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { EmptyState } from "@/components/app/page-header";
import { ResourceTable } from "@/components/app/resource-table";
import { addLink, addNote, deleteDocument, deleteNote, removeLink, uploadDocument } from "@/app/actions/records";
import { getResource, newRecordHref, recordHref, RESOURCES } from "@/lib/resources";
import { titleOf } from "@/lib/data";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";
import { GuardedForm } from "@/components/app/unsaved-changes";

export { NextActionCard } from "@/components/app/next-action-card";

const LINK_TARGET_TABLES = [
  "contacts", "organizations", "pipeline_items", "initiatives", "goals", "milestones", "decisions", "tasks", "debts",
  "funding_sources", "accounts", "partners", "communications", "income_sources", "scenarios", "reduction_actions",
];

/** Linked records in both directions, with one-click navigation, plus a form to add a link. */
export async function LinkedRecordsPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  const [{ data: out }, { data: inc }] = await Promise.all([
    sb.from("record_links").select("*").eq("from_type", table).eq("from_id", id),
    sb.from("record_links").select("*").eq("to_type", table).eq("to_id", id),
  ]);
  const links = [
    ...((out ?? []) as Row[]).map((l) => ({ id: l.id, type: l.to_type, rid: l.to_id, relation: l.relation })),
    ...((inc ?? []) as Row[]).map((l) => ({ id: l.id, type: l.from_type, rid: l.from_id, relation: l.relation })),
  ];
  const byType: Record<string, string[]> = {};
  for (const l of links) (byType[l.type] ??= []).push(l.rid);
  const titles: Record<string, string> = {};
  await Promise.all(
    Object.entries(byType).map(async ([t, ids]) => {
      if (!RESOURCES[t] && t !== "documents") return;
      const { data } = await sb.from(t).select("*").in("id", ids);
      for (const r of (data ?? []) as Row[]) titles[`${t}:${r.id}`] = titleOf(t, r);
    }),
  );
  const candidates = await Promise.all(
    LINK_TARGET_TABLES.filter((t) => t !== table).map(async (t) => {
      const r = RESOURCES[t];
      const { data } = await sb.from(t).select("*").order(r.order[0], { ascending: r.order[1] }).limit(100);
      return { t, label: r.plural, rows: ((data ?? []) as Row[]).map((x) => ({ id: x.id, label: titleOf(t, x) })) };
    }),
  );
  return (
    <CollapsibleCard id="linked" storageKey={`record:${table}`} title="Linked records" icon={<Link2 className="h-4 w-4" />} meta={links.length || undefined} defaultOpen={links.length > 0} summary="None yet. Open to link a person, deal, goal, or document.">
      <div className="flex flex-col gap-3">
        {links.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link href={recordHref(l.type, l.rid)} className="min-w-0 text-sm hover:underline">
                  <span className="block text-xs text-muted-foreground">
                    {getResource(l.type)?.singular ?? l.type}
                    {l.relation ? ` (${l.relation})` : ""}
                  </span>
                  <span className="clamp-1 font-medium text-primary-strong">{titles[`${l.type}:${l.rid}`] ?? "Open record"}</span>
                </Link>
                <GuardedForm action={removeLink}>
                  <input type="hidden" name="id" value={l.id} />
                  <Button variant="ghost" size="icon" aria-label="Remove link">
                    <Trash2 />
                  </Button>
                </GuardedForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No linked records. Link this record to the people, deals, goals, or documents it relates to.</p>
        )}
        <GuardedForm action={addLink} className="flex flex-col gap-2">
          <input type="hidden" name="from_type" value={table} />
          <input type="hidden" name="from_id" value={id} />
          <NativeSelect name="target" required defaultValue="" aria-label="Record to link">
            <option value="" disabled>
              Choose a record to link
            </option>
            {candidates
              .filter((c) => c.rows.length)
              .map((c) => (
                <optgroup key={c.t} label={c.label}>
                  {c.rows.map((r) => (
                    <option key={r.id} value={`${c.t}:${r.id}`}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              ))}
          </NativeSelect>
          <div className="flex gap-2">
            <Input name="relation" placeholder="Relation (optional), example: lender" aria-label="Relation" />
            <SubmitButton size="sm" variant="outline" pendingText="Linking...">
              Link
            </SubmitButton>
          </div>
        </GuardedForm>
      </div>
    </CollapsibleCard>
  );
}

export async function DocumentsPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  const { data } = await sb.from("documents").select("*").eq("record_type", table).eq("record_id", id).order("created_at", { ascending: false });
  const docs = (data ?? []) as Row[];
  return (
    <CollapsibleCard id="documents" storageKey={`record:${table}`} title="Documents" icon={<FileText className="h-4 w-4" />} meta={docs.length || undefined} defaultOpen={docs.length > 0} summary="None yet. Open to upload an agreement, statement, or proof.">
      <div className="flex flex-col gap-3">
        {docs.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                <a href={`/api/documents/${d.id}`} className="min-w-0 text-sm hover:underline" target="_blank" rel="noreferrer">
                  <span className="clamp-1 font-medium text-primary-strong">{d.file_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.kind.replace(/_/g, " ")} . {dateTime(d.created_at)}
                  </span>
                </a>
                <GuardedForm action={deleteDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button variant="ghost" size="icon" aria-label="Delete document">
                    <Trash2 />
                  </Button>
                </GuardedForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents. Upload signed agreements, statements, or proof here.</p>
        )}
        <GuardedForm action={uploadDocument} className="flex flex-col gap-2">
          <input type="hidden" name="record_type" value={table} />
          <input type="hidden" name="record_id" value={id} />
          <Input type="file" name="file" required aria-label="File" />
          <div className="flex gap-2">
            <NativeSelect name="kind" defaultValue="other" aria-label="Document kind">
              {["signed_agreement", "statement", "proof", "cim", "nda", "loi", "report", "other"].map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
            <SubmitButton size="sm" variant="outline" pendingText="Uploading...">
              Upload
            </SubmitButton>
          </div>
        </GuardedForm>
      </div>
    </CollapsibleCard>
  );
}

export async function NotesPanel({ sb, table, id }: { sb: SupabaseClient; table: string; id: string }) {
  const { data } = await sb.from("notes").select("*").eq("record_type", table).eq("record_id", id).order("created_at", { ascending: false });
  const notes = (data ?? []) as Row[];
  return (
    <CollapsibleCard id="notes" storageKey={`record:${table}`} title="Notes" meta={notes.length || undefined} defaultOpen summary={notes.length ? `Latest: ${String(notes[0].body).slice(0, 80)}` : "No notes yet."}>
      <div className="flex flex-col gap-3">
        <GuardedForm action={addNote} className="flex flex-col gap-2">
          <input type="hidden" name="record_type" value={table} />
          <input type="hidden" name="record_id" value={id} />
          <Textarea name="body" rows={2} placeholder="Add a note" aria-label="Note" required />
          <SubmitButton size="sm" variant="outline" className="self-start">
            Add note
          </SubmitButton>
        </GuardedForm>
        {notes.map((n) => (
          <div key={n.id} className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              {dateTime(n.created_at)}
              <GuardedForm action={deleteNote}>
                <input type="hidden" name="id" value={n.id} />
                <button className="hover:text-status-missed" aria-label="Delete note">
                  Delete
                </button>
              </GuardedForm>
            </div>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
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
  const { data } = await sb.from("change_log").select("*").eq("table_name", table).eq("record_id", id).order("created_at", { ascending: false }).limit(25);
  const r = getResource(table);
  const rows = ((data ?? []) as Row[]).filter((c) => c.action !== "update" || !r || r.fields.some((f) => f.name === c.field));
  const show = (v: unknown, field?: string) => {
    const f = r?.fields.find((x) => x.name === field);
    if (f?.type === "ref" && typeof v === "string") return labels[f.ref!]?.[v] ?? "another record";
    if (f?.type === "select" && v !== null && v !== undefined) return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    return showRaw(v);
  };
  const showRaw = (v: unknown) => (v === null || v === undefined ? "empty" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80));
  return (
    <CollapsibleCard id="history" storageKey={`record:${table}`} title="Change history" meta={rows.length || undefined} defaultOpen={false} summary={rows.length ? `Last change ${dateTime(rows[0].created_at)}` : "No changes recorded."}>
      <div>
        {rows.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {rows.map((c) => (
              <li key={c.id} className="border-b border-slate-100 pb-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{dateTime(c.created_at)}</span>
                  <Badge variant={c.actor === "ai" ? "default" : "neutral"}>{c.actor === "ai" ? "AI (approved)" : c.actor === "system" ? "Scheduled job" : "Owner"}</Badge>
                </div>
                {c.action === "update" ? (
                  <p className="mt-0.5">
                    <span className="font-medium">{r?.fields.find((f) => f.name === c.field)?.label ?? c.field}</span>: {show(c.old_value, c.field)} to {show(c.new_value, c.field)}
                  </p>
                ) : (
                  <p className="mt-0.5">
                    {c.field === "email_sent" ? `Email sent from the app to ${showRaw((c.new_value as Row | null)?.to)}` : c.action === "insert" ? "Created" : "Deleted"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No changes recorded.</p>
        )}
      </div>
    </CollapsibleCard>
  );
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getResource, RESOURCES } from "@/lib/resources";
import { labelMap, loadRefOptions, titleOf } from "@/lib/data";
import { quickCreateRefTables } from "@/lib/quick-create";
import { nextActionFor } from "@/lib/next-action";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, DetailGrid } from "@/components/app/page-header";
import { FieldValue } from "@/components/app/field-value";
import { RecordForm } from "@/components/app/record-form";
import { ConfirmSubmit } from "@/components/app/submit-button";
import { ChildrenSections, CommunicationsPanel, DocumentsPanel, HistoryPanel, LinkedRecordsPanel, NextActionCard, NoRecord, NotesPanel } from "@/components/app/record-panels";
import { ExtraPanels, ExtraSidePanels, PipelineItemNotices } from "@/components/app/extra-panels";
import { deleteRecord } from "@/app/actions/records";
import { formRules } from "@/lib/form-rules";
import { GuardedForm } from "@/components/app/unsaved-changes";

const COMMS_TABLES = new Set(["contacts", "organizations", "pipeline_items", "funding_sources", "debts", "partners", "decisions", "goals", "milestones"]);

export default async function RecordPage({ params, searchParams }: { params: Promise<{ table: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { table, id } = await params;
  const sp = await searchParams;
  const r = getResource(table);
  if (!r) notFound();
  const { supabase, ownerId } = await requireOwner();
  const { data: row } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return <NoRecord table={table} />;
  const refTables = new Set<string>();
  for (const f of r.fields) if (f.ref) refTables.add(f.ref);
  for (const c of r.children ?? []) for (const f of RESOURCES[c.table].fields) if (f.ref) refTables.add(f.ref);
  if (table === "budget_lines") refTables.add("categories");
  for (const t of quickCreateRefTables(r.fields)) refTables.add(t);
  const refOptions = await loadRefOptions(supabase, [...refTables]);
  const labels = labelMap(refOptions);
  const ctx = await loadCtx(supabase, ownerId);
  const next = await nextActionFor(supabase, table, row, ctx.today);
  const editing = sp.edit === "1" && !r.noEdit;
  const title = titleOf(table, row, labels);
  const rules = await formRules(supabase, table, row);

  return (
    <div>
      <Link href={r.listHref} className="no-print mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> {r.plural}
      </Link>
      <PageHeader
        title={title}
        description={r.singular}
        actions={
          !editing && !r.noEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`?edit=1`}>
                <Pencil /> Edit
              </Link>
            </Button>
          ) : null
        }
      />
      {table === "pipeline_items" ? <PipelineItemNotices sb={supabase} row={row} sp={sp} /> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card id="details">
            <CardHeader>
              <CardTitle>{editing ? `Edit ${r.singular.toLowerCase()}` : "Details"}</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <RecordForm table={table} id={id} initial={row} refOptions={refOptions} cancelHref="?" showSaveRule={table === "transactions"} hide={rules.hide} require={rules.require} text={rules.text} />
              ) : (
                <DetailGrid cols={2} items={r.fields.filter((f) => !rules.hide.includes(f.name)).map((f) => ({ label: rules.text[f.name]?.label ?? f.label, value: <FieldValue field={f} value={row[f.name]} labels={labels} /> }))} />
              )}
            </CardContent>
          </Card>
          <ExtraPanels sb={supabase} ownerId={ownerId} table={table} row={row} today={ctx.today} labels={labels} refOptions={refOptions} sp={sp} />
          <ChildrenSections sb={supabase} table={table} id={id} labels={labels} />
          {editing && !r.noDelete ? (
            <GuardedForm action={deleteRecord} className="self-start">
              <input type="hidden" name="__table" value={table} />
              <input type="hidden" name="__id" value={id} />
              <ConfirmSubmit variant="destructive" size="sm" message={`Delete this ${r.singular.toLowerCase()}? This cannot be undone.`}>
                Delete {r.singular.toLowerCase()}
              </ConfirmSubmit>
            </GuardedForm>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <NextActionCard action={next} />
          <ExtraSidePanels sb={supabase} ownerId={ownerId} table={table} row={row} today={ctx.today} labels={labels} refOptions={refOptions} />
          <LinkedRecordsPanel sb={supabase} table={table} id={id} />
          {COMMS_TABLES.has(table) ? <CommunicationsPanel sb={supabase} table={table} id={id} /> : null}
          <DocumentsPanel sb={supabase} table={table} id={id} />
          <NotesPanel sb={supabase} table={table} id={id} />
          <HistoryPanel sb={supabase} table={table} id={id} labels={labels} />
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { getResource } from "@/lib/resources";
import { loadRefOptions } from "@/lib/data";
import { quickCreateRefTables } from "@/lib/quick-create";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { RecordForm } from "@/components/app/record-form";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { formRules, optionExclusions, stageDefaultNextAction } from "@/lib/form-rules";
import { DB_UPDATE_FILE_0011 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

export default async function NewRecordPage({ params, searchParams }: { params: Promise<{ table: string }>; searchParams: Promise<Record<string, string>> }) {
  const { table } = await params;
  const sp = await searchParams;
  const r = getResource(table);
  if (!r || r.noCreate) notFound();
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const refOptions = await loadRefOptions(supabase, [
    ...r.fields.filter((f) => f.ref).map((f) => f.ref!),
    ...quickCreateRefTables(r.fields),
    // Organizations: "People at this organization" lists contacts and where they work now.
    ...(table === "organizations" ? ["contacts", "organizations"] : []),
  ]);
  const initial: Row = {};
  const extraHidden: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith("__")) extraHidden[k] = v;
    else if (k === "related_type" || k === "related_id") extraHidden[`__set_${k}`] = v;
    else initial[k] = v;
  }
  // Sensible defaults
  for (const f of r.fields) {
    if (initial[f.name] !== undefined) continue;
    if (f.type === "date" && ["as_of", "paid_on", "date", "due_date", "deadline"].includes(f.name) && f.required) initial[f.name] = ctx.today;
    if (f.name === "entity_id" && refOptions.entities?.length) initial[f.name] = refOptions.entities.find((e) => e.extra?.is_default)?.id ?? refOptions.entities[0].id;
    if (f.name === "budget_id" && refOptions.budgets?.length === 1) initial[f.name] = refOptions.budgets[0].id;
    if (f.name === "occurred_at") initial[f.name] = new Date().toISOString();
  }
  // Pipeline items: the first stage when none is given, and the stage's default next action.
  if (table === "pipeline_items" && initial.pipeline_id && !initial.stage_id) {
    const { data: first } = await supabase.from("pipeline_stages").select("id").eq("pipeline_id", initial.pipeline_id).order("position").limit(1).maybeSingle();
    if (first) initial.stage_id = first.id;
  }
  if (table === "pipeline_items" && !initial.next_action) {
    const def = await stageDefaultNextAction(supabase, initial.stage_id, ctx.today);
    if (def) {
      initial.next_action = def.title;
      initial.next_action_due = initial.next_action_due ?? def.due;
    } else if (!initial.next_action_due) initial.next_action_due = ctx.today;
  }
  const [rules, excludeOptions] = await Promise.all([formRules(supabase, table, initial), optionExclusions(supabase)]);
  return (
    <div>
      <Link href={r.listHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> {r.plural}
      </Link>
      <PageHeader title={`Add ${r.singular.toLowerCase()}`} description={r.empty} />
      {rules.updateNeeded && (table === "pipeline_items" || table === "contacts") ? (
        <div className="mb-4 max-w-[57.5rem]">
          <DbUpdateNotice compact file={rules.updateNeeded === "0009" ? undefined : DB_UPDATE_FILE_0011} />
        </div>
      ) : null}
      <Card className="max-w-[57.5rem]">
        <CardContent className="pt-5">
          <RecordForm table={table} initial={initial} refOptions={refOptions} cancelHref={r.listHref} extraHidden={extraHidden} hide={rules.hide} require={rules.require} text={rules.text} excludeOptions={excludeOptions} />
        </CardContent>
      </Card>
    </div>
  );
}

"use server";

import { requireOwner } from "@/lib/auth";
import { getResource, recordHref, type Field } from "@/lib/resources";
import { titleOf } from "@/lib/data";
import { loadCtx } from "@/lib/engine/helpers";
import { nextActionFor, type NextAction } from "@/lib/next-action";
import { formRules } from "@/lib/form-rules";
import { fieldText, isWideField, quickFields } from "@/lib/quick-view";
import type { Status } from "@/lib/status";
import type { Row } from "@/lib/types";

export type QuickField = { label: string; text: string; href?: string; status?: Status; wide?: boolean };
export type QuickViewData =
  | {
      ok: true;
      table: string;
      id: string;
      singular: string;
      title: string;
      href: string;
      canEdit: boolean;
      fields: QuickField[];
      next: NextAction;
      today: string;
      /** Tasks: done or not, for the Mark as done button. */
      taskDone: boolean | null;
      email: string | null;
      phone: string | null;
    }
  | { ok: false; error: string };

const STATUS_FIELDS = new Set(["status", "review_status", "resolution"]);
/** A record status as a status color: done or met green, missed or lost red, anything else (open, active, planned) gray. */
function recordStatus(v: string): Status {
  if (["done", "met", "won", "completed", "decided", "received"].includes(v)) return "met";
  if (["missed", "lost", "overdue", "error"].includes(v)) return "missed";
  return "neutral";
}

/** The data for the quick view window of one record (key fields, next required action, main actions). */
export async function loadQuickView(table: string, id: string, maxFields = 12): Promise<QuickViewData> {
  const r = getResource(table);
  if (!r) return { ok: false, error: "This kind of record cannot be shown here." };
  const { supabase, ownerId } = await requireOwner();
  const { data: row } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "This record was not found. It may have been deleted." };
  const [ctx, rules] = await Promise.all([loadCtx(supabase, ownerId), formRules(supabase, table, row as Row)]);
  const combineSource = table === "pipeline_items" && !rules.hide.includes("source_contact_id");
  const fields = quickFields(table, row as Row, [...rules.hide, ...(combineSource ? ["source"] : [])], maxFields);
  // Titles of the referenced records, one query per referenced table.
  const refIds: Record<string, Set<string>> = {};
  for (const f of fields) if (f.type === "ref" && f.ref) (refIds[f.ref] ??= new Set()).add(String(row[f.name]));
  const titles: Record<string, string> = {};
  await Promise.all(
    Object.entries(refIds).map(async ([t, ids]) => {
      const { data } = await supabase.from(t).select("*").in("id", [...ids]);
      for (const x of (data ?? []) as Row[]) titles[`${t}:${x.id}`] = titleOf(t, x);
    }),
  );
  const next = await nextActionFor(supabase, table, row as Row, ctx.today);
  const out: QuickField[] = fields
    .map((f: Field) => {
      const label = rules.text[f.name]?.label ?? f.label;
      if (f.type === "ref" && f.ref) {
        const rid = String(row[f.name]);
        return { label, text: titles[`${f.ref}:${rid}`] ?? "Open record", href: recordHref(f.ref, rid) };
      }
      const text = fieldText(f, row[f.name]);
      return STATUS_FIELDS.has(f.name) && f.type === "select" ? { label, text, status: recordStatus(String(row[f.name])) } : { label, text, wide: isWideField(f) };
    })
    .filter((f) => f.text);
  return {
    ok: true,
    table,
    id,
    singular: r.singular,
    title: titleOf(table, row as Row),
    href: recordHref(table, id),
    canEdit: !r.noEdit,
    fields: out,
    next,
    today: ctx.today,
    taskDone: table === "tasks" ? row.status === "done" : null,
    email: typeof row.email === "string" && row.email ? row.email : null,
    phone: typeof row.phone === "string" && row.phone ? row.phone : null,
  };
}

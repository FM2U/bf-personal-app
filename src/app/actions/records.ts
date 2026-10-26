"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getResource, recordHref, RESOURCES, type Field } from "@/lib/resources";
import { dedupeHash, merchantFromDescription, normalizeDescription } from "@/lib/calc/csv";
import { tzOffset } from "@/lib/google";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { checkCommitments } from "@/lib/engine/tasks";
import { nextReportDate } from "@/lib/engine/partners";
import { COLUMNS_0008, DB_UPDATE_NOTICE, isMissingSchemaError, TABLES_0008 } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

export type FormState = { ok: boolean; error?: string; message?: string } | null;

const NUMERIC_SELECTS = new Set(["priority", "weekday"]);
const CONDITION_TABLES = new Set([
  "accounts", "account_balances", "transactions", "debts", "debt_payments", "inputs", "budget_lines", "budgets",
  "reduction_actions", "pipeline_items", "milestones", "goals", "tasks", "commitments", "funding_sources", "repayment_schedules",
  "communications", "targets", "target_entries",
]);

function fieldSchema(f: Field): z.ZodType {
  switch (f.type) {
    case "number":
    case "money":
    case "percent":
      return z.union([z.literal(""), z.coerce.number({ message: `${f.label} must be a number` })]).transform((v) => (v === "" ? null : v));
    case "date":
      return z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label} must be a date`)]).transform((v) => (v === "" ? null : v));
    case "email":
      return z.union([z.literal(""), z.string().email(`${f.label} must be an email address`)]).transform((v) => (v === "" ? null : v));
    default:
      return z.string().transform((v) => (v.trim() === "" ? null : v.trim()));
  }
}

async function parseFields(fields: Field[], fd: FormData, tz: string): Promise<{ data: Row } | { error: string }> {
  const data: Row = {};
  for (const f of fields) {
    if (f.readOnly || f.hideOnForm) continue;
    if (!fd.has(f.name) && !fd.has(`${f.name}__present`)) continue;
    if (f.type === "boolean") {
      data[f.name] = fd.get(f.name) === "on" || fd.get(f.name) === "true";
      continue;
    }
    if (f.type === "multiselect" || f.type === "tags") {
      const vals = fd.getAll(f.name).map(String).filter(Boolean);
      data[f.name] = f.type === "tags" ? vals.flatMap((v) => v.split(",").map((x) => x.trim())).filter(Boolean) : vals;
      continue;
    }
    const raw = String(fd.get(f.name) ?? "");
    if (f.type === "json" || f.type === "actions") {
      if (!raw.trim()) {
        data[f.name] = f.type === "actions" ? [] : {};
      } else {
        try {
          data[f.name] = JSON.parse(raw);
        } catch {
          return { error: `${f.label} is not valid. Use the format shown in the example.` };
        }
      }
      if (f.required && f.type === "actions" && !(data[f.name] as unknown[]).length) return { error: `Add at least one required action.` };
      continue;
    }
    if (f.type === "datetime") {
      data[f.name] = raw ? (raw.length === 16 ? `${raw}:00${tzOffset(tz, raw.slice(0, 10))}` : raw) : null;
    } else {
      const parsed = fieldSchema(f).safeParse(raw);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? `${f.label} is not valid` };
      data[f.name] = parsed.data;
    }
    if (NUMERIC_SELECTS.has(f.name) && data[f.name] !== null) data[f.name] = Number(data[f.name]);
    if (f.required && (data[f.name] === null || data[f.name] === undefined)) return { error: `${f.label} is required.` };
  }
  return { data };
}

/** Create or update any record described in src/lib/resources.ts. */
export async function saveRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  const table = String(fd.get("__table") ?? "");
  const id = String(fd.get("__id") ?? "") || null;
  const resource = getResource(table);
  if (!resource) return { ok: false, error: "Unknown record type." };
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const parsed = await parseFields(resource.fields, fd, ctx.tz);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const data = parsed.data;

  let before: Row | null = null;
  if (id) {
    const { data: row } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    before = row as Row | null;
    if (!before) return { ok: false, error: "Record not found." };
  }

  // Record-specific preparation
  if (table === "transactions") {
    const merged = { ...(before ?? {}), ...data };
    if (!merged.merchant_name && merged.description) data.merchant_name = merchantFromDescription(merged.description);
    if (merged.account_id && merged.date && merged.amount !== null && merged.amount !== undefined) {
      data.dedupe_hash = dedupeHash(merged.account_id, merged.date, Number(merged.amount), merged.description ?? "");
    }
    if ("category_id" in data && data.category_id !== before?.category_id) data.category_source = data.category_id ? "manual" : "none";
  }
  if (table === "pipeline_items" && !data.stage_id && data.pipeline_id) {
    const { data: first } = await supabase.from("pipeline_stages").select("id").eq("pipeline_id", data.pipeline_id).order("position").limit(1).maybeSingle();
    data.stage_id = first?.id ?? null;
  }
  if (table === "partners" && !id && !data.next_report_on) data.next_report_on = nextReportDate(String(data.schedule ?? "weekly"), ctx.today);
  if (table === "decisions" && data.status === "decided" && !data.decided_on) data.decided_on = ctx.today;
  if (table === "reduction_actions" && data.status === "completed" && !data.completed_on) data.completed_on = ctx.today;
  if (table === "targets") {
    if (Array.isArray(data.active_weekdays)) data.active_weekdays = (data.active_weekdays as string[]).map(Number).filter((n) => n >= 0 && n <= 6);
    if (!id && !data.start_date) data.start_date = ctx.today;
    if ("start_date" in data && !data.start_date) delete data.start_date;
    if (data.count_source !== "pipeline_items_created" && "pipeline_id" in data) data.pipeline_id = null;
  }
  if (table === "communications" && data.outcome && data.is_outreach === false) data.is_outreach = true;

  if (!id) {
    for (const k of ["related_type", "related_id"]) {
      const v = String(fd.get(`__set_${k}`) ?? "");
      if (v && table === "tasks") data[k] = v;
    }
  }

  let savedId = id;
  const write = async (values: Row) => {
    if (id) {
      const { error } = await supabase.from(table).update(values).eq("id", id);
      return { error, newId: id };
    }
    const { data: created, error } = await supabase.from(table).insert({ ...values, owner_id: ownerId }).select("id").single();
    return { error, newId: (created as Row | null)?.id ?? null };
  };
  let result = await write(data);
  // Database update 0008 not applied yet: save without the new columns so existing screens keep working.
  if (result.error && isMissingSchemaError(result.error) && COLUMNS_0008[table]) {
    const without = Object.fromEntries(Object.entries(data).filter(([k]) => !COLUMNS_0008[table].includes(k)));
    result = await write(without);
  }
  if (result.error) {
    if (isMissingSchemaError(result.error) && TABLES_0008.includes(table)) return { ok: false, error: DB_UPDATE_NOTICE };
    return { ok: false, error: result.error.message };
  }
  savedId = result.newId;

  // Link a new record to the record it was created from (example: a communication about a deal)
  const linkType = String(fd.get("__link_type") ?? "");
  const linkId = String(fd.get("__link_id") ?? "");
  if (!id && savedId && linkType && linkId && LINKABLE.has(linkType)) {
    await supabase.from("record_links").insert({ owner_id: ownerId, from_type: table, from_id: savedId, to_type: linkType, to_id: linkId, relation: "concerns" });
  }

  // After-save rules
  if (table === "transactions" && fd.get("save_rule") === "on" && data.category_id && data.category_id !== before?.category_id) {
    const pattern = (data.merchant_name ?? before?.merchant_name ?? normalizeDescription(String(data.description ?? before?.description ?? ""))) as string;
    if (pattern) await supabase.from("categorization_rules").insert({ owner_id: ownerId, pattern, match_type: "contains", category_id: data.category_id, created_from: "correction" });
  }
  if (table === "pipeline_items" && !id && savedId) await ensurePipelineDetails(supabase, ownerId, savedId, String(data.pipeline_id));
  if (table === "milestones" && data.status === "met" && before?.status !== "met" && before?.next_milestone_id) {
    await supabase.from("milestones").update({ status: "active" }).eq("id", before.next_milestone_id).neq("status", "met");
  }
  if (["tasks", "milestones", "goals"].includes(table)) await checkCommitments(ctx, false);
  if (CONDITION_TABLES.has(table)) await evaluateConditions(ctx);

  revalidatePath("/", "layout");
  const target = String(fd.get("__redirect") ?? "") || (savedId ? recordHref(table, savedId) : resource.listHref);
  redirect(target.replace("{id}", savedId ?? ""));
}

async function ensurePipelineDetails(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], ownerId: string, itemId: string, pipelineId: string) {
  const { data: p } = await sb.from("pipelines").select("kind").eq("id", pipelineId).maybeSingle();
  const table = p?.kind === "acquisition" ? "deal_financials" : p?.kind === "job" ? "job_details" : p?.kind === "investor" ? "investor_details" : null;
  if (table) await sb.from(table).insert({ owner_id: ownerId, item_id: itemId });
}

export async function deleteRecord(fd: FormData) {
  const table = String(fd.get("__table") ?? "");
  const id = String(fd.get("__id") ?? "");
  const resource = getResource(table);
  if (!resource || resource.noDelete) throw new Error("This record cannot be deleted.");
  const { supabase } = await requireOwner();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
  redirect(String(fd.get("__redirect") ?? "") || resource.listHref);
}

const LINKABLE = new Set([...Object.keys(RESOURCES), "documents", "notes"]);

export async function addLink(fd: FormData) {
  const fromType = String(fd.get("from_type"));
  const fromId = String(fd.get("from_id"));
  const target = String(fd.get("target") ?? ""); // "table:id"
  const relation = String(fd.get("relation") ?? "") || null;
  const [toType, toId] = target.split(":");
  if (!LINKABLE.has(fromType) || !LINKABLE.has(toType) || !toId) return;
  const { supabase, ownerId } = await requireOwner();
  const { error } = await supabase.from("record_links").insert({ owner_id: ownerId, from_type: fromType, from_id: fromId, to_type: toType, to_id: toId, relation });
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath("/", "layout");
}

export async function removeLink(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("record_links").delete().eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

export async function addNote(fd: FormData) {
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return;
  const { supabase, ownerId } = await requireOwner();
  await supabase.from("notes").insert({ owner_id: ownerId, record_type: String(fd.get("record_type")), record_id: String(fd.get("record_id")), body });
  revalidatePath("/", "layout");
}

export async function deleteNote(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("notes").delete().eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

export async function uploadDocument(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return;
  const recordType = String(fd.get("record_type"));
  const recordId = String(fd.get("record_id"));
  const { supabase, ownerId } = await requireOwner();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${ownerId}/${recordType}/${recordId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  await supabase.from("documents").insert({
    owner_id: ownerId,
    record_type: recordType,
    record_id: recordId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    kind: String(fd.get("kind") ?? "other"),
    description: String(fd.get("description") ?? "") || null,
  });
  revalidatePath("/", "layout");
}

export async function deleteDocument(fd: FormData) {
  const { supabase } = await requireOwner();
  const { data } = await supabase.from("documents").select("storage_path").eq("id", String(fd.get("id"))).maybeSingle();
  if (data?.storage_path) await supabase.storage.from("documents").remove([data.storage_path]);
  await supabase.from("documents").delete().eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

export async function setTaskStatus(taskId: string, done: boolean) {
  const { supabase, ownerId } = await requireOwner();
  await supabase.from("tasks").update({ status: done ? "done" : "todo" }).eq("id", taskId);
  const ctx = await loadCtx(supabase, ownerId);
  await checkCommitments(ctx, false);
  revalidatePath("/", "layout");
}

export async function dismissAlert(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("id", String(fd.get("id")));
  revalidatePath("/", "layout");
}

/** Marks a task, milestone, or goal as a commitment with a due date. */
export async function markCommitment(fd: FormData) {
  const recordType = String(fd.get("record_type"));
  const recordId = String(fd.get("record_id"));
  if (!["tasks", "milestones", "goals"].includes(recordType)) return;
  const { supabase, ownerId } = await requireOwner();
  const { data: rec } = await supabase.from(recordType).select("*").eq("id", recordId).single();
  if (!rec) return;
  const due = String(fd.get("due_date") ?? "") || rec.due_date || rec.deadline;
  if (!due) throw new Error("Set a due date on the record first.");
  const { error } = await supabase.from("commitments").insert({
    owner_id: ownerId,
    title: rec.title,
    record_type: recordType,
    record_id: recordId,
    due_date: due,
    original_due_date: due,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath("/", "layout");
}

/** Missed commitment flow: one-line reason, then a new date or a decision record. */
export async function resolveMiss(fd: FormData) {
  const missId = String(fd.get("miss_id"));
  const reason = String(fd.get("reason") ?? "").trim();
  const resolution = String(fd.get("resolution") ?? "");
  const newDate = String(fd.get("new_due_date") ?? "");
  if (!reason) throw new Error("A one-line reason is required.");
  const { supabase, ownerId } = await requireOwner();
  const { data: miss } = await supabase.from("missed_commitments").select("*").eq("id", missId).single();
  if (!miss) return;
  const { data: c } = await supabase.from("commitments").select("*").eq("id", miss.commitment_id).single();
  if (!c) return;
  if (resolution === "new_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw new Error("Choose a new date.");
    await supabase.from("missed_commitments").update({ reason, resolution: "new_date", new_due_date: newDate }).eq("id", missId);
    await supabase.from("commitments").update({ status: "open", due_date: newDate }).eq("id", c.id);
    if (c.record_type === "tasks") await supabase.from("tasks").update({ due_date: newDate, status: "todo" }).eq("id", c.record_id);
    if (c.record_type === "milestones") await supabase.from("milestones").update({ due_date: newDate, status: "active" }).eq("id", c.record_id);
    if (c.record_type === "goals") await supabase.from("goals").update({ deadline: newDate, status: "active" }).eq("id", c.record_id);
  } else {
    const { data: d } = await supabase
      .from("decisions")
      .insert({ owner_id: ownerId, title: `Missed commitment: ${c.title}`, context: `Reason given: ${reason}. Missed ${c.miss_count} time(s).`, source: "missed_commitment", source_id: c.id, status: "open" })
      .select("id")
      .single();
    if (d) {
      await supabase.from("decision_options").insert([
        { owner_id: ownerId, decision_id: d.id, label: "Set a new date", sort_order: 1 },
        { owner_id: ownerId, decision_id: d.id, label: "Change the commitment", sort_order: 2 },
        { owner_id: ownerId, decision_id: d.id, label: "Drop the commitment", sort_order: 3 },
      ]);
      await supabase.from("missed_commitments").update({ reason, resolution: "decision", decision_id: d.id }).eq("id", missId);
      await supabase.from("commitments").update({ status: "closed_by_decision" }).eq("id", c.id);
    }
  }
  await supabase.from("tasks").update({ status: "done" }).eq("source_key", `miss:${c.id}:${miss.missed_on}`);
  await supabase.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("dedupe_key", `miss:${c.id}:${miss.missed_on}`).eq("status", "open");
  revalidatePath("/", "layout");
}

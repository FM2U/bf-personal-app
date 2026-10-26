"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { classifyRows, dedupeHash, merchantFromDescription, normalizeDescription, parseRow, type ImportLayout } from "@/lib/calc/csv";
import { fetchAll } from "@/lib/data";
import { loadCtx } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { applyCategoryRules, detectAndSaveRecurring, ruleMatches } from "@/lib/engine/finance-jobs";
import type { Row } from "@/lib/types";

/** Records a transfer as two linked transactions (money out of one account, into the other). Transfers are not spending or income. */
export async function recordTransfer(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  const from = String(fd.get("from_account"));
  const to = String(fd.get("to_account"));
  const amount = Math.abs(Number(fd.get("amount")));
  const date = String(fd.get("date"));
  const note = String(fd.get("description") ?? "").trim() || "Transfer";
  if (!from || !to || from === to) throw new Error("Choose two different accounts.");
  if (!(amount > 0)) throw new Error("Enter an amount.");
  const pair = randomUUID();
  const { data: cat } = await supabase.from("categories").select("id").eq("name", "Transfer").maybeSingle();
  await supabase.from("transactions").insert([
    { owner_id: ownerId, account_id: from, date, amount: -amount, description: note, is_transfer: true, transfer_pair_id: pair, source: "manual", category_id: cat?.id ?? null, category_source: "manual", dedupe_hash: dedupeHash(from, date, -amount, note) },
    { owner_id: ownerId, account_id: to, date, amount, description: note, is_transfer: true, transfer_pair_id: pair, source: "manual", category_id: cat?.id ?? null, category_source: "manual", dedupe_hash: dedupeHash(to, date, amount, note) },
  ]);
  await evaluateConditions(await loadCtx(supabase, ownerId));
  revalidatePath("/", "layout");
}

/** Sets a category from the expenses list. A correction can be saved as a rule for the merchant. */
export async function setCategory(transactionId: string, categoryId: string | null, saveRule: boolean) {
  const { supabase, ownerId } = await requireOwner();
  const { data: t } = await supabase.from("transactions").select("merchant_name,description").eq("id", transactionId).single();
  await supabase.from("transactions").update({ category_id: categoryId, category_source: categoryId ? "manual" : "none" }).eq("id", transactionId);
  if (saveRule && categoryId && t) {
    const pattern = t.merchant_name || normalizeDescription(t.description ?? "");
    if (pattern) {
      const { data: existing } = await supabase.from("categorization_rules").select("id").eq("pattern", pattern).maybeSingle();
      if (existing) await supabase.from("categorization_rules").update({ category_id: categoryId }).eq("id", existing.id);
      else await supabase.from("categorization_rules").insert({ owner_id: ownerId, pattern, category_id: categoryId, created_from: "correction" });
    }
  }
  revalidatePath("/finance", "layout");
}

export type PreviewRow = {
  rowNumber: number;
  date: string | null;
  amount: number | null;
  description: string;
  externalId: string | null;
  error: string | null;
  status: "new" | "duplicate" | "error";
  category: string | null;
};

/** Review step: parses rows with the column layout and marks duplicates. Nothing is saved yet. */
export async function previewImport(accountId: string, layout: ImportLayout, rows: Record<string, string>[]): Promise<{ rows: PreviewRow[]; error?: string }> {
  const { supabase } = await requireOwner();
  if (!accountId) return { rows: [], error: "Choose the account these transactions belong to." };
  if (rows.length > 5000) return { rows: [], error: "The file has more than 5,000 rows. Split it into smaller files." };
  const parsed = rows.map((r, i) => parseRow(r, layout, i + 1));
  const existing = (await fetchAll((from, to) => supabase.from("transactions").select("id,external_id,dedupe_hash,source").eq("account_id", accountId).range(from, to))) as {
    id: string;
    external_id: string | null;
    dedupe_hash: string | null;
    source: string;
  }[];
  const [{ data: rules }, { data: cats }] = await Promise.all([supabase.from("categorization_rules").select("*").order("priority"), supabase.from("categories").select("id,name")]);
  const catName = Object.fromEntries(((cats ?? []) as Row[]).map((c) => [c.id, c.name]));
  const valid = parsed.filter((p) => !p.error).map((p) => ({ ...p, hash: dedupeHash(accountId, p.date!, p.amount!, p.description) }));
  const classified = classifyRows(valid, existing);
  const byRow = Object.fromEntries(classified.map((c) => [c.rowNumber, c]));
  return {
    rows: parsed.map((p) => {
      const c = byRow[p.rowNumber];
      const rule = c ? ((rules ?? []) as Row[]).find((r) => ruleMatches(r, `${merchantFromDescription(p.description)} ${p.description}`)) : undefined;
      return { ...p, status: p.error ? "error" : c.status, category: rule ? catName[rule.category_id] ?? null : null };
    }),
  };
}

/** Saves the column layout (per bank or card), the import batch, the raw rows, and the new transactions. */
export async function commitImport(params: {
  accountId: string;
  fileName: string;
  institution: string;
  layoutName: string;
  layout: ImportLayout & { has_header: boolean };
  rows: Record<string, string>[];
  includeDuplicates: number[];
}): Promise<{ imported: number; duplicates: number; errors: number; batchId: string | null; error?: string }> {
  const { supabase, ownerId } = await requireOwner();
  const preview = await previewImport(params.accountId, params.layout, params.rows);
  if (preview.error) return { imported: 0, duplicates: 0, errors: 0, batchId: null, error: preview.error };

  let layoutId: string | null = null;
  if (params.layoutName.trim()) {
    const fields = {
      owner_id: ownerId,
      name: params.layoutName.trim(),
      institution: params.institution.trim() || params.layoutName.trim(),
      has_header: params.layout.has_header,
      date_column: params.layout.date_column,
      description_column: params.layout.description_column,
      amount_column: params.layout.amount_column || null,
      debit_column: params.layout.debit_column || null,
      credit_column: params.layout.credit_column || null,
      external_id_column: params.layout.external_id_column || null,
      amount_sign: params.layout.amount_sign,
      date_format: params.layout.date_format,
    };
    const { data: existing } = await supabase.from("import_layouts").select("id").eq("name", fields.name).maybeSingle();
    if (existing) {
      await supabase.from("import_layouts").update(fields).eq("id", existing.id);
      layoutId = existing.id;
    } else {
      layoutId = (await supabase.from("import_layouts").insert(fields).select("id").single()).data?.id ?? null;
    }
  }

  const include = new Set(params.includeDuplicates);
  const toImport = preview.rows.filter((r) => r.status === "new" || (r.status === "duplicate" && include.has(r.rowNumber)));
  const duplicates = preview.rows.filter((r) => r.status === "duplicate" && !include.has(r.rowNumber)).length;
  const errors = preview.rows.filter((r) => r.status === "error").length;
  const { data: batch } = await supabase
    .from("import_batches")
    .insert({ owner_id: ownerId, account_id: params.accountId, layout_id: layoutId, file_name: params.fileName, source: "csv", row_count: params.rows.length, imported_count: toImport.length, duplicate_count: duplicates, status: "committed" })
    .select("id")
    .single();
  const batchId = batch?.id ?? null;

  const newIds: string[] = [];
  const merchants = new Map<string, string>();
  for (let i = 0; i < toImport.length; i += 500) {
    const chunk = toImport.slice(i, i + 500).map((r) => {
      const merchant = merchantFromDescription(r.description);
      merchants.set(normalizeDescription(r.description), merchant);
      return {
        owner_id: ownerId,
        account_id: params.accountId,
        date: r.date,
        amount: r.amount,
        description: r.description,
        merchant_name: merchant,
        source: "csv",
        external_id: r.externalId,
        dedupe_hash: dedupeHash(params.accountId, r.date!, r.amount!, r.description),
        import_batch_id: batchId,
      };
    });
    const { data, error } = await supabase.from("transactions").insert(chunk).select("id");
    if (error) return { imported: newIds.length, duplicates, errors, batchId, error: error.message };
    newIds.push(...((data ?? []) as Row[]).map((d) => d.id));
  }
  if (batchId) {
    const raw = params.rows.map((r, i) => {
      const p = preview.rows[i];
      return { owner_id: ownerId, batch_id: batchId, row_number: i + 1, raw: r, parsed: p, status: p.status === "error" ? "error" : p.status === "duplicate" && !include.has(p.rowNumber) ? "duplicate" : "imported" };
    });
    for (let i = 0; i < raw.length; i += 500) await supabase.from("raw_import_rows").insert(raw.slice(i, i + 500));
  }
  const merchantRows = [...merchants.entries()].filter(([n]) => n).map(([normalized_name, name]) => ({ owner_id: ownerId, normalized_name, name }));
  if (merchantRows.length) await supabase.from("merchants").upsert(merchantRows, { onConflict: "owner_id,normalized_name", ignoreDuplicates: true });

  const ctx = await loadCtx(supabase, ownerId);
  await applyCategoryRules(supabase, ownerId, newIds);
  await detectAndSaveRecurring(supabase, ownerId, ctx.today);
  await evaluateConditions(ctx);
  revalidatePath("/", "layout");
  return { imported: newIds.length, duplicates, errors, batchId };
}

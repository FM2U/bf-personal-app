"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { hasUpdate0018 } from "@/lib/update-0018";
import { hasUpdate0019 } from "@/lib/update-0019";
import { loadCtx } from "@/lib/engine/helpers";
import { applyCategoryRules, detectAndSaveRecurring } from "@/lib/engine/finance-jobs";
import { evaluateConditions } from "@/lib/engine/rules";
import { hasUpdate0014 } from "@/lib/update-0014";
import { DB_UPDATE_NOTICE_0014 } from "@/lib/schema-guard";
import { buildSampleData, SAMPLE_SOFTWARE } from "@/lib/sample-data";
import { countRealRecords } from "@/lib/sample-server";
import { EXPORT_COOKIE, exportIsRecent } from "@/lib/reset";
import type { Row } from "@/lib/types";

const PAGE = "/settings/data";

function back(notice: string, extra = ""): never {
  redirect(`${PAGE}?notice=${encodeURIComponent(notice)}${extra}`);
}

async function removeFiles(sb: SupabaseClient, paths: unknown): Promise<number> {
  const list = (Array.isArray(paths) ? paths : []).map(String).filter(Boolean);
  if (!list.length) return 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await sb.storage.from("documents").remove(list.slice(i, i + 100));
    if (error) failed += list.slice(i, i + 100).length;
  }
  return failed;
}

/** Loads the sample data (one transaction), then finds its recurring charges as the morning job would. */
export async function loadSampleData(fd: FormData) {
  const { supabase, ownerId } = await requireOwner();
  if (!(await hasUpdate0014(supabase))) back(DB_UPDATE_NOTICE_0014);
  const { count: already } = await supabase.from("sample_records").select("id", { count: "exact", head: true });
  if (already) back("Sample data is already loaded. Remove it first to load it again.");
  const real = await countRealRecords(supabase);
  if (real.total > 0 && fd.get("confirm_real") !== "on") back(`You have ${real.total} real records. Check "Load sample data next to my real records" to continue.`);

  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: entities }, { data: cats }, { data: budgets }, { data: lines }, { data: pipes }, { data: stages }, { data: inits }, has0019] = await Promise.all([
    supabase.from("entities").select("id,kind,is_default"),
    supabase.from("categories").select("id,name"),
    supabase.from("budgets").select("id").eq("is_active", true).order("created_at").limit(1),
    supabase.from("budget_lines").select("budget_id,category_id"),
    supabase.from("pipelines").select("id,kind"),
    supabase.from("pipeline_stages").select("id,pipeline_id,name"),
    supabase.from("initiatives").select("id,name"),
    hasUpdate0019(supabase),
  ]);
  const ent = (entities ?? []) as Row[];
  // The starter Detailed report template (database update 0017; empty before it).
  const { data: detailedTemplate } = await supabase.from("partner_report_templates").select("id").eq("starter_key", "detailed").maybeSingle();
  const budgetId = ((budgets ?? []) as Row[])[0]?.id ?? null;
  const pipeOf = (kind: string) => {
    const p = ((pipes ?? []) as Row[]).find((x) => x.kind === kind);
    if (!p) return null;
    return { pipelineId: p.id as string, stages: Object.fromEntries(((stages ?? []) as Row[]).filter((s) => s.pipeline_id === p.id).map((s) => [s.name, s.id])) };
  };
  const { batches, counts } = buildSampleData(
    {
      today: ctx.today,
      personalEntityId: (ent.find((e) => e.kind === "personal" && e.is_default) ?? ent.find((e) => e.kind === "personal"))?.id ?? null,
      llcEntityId: ent.find((e) => e.kind === "business")?.id ?? null,
      categories: Object.fromEntries(((cats ?? []) as Row[]).map((c) => [c.name, c.id])),
      budgetId,
      budgetedCategoryIds: ((lines ?? []) as Row[]).filter((l) => l.budget_id === budgetId).map((l) => l.category_id),
      acquisitions: pipeOf("acquisition"),
      consulting: pipeOf("consulting"),
      reportTemplateId: ((detailedTemplate as Row | null)?.id as string | undefined) ?? null,
      dailyReports: await hasUpdate0018(supabase),
      initiatives: has0019 ? Object.fromEntries(((inits ?? []) as Row[]).map((i) => [String(i.name), String(i.id)])) : null,
    },
    () => randomUUID(),
  );
  const batchId = randomUUID();
  const started = new Date(Date.now() - 1000).toISOString();
  const { error } = await supabase.rpc("insert_record_batch", { p_batches: batches, p_actor: "owner", p_sample_batch: batchId });
  if (error) back(`Sample data was not loaded (nothing was saved): ${error.message}`);

  // Recurring charges found in the sample transactions are sample rows too; all but 2 software subscriptions are
  // marked as still used, so those 2 stay flagged as unused.
  await applyCategoryRules(supabase, ownerId).catch(() => 0);
  await detectAndSaveRecurring(supabase, ownerId, ctx.today).catch(() => null);
  const { data: newSeries } = await supabase.from("recurring_series").select("id,merchant_name").gte("created_at", started);
  const seriesRows = (newSeries ?? []) as Row[];
  if (seriesRows.length) {
    await supabase.from("sample_records").insert(seriesRows.map((s) => ({ owner_id: ownerId, table_name: "recurring_series", record_id: s.id, batch_id: batchId })));
    // Every sample software charge except the two "unused" ones is confirmed as used.
    const unused = SAMPLE_SOFTWARE.filter((s) => !s.used).map((s) => s.name);
    const usedIds = seriesRows.filter((s) => !unused.includes(s.merchant_name)).map((s) => s.id);
    if (usedIds.length) await supabase.from("recurring_series").update({ review_status: "in_use" }).in("id", usedIds);
  }
  await evaluateConditions(ctx).catch(() => null);
  revalidatePath("/", "layout");
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  back(`Sample data loaded: ${total} records (${counts.transactions ?? 0} transactions over 12 months, ${counts.accounts ?? 0} accounts, ${counts.contacts ?? 0} contacts, ${counts.pipeline_items ?? 0} pipeline items) and ${seriesRows.length} recurring charges. Every name starts with "Sample".`);
}

/** Deletes only the sample rows and the rows the app made from them (one transaction). */
export async function removeSampleData() {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0014(supabase))) back(DB_UPDATE_NOTICE_0014);
  const { data, error } = await supabase.rpc("remove_sample_data");
  if (error) back(`Sample data was not removed (nothing was deleted): ${error.message}`);
  const failed = await removeFiles(supabase, (data as Row | null)?.storage_paths);
  revalidatePath("/", "layout");
  const total = Number((data as Row | null)?.total ?? 0);
  back(total ? `Sample data removed: ${total} records. Your other records were not changed.${failed ? ` ${failed} document files could not be removed from storage.` : ""}` : "There was no sample data to remove.");
}

/**
 * "Reset all data": needs the full export downloaded in this browser session (within 2 hours) and RESET typed.
 * One database function deletes every record you created or imported and keeps the setup, all or nothing.
 */
export async function resetAllData(fd: FormData) {
  const { supabase } = await requireOwner();
  if (!(await hasUpdate0014(supabase))) back(DB_UPDATE_NOTICE_0014);
  const jar = await cookies();
  if (!exportIsRecent(jar.get(EXPORT_COOKIE)?.value)) back("Step 1 first: download the full export in this session. Nothing was deleted.");
  if (String(fd.get("confirm") ?? "").trim() !== "RESET") back("Type RESET in capital letters to confirm. Nothing was deleted.");
  const { data, error } = await supabase.rpc("reset_all_data", { p_confirm: "RESET" });
  if (error) back(`Nothing was deleted: ${error.message}`);
  const failed = await removeFiles(supabase, (data as Row | null)?.storage_paths);
  jar.delete(EXPORT_COOKIE);
  revalidatePath("/", "layout");
  redirect(`${PAGE}?reset=done${failed ? `&files_failed=${failed}` : ""}#reset`);
}

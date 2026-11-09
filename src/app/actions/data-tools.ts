"use server";
import { forgetKeptSettings } from "@/lib/kept-settings";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { documentPath } from "@/lib/documents";
import { loadPipelineOfKind, loadWorkPipeline } from "@/lib/work/data";
import type { WorkSample } from "@/lib/work/sample";
import { loadCtx } from "@/lib/engine/helpers";
import { ensureDefaultTargets } from "@/lib/accountability/data";
import { buildSampleData } from "@/lib/sample-data";
import { countRealRecords } from "@/lib/sample-server";
import type { Row } from "@/lib/types";
import { signOffName } from "@/lib/work/names";
import { parseDay, WORK_SETTING_KEYS } from "@/lib/work/settings";

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

/** Loads the Work module's sample data (one transaction), then dates the stages and adds the sample documents. */
export async function loadSampleData(fd: FormData) {
  // Speed plan (2026-11-07): the settings kept in the browser are read fresh on the next page.
  await forgetKeptSettings();
  const { supabase, ownerId } = await requireOwner();
  const { count: already } = await supabase.from("sample_records").select("id", { count: "exact", head: true });
  if (already) back("Sample data is already loaded. Remove it first to load it again.");
  const real = await countRealRecords(supabase);
  if (real.total > 0 && fd.get("confirm_real") !== "on") back(`You have ${real.total} real records. Check "Load sample data next to my real records" to continue.`);

  const ctx = await loadCtx(supabase, ownerId);
  const [deals, jobs, consulting] = await Promise.all([loadWorkPipeline(supabase, ownerId), loadPipelineOfKind(supabase, ownerId, "job"), loadPipelineOfKind(supabase, ownerId, "consulting")]);
  if (!deals) back("The acquisition pipeline is missing, so sample data was not loaded.");
  const stagesOf = (p: NonNullable<typeof deals>) => Object.fromEntries(p.stages.map((st) => [st.name, st.id]));
  const { batches, counts, work } = buildSampleData(
    {
      pipelineId: deals!.id,
      stages: stagesOf(deals!),
      batchB: true,
      batchB2: true,
      batchC: true,
      personalNetwork: true,
      jobs: jobs ? { pipelineId: jobs.id, stages: stagesOf(jobs) } : null,
      consulting: consulting ? { pipelineId: consulting.id, stages: stagesOf(consulting) } : null,
      tz: ctx.tz,
      signName: signOffName(ctx.profile?.display_name),
    },
    () => randomUUID(),
    ctx.today,
  );
  // A day that already has your own End of day (for example a test report you sent) keeps it: the sample skips that
  // day instead of failing on the one-day-one-record rule.
  const { data: ownDays } = await supabase.from("end_of_day").select("day").eq("owner_id", ownerId);
  const taken = new Set((ownDays ?? []).map((d) => String(d.day)));
  // Push D: the same for a month that already has your own monthly review.
  const { data: ownMonths } = await supabase.from("monthly_reviews").select("month").eq("owner_id", ownerId);
  const takenMonths = new Set((ownMonths ?? []).map((d) => String(d.month).slice(0, 10)));
  const toInsert = batches
    .map((bt) => (bt.table === "end_of_day" && taken.size ? { ...bt, rows: bt.rows.filter((r) => !taken.has(String((r as Row).day))) } : bt))
    .map((bt) => (bt.table === "monthly_reviews" && takenMonths.size ? { ...bt, rows: bt.rows.filter((r) => !takenMonths.has(String((r as Row).month))) } : bt));
  const batchId = randomUUID();
  const { error } = await supabase.rpc("insert_record_batch", { p_batches: toInsert, p_actor: "owner", p_sample_batch: batchId });
  if (error) back(`Sample data was not loaded (nothing was saved): ${error.message}`);
  const stageIds = Object.fromEntries([deals!, jobs, consulting].filter(Boolean).flatMap((p) => p!.stages.map((st) => [st.name, st.id])));
  await finishWorkSample(supabase, ownerId, ctx.today, work, stageIds);
  // The six default targets come with the sample (when no target counts yet), so the first End of day, Targets, or
  // Reports visit after loading reads them instead of making them during the page.
  await ensureDefaultTargets(supabase, ownerId);
  revalidatePath("/", "layout");
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  back(`Sample data loaded: ${total} records (${counts.pipeline_items ?? 0} listings, deals, opportunities and clients, ${counts.contacts ?? 0} people, ${counts.deal_todos ?? 0} to-dos).`);
}

/**
 * The Work module's sample deals (database update 0020): stage entry dates in the past (the insert stamps "now"),
 * the earlier stages in stage_history, Dalton Services' two small documents in storage, and (database update 0021)
 * the Tasks items (deals; batch B adds tasks on people, which carry record_type contacts). Sample removal deletes
 * stage history, documents, and tasks with the sample deals and people, so nothing here needs its own marker.
 */
async function finishWorkSample(sb: SupabaseClient, ownerId: string, today: string, work: Pick<WorkSample, "stageDates" | "documents" | "todos" | "noteDates" | "noActionItems">, stageIds: Record<string, string>) {
  const at = (daysAgo: number, hour: number) => `${addDaysISO(today, -daysAgo)}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  if (work.todos.length) await sb.from("deal_todos").insert(work.todos.map((t) => ({ ...t, owner_id: ownerId })));
  // The notes and findings on the sample projects carry their dates (batch B2).
  for (const n of work.noteDates) await sb.from("notes").update({ created_at: at(n.daysAgo, 15) }).eq("id", n.noteId);
  // An item meant to start without a next action (the stage trigger filled the default on insert).
  if (work.noActionItems.length) await sb.from("pipeline_items").update({ next_action: null, next_action_due: null }).in("id", work.noActionItems);
  // Items with no earlier stages (the passed listings of the screening weeks, Edit batch C) are dated in one update
  // per day, so the load stays quick with a hundred of them.
  const single = new Map<number, string[]>();
  for (const d of work.stageDates) if (!d.history.length) single.set(d.enteredDaysAgo, [...(single.get(d.enteredDaysAgo) ?? []), d.itemId]);
  for (const [daysAgo, ids] of single) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await sb.from("pipeline_items").update({ stage_entered_at: at(daysAgo, 14) }).in("id", chunk);
      await sb.from("stage_history").update({ entered_at: at(daysAgo, 14) }).in("item_id", chunk).is("exited_at", null);
    }
  }
  for (const d of work.stageDates) {
    if (!d.history.length) continue;
    await sb.from("pipeline_items").update({ stage_entered_at: at(d.enteredDaysAgo, 14) }).eq("id", d.itemId);
    await sb.from("stage_history").update({ entered_at: at(d.enteredDaysAgo, 14) }).eq("item_id", d.itemId).is("exited_at", null);
    if (d.history.length) {
      await sb.from("stage_history").insert(
        d.history.map((h, i) => ({ owner_id: ownerId, item_id: d.itemId, stage_id: stageIds[h.stageName] ?? null, entered_at: at(h.daysAgo, 13), exited_at: at(i + 1 < d.history.length ? d.history[i + 1].daysAgo : d.enteredDaysAgo, 14) })),
      );
    }
  }
  for (const doc of work.documents) {
    const path = documentPath(ownerId, "pipeline_items", doc.itemId, doc.fileName, Date.now());
    const bytes = doc.mimeType === "application/pdf" ? await samplePdf(doc.text) : Buffer.from(doc.text, "utf8");
    // The same two steps as the Documents card (a signed upload address, then the file), which every storage setup allows.
    const { data: signed, error: signErr } = await sb.storage.from("documents").createSignedUploadUrl(path);
    if (signErr || !signed?.token) continue;
    const { error } = await sb.storage.from("documents").uploadToSignedUrl(path, signed.token, bytes, { contentType: doc.mimeType });
    if (error) continue;
    await sb.from("documents").insert({ owner_id: ownerId, record_type: "pipeline_items", record_id: doc.itemId, storage_path: path, file_name: doc.fileName, mime_type: doc.mimeType, size_bytes: bytes.length, kind: doc.kind, description: "Sample document" });
  }
}

/** A one-page PDF with the given text (pdf-lib, already a dependency for the report PDF). */
async function samplePdf(text: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 80) {
      lines.push(line.trim());
      line = w;
    } else line = `${line} ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  lines.forEach((l, i) => page.drawText(l, { x: 54, y: 740 - i * 16, size: 11, font }));
  return Buffer.from(await pdf.save());
}

/** Deletes only the sample rows and the rows the app made from them (one transaction). */
/**
 * End of day days to clear with the sample: days from the day the sample was loaded onward on which no report went to a
 * real (not sample) partner. What was typed or sent while testing on the sample goes with it; a day with a report to a
 * real partner, and every day before the sample was loaded, is kept.
 */
async function testDaysToClear(sb: SupabaseClient, ownerId: string): Promise<string[]> {
  const { data: first } = await sb.from("sample_records").select("created_at").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(1);
  const loadedAt = first?.[0]?.created_at as string | undefined;
  if (!loadedAt) return [];
  const { tz } = await loadCtx(sb, ownerId);
  const fromDay = todayInTz(tz, new Date(loadedAt));
  const { data: sampleContacts } = await sb.from("sample_records").select("record_id").eq("owner_id", ownerId).eq("table_name", "contacts");
  const sampleIds = new Set((sampleContacts ?? []).map((r) => String(r.record_id)));
  const { data: sends } = await sb.from("change_log").select("new_value").eq("owner_id", ownerId).eq("field", "email_sent").eq("new_value->>kind", "end_of_day");
  // A report counts as sent to a real partner only if that person still exists and is not sample data: a partner from
  // an earlier sample load was deleted with it and does not make the day real.
  const sentTo = [...new Set((sends ?? []).map((r) => String((r.new_value as Row)?.contact_id ?? "")).filter(Boolean))];
  const { data: alive } = sentTo.length ? await sb.from("contacts").select("id").eq("owner_id", ownerId).in("id", sentTo) : { data: [] };
  const realIds = new Set((alive ?? []).map((c) => String(c.id)).filter((id) => !sampleIds.has(id)));
  const realDays = new Set((sends ?? []).map((r) => r.new_value as Row).filter((v) => v?.contact_id && realIds.has(String(v.contact_id))).map((v) => String(v.day)));
  const { data: days } = await sb.from("end_of_day").select("day").eq("owner_id", ownerId).gte("day", fromDay);
  return (days ?? []).map((d) => String(d.day)).filter((d) => !realDays.has(d));
}

/** Sets Counting starts on (Settings, Work settings) to today when it is not set yet; a date already saved stays. */
async function startCountingToday(sb: SupabaseClient, ownerId: string): Promise<void> {
  const def = WORK_SETTING_KEYS.countingStart;
  const { data } = await sb.from("inputs").select("id,value_text").eq("owner_id", ownerId).eq("key", def.key).maybeSingle();
  const row = data as { id: string; value_text: string | null } | null;
  if (row && parseDay(row.value_text)) return;
  const { today } = await loadCtx(sb, ownerId);
  if (row) await sb.from("inputs").update({ value_text: today }).eq("id", row.id);
  else await sb.from("inputs").insert({ owner_id: ownerId, key: def.key, label: def.label, category: "Work", unit: def.unit, description: def.description, value_text: today });
}

export async function removeSampleData() {
  // Speed plan (2026-11-07): the settings kept in the browser are read fresh on the next page.
  await forgetKeptSettings();
  const { supabase, user } = await requireOwner();
  const clearDays = await testDaysToClear(supabase, user.id);
  const { data, error } = await supabase.rpc("remove_sample_data");
  if (error) back(`Sample data was not removed (nothing was deleted): ${error.message}`);
  const failed = await removeFiles(supabase, (data as Row | null)?.storage_paths);
  let cleared = 0;
  if (clearDays.length) {
    const { data: gone } = await supabase.from("end_of_day").delete().eq("owner_id", user.id).in("day", clearDays).select("id");
    cleared = gone?.length ?? 0;
  }
  const total = Number((data as Row | null)?.total ?? 0);
  // Counting starts on (Bram, 2026-11-09): real use starts now, so targets count from today, unless a date is set.
  if (total) await startCountingToday(supabase, user.id);
  revalidatePath("/", "layout");
  const days = cleared ? ` End of day was reset for ${cleared === 1 ? "1 test day" : `${cleared} test days`}.` : "";
  back(total ? `Sample data removed: ${total} records.${days} Your other records were not changed.${failed ? ` ${failed} document files could not be removed from storage.` : ""}` : "There was no sample data to remove.");
}

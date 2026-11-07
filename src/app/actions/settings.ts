"use server";
import { forgetKeptSettings } from "@/lib/kept-settings";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { connectionChecks } from "@/lib/jobs";
import { oauthClient } from "@/lib/google";
import { decrypt } from "@/lib/crypto";
import { cleanStageDefaults, cleanWorkSettings, WORK_SETTING_KEYS, type StageDefaultInput } from "@/lib/work/settings";

export async function disconnectGoogle() {
  const { supabase, ownerId } = await requireOwner();
  const { data } = await supabase.from("google_connections").select("refresh_token_enc").eq("owner_id", ownerId).maybeSingle();
  if (data?.refresh_token_enc) {
    try {
      await oauthClient().revokeToken(decrypt(data.refresh_token_enc));
    } catch {
      // The token may already be invalid; the saved copy is removed either way.
    }
  }
  await supabase.from("google_connections").update({ status: "disconnected", refresh_token_enc: null, last_error: null }).eq("owner_id", ownerId);
  revalidatePath("/", "layout");
}

export async function saveProfile(fd: FormData) {
  // Speed plan (2026-11-07): the settings kept in the browser are read fresh on the next page.
  await forgetKeptSettings();
  const { supabase, ownerId } = await requireOwner();
  const tz = String(fd.get("timezone") ?? "America/New_York");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error("Time zone not recognized. Example: America/New_York");
  }
  await supabase
    .from("owner_profile")
    .update({
      display_name: String(fd.get("display_name") ?? "") || null,
      timezone: tz,
      morning_hour: Number(fd.get("morning_hour") ?? 7),
      evening_hour: Number(fd.get("evening_hour") ?? 20),
      weekly_review_weekday: Number(fd.get("weekly_review_weekday") ?? 0),
    })
    .eq("owner_id", ownerId);
  revalidatePath("/", "layout");
}

/** Runs the scheduled morning job now (same steps as the daily cron). */
/** Runs the daily checks (Google connection, Anthropic key) now instead of waiting for the morning job. */
export async function runChecksNow() {
  const { supabase, ownerId } = await requireOwner();
  await connectionChecks(supabase, ownerId);
  revalidatePath("/", "layout");
}

// ---------- Push D: the one Settings page (Work settings, Pipelines and stage defaults, AI) ----------

type Fail = { ok: false; error: string };

/** One settings row (table inputs) by key: updated when it exists, added otherwise. */
async function putInput(sb: SupabaseClient, ownerId: string, def: { key: string; label: string; unit: string; description: string }, value: { value_number?: number | null; value_text?: string | null }, category = "Work"): Promise<string | null> {
  const { data } = await sb.from("inputs").select("id").eq("owner_id", ownerId).eq("key", def.key).maybeSingle();
  const { error } = data
    ? await sb.from("inputs").update(value).eq("id", (data as { id: string }).id)
    : await sb.from("inputs").insert({ owner_id: ownerId, key: def.key, label: def.label, category, unit: def.unit, description: def.description, ...value });
  return error ? error.message : null;
}

/** Work settings: waiting turns amber at (days), No reply yet after (days; push E), the weekly outreach target, the End of day time, the default block length. */
export async function saveWorkSettings(input: { threshold: string; noReply: string; outreach: string; eodTime: string; blockMinutes: string }): Promise<{ ok: true } | Fail> {
  // Speed plan (2026-11-07): the settings kept in the browser are read fresh on the next page.
  await forgetKeptSettings();
  const { supabase, ownerId } = await requireOwner();
  const c = cleanWorkSettings(input);
  if (!c.ok) return c;
  const v = c.value;
  for (const [def, value] of [
    [WORK_SETTING_KEYS.threshold, { value_number: v.threshold }],
    [WORK_SETTING_KEYS.noReply, { value_number: v.noReply }],
    [WORK_SETTING_KEYS.outreach, { value_number: v.outreach }],
    [WORK_SETTING_KEYS.eodTime, { value_text: v.eodTime }],
  ] as const) {
    const err = await putInput(supabase, ownerId, def, value);
    if (err) return { ok: false, error: `Not saved: ${err}` };
  }
  const { error } = await supabase.from("owner_profile").update({ default_block_minutes: v.blockMinutes }).eq("owner_id", ownerId);
  if (error) return { ok: false, error: `Not saved: ${error.message}` };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Pipelines and stage defaults: for each stage of one pipeline, the default next action (the stage's next action
 * default task; a blank text removes it), when it is due (days after the record enters the stage), and the time limit
 * in the stage (blank for none).
 */
export async function saveStageDefaults(pipelineId: string, rows: StageDefaultInput[]): Promise<{ ok: true; saved: number } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  if (!/^[0-9a-f-]{36}$/i.test(String(pipelineId ?? ""))) return { ok: false, error: "That pipeline was not found." };
  const { data: stages } = await supabase.from("pipeline_stages").select("id,name,max_days_in_stage").eq("owner_id", ownerId).eq("pipeline_id", pipelineId);
  const list = (stages ?? []) as { id: string; name: string; max_days_in_stage: number | null }[];
  if (!list.length) return { ok: false, error: "That pipeline was not found." };
  const c = cleanStageDefaults(rows, Object.fromEntries(list.map((s) => [s.id, s.name])));
  if (!c.ok) return c;
  const { data: tasks } = await supabase.from("stage_tasks").select("id,pipeline_stage_id,title,due_in_days,sort_order").eq("owner_id", ownerId).eq("is_next_action_default", true).in("pipeline_stage_id", list.map((s) => s.id));
  const existing = (tasks ?? []) as { id: string; pipeline_stage_id: string; title: string; due_in_days: number; sort_order: number }[];
  let saved = 0;
  for (const r of c.rows) {
    const stage = list.find((s) => s.id === r.stageId)!;
    const task = [...existing].sort((a, b) => a.sort_order - b.sort_order).find((t) => t.pipeline_stage_id === r.stageId);
    if (r.timeLimit !== undefined && (stage.max_days_in_stage ?? null) !== r.timeLimit) {
      const { error } = await supabase.from("pipeline_stages").update({ max_days_in_stage: r.timeLimit }).eq("id", stage.id);
      if (error) return { ok: false, error: `Not saved: ${error.message}` };
      saved++;
    }
    if (!r.title) {
      if (task) {
        await supabase.from("stage_tasks").update({ is_next_action_default: false }).eq("id", task.id);
        saved++;
      }
      continue;
    }
    if (task && task.title === r.title && Number(task.due_in_days) === r.dueInDays) continue;
    const { error } = task
      ? await supabase.from("stage_tasks").update({ title: r.title, due_in_days: r.dueInDays }).eq("id", task.id)
      : await supabase.from("stage_tasks").insert({ owner_id: ownerId, pipeline_stage_id: r.stageId, title: r.title, due_in_days: r.dueInDays, sort_order: 1, is_next_action_default: true });
    if (error) return { ok: false, error: `Not saved: ${error.message}` };
    saved++;
  }
  revalidatePath("/", "layout");
  return { ok: true, saved };
}

/** AI: the monthly cap in dollars (the server cap still applies when it is lower). */
export async function saveAiCap(cap: string): Promise<{ ok: true } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const n = Number(String(cap ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1000) return { ok: false, error: "The monthly cap must be a dollar amount from 0 to 1000." };
  const err = await putInput(supabase, ownerId, { key: "ai_monthly_cap_usd", label: "AI monthly cap", unit: "usd", description: "The AI stops for the rest of the month when its cost reaches this amount." }, { value_number: Math.round(n * 100) / 100 }, "AI");
  if (err) return { ok: false, error: `Not saved: ${err}` };
  revalidatePath("/", "layout");
  return { ok: true };
}

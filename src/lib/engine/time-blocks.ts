import "server-only";
/**
 * Time block suggestions and approval (database side). Rules and keys: src/lib/time-blocks.ts.
 * - suggestTimeBlocks: the morning job and "Suggest blocks now". Today's waiting suggestions are replaced by a fresh
 *   set; approved and deleted blocks stay. Nothing is sent to Google Calendar.
 * - approveTimeBlock: creates the Google Calendar event for one suggestion, then marks it approved.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCalendarEvent, localDateTime } from "@/lib/google";
import { approvalPatch, blockState, blockTitle, dismissalPatch, parseBlockKey, planBlocks, suggestKey, type BlockState } from "@/lib/time-blocks";
import type { Ctx } from "@/lib/engine/helpers";
import type { Row } from "@/lib/types";

/** Minutes after midnight of a timestamp, in the owner's time zone. */
export function localMinutes(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

const at = (date: string, min: number, tz: string) => localDateTime(date, Math.floor(min / 60), min % 60, tz);

/** Today's time block rows (every state), oldest first. */
export async function loadTodaysBlocks(sb: SupabaseClient, ownerId: string, today: string): Promise<(Row & { state: BlockState })[]> {
  const { data } = await sb.from("calendar_events").select("*").eq("owner_id", ownerId).eq("kind", "time_block").or(`dedupe_key.like.*:${today},dedupe_key.is.null`).order("starts_at");
  return ((data ?? []) as Row[])
    .filter((r) => r.dedupe_key || String(r.starts_at ?? "").slice(0, 10) === today)
    .map((r) => ({ ...r, state: blockState(r) }));
}

/** Replaces today's waiting suggestions with a fresh set for the current priority tasks. Returns how many were suggested. */
export async function suggestTimeBlocks(ctx: Ctx, inputs: Record<string, number | null>): Promise<{ suggested: number }> {
  const { sb, ownerId, today, tz, profile } = ctx;
  const count = Math.max(0, Math.round(inputs.time_blocks_per_day ?? 2));
  const minutes = Math.max(15, Math.round(inputs.time_block_minutes ?? 60));
  const existing = await loadTodaysBlocks(sb, ownerId, today);
  const waiting = existing.filter((r) => r.state === "suggested");
  if (waiting.length) await sb.from("calendar_events").delete().in("id", waiting.map((r) => r.id));
  if (!count) return { suggested: 0 };
  const { data } = await sb.from("tasks").select("id,title,priority,due_date").eq("owner_id", ownerId).eq("status", "todo").lte("due_date", today).order("priority").order("due_date").limit(40);
  const taken = existing
    .filter((r) => r.state === "approved" || r.state === "dismissed")
    .map((r) => ({ taskId: parseBlockKey(r.dedupe_key)?.taskId ?? String(r.task_id ?? ""), state: r.state, endMin: r.state === "approved" ? localMinutes(r.ends_at, tz) : null }));
  const plan = planBlocks({ tasks: ((data ?? []) as Row[]).map((t) => ({ id: t.id, title: t.title })), count, minutes, startMin: (Number(profile.morning_hour ?? 7) + 2) * 60, taken });
  let suggested = 0;
  for (const b of plan) {
    const { error } = await sb.from("calendar_events").insert({
      owner_id: ownerId,
      title: blockTitle(b.title),
      starts_at: at(today, b.startMin, tz),
      ends_at: at(today, b.endMin, tz),
      kind: "time_block",
      task_id: b.taskId,
      google_event_id: null,
      dedupe_key: suggestKey(b.taskId, today),
    });
    if (!error) suggested++;
  }
  return { suggested };
}

export type BlockResult = { ok: true; message: string } | { ok: false; error: string };

/** Approve: create the event in Google Calendar, then mark the block approved. */
export async function approveTimeBlock(ctx: Ctx, id: string): Promise<BlockResult> {
  const { sb, ownerId, today } = ctx;
  const { data: row } = await sb.from("calendar_events").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "This time block was not found. It may have been deleted." };
  if (blockState(row as Row) === "approved") return { ok: true, message: "Already in Google Calendar." };
  let googleId: string | null = null;
  try {
    googleId = await createCalendarEvent(sb, ownerId, { summary: row.title, start: row.starts_at, end: row.ends_at, description: "Priority task time block from BF Personal App (approved)." });
  } catch (e) {
    return { ok: false, error: `Google Calendar did not accept the event: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!googleId) return { ok: false, error: "Google is not connected. Connect Google in Settings, Connections, then approve again." };
  const { error } = await sb.from("calendar_events").update(approvalPatch(row as Row, googleId, today)).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (row.task_id) await sb.from("tasks").update({ google_event_id: googleId }).eq("id", row.task_id);
  return { ok: true, message: "Added to Google Calendar." };
}

/** Delete a suggestion (kept hidden so it is not suggested again today). A manual block is deleted. */
export async function deleteTimeBlock(ctx: Ctx, id: string): Promise<BlockResult> {
  const { sb } = ctx;
  const { data: row } = await sb.from("calendar_events").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: true, message: "Deleted." };
  if (blockState(row as Row) === "approved") return { ok: false, error: "This block is already in Google Calendar. Delete it there." };
  const patch = dismissalPatch(row as Row);
  const { error } = patch ? await sb.from("calendar_events").update(patch).eq("id", id) : await sb.from("calendar_events").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Suggestion deleted." };
}

/** Edit a suggestion's start time and length (minutes). */
export async function editTimeBlock(ctx: Ctx, id: string, startMin: number, minutes: number): Promise<BlockResult> {
  const { sb, today, tz } = ctx;
  if (!Number.isFinite(startMin) || startMin < 0 || startMin > 23 * 60 + 45) return { ok: false, error: "Choose a start time." };
  const len = Math.max(15, Math.min(240, Math.round(minutes)));
  const end = Math.min(23 * 60 + 59, startMin + len);
  const { data: row } = await sb.from("calendar_events").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "This time block was not found." };
  if (blockState(row as Row) === "approved") return { ok: false, error: "This block is already in Google Calendar. Change it there." };
  const date = parseBlockKey(row.dedupe_key)?.date ?? today;
  const { error } = await sb.from("calendar_events").update({ starts_at: at(date, startMin, tz), ends_at: at(date, end, tz) }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Saved." };
}

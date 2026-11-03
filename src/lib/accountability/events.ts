import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/schema-guard";

/**
 * A work event (database update 0025): what the Targets count that no other table records. Written by Done on a next
 * action (deals, projects, job and consulting items), Done on a follow-up (with whether it was on or before its
 * date), and the Rosara weekly focus marked done. Before update 0025 the insert fails with "does not exist" and is
 * skipped: the action that called it still succeeds.
 */
type WorkEventInput = {
  kind: "next_action_done" | "follow_up_done" | "focus_done";
  recordType: string | null;
  recordId: string | null;
  label: string | null;
  /** The owner's local date (YYYY-MM-DD). */
  on: string;
  onTime?: boolean | null;
  meta?: Record<string, unknown>;
};

export async function recordWorkEvent(sb: SupabaseClient, ownerId: string, e: WorkEventInput): Promise<boolean> {
  const { error } = await sb.from("work_events").insert({
    owner_id: ownerId,
    kind: e.kind,
    record_type: e.recordType,
    record_id: e.recordId,
    label: e.label ? String(e.label).slice(0, 300) : null,
    happened_on: e.on,
    on_time: e.onTime ?? null,
    meta: e.meta ?? {},
  });
  if (error && !isMissingSchemaError(error)) return false;
  return !error;
}

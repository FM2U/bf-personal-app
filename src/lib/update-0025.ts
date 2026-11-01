import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0025 } from "@/lib/schema-guard";

/**
 * True when database update 0025 (batch C: targets.counts_key and archived_at, work_events, end_of_day, End of day
 * reports as partner reports) is applied (its check function answers true). Any error counts as not applied: the
 * three Accountability screens and the Home tile show the update notice naming UPDATE_0025_RUN_ONCE.sql, and Done
 * records no work event; nothing else changes.
 */
export async function hasUpdate0025(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0025);
  return !error && data === true;
}

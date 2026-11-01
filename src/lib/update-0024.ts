import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0024 } from "@/lib/schema-guard";

/**
 * True when database update 0024 (Edit batch B: Broker call after CIM review in the acquisition stages, the NDA
 * signed default "Ask the broker for the CIM") is applied (its check function answers true). Any error counts as not
 * applied: the Work screens show the update notice naming UPDATE_0024_RUN_ONCE.sql, nothing else changes.
 */
export async function hasUpdate0024(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0024);
  return !error && data === true;
}

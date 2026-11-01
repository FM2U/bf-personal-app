import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0023 } from "@/lib/schema-guard";

/**
 * True when database update 0023 (batch B2: findings with a source link on the timeline, the pay range of a job
 * opportunity) is applied (its check function answers true). Any error counts as not applied: the Work screens show
 * the update notice naming UPDATE_0023_RUN_ONCE.sql, nothing else changes.
 */
export async function hasUpdate0023(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0023);
  return !error && data === true;
}

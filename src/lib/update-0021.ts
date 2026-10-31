import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0021 } from "@/lib/schema-guard";

/**
 * True when database update 0021 (Edit batch A: company name, open questions as groups, the Also to do checklist,
 * Follow up) is applied (its check function answers true). Any error counts as not applied: the Work screens show
 * the update notice naming UPDATE_0021_RUN_ONCE.sql, nothing else changes.
 */
export async function hasUpdate0021(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0021);
  return !error && data === true;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0028 } from "@/lib/schema-guard";

/**
 * True when database update 0028 (AI instructions and Findings: strengths and risks on deals, the three Buy box
 * settings) is applied (its check function answers true). Any error counts as not applied: the Findings card shows the
 * update line naming UPDATE_0028_RUN_ONCE.sql under Strengths and Risks; nothing else changes.
 */
export async function hasUpdate0028(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0028);
  return !error && data === true;
}

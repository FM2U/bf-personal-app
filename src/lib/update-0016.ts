import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0016 } from "@/lib/schema-guard";

/**
 * True when database update 0016 (deal funnel) is applied (its check function answers true). Any error counts as
 * not applied, so the deal funnel shows "Database update needed" and nothing else changes.
 */
export async function hasUpdate0016(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0016);
  return !error && data === true;
}

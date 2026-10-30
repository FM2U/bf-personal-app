import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0019 } from "@/lib/schema-guard";

/**
 * True when database update 0019 (Today, Close the day, waiting on) is applied (its check function answers true).
 * Any error counts as not applied: Today shows the update notice, nothing else changes.
 */
export async function hasUpdate0019(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0019);
  return !error && data === true;
}

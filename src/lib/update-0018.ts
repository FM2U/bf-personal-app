import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0018 } from "@/lib/schema-guard";

/**
 * True when database update 0018 (Done late, daily partner reports) is applied (its check function answers true).
 * Any error counts as not applied: Done late shows the update notice, no daily report is drafted, nothing else changes.
 */
export async function hasUpdate0018(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0018);
  return !error && data === true;
}

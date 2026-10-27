import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0014 } from "@/lib/schema-guard";

/**
 * True when database update 0014 is applied (its check function answers true). Any error counts as not applied,
 * so features from 0014 show "Database update needed" and nothing else changes.
 */
export async function hasUpdate0014(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0014);
  return !error && data === true;
}

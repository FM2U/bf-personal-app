import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0020 } from "@/lib/schema-guard";

/**
 * True when database update 0020 (the Work module) is applied (its check function answers true).
 * Any error counts as not applied: the Work screens show the update notice, nothing else changes.
 */
export async function hasUpdate0020(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0020);
  return !error && data === true;
}

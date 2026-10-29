import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0017 } from "@/lib/schema-guard";

/**
 * True when database update 0017 (partner report templates) is applied (its check function answers true). Any error
 * counts as not applied: reports then use the starter templates from the code and nothing else changes.
 */
export async function hasUpdate0017(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0017);
  return !error && data === true;
}

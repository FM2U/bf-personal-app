import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0029 } from "@/lib/schema-guard";

/**
 * True when database update 0029 (AI instructions revision 1: growth paths and financing on deals, the editable Buy box
 * settings) is applied (its check function answers true). Any error counts as not applied: the Findings card shows the
 * update line naming UPDATE_0029_RUN_ONCE.sql under Growth paths, and Facts has no Financing field; nothing else changes.
 */
export async function hasUpdate0029(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0029);
  return !error && data === true;
}

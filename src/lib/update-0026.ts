import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0026 } from "@/lib/schema-guard";

/**
 * True when database update 0026 (Edit batch C round 2: the outreach role "Former colleague" renamed "Personal
 * network", existing contacts moved over by UPDATE) is applied (its check function answers true). Any error counts as
 * not applied: Outreach shows the update line naming UPDATE_0026_RUN_ONCE.sql, and Personal network is saved under the
 * old key (it reads back as Personal network); nothing else changes.
 */
export async function hasUpdate0026(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0026);
  return !error && data === true;
}

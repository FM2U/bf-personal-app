import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBE_0022 } from "@/lib/schema-guard";

/**
 * True when database update 0022 (batch B: Outreach fields on contacts, call fields and incoming replies on
 * communications, personal to-dos, tasks on any record, projects, the Job search and Consulting stages) is applied
 * (its check function answers true). Any error counts as not applied: the Work screens show the update notice
 * naming UPDATE_0022_RUN_ONCE.sql, nothing else changes.
 */
export async function hasUpdate0022(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc(PROBE_0022);
  return !error && data === true;
}

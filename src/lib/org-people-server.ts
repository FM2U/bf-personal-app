import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newContactRows, type OrgPeoplePlan } from "@/lib/org-people";
import { DB_UPDATE_NOTICE_0011, isCheckViolation } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";

/** Contact ids linked to the organization now. */
export async function linkedContactIds(sb: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data } = await sb.from("contacts").select("id").eq("organization_id", organizationId);
  return ((data ?? []) as Row[]).map((r) => r.id);
}

/**
 * Applies the people plan for an organization: links chosen contacts, unlinks removed ones (the contact is kept),
 * and adds new people linked to it. Returns an error message, or null when everything was saved.
 */
export async function applyOrgPeople(sb: SupabaseClient, ownerId: string, organizationId: string, plan: OrgPeoplePlan): Promise<string | null> {
  if (plan.link.length) {
    const { error } = await sb.from("contacts").update({ organization_id: organizationId }).in("id", plan.link);
    if (error) return error.message;
  }
  if (plan.unlink.length) {
    const { error } = await sb.from("contacts").update({ organization_id: null }).in("id", plan.unlink).eq("organization_id", organizationId);
    if (error) return error.message;
  }
  if (plan.create.length) {
    const { error } = await sb.from("contacts").insert(newContactRows(plan.create, organizationId, ownerId));
    // Relationship groups Friend and Other need update 0012.
    if (error) return isCheckViolation(error) ? DB_UPDATE_NOTICE_0011 : error.message;
  }
  return null;
}

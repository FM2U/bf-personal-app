"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { ORG_PEOPLE_FIELD, parseOrgPeople, planOrgPeople } from "@/lib/org-people";
import { applyOrgPeople, linkedContactIds } from "@/lib/org-people-server";

/** Organization page, "Add people": links existing contacts and adds new people. Nothing is unlinked here. */
export async function addOrgPeople(fd: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const orgId = String(fd.get("organization_id") ?? "");
  const draft = parseOrgPeople(String(fd.get(ORG_PEOPLE_FIELD) ?? ""));
  if (!orgId || !draft) return { ok: false, error: "Nothing to add." };
  if (!draft.linked.length && !draft.added.length) return { ok: false, error: "Choose a contact or type a new person's name first." };
  const { supabase, ownerId } = await requireOwner();
  const plan = planOrgPeople(await linkedContactIds(supabase, orgId), draft, { addOnly: true });
  if ("error" in plan) return { ok: false, error: plan.error };
  const error = await applyOrgPeople(supabase, ownerId, orgId, plan);
  if (error) return { ok: false, error };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Organization page: unlinks one person (the contact is kept, only its organization is cleared). */
export async function unlinkOrgPerson(fd: FormData): Promise<void> {
  const orgId = String(fd.get("organization_id") ?? "");
  const contactId = String(fd.get("contact_id") ?? "");
  if (!orgId || !contactId) return;
  const { supabase } = await requireOwner();
  await supabase.from("contacts").update({ organization_id: null }).eq("id", contactId).eq("organization_id", orgId);
  revalidatePath("/", "layout");
}

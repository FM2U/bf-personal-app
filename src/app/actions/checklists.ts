"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";

/** Check or uncheck one item (one click). */
export async function toggleChecklistItem(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const checked = String(fd.get("checked") ?? "") === "true";
  await supabase.from("checklist_items").update({ checked }).eq("id", id);
  revalidatePath("/", "layout");
}

/** Add an item at the end of the list. */
export async function addChecklistItem(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase, ownerId } = await requireOwner();
  const checklistId = String(fd.get("checklist_id") ?? "");
  const text = String(fd.get("text") ?? "").trim();
  const quantity = String(fd.get("quantity") ?? "").trim() || null;
  if (!text) return { ok: false, error: "Type the item first." };
  const { data: last } = await supabase.from("checklist_items").select("sort_order").eq("checklist_id", checklistId).order("sort_order", { ascending: false }).limit(1);
  const sort = Number(last?.[0]?.sort_order ?? 0) + 1;
  const { error } = await supabase.from("checklist_items").insert({ owner_id: ownerId, checklist_id: checklistId, text: text.slice(0, 160), quantity: quantity?.slice(0, 40) ?? null, sort_order: sort });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteChecklistItem(fd: FormData) {
  const { supabase } = await requireOwner();
  await supabase.from("checklist_items").delete().eq("id", String(fd.get("id") ?? ""));
  revalidatePath("/", "layout");
}

/** "Uncheck all" (the same as the weekly reset, done by hand). */
export async function uncheckAllItems(fd: FormData) {
  const { supabase } = await requireOwner();
  const id = String(fd.get("checklist_id") ?? "");
  await supabase.from("checklist_items").update({ checked: false }).eq("checklist_id", id).eq("checked", true);
  revalidatePath("/", "layout");
}

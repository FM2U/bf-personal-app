"use server";

import { requireOwner } from "@/lib/auth";
import { syncRepliesQuietly } from "@/lib/replies-sync";

/**
 * Page speed (2026-11-06): Home, Reports and a partner's page look for new email replies after the page is on screen
 * (at most once every few minutes, as before), instead of holding the page up to 4 seconds first. Returns how many
 * replies were added, so the page shows them at once.
 */
export async function checkRepliesNow(): Promise<{ added: number }> {
  const { supabase, ownerId } = await requireOwner();
  const r = await syncRepliesQuietly(supabase, ownerId, 15000);
  return { added: r.added };
}

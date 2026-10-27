"use server";

/**
 * Calendar time block suggestions (Productivity, Calendar time blocks): Suggest blocks now, Approve, Approve all,
 * Edit, Delete. Only Approve sends a block to Google Calendar (src/lib/engine/time-blocks.ts).
 */
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadInputs } from "@/lib/finance";
import { approveTimeBlock, deleteTimeBlock, editTimeBlock, loadTodaysBlocks, suggestTimeBlocks, type BlockResult } from "@/lib/engine/time-blocks";

async function ctx() {
  const { supabase, ownerId } = await requireOwner();
  return loadCtx(supabase, ownerId);
}

const refresh = () => revalidatePath("/", "layout");

export async function suggestBlocksNow(): Promise<BlockResult> {
  const c = await ctx();
  const inputs = await loadInputs(c.sb);
  const r = await suggestTimeBlocks(c, inputs.num);
  refresh();
  return { ok: true, message: r.suggested ? `${r.suggested} time block${r.suggested === 1 ? "" : "s"} suggested.` : "No open priority tasks due today need a block." };
}

export async function approveBlock(id: string): Promise<BlockResult> {
  const r = await approveTimeBlock(await ctx(), id);
  refresh();
  return r;
}

export async function approveAllBlocks(): Promise<BlockResult> {
  const c = await ctx();
  const waiting = (await loadTodaysBlocks(c.sb, c.ownerId, c.today)).filter((b) => b.state === "suggested");
  let added = 0;
  for (const b of waiting) {
    const r = await approveTimeBlock(c, b.id);
    if (!r.ok) {
      refresh();
      return { ok: false, error: added ? `${added} added. Then: ${r.error}` : r.error };
    }
    added++;
  }
  refresh();
  return { ok: true, message: `${added} time block${added === 1 ? "" : "s"} added to Google Calendar.` };
}

export async function deleteBlock(id: string): Promise<BlockResult> {
  const r = await deleteTimeBlock(await ctx(), id);
  refresh();
  return r;
}

export async function editBlock(id: string, startMin: number, minutes: number): Promise<BlockResult> {
  const r = await editTimeBlock(await ctx(), id, startMin, minutes);
  refresh();
  return r;
}

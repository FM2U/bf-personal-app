import "server-only";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { ensureReview } from "@/lib/engine/reviews";

/**
 * `/accountability/reviews/today` (the Home "Next review due" tile on a weekday before the daily close is done):
 * opens today's daily close, drafted first when there is none yet. Other ids are returned unchanged.
 */
export async function todayCloseRedirect(id: string): Promise<string> {
  if (id !== "today") return id;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const reviewId = await ensureReview(ctx, "daily");
  redirect(reviewId ? `/accountability/reviews/${reviewId}` : "/accountability/reviews");
}

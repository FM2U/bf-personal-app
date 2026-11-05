"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { DB_UPDATE_NOTICE_PUSH_D, isMissingSchemaError } from "@/lib/schema-guard";
import { loadFacts, loadTargets } from "@/lib/accountability/data";
import { cleanNextTargets, monthName, monthResults, parseMonthSlug, reviewMonthFor } from "@/lib/accountability/monthly";
import { loadWorkCtx } from "@/lib/work/data";
import type { Row } from "@/lib/types";

/**
 * The monthly review (push D, approved 2026-11-04). "Finish the review" saves next month's targets (each target's
 * number and Commitment switch, on the targets themselves) and keeps a copy of how the month went and of the targets
 * as set on the review row, which then opens read only and leaves Work on now. Finishing without the export is
 * allowed. Only the review open now (the month before, from the first workday of this month) can be finished. Every
 * action returns { ok: false, error } instead of throwing.
 */
type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

export async function finishMonthlyReview(slug: string, input: { id: string; number: number | string; commitment: boolean }[]): Promise<{ ok: true; exported: boolean } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const ctx = await loadCtx(sb, ownerId);
  const month = parseMonthSlug(slug);
  if (!month) return fail("That month was not found.");
  const open = reviewMonthFor(ctx.today);
  if (!open || open.month !== month) return fail(`Only the review of ${open ? monthName(open.month) : "last month"} can be finished now.`);
  const { data: existing, error: readError } = await sb.from("monthly_reviews").select("*").eq("owner_id", ownerId).eq("month", month).maybeSingle();
  if (readError) return fail(isMissingSchemaError(readError) ? DB_UPDATE_NOTICE_PUSH_D : `Not saved: ${readError.message}`);
  if ((existing as Row | null)?.finished_at) return fail(`The ${monthName(month)} review is already finished.`);
  const targets = await loadTargets(sb, ownerId);
  const next = cleanNextTargets(input, targets);
  if (!next.ok) return next;
  // How the month went, counted before the targets change (the copy kept on the review).
  const wctx = await loadWorkCtx(sb, ownerId);
  const bundle = await loadFacts(sb, wctx, month);
  const results = monthResults(targets, bundle.facts, month, bundle.skippedDays);
  for (const t of next.rows) {
    const was = targets.find((x) => x.id === t.targetId);
    if (was && (was.number !== t.number || was.commitment !== t.commitment)) {
      const { error } = await sb.from("targets").update({ minimum_count: t.number, is_commitment: t.commitment }).eq("owner_id", ownerId).eq("id", t.targetId);
      if (error) return fail(`Not saved: ${error.message}`);
    }
  }
  const values = { results, next_targets: next.rows, finished_at: new Date().toISOString() };
  const { error } = existing ? await sb.from("monthly_reviews").update(values).eq("id", (existing as Row).id) : await sb.from("monthly_reviews").insert({ owner_id: ownerId, month, ...values });
  if (error) return fail(isMissingSchemaError(error) ? DB_UPDATE_NOTICE_PUSH_D : `Not saved: ${error.message}`);
  revalidatePath("/", "layout");
  return { ok: true, exported: !!(existing as Row | null)?.exported_at };
}

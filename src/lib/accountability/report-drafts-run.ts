import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIInvalidReply, AIUnavailable, callForJson, cleanDeep } from "@/lib/ai/claude";
import { isAIConfigured } from "@/lib/env";
import type { Ctx } from "@/lib/engine/helpers";
import { endOfDayLines } from "@/lib/accountability/ask-ai";
import { cleanOpening, loadEndOfDay, OPENING_KEY } from "@/lib/accountability/data";
import { editEod } from "@/lib/accountability/eod-write";
import { withoutPlaceholders, cleanDrafts, draftsPrompt, draftTargets, DRAFTS_KEY, validateDraftsReply } from "@/lib/accountability/report-drafts";

/**
 * Writes the report's AI drafts for a day (Bram, 2026-11-15, step 4): the opening, tomorrow's line, and each top
 * priority's Now line, in one request. Called by the report job with the first reminder (4:00 pm by default) and by
 * "Redraft" on End of day. Only text that is empty or still an AI draft is written (src/lib/accountability/report-drafts.ts).
 */
export type DraftsResult = { ok: true; wrote: { opening: boolean; tomorrow: boolean; now: number } } | { ok: false; error: string };

export async function writeReportDrafts(sb: SupabaseClient, ctx: Ctx, day: string): Promise<DraftsResult> {
  if (!isAIConfigured()) return { ok: false, error: "The AI is not set up (no API key)." };
  const page = await loadEndOfDay(sb, ctx, day);
  if (page.state !== "open") return { ok: false, error: `This day is already ${page.state}.` };
  if (!page.v8) return { ok: false, error: "The drafts need Top priorities (the database update of Nov 15)." };
  const want = draftTargets({ opening: page.opening, tomorrow: page.tomorrow, drafts: page.drafts, pickIds: page.draftInput.picks.map((p) => p.id) });
  if (!want.opening && !want.tomorrow && !want.now.length) return { ok: true, wrote: { opening: false, tomorrow: false, now: 0 } };
  let reply;
  try {
    reply = await callForJson({
      sb,
      ownerId: ctx.ownerId,
      purpose: "report_drafts",
      prompt: draftsPrompt({ dateLabel: page.dateLabel, tomorrowLabel: page.tomorrowLabel, dayLines: endOfDayLines(page).filter((l) => !l.startsWith("target:") && (want.tomorrow ? !l.startsWith("tomorrow line:") : true)).map(withoutPlaceholders), activity: page.draftInput.activity.map(withoutPlaceholders), picks: page.draftInput.picks, dueNext: page.draftInput.dueNext.map(withoutPlaceholders), want }),
      maxTokens: 2000,
      shape: "none",
      // The report job must finish its run (300 s); the reminder email goes out with or without the drafts.
      deadlineMs: 120_000,
      validate: (v) => validateDraftsReply(cleanDeep(v), want),
    });
  } catch (e) {
    return { ok: false, error: e instanceof AIInvalidReply || e instanceof AIUnavailable ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Saved with the same check as every report_edits change (src/lib/accountability/eod-write.ts): the row is read
  // again at the moment of saving, so text typed while the AI was writing, or saved at the same moment, is never replaced.
  const wrote = { opening: false, tomorrow: false, now: 0 };
  const saved = await editEod(sb, ctx.ownerId, day, ({ edits: all, tomorrowLine }) => {
    wrote.opening = false;
    wrote.tomorrow = false;
    wrote.now = 0;
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    const may = draftTargets({ opening: cleanOpening(all[OPENING_KEY]), tomorrow: tomorrowLine, drafts, pickIds: Object.keys(reply.now) });
    const patch: Record<string, unknown> = { report_html: null, report_edited: false };
    if (reply.opening && may.opening) {
      all[OPENING_KEY] = cleanOpening(reply.opening);
      drafts.opening = true;
      wrote.opening = true;
    }
    if (reply.tomorrow && may.tomorrow) {
      patch.tomorrow_line = reply.tomorrow;
      drafts.tomorrow = true;
      wrote.tomorrow = true;
    }
    for (const id of may.now) {
      drafts.now[id] = { text: reply.now[id], ai: true };
      wrote.now++;
    }
    if (!wrote.opening && !wrote.tomorrow && !wrote.now) return null;
    drafts.at = new Date().toISOString();
    all[DRAFTS_KEY] = drafts;
    return { edits: all, patch };
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  if (!saved.wrote) return { ok: true, wrote: { opening: false, tomorrow: false, now: 0 } };
  return { ok: true, wrote };
}

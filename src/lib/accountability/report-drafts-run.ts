import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIInvalidReply, AIUnavailable, callForJson, cleanDeep } from "@/lib/ai/claude";
import { isAIConfigured } from "@/lib/env";
import type { Ctx } from "@/lib/engine/helpers";
import { endOfDayLines } from "@/lib/accountability/ask-ai";
import { cleanOpening, loadEndOfDay, OPENING_KEY } from "@/lib/accountability/data";
import { editEod } from "@/lib/accountability/eod-write";
import { refreshCalendarActivity } from "@/lib/accountability/calendar-activity";
import { withoutPlaceholders, cleanDrafts, draftsPrompt, draftTargets, DRAFTS_KEY, validateDraftsReply } from "@/lib/accountability/report-drafts";

/**
 * Writes the report's AI drafts for a day (Bram, 2026-11-15, step 4): the opening, tomorrow's line, and (release 4,
 * 2026-11-16) each record worked on today's Today line, in one request. The day's calendar is matched and saved first
 * (src/lib/accountability/calendar-activity.ts), so meetings on a record count as work on it. Called by the report job with the first reminder (4:00 pm by default) and by
 * "Redraft" on End of day. Only text that is empty or still an AI draft is written (src/lib/accountability/report-drafts.ts).
 */
export type DraftsResult = { ok: true; wrote: { opening: boolean; tomorrow: boolean; today: number } } | { ok: false; error: string };

/**
 * The day's lines the drafts read (release 4): the date, the open waits and tomorrow's line from End of day, and the
 * Today box's counts. What was done comes from the kept rows of Today's activity only, so a dropped row never reaches
 * the AI (the app's own day lines list every move and call, dropped or not).
 */
function dayLinesForDrafts(page: Awaited<ReturnType<typeof loadEndOfDay>>, writingTomorrow: boolean): string[] {
  const box = page.report.box ? [`today box (shown under the opening; never repeat these counts): ${page.report.box.map((c) => `${c.label.toLowerCase()} ${c.value}`).join(", ")}`] : [];
  const lines = endOfDayLines(page).filter((l) => l.startsWith("day:") || l.startsWith("waiting on") || (!writingTomorrow && l.startsWith("tomorrow line:")));
  return [...lines.slice(0, 1), ...box, ...lines.slice(1)].map(withoutPlaceholders);
}

export async function writeReportDrafts(sb: SupabaseClient, ctx: Ctx, day: string): Promise<DraftsResult> {
  // Release 4: the calendar rows that match a record, saved with the day before the page is read (also without the AI,
  // so the report job keeps them current).
  await refreshCalendarActivity(sb, ctx, day).catch(() => null);
  if (!isAIConfigured()) return { ok: false, error: "The AI is not set up (no API key)." };
  const page = await loadEndOfDay(sb, ctx, day);
  if (page.state !== "open") return { ok: false, error: `This day is already ${page.state}.` };
  if (!page.v8) return { ok: false, error: "The drafts need Top priorities (the database update of Nov 15)." };
  const want = draftTargets({ opening: page.opening, tomorrow: page.tomorrow, drafts: page.drafts, recordIds: page.draftInput.records.map((p) => p.id) });
  if (!want.opening && !want.tomorrow && !want.today.length) return { ok: true, wrote: { opening: false, tomorrow: false, today: 0 } };
  let reply;
  try {
    reply = await callForJson({
      sb,
      ownerId: ctx.ownerId,
      purpose: "report_drafts",
      prompt: draftsPrompt({ dateLabel: page.dateLabel, tomorrowLabel: page.tomorrowLabel, dayLines: dayLinesForDrafts(page, want.tomorrow), activity: page.draftInput.activity.map(withoutPlaceholders), records: page.draftInput.records.map((r) => ({ ...r, name: withoutPlaceholders(r.name), activity: r.activity.map(withoutPlaceholders), notes: r.notes.map(withoutPlaceholders), waiting: r.waiting ? withoutPlaceholders(r.waiting) : null })), dueNext: page.draftInput.dueNext.map(withoutPlaceholders), want }),
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
  const wrote = { opening: false, tomorrow: false, today: 0 };
  const saved = await editEod(sb, ctx.ownerId, day, ({ edits: all, tomorrowLine }) => {
    wrote.opening = false;
    wrote.tomorrow = false;
    wrote.today = 0;
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    const may = draftTargets({ opening: cleanOpening(all[OPENING_KEY]), tomorrow: tomorrowLine, drafts, recordIds: Object.keys(reply.today) });
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
    for (const id of may.today) {
      drafts.today[id] = { text: reply.today[id], ai: true };
      wrote.today++;
    }
    if (!wrote.opening && !wrote.tomorrow && !wrote.today) return null;
    drafts.at = new Date().toISOString();
    all[DRAFTS_KEY] = drafts;
    return { edits: all, patch };
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  if (!saved.wrote) return { ok: true, wrote: { opening: false, tomorrow: false, today: 0 } };
  return { ok: true, wrote };
}

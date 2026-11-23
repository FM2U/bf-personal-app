import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadCtx } from "@/lib/engine/helpers";
import { env } from "@/lib/env";
import { getGoogleConnection, sendGmailMessage } from "@/lib/google";
import { AUTO_KEY, cleanAuto, loadEndOfDay, type EndOfDayPage, type ReportAuto } from "@/lib/accountability/data";
import { approveAndSendCore, ensureEodRow, owedCount } from "@/lib/accountability/send-core";
import { loadWorkCtx } from "@/lib/work/data";
import { eodLong, parseTime } from "@/lib/work/settings";
import { reportStep } from "@/lib/accountability/auto-report-rules";
import { refreshCalendarActivity } from "@/lib/accountability/calendar-activity";
import { writeReportDrafts } from "@/lib/accountability/report-drafts-run";
import { editEod } from "@/lib/accountability/eod-write";

/**
 * The report sends itself (Bram, 2026-11-08; claude/2026-11-08-auto-send-report-plan.md). The report job runs every
 * 5 minutes (Supabase Cron calls /api/cron/report). On a day a partner is due and the report is not sent yet:
 *  - 2 hours before the send time (Settings, Work settings, "Send by"): the AI drafts the opening, tomorrow's line and
 *    each record worked on today's Today line (step 4, 2026-11-15; release 4, 2026-11-16; only what is empty or still its draft), then a reminder email;
 *  - 30 minutes before: the same email again;
 *  - at the send time, when "Send automatically" is on: the report goes out as End of day shows it (Approve and send
 *    without the reasons question; anything not filled in goes as "(still to give)"), then the people under Also send to;
 *  - at the send time, when "Send automatically" is off (the default since 2026-11-15): one email to you that today's
 *    report is ready and not sent, with a link to End of day; the day stays open until you press Approve and send;
 *  - a failed send is tried again on each run until 9:00 pm, with one email to you that it did not go out.
 * What was done is kept on the day's End of day row (report_edits._auto), so nothing is sent twice.
 */

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function localMinutes(tz: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Saves the job's record on the day's row; false when there is no row or the save failed. */
async function saveAuto(sb: SupabaseClient, day: string, ownerId: string, patch: ReportAuto): Promise<boolean> {
  // A key set to undefined is left out when saved (JSON), which takes it back. Saved on a sent day too (the send's record).
  const r = await editEod(sb, ownerId, day, ({ edits: all }) => {
    all[AUTO_KEY] = { ...cleanAuto(all[AUTO_KEY]), ...patch };
    return { edits: all };
  }, { open: false });
  return r.ok;
}

/** The reminder's line on the AI drafts (step 4), naming only what was written; null when nothing was. */
export function draftsReadyLine(w: { opening: boolean; tomorrow: boolean; today: number }): string | null {
  const parts = [w.opening ? "the opening" : null, w.tomorrow ? "tomorrow's line" : null, w.today ? (w.today === 1 ? "a Today line" : `${w.today} Today lines`) : null].filter((x): x is string => !!x);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `AI drafts of ${list} are ready to check on End of day.`;
}

/** "2 reasons, tomorrow's line, listings reviewed (not entered yet)" or null when everything is filled in. */
function stillOpen(page: EndOfDayPage): string | null {
  const owed = owedCount(page);
  const parts = [owed ? `${owed} ${owed === 1 ? "reason" : "reasons"}` : null, page.review && page.review.answered < 3 ? "the Weekly review" : null, !page.tomorrow.trim() ? `${page.tomorrowLabel.toLowerCase() === "tomorrow" ? "tomorrow's" : `${page.tomorrowLabel}'s`} line` : null, page.v8 && page.reviewed && !page.reviewed.entered ? "listings reviewed (not entered yet)" : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function mailOwner(sb: SupabaseClient, ownerId: string, subject: string, lines: string[]): Promise<boolean> {
  const conn = await getGoogleConnection(sb, ownerId);
  // To you: the Google account the app sends from, or the owner's sign-in address.
  const to = String(conn?.google_email ?? "").trim() || env.ownerEmail;
  if (!to) return false;
  const link = `${env.appUrl}/work/end-of-day`;
  const body = [...lines, "", `Open End of day: ${link}`].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#0f172a">${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("")}<p style="margin:12px 0 0"><a href="${link}" style="color:#1e40af">Open End of day</a></p></div>`;
  return !!(await sendGmailMessage(sb, ownerId, { to, subject, body, html }));
}

export type ReportJobResult = { day: string; step: string; detail?: string };

/** One run of the report job for one owner. `now` is only set by the local checks (a fake clock). */
export async function runReportJob(sb: SupabaseClient, ownerId: string, now: Date = new Date()): Promise<ReportJobResult> {
  const base = await loadCtx(sb, ownerId);
  const day = todayInTz(base.tz, now);
  const ctx = { ...base, today: day };
  const wctx = await loadWorkCtx(sb, ownerId);
  const page = await loadEndOfDay(sb, ctx, day);
  if (page.state !== "open") return { day, step: "none", detail: `already ${page.state}` };
  const due = page.copies.filter((c) => !c.sentAt && !c.skipped);
  if (!due.length) return { day, step: "none", detail: "no partner due" };
  const sendTime = parseTime(wctx.eodTime) ?? "18:00";
  const step = reportStep({ nowMin: localMinutes(ctx.tz, now), sendMin: minutesOf(sendTime), auto: page.auto, autoSend: wctx.autoSend });
  const names = due.map((c) => c.partner.name).join(" and ");
  const open = stillOpen(page);
  if (step === "remind1" || step === "remind2") {
    const row = await ensureEodRow(sb, ctx, day);
    if (typeof row === "string") return { day, step, detail: row };
    // Recorded before the AI drafts and the email (step 4, 2026-11-15), so a slow AI answer never brings a second run's
    // email; the first reminder goes out with or without the drafts.
    if (!(await saveAuto(sb, day, ownerId, step === "remind1" ? { reminded1: now.toISOString() } : { reminded2: now.toISOString(), ...(page.auto.reminded1 ? {} : { reminded1: now.toISOString() }) }))) return { day, step, detail: "not recorded; tried on the next run" };
    const drafted = step === "remind1" ? await writeReportDrafts(sb, ctx, day).catch((e) => ({ ok: false as const, error: String(e) })) : null;
    const draftLine = drafted && drafted.ok ? draftsReadyLine(drafted.wrote) : null;
    const at = eodLong(sendTime);
    const subject = wctx.autoSend ? `Your report goes out at ${at}` : `Your report is ready to send (${at})`;
    const lines = [
      wctx.autoSend ? `Today's report goes to ${names} at ${at}, as End of day shows it.` : `Today's report to ${names} is ready. Send automatically is off, so it goes out only when you press Approve and send.`,
      open ? (wctx.autoSend ? `Still open: ${open}. Anything left empty goes out as "(still to give)".` : `Still open: ${open}.`) : "Everything is filled in.",
      wctx.autoSend ? "To add a note or change anything, do it before then." : `Send it by ${at}.`,
      ...(draftLine ? [draftLine] : []),
    ];
    const ok = await mailOwner(sb, ownerId, subject, lines).catch(() => false);
    return { day, step, detail: `${ok ? "emailed" : "no email (Google not connected)"}${drafted ? `; drafts ${drafted.ok ? "written" : `not written (${drafted.error})`}` : ""}` };
  }
  if (step === "due") {
    // Send automatically is off (Bram, 2026-11-15): one email at the send time; the report waits for Approve and send.
    // The day's row must exist first, so the record that the email went out is kept (or it would go every 5 minutes).
    const row = await ensureEodRow(sb, ctx, day);
    if (typeof row === "string") return { day, step, detail: row };
    const at = eodLong(sendTime);
    const lines = [`Today's report to ${names} is ready and not sent. It was due at ${at}.`, open ? `Still open: ${open}.` : "Everything is filled in.", "It goes out when you press Approve and send on End of day."];
    // Recorded before the email goes, so a failed save can never send it every 5 minutes; taken back if the email fails.
    if (!(await saveAuto(sb, day, ownerId, { dueMailed: now.toISOString() }))) return { day, step, detail: "not recorded; tried on the next run" };
    const ok = await mailOwner(sb, ownerId, "Today's report is ready and not sent", lines).catch(() => false);
    if (!ok) await saveAuto(sb, day, ownerId, { dueMailed: undefined });
    return { day, step, detail: ok ? "emailed" : "no email (Google not connected)" };
  }
  if (step === "send") {
    // Release 4: the day's calendar rows are matched and saved first, so a meeting on a deal after 4:00 pm still counts.
    await refreshCalendarActivity(sb, ctx, day).catch(() => null);
    const r = await approveAndSendCore(sb, ctx, day, `auto-${day}`, true, null, "auto");
    if (r.ok) {
      await saveAuto(sb, day, ownerId, { sentAt: now.toISOString() });
      return { day, step, detail: `sent to ${r.sentTo.join(", ")}${r.alsoTo?.length ? `; also ${r.alsoTo.join(", ")}` : ""}${r.alsoError ? `; also failed: ${r.alsoError}` : ""}` };
    }
    const patch: ReportAuto = { failedAt: now.toISOString(), failure: r.error };
    if (!page.auto.failureMailed) {
      const mailed = await mailOwner(sb, ownerId, "Today's report did not go out", [`The report to ${names} did not go out at ${eodLong(sendTime)}.`, `What happened: ${r.error}`, "The app tries again every few minutes until 9:00 pm. You can also open End of day and press Approve and send."]).catch(() => false);
      if (mailed) patch.failureMailed = now.toISOString();
    }
    await saveAuto(sb, day, ownerId, patch);
    return { day, step, detail: `failed: ${r.error}` };
  }
  return { day, step: "none" };
}

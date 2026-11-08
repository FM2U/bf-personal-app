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

/**
 * The report sends itself (Bram, 2026-11-08; claude/2026-11-08-auto-send-report-plan.md). The report job runs every
 * 5 minutes (Supabase Cron calls /api/cron/report). On a day a partner is due and the report is not sent yet:
 *  - 2 hours before the send time (Settings, Work settings, "Report goes out at"): a reminder email to you;
 *  - 30 minutes before: the same email again;
 *  - at the send time, when "Send automatically" is on: the report goes out as End of day shows it (Approve and send
 *    without the reasons question; anything not filled in goes as "(still to give)"), then the people under Also send to;
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

async function saveAuto(sb: SupabaseClient, day: string, ownerId: string, patch: ReportAuto): Promise<void> {
  const { data } = await sb.from("end_of_day").select("id,report_edits").eq("owner_id", ownerId).eq("day", day).maybeSingle();
  if (!data) return;
  const all = { ...((data.report_edits && typeof data.report_edits === "object" && !Array.isArray(data.report_edits) ? data.report_edits : {}) as Record<string, unknown>) };
  all[AUTO_KEY] = { ...cleanAuto(all[AUTO_KEY]), ...patch };
  await sb.from("end_of_day").update({ report_edits: all }).eq("id", data.id);
}

/** "2 reasons, tomorrow's line" or null when everything is filled in. */
function stillOpen(page: EndOfDayPage): string | null {
  const owed = owedCount(page);
  const parts = [owed ? `${owed} ${owed === 1 ? "reason" : "reasons"}` : null, page.review && page.review.answered < 3 ? "the Weekly review" : null, !page.tomorrow.trim() ? `${page.tomorrowLabel.toLowerCase() === "tomorrow" ? "tomorrow's" : `${page.tomorrowLabel}'s`} line` : null].filter(Boolean);
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
    const at = eodLong(sendTime);
    const subject = wctx.autoSend ? `Your report goes out at ${at}` : `Your report is ready to send (${at})`;
    const lines = [
      wctx.autoSend ? `Today's report goes to ${names} at ${at}, as End of day shows it.` : `Today's report to ${names} is ready. Send automatically is off, so it goes out only when you press Approve and send.`,
      open ? `Still open: ${open}. Anything left empty goes out as "(still to give)".` : "Everything is filled in.",
      "To add a note or change anything, do it before then.",
    ];
    const ok = await mailOwner(sb, ownerId, subject, lines).catch(() => false);
    await saveAuto(sb, day, ownerId, step === "remind1" ? { reminded1: now.toISOString() } : { reminded2: now.toISOString(), ...(page.auto.reminded1 ? {} : { reminded1: now.toISOString() }) });
    return { day, step, detail: ok ? "emailed" : "no email (Google not connected)" };
  }
  if (step === "send") {
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

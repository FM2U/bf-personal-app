import { after, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { connectionChecks, morningJob, ownerIds } from "@/lib/jobs";
import { syncReplies } from "@/lib/replies-sync";
import { runReportJob } from "@/lib/accountability/auto-report";

export const maxDuration = 300;

type Sb = ReturnType<typeof createServiceClient>;
/** Scheduled jobs (see vercel.json): morning runs the daily checks and reads replies; "replies" reads replies alone. */
const JOBS: Record<string, (sb: Sb, ownerId: string, now: Date) => Promise<unknown>> = {
  // The daily report (2026-11-08): reminders 2 hours and 30 minutes before the send time, then the send. Called every
  // 5 minutes by Supabase Cron (claude/2026-11-08-auto-send-report-plan.md).
  report: (sb, id, now) => runReportJob(sb, id, now),
  morning: (sb, id) => morningJob(sb, id),
  replies: (sb, id) => syncReplies(sb, id, { force: true }),
  evening: async () => ({ skipped: "nothing scheduled in the evening yet" }),
  "connection-checks": (sb, id) => connectionChecks(sb, id),
};

function authorized(req: Request): boolean {
  // CRON_SECRET (Vercel's own timers) or REPORT_CRON_SECRET (the Supabase timer, 2026-11-08).
  const auth = req.headers.get("authorization");
  const given = req.headers.get("x-cron-secret");
  return [env.cronSecret, env.reportCronSecret].some((s) => !!s && (auth === `Bearer ${s}` || given === s));
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: `Unknown job. Jobs: ${Object.keys(JOBS).join(", ")}` }, { status: 404 });
  const sb = createServiceClient();
  // Local checks only (the stand-in Google is set): ?at=<ISO time> runs the job as if it were that time.
  const at = new URL(req.url).searchParams.get("at");
  const now = at && process.env.GOOGLE_API_MOCK_URL && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
  // The report timer (Supabase Cron) waits at most 5 seconds for an answer: the app answers at once and does the
  // reminder or the send right after (2026-11-08). The local checks (?at=) wait for the result.
  if (job === "report" && !at) {
    after(async () => {
      for (const id of await ownerIds(sb)) {
        try {
          console.log(`[report job] ${id}`, JSON.stringify(await fn(sb, id, now)));
        } catch (e) {
          console.log(`[report job] ${id} error`, e instanceof Error ? e.message : String(e));
        }
      }
    });
    return NextResponse.json({ job, accepted_at: new Date().toISOString() }, { status: 202 });
  }
  const results: Record<string, unknown> = {};
  for (const id of await ownerIds(sb)) {
    try {
      results[id] = await fn(sb, id, now);
    } catch (e) {
      results[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ job, ran_at: new Date().toISOString(), results });
}

export const POST = GET;

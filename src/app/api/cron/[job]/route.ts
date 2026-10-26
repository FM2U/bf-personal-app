import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { loadCtx } from "@/lib/engine/helpers";
import { buildMorningPlan, connectionChecks, ownerIds, plaidSyncAll, runEvening, runMorning } from "@/lib/engine/run";
import { checkMilestones, evaluateConditions } from "@/lib/engine/rules";
import { checkCommitments, generateFollowUps, generatePipelineTasks, generateRecurringTasks } from "@/lib/engine/tasks";
import { ensureReview } from "@/lib/engine/reviews";
import { schedulePartnerReports } from "@/lib/engine/partners";

export const maxDuration = 300;

type Ctx = Awaited<ReturnType<typeof loadCtx>>;
const JOBS: Record<string, (sb: ReturnType<typeof createServiceClient>, ownerId: string, ctx: Ctx) => Promise<unknown>> = {
  morning: (sb, id) => runMorning(sb, id),
  evening: (sb, id) => runEvening(sb, id),
  "plaid-sync": (_sb, _id, ctx) => plaidSyncAll(ctx),
  "decision-conditions": (_sb, _id, ctx) => evaluateConditions(ctx),
  "connection-checks": (_sb, _id, ctx) => connectionChecks(ctx),
  "recurring-tasks": async (_sb, _id, ctx) => ({ templates: await generateRecurringTasks(ctx), pipeline: await generatePipelineTasks(ctx), followUps: await generateFollowUps(ctx) }),
  "morning-plan": (_sb, _id, ctx) => buildMorningPlan(ctx, true),
  "daily-close": (_sb, _id, ctx) => ensureReview(ctx, "daily"),
  "weekly-review": (_sb, _id, ctx) => ensureReview(ctx, "weekly"),
  "monthly-review": (_sb, _id, ctx) => ensureReview(ctx, "monthly"),
  "quarterly-review": (_sb, _id, ctx) => ensureReview(ctx, "quarterly"),
  "partner-reports": (_sb, _id, ctx) => schedulePartnerReports(ctx),
  commitments: (_sb, _id, ctx) => checkCommitments(ctx, false),
  milestones: (_sb, _id, ctx) => checkMilestones(ctx),
};

function authorized(req: Request): boolean {
  if (!env.cronSecret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${env.cronSecret}` || req.headers.get("x-cron-secret") === env.cronSecret;
}

/**
 * Scheduled jobs. Vercel Cron calls /api/cron/morning and /api/cron/evening once a day each (see vercel.json);
 * those two run every other job in order. Each job can also be called on its own with the CRON_SECRET header.
 */
export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: `Unknown job. Jobs: ${Object.keys(JOBS).join(", ")}` }, { status: 404 });
  const sb = createServiceClient();
  const results: Record<string, unknown> = {};
  for (const id of await ownerIds(sb)) {
    try {
      results[id] = await fn(sb, id, await loadCtx(sb, id));
    } catch (e) {
      results[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ job, ran_at: new Date().toISOString(), results });
}

export const POST = GET;

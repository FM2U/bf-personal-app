import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { connectionChecks, ownerIds } from "@/lib/jobs";

export const maxDuration = 300;

type Sb = ReturnType<typeof createServiceClient>;
/** Scheduled jobs (see vercel.json): morning runs the daily checks; evening is kept for reply reading (push B). */
const JOBS: Record<string, (sb: Sb, ownerId: string) => Promise<unknown>> = {
  morning: (sb, id) => connectionChecks(sb, id),
  evening: async () => ({ skipped: "nothing scheduled in the evening yet" }),
  "connection-checks": (sb, id) => connectionChecks(sb, id),
};

function authorized(req: Request): boolean {
  if (!env.cronSecret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${env.cronSecret}` || req.headers.get("x-cron-secret") === env.cronSecret;
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) return NextResponse.json({ error: `Unknown job. Jobs: ${Object.keys(JOBS).join(", ")}` }, { status: 404 });
  const sb = createServiceClient();
  const results: Record<string, unknown> = {};
  for (const id of await ownerIds(sb)) {
    try {
      results[id] = await fn(sb, id);
    } catch (e) {
      results[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ job, ran_at: new Date().toISOString(), results });
}

export const POST = GET;

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { ensureReview } from "@/lib/engine/reviews";
import { previewDailyReport } from "@/lib/engine/partners";
import { hasUpdate0019 } from "@/lib/update-0019";
import { hasUpdate0018 } from "@/lib/update-0018";
import { loadDailyReports } from "@/lib/daily-reports";
import { loadPendingMisses, loadTodaysOutcomes } from "@/lib/today";
import { closeStep } from "@/lib/calc/today";
import { isWeekday } from "@/lib/calc/dates";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_NOTICE_0019 } from "@/lib/schema-guard";
import { Notice } from "@/components/app/page-header";
import { StepsBar } from "@/components/app/close/steps-bar";
import { OutcomesStep } from "@/components/app/close/outcomes-step";
import { ChangesStep } from "@/components/app/close/changes-step";
import { ReportStep } from "@/components/app/close/report-step";
import type { Row } from "@/lib/types";

export const metadata = { title: "Close the day" };

const STEP_HELP: Record<number, string> = {
  1: "Mark each outcome, with one line on the result.",
  2: "What changed, tomorrow's top priority, and any missed commitment.",
  3: "Check the report, then approve and send it, or choose Not today.",
};

/**
 * Close the day: a 3-step flow (Outcomes, Changes, Report) that replaces the daily review for the kind "daily". It
 * stores into reviews (kind daily, period_start today), so review-today.ts, the partner report, and the old review
 * page keep working. Everything saves as it goes, so leaving and returning resumes at the saved step.
 */
export default async function ClosePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const ctx = await loadCtx(supabase, ownerId);
  const available = await hasUpdate0019(supabase);
  const reviewId = available ? await ensureReview(ctx, "daily") : null;
  const { data: reviewRow } = reviewId ? await supabase.from("reviews").select("*").eq("id", reviewId).maybeSingle() : { data: null };
  const review = (reviewRow as Row | null) ?? null;
  const step = closeStep(sp.step, (review?.answers as Row | undefined)?.close_step);
  const weekday = isWeekday(ctx.today);
  let body: React.ReactNode = null;
  if (available) {
    if (step === 1) {
      const [outcomes, { data: inits }] = await Promise.all([loadTodaysOutcomes(ctx), supabase.from("initiatives").select("id,name").eq("owner_id", ownerId)]);
      body = <OutcomesStep outcomes={outcomes} initiatives={Object.fromEntries(((inits ?? []) as Row[]).map((i) => [String(i.id), String(i.name)]))} />;
    } else if (step === 2) {
      const [{ data: plan }, misses, has0018] = await Promise.all([
        supabase.from("daily_plans").select("changes_note,tomorrow_priority").eq("owner_id", ownerId).eq("plan_date", ctx.today).maybeSingle(),
        loadPendingMisses(ctx),
        hasUpdate0018(supabase),
      ]);
      const p = (plan as Row | null) ?? null;
      body = <ChangesStep changes={String(p?.changes_note ?? "")} tomorrow={String(p?.tomorrow_priority ?? "")} misses={misses} today={ctx.today} has0018={has0018} />;
    } else {
      const reports = await loadDailyReports(supabase, ownerId, ctx.today).catch(() => null);
      const preview = reports?.items.length ? null : await previewDailyReport(ctx, ctx.today).catch(() => null);
      body = <ReportStep reports={reports} preview={preview} weekday={weekday} />;
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6" data-testid="close-page" data-step={step}>
      <div>
        <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900" data-testid="close-back-today">
          <ChevronLeft className="h-4 w-4" /> Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Close the day</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fmtDate(ctx.today, "EEE MMM d")}. {STEP_HELP[step]}
        </p>
      </div>
      <StepsBar current={step} />
      {!available ? <Notice tone="warn">{DB_UPDATE_NOTICE_0019}</Notice> : review?.status === "completed" && step === 1 ? <p className="text-sm text-muted-foreground">This day is already closed. Changes here are saved; press Finish on the Report step to close it again.</p> : null}
      {body}
      {available && step > 1 ? (
        <div>
          <Link href={`/today/close?step=${step - 1}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900" data-testid="close-back">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      ) : null}
    </div>
  );
}

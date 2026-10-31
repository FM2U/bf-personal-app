import { requireOwner } from "@/lib/auth";
import { loadToday } from "@/lib/today";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_NOTICE_0019 } from "@/lib/schema-guard";
import { Notice } from "@/components/app/page-header";
import { OutcomesEditor } from "@/components/app/today/outcomes";
import { FocusedHours } from "@/components/app/today/focused-hours";
import { ActivityRows, NextActionRows, TodaySection, WaitingRows } from "@/components/app/today/sections";
import { CloseDayButton } from "@/components/app/today/close-button";

export const metadata = { title: "Today" };

/**
 * Today (batch 1 of the focused version, approved 2026-10-30; at /today since the Work module became the start page):
 * one centered column. The date and the focused hours, up to 3 outcomes (picked from next actions or typed), today's
 * activity targets with +1, next actions due, who you are waiting on, and one button: Close the day. Reached from More.
 */
export default async function TodayPage({ searchParams }: { searchParams?: Promise<{ closed?: string; notice?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = (await searchParams) ?? {};
  const d = await loadToday(supabase, ownerId);
  const heading = `Today, ${fmtDate(d.today, "EEE MMM d")}`;
  const closed = d.day === "closed";
  const step = d.review?.step ?? 1;
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8" data-testid="today">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{heading}</h1>
          {d.available ? <FocusedHours hours={d.focusedHours} locked={closed} /> : null}
        </div>
        {d.available && (d.weekday || closed) ? <CloseDayButton state={d.day} step={step} size="sm" className="mb-0.5" /> : null}
      </header>
      {sp.notice ? <Notice tone="info">{sp.notice}</Notice> : null}
      {sp.closed ? (
        <p className="rounded-md bg-status-met-bg px-3 py-2 text-sm text-status-met" role="status" data-testid="closed-notice">
          The day is closed. See you tomorrow.
        </p>
      ) : null}
      {!d.available ? (
        <Notice tone="warn">{DB_UPDATE_NOTICE_0019}</Notice>
      ) : (
        <>
          <TodaySection title="Outcomes" meta={closed ? "Closed" : "Up to 3 for today"} testId="today-outcomes">
            <OutcomesEditor outcomes={d.outcomes} initiatives={d.initiatives} picks={d.picks} locked={closed} />
          </TodaySection>
          <TodaySection title="Today's activity" testId="today-activity">
            <ActivityRows available={d.targets.available} rows={d.targets.rows} />
          </TodaySection>
          <TodaySection title="Next actions" meta={d.nextActions.tasks.length ? `${d.nextActions.tasks.length + d.nextActions.more} due` : undefined} testId="today-next-actions">
            <NextActionRows tasks={d.nextActions.tasks} more={d.nextActions.more} today={d.today} />
          </TodaySection>
          <TodaySection title="Waiting on someone" testId="today-waiting">
            <WaitingRows rows={d.waiting} />
          </TodaySection>
          <div className="flex justify-center border-t border-slate-200 pt-6">
            <CloseDayButton state={d.day} step={step} className="min-w-48" />
          </div>
        </>
      )}
    </div>
  );
}

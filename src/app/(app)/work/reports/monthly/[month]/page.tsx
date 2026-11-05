import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { loadEodBadge } from "@/lib/accountability/data";
import { monthLabel, parseMonthSlug } from "@/lib/accountability/monthly";
import { loadMonthlyReviewPage } from "@/lib/accountability/monthly-data";
import { AccountabilityTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { MonthlyReviewBoard } from "@/components/app/work/monthly-review-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Pill, PinnedBlock, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";

export async function generateMetadata({ params }: { params: Promise<{ month: string }> }) {
  const month = parseMonthSlug((await params).month);
  return { title: month ? `Monthly review: ${monthLabel(month)}` : "Monthly review" };
}

/**
 * The monthly review (push D, approved mockup 2026-11-02 V.monthly): /work/reports/monthly/2026-10. The pinned title
 * "Monthly review: October 2026" with the crumb (Work on now or Reports, Monthly reviews), the status line of what to
 * do before finishing, then two columns: How October went and Export on the left; November targets (a number and a
 * Commitment switch per target) and Finish the review on the right (src/components/app/work/monthly-review-board.tsx).
 * A finished review, or an older month, opens read only.
 */
export default async function MonthlyReviewPage({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ from?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const [{ month: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await loadCtx(supabase, ownerId);
  const badge = await loadEodBadge(supabase, ownerId, ctx.today);
  const month = parseMonthSlug(slug);
  const fromHome = sp.from === "home";
  const crumb = fromHome ? (
    <>
      <Link href="/work" className="text-primary-strong hover:underline" data-testid="monthly-crumb">
        Work on now
      </Link>
      <span className="mx-1.5 text-slate-400">›</span>
      <span>Monthly review</span>
    </>
  ) : (
    <>
      <Link href="/work/reports?view=monthly" className="text-primary-strong hover:underline" data-testid="monthly-crumb">
        Reports
      </Link>
      <span className="mx-1.5 text-slate-400">›</span>
      <span>Monthly reviews</span>
    </>
  );
  if (!month || month >= `${ctx.today.slice(0, 7)}-01`) {
    return (
      <WorkShell testId="work-monthly">
        <PinnedBlock testId="monthly-sticky">
          <WorkHeader title="Monthly review" crumb={crumb} />
          <AccountabilityTabs eodBadge={badge} tight />
        </PinnedBlock>
        <EmptyState title="There is no review for this month." body="A month's review opens on the first workday of the month after it." />
      </WorkShell>
    );
  }
  const d = await loadMonthlyReviewPage(supabase, ctx, month);
  const title = (
    <WorkHeader
      title={`Monthly review: ${d.label}`}
      crumb={crumb}
      right={
        <>
          {d.finishedOn ? (
            <Pill tone="green" testId="monthly-finished-pill">
              Finished {fmtDate(d.finishedOn, "MMM d")}
            </Pill>
          ) : d.canFinish ? (
            <span className="hidden sm:inline" data-testid="monthly-opened">
              Opened on the first workday of the month
            </span>
          ) : (
            <Pill tone="gray" testId="monthly-not-finished-pill">
              Not finished
            </Pill>
          )}
          <AskAiPill context={{ page: "targets", label: `Monthly review, ${d.label}` }} />
        </>
      }
    />
  );
  if (d.notice) {
    return (
      <WorkShell testId="work-monthly">
        <PinnedBlock testId="monthly-sticky">
          {title}
          <AccountabilityTabs eodBadge={badge} tight />
        </PinnedBlock>
        <WorkUpdateNotice notice={d.notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-monthly">
      <MonthlyReviewBoard data={d} title={title} tabs={<AccountabilityTabs eodBadge={badge} tight />} />
    </WorkShell>
  );
}

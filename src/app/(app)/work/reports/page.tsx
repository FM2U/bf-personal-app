import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { accountabilityNotice, loadEodBadge, loadReportsPage } from "@/lib/accountability/data";
import { AccountabilityTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { ReportsBoard } from "@/components/app/work/reports-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Reports" };

/**
 * Reports (batch C, approved 2026-10-31): the pinned title, Ask AI, the Accountability tabs, and the segmented choice
 * "The week | Sent reports" with the period pills and Find; then the six figure tiles and the four cards, or the sent
 * reports by week (src/components/app/work/reports-board.tsx).
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; period?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = await accountabilityNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  const badge = await loadEodBadge(supabase, ownerId, ctx.today);
  const d = notice ? null : await loadReportsPage(supabase, ctx);
  const partnerFirst = d?.partner?.first ?? "your partner";
  const title = (
    <WorkHeader
      title="Reports"
      right={
        <>
          <span className="hidden sm:inline" data-testid="reports-summary">
            To {partnerFirst} by email · weekdays at 5:30 · Friday adds the week
          </span>
          <AskAiPill context={{ page: "reports", label: d ? `Reports, ${d.periods[0].label.toLowerCase()}` : "Reports" }} />
        </>
      }
    />
  );
  if (!d) {
    return (
      <WorkShell testId="work-reports">
        <PinnedBlock testId="reports-sticky">
          {title}
          <AccountabilityTabs eodBadge={badge} tight />
        </PinnedBlock>
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-reports">
      <ReportsBoard data={d} title={title} tabs={<AccountabilityTabs eodBadge={badge} tight />} view={sp.view === "sent" ? "sent" : "week"} period={sp.period === "last" || sp.period === "month" ? sp.period : "this"} />
    </WorkShell>
  );
}

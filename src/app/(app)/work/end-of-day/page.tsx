import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { accountabilityNotice, loadEndOfDay } from "@/lib/accountability/data";
import { END_OF_DAY_TIME } from "@/lib/accountability/targets";
import { AccountabilityTabs } from "@/components/app/nav-links";
import { EndOfDayBoard } from "@/components/app/work/end-of-day-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "End of day" };

/**
 * End of day (batch C, approved 2026-10-31, decisions on v3 and v4): the pinned title and tabs with the status line
 * "Before you send: Reasons (N left) · Tomorrow's line (done) · Approve and send"; then Today, counted; the Targets
 * card with the reason boxes; What matters tomorrow; and the Report to the partner exactly as it will be sent, with
 * Edit, Approve and send, and Skip today (src/components/app/work/end-of-day-board.tsx).
 */
export default async function EndOfDayPage() {
  const { supabase, ownerId } = await requireOwner();
  const notice = await accountabilityNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  if (notice) {
    return (
      <WorkShell testId="work-end-of-day">
        <PinnedBlock testId="eod-sticky">
          <WorkHeader title="End of day" right={<span>report at {END_OF_DAY_TIME} pm</span>} />
          <AccountabilityTabs eodBadge={null} tight />
        </PinnedBlock>
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const d = await loadEndOfDay(supabase, ctx);
  return (
    <WorkShell testId="work-end-of-day">
      <EndOfDayBoard data={d} />
    </WorkShell>
  );
}

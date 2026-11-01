import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts, workUpdateNotice } from "@/lib/work/data";
import { loadRosara } from "@/lib/work/projects-data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { RosaraBoard } from "@/components/app/work/rosara-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Rosara" };

/**
 * Rosara (batch B2, approved 2026-10-31): the pinned title with Ask AI and the Work tabs, then the Weekly focus bar
 * and the Projects card (src/components/app/work/rosara-board.tsx). The page scrolls as one.
 */
export default async function RosaraPage() {
  const { supabase, ownerId } = await requireOwner();
  const notice = await workUpdateNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, ctx.today);
  const header = (
    <PinnedBlock testId="rosara-sticky">
      <WorkHeader
        title="Rosara"
        right={
          <>
            <span className="hidden sm:inline" data-testid="rosara-summary">
              One focus a week, one next action per project
            </span>
            <AskAiPill context={{ page: "rosara", label: "Rosara" }} />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} tight />
    </PinnedBlock>
  );
  if (notice) {
    return (
      <WorkShell testId="work-rosara">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const d = await loadRosara(supabase, ctx);
  return (
    <WorkShell testId="work-rosara">
      {header}
      <RosaraBoard data={d} />
    </WorkShell>
  );
}

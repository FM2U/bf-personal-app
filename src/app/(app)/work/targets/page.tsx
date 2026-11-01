import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { accountabilityNotice, loadEodBadge, loadTargetsPage } from "@/lib/accountability/data";
import { AccountabilityTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { TargetsBoard } from "@/components/app/work/targets-board";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Targets" };

/**
 * Targets (batch C, approved 2026-10-31): the pinned title with the count line, Add a target, Ask AI, and the
 * Accountability tabs; then the Targets card and the Past weeks tiles (src/components/app/work/targets-board.tsx).
 * Everything is counted from the app's own data (src/lib/accountability/data.ts).
 */
export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = await accountabilityNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  const badge = await loadEodBadge(supabase, ownerId, ctx.today);
  const d = notice ? null : await loadTargetsPage(supabase, ctx);
  const header = (
    <PinnedBlock testId="targets-sticky">
      <WorkHeader
        title="Targets"
        right={
          <>
            <span className="hidden sm:inline" data-testid="targets-summary">
              {d ? `${d.targets.length} ${d.targets.length === 1 ? "target" : "targets"} · ${d.commitments} ${d.commitments === 1 ? "commitment" : "commitments"} · ${d.weekLabel}` : ""}
            </span>
            <AskAiPill context={{ page: "targets", label: d ? `Targets, ${d.weekLabel}` : "Targets" }} />
          </>
        }
      />
      <AccountabilityTabs eodBadge={badge} tight />
    </PinnedBlock>
  );
  if (!d) {
    return (
      <WorkShell testId="work-targets">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-targets">
      {header}
      <TargetsBoard data={d} adding={sp.add === "1"} />
    </WorkShell>
  );
}

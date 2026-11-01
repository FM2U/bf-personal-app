import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts } from "@/lib/work/data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkShell } from "@/components/app/work/shell";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

/**
 * Rosara, Job search, and Consulting in batch B1: the page with its heading, the Work tabs, and the empty state
 * "Comes with the next update", so the menu is final. Batch B2 fills them.
 */
export async function PlaceholderWorkPage({ title, testId, what }: { title: string; testId: string; /** One line on what the page will hold. */ what: string }) {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, ctx.today);
  return (
    <WorkShell testId={testId}>
      <PinnedBlock>
        <WorkHeader title={title} right={<AskAiPill context={title} />} />
        <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} tight />
      </PinnedBlock>
      <section className="rounded-xl border border-border bg-white px-[22px] py-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="coming-next">
        <p className="text-[15px] font-semibold text-slate-900">Comes with the next update</p>
        <p className="mx-auto mt-1.5 max-w-[520px] text-[13px] text-muted-foreground">{what}</p>
      </section>
    </WorkShell>
  );
}

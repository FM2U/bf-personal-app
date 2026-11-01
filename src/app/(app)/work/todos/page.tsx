import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts, workUpdateNotice } from "@/lib/work/data";
import { loadTodos } from "@/lib/work/personal-todos-data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { TodosBoard } from "@/components/app/work/todos-board";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "To-dos" };

/** To-dos (batch B): the personal list, last in the Work group. The list is in src/components/app/work/todos-board.tsx. */
export default async function TodosPage() {
  const { supabase, ownerId } = await requireOwner();
  const notice = await workUpdateNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, ctx.today);
  const header = (
    <PinnedBlock testId="todos-sticky">
      <WorkHeader title="To-dos" right={<AskAiPill context="To-dos" />} />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} tight />
    </PinnedBlock>
  );
  if (notice) {
    return (
      <WorkShell testId="work-todos">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const d = await loadTodos(supabase, ctx);
  return (
    <WorkShell testId="work-todos">
      {header}
      <TodosBoard data={d} />
    </WorkShell>
  );
}

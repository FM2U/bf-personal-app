import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts } from "@/lib/work/data";
import { loadTodos, type TodosData } from "@/lib/work/personal-todos-data";
import { DB_UPDATE_NOTICE_PUSH_C, isMissingSchemaError } from "@/lib/schema-guard";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { TodosBoard } from "@/components/app/work/todos-board";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "To-dos" };

/** To-dos (batch B; push C adds dated record tasks, Repeat and Link to): last in the Work group. The list is in src/components/app/work/todos-board.tsx. */
export default async function TodosPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  // Push C: before UPDATE_PREVIEW_PUSH_C.sql runs, the page says so instead of failing.
  let d: TodosData | null = null;
  let notice: string | null = null;
  try {
    d = await loadTodos(supabase, ctx);
  } catch (e) {
    if (!isMissingSchemaError({ message: e instanceof Error ? e.message : String(e) })) throw e;
    notice = DB_UPDATE_NOTICE_PUSH_C;
  }
  const tabs = await loadTabCounts(supabase, ownerId, ctx.today);
  const askAi = <AskAiPill context={{ page: "todos", label: "To-dos" }} />;
  const header = (
    <PinnedBlock testId="todos-sticky">
      <WorkHeader title="To-dos" right={askAi} />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} tight />
    </PinnedBlock>
  );
  if (notice || !d) {
    return (
      <WorkShell testId="work-todos">
        {header}
        <WorkUpdateNotice notice={notice ?? DB_UPDATE_NOTICE_PUSH_C} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-todos">
      <TodosBoard data={d} askAi={askAi} tabs={<WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} className="mt-3 mb-0 border-b border-border" />} />
    </WorkShell>
  );
}

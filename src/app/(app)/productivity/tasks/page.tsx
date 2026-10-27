import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { TaskTable } from "@/components/app/task-list";
import { TaskFilter } from "@/components/app/task-filter";
import { matchesTaskFilters, parseTaskFilters } from "@/lib/task-filters";
import type { Row } from "@/lib/types";

export const metadata = { title: "Task lists" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  // Filters live in the address (src/lib/task-filters.ts), so links and Back keep them.
  const filters = parseTaskFilters(sp);
  let q = supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("priority").limit(1000);
  if (filters.status.length) q = q.in("status", filters.status);
  if (filters.initiative.length) q = q.in("initiative_id", filters.initiative);
  const [{ data: tasks }, { data: inits }, { data: items }] = await Promise.all([
    q,
    supabase.from("initiatives").select("id,name").order("sort_order"),
    supabase.from("pipeline_items").select("id,name"),
  ]);
  const list = ((tasks ?? []) as Row[]).filter((t) => matchesTaskFilters(t, filters, ctx.today)).slice(0, 500);
  const initiatives = ((inits ?? []) as Row[]).map((i) => ({ id: String(i.id), name: String(i.name) }));
  return (
    <div>
      <PageHeader
        title="Task lists"
        description="All tasks. Press Filter to choose status, initiative, due date, and priority."
        actions={
          <Button asChild size="sm">
            <Link href="/records/tasks/new">Add task</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <TaskFilter filters={filters} initiatives={initiatives} />
          <span className="text-xs text-muted-foreground tabular" data-testid="task-count">
            {list.length} {list.length === 1 ? "task" : "tasks"}
          </span>
        </CardHeader>
        <CardContent>
          {list.length ? (
            <TaskTable tasks={list} today={ctx.today} initiatives={Object.fromEntries(initiatives.map((i) => [i.id, i.name]))} items={Object.fromEntries(((items ?? []) as Row[]).map((i) => [i.id, i.name]))} />
          ) : (
            <EmptyState title="No tasks match these filters." body="Change the filters or add a task." action={<Button asChild size="sm"><Link href="/records/tasks/new">Add task</Link></Button>} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO } from "@/lib/calc/dates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { TaskList } from "@/components/app/task-list";
import type { Row } from "@/lib/types";

export const metadata = { title: "Task lists" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const status = sp.status ?? "todo";
  const due = sp.due ?? "all";
  let q = supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("priority").limit(500);
  if (status !== "all") q = q.eq("status", status);
  if (sp.initiative) q = q.eq("initiative_id", sp.initiative);
  if (due === "overdue") q = q.lt("due_date", ctx.today);
  if (due === "today") q = q.eq("due_date", ctx.today);
  if (due === "week") q = q.gte("due_date", ctx.today).lte("due_date", addDaysISO(ctx.today, 7));
  if (due === "none") q = q.is("due_date", null);
  const [{ data: tasks }, { data: inits }] = await Promise.all([q, supabase.from("initiatives").select("id,name").order("sort_order")]);
  const list = (tasks ?? []) as Row[];
  return (
    <div>
      <PageHeader
        title="Task lists"
        description="All tasks, filterable by initiative, due date, and status."
        actions={
          <Button asChild size="sm">
            <Link href="/records/tasks/new">Add task</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <form method="get" className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <NativeSelect name="initiative" defaultValue={sp.initiative ?? ""} aria-label="Initiative">
              <option value="">All initiatives</option>
              {((inits ?? []) as Row[]).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="due" defaultValue={due} aria-label="Due date">
              <option value="all">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Due in the next 7 days</option>
              <option value="none">No due date</option>
            </NativeSelect>
            <NativeSelect name="status" defaultValue={status} aria-label="Status">
              <option value="todo">To do</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
              <option value="all">All statuses</option>
            </NativeSelect>
            <Button type="submit" variant="outline">
              Show
            </Button>
          </form>
        </CardHeader>
        <CardContent>{list.length ? <TaskList tasks={list} today={ctx.today} /> : <EmptyState title="No tasks match these filters." body="Change the filters or add a task." action={<Button asChild size="sm"><Link href="/records/tasks/new">Add task</Link></Button>} />}</CardContent>
      </Card>
    </div>
  );
}

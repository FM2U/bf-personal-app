import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { todaysMeetings } from "@/lib/engine/run";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { TaskList } from "@/components/app/task-list";
import { regeneratePlan, runTodaysJobs } from "@/app/actions/domain";
import { date as fmtDate } from "@/lib/format";
import { addDaysISO } from "@/lib/calc/dates";
import { loadTargets, summarizeTargets } from "@/lib/targets";
import { TargetCounters } from "@/components/app/target-counters";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";
import { sortTasksProprietaryFirst } from "@/lib/calc/pipeline";
import { loadDealRanks, loadDealTypes } from "@/lib/pipeline";
import { DealSourceBadge } from "@/components/app/pipeline-badges";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Today's plan" };

export default async function TodayPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: plan }, { data: tasks }, { data: actions }, { data: msTasks }, meetings] = await Promise.all([
    supabase.from("daily_plans").select("*").eq("plan_date", ctx.today).maybeSingle(),
    supabase.from("tasks").select("*").lte("due_date", ctx.today).or(`status.eq.todo,due_date.eq.${ctx.today}`).order("priority").order("due_date"),
    supabase.from("pipeline_items").select("*").eq("status", "open").not("next_action", "is", null).lte("next_action_due", ctx.today).order("next_action_due"),
    supabase.from("tasks").select("*").not("milestone_id", "is", null).eq("status", "todo").order("due_date").limit(10),
    todaysMeetings(ctx),
  ]);
  const targets = await loadTargets(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(ctx.today, -14), to: ctx.today });
  // Tasks for proprietary (off-market) deals come before brokered ones at equal priority and due date.
  const [rankOf, dealTypes] = await Promise.all([loadDealRanks(supabase, ownerId), loadDealTypes(supabase, ownerId)]);
  const list = sortTasksProprietaryFirst((tasks ?? []) as Row[], rankOf);
  const actionList = ((actions ?? []) as Row[]).sort((a, b) => (a.next_action_due === b.next_action_due ? rankOf(a.id) - rankOf(b.id) : a.next_action_due < b.next_action_due ? -1 : 1));
  return (
    <div>
      <PageHeader
        title="Today's plan"
        description="The AI's morning plan, built from due tasks, pipeline next actions, milestone tasks, and calendar meetings."
        actions={
          <>
            <GuardedForm action={runTodaysJobs}>
              <SubmitButton size="sm" variant="outline" pendingText="Creating...">
                Create today&apos;s recurring tasks now
              </SubmitButton>
            </GuardedForm>
            <GuardedForm action={regeneratePlan}>
              <SubmitButton size="sm" pendingText="Writing...">
                {plan ? "Rewrite plan" : "Write plan"}
              </SubmitButton>
            </GuardedForm>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Daily targets</CardTitle>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/accountability/targets">All targets</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <TargetCounters available={targets.available} summaries={summarizeTargets(targets, ctx.today)} back="/productivity" />
          </CardContent>
          <CardNote>Today&apos;s count for each target. Outreach counts when you log it in People, Outreach Queue.</CardNote>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Morning plan</CardTitle>
            <CardDescription>{plan ? `Written ${plan.generated_by === "ai" ? "by the AI" : "from your data (AI not available)"}.` : "Written each morning after the bank sync."}</CardDescription>
          </CardHeader>
          <CardContent>{plan ? <AiText text={plan.content} /> : <EmptyState title="No plan written yet today." body='Press "Write plan" to write it now.' />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Meetings</CardTitle>
          </CardHeader>
          <CardContent>
            {meetings === null ? (
              <p className="text-sm text-muted-foreground">
                Google is not connected. <Link href="/settings" className="underline">Connect Google</Link>.
              </p>
            ) : meetings.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {meetings.map((m) => (
                  <li key={m.id} className="grid grid-cols-[4.5rem_1fr] gap-2">
                    <span className="tabular text-muted-foreground">{m.allDay ? "All day" : new Date(m.start ?? "").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ctx.tz })}</span>
                    <span className="clamp-2">{m.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No meetings today.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Due today and overdue</CardTitle>
              <CardDescription>{fmtDate(ctx.today, "EEEE, MMMM d")}. Regular tasks not done move to the next day; commitments keep their date.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`/records/tasks/new?due_date=${ctx.today}`}>Add task</Link>
            </Button>
          </CardHeader>
          <CardContent>{list.length ? <TaskList tasks={list} today={ctx.today} dealTypes={dealTypes} /> : <EmptyState title="Nothing due today." body="Add a task, or create today's recurring tasks now." />}</CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline next actions due</CardTitle>
            </CardHeader>
            <CardContent>
              {actionList.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {actionList.map((a) => (
                    <li key={a.id}>
                      <span className="flex items-center justify-between gap-2">
                        <Link href={`/records/pipeline_items/${a.id}`} className="clamp-1 min-w-0 font-medium hover:underline">
                          {a.name}
                        </Link>
                        <DealSourceBadge type={a.deal_source_type} />
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {a.next_action} ({fmtDate(a.next_action_due, "MMM d")})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No pipeline next actions due.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Milestone tasks</CardTitle>
            </CardHeader>
            <CardContent>{(msTasks ?? []).length ? <TaskList tasks={(msTasks ?? []) as Row[]} today={ctx.today} /> : <p className="text-sm text-muted-foreground">No open milestone tasks.</p>}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

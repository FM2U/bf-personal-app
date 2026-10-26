import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { computeMetrics } from "@/lib/metrics";
import { todaysMeetings } from "@/lib/engine/run";
import { getGoogleConnection } from "@/lib/google";
import { netWorthByMonth } from "@/lib/finance";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { severityStatus } from "@/lib/status";
import { ModuleTitle } from "@/components/app/module-icon";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { TaskList } from "@/components/app/task-list";
import { Progress } from "@/components/app/charts";
import { SubmitButton } from "@/components/app/submit-button";
import { dismissAlert } from "@/app/actions/records";
import { regeneratePlan } from "@/app/actions/domain";
import { date as fmtDate, money, months as fmtMonths } from "@/lib/format";
import { addDaysISO } from "@/lib/calc/dates";
import { runwayExplanation } from "@/lib/calc/runway";
import { consecutiveCompleteDays, nextScheduledReview } from "@/lib/calc/scores";
import { scoreText } from "@/lib/calc/commitment-rule";
import { summarizeTargets } from "@/lib/targets";
import { KpiGroup, type Kpi } from "@/components/app/kpi-tiles";
import { DbUpdateNotice } from "@/components/app/target-grid";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";
import { sortTasksProprietaryFirst } from "@/lib/calc/pipeline";
import { hasPipelineUpdate, loadDealRanks, loadDealTypes } from "@/lib/pipeline";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const today = ctx.today;
  const [metrics, planRes, todayTasks, overdueTasks, overdueMs, alertsRes, budgetsRes, linesRes, proposalsRes, google, meetings, kpiExtra] = await Promise.all([
    computeMetrics(supabase, today),
    supabase.from("daily_plans").select("*").eq("plan_date", today).maybeSingle(),
    supabase.from("tasks").select("*").eq("due_date", today).order("status", { ascending: false }).order("priority"),
    supabase.from("tasks").select("*").eq("status", "todo").lt("due_date", today).order("due_date").limit(15),
    supabase.from("milestones").select("id,title,due_date,status").in("status", ["planned", "active"]).lt("due_date", today).order("due_date"),
    supabase.from("alerts").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(12),
    supabase.from("budgets").select("id").eq("is_active", true),
    supabase.from("budget_lines").select("budget_id,current_monthly,target_monthly"),
    supabase.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    getGoogleConnection(supabase, ownerId),
    todaysMeetings(ctx),
    Promise.all([
      supabase.from("pipeline_items").select("next_action_due").eq("status", "open").not("next_action", "is", null).lte("next_action_due", today),
      supabase.from("tasks").select("due_date,status").gte("due_date", addDaysISO(today, -400)).lte("due_date", today).limit(5000),
      supabase.from("missed_commitments").select("id", { count: "exact", head: true }).eq("resolution", "pending"),
      supabase.from("reviews").select("id,kind,period_end").eq("status", "draft").neq("kind", "daily").order("period_end").limit(1),
    ]),
  ]);
  const snap = metrics.snapshot;
  const target = snap.inputs.num.runway_target_months;
  const runway = snap.runway.months;
  const runwayPct = runway === null ? 100 : target ? (runway / target) * 100 : null;
  const activeBudgets = new Set(((budgetsRes.data ?? []) as Row[]).map((b) => b.id));
  const budgetTotal = ((linesRes.data ?? []) as Row[]).filter((l) => activeBudgets.has(l.budget_id)).reduce((s, l) => s + Number(l.current_monthly), 0);
  // Tasks for proprietary (off-market) deals come before brokered ones at equal priority and due date.
  const [rankOf, dealTypes, pipelineUpdate] = await Promise.all([loadDealRanks(supabase, ownerId), loadDealTypes(supabase, ownerId), hasPipelineUpdate(supabase)]);
  const tasks = sortTasksProprietaryFirst((todayTasks.data ?? []) as Row[], rankOf, { doneLast: true, status: (t) => t.status });
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const alerts = (alertsRes.data ?? []) as Row[];
  const overdue = sortTasksProprietaryFirst((overdueTasks.data ?? []) as Row[], rankOf);
  const overdueMilestones = (overdueMs.data ?? []) as Row[];
  const nw = await netWorthByMonth(supabase, today, 6);
  const hasAccounts = snap.accounts.length > 0;

  // KPI tiles
  const [pipeRes, streakRes, missRes, draftRes] = kpiExtra;
  const pipeDue = (pipeRes.data ?? []) as Row[];
  const pipeOverdue = pipeDue.filter((p) => p.next_action_due < today).length;
  const streak = consecutiveCompleteDays((streakRes.data ?? []) as { due_date: string; status: string }[], today);
  const dayTargets = summarizeTargets(metrics.targets, today).filter((t) => t.target.period === "day" && t.today.status !== "off");
  const targetsMet = dayTargets.filter((t) => t.today.status === "met").length;
  const sourced = summarizeTargets(metrics.targets, today).find((t) => t.target.count_source === "deals_sourced" && t.target.active);
  const score = metrics.values.commitment_score_week;
  const draftReview = ((draftRes.data ?? []) as Row[])[0];
  const scheduled = nextScheduledReview(today, Number(ctx.profile.weekly_review_weekday ?? 0));
  const REVIEW_NAME: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };
  const productivityTiles: Kpi[] = [
    { label: "Tasks done today", value: tasks.length ? `${doneCount} of ${tasks.length}` : "None due", href: "/productivity", tone: tasks.length && doneCount === tasks.length ? "good" : undefined, hint: tasks.length ? `${tasks.length - doneCount} left` : undefined },
    {
      label: "Targets met today",
      value: !metrics.targets.available ? "Not yet" : dayTargets.length ? `${targetsMet} of ${dayTargets.length}` : "None",
      href: "/accountability/targets",
      tone: !metrics.targets.available ? "warn" : dayTargets.length && targetsMet === dayTargets.length ? "good" : undefined,
      hint: !metrics.targets.available ? "Update needed" : dayTargets.length ? dayTargets.map((t) => `${t.target.name} ${t.today.count}/${t.today.required}`).join(", ") : "No daily targets today",
    },
    { label: "Pipeline actions due", value: pipeDue.length, href: "/productivity/pipeline-actions", tone: pipeOverdue ? "bad" : undefined, hint: pipeOverdue ? `${pipeOverdue} overdue` : "Today or earlier" },
  ];
  if (sourced) {
    productivityTiles.splice(2, 0, {
      label: "Deals sourced today",
      value: sourced.today.status === "off" ? "Not today" : `${sourced.today.count} of ${sourced.today.required}`,
      href: "/accountability/targets",
      tone: sourced.today.status === "met" ? "good" : undefined,
      hint: sourced.breakdown ? `${sourced.breakdown.proprietary} proprietary, ${sourced.breakdown.brokered} brokered` : undefined,
    });
  }
  const accountabilityTiles: Kpi[] = [
    { label: "Commitment score this week", value: scoreText(score), href: "/accountability/scores", tone: score !== null && score !== undefined && score < 70 ? "bad" : undefined, hint: score === null || score === undefined ? "None due yet this week" : "Includes targets" },
    { label: "Days in a row with every task done", value: streak, href: "/accountability/scores", tone: streak ? "good" : undefined },
    { label: "Open missed commitments", value: missRes.count ?? 0, href: "/accountability", tone: missRes.count ? "bad" : undefined, hint: missRes.count ? "Reason needed" : undefined },
    draftReview
      ? { label: "Next review due", value: REVIEW_NAME[draftReview.kind] ?? "Review", href: `/accountability/reviews/${draftReview.id}`, tone: "warn", hint: `Due now, draft ready` }
      : { label: "Next review due", value: REVIEW_NAME[scheduled.kind], href: "/accountability/reviews", hint: scheduled.date === today ? "Today" : fmtDate(scheduled.date, "EEE, MMM d") },
  ];

  return (
    <div>
      <PageHeader title="Home" description={`${fmtDate(today, "EEEE, MMMM d, yyyy")}. Runway, today's plan, meetings, overdue items, and alerts.`} />
      <div className={`mb-4 grid grid-cols-1 gap-4 ${productivityTiles.length > 3 ? "xl:grid-cols-2" : "lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]"}`}>
        <KpiGroup title="Productivity" module="productivity" tiles={productivityTiles} cols={productivityTiles.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"} />
        <KpiGroup title="Accountability" module="accountability" tiles={accountabilityTiles} cols="grid-cols-2 sm:grid-cols-4" />
      </div>
      {!metrics.targets.available || !pipelineUpdate ? (
        <div className="mb-4">
          <DbUpdateNotice />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>
              <ModuleTitle module="finance">Runway</ModuleTitle>
            </CardDescription>
            <CardTitle className="text-3xl tabular">{hasAccounts ? fmtMonths(runway) : "No data yet"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {hasAccounts ? (
              <>
                <Progress value={runwayPct} tone={runwayPct !== null && runwayPct < 50 ? "red" : runwayPct !== null && runwayPct < 100 ? "amber" : "green"} />
                <StatGrid className="grid-cols-3">
                  <Stat label="Target" value={target ? `${target} months` : "Not set"} />
                  <Stat label="Available cash" value={money(snap.cash)} />
                  <Stat label="Net monthly burn" value={money(snap.runway.netMonthlyBurn)} />
                </StatGrid>
              </>
            ) : (
              <EmptyState title="Add an account and its balance to calculate runway." action={<Button asChild size="sm"><Link href="/records/accounts/new">Add account</Link></Button>} />
            )}
          </CardContent>
          {hasAccounts ? (
            <CardNote>
              {runwayExplanation({
                lookbackMonths: snap.inputs.num.runway_lookback_months ?? 3,
                subtractIncome: (snap.inputs.num.runway_subtract_income ?? 1) >= 1,
                includeSignedConsulting: snap.includeSignedConsulting,
                signedConsultingMonthly: snap.runway.signedConsultingMonthly,
                settingAvailable: "runway_include_signed_consulting" in snap.inputs.num,
              })}
            </CardNote>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>
              <ModuleTitle module="finance">This month</ModuleTitle>
            </CardDescription>
            <CardTitle className="text-3xl tabular">{money(snap.monthSpending)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={budgetTotal ? (snap.monthSpending / budgetTotal) * 100 : 0} tone={budgetTotal && snap.monthSpending > budgetTotal ? "red" : "teal"} />
            <StatGrid className="grid-cols-3">
              <Stat label="Monthly budget" value={budgetTotal ? money(budgetTotal) : "Not set"} />
              <Stat label="Remaining" value={budgetTotal ? money(budgetTotal - snap.monthSpending) : "Not set"} tone={budgetTotal && snap.monthSpending > budgetTotal ? "bad" : undefined} />
              <Stat label="Savings from reduction actions" value={`${money(metrics.values.savings_achieved_monthly)}/mo`} tone="good" />
            </StatGrid>
            {!budgetTotal ? (
              <Link href="/finance/budget" className="text-sm text-teal-800 hover:underline">
                Set a budget per category
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card id="alerts" className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <ModuleTitle module="home">Alerts</ModuleTitle> {alerts.length ? <Badge variant="danger">{alerts.length}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length ? (
              <ul className="flex flex-col divide-y divide-slate-100">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 py-2">
                    <StatusDot status={severityStatus(a.severity)} className="mt-1.5" />
                    <Link href={a.href ?? "/"} className="clamp-2 min-w-0 flex-1 text-sm hover:underline">
                      {a.message}
                    </Link>
                    <GuardedForm action={dismissAlert}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="rounded p-1 text-muted-foreground hover:bg-slate-100" aria-label="Dismiss alert">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </GuardedForm>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No open alerts.</p>
            )}
          </CardContent>
          <CardNote>Decision conditions met, missed commitments, pipeline items that need action, broken connections.</CardNote>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>
                <ModuleTitle module="productivity">Today</ModuleTitle>
              </CardTitle>
              <CardDescription>
                The morning plan and today&apos;s required tasks. {tasks.length ? `${doneCount} of ${tasks.length} done.` : ""}
              </CardDescription>
            </div>
            <GuardedForm action={regeneratePlan}>
              <SubmitButton size="sm" variant="outline" pendingText="Writing plan...">
                {planRes.data ? "Rewrite plan" : "Write today's plan"}
              </SubmitButton>
            </GuardedForm>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Morning plan {planRes.data?.generated_by === "ai" ? "(AI)" : ""}</p>
              {planRes.data ? (
                <AiText text={planRes.data.content} className="rounded-md bg-slate-50 p-3" />
              ) : (
                <p className="text-sm text-muted-foreground">The plan is written each morning after the bank sync. Press &quot;Write today&apos;s plan&quot; to write it now.</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks due today</p>
              {tasks.length ? (
                <TaskList tasks={tasks} today={today} showDue={false} dealTypes={dealTypes} />
              ) : (
                <EmptyState title="No tasks due today." body="Recurring tasks are created each morning. Add a task for anything else due today." action={<Button asChild size="sm" variant="outline"><Link href={`/records/tasks/new?due_date=${today}`}>Add task</Link></Button>} />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <ModuleTitle module="productivity">Today&apos;s meetings</ModuleTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {meetings === null ? (
              <EmptyState title={google?.status === "error" ? "The Google connection failed." : "Google is not connected."} body="Connect Google to see today's meetings here." action={<Button asChild size="sm" variant="outline"><Link href="/settings">Open Connections</Link></Button>} />
            ) : meetings.length ? (
              <ul className="flex flex-col divide-y divide-slate-100">
                {meetings.map((m) => (
                  <li key={m.id} className="grid grid-cols-[4.5rem_1fr] gap-2 py-2 text-sm">
                    <span className="tabular text-muted-foreground">{m.allDay ? "All day" : new Date(m.start ?? "").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ctx.tz })}</span>
                    {m.link ? (
                      <a href={m.link} target="_blank" rel="noreferrer" className="clamp-2 hover:underline">
                        {m.title}
                      </a>
                    ) : (
                      <span className="clamp-2">{m.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No meetings today.</p>
            )}
          </CardContent>
          <CardNote>From Google Calendar.</CardNote>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <ModuleTitle module="productivity">Overdue</ModuleTitle> {overdue.length + overdueMilestones.length ? <Badge variant="danger">{overdue.length + overdueMilestones.length}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {overdueMilestones.length ? (
              <ul className="flex flex-col gap-1">
                {overdueMilestones.map((m) => (
                  <li key={m.id} className="text-sm">
                    <Link href={`/records/milestones/${m.id}`} className="font-medium text-status-missed hover:underline">
                      Milestone: {m.title}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">due {fmtDate(m.due_date)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {overdue.length ? <TaskList tasks={overdue} today={today} dealTypes={dealTypes} /> : null}
            {!overdue.length && !overdueMilestones.length ? <p className="text-sm text-muted-foreground">Nothing overdue.</p> : null}
          </CardContent>
          <CardNote>Tasks and milestones past their due date.</CardNote>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <ModuleTitle module="finance">Net worth</ModuleTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <StatGrid className="grid-cols-3">
              <Stat label="Net worth" value={money(snap.netWorth.netWorth)} />
              <Stat label="Assets" value={money(snap.netWorth.assets)} />
              <Stat label="Debts" value={money(snap.netWorth.liabilities)} />
            </StatGrid>
            <p className="text-xs text-muted-foreground">
              6 months ago: {money(nw[0]?.netWorth ?? 0)}. Emergency fund: {Math.round(snap.emergencyFund.pct ?? 0)}% of target.
            </p>
            <Link href="/finance/savings" className="inline-flex items-center gap-1 text-sm text-teal-800 hover:underline">
              Savings and financial security <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
          <CardNote>Assets minus debts.</CardNote>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <ModuleTitle module="settings">AI proposals</ModuleTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-3">
              <Stat label="Waiting for approval" value={proposalsRes.count ?? 0} />
              <Button asChild size="sm" variant="outline">
                <Link href="/proposals">Review proposals</Link>
              </Button>
            </div>
          </CardContent>
          <CardNote>Changes the AI suggested. Nothing is saved until you approve it.</CardNote>
        </Card>
      </div>
    </div>
  );
}

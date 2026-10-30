import Link from "next/link";
import { ArrowRight, CalendarClock, ChevronRight, Sparkles, X } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { computeMetrics } from "@/lib/metrics";
import { todaysMeetings } from "@/lib/engine/run";
import { getGoogleConnection } from "@/lib/google";
import { loadRunwayHistory, netWorthByMonth } from "@/lib/finance";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { severityStatus } from "@/lib/status";
import { ModuleTitle } from "@/components/app/module-icon";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { TaskList } from "@/components/app/task-list";
import { Progress, RunwayTrendChart, WeekSpendChart } from "@/components/app/charts";
import { SubmitButton } from "@/components/app/submit-button";
import { dismissAlert } from "@/app/actions/records";
import { regeneratePlan } from "@/app/actions/domain";
import { OpenReviewButton } from "@/components/app/open-review-button";
import { date as fmtDate, money, months as fmtMonths } from "@/lib/format";
import { addDaysISO, isWeekday } from "@/lib/calc/dates";
import { runwayExplanation } from "@/lib/calc/runway";
import { consecutiveCompleteDays, nextScheduledReview } from "@/lib/calc/scores";
import { scoreText } from "@/lib/calc/commitment-rule";
import { summarizeTargets } from "@/lib/targets";
import { listingsTarget } from "@/lib/deal-funnel";
import { CountButtons } from "@/components/app/listing-buttons";
import { KpiGroup, type Kpi } from "@/components/app/kpi-tiles";
import { DbUpdateNotice } from "@/components/app/target-grid";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";
import { sortTasksProprietaryFirst } from "@/lib/calc/pipeline";
import { hasPipelineUpdate, loadDealRanks, loadDealTypes } from "@/lib/pipeline";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { loadSavingsIdeas } from "@/lib/engine/savings-ideas";
import { splitMorningPlan } from "@/lib/morning-plan";
import { WorkThroughTasksButton } from "@/components/app/work-through-button";
import { SuggestionLine } from "@/components/app/suggestion-line";
import { homeSuggestion } from "@/lib/suggestions";
import { firstSuggestion } from "@/lib/suggestions-server";
import { monthSpendingBreakdown } from "@/lib/calc/month-spending";
import { loadTodaysBlocks } from "@/lib/engine/time-blocks";

export const metadata = { title: "Old Home" };

/**
 * The previous home page (number tiles, runway, this month, alerts, the morning plan, meetings, overdue, net worth,
 * AI proposals), kept at /more/old-home. The focused version (2026-10-30) put Today at "/" instead
 * (src/app/(app)/page.tsx); nothing here was deleted.
 */
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
    supabase.from("budget_lines").select("budget_id,category_id,current_monthly,target_monthly"),
    supabase.from("ai_proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    getGoogleConnection(supabase, ownerId),
    todaysMeetings(ctx),
    Promise.all([
      supabase.from("pipeline_items").select("next_action_due").eq("status", "open").not("next_action", "is", null).lte("next_action_due", today),
      supabase.from("tasks").select("due_date,status").gte("due_date", addDaysISO(today, -400)).lte("due_date", today).limit(5000),
      supabase.from("missed_commitments").select("id", { count: "exact", head: true }).eq("resolution", "pending"),
      supabase.from("reviews").select("id,kind,period_end").eq("status", "draft").neq("kind", "daily").order("period_end").limit(1),
      supabase.from("reviews").select("id,status").eq("kind", "daily").eq("period_start", today).order("created_at", { ascending: false }).limit(1),
    ]),
  ]);
  const snap = metrics.snapshot;
  const hasAccounts = snap.accounts.length > 0;
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
  const [nw, runwayTrend] = await Promise.all([netWorthByMonth(supabase, today, 6), hasAccounts ? loadRunwayHistory(supabase, snap).catch(() => []) : Promise.resolve([])]);
  const trendData = runwayTrend.map((p) => ({ label: p.now ? "Now" : fmtDate(`${p.month}-01`, "MMM"), months: p.months, now: p.now }));
  const plan = planRes.data ? splitMorningPlan(String(planRes.data.content ?? "")) : null;
  const openToday = tasks.filter((t) => t.status !== "done").length + overdue.length;
  const ideas = await loadSavingsIdeas(supabase);
  const ideaSavings = ideas.pending.reduce((sum, i) => sum + Number(i.estimated_monthly_savings ?? 0), 0);
  const { count: draftCount } = ideas.available ? await supabase.from("initiative_drafts").select("id", { count: "exact", head: true }).eq("status", "draft") : { count: 0 };
  const waiting = (proposalsRes.count ?? 0) + ideas.pending.length + (draftCount ?? 0);

  // This month: spending by week against the budget, and the top 3 categories.
  const activeLines = ((linesRes.data ?? []) as Row[]).filter((l) => activeBudgets.has(l.budget_id));
  const [{ data: catRows }, todaysBlocks] = await Promise.all([supabase.from("categories").select("id,name"), loadTodaysBlocks(supabase, ownerId, today).catch(() => [])]);
  const month = monthSpendingBreakdown({
    transactions: snap.transactions as { date: string; amount: number; is_transfer: boolean; category_id: string | null; account_id: string }[],
    accountIds: snap.runwayAccountIds,
    today,
    budgetTotal,
    categoryNames: Object.fromEntries(((catRows ?? []) as Row[]).map((c) => [c.id, c.name])),
    categoryBudgets: Object.fromEntries(activeLines.filter((l) => l.category_id).map((l) => [l.category_id, Number(l.current_monthly)])),
  });
  const blocksWaiting = todaysBlocks.filter((b) => b.state === "suggested").length;
  // One suggestion line: today's top priority (from the morning plan, or the first open task).
  const suggestion = await firstSuggestion([
    homeSuggestion({ today, plan: plan?.main ?? null, firstTask: [...overdue, ...tasks].find((t) => t.status !== "done")?.title ?? null, openCount: openToday }),
  ]);

  // KPI tiles
  const [pipeRes, streakRes, missRes, draftRes, closeRes] = kpiExtra;
  // Weekdays: the daily close comes first until it is completed today.
  const todaysClose = ((closeRes.data ?? []) as Row[])[0];
  const closeDue = isWeekday(today) && todaysClose?.status !== "completed";
  const pipeDue = (pipeRes.data ?? []) as Row[];
  const pipeOverdue = pipeDue.filter((p) => p.next_action_due < today).length;
  const streak = consecutiveCompleteDays((streakRes.data ?? []) as { due_date: string; status: string }[], today);
  const dayTargets = summarizeTargets(metrics.targets, today).filter((t) => t.target.period === "day" && t.today.status !== "off");
  const targetsMet = dayTargets.filter((t) => t.today.status === "met").length;
  const sourced = summarizeTargets(metrics.targets, today).find((t) => t.target.count_source === "deals_sourced" && t.target.active);
  const listing = listingsTarget(summarizeTargets(metrics.targets, today));
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
  if (listing) {
    productivityTiles.splice(sourced ? 3 : 2, 0, {
      label: `${listing.target.name} today`,
      value: listing.today.status === "off" ? `${listing.today.count}, not today` : `${listing.today.count} of ${listing.today.required}`,
      href: "/accountability/targets",
      tone: listing.today.status === "met" ? "good" : undefined,
      actions: <CountButtons targetId={listing.target.id} back="/more/old-home" label={listing.target.name} stretch short className="flex-nowrap" />,
      wide: true,
      testId: "home-listings",
    });
  }
  const wideProductivity = productivityTiles.length > 4;
  const accountabilityTiles: Kpi[] = [
    { label: "Commitment score this week", value: scoreText(score), href: "/accountability/scores", tone: score !== null && score !== undefined && score < 70 ? "bad" : undefined, hint: score === null || score === undefined ? "None due yet this week" : "Includes targets" },
    { label: "Days in a row with every task done", value: streak, href: "/accountability/scores", tone: streak ? "good" : undefined },
    { label: "Open missed commitments", value: missRes.count ?? 0, href: "/accountability?status=missed", tone: missRes.count ? "bad" : undefined, hint: missRes.count ? "Reason needed" : undefined },
    closeDue
      ? { label: "Next review due", value: "Daily close", href: todaysClose ? `/accountability/reviews/${todaysClose.id}` : "/accountability/reviews/today", hint: "Today", testId: "home-next-review" }
      : draftReview
      ? { label: "Next review due", value: REVIEW_NAME[draftReview.kind] ?? "Review", href: `/accountability/reviews/${draftReview.id}`, tone: "warn", hint: `Due now, draft ready`, testId: "home-next-review" }
      : { label: "Next review due", value: REVIEW_NAME[scheduled.kind], href: "/accountability/reviews", hint: scheduled.date === today ? "Today" : fmtDate(scheduled.date, "EEE, MMM d"), testId: "home-next-review" },
  ];

  return (
    <div>
      <PageHeader
        title="Old Home"
        description={`${fmtDate(today, "EEEE, MMMM d, yyyy")}. Runway, today's plan, meetings, overdue items, and alerts. The new home screen is Today.`}
        actions={
          <Button asChild size="sm">
            <Link href="/plan/start" data-window="setup" data-testid="home-start-initiative">
              <Sparkles /> Start an initiative
            </Link>
          </Button>
        }
      />
      {suggestion ? <SuggestionLine s={suggestion} context={{ label: "Home: today's plan" }} className="mb-4" /> : null}
      {/* Five productivity tiles (with Listings screened and its buttons) take their own row; four or fewer sit beside Accountability. */}
      <div className={`mb-4 grid grid-cols-1 gap-4 ${wideProductivity ? "" : productivityTiles.length > 3 ? "xl:grid-cols-2" : "lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]"}`}>
        <KpiGroup title="Productivity" module="productivity" tiles={productivityTiles} cols={wideProductivity ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : productivityTiles.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"} />
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
                {trendData.length > 1 ? (
                  <div className="border-t border-slate-100 pt-2">
                    <p className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
                      <span>Months of runway at each month end</span>
                      <span className="flex items-center gap-3 font-normal text-slate-500">
                        <span className="flex items-center gap-1">
                          <span aria-hidden className="h-0.5 w-3 rounded bg-primary" /> Runway
                        </span>
                        {target ? (
                          <span className="flex items-center gap-1">
                            <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-gold" /> Target
                          </span>
                        ) : null}
                      </span>
                    </p>
                    <RunwayTrendChart data={trendData} target={target ?? null} />
                  </div>
                ) : null}
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
            <Progress value={budgetTotal ? (snap.monthSpending / budgetTotal) * 100 : 0} tone={budgetTotal && snap.monthSpending > budgetTotal ? "red" : "primary"} />
            <StatGrid className="grid-cols-3">
              <Stat label="Monthly budget" value={budgetTotal ? money(budgetTotal) : "Not set"} />
              <Stat label="Remaining" value={budgetTotal ? money(budgetTotal - snap.monthSpending) : "Not set"} tone={budgetTotal && snap.monthSpending > budgetTotal ? "bad" : undefined} />
              <Stat label="Savings from reduction actions" value={`${money(metrics.values.savings_achieved_monthly)}/mo`} tone="good" />
            </StatGrid>
            {!budgetTotal ? (
              <Link href="/finance/budget" className="text-sm text-primary-strong hover:underline">
                Set a budget per category
              </Link>
            ) : null}
            <div className="border-t border-slate-100 pt-2" data-testid="home-month-weeks">
              <p className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
                <span>Spending by week (days of the month)</span>
                <span className="flex items-center gap-3 font-normal text-slate-500">
                  <span className="flex items-center gap-1">
                    <span aria-hidden className="h-2 w-2 rounded-sm bg-primary" /> Spent
                  </span>
                  {budgetTotal ? (
                    <span className="flex items-center gap-1">
                      <span aria-hidden className="h-2 w-2 rounded-sm bg-slate-400/40" /> Budget
                    </span>
                  ) : null}
                </span>
              </p>
              <WeekSpendChart data={month.weeks} />
            </div>
            {month.categories.length ? (
              <div className="border-t border-slate-100 pt-2" data-testid="home-month-categories">
                <p className="mb-1.5 text-xs font-medium text-slate-700">Top categories this month</p>
                <ul className="flex flex-col gap-2">
                  {month.categories.map((c) => (
                    <li key={c.id ?? "none"} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 text-sm">
                      <Link href={c.id ? `/finance/expenses?category=${c.id}` : "/finance/expenses?category=none"} className="clamp-1 text-slate-800 hover:underline">
                        {c.name}
                      </Link>
                      <span className="tabular text-slate-900">
                        {money(c.spent)}
                        {c.budget ? <span className="text-xs text-muted-foreground"> of {money(c.budget)}</span> : null}
                      </span>
                      {c.budget ? (
                        <span className="col-span-2">
                          <Progress value={(c.spent / c.budget) * 100} tone={c.spent > c.budget ? "red" : "primary"} />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
          <CardNote>Money out this month (not transfers), in the accounts counted in runway.</CardNote>
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

        <Card className="md:col-span-2" id="today">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle>
                <ModuleTitle module="productivity">Today</ModuleTitle>
              </CardTitle>
              <CardDescription>
                The morning plan and today&apos;s required tasks. {tasks.length ? `${doneCount} of ${tasks.length} done.` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <WorkThroughTasksButton count={openToday} />
              <OpenReviewButton kind="daily" size="sm" variant="outline">
                Daily close
              </OpenReviewButton>
              <GuardedForm action={regeneratePlan}>
                <SubmitButton size="sm" variant="outline" pendingText="Writing plan...">
                  {planRes.data ? "Rewrite plan" : "Write today's plan"}
                </SubmitButton>
              </GuardedForm>
            </div>
          </CardHeader>
          {blocksWaiting ? (
            <div className="mx-5 mb-3">
              <Link href="/productivity/calendar#suggested" className="inline-flex items-center gap-2 rounded-md border border-primary-border bg-primary-soft/60 px-3 py-1.5 text-sm text-slate-800 hover:bg-primary-soft" data-testid="home-time-blocks">
                <CalendarClock aria-hidden className="h-4 w-4 text-primary-strong" />
                {blocksWaiting} time block{blocksWaiting === 1 ? "" : "s"} suggested. <span className="font-medium text-primary-strong">Review and approve</span>
              </Link>
            </div>
          ) : null}
          <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Morning plan {planRes.data?.generated_by === "ai" ? "(AI)" : ""}</p>
              {plan ? (
                <div className="flex flex-col gap-2 rounded-md bg-slate-50 p-3" data-testid="morning-plan">
                  <AiText text={plan.main} />
                  {plan.rest || dayTargets.length || meetings?.length ? (
                    <details className="group border-t border-slate-200 pt-2" data-testid="morning-plan-more">
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline [&::-webkit-details-marker]:hidden">
                        <ChevronRight aria-hidden className="h-4 w-4 transition-transform group-open:rotate-90" /> Show all
                        <span className="font-normal text-muted-foreground">
                          ({[dayTargets.length ? "daily targets" : null, meetings?.length ? "meetings" : null, plan.rest ? "the rest of the plan" : null].filter(Boolean).join(", ")})
                        </span>
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        {dayTargets.length ? (
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Daily targets</p>
                            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-slate-800">
                              {dayTargets.map((t) => (
                                <li key={t.target.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                                  <span className="clamp-1">{t.target.name}</span>
                                  <span className={`tabular ${t.today.status === "met" ? "text-status-met" : "text-slate-700"}`}>
                                    {t.today.count} of {t.today.required}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {meetings?.length ? (
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Meetings</p>
                            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-slate-800">
                              {meetings.map((m) => (
                                <li key={m.id} className="clamp-1">
                                  {m.title}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {plan.rest ? <AiText text={plan.rest} /> : null}
                      </div>
                    </details>
                  ) : null}
                </div>
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
            <Link href="/finance/savings" className="inline-flex items-center gap-1 text-sm text-primary-strong hover:underline">
              Savings and financial security <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
          <CardNote>Assets minus debts.</CardNote>
        </Card>

        <Card id="ai-proposals">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <ModuleTitle module="settings">AI proposals</ModuleTitle> {waiting ? <Badge variant="default" data-testid="ai-proposals-count">{waiting}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <StatGrid className="grid-cols-3">
              <Stat label="Changes waiting" value={proposalsRes.count ?? 0} />
              <Stat label="Savings ideas" value={ideas.available ? ideas.pending.length : "Not yet"} hint={ideaSavings ? `About ${money(ideaSavings)}/mo` : undefined} tone={ideaSavings ? "good" : undefined} />
              <Stat label="Initiative drafts" value={ideas.available ? draftCount ?? 0 : "Not yet"} />
            </StatGrid>
            {ideas.pending.length ? (
              <ul className="flex flex-col divide-y divide-slate-100" data-testid="home-savings-ideas">
                {ideas.pending.slice(0, 3).map((i) => (
                  <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-1.5 text-sm">
                    <Link href="/finance/expenses#savings-ideas" className="clamp-1 hover:underline">
                      {i.title}
                    </Link>
                    <span className="tabular text-status-met">{money(i.estimated_monthly_savings)}/mo</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/proposals">Review proposals</Link>
              </Button>
              {ideas.pending.length ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/finance/expenses#savings-ideas">Savings ideas</Link>
                </Button>
              ) : null}
              {draftCount ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/plan/start">Initiative drafts</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
          <CardNote>Changes, savings ideas, and initiative plans the AI suggested. Nothing is saved until you approve it.</CardNote>
        </Card>
      </div>
    </div>
  );
}

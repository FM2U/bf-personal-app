import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { dailyCloseTargets } from "@/lib/engine/reviews";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Notice, PageHeader, Stat } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { TaskList } from "@/components/app/task-list";
import { saveReview } from "@/app/actions/domain";
import { date as fmtDate, dateTime, money, months as fmtMonths } from "@/lib/format";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";

const TITLE: Record<string, string> = { daily: "Daily close", weekly: "Weekly review", monthly: "Monthly review", quarterly: "Quarterly review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const { data: review } = await supabase.from("reviews").select("*").eq("id", id).maybeSingle();
  if (!review) notFound();
  const d = (review.data_snapshot ?? {}) as Row;
  const a = (review.answers ?? {}) as Row;
  const done = review.status === "completed";
  let liveTasks: Row[] = [];
  if (review.kind === "daily" && (d.tasks ?? []).length) {
    const { data } = await supabase.from("tasks").select("*").in("id", (d.tasks as Row[]).map((t) => t.id));
    liveTasks = (data ?? []) as Row[];
  }
  // Daily close: each daily target for that day, met or missed, counted live from the records.
  const closeTargets = review.kind === "daily" ? await dailyCloseTargets(await loadCtx(supabase, ownerId), review.period_start) : null;
  const check = (name: string, label: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={`a_${name}`} value="yes" defaultChecked={a[name] === "yes"} disabled={done} className="mt-0.5 h-4 w-4 accent-teal-700" />
      <span>{label}</span>
    </label>
  );
  const text = (name: string, label: string, rows = 3) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Textarea name={`a_${name}`} rows={rows} defaultValue={a[name] ?? ""} disabled={done} />
    </label>
  );
  return (
    <div>
      <Link href="/accountability/reviews" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" /> Reviews
      </Link>
      <PageHeader
        title={`${TITLE[review.kind]}: ${fmtDate(review.period_start)}${review.period_end !== review.period_start ? ` to ${fmtDate(review.period_end)}` : ""}`}
        description={done ? `Completed ${dateTime(review.completed_at)}.` : "Drafted from your data. Read the draft, answer each section, and complete the review."}
        actions={<Badge variant={done ? "success" : "warning"}>{done ? "Completed" : "Draft"}</Badge>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Draft {review.draft_source === "ai" ? "(AI)" : "(from your data)"}</CardTitle>
              <CardDescription>{review.draft_source === "ai" ? "Written by the AI from the numbers below." : "The AI was not available, so this draft lists the numbers directly."}</CardDescription>
            </CardHeader>
            <CardContent>
              <AiText text={review.ai_draft} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Numbers at the time of the draft</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Stat label="Runway" value={fmtMonths(d.runway_months)} />
              <Stat label="Cash" value={money(d.cash)} />
              <Stat label="Average monthly spending" value={money(d.avg_spending)} />
              <Stat label="Average monthly income" value={money(d.avg_income)} />
              {d.score ? <Stat label="Commitment score" value={d.score.pct === null ? "No commitments due" : `${d.score.pct}%`} /> : null}
              {d.budget ? <Stat label="Spent vs. budget" value={`${money(d.budget.totals.actual)} / ${money(d.budget.totals.current)}`} /> : null}
              {d.outreach ? <Stat label="Outreach reply rate" value={d.outreach.replyRatePct === null ? "No outreach" : `${d.outreach.replyRatePct}%`} hint={`${d.outreach.sent} sent`} /> : null}
              {d.outreach ? <Stat label="Meetings booked from outreach" value={d.outreach.meetings} /> : null}
              {d.outreach && d.outreach.dealSourcingSharePct !== null && d.outreach.dealSourcingSharePct !== undefined ? (
                <Stat label="Outreach asking about deals" value={`${d.outreach.dealSourcingSharePct}%`} hint={`${d.outreach.dealSourcing} of ${d.outreach.sent}`} />
              ) : null}
              {d.deal_sourcing ? <Stat label="Deals sourced: proprietary, brokered" value={`${d.deal_sourcing.proprietary}, ${d.deal_sourcing.brokered}`} hint={`${d.deal_sourcing.sourced} in total`} /> : null}
              {d.deal_sourcing ? <Stat label="Proprietary share of deals sourced" value={d.deal_sourcing.proprietary_share_pct === null ? "No deals" : `${d.deal_sourcing.proprietary_share_pct}%`} /> : null}
              {d.stalled_items ? <Stat label="Stalled pipeline items" value={(d.stalled_items as Row[]).length} tone={(d.stalled_items as Row[]).length ? "bad" : "good"} /> : null}
            </CardContent>
          </Card>
          {review.kind !== "daily" && (d.targets ?? []).length ? (
            <Card>
              <CardHeader>
                <CardTitle>Daily targets this period</CardTitle>
                <CardDescription>Total done against the total required on active days.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col divide-y divide-slate-100">
                {(d.targets as Row[]).map((t) => (
                  <div key={t.id} className="grid grid-cols-3 gap-3 py-2 first:pt-0">
                    <span className="clamp-2 text-sm font-medium">{t.name}</span>
                    <Stat label="Done vs required" value={`${t.total} / ${t.required}`} />
                    <Stat label={t.period === "week" ? "Weeks met" : "Days met"} value={`${t.met} of ${t.met + t.missed}`} tone={t.missed ? "bad" : "good"} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Your review</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveReview} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={review.id} />
              {review.kind === "daily" ? (
                <>
                  <div>
                    <p className="mb-2 text-sm font-medium">Today&apos;s tasks (check off what is done)</p>
                    {liveTasks.length ? <TaskList tasks={liveTasks} today={review.period_start} showDue={false} /> : <p className="text-sm text-muted-foreground">No tasks were due today.</p>}
                  </div>
                  {liveTasks.filter((t) => t.status !== "done").length ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">A reason for each task not done</p>
                      {liveTasks
                        .filter((t) => t.status !== "done")
                        .map((t) => (
                          <label key={t.id} className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center">
                            <span className="clamp-2">{t.title}</span>
                            <Input name={`a_reason_${t.id}`} defaultValue={a[`reason_${t.id}`] ?? ""} placeholder="One-line reason" disabled={done} />
                          </label>
                        ))}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Daily targets today (a missed target needs a one-line reason)</p>
                    {closeTargets && !closeTargets.available ? <DbUpdateNotice compact /> : null}
                    {closeTargets?.available && !closeTargets.targets.length ? <p className="text-sm text-muted-foreground">No daily targets apply today.</p> : null}
                    {closeTargets?.targets.map((t) => (
                      <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem] items-center gap-x-2 gap-y-1 text-sm sm:grid-cols-[minmax(0,10rem)_3.5rem_4.5rem_minmax(0,1fr)]">
                        <span className="clamp-2">{t.name}</span>
                        <span className="tabular text-muted-foreground">
                          {t.count} of {t.required}
                        </span>
                        <span>
                          <Badge variant={t.status === "met" ? "success" : "danger"}>{t.status === "met" ? "Met" : "Missed"}</Badge>
                        </span>
                        <div className="col-span-3 sm:col-span-1">
                          {t.status === "missed" ? (
                            <Input name={`a_target_reason_${t.id}`} defaultValue={a[`target_reason_${t.id}`] ?? t.reason ?? ""} placeholder="One-line reason (required)" maxLength={200} disabled={done} aria-label={`Reason for ${t.name}`} />
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.period === "week" ? "Weekly minimum reached." : "Minimum reached."}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Tomorrow&apos;s top 3 tasks (created as high-priority tasks due tomorrow)</p>
                    {[1, 2, 3].map((n) => (
                      <Input key={n} name={`a_top_${n}`} defaultValue={a[`top_${n}`] ?? (d.tomorrow_candidates?.[n - 1]?.title ?? "")} placeholder={`Task ${n}`} disabled={done} />
                    ))}
                  </div>
                </>
              ) : null}
              {review.kind === "weekly" ? (
                <>
                  {text("changes", "What changed this week")}
                  {(d.missed_commitments ?? []).length ? <Notice tone="warn">{(d.missed_commitments as Row[]).length} commitments were missed this week. Each needs a reason and a new date or decision on the Commitments page.</Notice> : null}
                  {text("pipeline", "Pipeline movement and next steps")}
                  {text("spending", "Spending vs. budget: what to change")}
                  {text("priorities", "Next week's priorities")}
                  {check("partner_report_reviewed", "Partner report drafts reviewed (Accountability, Partner reports)")}
                </>
              ) : null}
              {review.kind === "monthly" ? (
                <>
                  {text("budget", "Budget vs. actual: notes")}
                  {text("net_worth", "Net worth change and savings progress: notes")}
                  {(d.debts ?? []).length ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">Debt payments confirmed</p>
                      {(d.debts as Row[]).map((debt) => check(`debt_${debt.id}`, `${debt.name}: payment made this month (minimum ${money(debt.minimum)})`))}
                    </div>
                  ) : null}
                  {check("milestones_reviewed", "Milestone status reviewed")}
                  {check("connections_ok", `Connections checked (Google: ${d.connections?.google?.status ?? "not connected"}; Plaid: ${(d.connections?.plaid ?? []).length} institutions)`)}
                  {check("export_downloaded", "Full data export downloaded (Settings, Export)")}
                </>
              ) : null}
              {review.kind === "quarterly" ? (
                <>
                  {text("goals", "Goal progress per initiative: notes", 4)}
                  {text("conditions", "Decision conditions due this quarter: notes")}
                  {check("inputs_reviewed", "Inputs and Assumptions reviewed and updated")}
                  {check("milestones_set", "Next quarter's milestones set (Plan, Milestones)")}
                </>
              ) : null}
              {text("notes", "Other notes", 2)}
              {!done ? (
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="complete" value="1" pendingText="Completing...">
                    Complete review
                  </SubmitButton>
                  <SubmitButton variant="outline" pendingText="Saving...">
                    Save without completing
                  </SubmitButton>
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

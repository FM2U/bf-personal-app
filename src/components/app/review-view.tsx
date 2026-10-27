import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CollapsibleCard } from "@/components/app/collapsible";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { dailyCloseCommitments, dailyCloseTargets, movedTasksForReview } from "@/lib/engine/reviews";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { ConfirmSubmit, SubmitButton } from "@/components/app/submit-button";
import { TaskList } from "@/components/app/task-list";
import { handleMovedTask } from "@/app/actions/domain";
import { ReviewForm } from "@/components/app/review-form";
import { movedNote } from "@/lib/calc/commitment-rule";
import { date as fmtDate, dateTime, money, months as fmtMonths } from "@/lib/format";
import type { Row } from "@/lib/types";
import { AiText } from "@/components/app/ai-text";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const REVIEW_TITLE: Record<string, string> = { daily: "Daily close", weekly: "Weekly review", monthly: "Monthly review", quarterly: "Quarterly review" };

/** "Daily close: Oct 27, 2026" or "Weekly review: Oct 19, 2026 to Oct 25, 2026". */
export function reviewTitle(review: Row): string {
  return `${REVIEW_TITLE[review.kind]}: ${fmtDate(review.period_start)}${review.period_end !== review.period_start ? ` to ${fmtDate(review.period_end)}` : ""}`;
}

/**
 * A review (daily close, weekly, monthly, quarterly). Shown as a full page (Accountability, Reviews, or its address)
 * and, opened from inside the app, in the large centered window (src/app/(app)/@modal). `inWindow` leaves out the
 * back link and the page title (the window shows the title).
 */
export async function ReviewView({ id, sp, inWindow = false }: { id: string; sp: { missing?: string }; inWindow?: boolean }) {
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
  // Daily close: each daily target for that day, met or missed, counted live from the records,
  // and the commitments due that day that were not met.
  const ctx = await loadCtx(supabase, ownerId);
  const closeTargets = review.kind === "daily" ? await dailyCloseTargets(ctx, review.period_start) : null;
  const closeCommitments = review.kind === "daily" ? await dailyCloseCommitments(ctx, review.period_start) : [];
  const misses = [
    ...closeCommitments.map((c) => ({ key: `c_${c.id}`, label: c.title as string, kind: "Commitment", detail: c.record_type === "tasks" ? "Task not done" : c.record_type === "milestones" ? "Milestone not met" : "Goal not met", saved: (c.reason as string | null) ?? null })),
    ...(closeTargets?.targets ?? [])
      .filter((t) => t.status === "missed")
      .map((t) => ({ key: `t_${t.id}`, label: t.name as string, kind: "Target", detail: `${t.count} of ${t.required} done`, saved: (a[`target_reason_${t.id}`] as string | undefined) ?? (t.reason as string | null) ?? null })),
  ];
  const metTargets = (closeTargets?.targets ?? []).filter((t) => t.status === "met");
  const closeSaved = a.close_saved === "1";
  const missingLabels = new Set((sp.missing ?? "").split("|").filter(Boolean));
  // Weekly review: regular tasks moved to the next day many times.
  const moved = review.kind === "weekly" && !done ? await movedTasksForReview(ctx) : null;
  const check = (name: string, label: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={`a_${name}`} value="yes" defaultChecked={a[name] === "yes"} disabled={done} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>{label}</span>
    </label>
  );
  const text = (name: string, label: string, rows = 3) => (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <Textarea name={`a_${name}`} rows={rows} defaultValue={a[name] ?? ""} disabled={done} />
    </label>
  );
  return (
    <div>
      {inWindow ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={done ? "success" : "warning"}>{done ? "Completed" : "Draft"}</Badge>
          <p className="text-sm text-muted-foreground">{done ? `Completed ${dateTime(review.completed_at)}.` : "Drafted from your data. Read the draft, answer each section, and complete the review."}</p>
        </div>
      ) : (
        <>
          <Link href="/accountability/reviews" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-900">
            <ChevronLeft className="h-4 w-4" /> Reviews
          </Link>
          <PageHeader
            title={reviewTitle(review)}
            description={done ? `Completed ${dateTime(review.completed_at)}.` : "Drafted from your data. Read the draft, answer each section, and complete the review."}
            actions={<Badge variant={done ? "success" : "warning"}>{done ? "Completed" : "Draft"}</Badge>}
          />
        </>
      )}
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
            <CardContent>
<StatGrid>
              <Stat label="Runway" value={fmtMonths(d.runway_months)} />
              <Stat label="Cash" value={money(d.cash)} />
              <Stat label="Average monthly spending" value={money(d.avg_spending)} />
              <Stat label="Average monthly income" value={money(d.avg_income)} />
              {d.score ? <Stat label="Commitment score" value={d.score.pct === null ? "No commitments" : `${d.score.pct}%`} /> : null}
              {d.budget ? <Stat label="Spent vs. budget" value={`${money(d.budget.totals.actual)} / ${money(d.budget.totals.current)}`} /> : null}
              {d.outreach ? <Stat label="Outreach reply rate" value={d.outreach.replyRatePct === null ? "No outreach" : `${d.outreach.replyRatePct}%`} hint={`${d.outreach.sent} sent`} /> : null}
              {d.outreach ? <Stat label="Meetings booked from outreach" value={d.outreach.meetings} /> : null}
              {d.outreach && d.outreach.dealSourcingSharePct !== null && d.outreach.dealSourcingSharePct !== undefined ? (
                <Stat label="Outreach asking about deals" value={`${d.outreach.dealSourcingSharePct}%`} hint={`${d.outreach.dealSourcing} of ${d.outreach.sent}`} />
              ) : null}
              {d.deal_sourcing ? <Stat label="Deals sourced: proprietary, brokered" value={`${d.deal_sourcing.proprietary}, ${d.deal_sourcing.brokered}`} hint={`${d.deal_sourcing.sourced} in total`} /> : null}
              {d.deal_sourcing ? <Stat label="Proprietary share of deals sourced" value={d.deal_sourcing.proprietary_share_pct === null ? "No deals" : `${d.deal_sourcing.proprietary_share_pct}%`} /> : null}
              {d.stalled_items ? <Stat label="Stalled pipeline items" value={(d.stalled_items as Row[]).length} tone={(d.stalled_items as Row[]).length ? "bad" : "good"} /> : null}
            </StatGrid>
</CardContent>
          </Card>
          {d.consulting ? (
            <CollapsibleCard id="consulting" storageKey="review" title="Consulting this period" defaultOpen={false} summary={`Income received ${money(d.consulting.income_received)}, pipeline value ${money(d.consulting.pipeline_value)} per month`}>
              <div className="flex flex-col gap-3">
                <StatGrid>
                  <Stat label="Signed or active engagements" value={(d.consulting.active_engagements ?? []).length} />
                  <Stat label="Consulting income received" value={money(d.consulting.income_received)} tone={d.consulting.income_received ? "good" : undefined} />
                  <Stat label="Pipeline value per month" value={money(d.consulting.pipeline_value)} />
                  <Stat label="Signed work per month" value={money(d.consulting.signed_monthly)} />
                </StatGrid>
                <p className="text-xs text-slate-700">
                  <span className="text-muted-foreground">Open items by stage: </span>
                  {((d.consulting.by_stage ?? []) as Row[]).map((s) => `${s.stage} ${s.count}`).join(", ") || "none"}
                </p>
                <p className="border-t border-slate-200 pt-3 text-xs text-muted-foreground">Numbers at the time of the draft. Pipeline value = expected monthly income x probability, open items.</p>
              </div>
            </CollapsibleCard>
          ) : null}
          {(d.top_introducers ?? []).length ? (
            <CollapsibleCard id="introducers" storageKey="review" title="Top contacts by deals introduced" defaultOpen={false} summary={(d.top_introducers as Row[]).slice(0, 3).map((t) => `${t.name} ${t.deals}`).join(", ")}>
              <div className="flex flex-col divide-y divide-slate-100">
                {(d.top_introducers as Row[]).map((t) => (
                  <div key={t.contact_id} className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 py-2 first:pt-0">
                    <Link href={`/records/contacts/${t.contact_id}`} className="clamp-2 text-sm font-medium hover:underline">
                      {t.name}
                    </Link>
                    <Stat label="Deals" value={t.deals} />
                    <Stat label="This period" value={t.deals_this_period} />
                  </div>
                ))}
                <p className="pt-3 text-xs text-muted-foreground">Deals where the contact is &quot;Deal came from&quot; or &quot;Introduced by&quot;, all time.</p>
              </div>
            </CollapsibleCard>
          ) : null}
          {review.kind !== "daily" && (d.targets ?? []).length ? (
            <CollapsibleCard id="targets" storageKey="review" title="Daily targets this period" defaultOpen={false} summary={(d.targets as Row[]).map((t) => `${t.name} ${t.total} of ${t.required}`).join(", ")}>
              <div className="flex flex-col divide-y divide-slate-100">
                {(d.targets as Row[]).map((t) => (
                  <div key={t.id} className="grid grid-cols-3 gap-3 py-2 first:pt-0">
                    <span className="clamp-2 text-sm font-medium">{t.name}</span>
                    <Stat label="Done vs required" value={`${t.total} / ${t.required}`} />
                    <Stat label={t.period === "week" ? "Weeks met" : "Days met"} value={`${t.met} of ${t.met + t.missed}`} tone={t.missed ? "bad" : "good"} />
                  </div>
                ))}
                <p className="pt-3 text-xs text-muted-foreground">Total done against the total required on active days.</p>
              </div>
            </CollapsibleCard>
          ) : null}
        </div>
        <div className="flex flex-col gap-4 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Your review</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewForm className="flex flex-col gap-4">
              <input type="hidden" name="id" value={review.id} />
              {sp.missing && !done ? (
                <Notice tone="error">
                  Not completed. Give a reason for: {sp.missing.split("|").join(", ")}. Check the item to use the shared reason, or give it its own reason.
                </Notice>
              ) : null}
              {review.kind === "daily" ? (
                <>
                  <div>
                    <p className="text-sm font-medium">Today&apos;s tasks (check off what is done)</p>
                    <p className="mb-2 text-xs text-muted-foreground">Regular tasks that are not done move to tomorrow automatically. No reason needed.</p>
                    {liveTasks.length ? <TaskList tasks={liveTasks} today={review.period_start} showDue={false} /> : <p className="text-sm text-muted-foreground">No tasks were due today.</p>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <input type="hidden" name="a_close_saved" value="1" />
                    <p className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="clamp-2 min-w-0">Missed today: commitments and daily targets</span>
                      {misses.length ? <Badge variant="danger">{misses.length}</Badge> : null}
                    </p>
                    {closeTargets && !closeTargets.available ? <DbUpdateNotice compact /> : null}
                    {misses.length ? (
                      <>
                        <label className="flex flex-col gap-1.5 text-sm">
                          <span className="font-medium text-slate-800">One reason for every checked item</span>
                          <Input name="a_shared_reason" defaultValue={a.shared_reason ?? ""} placeholder="Example: the broker call ran all afternoon" maxLength={200} disabled={done} />
                        </label>
                        <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-border">
                          {misses.map((m) => {
                            const own = (a[`reason_${m.key}`] as string | undefined) ?? "";
                            const checked = closeSaved ? a[`use_shared_${m.key}`] === "yes" : true;
                            return (
                              <li key={m.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem] items-start gap-x-2 gap-y-1 px-3 py-2 text-sm">
                                <input
                                  type="checkbox"
                                  name={`a_use_shared_${m.key}`}
                                  value="yes"
                                  defaultChecked={checked}
                                  disabled={done}
                                  aria-label={`Use the shared reason for ${m.label}`}
                                  className="mt-0.5 h-4 w-4 accent-primary"
                                />
                                <span className="min-w-0">
                                  <span className="clamp-2 font-medium text-slate-900">{m.label}</span>
                                  <span className="block text-xs text-muted-foreground">{m.detail}</span>
                                </span>
                                <span className="justify-self-end">
                                  <Badge variant={m.kind === "Commitment" ? "warning" : "danger"}>{m.kind}</Badge>
                                </span>
                                <details className="col-start-2 col-end-4" open={Boolean(own || (m.saved && !a.shared_reason) || missingLabels.has(m.label))}>
                                  <summary className="cursor-pointer text-xs text-primary-strong">Give this item its own reason</summary>
                                  <Input
                                    name={`a_reason_${m.key}`}
                                    defaultValue={own || (a.shared_reason ? "" : m.saved ?? "")}
                                    placeholder="Its own reason (used instead of the shared one)"
                                    maxLength={200}
                                    disabled={done}
                                    className="mt-1"
                                    aria-label={`Reason for ${m.label}`}
                                  />
                                </details>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="text-xs text-muted-foreground">Every item needs a reason to complete the close: the shared reason when it is checked, or its own reason.</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No commitment or daily target was missed today.</p>
                    )}
                    {metTargets.length ? (
                      <p className="text-xs text-muted-foreground">
                        Targets met: {metTargets.map((t) => `${t.name} (${t.count} of ${t.required})`).join(", ")}.
                      </p>
                    ) : null}
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
            </ReviewForm>
          </CardContent>
        </Card>
        {moved ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Tasks moved {moved.threshold} or more times {moved.tasks.length ? <Badge variant="warning">{moved.tasks.length}</Badge> : null}
              </CardTitle>
              <CardDescription>Regular tasks that keep moving to the next day. Do each one, give it a new date, or delete it. No reason needed.</CardDescription>
            </CardHeader>
            <CardContent>
              {!moved.available ? (
                <DbUpdateNotice compact />
              ) : moved.tasks.length ? (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {moved.tasks.map((t) => (
                    <li key={t.id}>
                      <GuardedForm action={handleMovedTask} className="grid grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <input type="hidden" name="task_id" value={t.id} />
                        <span className="min-w-0">
                          <Link href={`/records/tasks/${t.id}`} className="clamp-2 text-sm font-medium hover:underline">
                            {t.title}
                          </Link>
                          <span className="block text-xs text-status-soon">{movedNote(t.times_moved)}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <SubmitButton size="sm" name="op" value="done" className="h-8">
                            Done
                          </SubmitButton>
                          <Input type="date" name="due_date" defaultValue={t.due_date ?? ""} className="h-8 w-36" aria-label={`New date for ${t.title}`} />
                          <SubmitButton size="sm" variant="outline" name="op" value="reschedule" className="h-8">
                            Reschedule
                          </SubmitButton>
                          <ConfirmSubmit size="sm" variant="ghost" name="op" value="delete" className="h-8 text-status-missed" message={`Delete the task "${t.title}"?`}>
                            Delete
                          </ConfirmSubmit>
                        </span>
                      </GuardedForm>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No task has moved {moved.threshold} or more times. The number is set in Plan, Inputs and Assumptions.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
        </div>
      </div>
    </div>
  );
}

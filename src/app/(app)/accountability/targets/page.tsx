import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO, weekBounds } from "@/lib/calc/dates";
import { describeTarget, rangeTotals } from "@/lib/calc/targets";
import { loadOutreachStats, loadTargets, summarizeTargets, todayBreakdown } from "@/lib/targets";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { DbUpdateNotice, TargetDayGrid, TargetLegend, TargetWeekGrid } from "@/components/app/target-grid";
import { addTargetEntry, saveTargetMissReason, undoTargetEntry } from "@/app/actions/targets";
import { COUNT_SOURCE_OPTIONS } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import { GuardedForm } from "@/components/app/unsaved-changes";

export const metadata = { title: "Targets" };

const SOURCE_SHORT: Record<string, string> = {
  communications_outreach: "Counts outreach logged",
  pipeline_items_created: "Counts pipeline items added",
  deals_sourced: "Counts new acquisition items added (proprietary and brokered)",
  deals_advanced:
    "Counts each deal once per day when it moved to NDA signed or later, or a CIM request or a source contact was logged on it",
  manual: "Counted with the +1 button",
};

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const today = ctx.today;
  const [data, outreach30] = await Promise.all([
    loadTargets(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -182), to: today, includeInactive: true }),
    loadOutreachStats(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -29), to: today }),
  ]);
  const summaries = summarizeTargets(data, today);
  const deals30 = Object.fromEntries(data.targets.map((t) => [t.id, todayBreakdown(data, t.id, addDaysISO(today, -29), today)]));
  const week = weekBounds(today);
  const reasonFrom = addDaysISO(today, -14);
  const needReason = summaries.flatMap((s) =>
    s.history
      .filter((h) => h.status === "missed" && h.start >= reasonFrom && !data.misses.some((m) => m.target_id === s.target.id && m.period_start === h.start && m.reason))
      .map((h) => ({ target: s.target, h })),
  );

  return (
    <div>
      <PageHeader
        title="Targets"
        description="A target is a minimum count of an activity per day or per week. Counts are read from the records (outreach logged, pipeline items added) or from the +1 button."
        actions={
          data.available ? (
            <Button asChild size="sm">
              <Link href="/records/targets/new">
                <Plus /> Add target
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {sp.notice ? <Notice tone={sp.notice.startsWith("Database update") ? "warn" : "success"}>{sp.notice}</Notice> : null}
        {!data.available ? <DbUpdateNotice /> : null}
        {data.error ? <Notice tone="error">Targets could not be read: {data.error}</Notice> : null}
        {data.available && !summaries.length ? (
          <EmptyState title="No targets yet." body="Add a target such as 3 outreach messages per weekday." action={<Button asChild size="sm"><Link href="/records/targets/new">Add target</Link></Button>} />
        ) : null}

        {summaries.map((s) => {
          const t = s.target;
          const weekTotals = rangeTotals(t.def, data.counts[t.id] ?? {}, week.start, week.end, addDaysISO(today, -1));
          const unit = t.period === "week" ? "Weeks" : "Days";
          return (
            <Card key={t.id} className={t.active ? "" : "opacity-70"}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {t.name}
                    {!t.active ? <Badge variant="neutral">Inactive</Badge> : null}
                    {t.is_commitment ? <Badge variant="default">Commitment</Badge> : null}
                    {t.show_to_partners ? <Badge variant="neutral">Shown to partners</Badge> : null}
                  </CardTitle>
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.count_source === "manual" && t.active ? (
                    <>
                      <GuardedForm action={addTargetEntry}>
                        <input type="hidden" name="target_id" value={t.id} />
                        <input type="hidden" name="back" value="/accountability/targets" />
                        <SubmitButton size="sm" pendingText="Adding...">
                          +1 today
                        </SubmitButton>
                      </GuardedForm>
                      <GuardedForm action={undoTargetEntry}>
                        <input type="hidden" name="target_id" value={t.id} />
                        <SubmitButton size="sm" variant="outline" pendingText="Removing...">
                          Undo last +1
                        </SubmitButton>
                      </GuardedForm>
                    </>
                  ) : null}
                  {t.count_source === "communications_outreach" ? (
                    <Button asChild size="sm">
                      <Link href="/people/outreach">Log outreach</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "deals_sourced" && t.pipeline_id ? (
                    <Button asChild size="sm">
                      <Link href={`/records/pipeline_items/new?pipeline_id=${t.pipeline_id}`}>Add a deal</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "deals_advanced" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}?view=list` : "/opportunities"}>Open deals</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "pipeline_items_created" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}` : "/opportunities"}>Open pipeline</Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/records/targets/${t.id}?edit=1`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
                <StatGrid className="sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  <Stat
                    label={t.period === "week" ? "This week so far" : "Today"}
                    value={s.today.status === "off" ? "Not counted" : `${s.today.count} of ${s.today.required}`}
                    tone={s.today.status === "met" ? "good" : undefined}
                    hint={s.today.status === "met" ? "Met" : s.today.status === "open" ? `${s.today.required - s.today.count} to go` : t.period === "day" ? "Not an active day" : undefined}
                  />
                  {t.period === "day" ? <Stat label="This week (active days)" value={`${weekTotals.total} of ${weekTotals.required}`} /> : null}
                  <Stat label="Completion rate, last 26 weeks" value={s.rate.pct === null ? "No data yet" : `${s.rate.pct}%`} hint={`${s.rate.met} met, ${s.rate.missed} missed`} />
                  <Stat label={`${unit} met in a row`} value={s.metInARow} tone={s.metInARow ? "good" : undefined} />
                  <Stat label={`${unit} missed in a row`} value={s.missedInARow} tone={s.missedInARow ? "bad" : undefined} />
                  {t.count_source === "communications_outreach" && outreach30 ? (
                    <Stat label="Meetings booked, last 30 days" value={outreach30.meetings} />
                  ) : null}
                  {t.count_source === "communications_outreach" && outreach30 ? (
                    <Stat label="Reply rate, last 30 days" value={outreach30.replyRatePct === null ? "No outreach" : `${outreach30.replyRatePct}%`} hint={`${outreach30.sent} sent`} />
                  ) : null}
                  {t.count_source === "communications_outreach" && outreach30 && outreach30.dealSourcing !== null ? (
                    <Stat
                      label="Deal-sourcing share, last 30 days"
                      value={outreach30.dealSourcingSharePct === null ? "No outreach" : `${outreach30.dealSourcingSharePct}%`}
                      hint={`${outreach30.dealSourcing} of ${outreach30.sent} asked about deals`}
                    />
                  ) : null}
                  {s.breakdown ? (
                    <Stat
                      label={t.period === "week" ? "This week: proprietary, brokered" : "Today: proprietary, brokered"}
                      value={`${s.breakdown.proprietary}, ${s.breakdown.brokered}`}
                      hint={s.breakdown.notSet ? `${s.breakdown.notSet} with no source set` : undefined}
                    />
                  ) : null}
                  {deals30[t.id] ? (
                    <Stat
                      label="Proprietary share, last 30 days"
                      value={deals30[t.id]!.proprietarySharePct === null ? "No deals" : `${deals30[t.id]!.proprietarySharePct}%`}
                      hint={`${deals30[t.id]!.proprietary} of ${deals30[t.id]!.total} deals`}
                    />
                  ) : null}
                </StatGrid>
                <div className="flex min-w-0 flex-col gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.period === "week" ? "History by week" : "History by day, last 8 weeks"}</p>
                  {t.period === "week" ? <TargetWeekGrid history={s.history} today={today} /> : <TargetDayGrid history={s.history} today={today} />}
                  <TargetLegend />
                </div>
              </CardContent>
              <CardNote>
                {describeTarget(t.def)}. {SOURCE_SHORT[t.count_source] ?? COUNT_SOURCE_OPTIONS.find((o) => o.value === t.count_source)?.label}. Counting since {fmtDate(t.def.start_date)}.
              </CardNote>
            </Card>
          );
        })}

        {data.available && summaries.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Missed in the last 14 days, no reason yet {needReason.length ? <Badge variant="danger">{needReason.length}</Badge> : null}</CardTitle>
              <CardDescription>The daily close asks for these. You can also give the one-line reason here.</CardDescription>
            </CardHeader>
            <CardContent>
              {needReason.length ? (
                <div className="@container flex flex-col divide-y divide-slate-100">
                  {needReason.map(({ target, h }) => (
                    <GuardedForm
                      key={`${target.id}:${h.start}`}
                      action={saveTargetMissReason}
                      className="grid grid-cols-1 items-center gap-2 py-2 @md:grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,11rem)_11rem_minmax(12rem,1fr)_auto]"
                    >
                      <input type="hidden" name="target_id" value={target.id} />
                      <input type="hidden" name="period_start" value={h.start} />
                      <input type="hidden" name="period_end" value={h.end} />
                      <input type="hidden" name="actual_count" value={h.count} />
                      <input type="hidden" name="required_count" value={h.required} />
                      <input type="hidden" name="back" value="/accountability/targets" />
                      <span className="clamp-1 text-sm font-medium">{target.name}</span>
                      <span className="tabular whitespace-nowrap text-sm text-muted-foreground">
                        {fmtDate(h.start, target.period === "week" ? "'Week of' MMM d" : "EEE MMM d")}, {h.count} of {h.required}
                      </span>
                      <Input name="reason" required maxLength={200} placeholder="One-line reason" aria-label={`Reason for ${target.name} on ${h.start}`} />
                      <SubmitButton size="sm" variant="outline">
                        Save
                      </SubmitButton>
                    </GuardedForm>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Every missed period in the last 14 days has a reason.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

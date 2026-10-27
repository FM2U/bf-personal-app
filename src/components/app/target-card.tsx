import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { TargetDayGrid, TargetLegend, TargetWeekGrid } from "@/components/app/target-grid";
import { describeTarget } from "@/lib/calc/targets";
import { countStatus, progressPct, STATUS_DOT, STATUS_TEXT, type Status } from "@/lib/status";
import type { TargetSummary } from "@/lib/targets";
import { cn } from "@/lib/utils";

type Outreach = { sent: number; replyRatePct: number | null; meetings: number; dealSourcing: number | null; dealSourcingSharePct: number | null } | null;
type Deals30 = { proprietary: number; total: number; proprietarySharePct: number | null } | null;

/** A thin bar for progress toward a count, in the status color. */
function Bar({ pct, status, className }: { pct: number; status: Status; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-100", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", status === "neutral" ? "bg-primary" : STATUS_DOT[status])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One labeled number: small charcoal label (2 lines at most, full text on hover), value in medium weight. */
function Fig({ label, value, hint, status }: { label: string; value: React.ReactNode; hint?: string; status?: Status }) {
  return (
    <div className="min-w-0">
      <p className="clamp-2 text-xs font-medium leading-4 text-slate-600" title={label}>
        {label}
      </p>
      <p className={cn("tabular mt-0.5 text-base font-medium leading-6 text-slate-900", status && status !== "neutral" && STATUS_TEXT[status])}>{value}</p>
      {hint ? (
        <p className="clamp-1 text-xs leading-4 text-muted-foreground" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A group of figures under a small heading, with a thin line above it. */
function Group({ title, children, className, row = false }: { title: string; children: React.ReactNode; className?: string; row?: boolean }) {
  if (row)
    return (
      <section className={cn("grid min-w-0 grid-cols-[9.5rem_minmax(0,1fr)] items-start gap-x-4 border-t border-slate-200 py-2.5", className)}>
        <h4 className="pt-0.5 text-xs font-semibold text-slate-500">{title}</h4>
        <div className="min-w-0 max-w-xs">{children}</div>
      </section>
    );
  return (
    <section className={cn("min-w-0 border-t border-slate-200 pt-2.5", className)}>
      <h4 className="mb-1.5 text-[11px] font-semibold text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

/**
 * A daily or weekly target (Accountability, Targets): name, Commitment badge, and its rule on top; today's count
 * large with a progress bar; then This week, Streak, Last 26 weeks, and the target's own quality numbers in an even
 * grid; the history grid beside it.
 */
export function TargetCard({
  s,
  today,
  week,
  outreach30,
  deals30,
  actions,
  footnote,
}: {
  s: TargetSummary;
  today: string;
  week: { total: number; required: number } | null;
  outreach30: Outreach;
  deals30: Deals30;
  actions: React.ReactNode;
  footnote: string;
}) {
  const t = s.target;
  const weekly = t.period === "week";
  const unit = weekly ? "weeks" : "days";
  const off = s.today.status === "off";
  const status = countStatus(s.today.count, s.today.required, s.today.status === "open", !off);
  const left = Math.max(0, s.today.required - s.today.count);
  const isOutreach = t.count_source === "communications_outreach" && outreach30;
  const quality = isOutreach || s.breakdown || deals30;
  return (
    <Card className={cn(!t.active && "opacity-70")} data-testid="target-card">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            {t.name}
            {t.is_commitment ? <Badge variant="default">Commitment</Badge> : null}
            {!t.active ? <Badge variant="neutral">Inactive</Badge> : null}
            {t.show_to_partners ? <Badge variant="outline">Shown to partners</Badge> : null}
          </CardTitle>
          <p className="mt-0.5 text-sm text-slate-600">{describeTarget(t.def)}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div data-testid="target-today">
            <p className="text-xs font-medium text-slate-600">{weekly ? "This week so far" : "Today"}</p>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className={cn("tabular text-3xl font-semibold leading-tight tracking-tight", status === "met" ? "text-status-met" : "text-slate-900")}>
                {off ? "Not counted" : (
                  <>
                    {s.today.count} <span className="text-lg font-medium text-slate-500">of {s.today.required}</span>
                  </>
                )}
              </span>
              <span className={cn("text-sm font-medium", status === "met" ? "text-status-met" : off ? "text-muted-foreground" : "text-status-soon")}>
                {off ? (weekly ? "" : "Not an active day") : status === "met" ? "Met" : `${left} to go`}
              </span>
            </p>
            <Bar pct={off ? 0 : progressPct(s.today.count, s.today.required)} status={status} className="mt-2 h-2" />
          </div>
          {/* With no quality numbers, the groups stack as rows (title left, numbers right) so the column fills the card's height. */}
          <div className={cn(quality ? cn("grid grid-cols-2 gap-x-4 gap-y-3", !weekly && "sm:grid-cols-3") : "flex flex-col")}>
            {!weekly && week ? (
              <Group title="This week" row={!quality}>
                <Fig label="Done" value={`${week.total} of ${week.required}`} />
                <Bar pct={progressPct(week.total, week.required)} status={week.total >= week.required ? "met" : "neutral"} className="mt-1.5" />
              </Group>
            ) : null}
            <Group title={`Streak, ${unit} in a row`} row={!quality}>
              <div className="grid grid-cols-2 gap-2">
                <Fig label="Met" value={s.metInARow} status={s.metInARow ? "met" : undefined} />
                <Fig label="Missed" value={s.missedInARow} status={s.missedInARow > 0 ? "missed" : undefined} />
              </div>
            </Group>
            <Group title="Last 26 weeks" row={!quality}>
              <Fig label="Completion rate" value={s.rate.pct === null ? "No data yet" : `${s.rate.pct}%`} hint={`${s.rate.met} met, ${s.rate.missed} missed`} />
            </Group>
          </div>
          {quality ? (
            <Group title={isOutreach ? "Quality, last 30 days" : "Deal source"}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {isOutreach ? (
                  <>
                    <Fig label="Reply rate" value={outreach30.replyRatePct === null ? "No outreach" : `${outreach30.replyRatePct}%`} hint={`${outreach30.sent} sent`} />
                    <Fig label="Meetings booked" value={outreach30.meetings} />
                    {outreach30.dealSourcing !== null ? (
                      <Fig label="Deal-sourcing share" value={outreach30.dealSourcingSharePct === null ? "No outreach" : `${outreach30.dealSourcingSharePct}%`} hint={`${outreach30.dealSourcing} of ${outreach30.sent} were deal asks`} />
                    ) : null}
                  </>
                ) : null}
                {s.breakdown ? (
                  <>
                    <Fig label={weekly ? "Proprietary this week" : "Proprietary today"} value={s.breakdown.proprietary} hint={s.breakdown.notSet ? `${s.breakdown.notSet} with no source set` : undefined} />
                    <Fig label={weekly ? "Brokered this week" : "Brokered today"} value={s.breakdown.brokered} />
                  </>
                ) : null}
                {deals30 ? (
                  <Fig label="Proprietary share, 30 days" value={deals30.proprietarySharePct === null ? "No deals" : `${deals30.proprietarySharePct}%`} hint={`${deals30.proprietary} of ${deals30.total} deals`} />
                ) : null}
              </div>
            </Group>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-medium text-slate-600">{weekly ? "History by week" : "History by day, last 8 weeks"}</p>
          {weekly ? <TargetWeekGrid history={s.history} today={today} /> : <TargetDayGrid history={s.history} today={today} compact />}
          <TargetLegend />
        </div>
      </CardContent>
      <CardNote>{footnote}</CardNote>
    </Card>
  );
}

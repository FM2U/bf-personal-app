import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { TargetDayGrid, TargetLegend, TargetWeekGrid } from "@/components/app/target-grid";
import { describeTarget } from "@/lib/calc/targets";
import { countStatus, progressPct, STATUS_DOT, type Status } from "@/lib/status";
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

/**
 * One tile: small label, large number, a progress bar (or the same space left empty, so every tile lines up), and a
 * small gray note. Every tile has the same order and heights.
 */
function Tile({ label, value, note, bar, valueClass, testId }: { label: string; value: React.ReactNode; note?: React.ReactNode; bar?: { pct: number; status: Status }; valueClass?: string; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center border-slate-200 px-3 py-3.5" data-testid={testId}>
      <p className="clamp-1 text-xs font-medium leading-4 text-slate-600" title={label}>
        {label}
      </p>
      <p className={cn("tabular mt-1 text-2xl font-semibold leading-8 tracking-tight text-slate-900", valueClass)}>{value}</p>
      {bar ? <Bar pct={bar.pct} status={bar.status} className="mt-1" /> : <div aria-hidden className="mt-1 h-1.5" />}
      <p className="clamp-1 mt-1.5 text-xs leading-4 text-muted-foreground" title={typeof note === "string" ? note : undefined}>
        {note ?? "\u00a0"}
      </p>
    </div>
  );
}

/** A row of equal tiles with thin dividers between them. 4 across on a wide card, 2 across on the phone. */
function TileRow({ children, cols = 4, testId, grow = false }: { children: React.ReactNode; cols?: 2 | 3 | 4; testId?: string; /** Fills the rest of the column's height (each tile's content is centered, so tiles in a row stay aligned). */ grow?: boolean }) {
  // Phone (and cols 2): two across, a line left of the second tile and above the second row. Wider: one row.
  const two = "grid-cols-2 [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t";
  const wide =
    cols === 4
      ? "sm:grid-cols-4 sm:[&>*:nth-child(n+3)]:border-t-0 sm:[&>*:not(:first-child)]:border-l"
      : cols === 3
        ? "sm:grid-cols-3 sm:[&>*:nth-child(n+3)]:border-t-0 sm:[&>*:not(:first-child)]:border-l"
        : "";
  return (
    <div className={cn("grid auto-rows-fr rounded-lg border border-slate-200 bg-white", grow && "lg:flex-1", two, wide)} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * A daily or weekly target (Accountability, Targets): name, Commitment badge, and its rule on top. Left: a row of 4 equal
 * tiles (Today with a bar and "N to go", This week with a bar, Streak met and missed, Last 26 weeks completion rate),
 * then a Quality row with the target's own numbers, in the same tile style (small label, large number, small gray
 * note) with thin lines between tiles. Right: the history grid.
 */
export function TargetCard({
  s,
  today,
  week,
  outreach30,
  deals30,
  actions,
  footnote,
  counter,
}: {
  /** A target counted by hand: its daily count strip (buttons and help line), under the tiles. */
  counter?: React.ReactNode;
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
  const pct = (c: number, r: number) => progressPct(c, r);
  // Weekly targets: the tile after "This week so far" is last week's result.
  const lastWeek = weekly ? [...s.history].reverse().find((h) => h.end < s.today.start && h.status !== "off") ?? null : null;
  const one = unit.slice(0, -1);
  const streakNote = s.missedInARow > 0 ? `Missed ${s.missedInARow} ${s.missedInARow === 1 ? one : unit} in a row` : s.metInARow > 0 ? `Met ${s.metInARow} ${s.metInARow === 1 ? one : unit} in a row` : `No ${unit} in a row yet`;
  const tiles = (
    <>
      <Tile
        label={weekly ? "This week" : "Today"}
        testId="target-today"
        value={off ? "Not counted" : (
          <>
            {s.today.count} <span className="text-base font-medium text-slate-500">of {s.today.required}</span>
          </>
        )}
        valueClass={status === "met" ? "text-status-met" : undefined}
        bar={{ pct: off ? 0 : pct(s.today.count, s.today.required), status }}
        note={<span className={cn(status === "met" ? "font-medium text-status-met" : off ? "" : "font-medium text-status-soon")}>{off ? (weekly ? "Not counted yet" : "Not an active day") : status === "met" ? "Met" : `${left} to go`}</span>}
      />
      {!weekly && week ? (
        <Tile
          label="This week"
          testId="target-week"
          value={
            <>
              {week.total} <span className="text-base font-medium text-slate-500">of {week.required}</span>
            </>
          }
          bar={{ pct: pct(week.total, week.required), status: week.total >= week.required ? "met" : "neutral" }}
          note={week.total >= week.required ? "Met for the week" : `${Math.max(0, week.required - week.total)} to go this week`}
        />
      ) : (
        <Tile
          label="Last week"
          testId="target-week"
          value={lastWeek ? (
            <>
              {lastWeek.count} <span className="text-base font-medium text-slate-500">of {lastWeek.required}</span>
            </>
          ) : "No data yet"}
          valueClass={lastWeek ? (lastWeek.status === "met" ? "text-status-met" : lastWeek.status === "missed" ? "text-status-missed" : undefined) : "text-base font-medium text-muted-foreground"}
          note={lastWeek ? (lastWeek.status === "met" ? "Met" : lastWeek.status === "missed" ? "Missed" : "") : "Counting started this week"}
        />
      )}
      <Tile
        label="Streak"
        testId="target-streak"
        value={
          <span className="flex items-baseline gap-3 whitespace-nowrap">
            <span className={cn(s.metInARow ? "text-status-met" : undefined)}>
              {s.metInARow} <span className="text-xs font-medium text-slate-500">Met</span>
            </span>
            <span className={cn(s.missedInARow > 0 ? "text-status-missed" : undefined)}>
              {s.missedInARow} <span className="text-xs font-medium text-slate-500">Missed</span>
            </span>
          </span>
        }
        note={streakNote}
      />
      <Tile
        label="Last 26 weeks"
        testId="target-rate"
        value={s.rate.pct === null ? <span className="text-base font-medium text-muted-foreground">No data yet</span> : `${s.rate.pct}%`}
        note={`${s.rate.met} met, ${s.rate.missed} missed`}
      />
    </>
  );
  const qualityTiles: React.ReactNode[] = [];
  if (isOutreach) {
    qualityTiles.push(<Tile key="reply" label="Reply rate" value={outreach30.replyRatePct === null ? <span className="text-base font-medium text-muted-foreground">No outreach</span> : `${outreach30.replyRatePct}%`} note={`${outreach30.sent} sent`} />);
    qualityTiles.push(<Tile key="meet" label="Meetings booked" value={outreach30.meetings} note="Last 30 days" />);
    if (outreach30.dealSourcing !== null)
      qualityTiles.push(<Tile key="deal" label="Deal-sourcing share" value={outreach30.dealSourcingSharePct === null ? <span className="text-base font-medium text-muted-foreground">No outreach</span> : `${outreach30.dealSourcingSharePct}%`} note={`${outreach30.dealSourcing} of ${outreach30.sent} were deal asks`} />);
  }
  if (s.breakdown) {
    qualityTiles.push(<Tile key="prop" label={weekly ? "Proprietary this week" : "Proprietary today"} value={s.breakdown.proprietary} note={s.breakdown.notSet ? `${s.breakdown.notSet} with no source set` : "Off-market deals"} />);
    qualityTiles.push(<Tile key="brok" label={weekly ? "Brokered this week" : "Brokered today"} value={s.breakdown.brokered} note="Listed by a broker" />);
  }
  if (deals30) qualityTiles.push(<Tile key="share" label="Proprietary share" value={deals30.proprietarySharePct === null ? <span className="text-base font-medium text-muted-foreground">No deals</span> : `${deals30.proprietarySharePct}%`} note={`${deals30.proprietary} of ${deals30.total} deals, 30 days`} />);
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
        {/* Left: tiles in rows. A daily target with no quality numbers shows its 4 tiles 2 by 2, so the column is as tall as the history grid beside it. */}
        <div className="flex min-w-0 flex-col gap-4" data-testid="target-tiles">
          <TileRow cols={!quality && !weekly ? 2 : 4} grow={!counter} testId="target-tiles-main">{tiles}</TileRow>
          {qualityTiles.length ? (
            <section className={cn("flex min-w-0 flex-col", !counter && "lg:flex-1")} data-testid="target-quality">
              <h4 className="mb-1 text-xs font-semibold text-slate-700">{isOutreach ? "Quality, last 30 days" : "Quality: deal source"}</h4>
              <TileRow cols={qualityTiles.length >= 3 ? 3 : 2} grow={!counter}>{qualityTiles}</TileRow>
            </section>
          ) : null}
          {counter}
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

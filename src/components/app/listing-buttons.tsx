import { addTargetEntry, undoTargetEntry } from "@/app/actions/targets";
import { SubmitButton } from "@/components/app/submit-button";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { countStatus, progressPct, STATUS_DOT } from "@/lib/status";
import type { TargetSummary } from "@/lib/targets";
import { cn } from "@/lib/utils";

/** What one press counts, from the target's name: "Listings screened" counts listings. Null: a plain number. */
export function countUnit(name: string | null | undefined): { one: string; many: string } | null {
  return /^listings?\b/i.test(String(name ?? "").trim()) ? { one: "listing", many: "listings" } : null;
}

/** The one help line under the buttons. */
export function countHelp(name: string | null | undefined): string {
  return countUnit(name) ? "Press after you review listings on broker sites or email lists." : "Press after each one you finish. Undo last removes the last press made today.";
}

/**
 * +1, +5, and Undo last for a target counted by hand (Listings screened). One entry per press (+5 adds one entry of 5),
 * so Undo last removes the last press made today. With `note`, a one-line note box (optional) is saved with the entry.
 * The buttons name what they count ("+1 listing", "+5 listings"). Used in the Daily count card (Acquisitions page),
 * the target card (Targets), and the tiles on Home and Productivity.
 */
export function CountButtons({
  targetId,
  back,
  note = false,
  label,
  className,
  stretch = false,
  short = false,
}: {
  /** Small tiles (Home, Productivity): "+1" and "+5" without the unit, so the three buttons fit. */
  short?: boolean;
  targetId: string;
  back: string;
  note?: boolean;
  /** The target's name: names each button for screen readers and gives the unit ("Listings screened": listing). */
  label?: string;
  className?: string;
  /** Buttons share the width (small tiles). */
  stretch?: boolean;
}) {
  const aria = (s: string) => (label ? `${s} ${label}` : undefined);
  const unit = short ? null : countUnit(label);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid="count-buttons">
      <GuardedForm action={addTargetEntry} className={cn("flex flex-wrap items-center gap-2", stretch && "flex-1 flex-nowrap")}>
        <input type="hidden" name="target_id" value={targetId} />
        <input type="hidden" name="back" value={back} />
        {note ? <Input name="note" maxLength={200} placeholder="Note (optional)" aria-label="Note (optional)" className="h-8 w-44" /> : null}
        <SubmitButton size="sm" name="count" value="1" pendingText={unit ? `+1 ${unit.one}` : "+1"} aria-label={aria("Add 1 to")} className={cn(stretch && "flex-1")}>
          {unit ? `+1 ${unit.one}` : "+1"}
        </SubmitButton>
        <SubmitButton size="sm" name="count" value="5" pendingText={unit ? `+5 ${unit.many}` : "+5"} aria-label={aria("Add 5 to")} className={cn(stretch && "flex-1")}>
          {unit ? `+5 ${unit.many}` : "+5"}
        </SubmitButton>
      </GuardedForm>
      <GuardedForm action={undoTargetEntry} className={cn(stretch && "flex-1")}>
        <input type="hidden" name="target_id" value={targetId} />
        <SubmitButton size="sm" variant="outline" pendingText="Undo last" aria-label={aria("Undo last entry on")} className={cn("whitespace-nowrap", stretch && "w-full")}>
          Undo last
        </SubmitButton>
      </GuardedForm>
    </div>
  );
}

/**
 * The daily count of a target counted by hand, as its own labeled card under the page header (Acquisitions page):
 * "Daily count: Listings screened", "7 of 20 today" with a progress bar, the buttons, and one help line.
 */
export function DailyCountCard({ summary, back, className }: { summary: TargetSummary; back: string; className?: string }) {
  const t = summary.target;
  const off = summary.today.status === "off";
  const weekly = t.period === "week";
  const status = countStatus(summary.today.count, summary.today.required, summary.today.status === "open", !off);
  const left = Math.max(0, summary.today.required - summary.today.count);
  const pct = off ? 0 : progressPct(summary.today.count, summary.today.required);
  return (
    <Card className={cn("w-full lg:max-w-3xl", className)} data-testid="daily-count">
      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Daily count: {t.name}</h2>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2" data-testid="daily-count-number">
            <span className={cn("tabular text-2xl font-semibold leading-tight", status === "met" ? "text-status-met" : "text-slate-900")}>
              {summary.today.count} of {summary.today.required}
            </span>
            <span className="text-sm text-slate-600">{weekly ? "this week" : "today"}</span>
            <span className={cn("text-sm font-medium", status === "met" ? "text-status-met" : off ? "text-muted-foreground" : "text-status-soon")}>
              {off ? "Not an active day" : status === "met" ? "Met" : `${left} to go`}
            </span>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.name} ${weekly ? "this week" : "today"}`}>
            <div className={cn("h-full rounded-full", status === "neutral" ? "bg-primary" : STATUS_DOT[status])} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 md:items-end">
          <CountButtons targetId={t.id} back={back} label={t.name} />
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">{countHelp(t.name)}</p>
      </div>
    </Card>
  );
}

/** The same daily count inside a target card (Targets): its title, the buttons with a note box, and the help line. */
export function DailyCountStrip({ targetId, name, back }: { targetId: string; name: string; back: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3" data-testid="daily-count-strip">
      <h4 className="text-xs font-semibold text-slate-700">Daily count: {name}</h4>
      <CountButtons targetId={targetId} back={back} note label={name} />
      <p className="text-xs text-muted-foreground">{countHelp(name)}</p>
    </section>
  );
}

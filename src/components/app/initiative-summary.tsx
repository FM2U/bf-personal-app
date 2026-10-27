"use client";

import { BookOpen, CalendarDays, CheckSquare, Flag, ListChecks, PiggyBank, Repeat, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupRecurringByWeekday, summaryCount, type InitiativeSummary, type SummaryRef } from "@/lib/initiative/summary";
import { date as fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** One clickable line: opens the record (saved initiative) or scrolls to the item's fields (review screen). */
function Line({ r, pick, children, className, label }: { r: SummaryRef; pick: (r: SummaryRef) => void; children: React.ReactNode; className?: string; label?: string }) {
  if (r.kind === "none") return <div className={cn("px-2 py-1.5", className)}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => pick(r)}
      aria-label={label}
      data-summary-ref={r.kind === "field" ? r.anchor : r.kind === "record" ? `${r.table}:${r.id}` : r.kind}
      className={cn(
        "-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, icon: Icon, count, children, className }: { title: string; icon: typeof Flag; count?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-white px-4 pb-3 pt-3.5", className)}>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon aria-hidden className="h-4 w-4 text-gold" strokeWidth={1.75} />
        {title}
        {count ? <span className="ml-auto text-xs font-normal text-muted-foreground tabular">{count}</span> : null}
      </h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * The summary window's content: name, purpose, and estimated monthly savings on top; then goals, milestones (a dated
 * timeline), recurring tasks by weekday, target and budget, checklists, and the plan in a grid of 1 to 3 columns.
 * Every line is clickable (`pick`).
 */
export function SummaryContent({ s, pick, aside }: { s: InitiativeSummary; pick: (r: SummaryRef) => void; /** Shown between the name and the savings (the Next required action in the window). */ aside?: React.ReactNode }) {
  const groups = groupRecurringByWeekday(s.recurring);
  const tiles: React.ReactNode[] = [];
  if (s.goals.length)
    tiles.push(
      <Section key="goals" title="Goals" icon={Flag} count={String(s.goals.length)}>
        {s.goals.map((g, i) => (
          <Line key={i} r={g.ref} pick={pick}>
            <span className="clamp-2 text-sm font-medium text-slate-900">{g.title}</span>
            <span className="mt-0.5 grid grid-cols-2 gap-3 text-xs">
              <span className="min-w-0">
                <span className="block text-slate-500">Target</span>
                <span className="clamp-1 font-medium text-slate-800">{g.target ?? "Not measured"}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-slate-500">Deadline</span>
                <span className="tabular clamp-1 font-medium text-slate-800">{g.deadline ? fmtDate(g.deadline) : "Not set"}</span>
              </span>
            </span>
          </Line>
        ))}
      </Section>,
    );
  if (s.milestones.length)
    tiles.push(
      <Section key="milestones" title="Milestones" icon={CalendarDays} count={String(s.milestones.length)}>
        <ol className="relative">
          <span aria-hidden className="absolute bottom-3 left-[4.6rem] top-3 w-px bg-gold-border" />
          {s.milestones.map((m, i) => (
            <li key={i}>
              <Line r={m.ref} pick={pick} className="grid grid-cols-[4rem_0.75rem_minmax(0,1fr)] items-start gap-2">
                <span className="tabular pt-px text-xs font-medium text-slate-600">{m.due ? fmtDate(m.due, "MMM d") : "No date"}</span>
                <span aria-hidden className="relative z-10 mt-1 h-2.5 w-2.5 rounded-full border-2 border-gold bg-white" />
                <span className="clamp-2 text-sm text-slate-900">{m.title}</span>
              </Line>
            </li>
          ))}
        </ol>
      </Section>,
    );
  if (groups.length)
    tiles.push(
      <Section key="recurring" title="Recurring tasks" icon={Repeat} count={String(s.recurring.length)}>
        {groups.map((g) => (
          <div key={g.label} className="grid grid-cols-[5.25rem_minmax(0,1fr)] items-start gap-2 border-b border-slate-100 py-0.5 last:border-0">
            <span className="pt-2 text-xs font-medium text-slate-600">{g.label}</span>
            <div className="min-w-0">
              {g.items.map((t, i) => (
                <Line key={i} r={t.ref} pick={pick}>
                  <span className="clamp-2 text-sm text-slate-900">
                    {t.title}
                    {t.cadence === "monthly" ? <span className="text-xs text-muted-foreground"> (day {t.dayOfMonth ?? 1})</span> : null}
                  </span>
                </Line>
              ))}
            </div>
          </div>
        ))}
      </Section>,
    );
  if (s.targets.length || s.budget.length)
    tiles.push(
      <Section key="target" title={s.targets.length && s.budget.length ? "Target and budget" : s.targets.length ? "Target" : "Budget change"} icon={Target}>
        {s.targets.map((t, i) => (
          <Line key={`t${i}`} r={t.ref} pick={pick} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <span className="clamp-2 text-sm text-slate-900">{t.name}</span>
            <span className="tabular whitespace-nowrap text-sm font-medium text-slate-800">{t.rule}</span>
          </Line>
        ))}
        {s.budget.map((b, i) => (
          <Line key={`b${i}`} r={b.ref} pick={pick} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <span className="min-w-0">
              <span className="clamp-1 text-sm text-slate-900">{b.category} budget</span>
              <span className="block text-xs text-muted-foreground">{b.current !== null ? `Spending now ${usd(b.current)} per month` : "No recent spending"}</span>
            </span>
            <span className="tabular whitespace-nowrap text-sm font-medium text-slate-800">{usd(b.amount)} per month</span>
          </Line>
        ))}
      </Section>,
    );
  if (s.checklists.length)
    tiles.push(
      <Section key="checklists" title="Checklists" icon={ListChecks} count={String(s.checklists.length)}>
        {s.checklists.map((c, i) => (
          <Line key={i} r={c.ref} pick={pick} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <span className="clamp-2 text-sm text-slate-900">{c.name}</span>
            <span className="tabular whitespace-nowrap text-xs font-medium text-slate-600">{c.count} items</span>
          </Line>
        ))}
      </Section>,
    );
  if (s.plan)
    tiles.push(
      <Section key="plan" title="Plan" icon={BookOpen}>
        <Line r={s.plan.ref} pick={pick}>
          <span className="clamp-1 text-sm font-medium text-slate-900">{s.plan.title}</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {s.plan.preview.map((l, i) => (
              <li key={i} className="clamp-1 text-xs text-slate-600">
                {l}
              </li>
            ))}
          </ul>
        </Line>
        <Button type="button" variant="link" size="sm" className="h-7 self-start px-0" onClick={() => pick({ kind: "plan" })} data-testid="summary-read-plan">
          Read full plan
        </Button>
      </Section>,
    );

  return (
    <div className="flex flex-col gap-4" data-testid="summary-content">
      <div className={cn("grid grid-cols-1 gap-4", aside ? "md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)_minmax(13rem,17rem)]" : "md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)]")}>
        <div className={cn("min-w-0 rounded-xl border border-border bg-white px-4 py-3", aside && "md:col-span-2 xl:col-span-1")}>
          <Line r={s.ref} pick={pick}>
            <span className="block text-xs font-medium text-slate-500">{s.parent ? `Initiative, part of ${s.parent}` : "Initiative"}</span>
            <span className="clamp-2 text-xl font-semibold leading-snug text-slate-900">{s.name}</span>
          </Line>
          {s.purpose ? (
            <Line r={s.purposeRef} pick={pick}>
              <span className="block text-xs font-medium text-slate-500">Purpose</span>
              <span className="clamp-3 block max-w-[75ch] text-sm leading-relaxed text-slate-800">{s.purpose}</span>
            </Line>
          ) : null}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
        {s.savings !== null ? (
          <div className="flex flex-col justify-center rounded-xl border border-status-met-border bg-status-met-bg px-4 py-3" data-testid="summary-savings">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <PiggyBank aria-hidden className="h-4 w-4 text-status-met-solid" strokeWidth={1.75} /> Estimated monthly savings
            </span>
            <span className="tabular mt-1 text-3xl font-semibold leading-none text-status-met">{usd(s.savings)}</span>
            <span className="mt-0.5 text-sm text-status-met">per month</span>
            {s.savingsBasis ? <span className="clamp-2 mt-1 text-xs text-slate-600">{s.savingsBasis}</span> : null}
          </div>
        ) : (
          <div className="flex flex-col justify-center rounded-xl border border-border bg-white px-4 py-3" data-testid="summary-savings">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <PiggyBank aria-hidden className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Estimated monthly savings
            </span>
            <span className="mt-1 text-lg font-semibold text-slate-500">Not estimated</span>
            <span className="clamp-2 mt-0.5 text-xs text-slate-500">Add a budget change to estimate it.</span>
          </div>
        )}
      </div>
      {tiles.length ? (
        <div className={cn("grid grid-cols-1 items-start gap-4 md:grid-cols-2", tiles.length >= 3 && "xl:grid-cols-3")}>{tiles}</div>
      ) : (
        <p className="text-sm text-muted-foreground">No goals, milestones, tasks, or checklists yet.</p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckSquare aria-hidden className="h-3.5 w-3.5" /> {summaryCount(s)} items. Select any line to open it.
      </p>
    </div>
  );
}

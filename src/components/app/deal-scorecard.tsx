import { Gauge } from "lucide-react";
import { StatusDot } from "@/components/ui/badge";
import { SCORE_LABEL, type ScoreColor, type Scorecard } from "@/lib/calc/deal-scorecard";
import { STATUS_BOX, STATUS_TEXT, type Status } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Scorecard colors use the shared status colors: green = met, amber = soon, red = missed. */
export const SCORE_STATUS: Record<ScoreColor, Status> = { green: "met", amber: "soon", red: "missed" };

/**
 * Deal scorecard card (top right of the pipeline item window and the full item page): an overall color and score,
 * then four rows (Time in stage, Next action, Required details, Last activity), each with a colored dot and a short
 * value. Hovering a row, or tapping it (it is a button, so it takes focus), shows what the check means and what to do.
 * Plain markup with no state, so it works on server pages and inside windows.
 */
export function DealScorecard({ card, className }: { card: Scorecard; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-white px-4 pb-3 pt-3.5", className)} data-testid="deal-scorecard" aria-label="Deal scorecard">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Gauge aria-hidden className="h-4 w-4 text-gold" strokeWidth={1.75} /> Deal scorecard
        </h3>
        {card.open ? (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS_BOX[SCORE_STATUS[card.overall]], STATUS_TEXT[SCORE_STATUS[card.overall]])} data-testid="scorecard-overall" data-color={card.overall}>
            <StatusDot status={SCORE_STATUS[card.overall]} />
            {card.scoreText}
          </span>
        ) : null}
      </div>
      {card.open ? (
        <>
          <ul className="flex flex-col">
            {card.checks.map((c) => (
              <li key={c.key} className="group relative" data-testid={`scorecard-${c.key}`} data-color={c.color}>
                <button
                  type="button"
                  className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                  aria-describedby={`score-help-${c.key}`}
                >
                  <StatusDot status={SCORE_STATUS[c.color]} />
                  <span className="clamp-1 text-sm text-slate-700">{c.label}</span>
                  <span className={cn("tabular whitespace-nowrap text-sm font-medium", c.color === "green" ? "text-slate-900" : STATUS_TEXT[SCORE_STATUS[c.color]])}>{c.value}</span>
                </button>
                <div
                  id={`score-help-${c.key}`}
                  role="tooltip"
                  className="pointer-events-none invisible absolute right-0 top-full z-30 w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-white p-3 text-xs leading-5 text-slate-700 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                  data-testid={`scorecard-help-${c.key}`}
                >
                  <p>{c.meaning}</p>
                  <p className="mt-1.5 font-medium text-slate-900">{c.todo || "Nothing to do now."}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-muted-foreground">{SCORE_LABEL[card.overall]}. Hover or tap a row to see what it means and what to do.</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{card.reason}</p>
      )}
    </section>
  );
}

/** The overall color as a small dot for pipeline list rows (with a text label for screen readers and a hover title). */
export function ScorecardDot({ card }: { card: Scorecard }) {
  if (!card.open) return null;
  return (
    <span className="inline-flex shrink-0" title={`Deal scorecard: ${card.scoreText}`} data-testid="scorecard-dot" data-color={card.overall}>
      <StatusDot status={SCORE_STATUS[card.overall]} className="h-2.5 w-2.5" />
      <span className="sr-only">Deal scorecard: {card.scoreText}</span>
    </span>
  );
}

import { MARK_WORD, type Cell, type Mark, type Strip } from "@/lib/accountability/targets";
import { cn } from "@/lib/utils";

/**
 * The small parts of Targets and End of day (batch C, approved 2026-10-31, decisions on v2 and v3, in the color system
 * of Edit batch B): the status mark (one 22px rounded square with a hairline outline: green with a check when met, red
 * with a dot when missed, the strip's open cell when still under way: amber outline, soft amber fill, nothing inside),
 * the strip of 16px cells (Mon to Fri, or the last 8 weeks), the legend, and the Commitment switch. Status colors
 * only: green met, amber under way, red missed; the neutral cell is slate.
 */

const MARK: Record<Mark, string> = {
  met: "border-status-met-solid text-status-met-solid",
  missed: "border-status-missed-solid text-status-missed-solid",
  now: "border-status-soon-solid bg-status-soon-bg text-status-soon-solid",
};

export function StatusMark({ mark, size = 22, className, testId = "status-mark" }: { mark: Mark; size?: 22 | 16; className?: string; testId?: string }) {
  const small = size === 16;
  return (
    <span
      role="img"
      aria-label={MARK_WORD[mark]}
      title={MARK_WORD[mark]}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md border-[1.5px] align-middle leading-none", small ? "h-4 w-4 rounded-[5px]" : "h-[22px] w-[22px]", MARK[mark], className)}
      data-testid={testId}
      data-mark={mark}
    >
      {mark === "met" ? (
        <svg viewBox="0 0 14 14" className={small ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} aria-hidden>
          <path d="M3 7.5l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : mark === "missed" ? (
        <i className={cn("block rounded-full bg-current", small ? "h-[5px] w-[5px]" : "h-1.5 w-1.5")} aria-hidden />
      ) : null}
    </span>
  );
}

const CELL: Record<Cell["state"], string> = {
  met: "border-status-met-border bg-status-met-bg shadow-[inset_0_0_0_2px_#86efac]",
  missed: "border-status-missed-border bg-status-missed-bg shadow-[inset_0_0_0_2px_#fca5a5]",
  now: "border-2 border-status-soon-solid bg-status-soon-bg",
  off: "border-dashed border-input bg-transparent",
  future: "border-border bg-status-neutral-bg",
};

/** One strip cell (16px), also used by the legend at 12px. */
function StripCell({ state, title, small, className }: { state: Cell["state"]; title?: string; small?: boolean; className?: string }) {
  return <i className={cn("inline-block shrink-0 rounded border", small ? "h-3 w-3 rounded-[3px]" : "h-4 w-4", CELL[state], className)} title={title} data-cell={state} aria-hidden />;
}

/** The strip under a target: the cells, then "Mon to Fri · met 2 of 4 days so far" with the count in charcoal. */
export function StripRow({ strip, testId = "target-strip" }: { strip: Strip; testId?: string }) {
  const m = strip.text.match(/^(.*?)(met \d+ of \d+(?: days?)?)(.*)$/);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1" data-testid={testId} data-met={strip.met} data-judged={strip.judged}>
      {strip.cells.map((c, i) => (
        <StripCell key={i} state={c.state} title={c.title} />
      ))}
      <span className="ml-1.5 text-[12.5px] text-muted-foreground">
        {m ? (
          <>
            {m[1]}
            <b className="font-medium text-heading">{m[2]}</b>
            {m[3]}
          </>
        ) : (
          strip.text
        )}
      </span>
    </div>
  );
}

/** The legend line at the foot of the Targets card. */
export function TargetsLegend() {
  const lg = "label-caps text-slate-400";
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-[22px] pt-1 pb-4 text-[12.5px] text-muted-foreground" data-testid="targets-legend">
      <span className={lg}>This period</span>
      <span className="inline-flex items-center gap-1.5">
        <StatusMark mark="met" size={16} testId="legend-mark" />
        Met
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusMark mark="missed" size={16} testId="legend-mark" />
        Missed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusMark mark="now" size={16} testId="legend-mark" />
        Under way
      </span>
      <span className="hidden h-3.5 w-px bg-border sm:block" aria-hidden />
      <span className={lg}>Days and weeks</span>
      <span className="inline-flex items-center gap-1.5">
        <StripCell state="met" small />
        Met
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StripCell state="missed" small />
        Missed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StripCell state="now" small />
        Today or this week, still open
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StripCell state="off" small />
        Not counted (skipped day)
      </span>
      <span className="sm:ml-auto">Counted from what you do in the app. Nothing to type.</span>
    </div>
  );
}

/**
 * The target pill after a target's name (Edit batch C, item 5): no fill, a 1px slate outline (#d5dbe3), charcoal
 * text at 12.5px: "5 / weekday", "10 / week", "100% on time", "1 / week".
 */
export function TargetPill({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("tabular inline-flex items-center rounded-full border border-rule bg-transparent px-[9px] py-px text-[12.5px] leading-[18px] font-medium whitespace-nowrap text-heading", className)} data-testid="target-pill">
      {text}
    </span>
  );
}

/** The Commitment switch: a 32px track with a white knob, cobalt when on, the label in cobalt and bold when on. */
export function Switch({ on, onChange, label, disabled, testId, className, hideLabel = false }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; testId?: string; className?: string; /** The label is read out but not shown (a table column already names it; push D). */ hideLabel?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-[12.5px] whitespace-nowrap select-none", on ? "font-semibold text-primary-strong" : "text-muted-foreground", disabled && "cursor-default opacity-60", className)}>
      <input type="checkbox" role="switch" aria-checked={on} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" data-testid={testId} />
      <span className={cn("relative inline-block h-[18px] w-8 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2", on ? "bg-primary" : "bg-input")} aria-hidden>
        <span className={cn("absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.2)] transition-[left]", on && "left-4")} />
      </span>
      {hideLabel ? <span className="sr-only">{label}</span> : label}
    </label>
  );
}

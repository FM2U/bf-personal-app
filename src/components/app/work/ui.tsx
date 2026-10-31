import Link from "next/link";
import { progressSegments, type WaitLevel } from "@/lib/work/stages";
import { cn } from "@/lib/utils";

/**
 * The building blocks of the Work screens (approved mockup, 2026-10-30): a card with a thin gold rule under its
 * title, two-line rows without column headers, small labeled figures on the right, pills in the status colors, the
 * nine-segment stage progress mark, and the gold bar on stage headings. Server and client components both use them.
 */

export function WorkCard({ id, title, count, hint, actions, children, className, testId, rule = true }: { id?: string; title: React.ReactNode; count?: number | null; hint?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; /** False: no gold rule (a closed card with nothing under its title). */ rule?: boolean }) {
  return (
    <section id={id} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-[22px] pt-4 pb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-slate-900">
          <span>{title}</span>
          {count ? <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral">{count}</span> : null}
        </h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : hint ? <span className="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">{hint}</span> : null}
      </div>
      {rule ? <div className="mx-[22px] h-px bg-gold-rule" /> : <div className="h-1" />}
      {children}
    </section>
  );
}

/** The list inside a card: rows separated by thin lines. */
export function Rows({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex flex-col pt-1 pb-2", className)} data-testid={testId}>
      {children}
    </div>
  );
}

/** One row: the text on the left (two or three lines), the figures and buttons on the right. */
export function RowShell({ children, right, className, href, testId, dataAttrs, stack = false }: { children: React.ReactNode; right?: React.ReactNode; className?: string; href?: string; testId?: string; dataAttrs?: Record<string, string>; /** The figures and buttons go under the text (narrow columns). */ stack?: boolean }) {
  const cls = cn("grid grid-cols-1 items-center gap-x-[18px] gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0", !stack && "sm:grid-cols-[minmax(0,1fr)_auto]", href && "cursor-pointer hover:bg-[#fbfcfe]", className);
  const body = (
    <>
      <div className="min-w-0">{children}</div>
      {right ? <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 whitespace-nowrap", !stack && "sm:justify-end", stack && "mt-1")}>{right}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} data-testid={testId} {...dataAttrs}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} data-testid={testId} {...dataAttrs}>
      {body}
    </div>
  );
}

/** Line 1 of a row: the name, then the small gray context. Wraps on the phone. */
export function Line1({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1", className)}>{children}</div>;
}

export function Name({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-sm font-semibold text-slate-900", className)}>{children}</span>;
}

export function What({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("min-w-0 text-[13px] text-muted-foreground", className)}>{children}</span>;
}

/** Line 2: the action or what is waited on. */
export function Line2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-0.5 text-[13px] text-slate-700", className)}>{children}</div>;
}

/** Line 3: the key finding, in italics. */
export function Line3({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-0.5 text-[12.5px] text-muted-foreground italic", className)}>{children}</div>;
}

/** A small figure with its label under it, right-aligned (the numbers on listing and deal rows). */
export function Stat({ value, label, className, testId }: { value: React.ReactNode; label: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex min-w-[72px] flex-col items-start leading-tight sm:items-end", className)} data-testid={testId}>
      <b className="tabular text-[13.5px] font-semibold text-slate-900">{value}</b>
      <span className="mt-0.5 text-[11px] tracking-[0.04em] text-slate-400 uppercase">{label}</span>
    </div>
  );
}

export type PillTone = "gray" | "amber" | "red" | "green" | "gold" | "blue" | "quiet";

const PILL: Record<PillTone, string> = {
  gray: "border-border bg-status-neutral-bg text-status-neutral",
  amber: "border-status-soon-border bg-status-soon-bg text-status-soon",
  red: "border-status-missed-border bg-status-missed-bg text-status-missed",
  green: "border-status-met-border bg-status-met-bg text-status-met",
  gold: "border-gold-border bg-gold-soft text-gold-strong",
  blue: "border-primary-border bg-primary-soft text-primary-strong",
  quiet: "border-transparent bg-transparent pl-0 text-slate-400",
};

export function Pill({ tone = "gray", children, className, testId, title }: { tone?: PillTone; children: React.ReactNode; className?: string; testId?: string; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-[9px] py-0.5 text-xs font-medium whitespace-nowrap", PILL[tone], className)} data-testid={testId} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/** The wait pill's color for a wait level. */
export function waitTone(level: WaitLevel): PillTone {
  return level === "red" ? "red" : level === "amber" ? "amber" : level === "quiet" ? "gray" : "quiet";
}

/** The due date next to an action: amber for today, red when late, gray otherwise. */
export function Due({ text, tone, className, testId }: { text: string; tone: "today" | "over" | "later" | "none"; className?: string; testId?: string }) {
  return (
    <span className={cn("text-xs", tone === "today" && "font-semibold text-status-soon", tone === "over" && "font-semibold text-status-missed", (tone === "later" || tone === "none") && "text-muted-foreground", className)} data-testid={testId} data-tone={tone}>
      {text}
    </span>
  );
}

/** The nine-segment stage progress mark: cobalt for stages done, gold for the current one, gray for the rest. */
export function ProgressMark({ stage, className }: { stage: string | null | undefined; className?: string }) {
  const segs = progressSegments(stage);
  return (
    <span className={cn("inline-flex shrink-0 gap-0.5 align-middle", className)} aria-label={stage ? `Stage: ${stage}` : "No stage"} title={stage ?? undefined} data-testid="progress-mark">
      {segs.map((s, i) => (
        <i key={i} className={cn("block h-[11px] w-[5px] rounded-[2px]", s === "done" ? "bg-primary" : s === "current" ? "bg-gold" : "bg-slate-200")} data-seg={s} />
      ))}
    </span>
  );
}

/** A stage heading inside the Deals card: the gold bar, the name, the count, and the default next action hint. */
export function StageHeading({ name, count, hint, empty, children }: { name: string; count: number; hint?: string | null; empty?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-[22px] text-[13px]", empty ? "py-[11px] font-medium text-slate-400" : "pt-3.5 pb-1 font-semibold text-slate-900")}>
      <span className={cn("h-3.5 w-[3px] shrink-0 rounded-[2px]", empty ? "bg-border" : "bg-gold")} aria-hidden />
      <span>{name}</span>
      <span className="tabular font-medium text-muted-foreground">{count}</span>
      {hint && !empty ? <span className="ml-auto hidden min-w-0 truncate text-xs font-normal text-slate-400 md:block">Next by default: {hint}</span> : null}
      {children}
    </div>
  );
}

/** One quiet line (empty states). */
export function Quiet({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <p className={cn("px-[22px] py-3.5 text-[13px] text-muted-foreground", className)} data-testid={testId}>
      {children}
    </p>
  );
}

/** The inline confirmation strip inside a row (after Done, Interested, Chase). */
export function Confirm({ tone = "blue", children, className, testId }: { tone?: "blue" | "ok" | "warn"; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[13px] sm:col-span-2",
        tone === "blue" && "border-primary-border bg-primary-soft text-slate-800",
        tone === "ok" && "border-status-met-border bg-status-met-bg text-status-met",
        tone === "warn" && "border-status-missed-border bg-status-missed-bg text-status-missed",
        className,
      )}
      role="status"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** The small buttons on rows: cobalt (primary), gold (Chase), or outline. */
export function RowButton({ tone = "outline", className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "gold" | "outline" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-[30px] items-center justify-center rounded-[7px] border px-[11px] text-[12.5px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        tone === "primary" && "border-primary bg-primary text-white hover:bg-primary-hover",
        tone === "gold" && "border-gold-border bg-gold-soft text-gold-strong hover:bg-[#f6ead0]",
        tone === "outline" && "border-input bg-white text-slate-800 hover:bg-slate-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** The three count chips at the top of Work on now. Each is a link. */
export function CountChip({ href, n, label, warn, testId }: { href: string; n: number; label: string; warn?: boolean; testId?: string }) {
  return (
    <Link href={href} className={cn("flex min-w-[190px] items-center gap-3 rounded-[10px] border px-4 py-3 text-slate-900", warn ? "border-status-soon-border bg-status-soon-bg" : "border-border bg-white hover:bg-[#fbfcfe]")} data-testid={testId}>
      <b className={cn("tabular text-2xl leading-none font-semibold", warn && "text-status-soon")}>{n}</b>
      <span className="text-[13px] leading-[1.2] text-muted-foreground">{label}</span>
    </Link>
  );
}

/** The page title row: the title on the left, the date or buttons on the right. */
export function WorkHeader({ title, right, crumb }: { title: React.ReactNode; right?: React.ReactNode; crumb?: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      {crumb ? <div className="mb-1.5 text-[13px] text-muted-foreground">{crumb}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h1>
        {right ? <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">{right}</div> : null}
      </div>
    </div>
  );
}

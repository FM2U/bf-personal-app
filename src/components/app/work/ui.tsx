import Link from "next/link";
import { progressSegments, type WaitLevel } from "@/lib/work/stages";
import { cn } from "@/lib/utils";

/**
 * The building blocks of the Work screens (approved mockup 2026-10-30, mockup v6 2026-10-31): a card with a thin gold
 * rule under its title (the title row can stay pinned while the card scrolls), two-line rows without column headers,
 * small labeled figures on the right, pills in the status colors, the nine-segment stage progress mark, the gold
 * small-caps section headings that collapse their section, the filter pills with the Find box and the Collapse all
 * control, and the small row buttons. Server and client components both use them.
 */

/**
 * The pinned header rule (approved 2026-10-31, item 21), shared by every Work page and every card that scrolls:
 * a pinned header has a solid background (the page background for the page block, white for a card header) that
 * fully covers what scrolls under it, and a hairline at its bottom edge. Nothing shows through or touches it.
 */

/**
 * The pinned block at the top of a Work page: the title, the tabs, the filter pills with Find and Collapse all.
 * Solid page background, 12px of space under its last row, a 1px hairline (the border color) at the bottom edge, and
 * the first card 16px below it. It stays at the top while the page scrolls on desktop; on the phone it scrolls with
 * the page (the same background, space, and hairline).
 */
export function PinnedBlock({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="z-10 mb-4 border-b border-border bg-background pb-3 lg:sticky lg:top-0 lg:-mt-6 lg:pt-6" data-testid={testId} data-pinned="page">
      {children}
    </div>
  );
}

/** A card header that stays at the top while the card scrolls (desktop): solid white, a gold hairline across the full width. */
export const PINNED_CARD_HEADER = "bg-white border-b border-gold-rule lg:sticky lg:top-0 lg:z-[2]";

export function WorkCard({ id, title, count, hint, sub, actions, children, className, testId, rule = true, pinned = false, scroll = false, bodyClassName }: { id?: string; title: React.ReactNode; count?: number | null; hint?: React.ReactNode; /** A quiet line under the title (for narrow cards, where a hint at the right would wrap). */ sub?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; /** False: no gold rule (a closed card ends at its title row). */ rule?: boolean; /** The title row stays at the top while the content under it scrolls (desktop): solid white with the hairline across the full width. */ pinned?: boolean; /** The card scrolls on its own (desktop); give it a height through className. */ scroll?: boolean; bodyClassName?: string }) {
  return (
    <section id={id} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", scroll && "lg:overflow-y-auto", className)} data-testid={testId}>
      <div className={cn("rounded-t-xl bg-white", pinned && rule && PINNED_CARD_HEADER)} data-pinned={pinned && rule ? "card" : undefined}>
        <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-[22px] pt-4", rule ? "pb-3" : "pb-4")}>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-slate-900">
            <span>{title}</span>
            {count ? <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral">{count}</span> : null}
          </h2>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : hint ? <span className="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">{hint}</span> : null}
          {sub ? <div className="-mt-1 w-full text-[13px] text-muted-foreground">{sub}</div> : null}
        </div>
        {rule && !pinned ? <div className="mx-[22px] h-px bg-gold-rule" /> : null}
      </div>
      {rule ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}

/**
 * A section heading inside a card (mockup v6): gold small caps with a thin gold line, the count at the right, a
 * small triangle that turns when the section is collapsed. An empty section is a faint heading with "none" and does
 * not collapse. `hint` shows at the right on wider screens (the buy box line, "Next by default: ...").
 */
export function SectionHeading({ name, count, collapsed, onToggle, hint, title, testId = "section-heading", dataAttrs, className, countRight = false }: { name: string; count: number; collapsed: boolean; onToggle?: () => void; hint?: React.ReactNode; title?: string; testId?: string; dataAttrs?: Record<string, string>; className?: string; /** The count at the right end (the Deals stage headings) instead of next to the name. */ countRight?: boolean }) {
  const empty = count === 0;
  const cls = cn(
    "group mt-3 mb-1 flex w-full items-center gap-2 border-b py-1.5 pb-[7px] text-left text-[12.5px] font-medium tracking-[0.09em] uppercase select-none",
    empty ? "cursor-default border-slate-100 text-slate-400" : "cursor-pointer border-gold-rule text-gold-strong",
    className,
  );
  const body = (
    <>
      <svg viewBox="0 0 10 10" className={cn("h-[9px] w-3 shrink-0 text-gold-rule transition-transform group-hover:text-gold", collapsed && "-rotate-90", empty && "invisible")} aria-hidden>
        <path d="M1 2.5h8L5 8z" fill="currentColor" />
      </svg>
      <span className="min-w-0 truncate">{name}</span>
      {empty ? <span className={cn("tabular text-xs font-normal tracking-normal normal-case", countRight ? "ml-auto" : "ml-1")}>none</span> : <span className={cn("tabular text-[12.5px] font-medium tracking-normal text-muted-foreground", countRight ? "ml-auto" : "ml-1")}>{count}</span>}
      {hint ? <span className={cn("hidden min-w-0 truncate text-xs font-normal tracking-normal normal-case text-slate-400 md:block", !countRight && "ml-auto")}>{hint}</span> : null}
    </>
  );
  if (empty || !onToggle) {
    return (
      <div title={title} className={cls} data-testid={testId} data-count={count} {...dataAttrs}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} title={title} className={cls} data-testid={testId} data-count={count} {...dataAttrs}>
      {body}
    </button>
  );
}

/** "Collapse all" or "Expand all" at the right end of a filter row: one small text control whose label flips. */
export function CollapseAllButton({ allCollapsed, onClick, className }: { allCollapsed: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("shrink-0 px-0.5 py-1 text-[12.5px] font-medium whitespace-nowrap text-primary-strong hover:underline", className)} data-testid="collapse-all" data-state={allCollapsed ? "collapsed" : "expanded"}>
      {allCollapsed ? "Expand all" : "Collapse all"}
    </button>
  );
}

/**
 * The filter row under the tabs: the pills with their counts (one active), the Find box, and Collapse all at the
 * right end. `prefix` names the test ids ("deals-filter-wait", "deals-search"). It is the last row of the PinnedBlock,
 * which adds the space and the hairline under it.
 */
export function FilterRow<K extends string>({ prefix, filters, active, counts, onPick, query, onQuery, placeholder = "Find", collapse, className }: { prefix: string; filters: readonly { key: K; label: string }[]; active: K; counts: Record<K, number>; onPick: (k: K) => void; query: string; onQuery: (q: string) => void; placeholder?: string; collapse?: { allCollapsed: boolean; onClick: () => void } | null; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid={`${prefix}-filters`}>
      {filters.map((f) => {
        const on = active === f.key;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onPick(f.key)}
            className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", on ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-status-neutral hover:bg-slate-50")}
            aria-pressed={on}
            data-testid={`${prefix}-filter-${f.key}`}
            data-count={counts[f.key]}
          >
            {f.label}
            <span className={cn("tabular ml-[5px] font-medium", on ? "text-primary-strong" : "text-slate-400")}>{counts[f.key]}</span>
          </button>
        );
      })}
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-[30px] w-full rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:ml-auto sm:w-[200px]"
        data-testid={`${prefix}-search`}
      />
      {collapse ? <CollapseAllButton allCollapsed={collapse.allCollapsed} onClick={collapse.onClick} /> : null}
    </div>
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

export type PillTone = "gray" | "amber" | "red" | "green" | "gold" | "blue" | "quiet" | "charcoal";

const PILL: Record<PillTone, string> = {
  gray: "border-border bg-status-neutral-bg text-status-neutral",
  /** Passed and Lost: medium charcoal with white text (approved 2026-10-31). */
  charcoal: "border-[#4b5563] bg-[#4b5563] text-white",
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

/** A stage heading with the gold bar, the name and the count (the Passed, Lost, and Closed groups under the Deals columns). */
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

/** The inline confirmation strip inside a row (after Done, Interested, Follow up). */
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

/** The small buttons on rows: blue (primary), soft blue (Interested), gold (Follow up), or outline. */
export function RowButton({ tone = "outline", className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "soft" | "gold" | "outline" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-[30px] items-center justify-center rounded-[7px] border px-[11px] text-[12.5px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        tone === "primary" && "border-primary bg-primary text-white hover:border-primary-hover hover:bg-primary-hover",
        tone === "soft" && "border-primary-border bg-primary-soft text-primary hover:bg-[#e3ebfd]",
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

/** The page title row: the title on the left, the date or buttons on the right. */
export function WorkHeader({ title, right, crumb, under }: { title: React.ReactNode; right?: React.ReactNode; crumb?: React.ReactNode; /** A quiet line under the title ("Listed as 00 ..."). */ under?: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      {crumb ? <div className="mb-1.5 text-[13px] text-muted-foreground">{crumb}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h1>
          {under ? <div className="mt-0.5 text-[13px] text-muted-foreground">{under}</div> : null}
        </div>
        {right ? <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">{right}</div> : null}
      </div>
    </div>
  );
}

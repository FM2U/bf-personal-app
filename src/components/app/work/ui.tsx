import Link from "next/link";
import { progressSegments, type WaitLevel } from "@/lib/work/stages";
import { FIGURE_GAP_CLS, FIGURE_LABEL_CLS, figureValueClass, isEmptyValue, type FigureTone } from "@/lib/work/figure-style";
import { cn } from "@/lib/utils";
import { OpenRow } from "@/components/app/work/open-row";
import { DockingActions, SlimBar } from "@/components/app/work/slim-bar";

/**
 * The building blocks of the Work screens (approved mockup 2026-10-30, mockup v6 2026-10-31; the color system of Edit
 * batch B, 2026-11-01): a card with a thin hairline under its title (the title row can stay pinned while the card
 * scrolls), two-line rows without column headers, small labeled figures on the right in fixed-width columns, pills in
 * the status colors, the nine-segment stage progress mark, the charcoal small-caps section headings that collapse
 * their section, the filter pills with the Find box and the Collapse all control, and the small row buttons. Server
 * and client components both use them.
 *
 * Colors (the swatch sheet approved 2026-11-01): structure in slate (headings and card titles charcoal, hairlines,
 * labels, the neutral pill), actions in cobalt (links, outlined buttons; solid only for the one main action per page),
 * soft blue for lane and purpose pills, Follow up, Interested, and the active filter pill, status only in green, amber,
 * and red, purple only for the AI, and #00F0FF only as the stage mark's current segment and the counter bar fill; its
 * faded tint (--stage-soft) only as the stage pill's fill. Every small-caps label shares one style (.label-caps in
 * globals.css: charcoal, 11.5px, 0.09em, weight 600); the AI labels keep the same metrics in purple.
 *
 * The alignment rule (Edit batch B, item 5): every row keeps fixed-width columns for its figures and buttons, sized
 * for the longest case ("4 days late", "120 min"), so nothing shifts between rows when text wraps or a value is
 * longer; the text columns wrap inside their own width. The widths are in ROW_COLS (one place to edit, tested).
 * Edit batch C (items 4 and 8): on Outreach, Targets, and End of day the text column keeps a reserved 32px gap
 * (TEXT_GAP) before the first figure or mark column, so wrapped text never touches it; the grids are in ROW_GRIDS.
 * 2026-11-05: the Targets rows (Targets, End of day, the Monthly review's How the month went) keep 48px
 * (TARGET_TEXT_GAP) before the status mark.
 */

/** The space between the figure columns of a listing row (REVENUE, EBITDA, ASKING; Edit batch C round 2, item 2): about 28px. */
export const FIGURE_COLS_GAP = { px: 28, cls: "gap-x-7" } as const;

/** The reserved gap between a row's text and its first figure or mark column (Edit batch C, items 4 and 8). */
export const TEXT_GAP = { px: 32, cls: "sm:gap-x-8" } as const;

/** The wider gap the Targets rows keep between their text and the status mark (2026-11-05): the grid gap plus the text's right margin. */
export const TARGET_TEXT_GAP = { px: 48 } as const;

/**
 * The fixed grids of the target rows (Edit batch C, item 8): the text column takes what is left and wraps; every other
 * column has a fixed width, so the mark and the figures sit at the same x on every row. `gap` is the grid's column gap
 * and `textMargin` the text cell's right margin: together they make TARGET_TEXT_GAP (48px) before the mark.
 */
export const ROW_GRIDS = {
  /** Targets: the text, the status mark (22px), the two figures (82px each, 24px apart), the Commitment switch and Edit. */
  target: { cls: "sm:grid-cols-[minmax(0,1fr)_22px_188px_202px]", gap: 16, gapCls: "sm:gap-x-4", textMargin: 32, textMarginCls: "sm:mr-8" },
  /** End of day (its Targets rows and the "Owed from" rows): the text, the status mark (22px), the figure (82px). */
  eodTarget: { cls: "grid-cols-[minmax(0,1fr)_22px_82px]", gap: 16, gapCls: "gap-x-4", textMargin: 32, textMarginCls: "mr-8" },
  /** The Monthly review's How the month went: the text, the status mark (22px), Weeks met (82px), and Average (86px; under Weeks met on the phone). */
  monthlyWent: { cls: "grid-cols-[minmax(0,1fr)_22px_82px] sm:grid-cols-[minmax(0,1fr)_22px_82px_86px]", gap: 16, gapCls: "gap-x-4", textMargin: 32, textMarginCls: "mr-8" },
} as const;

/**
 * The fixed row columns (the alignment rule). Each is a Tailwind width class plus the longest text it was sized for;
 * a column marks itself with data-col so the flow checks can measure the same x on every row.
 */
export const ROW_COLS = {
  /** "4 days late" at 12px semibold. */
  due: { cls: "w-[82px]", longest: "4 days late" },
  /** "120 min" at 12px. */
  minutes: { cls: "w-[56px]", longest: "120 min" },
  /** Done or Later (Done reads "Saving" while it saves). */
  button: { cls: "min-w-[68px]", longest: "Saving" },
  /** The Done and Later pair, or the one Set next action link that takes the pair's place. */
  buttonPair: { cls: "w-[142px]", longest: "Set the next action" },
  /** LAST CONTACT: "Oct 27 · meeting" at the 15.5px figure size (Edit batch C round 2). */
  lastContact: { cls: "w-[140px]", longest: "Oct 27 · meeting" },
  /** NEXT FOLLOW-UP and NEXT: "4 days late" (the label NEXT FOLLOW-UP is the wider part; it shows in full, Edit batch C item 4). */
  nextDate: { cls: "w-[132px]", longest: "NEXT FOLLOW-UP" },
  /** TASKS: a count. */
  count: { cls: "w-[44px]", longest: "99" },
  /** The money figures on listing rows: "Not stated" at the 15.5px figure size (Edit batch C round 2). */
  money: { cls: "w-[88px]", longest: "Not stated" },
  /** The wider buttons: Interested, Set the next action. */
  wideButton: { cls: "min-w-[90px]", longest: "Interested" },
  /** PEOPLE on an organization row (push B): a count under the label. */
  people: { cls: "w-[60px]", longest: "PEOPLE" },
  /** OPEN DEALS on an organization row (push B): "None" or a count. */
  openDeals: { cls: "w-[88px]", longest: "OPEN DEALS" },
} as const;

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
    <div className="z-10 mb-4 border-b border-border bg-background pb-3 lg:sticky lg:top-0 lg:-mt-6 lg:pt-6" data-testid={testId} data-pinned="page" data-header-end>
      {children}
    </div>
  );
}

/** A card header that stays at the top while the card scrolls (desktop): solid white, a hairline across the full width. */
export const PINNED_CARD_HEADER = "bg-white border-b border-rule lg:sticky lg:top-0 lg:z-[2]";
/** The same on Work on now, whose cards scroll on their own only in a desktop window tall enough (the desk variant). */
const PINNED_CARD_HEADER_DESK = "bg-white border-b border-rule desk:sticky desk:top-0 desk:z-[2]";

export function WorkCard({ id, ref, role, labelledBy, pinAt = "lg", lead, title, count, hint, sub, actions, children, className, testId, rule = true, pinned = false, scroll = false, bodyClassName, headerClassName }: { ref?: React.Ref<HTMLElement>; /** "tabpanel" under status tiles, with the selected tile's id in labelledBy. */ role?: string; labelledBy?: string; /** From which width the title row pins and the card scrolls on its own: "desk" on Work on now (a desktop window tall enough). */ pinAt?: "lg" | "desk"; /** A control right after the title and count, on the left (Work through). */ lead?: React.ReactNode; id?: string; title: React.ReactNode; count?: number | null; hint?: React.ReactNode; /** A quiet line under the title (for narrow cards, where a hint at the right would wrap). */ sub?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; /** False: no rule under the title (a closed card ends at its title row). */ rule?: boolean; /** The title row stays at the top while the content under it scrolls (desktop): solid white with the hairline across the full width. */ pinned?: boolean; /** The card scrolls on its own (desktop); give it a height through className. */ scroll?: boolean; bodyClassName?: string; /** Extra classes on the title row (a minimum height so cards side by side line up). */ headerClassName?: string }) {
  return (
    <section id={id} ref={ref} role={role} aria-labelledby={labelledBy} className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", scroll && (pinAt === "desk" ? "desk:overflow-y-auto" : "lg:overflow-y-auto"), className)} data-testid={testId}>
      <div className={cn("rounded-t-xl bg-white", pinned && rule && (pinAt === "desk" ? PINNED_CARD_HEADER_DESK : PINNED_CARD_HEADER), headerClassName)} data-pinned={pinned && rule ? "card" : undefined}>
        <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-[22px] pt-4", lead && "gap-x-8 gap-y-2.5", rule ? "pb-3" : "pb-4")}>
          {lead ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="card-title-lead">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-heading">
                <span>{title}</span>
                {count ? <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral">{count}</span> : null}
              </h2>
              {lead}
            </div>
          ) : (
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap text-heading">
              <span>{title}</span>
              {count ? <span className="tabular rounded-full bg-status-neutral-bg px-2 py-px text-[11px] font-semibold leading-4 text-status-neutral">{count}</span> : null}
            </h2>
          )}
          {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : hint ? <span className="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">{hint}</span> : null}
          {sub ? <div className="-mt-1 w-full text-[13px] text-muted-foreground">{sub}</div> : null}
        </div>
        {rule && !pinned ? <div className="mx-[22px] h-px bg-rule" /> : null}
      </div>
      {rule ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}

/**
 * A section heading inside a card (mockup v6): charcoal small caps with a thin hairline, the count at the right, a
 * small triangle that turns when the section is collapsed. An empty section is a faint heading with "none" and does
 * not collapse. `hint` shows at the right on wider screens (the buy box line, "Next by default: ...").
 */
export function SectionHeading({ name, count, collapsed, onToggle, hint, title, testId = "section-heading", dataAttrs, className, countRight = false, band = false, urgent = false }: { name: string; count: number; collapsed: boolean; onToggle?: () => void; hint?: React.ReactNode; title?: string; testId?: string; dataAttrs?: Record<string, string>; className?: string; /** The count at the right end (the Deals stage headings) instead of next to the name. */ countRight?: boolean;
  /**
   * Band headings (Contacts Follow-ups, Home Next actions; approved 2026-11-03): a faint band across the card, the name
   * in bold, the count in a badge before the name (electric blue with a dark number; soft red for Overdue above 0;
   * a gray outline for 0), and the heading stays at the top while its section scrolls by (inside StickySections).
   */
  band?: boolean;
  /** With band: the Overdue section (a red badge while it has rows). */
  urgent?: boolean }) {
  const empty = count === 0;
  if (band) return <BandHeading name={name} count={count} collapsed={collapsed} onToggle={onToggle} hint={hint} title={title} testId={testId} dataAttrs={dataAttrs} className={className} urgent={urgent} />;
  const cls = cn(
    "label-caps group mt-3 mb-1 flex w-full items-center gap-2 border-b py-1.5 pb-[7px] text-left select-none",
    empty ? "cursor-default border-slate-100" : "cursor-pointer border-rule",
    className,
  );
  const body = (
    <>
      <svg viewBox="0 0 10 10" className={cn("h-[9px] w-3 shrink-0 text-status-neutral-solid transition-transform group-hover:text-slate-500", collapsed && "-rotate-90", empty && "invisible")} aria-hidden>
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

/**
 * The band across a card (approved 2026-11-03): faint fill, hairlines above and below, charcoal small caps. It stays at
 * the top while its list scrolls: under the card's pinned title row when the card scrolls on its own (--section-top,
 * set by StickySections), otherwise under the slim pinned bar of the page (--mini-h, set by SlimBar).
 */
export const BAND_CLS = "label-caps group sticky top-[var(--section-top,var(--mini-h,0px))] z-[1] -mx-[22px] -mt-px flex w-[calc(100%+44px)] items-center gap-2 border-y border-rule bg-slate-50 px-[22px] py-2 text-left font-semibold text-heading select-none";

/** The band's count badge: electric blue with a dark number; soft red for Overdue above 0; a gray outline for 0. */
export function bandBadgeClass(count: number, urgent = false): string {
  const tone = count === 0 ? "border border-slate-300 bg-white text-slate-400" : urgent ? "border border-status-missed-border bg-status-missed-bg text-status-missed" : "bg-electric text-slate-900";
  return cn("tabular inline-flex h-[19px] min-w-[28px] shrink-0 items-center justify-center rounded-full px-1 text-[11.5px] font-semibold tracking-normal", tone);
}

/**
 * The flat band that heads the one list a status tile picks (approved 2026-11-04): the badge, then the title, aligned
 * left; no caret, not clickable. It stays pinned while the rows scroll.
 */
export function ListBand({ name, count, urgent = false, hint, testId = "list-band", id }: { name: string; count: number; urgent?: boolean; hint?: React.ReactNode; testId?: string; id?: string }) {
  return (
    <div id={id} className={cn(BAND_CLS, "cursor-default")} data-testid={testId} data-count={count} data-band="1">
      <span className={bandBadgeClass(count, urgent)} data-testid="section-count">
        {count}
      </span>
      <span className="min-w-0 truncate">{name}</span>
      {hint ? <span className="ml-auto hidden min-w-0 truncate text-xs font-normal tracking-normal normal-case text-slate-400 md:block">{hint}</span> : null}
    </div>
  );
}

function BandHeading({ name, count, collapsed, onToggle, hint, title, testId, dataAttrs, className, urgent }: { name: string; count: number; collapsed: boolean; onToggle?: () => void; hint?: React.ReactNode; title?: string; testId: string; dataAttrs?: Record<string, string>; className?: string; urgent: boolean }) {
  const empty = count === 0;
  const cls = cn(
    BAND_CLS,
    empty ? "cursor-default" : "cursor-pointer hover:bg-slate-100",
    className,
  );
  // Approved 2026-11-03: the badge on the left (after the caret), one width so the names line up.
  const body = (
    <>
      <svg viewBox="0 0 10 10" className={cn("h-[9px] w-3 shrink-0 text-slate-500 transition-transform group-hover:text-slate-700", collapsed && "-rotate-90", empty && "invisible")} aria-hidden>
        <path d="M1 2.5h8L5 8z" fill="currentColor" />
      </svg>
      <span className={bandBadgeClass(count, urgent)} data-testid="section-count">
        {count}
      </span>
      <span className="min-w-0 truncate">{name}</span>
      {hint ? <span className="ml-auto hidden min-w-0 truncate text-xs font-normal tracking-normal normal-case text-slate-400 md:block">{hint}</span> : null}
    </>
  );
  if (empty || !onToggle) {
    return (
      <div title={title} className={cls} data-testid={testId} data-count={count} data-band="1" {...dataAttrs}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} title={title} className={cls} data-testid={testId} data-count={count} data-band="1" {...dataAttrs}>
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
export function FilterRow<K extends string>({ prefix, filters, active, counts, onPick, query, onQuery, placeholder = "Find", collapse, className, searchClassName, extra }: { prefix: string; filters: readonly { key: K; label: string; /** A thin vertical hairline before this pill (a second group of pills). */ sepBefore?: boolean }[]; active: K; counts: Record<K, number>; onPick: (k: K) => void; query: string; onQuery: (q: string) => void; placeholder?: string; collapse?: { allCollapsed: boolean; onClick: () => void } | null; className?: string; searchClassName?: string; /** One more control right after the pills (the Show pill on Home). */ extra?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid={`${prefix}-filters`}>
      {filters.map((f) => {
        const on = active === f.key;
        return (
          <span key={f.key} className="contents">
            {f.sepBefore ? <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => onPick(f.key)}
              className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[12.5px] font-medium whitespace-nowrap", on ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border bg-white text-slate-600 hover:bg-slate-50")}
              aria-pressed={on}
              data-testid={`${prefix}-filter-${f.key}`}
              data-count={counts[f.key]}
            >
              {f.label}
              <span className={cn("tabular ml-[5px] font-medium", on ? "text-primary-strong" : "text-slate-400")}>{counts[f.key]}</span>
            </button>
          </span>
        );
      })}
      {extra}
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn("h-[30px] w-full rounded-[7px] border border-input bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:ml-auto sm:w-[200px]", searchClassName)}
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

/**
 * One row: the text on the left (two or three lines, wrapping inside its own width), the figures and buttons on the
 * right. The right side keeps its content's fixed widths (ROW_COLS), so the columns sit at the same x on every row.
 * A row that opens something carries the shared hover (.row-hover, Edit batch C round 3): `href` makes the whole row
 * a link (rows with no buttons); `open` (an address) or `onOpen` (a popup) makes a row with buttons open when clicked
 * outside its buttons and links (OpenRow). A row that opens nothing has no hover.
 */
export function RowShell({ children, right, className, href, open, onOpen, openLabel, testId, dataAttrs, stack = false, textGap = false }: { children: React.ReactNode; right?: React.ReactNode; className?: string; href?: string; /** The page the row opens when clicked outside its buttons and links. */ open?: string; /** What a click on the row does instead (the listing popup). */ onOpen?: () => void; /** What the row opens, for a screen reader. */ openLabel?: string; testId?: string; dataAttrs?: Record<string, string>; /** The figures and buttons go under the text (narrow columns). */ stack?: boolean; /** The reserved 32px gap before the figures (TEXT_GAP; Outreach rows). */ textGap?: boolean }) {
  const cls = cn("grid grid-cols-1 items-center gap-x-[18px] gap-y-1.5 border-t border-slate-100 px-[22px] py-[13px] first:border-t-0", !stack && "sm:grid-cols-[minmax(0,1fr)_auto]", textGap && TEXT_GAP.cls, href && "row-hover", className);
  const body = (
    <>
      <div className="min-w-0" data-row-text>{children}</div>
      {right ? <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2 whitespace-nowrap", !stack && "sm:justify-end", stack && "mt-1")} data-row-right>{right}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} data-testid={testId} {...dataAttrs}>
        {body}
      </Link>
    );
  }
  if (open || onOpen) {
    return (
      <OpenRow href={open} onOpen={onOpen} label={openLabel} className={cls} testId={testId} dataAttrs={dataAttrs}>
        {body}
      </OpenRow>
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

/**
 * A figure with its label under it, right-aligned, in a fixed-width column (the money figures on listing rows). The
 * value and label follow the facts and figures style (Edit batch C round 2, item 1: src/lib/work/figure-style.ts).
 */
export function Stat({ value, label, className, testId, col = "money" }: { value: React.ReactNode; label: React.ReactNode; className?: string; testId?: string; /** The fixed column (ROW_COLS) this figure sits in. */ col?: keyof typeof ROW_COLS }) {
  return (
    <div className={cn("flex flex-col items-start leading-tight sm:items-end", FIGURE_GAP_CLS, ROW_COLS[col].cls, className)} data-testid={testId} data-col={col} data-empty={isEmptyValue(value) ? "1" : undefined}>
      <b className={cn("tabular max-w-full truncate", figureValueClass(value))} data-figure-value>{value}</b>
      <span className={cn(FIGURE_LABEL_CLS, "max-w-full truncate")} data-figure-label>{label}</span>
    </div>
  );
}

export type PillTone = "gray" | "amber" | "red" | "green" | "blue" | "quiet" | "charcoal" | "stage";

const PILL: Record<PillTone, string> = {
  /** The neutral pill: stages, days under the threshold, counts. */
  gray: "border-border bg-status-neutral-bg text-status-neutral",
  /** Passed and Lost: medium charcoal with white text (approved 2026-10-31). */
  charcoal: "border-[#4b5563] bg-[#4b5563] text-white",
  amber: "border-status-soon-border bg-status-soon-bg text-status-soon",
  red: "border-status-missed-border bg-status-missed-bg text-status-missed",
  green: "border-status-met-border bg-status-met-bg text-status-met",
  /** Soft blue: lane and purpose pills, Interested, what belongs to you but is not a status. */
  blue: "border-primary-border bg-primary-soft text-primary-strong",
  quiet: "border-transparent bg-transparent pl-0 text-slate-400",
  /** The pipeline stage pill ("Interested · day 2"): very faded cyan, charcoal text, no border; no other element uses the tint. */
  stage: "border-transparent bg-stage-soft text-heading",
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

/**
 * The figure columns at the right of a next-action row (Home and the lane pages): the due date and the block minutes,
 * each a fixed-width column (ROW_COLS) with its text at the right, so the columns line up on every row. Then the
 * buttons (`children`). Push C: with `block` (Home), "Blocked 2:00" shows under the due date and the block icon
 * (Block time) sits in its own column before the buttons.
 */
export function ActionFigures({ due, minutes, children, testId = "next-action-due", block }: { due: { text: string; tone: "today" | "over" | "later" | "none" } | null; minutes: number | null | undefined; children?: React.ReactNode; testId?: string; /** Push C: the "Blocked 2:00" line and the block icon (blockSlots in block-time.tsx). */ block?: { note: React.ReactNode; button: React.ReactNode } }) {
  return (
    <>
      <span className={cn("shrink-0 text-right", ROW_COLS.due.cls)} data-col="due">
        {due ? <Due text={due.text} tone={due.tone} testId={testId} /> : null}
        {block?.note}
      </span>
      <span className={cn("tabular shrink-0 text-right text-xs text-slate-400", ROW_COLS.minutes.cls)} data-col="minutes" data-testid="next-action-minutes">
        {minutes ? `${minutes} min` : ""}
      </span>
      {block?.button}
      {children}
    </>
  );
}

/**
 * The buttons at the end of a row, in one column. `pair`: the fixed width of the Done and Later pair
 * (ROW_COLS.buttonPair), which a single Set next action link fills, so the column starts at the same x on every row.
 */
export function RowButtons({ children, className, pair = false, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode; className?: string; pair?: boolean }) {
  // A click on the buttons never reaches a row that opens on click (Edit batch C round 3).
  return (
    <div className={cn("flex shrink-0 justify-end gap-1.5", pair && ROW_COLS.buttonPair.cls, className)} data-col="buttons" data-row-stop {...props}>
      {children}
    </div>
  );
}

/** The nine-segment stage progress mark: cobalt for stages done, #00F0FF with a cobalt outline for the current one, light gray for the rest. */
export function ProgressMark({ stage, className }: { stage: string | null | undefined; className?: string }) {
  const segs = progressSegments(stage);
  return (
    <span className={cn("inline-flex shrink-0 gap-0.5 align-middle", className)} aria-label={stage ? `Stage: ${stage}` : "No stage"} title={stage ?? undefined} data-testid="progress-mark">
      {segs.map((s, i) => (
        <i key={i} className={cn("block h-[11px] w-[5px] rounded-[2px]", s === "done" ? "bg-primary" : s === "current" ? "bg-electric shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-border")} data-seg={s} />
      ))}
    </span>
  );
}

/** A stage heading with the quiet bar, the name and the count (the Passed, Lost, and Closed groups under the Deals columns). */
export function StageHeading({ name, count, hint, empty, children }: { name: string; count: number; hint?: string | null; empty?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-[22px] text-[13px]", empty ? "py-[11px] font-medium text-slate-400" : "pt-3.5 pb-1 font-semibold text-slate-900")}>
      <span className={cn("h-3.5 w-[3px] shrink-0 rounded-[2px]", empty ? "bg-border" : "bg-status-neutral-solid")} aria-hidden />
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
      data-row-stop
    >
      {children}
    </div>
  );
}

/**
 * The small buttons on rows and cards. primary: solid cobalt, only for the one main action on a page (Add a listing,
 * Add a person, Add a project, Save, Send, Approve; #14297b at rest, #1e40af on hover). cobalt: outlined, cobalt text
 * and edge, white fill, soft blue on hover (Done, Advance, Reopen, the choices after Done). soft: soft blue fill
 * (Interested, Follow up). outline: gray edge (Later, Pass, Email, Log a call, Cancel).
 */
type RowButtonTone = "primary" | "cobalt" | "soft" | "outline";
export const ROW_BUTTON_BASE = "inline-flex h-[30px] items-center justify-center rounded-[7px] border px-[11px] text-[12.5px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
export const ROW_BUTTON_TONE: Record<RowButtonTone, string> = {
  primary: "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover",
  cobalt: "border-primary bg-white text-primary-strong hover:border-primary-border hover:bg-primary-soft",
  soft: "border-primary-border bg-primary-soft text-primary-strong hover:bg-primary-soft-hover",
  outline: "border-input bg-white text-slate-800 hover:bg-slate-50",
};
export function RowButton({ tone = "outline", className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: RowButtonTone }) {
  return (
    <button type="button" className={cn(ROW_BUTTON_BASE, ROW_BUTTON_TONE[tone], className)} data-tone={tone} {...props}>
      {children}
    </button>
  );
}

/** A link drawn as a row button (Set next action, Set the next action). */
export function RowLink({ tone = "outline", className, children, href, ...props }: React.ComponentProps<typeof Link> & { tone?: RowButtonTone; className?: string }) {
  return (
    <Link href={href} className={cn(ROW_BUTTON_BASE, ROW_BUTTON_TONE[tone], className)} data-tone={tone} {...props}>
      {children}
    </Link>
  );
}

/**
 * The one thinking state of every AI control (Edit batch B, item 1): while the AI works the button is grayed, shows a
 * small spinner, and reads "Thinking". Used by the Suggest buttons, Fill from text, Write it, Write with AI, and Ask.
 */
export function Thinking({ label = "Thinking", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-testid="ai-thinking" role="status">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

/** An AI button: the purple four-point star and its label ("Suggest tasks"); in its thinking state it is grayed with the spinner and "Thinking". */
export function AiButton({ busy, children, className, disabled, tone = "outline", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy: boolean; tone?: RowButtonTone }) {
  return (
    <button type="button" className={cn(ROW_BUTTON_BASE, ROW_BUTTON_TONE[tone], busy && "border-border bg-slate-50 text-slate-400 hover:bg-slate-50 disabled:opacity-100", className)} disabled={disabled || busy} data-busy={busy ? "1" : "0"} {...props}>
      {busy ? (
        <Thinking />
      ) : (
        <>
          <svg viewBox="0 0 16 16" className="mr-1.5 h-3 w-3 shrink-0 text-violet" aria-hidden>
            <path d="M8 0.5 C8.6 4.4 9.9 6.4 15.5 8 C9.9 9.6 8.6 11.6 8 15.5 C7.4 11.6 6.1 9.6 0.5 8 C6.1 6.4 7.4 4.4 8 0.5 Z" fill="currentColor" />
          </svg>
          {children}
        </>
      )}
    </button>
  );
}

/**
 * The page title row: the title on the left, the date or buttons on the right. `slim` (2026-11-04): the slim pinned
 * bar with the small title that slides in once the full header has scrolled off; "narrow" (the default) only under
 * 1024px, where nothing else stays pinned; "always" at every width (record pages, where the buttons at the right move
 * into the bar while it shows); false when the page draws its own (Work on now, Contacts, To-dos).
 */
export function WorkHeader({ title, slimTitle, right, crumb, under, slim = "narrow" }: { title: React.ReactNode; /** A shorter title for the slim bar (End of day drops the date). */ slimTitle?: React.ReactNode; right?: React.ReactNode; crumb?: React.ReactNode; /** A quiet line under the title ("Listed as 00 ..."). */ under?: React.ReactNode; slim?: "narrow" | "always" | false }) {
  const docking = slim === "always" && !!right;
  return (
    <div className="mb-1.5">
      {slim && !docking ? <SlimBar title={slimTitle ?? title} mode={slim} /> : null}
      {crumb ? <div className="mb-1.5 text-[13px] text-muted-foreground">{crumb}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h1>
          {under ? <div className="mt-0.5 text-[13px] text-muted-foreground">{under}</div> : null}
        </div>
        {docking ? <DockingActions title={slimTitle ?? title}>{right}</DockingActions> : right ? <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">{right}</div> : null}
      </div>
    </div>
  );
}

/**
 * A labeled figure (batch B): the value above its small uppercase label, right-aligned on wide screens. The value's
 * color follows a tone (amber for today, red for overdue, gray for none). Figures sit 28px apart (`Figures`). On a
 * row the figure sits in a fixed column (`col`, ROW_COLS) so it lines up on every row; the record header leaves it.
 * Edit batch C round 2 (item 1): the value 15.5px semibold near-black, an empty value muted gray, the label 11px
 * medium small caps 4px under it (src/lib/work/figure-style.ts).
 */
export function Figure({ value, label, tone = "plain", className, testId, col }: { value: React.ReactNode; label: React.ReactNode; tone?: FigureTone; className?: string; testId?: string; col?: keyof typeof ROW_COLS }) {
  return (
    <div className={cn("flex flex-col items-start leading-tight sm:items-end", FIGURE_GAP_CLS, col ? ROW_COLS[col].cls : "min-w-[72px]", className)} data-testid={testId} data-tone={tone} data-col={col} data-empty={isEmptyValue(value) ? "1" : undefined}>
      <b className={cn("tabular max-w-full truncate whitespace-nowrap", figureValueClass(value, tone))} data-figure-value>{value}</b>
      <span className={cn(FIGURE_LABEL_CLS, "max-w-full truncate whitespace-nowrap")} data-figure-label>{label}</span>
    </div>
  );
}

/** Labeled figures side by side, 28px apart (the record page header, the Outreach rows). */
export function Figures({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end gap-x-7 gap-y-2", className)} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * The weekly counter (batch B): "Network outreach: 4 of 10 this week" with a thin bar (#00F0FF on light gray), and a
 * quiet line at the right on wide screens ("Counted from emails sent and calls logged, Mon to Fri").
 */
export function TargetBar({ count, target, pct, hint, className, testId = "outreach-counter" }: { count: number; target: number; pct: number; hint?: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 px-[22px] py-3", className)} data-testid={testId} data-count={count} data-target={target}>
      <span className="text-[13px] text-slate-800 whitespace-nowrap">
        Network outreach: <b className="tabular font-semibold text-slate-900">{count}</b> of {target} this week
      </span>
      <span className="h-[5px] w-full max-w-[220px] overflow-hidden rounded-full bg-border" aria-hidden>
        <i className="block h-full rounded-full bg-electric" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      {hint ? <span className="hidden min-w-0 text-xs text-slate-400 md:ml-auto md:block">{hint}</span> : null}
    </div>
  );
}

/** An area pill on a Work on now row (Contacts, Rosara, Job search, Consulting, To-do, Task; deals have none): one soft blue for all. */
export function LanePill({ lane, className }: { lane: "People" | "Rosara" | "Job search" | "Consulting" | "To-do" | "Task"; className?: string }) {
  return (
    <Pill tone="blue" className={className} testId="lane-pill">
      {lane === "People" ? "Contacts" : lane}
    </Pill>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNTABILITY_TABS, MAIN_NAV, mainFor, moduleFor, WORK_TABS, workTabFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { ModuleIcon } from "@/components/app/module-icon";

/** A small count next to a menu or tab label (listings to screen; amber for people due on People, Follow-ups). */
function CountBadge({ n, className, testId, tone = "gray" }: { n: number | null | undefined; className?: string; testId?: string; tone?: "gray" | "amber" }) {
  if (!n) return null;
  return (
    <span className={cn("tabular rounded-full px-2 py-px text-[11px] font-semibold leading-4", tone === "amber" ? "bg-status-soon-bg text-status-soon" : "bg-status-neutral-bg text-status-neutral", className)} data-testid={testId}>
      {n}
    </span>
  );
}

/** The End of day badge (batch C): "5:30" (amber) until the day is closed, then "Sent" (green) or "Skipped" (gray). */
export type EodBadge = "5:30" | "Sent" | "Skipped" | null;
function EodBadgeChip({ badge, testId }: { badge: EodBadge | undefined; testId?: string }) {
  if (!badge) return null;
  return (
    <span className={cn("tabular rounded-full px-2 py-px text-[11px] font-semibold leading-4", badge === "5:30" ? "bg-status-soon-bg text-status-soon" : badge === "Sent" ? "bg-status-met-bg text-status-met" : "bg-status-neutral-bg text-status-neutral")} data-testid={testId} data-badge={badge}>
      {badge}
    </span>
  );
}

/** The badge a Work tab shows: listings to screen (gray) or people due today or overdue (amber, on People). */
function tabBadge(href: string, toScreen: number | null | undefined, outreachDue: number | null | undefined, where: "subnav" | "tab") {
  if (href === "/work/listings") return <CountBadge n={toScreen} testId={`${where}-to-screen`} />;
  if (href === "/work/people") return <CountBadge n={outreachDue} tone="amber" testId={`${where}-outreach-due`} />;
  return null;
}

/**
 * The main menu: Work, Accountability, More. Under Work (while it is open), its eight screens with the count of
 * listings to screen and the count of people due on Outreach (`toScreen`, `outreachDue`, read by the app layout).
 */
export function SidebarLinks({ toScreen, outreachDue, eodBadge }: { toScreen?: number | null; outreachDue?: number | null; eodBadge?: EodBadge }) {
  const path = usePathname();
  const active = mainFor(path).key;
  const tab = workTabFor(path);
  const accTab = ACCOUNTABILITY_TABS.find((t) => path === t.href || path.startsWith(`${t.href}/`)) ?? null;
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main menu">
      {MAIN_NAV.map((m) => {
        return (
          <div key={m.key}>
            <Link
              href={m.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                active === m.key && "bg-primary-soft text-primary-strong hover:bg-primary-soft",
              )}
            >
              <ModuleIcon module={m.key} />
              {m.label}
            </Link>
            {m.key === "work" && active === "work" ? (
              <div className="mt-0.5 mb-1.5 ml-3.5 flex flex-col border-l-2 border-rule pl-1.5" data-testid="work-subnav">
                {WORK_TABS.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={cn("flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100", tab?.href === t.href && "font-semibold text-primary-strong")}
                  >
                    {t.label}
                    {tabBadge(t.href, toScreen, outreachDue, "subnav")}
                  </Link>
                ))}
              </div>
            ) : null}
            {m.key === "accountability" && active === "accountability" ? (
              <div className="mt-0.5 mb-1.5 ml-3.5 flex flex-col border-l-2 border-rule pl-1.5" data-testid="accountability-subnav">
                {ACCOUNTABILITY_TABS.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={cn("flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100", accTab?.href === t.href && "font-semibold text-primary-strong")}
                  >
                    {t.label}
                    {t.href === "/work/end-of-day" ? <EodBadgeChip badge={eodBadge} testId="subnav-eod-badge" /> : null}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The top menu row (2026-11-04): shown only under 1024px, where the left menu is hidden; from 1024px the left menu
 * lists the same pages with the same badges, so the row is left out.
 */
const TOP_ROW = "no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:hidden";

/** The Accountability tabs (batch C): Targets, End of day with its badge, Reports, in the Work tab style (under 1024px). */
export function AccountabilityTabs({ eodBadge, tight = false }: { eodBadge?: EodBadge; tight?: boolean }) {
  const path = usePathname();
  const active = ACCOUNTABILITY_TABS.find((t) => path === t.href || path.startsWith(`${t.href}/`)) ?? null;
  return (
    <div className={cn(TOP_ROW, tight ? "mb-0" : "mb-6 border-b border-border")} data-testid="top-menu-row">
      <nav className="flex min-w-max gap-1" aria-label="Accountability sections">
        {ACCOUNTABILITY_TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              active?.href === t.href ? "border-primary text-primary-strong" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
            data-testid={`acc-tab-${t.href.replace(/\//g, "-").replace(/^-/, "")}`}
          >
            {t.label}
            {t.href === "/work/end-of-day" ? <EodBadgeChip badge={eodBadge} testId="tab-eod-badge" /> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The Work tabs (Home, Screen listings with the count, Deals, Contacts with the due count, Rosara, Job search, Consulting, To-dos), in the module tab style (under 1024px). */
export function WorkTabs({ toScreen, outreachDue, tight = false, className }: { toScreen?: number | null; outreachDue?: number | null; /** No space or line under the tabs (a pinned block with no filter row draws the hairline itself). */ tight?: boolean; className?: string }) {
  const path = usePathname();
  const tab = workTabFor(path);
  return (
    <div className={cn(TOP_ROW, tight ? "mb-0" : "mb-6 border-b border-border", className)} data-testid="top-menu-row">
      <nav className="flex min-w-max gap-1" aria-label="Work sections">
        {WORK_TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              tab?.href === t.href ? "border-primary text-primary-strong" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
            data-testid={`work-tab-${t.href.replace(/\//g, "-").replace(/^-/, "")}`}
          >
            {t.label}
            {tabBadge(t.href, toScreen, outreachDue, "tab")}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function MobileModuleBar() {
  const path = usePathname();
  const active = mainFor(path).key;
  return (
    <nav className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden" aria-label="Main menu">
      {MAIN_NAV.map((m) => (
        <Link
          key={m.key}
          href={m.href}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
            active === m.key ? "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover" : "border-border bg-white text-slate-700",
          )}
        >
          {m.label}
        </Link>
      ))}
    </nav>
  );
}

/** Sub-tabs of the current module. Extra tabs (example: one per pipeline) can be passed in. */
export function ModuleTabs({ extra = [] }: { extra?: { href: string; label: string }[] }) {
  const path = usePathname();
  const mod = moduleFor(path);
  const tabs = [...mod.tabs, ...extra];
  if (!tabs.length) return null;
  const activeHref = tabs
    .filter((t) => path === t.href || path.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <div className="no-print -mx-4 mb-6 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1" aria-label={`${mod.label} sections`}>
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              activeHref === t.href ? "border-primary text-primary-strong" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

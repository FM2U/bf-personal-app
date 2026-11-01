"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV, mainFor, moduleFor, WORK_TABS, workTabFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { ModuleIcon } from "@/components/app/module-icon";

/** A small count next to a menu or tab label (listings to screen; amber for people due on Outreach). */
export function CountBadge({ n, className, testId, tone = "gray" }: { n: number | null | undefined; className?: string; testId?: string; tone?: "gray" | "amber" }) {
  if (!n) return null;
  return (
    <span className={cn("tabular rounded-full px-2 py-px text-[11px] font-semibold leading-4", tone === "amber" ? "bg-status-soon-bg text-status-soon" : "bg-status-neutral-bg text-status-neutral", className)} data-testid={testId}>
      {n}
    </span>
  );
}

/** The badge a Work tab shows: listings to screen (gray) or people due today or overdue on Outreach (amber). */
function tabBadge(href: string, toScreen: number | null | undefined, outreachDue: number | null | undefined, where: "subnav" | "tab") {
  if (href === "/work/listings") return <CountBadge n={toScreen} testId={`${where}-to-screen`} />;
  if (href === "/work/outreach") return <CountBadge n={outreachDue} tone="amber" testId={`${where}-outreach-due`} />;
  return null;
}

/**
 * The main menu: Work, Accountability, More. Under Work (while it is open), its eight screens with the count of
 * listings to screen and the count of people due on Outreach (`toScreen`, `outreachDue`, read by the app layout).
 */
export function SidebarLinks({ toScreen, outreachDue }: { toScreen?: number | null; outreachDue?: number | null }) {
  const path = usePathname();
  const active = mainFor(path).key;
  const tab = workTabFor(path);
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
          </div>
        );
      })}
    </nav>
  );
}

/** The Work tabs (Home, Screen listings with the count, Deals, Outreach with the due count, Rosara, Job search, Consulting, To-dos), in the module tab style. */
export function WorkTabs({ toScreen, outreachDue, tight = false }: { toScreen?: number | null; outreachDue?: number | null; /** No space or line under the tabs (a pinned block with no filter row draws the hairline itself). */ tight?: boolean }) {
  const path = usePathname();
  const tab = workTabFor(path);
  return (
    <div className={cn("no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", tight ? "mb-0" : "mb-6 border-b border-border")}>
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

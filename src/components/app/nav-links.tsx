"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV, mainFor, moduleFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { ModuleIcon } from "@/components/app/module-icon";

/** The main menu: Today, Pipelines, Commitments, Reports, More. */
export function SidebarLinks() {
  const path = usePathname();
  const active = mainFor(path).key;
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main menu">
      {MAIN_NAV.map((m) => {
        return (
          <Link
            key={m.key}
            href={m.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              active === m.key && "bg-primary-soft text-primary-strong hover:bg-primary-soft",
            )}
          >
            <ModuleIcon module={m.key} />
            {m.label}
          </Link>
        );
      })}
    </nav>
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
            active === m.key ? "border-primary bg-primary text-white" : "border-border bg-white text-slate-700",
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

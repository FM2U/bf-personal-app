import Link from "next/link";
import { cn } from "@/lib/utils";
import { STATUS_TEXT, toneStatus } from "@/lib/status";
import { METRIC_LABEL } from "@/components/app/page-header";
import { ModuleTitle, type ModuleKey } from "@/components/app/module-icon";

export type Kpi = { label: string; value: React.ReactNode; hint?: string; href: string; tone?: "good" | "bad" | "warn" };

/**
 * A labeled group of compact number tiles. Each tile opens its module.
 * Labels and hints are held to 2 lines each (space reserved), so values and hints line up across the row.
 */
export function KpiGroup({ title, module, tiles, className, cols }: { title: string; module?: ModuleKey; tiles: Kpi[]; className?: string; cols: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white p-3", className)} aria-label={title}>
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{module ? <ModuleTitle module={module}>{title}</ModuleTitle> : title}</h2>
      <div className={cn("grid gap-2", cols)}>
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="group flex min-w-0 flex-col rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 transition-colors hover:border-primary-border hover:bg-primary-soft/50 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className={cn(METRIC_LABEL, "group-hover:text-slate-900")}>{t.label}</span>
            <span
              className={cn(
                "tabular clamp-1 mt-1 text-lg font-semibold leading-tight text-slate-900 sm:text-xl",
                t.tone && STATUS_TEXT[toneStatus(t.tone)],
              )}
            >
              {t.value}
            </span>
            <span className="clamp-2 mt-0.5 min-h-8 text-[11px] leading-4 text-muted-foreground">{t.hint ?? ""}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

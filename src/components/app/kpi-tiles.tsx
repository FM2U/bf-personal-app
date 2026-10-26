import Link from "next/link";
import { cn } from "@/lib/utils";

export type Kpi = { label: string; value: React.ReactNode; hint?: string; href: string; tone?: "good" | "bad" | "warn" };

/**
 * A labeled group of compact number tiles. Each tile opens its module.
 * Labels are held to 2 lines and hints to 1 line, so values line up across the row.
 */
export function KpiGroup({ title, tiles, className, cols }: { title: string; tiles: Kpi[]; className?: string; cols: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white p-3", className)} aria-label={title}>
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className={cn("grid gap-2", cols)}>
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="group flex min-w-0 flex-col rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 transition-colors hover:border-teal-200 hover:bg-teal-50/50 focus-visible:outline-2 focus-visible:outline-teal-700"
          >
            <span className="clamp-2 min-h-8 text-xs leading-4 text-muted-foreground group-hover:text-slate-700">{t.label}</span>
            <span
              className={cn(
                "tabular clamp-1 mt-1 text-lg font-semibold leading-tight text-slate-900 sm:text-xl",
                t.tone === "good" && "text-emerald-700",
                t.tone === "bad" && "text-red-700",
                t.tone === "warn" && "text-amber-700",
              )}
            >
              {t.value}
            </span>
            <span className="clamp-1 mt-0.5 min-h-4 text-[11px] leading-4 text-muted-foreground">{t.hint ?? ""}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

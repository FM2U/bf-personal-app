import { StatusDot } from "@/components/ui/badge";
import { combinedOverall, reportSections, type ReportInput, type TileStatus } from "@/lib/calc/partner-report";
import { STATUS_BOX, STATUS_DOT, STATUS_TEXT } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * The report's tiles for one or two templates, in the app's own style (the public partner page and the report page):
 * the period and overall result, one tile per measure (label, number, small bar, note), and the short list of misses.
 * The email shows the same content in email-safe HTML (src/lib/calc/partner-report.ts).
 */
export function ReportTiles({ input, className }: { input: ReportInput; className?: string }) {
  const sections = reportSections(input);
  const overall = combinedOverall(sections);
  const misses = [...new Set(sections.flatMap((s) => s.misses))];
  return (
    <section className={cn("rounded-xl border border-border bg-white", className)} data-testid="report-tiles">
      <div className="mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-gold-rule pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Accountability report</p>
          <h2 className="text-lg font-semibold text-slate-900">{sections[0]?.period}</h2>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold", STATUS_BOX[overall.status], STATUS_TEXT[overall.status])} data-testid="report-overall">
          <StatusDot status={overall.status} />
          {overall.text}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {sections.map((s) => (
          <div key={s.template.id} className="flex flex-col gap-2" data-testid="report-tiles-section">
            <h3 className="text-sm font-semibold text-slate-900">
              {s.template.name} <span className="font-normal text-muted-foreground">{s.period}</span>
            </h3>
            {s.template.note ? <p className="max-w-[75ch] text-sm text-slate-700">{s.template.note}</p> : null}
            {s.tiles.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {s.tiles.map((t) => (
                  <div key={t.key} className="flex min-w-0 flex-col rounded-lg border border-border px-3 py-2" data-testid="report-tile" data-status={t.status}>
                    <span className="clamp-1 text-xs text-slate-600">{t.label}</span>
                    <span className={cn("tabular text-xl font-semibold leading-7", t.status === "met" || t.status === "neutral" ? "text-slate-900" : STATUS_TEXT[t.status as TileStatus])}>{t.value}</span>
                    <span className="my-1 block h-1 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden>
                      <span className={cn("block h-full rounded-full", STATUS_DOT[t.status])} style={{ width: `${t.pct ?? 0}%` }} />
                    </span>
                    <span className="clamp-1 text-[11px] text-muted-foreground">{t.note}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No numbers were saved for these measures.</p>
            )}
            {!s.exact ? <p className="text-xs text-muted-foreground">Some measures were not saved in this report (it was made before report templates).</p> : null}
          </div>
        ))}
        {misses.length ? (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Misses</h3>
            <ul className="flex flex-col gap-1 text-sm" data-testid="report-misses">
              {misses.map((m) => (
                <li key={m} className="flex items-baseline gap-2">
                  <StatusDot status="missed" className="translate-y-[-1px]" />
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

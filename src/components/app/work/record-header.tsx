import type { HeaderFigure } from "@/lib/work/record-page";
import { Figure, Figures, WorkHeader } from "@/components/app/work/ui";

/**
 * The record page header (the record-page rule, batch B): the breadcrumb, the title with the page buttons at the
 * right (Email, Log a call, Advance, Pass, Ask AI), then one white strip with the type pill and the status line at
 * the left and the labeled figures at the right (next action due or next follow-up, open tasks, last contact or
 * waiting), 28px apart with the label under each figure. Every record page uses it; only the names change.
 * 2026-11-04: the header shrinks while scrolling: it scrolls away with the page, and once it is gone the slim pinned
 * bar slides in at the top (at every width) with the small title and these page buttons (icons only when too wide).
 */
export function RecordHeader({ crumb, title, under, actions, status, figures, testId, before }: { crumb: React.ReactNode; title: React.ReactNode; under?: React.ReactNode; actions?: React.ReactNode; /** The type pill and the status line. */ status: React.ReactNode; figures: HeaderFigure[]; testId?: string; /** A figure before the three (the consulting FEE). */ before?: React.ReactNode }) {
  return (
    <div className="mb-4 border-b border-border pb-3" data-testid="record-pinned" data-header-end>
      <WorkHeader title={title} under={under} crumb={crumb} right={actions} slim="always" />
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-border bg-white px-[22px] py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId ?? "record-status"}>
        <div className="flex min-w-0 flex-1 basis-[280px] flex-wrap items-center gap-2.5 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate" data-testid="record-status-line">
          {status}
        </div>
        <Figures className="max-w-full min-w-0 sm:shrink-0" testId="record-figures">
          {before}
          {figures.map((f) => (
            <Figure key={f.key} value={f.value} label={f.label} tone={f.tone} testId={`figure-${f.key}`} />
          ))}
        </Figures>
      </div>
    </div>
  );
}

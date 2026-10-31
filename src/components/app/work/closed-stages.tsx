"use client";

import { useState } from "react";
import type { DealRow } from "@/lib/work/data";
import { DealListRow } from "@/components/app/work/deal-list-row";
import { Rows, StageHeading } from "@/components/app/work/ui";

/**
 * Passed, Lost, and Closed under the Deals columns: one slim white bar with the counts, Show, and the hint on the
 * right; open, each as its own group inside the same bar.
 */
export function ClosedStages({ passed, lost, closed, today, hint }: { passed: DealRow[]; lost: DealRow[]; closed: DealRow[]; today: string; hint?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const label = [`Passed ${passed.length}`, `Lost ${lost.length}`, closed.length ? `Closed ${closed.length}` : null].filter(Boolean).join(" · ");
  return (
    <div className="mt-3.5 rounded-[10px] border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="closed-stages">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2.5 text-[13px] text-muted-foreground">
        <span className="tabular" data-testid="closed-label">
          {label}
        </span>
        {passed.length + lost.length + closed.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-primary-strong hover:underline" aria-expanded={open} data-testid="closed-toggle">
            {open ? "Hide" : "Show"}
          </button>
        ) : null}
        {hint ? <span className="min-w-0 text-xs text-slate-400 sm:ml-auto sm:text-right">{hint}</span> : null}
      </div>
      {open
        ? [
            ["Passed", passed],
            ["Lost", lost],
            ["Closed", closed],
          ]
            .filter(([, list]) => (list as DealRow[]).length)
            .map(([name, list]) => (
              <div key={String(name)} className="border-t border-slate-100" data-testid="stage-group" data-stage={String(name)}>
                <StageHeading name={String(name)} count={(list as DealRow[]).length} />
                <Rows>
                  {(list as DealRow[]).map((deal) => (
                    <DealListRow key={deal.id} deal={deal} today={today} />
                  ))}
                </Rows>
              </div>
            ))
        : null}
    </div>
  );
}

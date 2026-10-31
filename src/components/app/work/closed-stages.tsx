"use client";

import { useState } from "react";
import type { DealRow } from "@/lib/work/data";
import { DealListRow } from "@/components/app/work/deal-list-row";
import { Rows, StageHeading } from "@/components/app/work/ui";

/** Passed, Lost, and Closed at the bottom of Deals: one quiet line with the counts and Show; open, each as its own group. */
export function ClosedStages({ passed, lost, closed, today }: { passed: DealRow[]; lost: DealRow[]; closed: DealRow[]; today: string }) {
  const [open, setOpen] = useState(false);
  const label = [`Passed ${passed.length}`, `Lost ${lost.length}`, closed.length ? `Closed ${closed.length}` : null].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-slate-100" data-testid="closed-stages">
      <div className="flex items-center gap-2.5 px-[22px] py-[11px] text-[13px] font-medium text-slate-400">
        <span className="h-3.5 w-[3px] shrink-0 rounded-[2px] bg-border" aria-hidden />
        <span data-testid="closed-label">{label}</span>
        {passed.length + lost.length + closed.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-2 font-medium text-primary-strong hover:underline" aria-expanded={open} data-testid="closed-toggle">
            {open ? "Hide" : "Show"}
          </button>
        ) : null}
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

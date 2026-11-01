"use client";

import { useState } from "react";
import { Rows, StageHeading } from "@/components/app/work/ui";

/**
 * The slim bar under the Job search and Consulting columns (batch B2): "Declined 3 · Not chosen 2 · Show" or
 * "Lost 1 · Done 4 · Show" with a hint at the right; open, each closed stage as its own group inside the bar.
 */
export function ClosedBar<T extends { id: string }>({ label, groups, row, hint, testId = "closed-bar" }: { label: string; groups: { name: string; items: T[] }[]; row: (item: T) => React.ReactNode; hint?: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  return (
    <div className="mt-3.5 rounded-[10px] border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2.5 text-[13px] text-muted-foreground">
        <span className="tabular" data-testid="closed-label">
          {label}
        </span>
        {total ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-primary-strong hover:underline" aria-expanded={open} data-testid="closed-toggle">
            {open ? "Hide" : "Show"}
          </button>
        ) : null}
        {hint ? <span className="min-w-0 text-xs text-slate-400 sm:ml-auto sm:text-right">{hint}</span> : null}
      </div>
      {open
        ? groups
            .filter((g) => g.items.length)
            .map((g) => (
              <div key={g.name} className="border-t border-slate-100" data-testid="stage-group" data-stage={g.name}>
                <StageHeading name={g.name} count={g.items.length} />
                <Rows>{g.items.map((item) => <span key={item.id} className="contents">{row(item)}</span>)}</Rows>
              </div>
            ))
        : null}
    </div>
  );
}

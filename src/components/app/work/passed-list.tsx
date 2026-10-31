"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { moneyShort } from "@/lib/work/buy-box";
import type { PassedRow } from "@/lib/work/data";
import { Line1, Line3, Name, Pill, Quiet, Rows, RowShell, WorkCard } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * The Passed list under Screen listings: collapsed by default with the count, searchable by name once open.
 * Rows: name, reason pill, date, EBITDA or SDE, location. A row opens the deal page.
 */
export function PassedList({ rows }: { rows: PassedRow[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  return (
    <WorkCard
      title={
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 hover:text-primary-strong" aria-expanded={open} data-testid="passed-toggle">
          <ChevronRight className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-90")} aria-hidden />
          Passed
        </button>
      }
      count={rows.length}
      hint={open ? "Kept so you never re-screen the same business" : `${rows.length ? "Open to search by name" : "Nothing passed yet"}`}
      actions={
        open ? (
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search passed listings by name" className="h-8 w-44 rounded-[7px] border border-input bg-white px-2.5 text-[13px] placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" data-testid="passed-search" />
        ) : null
      }
      testId="passed-card"
      rule={open}
    >
      {open ? (
        shown.length ? (
          <Rows testId="passed-rows">
            {shown.slice(0, 200).map((r) => (
              <RowShell key={r.id} href={`/work/deals/${r.id}`} testId="passed-row">
                <Line1>
                  <Name>{r.name}</Name>
                  <Pill testId="passed-reason">{r.reasonLabel}</Pill>
                </Line1>
                <Line3>{[r.date, r.earnings !== null ? `${moneyShort(r.earnings)} ${r.earningsLabel ?? ""}`.trim() : null, r.location].filter(Boolean).join(" · ")}</Line3>
              </RowShell>
            ))}
            {shown.length > 200 ? (
              <Quiet>
                {shown.length - 200} more. Narrow the search, or see <Link href="/work/deals" className="text-primary-strong hover:underline">Deals</Link>.
              </Quiet>
            ) : null}
          </Rows>
        ) : (
          <Quiet testId="passed-empty">{needle ? `Nothing passed matches "${q.trim()}".` : "Nothing passed yet."}</Quiet>
        )
      ) : null}
    </WorkCard>
  );
}

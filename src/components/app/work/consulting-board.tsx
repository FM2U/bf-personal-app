"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDaysISO } from "@/lib/calc/dates";
import { CONSULTING_COLUMNS, CONSULTING_FILTERS, closedBarLabel, matchesConsultingFilter, type ConsultingFilter } from "@/lib/work/pipelines";
import { matchesSearch } from "@/lib/work/phases";
import type { ItemRow, PipelineBoardData } from "@/lib/work/pipelines-data";
import { AddLeadCard } from "@/components/app/work/add-item";
import { ClosedBar } from "@/components/app/work/closed-bar";
import { ConsultingCard, ItemListRow } from "@/components/app/work/item-row";
import { FilterRow, PINNED_CARD_HEADER, PinnedBlock } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

/**
 * Consulting (batch B2, approved 2026-10-31): the four open stages Lead, Proposal, Engagement, Paid as columns sized
 * to content (one row each on desktop, stacked on the phone), each with its line ("Someone asked") and count; rows:
 * client and project, the fee figure at the right, the next action with its due, the note. The pinned title with
 * Add a lead and Ask AI, the tabs, the pills All, Due today, Due next 7 days, Find a client. The closed bar: "Lost N
 * · Done N · Show".
 */
export function ConsultingBoard({ header, data, adding }: { header: React.ReactNode; data: PipelineBoardData; adding: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<ConsultingFilter>("all");
  const [query, setQuery] = useState("");
  const { today } = data;
  const weekEnd = addDaysISO(today, 7);
  const all = useMemo(() => data.groups.flatMap((g) => g.deals), [data.groups]);
  const counts = useMemo(() => Object.fromEntries(CONSULTING_FILTERS.map((f) => [f.key, all.filter((i) => matchesConsultingFilter(i, f.key, today, weekEnd)).length])) as Record<ConsultingFilter, number>, [all, today, weekEnd]);
  const shown = (i: ItemRow) => matchesConsultingFilter(i, filter, today, weekEnd) && matchesSearch(i, query);
  const closedCounts = Object.fromEntries(data.closed.map((c) => [c.name, c.items.length]));
  return (
    <>
      <PinnedBlock testId="consulting-sticky">
        {header}
        <FilterRow prefix="consulting" filters={CONSULTING_FILTERS} active={filter} counts={counts} onPick={setFilter} query={query} onQuery={setQuery} placeholder="Find a client" className="-mt-2 lg:mt-2.5" />
      </PinnedBlock>
      {adding ? (
        <div className="mb-[18px]">
          <AddLeadCard today={today} onClose={() => router.push("/work/consulting")} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-[18px] sm:grid-cols-2 lg:grid-cols-4" data-testid="consulting-columns">
        {CONSULTING_COLUMNS.map((col) => {
          const group = data.groups.find((g) => g.stage.name === col.name);
          const items = group?.deals ?? [];
          const visible = items.filter(shown);
          return (
            <section key={col.name} className="flex min-w-0 flex-col rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid="consulting-stage" data-stage={col.name} data-count={items.length}>
              <div className={cn("flex items-end justify-between gap-2.5 px-[18px] pt-4 pb-3.5", PINNED_CARD_HEADER, "border-b-2 lg:static")}>
                <div className="min-w-0">
                  <h2 className="text-[17px] leading-[1.2] font-bold tracking-[0.02em] text-slate-900">{col.name}</h2>
                  <p className="mt-[5px] text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-muted-foreground">{col.tagline}</p>
                </div>
                <span className="tabular shrink-0 pb-0.5 text-[12.5px] text-muted-foreground" data-testid="stage-count">
                  {items.length}
                </span>
              </div>
              <div className="px-[18px] pt-1.5 pb-2" data-testid="stage-body">
                {items.map((item) => (
                  <ConsultingCard key={item.id} item={item} today={today} hidden={!shown(item)} />
                ))}
                {!items.length ? <p className="py-2.5 text-[13px] text-slate-400">None</p> : items.length && !visible.length ? <p className="py-2.5 text-[13px] text-slate-400">None match</p> : null}
              </div>
            </section>
          );
        })}
      </div>
      <ClosedBar label={closedBarLabel("consulting", closedCounts)} groups={data.closed.map((c) => ({ name: c.name, items: c.items }))} row={(item) => <ItemListRow item={item} />} hint="Done means paid and wrapped up; Lost means the client chose someone else or dropped it" testId="consulting-closed" />
    </>
  );
}

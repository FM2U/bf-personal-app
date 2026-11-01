"use client";

import { useRouter } from "next/navigation";
import type { ItemRow, PipelineBoardData } from "@/lib/work/pipelines-data";
import type { DealFilter } from "@/lib/work/phases";
import { closedBarLabel, JOB_PHASES } from "@/lib/work/pipelines";
import { AddOpportunityCard } from "@/components/app/work/add-item";
import { ClosedBar } from "@/components/app/work/closed-bar";
import { PhaseColumns } from "@/components/app/work/deal-columns";
import { ItemListRow, OpportunityCard } from "@/components/app/work/item-row";

/**
 * Job search (batch B2, approved 2026-10-31): the Deals layout with two phases, Early (Contact, Conversation) and
 * Decide (Interview, Offer); the pinned title with Add an opportunity and Ask AI, the tabs, and the filter row (All,
 * Due today, Waiting on someone, Needs a next action, Find an opportunity, Collapse all). Rows: company and role,
 * contact and location, the next action with its due, the waiting pill, the note. The closed bar: "Declined N · Not
 * chosen N · Show" (Accepted joins when any).
 */
export function JobsBoard({ header, data, adding, initialFilter = "all" }: { header: React.ReactNode; data: PipelineBoardData; adding: boolean; /** The filter named in the address (from the Home tile). */ initialFilter?: DealFilter }) {
  const router = useRouter();
  const counts = Object.fromEntries(data.closed.map((c) => [c.name, c.items.length]));
  return (
    <>
      <PhaseColumns<ItemRow>
        header={header}
        before={adding ? <AddOpportunityCard today={data.today} onClose={() => router.push("/work/jobs")} /> : null}
        groups={data.groups}
        today={data.today}
        initialFilter={initialFilter}
        phases={JOB_PHASES}
        storageKey="work-jobs-stages"
        prefix="jobs"
        placeholder="Find an opportunity"
        noun="open"
        gridClassName="lg:grid-cols-2"
        testId="jobs-columns"
        card={(item, hidden) => <OpportunityCard item={item} today={data.today} hidden={hidden} />}
      />
      <ClosedBar label={closedBarLabel("job", counts)} groups={data.closed.map((c) => ({ name: c.name, items: c.items }))} row={(item) => <ItemListRow item={item} />} hint="Declined is your decision; Not chosen is theirs" testId="jobs-closed" />
    </>
  );
}

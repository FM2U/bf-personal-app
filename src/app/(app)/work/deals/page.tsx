import { requireOwner } from "@/lib/auth";
import { loadDeals, loadTabCounts } from "@/lib/work/data";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { parseDealFilter } from "@/lib/work/phases";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { ClosedStages } from "@/components/app/work/closed-stages";
import { DealColumns } from "@/components/app/work/deal-columns";

export const metadata = { title: "Deals" };

/**
 * Deals (approved 2026-10-30, edits 2026-10-31): three phase columns, Early, Evaluate, Decide, each with its three
 * stages and the deals in them; the title, the Work tabs, and the filter row (All, Due today, Waiting on someone,
 * Needs a next action, Find a deal, Collapse all) stay at the top while the columns scroll. Passed, Lost (and
 * Closed) are one slim bar under the columns. A deal card opens the deal page. "?filter=wait" (from Home's Deals at
 * a glance) opens the page with that filter on.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const d = await loadDeals(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, d.today);
  const summary = d.available ? [`Acquisition`, `${d.active} active`, d.waitingOver ? `${d.waitingOver} waiting over ${d.threshold} days` : null].filter(Boolean).join(" · ") : "";
  const header = (
    <>
      <WorkHeader
        title="Deals"
        right={
          <>
            <span data-testid="deals-summary">{summary}</span>
            <AskAiPill context={{ page: "deals", label: "Deals" }} />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} />
    </>
  );
  return (
    <WorkShell testId="work-deals">
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <>
          <DealColumns header={header} groups={d.groups} today={d.today} initialFilter={parseDealFilter(sp.filter)} />
          <ClosedStages passed={d.passed} lost={d.lost} closed={d.closed} today={d.today} hint="Sourcing and screening happen on Screen listings; these are deals you said Interested to" />
        </>
      )}
    </WorkShell>
  );
}

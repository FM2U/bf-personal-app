import { requireOwner } from "@/lib/auth";
import { countToScreen, loadDeals } from "@/lib/work/data";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { ClosedStages } from "@/components/app/work/closed-stages";
import { DealColumns } from "@/components/app/work/deal-columns";

export const metadata = { title: "Deals" };

/**
 * Deals (approved 2026-10-30): three phase columns, Early, Evaluate, Decide, each with its three stages and the
 * deals in them; the title, the Work tabs, and the filter row (All, Due today, Waiting on someone, Needs a next
 * action, Find a deal) stay at the top while the columns scroll. Passed, Lost (and Closed) are one slim bar under
 * the columns. A deal card opens the deal page.
 */
export default async function DealsPage() {
  const { supabase, ownerId } = await requireOwner();
  const [d, toScreen] = await Promise.all([loadDeals(supabase, ownerId), countToScreen(supabase, ownerId)]);
  const summary = d.available ? [`Acquisition`, `${d.active} active`, d.waitingOver ? `${d.waitingOver} waiting over ${d.threshold} days` : null].filter(Boolean).join(" · ") : "";
  const header = (
    <>
      <WorkHeader title="Deals" right={<span data-testid="deals-summary">{summary}</span>} />
      <WorkTabs toScreen={toScreen} />
    </>
  );
  return (
    <WorkShell testId="work-deals">
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice />
        </>
      ) : (
        <>
          <DealColumns header={header} groups={d.groups} today={d.today} />
          <ClosedStages passed={d.passed} lost={d.lost} closed={d.closed} today={d.today} hint="Sourcing and screening happen on Screen listings; these are deals you said Interested to" />
        </>
      )}
    </WorkShell>
  );
}

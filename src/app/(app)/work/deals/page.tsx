import { requireOwner } from "@/lib/auth";
import { countToScreen, loadDeals } from "@/lib/work/data";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Rows, StageHeading, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { ClosedStages } from "@/components/app/work/closed-stages";
import { DealListRow } from "@/components/app/work/deal-list-row";
import { cn } from "@/lib/utils";

export const metadata = { title: "Deals" };

/**
 * Deals: the acquisition deals grouped by stage (the nine stages in order, a gold bar on each heading with the
 * stage's default next action on the right), the stepper across the top with counts, and Passed, Lost (and Closed)
 * collapsed at the bottom. A row opens the deal page.
 */
export default async function DealsPage() {
  const { supabase, ownerId } = await requireOwner();
  const [d, toScreen] = await Promise.all([loadDeals(supabase, ownerId), countToScreen(supabase, ownerId)]);
  const summary = d.available ? [`Acquisition`, `${d.active} active`, d.waitingOver ? `${d.waitingOver} waiting over ${d.threshold} days` : null, d.needsAction ? `${d.needsAction} ${d.needsAction === 1 ? "needs" : "need"} a next action` : null].filter(Boolean).join(" · ") : "";
  return (
    <WorkShell testId="work-deals">
      <WorkHeader title="Deals" right={<span data-testid="deals-summary">{summary}</span>} />
      <WorkTabs toScreen={toScreen} />
      {!d.available ? (
        <WorkUpdateNotice />
      ) : (
        <WorkCard title="By stage" hint="Sourcing and screening happen on Screen listings; these are deals you said Interested to" testId="deals-by-stage">
          <div className="flex flex-wrap items-center gap-1.5 px-[22px] pt-2.5 pb-3.5" data-testid="deals-stepper">
            {d.groups.map((g) => (
              <a
                key={g.stage.name}
                href={`#stage-${g.stage.name.replace(/\s+/g, "-").toLowerCase()}`}
                className={cn("tabular rounded-full border px-[9px] py-[3px] text-xs", g.deals.length ? "border-primary-border bg-primary-soft text-primary-strong" : "border-border text-slate-400")}
                data-testid="stepper-stage"
                data-count={g.deals.length}
              >
                {g.stage.name}
                {g.deals.length ? <span className="ml-1 font-semibold">{g.deals.length}</span> : null}
              </a>
            ))}
          </div>
          {d.groups.map((g) => (
            <div key={g.stage.name} id={`stage-${g.stage.name.replace(/\s+/g, "-").toLowerCase()}`} className="border-t border-slate-100 first:border-t-0" data-testid="stage-group" data-stage={g.stage.name}>
              <StageHeading name={g.stage.name} count={g.deals.length} hint={g.hint ? g.hint.charAt(0).toLowerCase() + g.hint.slice(1) : null} empty={!g.deals.length} />
              {g.deals.length ? (
                <Rows>
                  {g.deals.map((deal) => (
                    <DealListRow key={deal.id} deal={deal} today={d.today} />
                  ))}
                </Rows>
              ) : null}
            </div>
          ))}
          <ClosedStages passed={d.passed} lost={d.lost} closed={d.closed} today={d.today} />
        </WorkCard>
      )}
    </WorkShell>
  );
}

import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadDealPage } from "@/lib/work/data";
import { listedAs } from "@/lib/work/names";
import { daysLabel } from "@/lib/work/stages";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Pill, ProgressMark, waitTone, What, WorkHeader } from "@/components/app/work/ui";
import { DealHeaderActions, DecisionCard, FactsCard, FindingsCard, NextActionCard, TimelineCard, TodosCard } from "@/components/app/work/deal/cards";
import { DocumentsCard } from "@/components/app/record-side-panels";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Deal" };

/**
 * The deal page (/work/deals/[id], approved mockup 2026-10-30, edits 2026-10-31): the name (the company name when
 * set, with "Listed as <listing name>" under it), breadcrumb, the progress mark, the stage pill with the day in stage
 * (charcoal for Passed and Lost), the wait pill, what it does and where; buttons Add a note, Email the broker,
 * Advance, Pass. Left: Next action, Findings (key finding, open questions), Also to do. Right: Facts, Timeline,
 * Documents, Decision. Every card saves on its own.
 */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const d = await loadDealPage(supabase, ownerId, id);
  if (!d.available) {
    return (
      <WorkShell testId="work-deal">
        <WorkHeader title="Deal" crumb={<Link href="/work/deals" className="hover:underline">Deals</Link>} />
        <WorkUpdateNotice notice={d.notice} />
      </WorkShell>
    );
  }
  const deal = d.deal;
  if (!deal) {
    return (
      <WorkShell testId="work-deal">
        <WorkHeader title="Deal" crumb={<Link href="/work/deals" className="hover:underline">Deals</Link>} />
        <EmptyState
          title="This deal was not found."
          body="It may have been deleted, or it belongs to another pipeline."
          action={
            <Button asChild size="sm">
              <Link href="/work/deals">Back to Deals</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const waiting = deal.status === "open" && deal.waitLevel !== "none";
  const listing = listedAs({ name: deal.listingName, companyName: deal.companyName });
  return (
    <WorkShell testId="work-deal">
      <WorkHeader
        title={deal.name}
        under={listing ? <span data-testid="deal-listed-as">Listed as {listing}</span> : null}
        crumb={
          <>
            <Link href="/work/deals" className="text-primary-strong hover:underline" data-testid="deal-crumb">
              Deals
            </Link>
            <span className="mx-1.5 text-slate-400">›</span>
            {deal.stageName ?? "No stage"}
          </>
        }
        right={<DealHeaderActions deal={deal} compose={d.compose} advanceTo={deal.status === "open" ? d.advanceTo : null} />}
      />
      <div className="mt-1.5 mb-5 flex flex-wrap items-center gap-2.5" data-testid="deal-status-line">
        <ProgressMark stage={deal.stageName} />
        <Pill tone={deal.status === "open" ? "gold" : deal.stageName === "Closed" ? "green" : "charcoal"} testId="deal-stage-pill">
          {deal.stageName ?? "No stage"}
          {deal.status === "open" ? ` · day ${deal.dayInStage}` : ""}
        </Pill>
        {waiting ? (
          <Pill tone={waitTone(deal.waitLevel)} className="tabular" testId="deal-wait-pill">
            Waiting on {deal.waitingOn} · {daysLabel(deal.waitDays)}
          </Pill>
        ) : (
          <Pill tone="quiet" testId="deal-wait-pill">
            Not waiting on anyone
          </Pill>
        )}
        {deal.whatItDoes || deal.location ? <What>{[deal.whatItDoes, deal.location].filter(Boolean).join(" · ")}</What> : null}
      </div>
      <div className="grid grid-cols-1 items-start gap-5 min-[1000px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <NextActionCard deal={deal} today={d.today} />
          <FindingsCard deal={deal} compose={d.questionsCompose} />
          <TodosCard deal={deal} todos={d.todos} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <FactsCard deal={deal} />
          <TimelineCard deal={deal} events={d.timeline} />
          <DocumentsCard table="pipeline_items" id={deal.id} docs={d.documents} storageKey="work:deal" defaultOpen />
          <DecisionCard deal={deal} advanceTo={deal.status === "open" ? d.advanceTo : null} />
        </div>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        The same deal in the older pipeline screens:{" "}
        <Link href={`/records/pipeline_items/${deal.id}`} className="text-primary-strong hover:underline" data-testid="deal-old-page">
          open the record page
        </Link>
        .
      </p>
    </WorkShell>
  );
}

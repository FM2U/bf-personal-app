import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { date as fmtDate } from "@/lib/format";
import { loadDealPage } from "@/lib/work/data";
import { displayName, listedAs } from "@/lib/work/names";
import { WorkTabOverride } from "@/components/app/work-tab-override";
import { buyBoxTone, checkBuyBox } from "@/lib/work/buy-box";
import { dealPageState, headerFigures } from "@/lib/work/record-page";
import { daysLabel } from "@/lib/work/stages";
import { openTodos } from "@/lib/work/todos";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { RecordHeader } from "@/components/app/work/record-header";
import { RecordColumns } from "@/components/app/work/record-columns";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Pill, ProgressMark, waitTone, What, WorkHeader } from "@/components/app/work/ui";
import { DealHeaderActions, DecisionCard, FactsCard, FindingsCard, ListingTextCard, NextActionCard, TimelineCard, TodosCard } from "@/components/app/work/deal/cards";
import { DB_UPDATE_NOTICE_0027 } from "@/lib/schema-guard";
import { DocumentsCard } from "@/components/app/work/documents-card";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

/** The browser tab (push D): "Listing: <name>" on a listing still to screen, "Deal" otherwise. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Deal" };
  const { supabase, ownerId } = await requireOwner();
  const { data } = await supabase.from("pipeline_items").select("name,company_name,screened,status").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  const r = data as { name?: string | null; company_name?: string | null; screened?: boolean | null; status?: string | null } | null;
  if (!r || r.screened !== false) return { title: "Deal" };
  return { title: `Listing: ${displayName({ name: String(r.name ?? ""), companyName: r.company_name ?? null })}` };
}

/**
 * The deal page (/work/deals/[id]) under the record-page rule (batch B, approved 2026-10-31): breadcrumb, the name
 * (the company name when set, "Listed as <listing name>" under it), buttons Add a note, Email the broker, Log a
 * call, Advance, Pass, Ask AI; the status strip with the progress mark, the stage pill with the day in stage
 * (charcoal for Passed and Lost), the wait pill, what it does and where, and at the right the figures NEXT ACTION,
 * OPEN TASKS, LAST CONTACT (or WAITING). Left: Findings (the type-specific card), Next action, Tasks (was Also to
 * do). Right: Facts, Timeline, Documents, Decision. Every card saves on its own.
 *
 * Edit batch C round 3: a listing (screened = false) opens this same page in the Listing state (one code path; the
 * states are in src/lib/work/record-page.ts, dealPageState): the breadcrumb "Screen listings › name", the "Listing"
 * type pill and the buy box pill in place of the stage mark and the stage pill, Interested in place of Advance, the
 * Next action optional, no Documents card, and the Decision card with Pass and Interested. After Interested the same
 * page, at the same address, shows the deal state; nothing is copied (notes, tasks, and facts are on the same row).
 *
 * AI instructions 2026-11-02: Findings shows Strengths and Risks under the Key finding (database update 0028).
 * Revision 1: Growth paths under them and Financing in Facts (database update 0029); the Findings fields save when
 * they lose focus; the listing's buy box pill reads the Buy box settings (Fits, Near fit, Outside).
 *
 * Fix 2026-11-02: the Original listing text card sits under Facts (collapsed, Show and Hide, Replace; the paste box
 * when none is saved). It is not part of the Timeline.
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
  // AI instructions (2026-11-02): Strengths and Risks need database update 0028 (the probe, and the columns on the row).
  const [has0028, has0029] = await Promise.all([true, true]);
  const listsReady = d.findingListsReady && has0028;
  // AI instructions revision 1: Growth paths and Financing need database update 0029.
  const growthReady = d.growthPathsReady && has0029;
  const state = dealPageState({ screened: deal.screened, status: deal.status, stageName: deal.stageName, name: deal.name });
  const isListing = state.kind === "listing";
  const buyBox = isListing ? checkBuyBox({ name: deal.listingName, whatItDoes: deal.whatItDoes, industry: deal.industry, location: deal.location, ebitda: deal.ebitda, sde: deal.sde }, d.buyBox) : null;
  const waiting = deal.status === "open" && deal.waitLevel !== "none";
  const listing = listedAs({ name: deal.listingName, companyName: deal.companyName });
  const figures = headerFigures(
    { nextDue: deal.nextActionDue, hasNext: !!deal.nextAction, nextLabel: "Next action", openTasks: openTodos(d.todos).length, lastContactAt: d.lastContact?.on ?? null, lastContactKind: d.lastContact?.kind ?? null, waitingOn: waiting ? deal.waitingOn : null, waitDays: deal.waitDays, waitTone: deal.waitLevel },
    d.today,
    (x) => fmtDate(x, "MMM d"),
  );
  return (
    <WorkShell testId="work-deal">
      <span hidden data-testid="deal-page-state" data-state={state.kind} />
      {/* A listing belongs to Screen listings in the menu (push D). */}
      {isListing ? <WorkTabOverride href="/work/listings" /> : null}
      <RecordHeader
        title={deal.name}
        under={listing ? <span data-testid="deal-listed-as">Listed as {listing}</span> : null}
        crumb={
          <>
            <Link href={state.crumb.href} className="text-primary-strong hover:underline" data-testid="deal-crumb">
              {state.crumb.label}
            </Link>
            <span className="mx-1.5 text-slate-400">›</span>
            <span data-testid="deal-crumb-tail">{state.crumb.tail}</span>
          </>
        }
        actions={
          <>
            <DealHeaderActions deal={deal} compose={d.compose} advanceTo={deal.status === "open" && !isListing ? d.advanceTo : null} today={d.today} tz={d.tz} listing={isListing} />
            <AskAiPill context={{ page: "deal", recordId: deal.id, label: deal.name }} compose={d.compose} />
          </>
        }
        testId="deal-status-line"
        status={
          isListing ? (
            <>
              <Pill tone="gray" testId="deal-type-pill">
                {state.typePill}
              </Pill>
              {buyBox ? (
                <Pill tone={buyBoxTone(buyBox.tier)} testId="deal-buy-box-pill">
                  {buyBox.label}
                </Pill>
              ) : null}
              {deal.whatItDoes || deal.location ? <What>{[deal.whatItDoes, deal.location].filter(Boolean).join(" · ")}</What> : null}
            </>
          ) : (
          <>
            <ProgressMark stage={deal.stageName} />
            <Pill tone={deal.status === "open" ? "stage" : deal.stageName === "Closed" ? "green" : "charcoal"} testId="deal-stage-pill">
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
          </>
          )
        }
        figures={figures}
      />
      <RecordColumns
        left={
          <>
          <FindingsCard deal={deal} compose={d.questionsCompose} aiTools={state.questionsTools} listsReady={listsReady} growthReady={growthReady} />
          <NextActionCard deal={deal} today={d.today} noActionHint={state.noActionHint} waitsReady={d.waitsReady} />
          <TodosCard deal={deal} todos={d.todos} today={d.today} />
          </>
        }
        right={
          <>
          <FactsCard deal={growthReady ? deal : { ...deal, financing: null }} />
          <ListingTextCard dealId={deal.id} text={d.listingText} ready={d.listingTextReady} notice={DB_UPDATE_NOTICE_0027} />
          <TimelineCard deal={deal} events={d.timeline} />
          {state.documents ? <DocumentsCard table="pipeline_items" id={deal.id} docs={d.documents} storageKey="work:deal" defaultOpen /> : null}
          <DecisionCard deal={deal} advanceTo={deal.status === "open" && !isListing ? d.advanceTo : null} listing={isListing} />
          </>
        }
      />
    </WorkShell>
  );
}

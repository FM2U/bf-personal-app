import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { loadWorkNow, type DealRow } from "@/lib/work/data";
import { WorkTabs } from "@/components/app/nav-links";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { CountChip, Quiet, Rows, WorkCard, WorkHeader } from "@/components/app/work/ui";
import { NextActionRow } from "@/components/app/work/next-action-row";
import { WaitingRow } from "@/components/app/work/waiting-row";

export const metadata = { title: "Work on now" };

/**
 * Work on now (the start screen of the Work module, approved 2026-10-30): the date, three count chips (listings to
 * screen, next actions due, waiting over the threshold), then two columns on desktop: Next actions (deals with a next
 * action due today or earlier, soonest first, Done and Later) and Waiting on someone (days since, Chase).
 */
export default async function WorkNowPage() {
  const { supabase, ownerId } = await requireOwner();
  const d = await loadWorkNow(supabase, ownerId);
  const gmail = d.available && d.waiting.length ? await loadGmailSetup(supabase, ownerId) : null;
  const composeFor = (deal: DealRow): ComposeSetup => ({
    ...(gmail ?? { permission: "not_connected", fromEmail: null, canGmail: false, signature: null }),
    title: `Chase: ${deal.name}`,
    recipients: deal.contactId && deal.contactEmail ? [{ contactId: deal.contactId, name: deal.contactName ?? "Main contact", email: deal.contactEmail, role: "Main contact" }] : [],
    defaultTo: deal.contactEmail ?? "",
    contactId: deal.contactId && deal.contactEmail ? deal.contactId : null,
    pipelineItemId: deal.id,
    organizationId: null,
    toNote: deal.contactEmail ? null : "This deal has no main contact with an email address. Type the address.",
  });
  return (
    <WorkShell testId="work-now">
      <WorkHeader title="Work on now" right={<span data-testid="work-date">{fmtDate(d.today, "EEEE, MMM d")}</span>} />
      <WorkTabs toScreen={d.available ? d.toScreen : null} />
      {!d.available ? (
        <WorkUpdateNotice />
      ) : (
        <>
          <div className="mb-[22px] flex flex-wrap gap-2.5" data-testid="work-chips">
            <CountChip href="/work/listings" n={d.toScreen} label={d.toScreen === 1 ? "listing to screen" : "listings to screen"} testId="chip-screen" />
            <CountChip href="#now-actions" n={d.nextActions.length + d.nextActionsMore} label={d.nextActions.length + d.nextActionsMore === 1 ? "next action due" : "next actions due"} testId="chip-actions" />
            {d.waitingOver > 0 ? <CountChip href="#now-wait" n={d.waitingOver} label={`waiting over ${d.threshold} days`} warn testId="chip-waiting" /> : null}
          </div>
          <div className="grid grid-cols-1 items-start gap-5 min-[1000px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <WorkCard id="now-actions" title="Next actions" hint="Due today or overdue, soonest first" testId="now-actions">
              {d.nextActions.length ? (
                <Rows>
                  {d.nextActions.map((deal) => (
                    <NextActionRow key={deal.id} deal={deal} today={d.today} />
                  ))}
                  {d.nextActionsMore ? (
                    <div className="px-[22px] pt-3 pb-1">
                      <Link href="/work/deals" className="text-xs font-medium text-primary-strong hover:underline" data-testid="next-actions-more">
                        {d.nextActionsMore} more on Deals
                      </Link>
                    </div>
                  ) : null}
                </Rows>
              ) : (
                <Quiet testId="now-actions-empty">Nothing is due today. Deals lists every next action.</Quiet>
              )}
            </WorkCard>
            <WorkCard id="now-wait" title="Waiting on someone" hint={`Amber at ${d.threshold}, red at ${d.threshold * 2} days`} testId="now-wait">
              {d.waiting.length ? (
                <Rows>
                  {d.waiting.map((deal) => (
                    <WaitingRow key={deal.id} deal={deal} compose={composeFor(deal)} />
                  ))}
                </Rows>
              ) : (
                <Quiet testId="now-wait-empty">Nobody is keeping you waiting.</Quiet>
              )}
            </WorkCard>
          </div>
        </>
      )}
    </WorkShell>
  );
}

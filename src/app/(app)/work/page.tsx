import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { loadTabCounts, loadWorkNow, type DealRow } from "@/lib/work/data";
import { composeForPerson } from "@/lib/work/outreach-data";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkTabs } from "@/components/app/nav-links";
import { HomeBoard } from "@/components/app/work/home-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Work on now" };

/**
 * Home, the start screen of the Work module (menu item "Home", heading "Work on now"; the bento of mockup v6,
 * approved 2026-10-31; the Outreach and Job search tiles added in batch B): the date, Ask AI, the Work tabs, the
 * filter row, then Next actions (two thirds) and, stacked on the right, Waiting on someone, Outreach, Job search, the
 * Screen listings tile, and Deals at a glance. The rows and tiles are in
 * src/components/app/work/home-board.tsx; the data comes from loadWorkNow.
 */
export default async function WorkNowPage() {
  const { supabase, ownerId } = await requireOwner();
  const d = await loadWorkNow(supabase, ownerId);
  const waiting = d.available ? d.deals.filter((x) => x.waitLevel !== "none") : [];
  const tilePeople = d.available ? d.outreach.dueToday : [];
  const gmail = waiting.length || tilePeople.length ? await loadGmailSetup(supabase, ownerId) : null;
  const tabs = await loadTabCounts(supabase, ownerId, d.today);
  const composeFor = (deal: DealRow): ComposeSetup => ({
    ...(gmail ?? { permission: "not_connected", fromEmail: null, canGmail: false, signature: null }),
    title: `Follow up: ${deal.name}`,
    recipients: deal.contactId && deal.contactEmail ? [{ contactId: deal.contactId, name: deal.contactName ?? "Main contact", email: deal.contactEmail, role: "Main contact" }] : [],
    defaultTo: deal.contactEmail ?? "",
    contactId: deal.contactId && deal.contactEmail ? deal.contactId : null,
    pipelineItemId: deal.id,
    organizationId: null,
    toNote: deal.contactEmail ? null : "This deal has no main contact with an email address. Type the address.",
  });
  const header = (
    <>
      <WorkHeader
        title="Work on now"
        right={
          <>
            <span data-testid="work-date">{fmtDate(d.today, "EEEE, MMM d")}</span>
            <AskAiPill context="Work on now" />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} />
    </>
  );
  return (
    <WorkShell testId="work-now">
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <HomeBoard header={header} data={d} composes={Object.fromEntries(waiting.map((deal) => [deal.id, composeFor(deal)]))} personComposes={Object.fromEntries(tilePeople.map((p) => [p.id, composeForPerson(gmail ?? { permission: "not_connected", fromEmail: null, canGmail: false, signature: null }, p)]))} />
      )}
    </WorkShell>
  );
}

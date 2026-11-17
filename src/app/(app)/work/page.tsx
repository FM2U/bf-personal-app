import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { loadTabCounts, loadWorkCtx } from "@/lib/work/data";
import { loadHome } from "@/lib/work/home-data";
import { ReplyCheck } from "@/components/app/reply-check";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkTabs } from "@/components/app/nav-links";
import { HomeBento } from "@/components/app/work/home-bento";
import { WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { loadPriorities } from "@/lib/work/priorities-data";

export const metadata = { title: "Work on now" };

/**
 * Home, the start screen of the Work module (menu item "Home", heading "Work on now"). Since release H1 of the Home
 * redesign (approved by Bram 2026-11-17): the bento of calm cards in src/components/app/work/home-bento.tsx (Next actions
 * and Today's calendar at the top, then the summary cards). The full list that was Home before is the Next actions page
 * (src/app/(app)/work/next-actions/page.tsx). The same reads as before, side by side in one trip: Home's data, the email
 * setup (Ask AI's "Open in email"), the tab counts, Top priorities; the calendar, Waiting and Targets arrive after.
 */
export default async function WorkNowPage() {
  const { supabase, ownerId } = await requireOwner();
  // Push B: opening Home looks for new replies to the reports and emails the app sent (ReplyCheck, after the page is on screen).
  const [d, gmail0, tabs0, prio] = await Promise.all([loadHome(supabase, ownerId), loadGmailSetup(supabase, ownerId), loadWorkCtx(supabase, ownerId).then((c) => loadTabCounts(supabase, ownerId, c.today)), loadPriorities(supabase, ownerId)]);
  const gmail: GmailSetup = d.available ? gmail0 : { permission: "not_connected", fromEmail: null, canGmail: false, signature: null };
  const askCompose: ComposeSetup = { ...gmail, title: "Email", recipients: [], defaultTo: "", contactId: null, pipelineItemId: null, organizationId: null, toNote: "Type the address." };
  const askAi = <AskAiPill context={{ page: "home", label: "Work on now" }} compose={askCompose} />;
  const tabs = <WorkTabs toScreen={tabs0.toScreen} outreachDue={tabs0.outreachDue} className="mt-3 mb-0 border-b border-border" />;
  const dateLabel = { long: fmtDate(d.today, "EEEE, MMM d"), short: fmtDate(d.today, "EEE, MMM d") };
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col" data-testid="work-now">
      <ReplyCheck />
      {!d.available ? (
        <>
          <WorkHeader
            title="Work on now"
            right={
              <>
                <span data-testid="work-date">{dateLabel.long}</span>
                {askAi}
              </>
            }
          />
          {tabs}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <HomeBento data={d} priorities={prio} waiting={d.waiting} dateLabel={dateLabel} askAi={askAi} tabs={tabs} />
      )}
    </div>
  );
}

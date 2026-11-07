import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { isValidEmail } from "@/lib/email-address";
import { loadTabCounts, loadWorkCtx } from "@/lib/work/data";
import type { WaitItem, WaitItemLine } from "@/lib/work/waiting";
import { loadHome } from "@/lib/work/home-data";
import { composeForPerson } from "@/lib/work/outreach-data";
import { ReplyCheck } from "@/components/app/reply-check";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkTabs } from "@/components/app/nav-links";
import { HomeBoard } from "@/components/app/work/home-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Work on now" };

/**
 * Home, the start screen of the Work module (menu item "Home", heading "Work on now"; the bento of mockup v6,
 * approved 2026-10-31, with the header of 2026-11-04): the title row (the date, Find, Filter, Ask AI), the top menu
 * row under 1024px, the three tiles over Next actions (two thirds) and, stacked on the right, Waiting on someone,
 * Today's calendar, Targets today, Contacts, Rosara, Job search, Screen listings, and Deals at a glance. The title
 * row, the tiles and the cards are in src/components/app/work/home-board.tsx; the data comes from loadHome.
 */
export default async function WorkNowPage() {
  const { supabase, ownerId } = await requireOwner();
  // Push B: opening Home looks for new replies to the reports and emails the app sent (at most once every few minutes).
  // Page speed (2026-11-06): after the page is on screen (ReplyCheck below), no longer before it.
  // Page speed (2026-11-06): Home's data, the email setup and the tab counts load side by side.
  const [d, gmail0, tabs0] = await Promise.all([loadHome(supabase, ownerId), loadGmailSetup(supabase, ownerId), loadWorkCtx(supabase, ownerId).then((c) => loadTabCounts(supabase, ownerId, c.today))]);
  const waiting = d.available ? d.waiting.items : [];
  const tilePeople = d.available ? d.outreach.dueToday : [];
  const gmail: GmailSetup = d.available ? gmail0 : { permission: "not_connected", fromEmail: null, canGmail: false, signature: null };
  /**
   * Follow up on a line of a waiting row (push E2: each wait has its own Follow up): to the person the email of an
   * added wait went to, a deal's main contact, or the person waited on, logged on the deal or the person.
   */
  const composeFor = (w: WaitItem, l: WaitItemLine): ComposeSetup => {
    const email = l.email && isValidEmail(l.email) ? l.email.trim() : null;
    return {
      ...gmail,
      title: `Follow up: ${w.name}`,
      recipients: l.contactId && email ? [{ contactId: l.contactId, name: l.contactName ?? "Main contact", email, role: w.kind === "deal" ? "Main contact" : "This person" }] : [],
      defaultTo: email ?? "",
      contactId: l.contactId && (email || w.kind === "person") ? l.contactId : null,
      pipelineItemId: w.kind === "deal" ? w.id : null,
      organizationId: null,
      toNote: email ? null : w.kind === "deal" ? "This deal has no main contact with an email address. Type the address." : "This person has no email address saved. Type one here, or add it on their page.",
    };
  };
  /** "Open in email" from the Ask AI panel on Home: a typed address, logged as an email sent. */
  const askCompose: ComposeSetup = { ...gmail, title: "Email", recipients: [], defaultTo: "", contactId: null, pipelineItemId: null, organizationId: null, toNote: "Type the address." };
  const askAi = <AskAiPill context={{ page: "home", label: "Work on now" }} compose={askCompose} />;
  const tabs = <WorkTabs toScreen={tabs0.toScreen} outreachDue={tabs0.outreachDue} className="mt-3 mb-0 border-b border-border" />;
  const dateLabel = { long: fmtDate(d.today, "EEEE, MMM d"), short: fmtDate(d.today, "EEE, MMM d") };
  const header = (
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
    </>
  );
  return (
    <WorkShell testId="work-now">
      <ReplyCheck />
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <HomeBoard data={d} dateLabel={dateLabel} askAi={askAi} tabs={tabs} composes={Object.fromEntries(waiting.flatMap((w) => w.lines.map((l) => [l.waitId, composeFor(w, l)])))} personComposes={Object.fromEntries(tilePeople.map((p) => [p.id, composeForPerson(gmail, p)]))} askCompose={askCompose} />
      )}
    </WorkShell>
  );
}

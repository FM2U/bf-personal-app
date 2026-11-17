import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { isValidEmail } from "@/lib/email-address";
import { loadTabCounts, loadWorkCtx } from "@/lib/work/data";
import type { WaitItem, WaitItemLine } from "@/lib/work/waiting";
import type { WaitingCardData } from "@/components/app/work/home-board";
import { loadHome } from "@/lib/work/home-data";
import { composeForPerson } from "@/lib/work/outreach-data";
import { ReplyCheck } from "@/components/app/reply-check";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { WorkTabs } from "@/components/app/nav-links";
import { HomeBoard } from "@/components/app/work/home-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { loadPriorities, PRIORITY_KINDS } from "@/lib/work/priorities-data";
import { TopPrioritiesCard } from "@/components/app/work/priorities";
import { PRIORITIES_OPEN_COOKIE } from "@/lib/work/priorities";
import { cookies } from "next/headers";

export const metadata = { title: "Next actions" };

/**
 * Next actions (2026-11-17, release H1 of the Home redesign): the full board that was Home until Nov 17, opened from
 * Home's Next actions card ("All N next actions") and Waiting card: Top priorities, the area row and the five tiles over
 * the full Next actions list, and on the right Waiting on someone, Today's calendar, Targets today, Contacts, Rosara,
 * Job search, Screen listings, Deals at a glance. In release H3 the list opens in a large window over Home instead.
 * The board is src/components/app/work/home-board.tsx; the data comes from loadHome, as Home's does.
 */
export default async function NextActionsPage({ searchParams }: { searchParams: Promise<{ find?: string; view?: string }> }) {
  const sp = await searchParams;
  const find = String(sp.find ?? "").slice(0, 200);
  const { supabase, ownerId } = await requireOwner();
  // Top priorities open or closed (2026-11-16): kept in a cookie, so the page is drawn the right way from the start.
  const prioOpen = (await cookies()).get(PRIORITIES_OPEN_COOKIE)?.value === "1";
  // Push B: opening Home looks for new replies to the reports and emails the app sent (at most once every few minutes).
  // Page speed (2026-11-06): after the page is on screen (ReplyCheck below), no longer before it.
  // Page speed (2026-11-06): Home's data, the email setup and the tab counts load side by side.
  // Top priorities (2026-11-15) load in the same trip.
  const [d, gmail0, tabs0, prio] = await Promise.all([loadHome(supabase, ownerId), loadGmailSetup(supabase, ownerId), loadWorkCtx(supabase, ownerId).then((c) => loadTabCounts(supabase, ownerId, c.today)), loadPriorities(supabase, ownerId)]);
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
  // Page speed (2026-11-07): the Waiting card arrives after the page is on screen, with each wait's Follow up setup.
  const waitingCard: Promise<WaitingCardData> = d.waiting.then((board) => ({ board, composes: Object.fromEntries(board.items.flatMap((w) => w.lines.map((l) => [l.waitId, composeFor(w, l)]))) }));
  const askCompose: ComposeSetup = { ...gmail, title: "Email", recipients: [], defaultTo: "", contactId: null, pipelineItemId: null, organizationId: null, toNote: "Type the address." };
  const askAi = <AskAiPill context={{ page: "home", label: "Next actions" }} compose={askCompose} />;
  const tabs = <WorkTabs toScreen={tabs0.toScreen} outreachDue={tabs0.outreachDue} className="mt-3 mb-0 border-b border-border" />;
  const dateLabel = { long: fmtDate(d.today, "EEEE, MMM d"), short: fmtDate(d.today, "EEE, MMM d") };
  const header = (
    <>
      <WorkHeader
        title="Next actions"
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
    <WorkShell testId="work-next-actions">
      <ReplyCheck />
      {!d.available ? (
        <>
          {header}
          <WorkUpdateNotice notice={d.notice} />
        </>
      ) : (
        <HomeBoard data={d} priorities={<TopPrioritiesCard data={prio} kinds={PRIORITY_KINDS} collapsible initialOpen={prioOpen} />} dateLabel={dateLabel} askAi={askAi} tabs={tabs} waitingCard={waitingCard} personComposes={Object.fromEntries(tilePeople.map((p) => [p.id, composeForPerson(gmail, p)]))} askCompose={askCompose} title="Next actions" initialQuery={find} showAll={sp.view === "all" || !!find} />
      )}
    </WorkShell>
  );
}

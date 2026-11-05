import { requireOwner } from "@/lib/auth";
import { loadGmailSetup, type ComposeSetup } from "@/lib/compose-email";
import { isGoogleConfigured } from "@/lib/env";
import { getGoogleConnection } from "@/lib/google";
import { RECONNECT_FOR_REPLIES, replyPermission } from "@/lib/google-scopes";
import { syncRepliesQuietly } from "@/lib/replies-sync";
import { isValidEmail } from "@/lib/email-address";
import { loadCtx } from "@/lib/engine/helpers";
import { loadEodBadge, loadReportsPage } from "@/lib/accountability/data";
import { loadMonthlyList } from "@/lib/accountability/monthly-data";
import { parsePeriodKey } from "@/lib/accountability/periods";
import { AccountabilityTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { ReportsBoard } from "@/components/app/work/reports-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { PinnedBlock, WorkHeader } from "@/components/app/work/ui";

export const metadata = { title: "Reports" };

/**
 * Reports (batch C, approved 2026-10-31): the pinned title, Ask AI, the Accountability tabs, and the segmented choice
 * "The week | Sent reports" with the period pills and Find; then the six figure tiles and the four cards, or the sent
 * reports by week (src/components/app/work/reports-board.tsx). ?period=last, w2, w3, w4, or month opens that period
 * (the Past weeks line on Targets links here, Edit batch C item 7). Push D: ?view=monthly opens Monthly reviews.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; period?: string; day?: string; partner?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = null;
  const ctx = await loadCtx(supabase, ownerId);
  // Push B: opening Reports looks for new replies (at most once every few minutes).
  await syncRepliesQuietly(supabase, ownerId);
  const [badge, d, gmail, conn, monthly] = await Promise.all([loadEodBadge(supabase, ownerId, ctx.today), notice ? null : loadReportsPage(supabase, ctx), loadGmailSetup(supabase, ownerId), getGoogleConnection(supabase, ownerId), loadMonthlyList(supabase, ctx)]);
  const replyNote = isGoogleConfigured() && replyPermission(conn) === "reconnect" ? RECONNECT_FOR_REPLIES : null;
  // Reply under a reply: the email box to that partner (only people with an address).
  const composes: Record<string, ComposeSetup> = {};
  for (const p of d?.partners ?? []) {
    if (!p.email || !isValidEmail(p.email)) continue;
    composes[p.id] = { ...gmail, title: `Reply to ${p.name}`, recipients: [{ contactId: p.id, name: p.name, email: p.email, role: "Accountability partner" }], defaultTo: p.email, contactId: p.id, pipelineItemId: null, organizationId: null, toNote: null };
  }
  const names = (d?.partners ?? []).map((p) => p.first);
  const partnerFirst = names.length ? names.join(" and ") : "your partner";
  const title = (
    <WorkHeader
      title="Reports"
      right={
        <>
          <span className="hidden sm:inline" data-testid="reports-summary">
            To {partnerFirst} by email · replies come from your Gmail
          </span>
          <AskAiPill context={{ page: "reports", label: d ? `Reports, ${d.periods[0].label.toLowerCase()}` : "Reports" }} />
        </>
      }
    />
  );
  if (!d) {
    return (
      <WorkShell testId="work-reports">
        <PinnedBlock testId="reports-sticky">
          {title}
          <AccountabilityTabs eodBadge={badge} tight />
        </PinnedBlock>
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-reports">
      <ReportsBoard data={d} title={title} tabs={<AccountabilityTabs eodBadge={badge} tight />} view={sp.view === "monthly" ? "monthly" : sp.view === "sent" || sp.day ? "sent" : "week"} monthly={monthly.items} period={parsePeriodKey(sp.period)} openDay={sp.day ?? null} partnerAtStart={sp.partner ?? null} composes={composes} replyNote={replyNote} />
    </WorkShell>
  );
}

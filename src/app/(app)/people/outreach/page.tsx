import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO } from "@/lib/calc/dates";
import { GROUP_LABELS, OUTCOME_LABELS, type RelationshipGroup } from "@/lib/calc/outreach";
import { loadOutreachQueue, type QueueRow } from "@/lib/outreach";
import { loadOutreachStats, loadTargets, summarizeTargets } from "@/lib/targets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHeader, Stat } from "@/components/app/page-header";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { LogOutreachButton, OutreachQueueRow, type QueueItem } from "@/components/app/outreach-actions";
import { date as fmtDate } from "@/lib/format";

export const metadata = { title: "Outreach Queue" };

function toItem(r: QueueRow): QueueItem {
  const s = r.status;
  return {
    id: r.id,
    name: r.name,
    organization: r.organization,
    groupLabel: r.group ? GROUP_LABELS[r.group as RelationshipGroup] : `Every ${s.everyDays} days`,
    overdueText: s.neverContacted ? "Never contacted" : s.daysOverdue === 0 ? "Due today" : s.daysOverdue === 1 ? "1 day" : `${s.daysOverdue} days`,
    overdueTone: s.neverContacted || (s.daysOverdue ?? 0) > 14 ? "bad" : (s.daysOverdue ?? 0) > 0 ? "warn" : "none",
    lastOutcome: r.lastOutcome ? OUTCOME_LABELS[r.lastOutcome] ?? r.lastOutcome : r.lastContactDate ? "Not recorded" : "None",
    lastContact: r.lastContactDate ?? "",
  };
}

export default async function OutreachQueuePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const today = ctx.today;
  const [queue, stats, targets] = await Promise.all([
    loadOutreachQueue(supabase, { ownerId, today, tz: ctx.tz }),
    loadOutreachStats(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -29), to: today }),
    loadTargets(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -7), to: today }),
  ]);
  const outreachTarget = summarizeTargets(targets, today).find((s) => s.target.count_source === "communications_outreach");
  const upcoming = queue.all
    .filter((r) => !r.status.due && r.status.dueDate)
    .sort((a, b) => String(a.status.dueDate).localeCompare(String(b.status.dueDate)))
    .slice(0, 10);
  const back = "/people/outreach";

  return (
    <div>
      <PageHeader
        title="Outreach Queue"
        description="Contacts due for a message, most overdue first. Due = the last communication date plus the contact's frequency (close 30, warm 60, professional 90 days unless set on the contact)."
      />
      <div className="flex flex-col gap-4">
        {sp.notice ? <Notice tone={sp.notice.startsWith("Database update") || sp.notice.startsWith("Not saved") ? "warn" : "success"}>{sp.notice}</Notice> : null}
        {!queue.available ? (
          <DbUpdateNotice />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <Stat label="Contacts due now" value={queue.due.length} tone={queue.due.length ? "warn" : "good"} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <Stat
                    label={outreachTarget ? `${outreachTarget.target.name} today` : "Outreach logged today"}
                    value={outreachTarget ? (outreachTarget.today.status === "off" ? "Not today" : `${outreachTarget.today.count} of ${outreachTarget.today.required}`) : "No target"}
                    tone={outreachTarget?.today.status === "met" ? "good" : undefined}
                    hint={outreachTarget?.today.status === "off" ? "Inactive day" : undefined}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <Stat label="Reply rate, last 30 days" value={stats?.replyRatePct === null || !stats ? "No outreach yet" : `${stats.replyRatePct}%`} hint={stats ? `${stats.sent} sent` : undefined} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <Stat label="Meetings booked, last 30 days" value={stats?.meetings ?? 0} hint={stats ? `${stats.referrals} referrals` : undefined} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">Due now {queue.due.length ? <Badge variant="warning">{queue.due.length}</Badge> : null}</CardTitle>
                  <CardDescription>Log outreach after you send a message or make a call. It counts toward the Network outreach target. Draft message never sends anything.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {queue.error && queue.available ? <Notice tone="error">The queue could not be read: {queue.error}</Notice> : null}
                {!queue.all.length ? (
                  <EmptyState
                    title="No contacts are in the queue yet."
                    body="Open a contact, press Edit, and set a relationship group (close, warm, or professional). The contact then appears here when a message is due."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <Link href="/people">Open contacts</Link>
                      </Button>
                    }
                  />
                ) : queue.due.length ? (
                  <div>
                    <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_6.5rem_7.5rem_8.5rem_18.5rem] gap-3 border-b border-border pb-2 text-xs font-medium text-muted-foreground md:grid">
                      <span>Name</span>
                      <span>Organization</span>
                      <span>Group</span>
                      <span>Days overdue</span>
                      <span>Last outcome</span>
                      <span className="text-right">Actions</span>
                    </div>
                    <div className="flex flex-col divide-y divide-slate-100">
                      {queue.due.map((r) => (
                        <OutreachQueueRow key={r.id} item={toItem(r)} back={back} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nobody is due today. The next contacts due are listed below.</p>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Coming up</CardTitle>
                  <CardDescription>The next 10 contacts by due date.</CardDescription>
                </CardHeader>
                <CardContent>
                  {upcoming.length ? (
                    <ul className="flex flex-col divide-y divide-slate-100">
                      {upcoming.map((r) => (
                        <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-3 py-2 text-sm">
                          <Link href={`/records/contacts/${r.id}`} className="clamp-1 font-medium hover:underline">
                            {r.name}
                          </Link>
                          <span className="clamp-1 text-muted-foreground">{r.group ? GROUP_LABELS[r.group as RelationshipGroup] : `Every ${r.status.everyDays} days`}</span>
                          <span className="tabular text-right text-muted-foreground">{fmtDate(r.status.dueDate, "MMM d")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No other contacts in the queue.</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Outreach to someone not in the queue</CardTitle>
                  <CardDescription>Logs outreach without a contact. To link a person, log it from their contact page instead.</CardDescription>
                </CardHeader>
                <CardContent>
                  <LogOutreachButton contactId={null} back={back} />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

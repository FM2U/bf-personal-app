import { eodShort } from "@/lib/work/settings";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { isGoogleConfigured } from "@/lib/env";
import { date as fmtDate } from "@/lib/format";
import { getGoogleConnection } from "@/lib/google";
import { RECONNECT_FOR_REPLIES, replyPermission } from "@/lib/google-scopes";
import { daysLabel } from "@/lib/accountability/partners";
import { lastContactLabel, orgRoleLine, OUTREACH_SECTIONS, outreachSectionOf } from "@/lib/work/outreach";
import { loadPersonPage } from "@/lib/work/outreach-data";
import { onFollowUps, PEOPLE_HREF, peopleViewHref } from "@/lib/work/people";
import { headerFigures, type HeaderFigure } from "@/lib/work/record-page";
import { openTodos } from "@/lib/work/todos";
import { syncRepliesQuietly } from "@/lib/replies-sync";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { personAsk } from "@/lib/work/ask-ai";
import { IncomingCard, NextFollowUpCard, PersonDecisionCard, PersonFactsCard, PersonHeaderActions, PersonTasksCard, PersonTimelineCard, WhyInTouchCard } from "@/components/app/work/person/cards";
import { PartnerReportsCard } from "@/components/app/work/person/reports-card";
import { PurposePills } from "@/components/app/work/person-row";
import { RecordHeader } from "@/components/app/work/record-header";
import { RecordColumns } from "@/components/app/work/record-columns";
import { WorkShell } from "@/components/app/work/shell";
import { Pill, What, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Person" };

/**
 * The person page (/work/people/[id]) under the record-page rule (batch B, approved 2026-10-31; push B: under
 * Contacts): breadcrumb to People with the view, the name, buttons Email, Log a call, Ask AI; the status strip with the
 * purpose pills, the organization and role line, and the figures. Left: Why in touch, Next follow-up, Tasks. Right:
 * Facts, Incoming, Timeline, Decision (Archive or Reopen). An accountability partner (push B) has the Reports card in
 * place of Why in touch, and the figures NEXT REPORT, LAST REPLY, LAST CONTACT; opening the page looks for new replies.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const crumbLink = (
    <Link href={PEOPLE_HREF} className="text-primary-strong hover:underline" data-testid="person-crumb">
      Contacts
    </Link>
  );
  const ctx = await loadCtx(supabase, ownerId);
  const { data: role } = await supabase.from("contacts").select("outreach_role").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  const partnerPage = (role as { outreach_role?: string } | null)?.outreach_role === "accountability_partner";
  if (partnerPage) await syncRepliesQuietly(supabase, ownerId);
  const d = await loadPersonPage(supabase, ctx, id);
  const person = d.person;
  if (!person) {
    return (
      <WorkShell testId="work-person">
        <WorkHeader title="Person" crumb={crumbLink} />
        <EmptyState
          title="This person was not found."
          body="They may have been deleted."
          action={
            <Button asChild size="sm">
              <Link href={PEOPLE_HREF}>Back to Contacts</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const fmt = (x: string) => fmtDate(x, "MMM d");
  const followSection = OUTREACH_SECTIONS.find((s) => s.key === outreachSectionOf(person, d.today))?.label ?? "";
  const crumbTail = person.archived ? "Archived" : onFollowUps(person) ? followSection : "People";
  const crumbTailHref = person.archived || !onFollowUps(person) ? peopleViewHref("people") : PEOPLE_HREF;
  const partner = d.partner;
  let figures: HeaderFigure[] = headerFigures({ nextDue: person.nextFollowUp, hasNext: !!person.nextFollowUp || !!person.followUpFor, nextLabel: "Next follow-up", openTasks: openTodos(d.tasks).length, lastContactAt: person.lastContactOn, lastContactKind: person.lastContactKind }, d.today, fmt);
  if (partner) {
    const next = partner.nextReport ? (partner.nextReport === d.today ? `Today ${eodShort(partner.eodTime)}` : fmtDate(partner.nextReport, "EEE MMM d")) : "None";
    figures = [
      { key: "next", value: next, label: "Next report", tone: partner.nextReport === d.today ? "today" : "none" },
      { key: "tasks", value: partner.lastReplyOn ? fmt(partner.lastReplyOn) : "None", label: "Last reply", tone: "none" },
      { key: "last", value: lastContactLabel(person.lastContactOn, person.lastContactKind, d.today, fmt), label: "Last contact", tone: "none" },
    ];
  }
  const replyNote = partner && isGoogleConfigured() && replyPermission(await getGoogleConnection(supabase, ownerId)) === "reconnect" ? RECONNECT_FOR_REPLIES : null;
  const line = orgRoleLine(person);
  return (
    <WorkShell testId="work-person">
      <RecordHeader
        title={person.name}
        crumb={
          <>
            {crumbLink}
            <span className="mx-1.5 text-slate-400">›</span>
            <Link href={crumbTailHref} className="hover:underline">
              {crumbTail}
            </Link>
          </>
        }
        actions={
          <>
            <PersonHeaderActions person={person} compose={d.compose} today={d.today} tz={d.tz} />
            <AskAiPill context={personAsk(person)} compose={d.compose} />
          </>
        }
        testId="person-status-line"
        status={
          <>
            {partner ? <Pill tone="blue">Accountability partner</Pill> : person.purposes.length ? <PurposePills purposes={person.purposes} /> : <Pill tone="quiet">No purpose set</Pill>}
            {person.archived ? <Pill tone="charcoal">Archived</Pill> : null}
            {partner ? <What>{[person.organization, `gets the report ${daysLabel(partner.days)}`].filter(Boolean).join(" · ")}</What> : line ? <What>{line}</What> : null}
          </>
        }
        figures={figures}
      />
      <RecordColumns
        left={
          <>
          {partner ? <PartnerReportsCard personId={person.id} email={person.email} info={partner} replyNote={replyNote} /> : <WhyInTouchCard person={person} />}
          <NextFollowUpCard person={person} today={d.today} />
          <PersonTasksCard person={person} tasks={d.tasks} today={d.today} />
          </>
        }
        right={
          <>
          <PersonFactsCard person={person} records={d.records} today={d.today} />
          {partner && !d.incoming.length ? null : <IncomingCard incoming={d.incoming} />}
          <PersonTimelineCard person={person} events={d.timeline} />
          <PersonDecisionCard person={person} />
          </>
        }
      />
    </WorkShell>
  );
}

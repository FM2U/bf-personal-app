import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { workUpdateNotice } from "@/lib/work/data";
import { orgRoleLine, OUTREACH_SECTIONS, outreachSectionOf } from "@/lib/work/outreach";
import { loadPersonPage } from "@/lib/work/outreach-data";
import { headerFigures } from "@/lib/work/record-page";
import { openTodos } from "@/lib/work/todos";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { personAsk } from "@/lib/work/ask-ai";
import { IncomingCard, NextFollowUpCard, PersonDecisionCard, PersonFactsCard, PersonHeaderActions, PersonTasksCard, PersonTimelineCard, WhyInTouchCard } from "@/components/app/work/person/cards";
import { PurposePills } from "@/components/app/work/person-row";
import { RecordHeader } from "@/components/app/work/record-header";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Pill, What, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Person" };

/**
 * The person page (/work/outreach/[id]) under the record-page rule (batch B, approved 2026-10-31): breadcrumb to
 * Outreach with the section, the name, buttons Email, Log a call, Ask AI; the status strip with the purpose pills,
 * the organization and role line, and the figures NEXT FOLLOW-UP, OPEN TASKS, LAST CONTACT. Left: Why in touch,
 * Next follow-up, Tasks. Right: Facts, Incoming, Timeline, Decision (Archive or Reopen).
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const crumbLink = (
    <Link href="/work/outreach" className="text-primary-strong hover:underline" data-testid="person-crumb">
      Outreach
    </Link>
  );
  const notice = await workUpdateNotice(supabase);
  if (notice) {
    return (
      <WorkShell testId="work-person">
        <WorkHeader title="Person" crumb={crumbLink} />
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const ctx = await loadCtx(supabase, ownerId);
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
              <Link href="/work/outreach">Back to Outreach</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const section = OUTREACH_SECTIONS.find((s) => s.key === outreachSectionOf(person, d.today))?.label ?? "";
  const figures = headerFigures({ nextDue: person.nextFollowUp, hasNext: !!person.nextFollowUp || !!person.followUpFor, nextLabel: "Next follow-up", openTasks: openTodos(d.tasks).length, lastContactAt: person.lastContactOn, lastContactKind: person.lastContactKind }, d.today, (x) => fmtDate(x, "MMM d"));
  const line = orgRoleLine(person);
  return (
    <WorkShell testId="work-person">
      <RecordHeader
        title={person.name}
        crumb={
          <>
            {crumbLink}
            <span className="mx-1.5 text-slate-400">›</span>
            {person.archived ? "Archived" : section}
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
            {person.purposes.length ? <PurposePills purposes={person.purposes} /> : <Pill tone="quiet">No purpose set</Pill>}
            {person.archived ? <Pill tone="charcoal">Archived</Pill> : null}
            {line ? <What>{line}</What> : null}
          </>
        }
        figures={figures}
      />
      <div className="grid grid-cols-1 items-start gap-5 min-[1000px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <WhyInTouchCard person={person} />
          <NextFollowUpCard person={person} today={d.today} />
          <PersonTasksCard person={person} tasks={d.tasks} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <PersonFactsCard person={person} records={d.records} today={d.today} />
          <IncomingCard incoming={d.incoming} />
          <PersonTimelineCard person={person} events={d.timeline} />
          <PersonDecisionCard person={person} />
        </div>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        The same person in the older People screens:{" "}
        <Link href={`/records/contacts/${person.id}`} className="text-primary-strong hover:underline" data-testid="person-old-page">
          open the contact record
        </Link>
        .
      </p>
    </WorkShell>
  );
}

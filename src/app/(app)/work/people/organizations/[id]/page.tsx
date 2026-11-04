import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { lastContactLabel } from "@/lib/work/outreach";
import { loadOrgPage } from "@/lib/work/organizations-data";
import { peopleViewHref, PEOPLE_HREF } from "@/lib/work/people";
import { dueLabel } from "@/lib/work/stages";
import { openTodos } from "@/lib/work/todos";
import type { HeaderFigure } from "@/lib/work/record-page";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { OrgDealsCard, OrgDecisionCard, OrgFactsCard, OrgHeaderActions, OrgNextActionCard, OrgPeopleCard, OrgTasksCard, OrgTimelineCard } from "@/components/app/work/organization/cards";
import { RecordHeader } from "@/components/app/work/record-header";
import { RecordColumns } from "@/components/app/work/record-columns";
import { WorkShell } from "@/components/app/work/shell";
import { Pill, What, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Organization" };

/**
 * The organization page (push B, 2026-11-03) under the record-page rule: breadcrumb Contacts › Organizations, the name,
 * Email (anyone at the firm), Log a call, Ask AI; the status strip with the kind pill, the region and what the firm
 * does, and the figures NEXT ACTION, OPEN DEALS, OPEN TASKS, LAST CONTACT. Left: People, Next action, Tasks. Right:
 * Facts, Deals, Timeline, Decision.
 */
export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const crumb = (
    <>
      <Link href={PEOPLE_HREF} className="text-primary-strong hover:underline" data-testid="org-crumb">
        Contacts
      </Link>
      <span className="mx-1.5 text-slate-400">›</span>
      <Link href={peopleViewHref("orgs")} className="hover:underline">
        Organizations
      </Link>
    </>
  );
  const ctx = await loadCtx(supabase, ownerId);
  const d = await loadOrgPage(supabase, ctx, id);
  const org = d.org;
  if (!org) {
    return (
      <WorkShell testId="work-organization">
        <WorkHeader title="Organization" crumb={crumb} />
        <EmptyState
          title="This organization was not found."
          body="It may have been deleted."
          action={
            <Button asChild size="sm">
              <Link href={peopleViewHref("orgs")}>Back to Organizations</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const fmt = (x: string) => fmtDate(x, "MMM d");
  const due = org.nextAction ? dueLabel(org.nextActionDue, d.today, fmt) : { text: "None", tone: "none" as const };
  const figures: HeaderFigure[] = [
    { key: "next", value: due.text, label: "Next action", tone: due.tone },
    { key: "deals", value: d.deals.length ? String(d.deals.length) : "None", label: "Open deals", tone: "none" },
    { key: "tasks", value: String(openTodos(d.tasks).length), label: openTodos(d.tasks).length === 1 ? "Open task" : "Open tasks", tone: "none" },
    { key: "last", value: lastContactLabel(org.lastContactOn, org.lastContactKind, d.today, fmt), label: "Last contact", tone: "none" },
  ];
  return (
    <WorkShell testId="work-organization">
      <RecordHeader
        title={org.name}
        crumb={crumb}
        actions={
          <>
            <OrgHeaderActions org={org} compose={d.compose} today={d.today} tz={d.tz} />
            <AskAiPill context={{ page: "outreach", label: org.name }} compose={d.compose} />
          </>
        }
        testId="org-status-line"
        status={
          <>
            <Pill tone="blue">{org.kindLabel}</Pill>
            {org.archived ? <Pill tone="charcoal">Archived</Pill> : null}
            {org.region || org.note ? <What>{[org.region, org.note].filter(Boolean).join(" · ")}</What> : null}
          </>
        }
        figures={figures}
      />
      <RecordColumns
        left={
          <>
          <OrgPeopleCard org={org} people={d.people} others={d.others} today={d.today} />
          <OrgNextActionCard org={org} today={d.today} />
          <OrgTasksCard org={org} tasks={d.tasks} today={d.today} />
          </>
        }
        right={
          <>
          <OrgFactsCard org={org} />
          <OrgDealsCard deals={d.deals} passed={d.passed} orgName={org.name} />
          <OrgTimelineCard org={org} events={d.timeline} />
          <OrgDecisionCard org={org} />
          </>
        }
      />
    </WorkShell>
  );
}

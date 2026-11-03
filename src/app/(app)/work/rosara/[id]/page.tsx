import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { loadProjectPage } from "@/lib/work/projects-data";
import { headerFigures } from "@/lib/work/record-page";
import { openTodos } from "@/lib/work/todos";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { projectAsk } from "@/lib/work/ask-ai";
import { GoalCard, ProjectDecisionCard, ProjectFactsCard, ProjectNextActionCard, ProjectTasksCard, ProjectTimelineCard } from "@/components/app/work/project/cards";
import { RecordHeader } from "@/components/app/work/record-header";
import { RecordColumns } from "@/components/app/work/record-columns";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { Pill, What, WorkHeader } from "@/components/app/work/ui";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Project" };

/**
 * The project page (/work/rosara/[id]) under the record-page rule (batch B2, approved 2026-10-31): breadcrumb to
 * Rosara, the name, Ask AI; the status strip with the Rosara pill, the milestone, and the figures NEXT ACTION and
 * OPEN TASKS. Left: Goal and milestone, Next action, Tasks. Right: Facts, Notes and findings, Decision.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, ownerId } = await requireOwner();
  const crumbLink = (
    <Link href="/work/rosara" className="text-primary-strong hover:underline" data-testid="project-crumb">
      Rosara
    </Link>
  );
  const notice = null;
  if (notice) {
    return (
      <WorkShell testId="work-project">
        <WorkHeader title="Project" crumb={crumbLink} />
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const ctx = await loadCtx(supabase, ownerId);
  const d = await loadProjectPage(supabase, ctx, id);
  const project = d.project;
  if (!project) {
    return (
      <WorkShell testId="work-project">
        <WorkHeader title="Project" crumb={crumbLink} />
        <EmptyState
          title="This project was not found."
          body="It may have been deleted."
          action={
            <Button asChild size="sm">
              <Link href="/work/rosara">Back to Rosara</Link>
            </Button>
          }
        />
      </WorkShell>
    );
  }
  const figures = headerFigures({ nextDue: project.nextActionDue, hasNext: !!project.nextAction, nextLabel: "Next action", openTasks: openTodos(d.tasks).length, lastContactAt: null, lastContactKind: null }, d.today, (x) => fmtDate(x, "MMM d")).filter((f) => f.key !== "last");
  return (
    <WorkShell testId="work-project">
      <RecordHeader
        title={project.name}
        crumb={
          <>
            {crumbLink}
            <span className="mx-1.5 text-slate-400">›</span>
            Projects
          </>
        }
        actions={<AskAiPill context={projectAsk(project)} />}
        testId="project-status-line"
        status={
          <>
            <Pill tone={project.status === "closed" ? "charcoal" : "gray"} testId="project-pill">
              {project.status === "closed" ? "Closed" : "Rosara"}
            </Pill>
            <What>
              <b className="font-medium text-slate-700">Milestone:</b> {project.milestone ?? "not set"}
            </What>
          </>
        }
        figures={figures}
      />
      <RecordColumns
        left={
          <>
          <GoalCard project={project} />
          <ProjectNextActionCard project={project} today={d.today} />
          <ProjectTasksCard project={project} tasks={d.tasks} />
          </>
        }
        right={
          <>
          <ProjectFactsCard project={project} />
          <ProjectTimelineCard project={project} events={d.timeline} />
          <ProjectDecisionCard project={project} />
          </>
        }
      />
    </WorkShell>
  );
}

import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadTabCounts, workUpdateNotice } from "@/lib/work/data";
import { parseDealFilter } from "@/lib/work/phases";
import { loadPipelineBoard } from "@/lib/work/pipelines-data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { JobsBoard } from "@/components/app/work/jobs-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Job search" };

/**
 * Job search (batch B2, approved 2026-10-31): the Deals layout with two phases, Early (Contact, Conversation) and
 * Decide (Interview, Offer); Add an opportunity (?add=1) and Ask AI in the pinned title; the closed bar Declined,
 * Not chosen (and Accepted). A row opens the opportunity page.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ add?: string; filter?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = await workUpdateNotice(supabase);
  const d = notice ? null : await loadPipelineBoard(supabase, ownerId, "job");
  const tabs = await loadTabCounts(supabase, ownerId, d?.today ?? "");
  const adding = sp.add === "1";
  const header = (
    <>
      <WorkHeader
        title="Job search"
        right={
          <>
            {!notice ? (
              <Link href={adding ? "/work/jobs" : "/work/jobs?add=1"} className={cn("inline-flex h-9 items-center rounded-[7px] border px-3.5 text-[13px] font-medium", adding ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover")} data-testid="add-opportunity-button">
                {adding ? "Close the form" : "Add an opportunity"}
              </Link>
            ) : null}
            <AskAiPill context={{ page: "jobs", label: "Job search" }} />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} />
    </>
  );
  if (notice || !d) {
    return (
      <WorkShell testId="work-jobs">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-jobs">
      <JobsBoard header={header} data={d} adding={adding} initialFilter={parseDealFilter(sp.filter)} />
    </WorkShell>
  );
}

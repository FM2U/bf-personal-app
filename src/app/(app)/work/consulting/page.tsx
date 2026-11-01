import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadTabCounts, workUpdateNotice } from "@/lib/work/data";
import { loadPipelineBoard } from "@/lib/work/pipelines-data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { ConsultingBoard } from "@/components/app/work/consulting-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Consulting" };

/**
 * Consulting (batch B2, approved 2026-10-31): the stages Lead, Proposal, Engagement, Paid as columns sized to
 * content; Add a lead (?add=1) and Ask AI in the pinned title; the closed bar Lost and Done. A row opens the
 * consulting page.
 */
export default async function ConsultingPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = await workUpdateNotice(supabase);
  const d = notice ? null : await loadPipelineBoard(supabase, ownerId, "consulting");
  const tabs = await loadTabCounts(supabase, ownerId, d?.today ?? "");
  const adding = sp.add === "1";
  const header = (
    <>
      <WorkHeader
        title="Consulting"
        right={
          <>
            {!notice ? (
              <Link href={adding ? "/work/consulting" : "/work/consulting?add=1"} className={cn("inline-flex h-9 items-center rounded-[7px] border px-3.5 text-[13px] font-medium", adding ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary bg-primary text-white hover:bg-primary-hover")} data-testid="add-lead-button">
                {adding ? "Close the form" : "Add a lead"}
              </Link>
            ) : null}
            <AskAiPill context={{ page: "consulting", label: "Consulting" }} />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} />
    </>
  );
  if (notice || !d) {
    return (
      <WorkShell testId="work-consulting">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  return (
    <WorkShell testId="work-consulting">
      <ConsultingBoard header={header} data={d} adding={adding} />
    </WorkShell>
  );
}

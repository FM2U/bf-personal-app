import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { loadTabCounts, workUpdateNotice } from "@/lib/work/data";
import { loadOutreach } from "@/lib/work/outreach-data";
import { WorkTabs } from "@/components/app/nav-links";
import { AskAiPill } from "@/components/app/work/ask-ai";
import { OutreachBoard } from "@/components/app/work/outreach-board";
import { WorkShell, WorkUpdateNotice } from "@/components/app/work/shell";
import { WorkHeader } from "@/components/app/work/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Outreach" };

/**
 * Outreach (batch B, approved 2026-10-31): the working view of the app's contact records. The title with Add a
 * person and Ask AI, the Work tabs, the filter row, the weekly counter, and the people grouped by next follow-up.
 * The rows, filters, and sections are in src/components/app/work/outreach-board.tsx; the data comes from
 * loadOutreach. "?add=1" opens the Add a person form; "?saved=<name>" shows the Saved line.
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ add?: string; saved?: string }> }) {
  const { supabase, ownerId } = await requireOwner();
  const sp = await searchParams;
  const notice = await workUpdateNotice(supabase);
  const ctx = await loadCtx(supabase, ownerId);
  const tabs = await loadTabCounts(supabase, ownerId, ctx.today);
  const adding = sp.add === "1";
  const header = (
    <>
      <WorkHeader
        title="Outreach"
        right={
          <>
            {!notice ? (
              <Link href={adding ? "/work/outreach" : "/work/outreach?add=1"} className={cn("inline-flex h-9 items-center rounded-[7px] border px-3.5 text-[13px] font-medium", adding ? "border-input bg-white text-slate-800 hover:bg-slate-50" : "border-primary-solid bg-primary-solid text-white hover:border-primary-solid-hover hover:bg-primary-solid-hover")} data-testid="add-person-button">
                {adding ? "Close the form" : "Add a person"}
              </Link>
            ) : null}
            <AskAiPill context={{ page: "outreach", label: "Outreach" }} />
          </>
        }
      />
      <WorkTabs toScreen={tabs.toScreen} outreachDue={tabs.outreachDue} />
    </>
  );
  if (notice) {
    return (
      <WorkShell testId="work-outreach">
        {header}
        <WorkUpdateNotice notice={notice} />
      </WorkShell>
    );
  }
  const d = await loadOutreach(supabase, ctx);
  return (
    <WorkShell testId="work-outreach">
      <OutreachBoard header={header} data={d} adding={adding} saved={sp.saved ?? null} />
    </WorkShell>
  );
}

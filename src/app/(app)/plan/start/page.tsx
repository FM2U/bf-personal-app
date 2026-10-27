import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/app/page-header";
import { StartInitiativeBox } from "@/components/app/start-initiative-box";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";
import { hasUpdate0014 } from "@/lib/update-0014";
import { isAIConfigured } from "@/lib/env";
import { dateTime } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Start an initiative" };

export default async function StartInitiativePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const available = await hasUpdate0014(supabase);
  const { data: drafts } = available ? await supabase.from("initiative_drafts").select("id,proposal,source,prompt,created_at").eq("status", "draft").order("created_at", { ascending: false }).limit(8) : { data: [] };
  const open = (drafts ?? []) as Row[];
  return (
    <div>
      <PageHeader title="Start an initiative" description="Type or speak what you want to start. The AI drafts the initiative with goals, milestones, recurring tasks, a target, a budget change, a plan, and checklists. You approve the items you want." />
      {sp.notice ? (
        <div className="mb-4">
          <Notice tone={/failed|cap|not|need|could/i.test(sp.notice) ? "warn" : "info"}>{sp.notice}</Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" id="start-initiative">
          <CardHeader>
            <CardTitle>Describe the initiative</CardTitle>
          </CardHeader>
          <CardContent>{available ? <StartInitiativeBox aiReady={isAIConfigured()} /> : <DbUpdateNotice file={DB_UPDATE_FILE_0014} features="Start an initiative, checklists, plan documents, savings ideas, and sample data appear after the update." />}</CardContent>
          <CardNote>Example: a weekly meal plan becomes a 7-day menu, a grocery list that resets each week, Saturday and Sunday tasks, and a food budget target.</CardNote>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Drafts waiting for review</CardTitle>
            </CardHeader>
            <CardContent>
              {open.length ? (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {open.map((d) => (
                    <li key={d.id} className="py-2">
                      <Link href={`/plan/initiatives/drafts/${d.id}`} className="clamp-1 text-sm font-medium hover:underline">
                        {d.proposal?.proposal?.initiative?.name || "Untitled draft"}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {d.source === "savings_idea" ? "From a savings idea" : d.source === "chat" ? "From the AI chat" : String(d.prompt ?? "").trim() ? "Typed or spoken" : "Added manually"}, {dateTime(d.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No drafts waiting.</p>
              )}
            </CardContent>
            <CardNote>A draft is only a proposal. Nothing is created until you approve it.</CardNote>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-slate-700">
                <li>Type or press Speak and say a few sentences.</li>
                <li>Press Draft the plan. The AI drafts every step, and the setup opens in a window.</li>
                <li>Go step by step (name, goals, milestones, tasks, target and budget, plan): edit any item, uncheck what you do not want, press Save.</li>
                <li>On the last step, press Approve selected. Every record is created and linked to the initiative.</li>
              </ol>
            </CardContent>
            <CardNote>You can also type &quot;Start an initiative: ...&quot; in the AI chat.</CardNote>
          </Card>
        </div>
      </div>
    </div>
  );
}

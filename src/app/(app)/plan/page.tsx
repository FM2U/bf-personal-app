import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import type { Row } from "@/lib/types";
import { CardNote } from "@/components/ui/card";
import { Notice } from "@/components/app/page-header";
import { StartInitiativeBox } from "@/components/app/start-initiative-box";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { DB_UPDATE_FILE_0014 } from "@/lib/schema-guard";
import { hasUpdate0014 } from "@/lib/update-0014";
import { isAIConfigured } from "@/lib/env";

export const metadata = { title: "Initiatives" };

export default async function InitiativesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { supabase } = await requireOwner();
  const has14 = await hasUpdate0014(supabase);
  const { data: draftRows } = has14 ? await supabase.from("initiative_drafts").select("id,proposal,created_at").eq("status", "draft").order("created_at", { ascending: false }).limit(5) : { data: [] };
  const drafts = (draftRows ?? []) as Row[];
  const [{ data: inits }, { data: goals }, { data: conds }, { data: pipes }, { data: tasks }, { data: ms }] = await Promise.all([
    supabase.from("initiatives").select("*").order("sort_order"),
    supabase.from("goals").select("id,initiative_id,status"),
    supabase.from("decision_conditions").select("id,initiative_id,currently_met,is_active"),
    supabase.from("pipelines").select("id,initiative_id,name"),
    supabase.from("tasks").select("id,initiative_id").eq("status", "todo"),
    supabase.from("milestones").select("id,goal_id,status"),
  ]);
  const nameOf = Object.fromEntries(((inits ?? []) as Row[]).map((i) => [i.id, i.name]));
  const subsOf = (id: string) => ((inits ?? []) as Row[]).filter((x) => x.parent_initiative_id === id).map((x) => x.name);
  const goalInit = Object.fromEntries(((goals ?? []) as Row[]).map((g) => [g.id, g.initiative_id]));
  const count = (list: Row[] | null, id: string, f: (r: Row) => boolean = () => true) => ((list ?? []) as Row[]).filter((r) => r.initiative_id === id && f(r)).length;
  return (
    <div>
      <PageHeader
        title="Initiatives"
        description="The main efforts. Each initiative holds its own goals, milestones, decision conditions, and pipelines."
        actions={
          <Button asChild size="sm">
            <Link href="/records/initiatives/new">Add initiative</Link>
          </Button>
        }
      />
      {sp.notice ? (
        <div className="mb-4">
          <Notice tone="warn">{sp.notice}</Notice>
        </div>
      ) : null}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" id="start-initiative">
          <CardHeader>
            <CardTitle>Start an initiative</CardTitle>
          </CardHeader>
          <CardContent>{has14 ? <StartInitiativeBox back="/plan" aiReady={isAIConfigured()} compact /> : <DbUpdateNotice file={DB_UPDATE_FILE_0014} features="Start an initiative (typed or spoken), plan documents, and checklists appear after the update." />}</CardContent>
          <CardNote>Type or speak a few sentences. The AI drafts the whole plan; you approve the items you want.</CardNote>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Drafts waiting for review</CardTitle>
          </CardHeader>
          <CardContent>
            {drafts.length ? (
              <ul className="flex flex-col divide-y divide-slate-100">
                {drafts.map((d) => (
                  <li key={d.id} className="py-2">
                    <Link href={`/plan/initiatives/drafts/${d.id}`} className="clamp-1 text-sm font-medium hover:underline">
                      {d.proposal?.proposal?.initiative?.name ?? "Draft"}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No drafts waiting.</p>
            )}
          </CardContent>
          <CardNote>Proposals from Start an initiative and from approved savings ideas. Nothing is created until you approve.</CardNote>
        </Card>
      </div>
      {(inits ?? []).length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {((inits ?? []) as Row[]).map((i) => (
            <Card key={i.id} className={i.is_active ? "" : "opacity-60"}>
              <CardHeader>
                <CardTitle>
                  <Link href={`/records/initiatives/${i.id}`} className="hover:underline">
                    {i.name}
                  </Link>
                </CardTitle>
                <CardDescription className="clamp-2 min-h-10">{i.description ?? "No description."}</CardDescription>
                <p className="clamp-1 min-h-4 text-xs text-muted-foreground">
                  {i.parent_initiative_id && nameOf[i.parent_initiative_id] ? `Part of ${nameOf[i.parent_initiative_id]}` : subsOf(i.id).length ? `Includes ${subsOf(i.id).join(", ")}` : ""}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <StatGrid className="grid-cols-4">
                  <Stat label="Active goals" value={count(goals, i.id, (g) => g.status === "active")} />
                  <Stat label="Open milestones" value={((ms ?? []) as Row[]).filter((m) => goalInit[m.goal_id] === i.id && ["planned", "active"].includes(m.status)).length} />
                  <Stat label="Conditions met" value={count(conds, i.id, (c) => c.currently_met && c.is_active)} tone={count(conds, i.id, (c) => c.currently_met && c.is_active) ? "warn" : undefined} />
                  <Stat label="Open tasks" value={count(tasks, i.id)} />
                </StatGrid>
                <div className="flex flex-wrap gap-2">
                  {((pipes ?? []) as Row[])
                    .filter((p) => p.initiative_id === i.id)
                    .map((p) => (
                      <Link key={p.id} href={`/opportunities/${p.id}`} className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-slate-50">
                        {p.name}
                      </Link>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No initiatives yet." body="Add the main efforts you are working on." action={<Button asChild size="sm"><Link href="/records/initiatives/new">Add initiative</Link></Button>} />
      )}
    </div>
  );
}

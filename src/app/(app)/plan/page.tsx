import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat } from "@/components/app/page-header";
import type { Row } from "@/lib/types";

export const metadata = { title: "Initiatives" };

export default async function InitiativesPage() {
  const { supabase } = await requireOwner();
  const [{ data: inits }, { data: goals }, { data: conds }, { data: pipes }, { data: tasks }, { data: ms }] = await Promise.all([
    supabase.from("initiatives").select("*").order("sort_order"),
    supabase.from("goals").select("id,initiative_id,status"),
    supabase.from("decision_conditions").select("id,initiative_id,currently_met,is_active"),
    supabase.from("pipelines").select("id,initiative_id,name"),
    supabase.from("tasks").select("id,initiative_id").eq("status", "todo"),
    supabase.from("milestones").select("id,goal_id,status"),
  ]);
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
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-4 gap-3">
                  <Stat label="Active goals" value={count(goals, i.id, (g) => g.status === "active")} />
                  <Stat label="Open milestones" value={((ms ?? []) as Row[]).filter((m) => goalInit[m.goal_id] === i.id && ["planned", "active"].includes(m.status)).length} />
                  <Stat label="Conditions met" value={count(conds, i.id, (c) => c.currently_met && c.is_active)} tone={count(conds, i.id, (c) => c.currently_met && c.is_active) ? "warn" : undefined} />
                  <Stat label="Open tasks" value={count(tasks, i.id)} />
                </div>
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

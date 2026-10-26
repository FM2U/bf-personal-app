import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat } from "@/components/app/page-header";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: pipes }, { data: stages }, { data: items }, { data: inits }] = await Promise.all([
    supabase.from("pipelines").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("pipeline_stages").select("*").order("position"),
    supabase.from("pipeline_items").select("id,name,pipeline_id,stage_id,status,next_action,next_action_due"),
    supabase.from("initiatives").select("id,name"),
  ]);
  const initName = Object.fromEntries(((inits ?? []) as Row[]).map((i) => [i.id, i.name]));
  const all = (items ?? []) as Row[];
  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="One shared pipeline system. Each pipeline belongs to an initiative. Add or edit pipelines and stages in Settings, Initiatives and pipelines."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/initiatives">Edit pipelines and stages</Link>
          </Button>
        }
      />
      {(pipes ?? []).length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {((pipes ?? []) as Row[]).map((p) => {
            const its = all.filter((i) => i.pipeline_id === p.id);
            const open = its.filter((i) => i.status === "open");
            const st = ((stages ?? []) as Row[]).filter((s) => s.pipeline_id === p.id);
            const due = open.filter((i) => i.next_action_due && i.next_action_due <= ctx.today);
            const next = open.filter((i) => i.next_action_due).sort((a, b) => a.next_action_due.localeCompare(b.next_action_due))[0];
            return (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle>
                    <Link href={`/opportunities/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>{initName[p.initiative_id] ?? "No initiative"}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Open items" value={open.length} />
                    <Stat label="Next actions due" value={due.length} tone={due.length ? "warn" : undefined} />
                    <Stat label="Closed won" value={its.filter((i) => i.status === "won").length} />
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                    {st
                      .filter((s) => s.outcome === "open")
                      .map((s, i) => {
                        const n = open.filter((x) => x.stage_id === s.id).length;
                        return n ? <div key={s.id} title={`${s.name}: ${n}`} style={{ flex: n, opacity: 0.35 + (0.65 * (i + 1)) / st.length }} className="bg-teal-700" /> : null;
                      })}
                  </div>
                  <p className="clamp-1 text-xs text-muted-foreground">{next ? `Next: ${next.name}: ${next.next_action} (${fmtDate(next.next_action_due)})` : "No next actions scheduled."}</p>
                  <Button asChild size="sm" variant="outline" className="self-start">
                    <Link href={`/opportunities/${p.id}`}>Open pipeline</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No pipelines yet." body="Add a pipeline in Settings, Initiatives and pipelines." action={<Button asChild size="sm"><Link href="/records/pipelines/new">Add pipeline</Link></Button>} />
      )}
    </div>
  );
}

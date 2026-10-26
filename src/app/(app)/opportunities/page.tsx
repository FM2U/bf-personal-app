import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { loadPipelineStatus } from "@/lib/pipeline";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";
import { cn } from "@/lib/utils";

const FILTERS = {
  "needs-next-action": {
    label: "Need a next action",
    title: "Pipeline items that need a next action",
    body: "Open items with no next action. Open each item, press Edit, and fill in the next action and its due date.",
  },
  stalled: {
    label: "Stalled",
    title: "Stalled pipeline items",
    body: "Open items with no stage change and no activity for the set number of days (Plan, Inputs and Assumptions).",
  },
} as const;
type FilterKey = keyof typeof FILTERS;

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  const filter = (Object.keys(FILTERS) as FilterKey[]).find((k) => k === sp.filter) ?? null;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const [{ data: pipes }, { data: stages }, { data: items }, { data: inits }] = await Promise.all([
    supabase.from("pipelines").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("pipeline_stages").select("*").order("position"),
    supabase.from("pipeline_items").select("*"),
    supabase.from("initiatives").select("id,name"),
  ]);
  const initName = Object.fromEntries(((inits ?? []) as Row[]).map((i) => [i.id, i.name]));
  const all = (items ?? []) as Row[];
  const status = await loadPipelineStatus(supabase, all.filter((i) => i.status === "open"), { ownerId, tz: ctx.tz, today: ctx.today, stages: (stages ?? []) as Row[] });
  const openItems = all.filter((i) => i.status === "open");
  const matches: Record<FilterKey, Row[]> = {
    "needs-next-action": openItems.filter((i) => !String(i.next_action ?? "").trim()),
    stalled: openItems.filter((i) => status.byItem[i.id]?.stalled),
  };
  const pipeName = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p.name]));
  const stageName = Object.fromEntries(((stages ?? []) as Row[]).map((st) => [st.id, st.name]));
  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="One shared pipeline system. Each pipeline belongs to an initiative. Add or edit pipelines and stages in Settings, Initiatives and pipelines."
        actions={
          <>
            {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
              <Button key={k} asChild size="sm" variant={filter === k ? "default" : "outline"}>
                <Link href={filter === k ? "/opportunities" : `/opportunities?filter=${k}`}>
                  {FILTERS[k].label}: {matches[k].length}
                </Link>
              </Button>
            ))}
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/initiatives">Edit pipelines and stages</Link>
            </Button>
          </>
        }
      />
      {filter ? (
        <Card className="mb-4">
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>
                {FILTERS[filter].title} ({matches[filter].length})
              </CardTitle>
              <CardDescription>{FILTERS[filter].body}</CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/opportunities">Show all pipelines</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {matches[filter].length ? (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Item</TH>
                    <TH>Pipeline</TH>
                    <TH>Stage</TH>
                    <TH>Next action</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {matches[filter].map((i) => (
                    <TR key={i.id}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Link href={`/records/pipeline_items/${i.id}${filter === "needs-next-action" ? "?edit=1" : ""}`} className="clamp-2 font-medium hover:underline">
                            {i.name}
                          </Link>
                          <DealSourceBadge type={i.deal_source_type} />
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap">{pipeName[i.pipeline_id] ?? ""}</TD>
                      <TD className="whitespace-nowrap">{stageName[i.stage_id] ?? ""}</TD>
                      <TD className={cn(!i.next_action && "font-medium text-status-soon")}>{i.next_action ? `${i.next_action}${i.next_action_due ? ` (${fmtDate(i.next_action_due, "MMM d")})` : ""}` : "Not set"}</TD>
                      <TD>
                        <ItemStatusBadges status={status.byItem[i.id]} itemStatus={i.status} fallback />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">None right now.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
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
                  <StatGrid className="grid-cols-4">
                    <Stat label="Open items" value={open.length} />
                    <Stat label="Next actions due" value={due.length} tone={due.length ? "warn" : undefined} />
                    <Stat label="Stalled" value={open.filter((i) => status.byItem[i.id]?.stalled).length} tone={open.some((i) => status.byItem[i.id]?.stalled) ? "warn" : undefined} />
                    <Stat label="Closed won" value={its.filter((i) => i.status === "won").length} />
                  </StatGrid>
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

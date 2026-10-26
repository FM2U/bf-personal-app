import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { daysBetween } from "@/lib/calc/dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";

export default async function PipelinePage({ params, searchParams }: { params: Promise<{ pipelineId: string }>; searchParams: Promise<{ closed?: string }> }) {
  const { pipelineId } = await params;
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const { data: pipe } = await supabase.from("pipelines").select("*").eq("id", pipelineId).maybeSingle();
  if (!pipe) notFound();
  const [{ data: stages }, { data: items }, { data: orgs }, { data: history }] = await Promise.all([
    supabase.from("pipeline_stages").select("*").eq("pipeline_id", pipelineId).order("position"),
    supabase.from("pipeline_items").select("*").eq("pipeline_id", pipelineId).order("next_action_due", { ascending: true, nullsFirst: false }),
    supabase.from("organizations").select("id,name"),
    supabase.from("stage_history").select("item_id,stage_id,entered_at,exited_at"),
  ]);
  const itemIds = new Set(((items ?? []) as Row[]).map((i) => i.id));
  const orgName = Object.fromEntries(((orgs ?? []) as Row[]).map((o) => [o.id, o.name]));
  let extra: Record<string, Row> = {};
  const detailTable = pipe.kind === "acquisition" ? "deal_financials_calculated" : pipe.kind === "job" ? "job_details" : pipe.kind === "investor" ? "investor_details" : null;
  if (detailTable && itemIds.size) {
    const { data } = await supabase.from(detailTable).select("*").in("item_id", [...itemIds]);
    extra = Object.fromEntries(((data ?? []) as Row[]).map((d) => [d.item_id, d]));
  }
  const showClosed = sp.closed === "1";
  const stageList = ((stages ?? []) as Row[]).filter((s) => showClosed || s.outcome === "open");
  const hist = ((history ?? []) as Row[]).filter((h) => itemIds.has(h.item_id));
  const avgDays = (stageId: string) => {
    const done = hist.filter((h) => h.stage_id === stageId && h.exited_at);
    if (!done.length) return null;
    return Math.round(done.reduce((s, h) => s + daysBetween(h.entered_at.slice(0, 10), h.exited_at.slice(0, 10)), 0) / done.length);
  };
  const closedCount = ((items ?? []) as Row[]).filter((i) => i.status !== "open").length;
  return (
    <div>
      <PageHeader
        title={pipe.name}
        description="Each item has a stage, next action and due date, linked contacts, documents, communication history, and notes. Open an item to move it between stages."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={showClosed ? `/opportunities/${pipelineId}` : `/opportunities/${pipelineId}?closed=1`}>{showClosed ? "Hide closed stages" : `Show closed stages (${closedCount})`}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/records/pipeline_items/new?pipeline_id=${pipelineId}&stage_id=${stageList[0]?.id ?? ""}`}>Add item</Link>
            </Button>
          </>
        }
      />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        <div className="grid auto-cols-[17rem] grid-flow-col gap-3">
          {stageList.map((s) => {
            const its = ((items ?? []) as Row[]).filter((i) => i.stage_id === s.id);
            const avg = avgDays(s.id);
            return (
              <Card key={s.id} className="bg-slate-50/80">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="clamp-1">{s.name}</span>
                    <Badge variant={s.outcome === "won" ? "success" : s.outcome === "lost" ? "neutral" : "outline"}>{its.length}</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{avg === null ? "No completed stays yet" : `Average ${avg} days in this stage`}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {its.map((i) => {
                    const overdue = i.next_action_due && i.next_action_due < ctx.today;
                    const d = extra[i.id];
                    return (
                      <Link key={i.id} href={`/records/pipeline_items/${i.id}`} className="flex flex-col gap-1 rounded-lg border border-border bg-white p-3 text-sm shadow-xs hover:border-teal-600">
                        <span className="clamp-2 font-medium">{i.name}</span>
                        {i.organization_id ? <span className="clamp-1 text-xs text-muted-foreground">{orgName[i.organization_id]}</span> : null}
                        {d && pipe.kind === "acquisition" && d.asking_price ? (
                          <span className="text-xs text-slate-600">
                            Asking {money(d.asking_price)}
                            {d.ebitda_multiple ? `, ${Number(d.ebitda_multiple).toFixed(1)}x EBITDA` : ""}
                          </span>
                        ) : null}
                        {d && pipe.kind === "job" && d.salary ? <span className="text-xs text-slate-600">Salary {money(d.salary)}</span> : null}
                        {d && pipe.kind === "investor" && (d.amount_committed || d.amount_discussed) ? <span className="text-xs text-slate-600">{d.amount_committed ? `Committed ${money(d.amount_committed)}` : `Discussed ${money(d.amount_discussed)}`}</span> : null}
                        <span className={`clamp-2 text-xs ${overdue ? "font-medium text-red-700" : i.next_action ? "text-slate-700" : "text-amber-700"}`}>
                          {i.next_action ? `${i.next_action}${i.next_action_due ? ` (${fmtDate(i.next_action_due, "MMM d")})` : ""}` : "Set the next action"}
                        </span>
                      </Link>
                    );
                  })}
                  {!its.length ? <p className="py-2 text-center text-xs text-muted-foreground">No items</p> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

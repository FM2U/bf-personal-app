import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { daysBetween, todayInTz, weekBounds } from "@/lib/calc/dates";
import { compareDeals } from "@/lib/calc/pipeline";
import { loadPipelineStatus, type ItemStatus } from "@/lib/pipeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";

export default async function PipelinePage({ params, searchParams }: { params: Promise<{ pipelineId: string }>; searchParams: Promise<{ closed?: string; view?: string }> }) {
  const { pipelineId } = await params;
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const { data: pipe } = await supabase.from("pipelines").select("*").eq("id", pipelineId).maybeSingle();
  if (!pipe) notFound();
  const [{ data: stages }, { data: itemsData }, { data: orgs }, { data: history }] = await Promise.all([
    supabase.from("pipeline_stages").select("*").eq("pipeline_id", pipelineId).order("position"),
    supabase.from("pipeline_items").select("*").eq("pipeline_id", pipelineId).order("next_action_due", { ascending: true, nullsFirst: false }),
    supabase.from("organizations").select("id,name"),
    supabase.from("stage_history").select("item_id,stage_id,entered_at,exited_at"),
  ]);
  const items = ((itemsData ?? []) as Row[]).sort(compareDeals);
  const allStages = (stages ?? []) as Row[];
  const itemIds = new Set(items.map((i) => i.id));
  const orgName = Object.fromEntries(((orgs ?? []) as Row[]).map((o) => [o.id, o.name]));
  let extra: Record<string, Row> = {};
  const detailTable = pipe.kind === "acquisition" ? "deal_financials_calculated" : pipe.kind === "job" ? "job_details" : pipe.kind === "investor" ? "investor_details" : null;
  if (detailTable && itemIds.size) {
    const { data } = await supabase.from(detailTable).select("*").in("item_id", [...itemIds]);
    extra = Object.fromEntries(((data ?? []) as Row[]).map((d) => [d.item_id, d]));
  }
  const status = await loadPipelineStatus(supabase, items, { ownerId, tz: ctx.tz, today: ctx.today, stages: allStages });
  const isAcq = pipe.kind === "acquisition";
  const showClosed = sp.closed === "1";
  const listView = sp.view === "list";
  const stageList = allStages.filter((s) => showClosed || s.outcome === "open");
  const stageName = Object.fromEntries(allStages.map((s) => [s.id, s.name]));
  const hist = ((history ?? []) as Row[]).filter((h) => itemIds.has(h.item_id));
  const avgDays = (stageId: string) => {
    const done = hist.filter((h) => h.stage_id === stageId && h.exited_at);
    if (!done.length) return null;
    return Math.round(done.reduce((s, h) => s + daysBetween(h.entered_at.slice(0, 10), h.exited_at.slice(0, 10)), 0) / done.length);
  };
  const closedCount = items.filter((i) => i.status !== "open").length;
  const shown = items.filter((i) => showClosed || i.status === "open");
  const stalledCount = items.filter((i) => status.byItem[i.id]?.stalled).length;
  const overCount = items.filter((i) => status.byItem[i.id]?.limit?.over).length;
  const href = (p: Record<string, string>) => {
    const q = new URLSearchParams({ ...(showClosed ? { closed: "1" } : {}), ...(listView ? { view: "list" } : {}), ...p });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return `/opportunities/${pipelineId}${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title={pipe.name}
        description={`Each item has a stage, a next action with a due date, and the stage's task list.${isAcq ? " Proprietary (off-market) deals are listed first in every stage." : ""} Open an item to move it between stages.`}
        actions={
          <>
            <div className="flex rounded-md border border-border bg-white p-0.5" role="group" aria-label="View">
              <Button asChild size="sm" variant={listView ? "ghost" : "default"} className="h-7">
                <Link href={href({ view: "" })}>Board</Link>
              </Button>
              <Button asChild size="sm" variant={listView ? "default" : "ghost"} className="h-7">
                <Link href={href({ view: "list" })}>List</Link>
              </Button>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={href({ closed: showClosed ? "" : "1" })}>{showClosed ? "Hide closed stages" : `Show closed stages (${closedCount})`}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/records/pipeline_items/new?pipeline_id=${pipelineId}&stage_id=${stageList[0]?.id ?? ""}`}>Add item</Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-4">
        {!status.available ? <DbUpdateNotice compact /> : null}
        {isAcq ? <DealSourceStrip items={items} stages={allStages.filter((s) => s.outcome === "open")} tz={ctx.tz} today={ctx.today} available={status.available} /> : null}
        {stalledCount || overCount ? (
          <p className="text-sm text-muted-foreground">
            {stalledCount ? <span className="font-medium text-amber-800">{stalledCount} stalled</span> : null}
            {stalledCount && overCount ? ", " : null}
            {overCount ? <span className="font-medium text-red-700">{overCount} over the stage time limit</span> : null}. Stalled = no stage change and no activity for {status.stallDays} days or more.
          </p>
        ) : null}
      </div>
      {listView ? (
        <Card>
          <CardContent className="pt-5">
            <div className="overflow-x-auto">
              <Table className="min-w-[60rem] table-fixed">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="w-[20%]">Item</TH>
                    {isAcq ? <TH className="w-[8.5rem]">Source</TH> : null}
                    <TH className="w-[8.5rem]">Stage</TH>
                    <TH className="w-[7.5rem] text-right">Days in stage</TH>
                    <TH>Next action</TH>
                    <TH className="w-[5.5rem]">Due</TH>
                    <TH className="w-[11rem]">Flags</TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((i) => {
                    const st = status.byItem[i.id];
                    const overdue = i.next_action_due && i.next_action_due < ctx.today;
                    return (
                      <TR key={i.id}>
                        <TD>
                          <Link href={`/records/pipeline_items/${i.id}`} className="clamp-2 font-medium hover:underline">
                            {i.name}
                          </Link>
                        </TD>
                        {isAcq ? (
                          <TD>
                            <DealSourceBadge type={i.deal_source_type} showUnset />
                          </TD>
                        ) : null}
                        <TD>
                          <span className="clamp-2">{stageName[i.stage_id] ?? "None"}</span>
                        </TD>
                        <TD className="tabular text-right">{daysText(st)}</TD>
                        <TD className={i.next_action ? "" : "font-medium text-amber-700"}>
                          <span className="clamp-2">{i.next_action ?? "Set the next action"}</span>
                        </TD>
                        <TD className={cn("tabular whitespace-nowrap", overdue && "font-medium text-red-700")}>{i.next_action_due ? fmtDate(i.next_action_due, "MMM d") : "Not set"}</TD>
                        <TD>
                          <ItemStatusBadges status={st} itemStatus={i.status} fallback nextActionOverdue={!!overdue && i.status === "open"} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            {!shown.length ? <p className="py-4 text-center text-sm text-muted-foreground">No items yet.</p> : null}
          </CardContent>
        </Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          <div className="grid auto-cols-[17rem] grid-flow-col gap-3">
            {stageList.map((s) => {
              const its = items.filter((i) => i.stage_id === s.id);
              const avg = avgDays(s.id);
              return (
                <Card key={s.id} className="bg-slate-50/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span className="clamp-1">{s.name}</span>
                      <Badge variant={s.outcome === "won" ? "success" : s.outcome === "lost" ? "neutral" : "outline"}>{its.length}</Badge>
                    </CardTitle>
                    <p className="clamp-1 text-xs text-muted-foreground">
                      {s.max_days_in_stage ? `Limit ${s.max_days_in_stage} days. ` : ""}
                      {avg === null ? "No completed stays yet" : `Average ${avg} days`}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {its.map((i) => {
                      const overdue = i.next_action_due && i.next_action_due < ctx.today;
                      const d = extra[i.id];
                      const st = status.byItem[i.id];
                      return (
                        <Link key={i.id} href={`/records/pipeline_items/${i.id}`} className="flex flex-col gap-1 rounded-lg border border-border bg-white p-3 text-sm shadow-xs hover:border-teal-600">
                          <span className="clamp-2 font-medium">{i.name}</span>
                          {i.organization_id ? <span className="clamp-1 text-xs text-muted-foreground">{orgName[i.organization_id]}</span> : null}
                          {d && isAcq && d.asking_price ? (
                            <span className="text-xs text-slate-600">
                              Asking {money(d.asking_price)}
                              {d.ebitda_multiple ? `, ${Number(d.ebitda_multiple).toFixed(1)}x EBITDA` : ""}
                            </span>
                          ) : null}
                          {d && pipe.kind === "job" && d.salary ? <span className="text-xs text-slate-600">Salary {money(d.salary)}</span> : null}
                          {d && pipe.kind === "investor" && (d.amount_committed || d.amount_discussed) ? <span className="text-xs text-slate-600">{d.amount_committed ? `Committed ${money(d.amount_committed)}` : `Discussed ${money(d.amount_discussed)}`}</span> : null}
                          {(isAcq && i.deal_source_type) || st?.stalled || st?.limit?.over ? (
                            <span className="flex flex-wrap gap-1 pt-0.5">
                              {isAcq ? <DealSourceBadge type={i.deal_source_type} /> : null}
                              <ItemStatusBadges status={st} itemStatus={i.status} />
                            </span>
                          ) : null}
                          <span className={`clamp-2 text-xs ${overdue ? "font-medium text-red-700" : i.next_action ? "text-slate-700" : "font-medium text-amber-700"}`}>
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
      )}
    </div>
  );
}

function daysText(st: ItemStatus | undefined): string {
  if (!st?.enteredDate) return "";
  if (st.limit?.limit) return `${st.limit.daysInStage} of ${st.limit.limit}`;
  return String(st.limit?.daysInStage ?? "");
}

/** Counts of proprietary and brokered deals: sourced this week, open, and open per stage. */
function DealSourceStrip({ items, stages, tz, today, available }: { items: Row[]; stages: Row[]; tz: string; today: string; available: boolean }) {
  if (!available) return null;
  const week = weekBounds(today);
  const types = [
    { key: "proprietary", label: "Proprietary" },
    { key: "brokered", label: "Brokered" },
  ];
  const anyUnset = items.some((i) => i.status === "open" && !i.deal_source_type);
  if (anyUnset) types.push({ key: "", label: "Not set" });
  const is = (i: Row, key: string) => (key ? i.deal_source_type === key : !i.deal_source_type);
  const createdThisWeek = (i: Row) => {
    const d = todayInTz(tz, new Date(i.created_at));
    return d >= week.start && d <= week.end;
  };
  const open = items.filter((i) => i.status === "open");
  const share = open.length ? Math.round((open.filter((i) => i.deal_source_type === "proprietary").length / open.length) * 100) : null;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <CardTitle>Deal source</CardTitle>
          <CardDescription>Proprietary = off-market, found directly. Brokered = listed by a broker.</CardDescription>
        </div>
        <p className="text-sm text-slate-700">
          Proprietary share of open deals: <span className="tabular font-semibold">{share === null ? "No open deals" : `${share}%`}</span>
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="w-[7.5rem] py-2 pr-2 text-left font-medium">Type</th>
                <th className="w-[5.5rem] px-2 py-2 text-right align-bottom font-medium">
                  <span className="clamp-2">Sourced this week</span>
                </th>
                <th className="w-[4.5rem] px-2 py-2 text-right align-bottom font-medium">Open</th>
                {stages.map((s) => (
                  <th key={s.id} className="px-2 py-2 text-right align-bottom font-medium">
                    <span className="clamp-2">{s.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.key || "unset"} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-2">{t.key ? <DealSourceBadge type={t.key} /> : <span className="text-muted-foreground">{t.label}</span>}</td>
                  <td className="tabular px-2 py-2 text-right font-semibold">{items.filter((i) => is(i, t.key) && createdThisWeek(i)).length}</td>
                  <td className="tabular px-2 py-2 text-right font-semibold">{open.filter((i) => is(i, t.key)).length}</td>
                  {stages.map((s) => (
                    <td key={s.id} className="tabular px-2 py-2 text-right text-slate-700">
                      {open.filter((i) => is(i, t.key) && i.stage_id === s.id).length}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

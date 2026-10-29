import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { daysBetween, todayInTz, weekBounds } from "@/lib/calc/dates";
import { compareDeals } from "@/lib/calc/pipeline";
import { loadPipelineStatus, type ItemStatus } from "@/lib/pipeline";
import { Card, CardContent, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, dueClass } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { DealSourceBadge, ItemStatusBadges } from "@/components/app/pipeline-badges";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { date as fmtDate, money } from "@/lib/format";
import type { Row } from "@/lib/types";
import { cn } from "@/lib/utils";
import { pipelineClosedCookie, resolvePipelineView, resolveShowClosed } from "@/lib/pipeline-view";
import { RememberPipelineView } from "@/components/app/remember-view";
import { Stat, StatGrid } from "@/components/app/page-header";
import { loadConsulting, loadConsultingIncome, type ConsultingData } from "@/lib/consulting";
import { monthBounds } from "@/lib/calc/dates";
import { DB_UPDATE_FILE_0011 } from "@/lib/schema-guard";
import { loadDealFunnel, resolveFunnelWindow } from "@/lib/deal-funnel";
import { DealFunnelCard } from "@/components/app/deal-funnel-card";
import { CountButtons } from "@/components/app/listing-buttons";

export default async function PipelinePage({ params, searchParams }: { params: Promise<{ pipelineId: string }>; searchParams: Promise<{ closed?: string; view?: string; funnel?: string }> }) {
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
  const detailTable = pipe.kind === "acquisition" ? "deal_financials_calculated" : pipe.kind === "job" ? "job_details" : pipe.kind === "investor" ? "investor_details" : pipe.kind === "consulting" ? "consulting_details" : null;
  if (detailTable && itemIds.size) {
    const { data } = await supabase.from(detailTable).select("*").in("item_id", [...itemIds]);
    extra = Object.fromEntries(((data ?? []) as Row[]).map((d) => [d.item_id, d]));
  }
  const status = await loadPipelineStatus(supabase, items, { ownerId, tz: ctx.tz, today: ctx.today, stages: allStages });
  const isAcq = pipe.kind === "acquisition";
  const isConsulting = pipe.kind === "consulting";
  const consulting = isConsulting ? await loadConsulting(supabase, { ownerId, today: ctx.today }) : null;
  const cItem = Object.fromEntries((consulting?.items ?? []).map((c) => [c.item.id, c]));
  const month = monthBounds(ctx.today);
  const funnel = isAcq ? await loadDealFunnel(supabase, { ownerId, tz: ctx.tz, today: ctx.today, pipelineId, days: resolveFunnelWindow(sp.funnel) }) : null;
  const listings = funnel?.listings ?? null;
  const incomeThisMonth = isConsulting && consulting?.available ? await loadConsultingIncome(supabase, { ownerId, from: month.start, to: month.end, itemIds: consulting.items.map((c) => c.item.id) }) : null;
  const jar = await cookies();
  const closedCookie = pipelineClosedCookie(pipelineId);
  const view = resolvePipelineView(sp.view);
  const showClosed = resolveShowClosed(sp.closed, jar.get(closedCookie)?.value);
  const listView = view === "list";
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
    // The list is the default, so it is left out of the address; the board keeps ?view=board.
    const q = new URLSearchParams({ view: view === "board" ? "board" : "", funnel: sp.funnel === "90" ? "90" : "", ...p });
    for (const [k, v] of [...q.entries()]) if (!v || (k === "view" && v === "list") || (k === "funnel" && v === "30")) q.delete(k);
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
            {listings ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2" data-testid="header-listings">
                <span className="text-sm text-slate-700">
                  {listings.target.name} today:{" "}
                  <span className={cn("tabular font-semibold", listings.today.status === "met" ? "text-status-met" : "text-slate-900")} data-testid="header-listings-count">
                    {listings.today.status === "off" ? `${listings.today.count} (not an active day)` : `${listings.today.count} of ${listings.today.required}`}
                  </span>
                </span>
                <CountButtons targetId={listings.target.id} back={`/opportunities/${pipelineId}`} label={listings.target.name} />
              </div>
            ) : null}
            <div className="flex rounded-md border border-border bg-white p-0.5" role="group" aria-label="View">
              <Button asChild size="sm" variant={listView ? "default" : "ghost"} className="h-7">
                <Link href={href({ view: "list" })} aria-current={listView ? "page" : undefined}>
                  List
                </Link>
              </Button>
              <Button asChild size="sm" variant={listView ? "ghost" : "default"} className="h-7">
                <Link href={href({ view: "board" })} aria-current={listView ? undefined : "page"}>
                  Board
                </Link>
              </Button>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={href({ closed: showClosed ? "0" : "1" })}>{showClosed ? "Hide closed stages" : `Show closed stages (${closedCount})`}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/records/pipeline_items/new?pipeline_id=${pipelineId}&stage_id=${stageList[0]?.id ?? ""}`}>Add item</Link>
            </Button>
          </>
        }
      />
      <RememberPipelineView closedCookie={closedCookie} showClosed={showClosed} />
      <div className="mb-4 flex flex-col gap-4">
        {!status.available ? <DbUpdateNotice compact /> : null}
        {isConsulting && consulting ? <ConsultingStrip data={consulting} incomeThisMonth={incomeThisMonth?.total ?? 0} pipelineId={pipelineId} /> : null}
        {funnel ? <DealFunnelCard data={funnel} hrefFor={(d) => href({ funnel: String(d) })} /> : null}
        {isAcq ? <DealSourceStrip items={items} stages={allStages.filter((s) => s.outcome === "open")} tz={ctx.tz} today={ctx.today} available={status.available} /> : null}
        {stalledCount || overCount ? (
          <p className="text-sm text-muted-foreground">
            {stalledCount ? <span className="font-medium text-status-soon">{stalledCount} stalled</span> : null}
            {stalledCount && overCount ? ", " : null}
            {overCount ? <span className="font-medium text-status-missed">{overCount} over the stage time limit</span> : null}. Stalled = no stage change and no activity for {status.stallDays} days or more.
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
                    <TH className={isConsulting ? "w-[22%]" : "w-[20%]"}>{isConsulting ? "Item and client" : "Item"}</TH>
                    {isAcq ? <TH className="w-[8.5rem]">Source</TH> : null}
                    {isConsulting ? <TH className="w-[6.5rem] text-right">Per month</TH> : null}
                    <TH className="w-[8.5rem]">Stage</TH>
                    <TH className="w-[7.5rem] text-right">Days in stage</TH>
                    <TH>Next action</TH>
                    <TH className="w-[5.5rem]">Due</TH>
                    <TH className={isConsulting ? "w-[9rem]" : "w-[11rem]"}>Flags</TH>
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
                          {isConsulting ? <span className="clamp-1 text-xs text-muted-foreground">{i.organization_id ? orgName[i.organization_id] : "Client not set"}</span> : null}
                        </TD>
                        {isAcq ? (
                          <TD>
                            <DealSourceBadge type={i.deal_source_type} showUnset />
                          </TD>
                        ) : null}
                        {isConsulting ? (
                          <TD className="tabular text-right">
                            {cItem[i.id]?.expectedMonthly === null || cItem[i.id]?.expectedMonthly === undefined ? (
                              <span className="text-muted-foreground">Not set</span>
                            ) : (
                              <span className="flex flex-col items-end leading-tight">
                                {money(cItem[i.id].expectedMonthly)}
                                <span className="text-[11px] text-muted-foreground">{cItem[i.id].probabilityPct}% chance</span>
                              </span>
                            )}
                          </TD>
                        ) : null}
                        <TD>
                          <span className="clamp-2">{stageName[i.stage_id] ?? "None"}</span>
                        </TD>
                        <TD className="tabular text-right">{daysText(st)}</TD>
                        <TD className={i.next_action ? "" : "font-medium text-status-soon"}>
                          <span className="clamp-2">{i.next_action ?? "Set the next action"}</span>
                        </TD>
                        <TD className={cn("tabular whitespace-nowrap", i.status === "open" && dueClass(i.next_action_due, ctx.today))}>{i.next_action_due ? fmtDate(i.next_action_due, "MMM d") : "Not set"}</TD>
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
        // Board: all stage columns share the page width on desktop (1024px and up, min 6rem each, so 9 stages fit at 1280);
        // on narrow screens the board scrolls sideways inside this box, never the page.
        <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" role="region" aria-label={`${pipe.name} board`} tabIndex={0}>
          <div
            className="grid gap-2 [--col-min:13rem] lg:[--col-min:6rem]"
            style={{ gridTemplateColumns: `repeat(${stageList.length}, minmax(var(--col-min), 1fr))` }}
          >
            {stageList.map((s) => {
              const its = items.filter((i) => i.stage_id === s.id);
              const avg = avgDays(s.id);
              return (
                <section key={s.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-slate-50/80" aria-label={s.name}>
                  <div className="flex flex-col gap-0.5 border-b border-slate-200 px-2 py-2">
                    <div className="flex items-start justify-between gap-1">
                      <h3 className="clamp-2 min-h-8 text-xs font-semibold leading-4 text-slate-900">{s.name}</h3>
                      <Badge variant={s.outcome === "won" ? "success" : s.outcome === "lost" ? "neutral" : "outline"} className="px-1.5">
                        {its.length}
                      </Badge>
                    </div>
                    <p className="clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
                      {s.max_days_in_stage ? `Limit ${s.max_days_in_stage} days. ` : ""}
                      {avg === null ? "No completed stays yet" : `Average ${avg} days`}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 p-1.5">
                    {its.map((i) => {
                      const overdue = i.next_action_due && i.next_action_due < ctx.today;
                      const d = extra[i.id];
                      const st = status.byItem[i.id];
                      const money1 =
                        d && isAcq && d.asking_price
                          ? `Asking ${money(d.asking_price)}${d.ebitda_multiple ? `, ${Number(d.ebitda_multiple).toFixed(1)}x` : ""}`
                          : d && pipe.kind === "job" && d.salary
                            ? `Salary ${money(d.salary)}`
                            : d && pipe.kind === "investor" && (d.amount_committed || d.amount_discussed)
                              ? d.amount_committed
                                ? `Committed ${money(d.amount_committed)}`
                                : `Discussed ${money(d.amount_discussed)}`
                              : isConsulting && cItem[i.id]?.expectedMonthly !== null && cItem[i.id]?.expectedMonthly !== undefined
                                ? `${money(cItem[i.id].expectedMonthly)} per month, ${cItem[i.id].probabilityPct}%`
                                : null;
                      return (
                        <Link key={i.id} href={`/records/pipeline_items/${i.id}`} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-white p-2 shadow-xs hover:border-primary">
                          <span className="clamp-2 text-[13px] font-medium leading-4 text-slate-900">{i.name}</span>
                          {i.organization_id ? <span className="clamp-1 text-[11px] leading-4 text-muted-foreground">{orgName[i.organization_id]}</span> : null}
                          {money1 ? <span className="clamp-1 text-[11px] leading-4 text-slate-600">{money1}</span> : null}
                          {(isAcq && i.deal_source_type) || st?.stalled || st?.limit?.over ? (
                            <span className="flex flex-wrap gap-1 [&_span]:whitespace-normal [&_span]:rounded-md [&_span]:px-1.5 [&_span]:text-[11px] [&_span]:leading-4">
                              {isAcq ? <DealSourceBadge type={i.deal_source_type} /> : null}
                              <ItemStatusBadges status={st} itemStatus={i.status} />
                            </span>
                          ) : null}
                          <span className={cn("clamp-2 text-[11px] leading-4", overdue ? "font-medium text-status-missed" : i.next_action ? "text-slate-700" : "font-medium text-status-soon")}>
                            {i.next_action ?? "Set the next action"}
                          </span>
                          {i.next_action_due ? (
                            <span className={cn("tabular clamp-1 text-[11px] leading-4", overdue ? "font-medium text-status-missed" : i.next_action_due === ctx.today ? "font-medium text-status-soon" : "text-muted-foreground")}>
                              {overdue ? `Overdue: ${fmtDate(i.next_action_due, "MMM d")}` : i.next_action_due === ctx.today ? "Due today" : `Due ${fmtDate(i.next_action_due, "MMM d")}`}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                    {!its.length ? <p className="py-2 text-center text-[11px] text-muted-foreground">No items</p> : null}
                  </div>
                </section>
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

/**
 * Counts of proprietary and brokered deals: sourced this week, active deals per stage, and "Active (all stages)"
 * (deals not won or passed), which is the total of the stage columns, so it comes last after a thin divider.
 * Numbers are centered under their headings in equal columns, so no number sits far from its heading.
 */
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
  const num = "tabular px-2 py-2 text-center";
  return (
    <Card data-testid="deal-source">
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-2">
        <CardTitle>Deal source</CardTitle>
        <p className="text-sm text-slate-700">
          Proprietary share of active deals: <span className="tabular font-semibold text-gold-strong">{share === null ? "No active deals" : `${share}%`}</span>
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[8rem]" />
              <col />
              {stages.map((s) => (
                <col key={s.id} />
              ))}
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-xs text-slate-600">
                <th className="py-2 pr-2 text-left align-bottom font-medium">Type</th>
                <th className="border-r border-slate-200 px-2 py-2 text-center align-bottom font-medium">
                  <span className="clamp-2">Sourced this week</span>
                </th>
                {stages.map((s) => (
                  <th key={s.id} className="px-2 py-2 text-center align-bottom font-medium" title={s.name}>
                    <span className="clamp-2">{s.name}</span>
                  </th>
                ))}
                <th className="border-l border-slate-200 px-2 py-2 text-center align-bottom font-semibold text-slate-800" title="Deals not won or passed, in every stage: the total of the stage columns">
                  <span className="clamp-2">Active (all stages)</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.key || "unset"} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-2">{t.key ? <DealSourceBadge type={t.key} /> : <span className="text-muted-foreground">{t.label}</span>}</td>
                  <td className={cn(num, "border-r border-slate-200 font-semibold")}>{items.filter((i) => is(i, t.key) && createdThisWeek(i)).length}</td>
                  {stages.map((s) => {
                    const n = open.filter((i) => is(i, t.key) && i.stage_id === s.id).length;
                    return (
                      <td key={s.id} className={cn(num, n ? "text-slate-900" : "text-slate-400")}>
                        {n}
                      </td>
                    );
                  })}
                  <td className={cn(num, "border-l border-slate-200 font-semibold")}>{open.filter((i) => is(i, t.key)).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
      <CardNote>Proprietary = off-market, found directly. Brokered = listed by a broker. Active = not won or passed.</CardNote>
    </Card>
  );
}

/** Consulting pipeline: pipeline value, signed income, active engagements, income received this month, items by stage. */
function ConsultingStrip({ data, incomeThisMonth, pipelineId }: { data: ConsultingData; incomeThisMonth: number; pipelineId: string }) {
  if (!data.available) return <DbUpdateNotice compact file={DB_UPDATE_FILE_0011} />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Consulting income</CardTitle>
        </CardHeader>
        <CardContent>
          <StatGrid className="grid-cols-2 sm:grid-cols-4">
            <Stat label="Pipeline value per month" value={money(data.pipelineValue)} hint="Weighted by chance" />
            <Stat label="Signed work per month" value={money(data.signedMonthly)} hint="Signed and Active" />
            <Stat label="Signed or active engagements" value={data.activeEngagements} />
            <Stat label="Received this month" value={money(incomeThisMonth)} tone={incomeThisMonth ? "good" : undefined} />
          </StatGrid>
        </CardContent>
        <CardNote>
          Expected monthly income is calculated from each item&apos;s rate type and rate. Payments are linked in{" "}
          <Link href="/finance/income" className="underline">
            Finance, Income Received
          </Link>
          .
        </CardNote>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Open items by stage</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-x-4 divide-slate-100 text-sm">
            {data.byStage
              .filter((s) => data.pipelines.some((p) => p.id === pipelineId) && data.stages.some((st) => st.id === s.stage_id && st.pipeline_id === pipelineId))
              .map((s) => (
                <li key={s.stage_id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5">
                  <span className="clamp-1 text-slate-700">{s.name}</span>
                  <span className="tabular font-semibold">{s.count}</span>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

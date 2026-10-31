import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO, weekBounds } from "@/lib/calc/dates";
import { rangeTotals } from "@/lib/calc/targets";
import { loadOutreachStats, loadTargets, summarizeTargets, todayBreakdown } from "@/lib/targets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHeader } from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { TargetCard } from "@/components/app/target-card";
import { saveTargetMissReason } from "@/app/actions/targets";
import { DailyCountStrip } from "@/components/app/listing-buttons";
import { SuggestedTargets } from "@/components/app/deal-funnel-card";
import { listingsTarget, loadDealPlan } from "@/lib/deal-funnel";
import { COUNT_SOURCE_OPTIONS } from "@/lib/resources";
import { date as fmtDate } from "@/lib/format";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { SuggestionLine } from "@/components/app/suggestion-line";
import { targetSuggestion } from "@/lib/suggestions";
import { firstSuggestion } from "@/lib/suggestions-server";

export const metadata = { title: "Targets" };

const SOURCE_SHORT: Record<string, string> = {
  communications_outreach: "Counts outreach logged",
  pipeline_items_created: "Counts pipeline items added",
  deals_sourced: "Counts new acquisition items added (proprietary and brokered)",
  deals_advanced:
    "Counts each deal once per day when it moved to NDA signed or later, or a CIM request or a source contact was logged on it",
  cims_reviewed: "Counts each deal once, on the day it first moved to CIM review or a later stage (not the stage it was added in)",
  deal_calls: "Counts calls and meetings logged on acquisition deals, one per deal per day",
  manual: "Counted with the +1 and +5 buttons (a note is optional)",
};

/** Count sources of the deal targets: the suggested targets line is shown above the first of them. */
const DEAL_SOURCES = ["deals_sourced", "deals_advanced", "cims_reviewed", "deal_calls"];

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const today = ctx.today;
  const [data, outreach30] = await Promise.all([
    loadTargets(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -182), to: today, includeInactive: true }),
    loadOutreachStats(supabase, { ownerId, tz: ctx.tz, from: addDaysISO(today, -29), to: today }),
  ]);
  const summaries = summarizeTargets(data, today);
  const listing = listingsTarget(summaries);
  const isDeal = (t: (typeof summaries)[number]["target"]) => DEAL_SOURCES.includes(t.count_source) || t.id === listing?.target.id;
  const firstDeal = summaries.find((s) => isDeal(s.target))?.target.id;
  const plan = data.available && firstDeal ? await loadDealPlan(supabase, { ownerId, targets: data }) : null;
  const suggestion = await firstSuggestion([targetSuggestion(summaries, today)]);
  const deals30 = Object.fromEntries(data.targets.map((t) => [t.id, todayBreakdown(data, t.id, addDaysISO(today, -29), today)]));
  const week = weekBounds(today);
  const reasonFrom = addDaysISO(today, -14);
  const needReason = summaries.flatMap((s) =>
    s.history
      .filter((h) => h.status === "missed" && h.start >= reasonFrom && !data.misses.some((m) => m.target_id === s.target.id && m.period_start === h.start && m.reason))
      .map((h) => ({ target: s.target, h })),
  );

  return (
    <div>
      <PageHeader
        title="Targets"
        description="A target is a minimum count of an activity per day or per week. Counts are read from the records (outreach logged, deals added or moved, calls logged) or from the +1 and +5 buttons."
        actions={
          data.available ? (
            <Button asChild size="sm">
              <Link href="/records/targets/new">
                <Plus /> Add target
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {suggestion ? <SuggestionLine s={suggestion} context={{ label: "Targets" }} /> : null}
        {sp.notice ? <Notice tone={sp.notice.startsWith("Database update") ? "warn" : "success"}>{sp.notice}</Notice> : null}
        {!data.available ? <DbUpdateNotice /> : null}
        {data.error ? <Notice tone="error">Targets could not be read: {data.error}</Notice> : null}
        {data.available && !summaries.length ? (
          <EmptyState title="No targets yet." body="Add a target such as 3 outreach messages per weekday." action={<Button asChild size="sm"><Link href="/records/targets/new">Add target</Link></Button>} />
        ) : null}

        {summaries.map((s) => {
          const t = s.target;
          const weekTotals = rangeTotals(t.def, data.counts[t.id] ?? {}, week.start, week.end, addDaysISO(today, -1));
          return (
            <div key={t.id} className="contents">
            {plan && t.id === firstDeal ? <SuggestedTargets plan={plan} /> : null}
            <TargetCard
              s={s}
              today={today}
              week={t.period === "day" ? weekTotals : null}
              outreach30={t.count_source === "communications_outreach" ? outreach30 : null}
              deals30={deals30[t.id] ?? null}
              counter={t.count_source === "manual" && t.active ? <DailyCountStrip targetId={t.id} name={t.name} back="/accountability/targets" /> : null}
              footnote={`${SOURCE_SHORT[t.count_source] ?? COUNT_SOURCE_OPTIONS.find((o) => o.value === t.count_source)?.label}. Counting since ${fmtDate(t.def.start_date)}.`}
              actions={
                <>
                  {t.count_source === "deal_calls" || t.count_source === "cims_reviewed" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}` : "/opportunities"}>Open deals</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "communications_outreach" ? (
                    <Button asChild size="sm">
                      <Link href="/people/outreach">Log outreach</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "deals_sourced" && t.pipeline_id ? (
                    <Button asChild size="sm">
                      <Link href={`/records/pipeline_items/new?pipeline_id=${t.pipeline_id}`}>Add a deal</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "deals_advanced" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}` : "/opportunities"}>Open deals</Link>
                    </Button>
                  ) : null}
                  {t.count_source === "pipeline_items_created" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}` : "/opportunities"}>Open pipeline</Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/records/targets/${t.id}?edit=1`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                </>
              }
            />
            </div>
          );
        })}

        {data.available && summaries.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Missed in the last 14 days, no reason yet {needReason.length ? <Badge variant="danger">{needReason.length}</Badge> : null}</CardTitle>
              <CardDescription>The daily close asks for these. You can also give the one-line reason here.</CardDescription>
            </CardHeader>
            <CardContent>
              {needReason.length ? (
                <div className="@container flex flex-col divide-y divide-slate-100">
                  {needReason.map(({ target, h }) => (
                    <GuardedForm
                      key={`${target.id}:${h.start}`}
                      action={saveTargetMissReason}
                      className="grid grid-cols-1 items-center gap-2 py-2 @md:grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,11rem)_11rem_minmax(12rem,1fr)_auto]"
                    >
                      <input type="hidden" name="target_id" value={target.id} />
                      <input type="hidden" name="period_start" value={h.start} />
                      <input type="hidden" name="period_end" value={h.end} />
                      <input type="hidden" name="actual_count" value={h.count} />
                      <input type="hidden" name="required_count" value={h.required} />
                      <input type="hidden" name="back" value="/accountability/targets" />
                      <span className="clamp-1 text-sm font-medium">{target.name}</span>
                      <span className="tabular whitespace-nowrap text-sm text-muted-foreground">
                        {fmtDate(h.start, target.period === "week" ? "'Week of' MMM d" : "EEE MMM d")}, {h.count} of {h.required}
                      </span>
                      <Input name="reason" required maxLength={200} placeholder="One-line reason" aria-label={`Reason for ${target.name} on ${h.start}`} />
                      <SubmitButton size="sm" variant="outline">
                        Save
                      </SubmitButton>
                    </GuardedForm>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Every missed period in the last 14 days has a reason.</p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

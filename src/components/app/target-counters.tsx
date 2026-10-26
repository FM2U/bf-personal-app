import Link from "next/link";
import { Progress } from "@/components/app/charts";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { DbUpdateNotice } from "@/components/app/target-grid";
import { addTargetEntry } from "@/app/actions/targets";
import { describeTarget } from "@/lib/calc/targets";
import type { TargetSummary } from "@/lib/targets";
import { cn } from "@/lib/utils";
import { GuardedForm } from "@/components/app/unsaved-changes";

/** Today's target counters (Productivity, Today). Each tile: count of required, a bar, and the action that adds to the count. */
export function TargetCounters({ available, summaries, back }: { available: boolean; summaries: TargetSummary[]; back: string }) {
  if (!available) return <DbUpdateNotice compact />;
  const shown = summaries.filter((s) => s.target.active);
  if (!shown.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No daily targets yet.{" "}
        <Link href="/records/targets/new" className="text-teal-800 underline">
          Add a target
        </Link>
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {shown.map((s) => {
        const t = s.target;
        const off = s.today.status === "off";
        const met = s.today.status === "met";
        return (
          <div key={t.id} className={cn("flex min-w-0 flex-col gap-2 rounded-lg border bg-white p-3", met ? "border-emerald-300" : "border-border")}>
            <div className="min-w-0">
              <Link href="/accountability/targets" className="clamp-1 text-sm font-medium text-slate-900 hover:underline">
                {t.name}
              </Link>
              <p className="clamp-1 text-xs text-muted-foreground">{describeTarget(t.def)}</p>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={cn("tabular text-2xl font-semibold leading-none", met ? "text-emerald-700" : "text-slate-900")}>
                {off ? "Not today" : `${s.today.count} of ${s.today.required}`}
              </span>
              <span className={cn("clamp-1 text-xs", met ? "text-emerald-700" : "text-muted-foreground")}>
                {off ? "Inactive day" : met ? "Met" : `${s.today.required - s.today.count} to go${t.period === "week" ? " this week" : ""}`}
              </span>
            </div>
            <Progress value={off ? 0 : (s.today.count / s.today.required) * 100} tone={met ? "teal" : "amber"} />
            {s.breakdown ? (
              <p className="clamp-1 text-xs text-slate-700">
                <span className="font-medium text-emerald-700">{s.breakdown.proprietary} proprietary</span>, {s.breakdown.brokered} brokered
                {s.breakdown.notSet ? `, ${s.breakdown.notSet} not set` : ""}
              </p>
            ) : null}
            <div className="mt-auto pt-1">
              {t.count_source === "manual" ? (
                <GuardedForm action={addTargetEntry}>
                  <input type="hidden" name="target_id" value={t.id} />
                  <input type="hidden" name="back" value={back} />
                  <SubmitButton size="sm" variant="outline" className="w-full" pendingText="Adding...">
                    +1
                  </SubmitButton>
                </GuardedForm>
              ) : t.count_source === "communications_outreach" ? (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href="/people/outreach">Log outreach</Link>
                </Button>
              ) : t.count_source === "deals_sourced" && t.pipeline_id ? (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href={`/records/pipeline_items/new?pipeline_id=${t.pipeline_id}`}>Add a deal</Link>
                </Button>
              ) : t.count_source === "deals_advanced" ? (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}?view=list` : "/opportunities"}>Open deals</Link>
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href={t.pipeline_id ? `/opportunities/${t.pipeline_id}` : "/opportunities"}>Add a pipeline item</Link>
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

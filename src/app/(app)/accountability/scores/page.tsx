import { requireOwner } from "@/lib/auth";
import { loadCtx } from "@/lib/engine/helpers";
import { addDaysISO, monthBounds, quarterBounds, weekBounds } from "@/lib/calc/dates";
import { combineScores, completionScore, consecutiveCompleteDays } from "@/lib/calc/scores";
import { scoreText } from "@/lib/calc/commitment-rule";
import { loadTargets, targetCommitmentTally } from "@/lib/targets";
import { Card, CardContent, CardDescription, CardHeader, CardNote, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat, StatGrid } from "@/components/app/page-header";
import { BarSeriesChart } from "@/components/app/charts";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

export const metadata = { title: "Completion scores" };

export default async function ScoresPage() {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const since = addDaysISO(ctx.today, -400);
  const [{ data: commitments }, { data: tasks }] = await Promise.all([
    supabase.from("commitments").select("due_date,status"),
    supabase.from("tasks").select("due_date,status").gte("due_date", since).lte("due_date", ctx.today).limit(5000),
  ]);
  const targets = await loadTargets(supabase, { ownerId, tz: ctx.tz, from: quarterBounds(ctx.today).start, to: ctx.today });
  const cs = (commitments ?? []) as { due_date: string; status: "open" }[];
  const ts = (tasks ?? []) as Row[] as { due_date: string; status: string }[];
  const periods = [
    { label: "Today", ...{ start: ctx.today, end: ctx.today } },
    { label: "This week", ...weekBounds(ctx.today) },
    { label: "This month", ...monthBounds(ctx.today) },
    { label: "This quarter", ...quarterBounds(ctx.today) },
  ];
  const streak = consecutiveCompleteDays(ts, ctx.today);
  const days = Array.from({ length: 30 }, (_, i) => addDaysISO(ctx.today, i - 29));
  const chart = days.map((d) => {
    const dayTasks = ts.filter((t) => t.due_date === d);
    return { day: fmtDate(d, "MMM d"), done: dayTasks.filter((t) => t.status === "done").length, notDone: dayTasks.filter((t) => t.status !== "done").length };
  });
  return (
    <div>
      <PageHeader title="Completion scores" description="Percentage of commitments met per day, week, month, and quarter, and the number of consecutive days with every daily task done. Commitments are pipeline next actions, milestones marked as commitments, daily targets, and the scheduled reviews." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {periods.map((p) => {
          // Commitments plus daily target periods marked as commitments (today stays open until it is over).
          const s = combineScores(completionScore(cs, p.start, p.end), targetCommitmentTally(targets, p.start, p.end, addDaysISO(ctx.today, -1)));
          return (
            <Card key={p.label}>
              <CardHeader>
                <CardDescription>{p.label}</CardDescription>
                <CardTitle className="tabular text-3xl">{scoreText(s.pct)}</CardTitle>
              </CardHeader>
              <CardContent>
<StatGrid>
                <Stat label="Met" value={s.met} />
                <Stat label="Missed" value={s.missed} tone={s.missed ? "bad" : undefined} />
              </StatGrid>
</CardContent>
            </Card>
          );
        })}
        <Card>
          <CardHeader>
            <CardTitle className="tabular text-3xl">{streak}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Days with no tasks due do not break the count.</p>
          </CardContent>
          <CardNote>Consecutive days with every task done</CardNote>
        </Card>
        <Card className="md:col-span-2 xl:col-span-5">
          <CardHeader>
            <CardTitle>Tasks done per day, last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            <BarSeriesChart valueFormat="count" data={chart} xKey="day" series={[{ key: "done", label: "Done", color: "#0f766e" }, { key: "notDone", label: "Not done", color: "#fca5a5" }]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

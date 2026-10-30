import "server-only";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { completionScore, MISSED_STATUSES } from "@/lib/calc/scores";
import { PERIOD_DAYS, TEMPLATE_PERIODS, type PeriodData, type SavedMeasures, type TemplatePeriod } from "@/lib/calc/partner-report";
import { fetchAll } from "@/lib/data";
import { scoped } from "@/lib/finance";
import { loadOutreachStats, loadTargets, targetTotals } from "@/lib/targets";
import type { Row } from "@/lib/types";
import type { Ctx } from "./helpers";

/**
 * The numbers every partner report template can show, saved in the report (snapshot.measures) for a week, two weeks,
 * and a month ending on the report date. Saved once with the draft (and added at finalize to a draft made before
 * templates), so the report never changes after it is finalized, whichever template is chosen at send time.
 * Every part is read on its own and skipped when it fails (for example a table from a database update not yet run).
 */

type Ok<T> = T | undefined;
const attempt = async <T,>(fn: () => Promise<T>): Promise<Ok<T>> => {
  try {
    return await fn();
  } catch {
    return undefined;
  }
};

export async function buildReportMeasures(ctx: Pick<Ctx, "sb" | "ownerId" | "tz">, end: string, runway: { months: number | null; target: number | null } | null): Promise<SavedMeasures> {
  const { sb, ownerId, tz } = ctx;
  const widest = addDaysISO(end, -(PERIOD_DAYS.month - 1));
  const localDate = (ts: string | null | undefined) => (ts ? todayInTz(tz, new Date(ts)) : null);
  const tsFrom = `${addDaysISO(widest, -1)}T00:00:00Z`;

  const [commitments, doneTasks, overdue, targets, milestones, moves, acqItems] = await Promise.all([
    attempt(async () => (await fetchAll((a, b) => scoped(sb.from("commitments").select("id,title,due_date,status"), ownerId).gte("due_date", widest).lte("due_date", end).range(a, b))) as Row[]),
    attempt(async () => (await fetchAll((a, b) => scoped(sb.from("tasks").select("completed_at"), ownerId).eq("status", "done").gte("completed_at", tsFrom).range(a, b))) as Row[]),
    attempt(async () => {
      const { count, error } = await scoped(sb.from("tasks").select("id", { count: "exact", head: true }), ownerId).eq("status", "todo").lt("due_date", end);
      if (error) throw error;
      return count ?? 0;
    }),
    attempt(async () => loadTargets(sb, { ownerId, tz, from: addDaysISO(widest, -120), to: end })),
    attempt(async () => (await fetchAll((a, b) => scoped(sb.from("milestones").select("title,status,due_date"), ownerId).gte("due_date", widest).lte("due_date", end).range(a, b))) as Row[]),
    attempt(async () => loadMoves(ctx, widest, end, localDate)),
    attempt(async () => {
      const { data: pipes } = await scoped(sb.from("pipelines").select("id"), ownerId).eq("kind", "acquisition");
      const ids = ((pipes ?? []) as Row[]).map((p) => p.id);
      if (!ids.length) return [] as string[];
      const rows = (await fetchAll((a, b) => scoped(sb.from("pipeline_items").select("created_at"), ownerId).in("pipeline_id", ids).gte("created_at", tsFrom).range(a, b))) as Row[];
      return rows.map((r) => localDate(r.created_at)).filter(Boolean) as string[];
    }),
  ]);

  const out: SavedMeasures = {};
  for (const period of TEMPLATE_PERIODS as TemplatePeriod[]) {
    const start = addDaysISO(end, -(PERIOD_DAYS[period] - 1));
    const inRange = (d: string | null | undefined) => !!d && d >= start && d <= end;
    const d: PeriodData = { start, end };
    if (commitments) {
      const score = completionScore(commitments as { due_date: string; status: "open" }[], start, end);
      d.commitments = {
        met: score.met,
        missed: score.missed,
        pct: score.pct,
        missedTitles: commitments.filter((c) => inRange(c.due_date) && MISSED_STATUSES.includes(String(c.status))).map((c) => String(c.title)).slice(0, 10),
      };
    }
    if (doneTasks && overdue !== undefined) d.tasks = { done: doneTasks.filter((t) => inRange(localDate(t.completed_at))).length, overdue };
    if (targets?.available) {
      d.targets = targetTotals(targets, start, end, end).map((t) => {
        const row = targets.targets.find((x) => x.id === t.id);
        return { name: t.name, source: String(row?.count_source ?? ""), period: t.period === "week" ? "week" : "day", total: t.total, required: t.required, met: t.met, missed: t.missed, pct: t.pct };
      });
    }
    const outreach = await attempt(() => loadOutreachStats(sb, { ownerId, tz, from: start, to: end }));
    if (outreach) d.outreach = { sent: outreach.sent, replyRatePct: outreach.replyRatePct, meetings: outreach.meetings };
    if (acqItems) d.dealsSourced = acqItems.filter(inRange).length;
    if (moves) {
      const counts = new Map<string, number>();
      for (const m of moves.list) if (inRange(m.date)) counts.set(m.pipeline, (counts.get(m.pipeline) ?? 0) + 1);
      d.moves = moves.pipelines.map((name) => ({ pipeline: name, count: counts.get(name) ?? 0 }));
    }
    if (runway) d.runway = runway;
    if (milestones) {
      const due = milestones.filter((m) => inRange(m.due_date) && m.status !== "cancelled");
      d.milestones = {
        due: due.length,
        met: due.filter((m) => m.status === "met").length,
        missed: due.filter((m) => m.status === "missed").length,
        missedTitles: due.filter((m) => m.status === "missed").map((m) => String(m.title)).slice(0, 10),
      };
    }
    out[period] = d;
  }
  return out;
}

/**
 * Stage moves per pipeline: stage history entries in the period, not counting the entry made when the item was created
 * (the first entry of each item). Every pipeline is listed (in its order), also with 0 moves.
 */
async function loadMoves(ctx: Pick<Ctx, "sb" | "ownerId">, from: string, end: string, localDate: (ts: string | null | undefined) => string | null) {
  const { sb, ownerId } = ctx;
  const [{ data: pipes }, items, history] = await Promise.all([
    scoped(sb.from("pipelines").select("id,name,sort_order"), ownerId).order("sort_order"),
    fetchAll((a, b) => scoped(sb.from("pipeline_items").select("id,pipeline_id"), ownerId).range(a, b)),
    fetchAll((a, b) => scoped(sb.from("stage_history").select("item_id,entered_at"), ownerId).order("entered_at").range(a, b)),
  ]);
  const pipeName = new Map(((pipes ?? []) as Row[]).map((p) => [p.id, String(p.name)]));
  const itemPipe = new Map((items as Row[]).map((i) => [i.id, i.pipeline_id]));
  const seen = new Set<string>();
  const list: { pipeline: string; date: string }[] = [];
  for (const h of history as Row[]) {
    if (!seen.has(h.item_id)) {
      seen.add(h.item_id);
      continue;
    }
    const date = localDate(h.entered_at);
    const name = pipeName.get(itemPipe.get(h.item_id));
    if (date && name && date >= from && date <= end) list.push({ pipeline: name, date });
  }
  return { pipelines: [...pipeName.values()], list };
}

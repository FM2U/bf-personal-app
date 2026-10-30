import "server-only";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import { buildDayDetail, type DayDetail, type Outcome } from "@/lib/calc/today";
import { loadTargets, summarizeTargets } from "@/lib/targets";
import { hasUpdate0019 } from "@/lib/update-0019";
import { fetchAll } from "@/lib/data";
import type { Row } from "@/lib/types";
import type { Ctx } from "./helpers";

/** A daily_outcomes row as the app uses it. */
export function toOutcome(r: Row): Outcome {
  return {
    id: String(r.id),
    position: Number(r.position),
    title: String(r.title ?? ""),
    initiativeId: (r.initiative_id as string | null) ?? null,
    pipelineItemId: (r.pipeline_item_id as string | null) ?? null,
    taskId: (r.task_id as string | null) ?? null,
    blockMinutes: r.block_minutes === null || r.block_minutes === undefined ? null : Number(r.block_minutes),
    status: (r.status as Outcome["status"]) ?? "planned",
    resultNote: String(r.result_note ?? ""),
    actualMinutes: r.actual_minutes === null || r.actual_minutes === undefined ? null : Number(r.actual_minutes),
  };
}

/**
 * The daily report content for one day (saved with each daily partner report as snapshot.day): the planned outcomes
 * with their status, and progress by initiative (activity counts against targets, tasks done, pipeline items moved
 * stage, passes, outreach), plus what changed and tomorrow's priority from the daily plan. Null before database
 * update 0019. Every part is read on its own and skipped when it fails.
 */
export async function buildDayDetailFor(ctx: Pick<Ctx, "sb" | "ownerId" | "tz">, day: string): Promise<DayDetail | null> {
  const { sb, ownerId, tz } = ctx;
  if (!(await hasUpdate0019(sb))) return null;
  const localDate = (ts: string | null | undefined) => (ts ? todayInTz(tz, new Date(ts)) : null);
  const tsFrom = `${addDaysISO(day, -1)}T00:00:00Z`;
  const tsTo = `${addDaysISO(day, 1)}T23:59:59Z`;
  const attempt = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const [outcomes, plan, initiatives, pipelines, items, doneTasks, history, stages, outreach, targets] = await Promise.all([
    attempt(async () => ((await sb.from("daily_outcomes").select("*").eq("owner_id", ownerId).eq("plan_date", day).order("position")).data ?? []) as Row[], [] as Row[]),
    attempt(async () => ((await sb.from("daily_plans").select("focused_hours,changes_note,tomorrow_priority").eq("owner_id", ownerId).eq("plan_date", day).maybeSingle()).data ?? null) as Row | null, null),
    attempt(async () => ((await sb.from("initiatives").select("id,name,sort_order").eq("owner_id", ownerId).eq("is_active", true).order("sort_order").order("name")).data ?? []) as Row[], [] as Row[]),
    attempt(async () => ((await sb.from("pipelines").select("id,initiative_id").eq("owner_id", ownerId)).data ?? []) as Row[], [] as Row[]),
    attempt(async () => fetchAll((a, b) => sb.from("pipeline_items").select("id,name,pipeline_id").eq("owner_id", ownerId).range(a, b)) as Promise<Row[]>, [] as Row[]),
    attempt(async () => ((await sb.from("tasks").select("id,initiative_id,pipeline_item_id,completed_at").eq("owner_id", ownerId).eq("status", "done").gte("completed_at", tsFrom).lte("completed_at", tsTo)).data ?? []) as Row[], [] as Row[]),
    attempt(async () => fetchAll((a, b) => sb.from("stage_history").select("item_id,stage_id,entered_at").eq("owner_id", ownerId).order("entered_at").range(a, b)) as Promise<Row[]>, [] as Row[]),
    attempt(async () => ((await sb.from("pipeline_stages").select("id,name,outcome").eq("owner_id", ownerId)).data ?? []) as Row[], [] as Row[]),
    attempt(async () => ((await sb.from("communications").select("id,occurred_at,pipeline_item_id").eq("owner_id", ownerId).eq("is_outreach", true).gte("occurred_at", tsFrom).lte("occurred_at", tsTo)).data ?? []) as Row[], [] as Row[]),
    attempt(() => loadTargets(sb, { ownerId, tz, from: addDaysISO(day, -14), to: day }), null),
  ]);
  const pipeInitiative = new Map(pipelines.map((p) => [p.id, (p.initiative_id as string | null) ?? null]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  // Stage moves today: every history entry of an item after its first one.
  const seen = new Set<string>();
  const moves: { itemId: string; stage: string; pass: boolean; reason: string | null }[] = [];
  for (const h of history) {
    if (!seen.has(h.item_id)) {
      seen.add(h.item_id);
      continue;
    }
    if (localDate(h.entered_at) !== day) continue;
    const st = stageById.get(h.stage_id);
    moves.push({ itemId: String(h.item_id), stage: String(st?.name ?? "a new stage"), pass: st?.outcome === "lost", reason: null });
  }
  const summaries = targets?.available ? summarizeTargets(targets, day).filter((s) => s.target.active) : [];
  const outreachTarget = summaries.find((s) => s.target.count_source === "communications_outreach");
  return buildDayDetail({
    date: day,
    focusedHours: plan?.focused_hours === null || plan?.focused_hours === undefined ? null : Number(plan.focused_hours),
    changes: (plan?.changes_note as string | null) ?? null,
    tomorrow: (plan?.tomorrow_priority as string | null) ?? null,
    initiatives: initiatives.map((i) => ({ id: String(i.id), name: String(i.name) })),
    outcomes: outcomes.map(toOutcome),
    targets: summaries.map((s) => ({
      name: String(s.target.name),
      initiativeId: (s.target.initiative_id as string | null) ?? null,
      count: s.today.count,
      required: s.today.required,
      met: s.today.status === "met",
      off: s.today.status === "off",
      period: s.target.period === "week" ? "week" : "day",
    })),
    tasksDone: doneTasks.filter((t) => localDate(t.completed_at) === day).map((t) => ({ initiativeId: (t.initiative_id as string | null) ?? null, pipelineItemId: (t.pipeline_item_id as string | null) ?? null })),
    items: items.map((i) => ({ id: String(i.id), name: String(i.name), initiativeId: pipeInitiative.get(i.pipeline_id) ?? null })),
    moves,
    outreach: outreach.filter((c) => localDate(c.occurred_at) === day).map((c) => ({ pipelineItemId: (c.pipeline_item_id as string | null) ?? null })),
    outreachInitiativeId: (outreachTarget?.target.initiative_id as string | null) ?? null,
  });
}

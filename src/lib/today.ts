import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, isWeekday, todayInTz } from "@/lib/calc/dates";
import { closeStep, dayState, nextActionTasks, outcomeSlots, pickableActions, waitingRows, type CloseStep, type NextActionPick, type Outcome, type WaitingRow } from "@/lib/calc/today";
import { loadTargets, summarizeTargets } from "@/lib/targets";
import { toOutcome } from "@/lib/engine/day-detail";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { hasUpdate0019 } from "@/lib/update-0019";
import type { Row } from "@/lib/types";

/** One row of "Today's activity": a daily target active today. */
export type ActivityRow = { id: string; name: string; count: number; required: number; met: boolean; manual: boolean };

export type TodayData = {
  /** Database update 0019 is applied. */
  available: boolean;
  today: string;
  weekday: boolean;
  focusedHours: number | null;
  outcomes: Outcome[];
  initiatives: { id: string; name: string }[];
  lastInitiativeId: string | null;
  picks: NextActionPick[];
  targets: { available: boolean; rows: ActivityRow[] };
  nextActions: { tasks: Row[]; more: number };
  waiting: WaitingRow[];
  day: "open" | "closed" | "weekend";
  review: { id: string; status: string; step: CloseStep } | null;
};

const NEXT_ACTIONS_SHOWN = 8;

/** Everything the Today screen shows. Before database update 0019, only `available` (false) and the date matter. */
export async function loadToday(sb: SupabaseClient, ownerId: string): Promise<TodayData> {
  const ctx = await loadCtx(sb, ownerId);
  const today = ctx.today;
  const base: TodayData = {
    available: false,
    today,
    weekday: isWeekday(today),
    focusedHours: null,
    outcomes: outcomeSlots([]),
    initiatives: [],
    lastInitiativeId: null,
    picks: [],
    targets: { available: false, rows: [] },
    nextActions: { tasks: [], more: 0 },
    waiting: [],
    day: isWeekday(today) ? "open" : "weekend",
    review: null,
  };
  if (!(await hasUpdate0019(sb))) return base;
  const [outcomesRes, lastRes, planRes, initRes, tasksRes, itemsRes, pipesRes, waitingRes, reviewRes, targets] = await Promise.all([
    sb.from("daily_outcomes").select("*").eq("owner_id", ownerId).eq("plan_date", today).order("position"),
    sb.from("daily_outcomes").select("initiative_id").eq("owner_id", ownerId).not("initiative_id", "is", null).order("plan_date", { ascending: false }).order("updated_at", { ascending: false }).limit(1),
    sb.from("daily_plans").select("focused_hours").eq("owner_id", ownerId).eq("plan_date", today).maybeSingle(),
    sb.from("initiatives").select("id,name").eq("owner_id", ownerId).eq("is_active", true).order("sort_order").order("name"),
    sb.from("tasks").select("id,title,due_date,priority,status,initiative_id,pipeline_item_id,times_moved").eq("owner_id", ownerId).eq("status", "todo").lte("due_date", today).order("due_date").order("priority").limit(200),
    sb.from("pipeline_items").select("id,name,next_action,next_action_due,pipeline_id").eq("owner_id", ownerId).eq("status", "open").not("next_action", "is", null).lte("next_action_due", today).limit(100),
    sb.from("pipelines").select("id,initiative_id").eq("owner_id", ownerId),
    sb.from("tasks").select("id,title,status,waiting_on,waiting_since").eq("owner_id", ownerId).eq("status", "todo").not("waiting_on", "is", null).limit(50),
    sb.from("reviews").select("id,status,answers").eq("owner_id", ownerId).eq("kind", "daily").eq("period_start", today).maybeSingle(),
    loadTargets(sb, { ownerId, tz: ctx.tz, from: addDaysISO(today, -14), to: today }),
  ]);
  const outcomes = ((outcomesRes.data ?? []) as Row[]).map(toOutcome);
  const lastInitiativeId = (((lastRes.data ?? []) as Row[])[0]?.initiative_id as string | null) ?? null;
  const pipeInitiative = new Map(((pipesRes.data ?? []) as Row[]).map((p) => [p.id, (p.initiative_id as string | null) ?? null]));
  const tasks = (tasksRes.data ?? []) as Row[];
  const pickTasks = tasks.map((t) => ({ id: String(t.id), title: String(t.title), due_date: (t.due_date as string | null) ?? null, initiative_id: (t.initiative_id as string | null) ?? null, pipeline_item_id: (t.pipeline_item_id as string | null) ?? null, priority: t.priority as number | null }));
  const pickItems = ((itemsRes.data ?? []) as Row[]).map((i) => ({ id: String(i.id), name: String(i.name), next_action: (i.next_action as string | null) ?? null, next_action_due: (i.next_action_due as string | null) ?? null, initiative_id: pipeInitiative.get(i.pipeline_id) ?? null }));
  // A task for a pipeline item takes the item's initiative when it has none of its own.
  const itemInitiative = new Map(pickItems.map((i) => [i.id, i.initiative_id]));
  for (const t of pickTasks) if (!t.initiative_id && t.pipeline_item_id) t.initiative_id = itemInitiative.get(t.pipeline_item_id) ?? null;
  const summaries = targets.available ? summarizeTargets(targets, today) : [];
  const rows: ActivityRow[] = summaries
    .filter((s) => s.target.active && s.target.period !== "week" && s.today.status !== "off")
    .map((s) => ({ id: String(s.target.id), name: String(s.target.name), count: s.today.count, required: s.today.required, met: s.today.status === "met", manual: s.target.count_source === "manual" }));
  const nextTasks = nextActionTasks(tasks as (Row & { id: string; title: string; due_date: string | null; initiative_id: string | null; pipeline_item_id: string | null })[], today);
  const review = (reviewRes.data as Row | null) ?? null;
  const answers = (review?.answers ?? {}) as Row;
  return {
    ...base,
    available: true,
    focusedHours: planRes.data?.focused_hours === null || planRes.data?.focused_hours === undefined ? null : Number(planRes.data.focused_hours),
    outcomes: outcomeSlots(outcomes, lastInitiativeId),
    initiatives: ((initRes.data ?? []) as Row[]).map((i) => ({ id: String(i.id), name: String(i.name) })),
    lastInitiativeId,
    picks: pickableActions(pickTasks, pickItems, outcomes, today),
    targets: { available: targets.available, rows },
    nextActions: { tasks: nextTasks.slice(0, NEXT_ACTIONS_SHOWN), more: Math.max(0, nextTasks.length - NEXT_ACTIONS_SHOWN) },
    waiting: waitingRows(((waitingRes.data ?? []) as Row[]).map((t) => ({ id: String(t.id), title: String(t.title), status: t.status as string, waiting_on: t.waiting_on as string | null, waiting_since: t.waiting_since as string | null }))),
    day: dayState(review ? { status: String(review.status) } : null, isWeekday(today)),
    review: review ? { id: String(review.id), status: String(review.status), step: closeStep(null, answers.close_step) } : null,
  };
}

/** Today's outcomes for the close (step 1), in position order. */
export async function loadTodaysOutcomes(ctx: Pick<Ctx, "sb" | "ownerId" | "today">): Promise<Outcome[]> {
  const { data } = await ctx.sb.from("daily_outcomes").select("*").eq("owner_id", ctx.ownerId).eq("plan_date", ctx.today).order("position");
  return ((data ?? []) as Row[]).map(toOutcome).filter((o) => o.title.trim());
}

/** Misses for step 2 of the close: pending ones (today's and earlier) and the ones resolved today, newest first. */
export type PendingMiss = { id: string; commitmentId: string; title: string; missedOn: string; missCount: number; reason: string | null; resolution: string; doneOn: string | null; newDue: string | null };

export async function loadPendingMisses(ctx: Pick<Ctx, "sb" | "ownerId" | "today" | "tz">): Promise<PendingMiss[]> {
  const { data } = await ctx.sb.from("missed_commitments").select("*").eq("owner_id", ctx.ownerId).lte("missed_on", ctx.today).order("missed_on", { ascending: false }).limit(50);
  // Pending misses, and misses resolved today (they stay in the list with their resolution).
  const misses = ((data ?? []) as Row[]).filter((m) => m.resolution === "pending" || (m.updated_at && todayInTz(ctx.tz, new Date(String(m.updated_at))) === ctx.today));
  if (!misses.length) return [];
  const { data: cs } = await ctx.sb.from("commitments").select("id,title,miss_count").in("id", misses.map((m) => m.commitment_id));
  const byId = new Map(((cs ?? []) as Row[]).map((c) => [String(c.id), c]));
  return misses
    .filter((m) => byId.has(String(m.commitment_id)) && !/daily close/i.test(String(byId.get(String(m.commitment_id))?.title ?? "")))
    .map((m) => {
      const c = byId.get(String(m.commitment_id))!;
      return { id: String(m.id), commitmentId: String(c.id), title: String(c.title), missedOn: String(m.missed_on), missCount: Number(c.miss_count ?? 0), reason: (m.reason as string | null) ?? null, resolution: String(m.resolution ?? "pending"), doneOn: (m.done_on as string | null) ?? null, newDue: (m.new_due_date as string | null) ?? null };
    });
}

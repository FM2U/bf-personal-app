import "server-only";
import { addDaysISO, parseDate } from "@/lib/calc/dates";
import { createCalendarEvent, localDateTime } from "@/lib/google";
import { insertIgnoreDuplicate } from "@/lib/data";
import type { Row } from "@/lib/types";
import { groupMovesByCount, planRollover } from "@/lib/calc/commitment-rule";
import { isMissingSchemaError } from "@/lib/schema-guard";
import { createAlert, createTask, type Ctx } from "./helpers";
import { resolveHref } from "@/lib/window-route";
import { checklistsToReset, type ChecklistRow } from "@/lib/checklists";

/** True when a recurring template is due on the given date. */
export function templateDueOn(t: Row, today: string): boolean {
  const d = parseDate(today);
  const day = d.getDate();
  switch (t.cadence) {
    case "daily":
      return true;
    case "weekly":
      return d.getDay() === Number(t.weekday ?? 1);
    case "monthly":
      return day === Number(t.day_of_month ?? 1);
    case "quarterly":
      return day === Number(t.day_of_month ?? 1) && [0, 3, 6, 9].includes(d.getMonth());
    default:
      return false;
  }
}

/**
 * Creates today's tasks from recurring templates (daily, weekly, monthly, quarterly).
 * A template marked "Counts as a commitment" (by default only the reviews) also creates a commitment.
 */
export async function generateRecurringTasks(ctx: Ctx): Promise<{ created: number }> {
  const { sb, ownerId, today } = ctx;
  const { data } = await sb.from("task_templates").select("*").eq("owner_id", ownerId).eq("is_active", true);
  let created = 0;
  for (const t of (data ?? []) as Row[]) {
    if (!templateDueOn(t, today)) continue;
    const id = await createTask(ctx, {
      title: t.title,
      description: t.description,
      due_date: today,
      source: "template",
      source_key: `template:${t.id}:${today}`,
      template_id: t.id,
      initiative_id: t.initiative_id,
    });
    if (id) {
      created++;
      await resetChecklistsFor(ctx, t.id);
      if (t.is_commitment) {
        await insertIgnoreDuplicate(sb, "commitments", { owner_id: ownerId, title: t.title, record_type: "tasks", record_id: id, due_date: today, original_due_date: today });
      }
    }
    await sb.from("task_templates").update({ last_generated_on: today }).eq("id", t.id);
  }
  return { created };
}

/**
 * Checklists with "Reset each week" that go with this recurring task: every item is unchecked when the task is
 * created (at most once in 6 days). Before database update 0014 there are no checklists and nothing happens.
 */
export async function resetChecklistsFor(ctx: Pick<Ctx, "sb" | "ownerId" | "today">, templateId: string): Promise<number> {
  const { sb, ownerId, today } = ctx;
  const { data, error } = await sb.from("checklists").select("id,task_template_id,reset_weekly,last_reset_on").eq("owner_id", ownerId).eq("task_template_id", templateId);
  if (error) return 0;
  const ids = checklistsToReset((data ?? []) as ChecklistRow[], templateId, today);
  if (!ids.length) return 0;
  await sb.from("checklist_items").update({ checked: false }).eq("owner_id", ownerId).in("checklist_id", ids).eq("checked", true);
  await sb.from("checklists").update({ last_reset_on: today }).eq("owner_id", ownerId).in("id", ids);
  return ids.length;
}

/**
 * Every pipeline item's next action appears in the task list on its due date.
 * An item's current next action is a commitment (commitment rule), so each new next-action task gets one.
 */
export async function generatePipelineTasks(ctx: Ctx): Promise<{ created: number }> {
  const { sb, ownerId, today } = ctx;
  await releaseSupersededNextActions(ctx);
  const { data } = await sb
    .from("pipeline_items")
    .select("id,name,next_action,next_action_due,pipeline_id")
    .eq("owner_id", ownerId)
    .eq("status", "open")
    .not("next_action", "is", null)
    .lte("next_action_due", today);
  const { data: pipes } = await sb.from("pipelines").select("id,initiative_id,name").eq("owner_id", ownerId);
  const pipeById = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p]));
  let created = 0;
  for (const it of (data ?? []) as Row[]) {
    // The stage task list may already have created this task (same item and title): do not add it twice.
    const { data: same } = await sb.from("tasks").select("id").eq("owner_id", ownerId).eq("pipeline_item_id", it.id).eq("title", `${it.name}: ${it.next_action}`).limit(1);
    if (same?.length) continue;
    const id = await createTask(ctx, {
      title: `${it.name}: ${it.next_action}`,
      due_date: it.next_action_due,
      source: "pipeline",
      source_key: `pipeline:${it.id}:${it.next_action_due}`,
      pipeline_item_id: it.id,
      initiative_id: pipeById[it.pipeline_id]?.initiative_id ?? null,
      related_type: "pipeline_items",
      related_id: it.id,
    });
    if (id) {
      created++;
      await insertIgnoreDuplicate(sb, "commitments", {
        owner_id: ownerId,
        title: `${it.name}: ${it.next_action}`,
        record_type: "tasks",
        record_id: id,
        due_date: it.next_action_due,
        original_due_date: it.next_action_due,
      });
    }
  }
  return { created };
}

/**
 * When an item's next action changes, the task for its earlier next action stays as a regular task and its
 * commitment is released (only the current next action is a commitment). Stage tasks are not affected.
 * Before database update 0010 the release is not possible and nothing changes.
 */
export async function releaseSupersededNextActions(ctx: Pick<Ctx, "sb" | "ownerId">, itemId?: string): Promise<{ released: number }> {
  const { sb, ownerId } = ctx;
  let q = sb.from("tasks").select("id,title,pipeline_item_id").eq("owner_id", ownerId).eq("status", "todo").like("source_key", "pipeline:%");
  if (itemId) q = q.eq("pipeline_item_id", itemId);
  const { data: tasks } = await q;
  const list = (tasks ?? []) as Row[];
  if (!list.length) return { released: 0 };
  const { data: items } = await sb.from("pipeline_items").select("id,name,next_action").in("id", [...new Set(list.map((t) => t.pipeline_item_id).filter(Boolean))]);
  const current = Object.fromEntries(((items ?? []) as Row[]).map((i) => [i.id, i.next_action ? `${i.name}: ${i.next_action}` : null]));
  const stale = list.filter((t) => t.pipeline_item_id && current[t.pipeline_item_id] !== t.title).map((t) => t.id);
  if (!stale.length) return { released: 0 };
  const { data, error } = await sb.from("commitments").update({ status: "released" }).eq("owner_id", ownerId).eq("record_type", "tasks").eq("status", "open").in("record_id", stale).select("id");
  if (error) return { released: 0 }; // "released" needs database update 0010
  return { released: (data ?? []).length };
}

/**
 * Regular tasks that were not done move to today (no reason needed), and times_moved goes up by one.
 * Tasks with an open or missed commitment keep their date (missed-commitment flow).
 * Needs database update 0010 (tasks.times_moved); before it, nothing moves.
 */
export async function rolloverRegularTasks(ctx: Ctx): Promise<{ moved: number; skipped?: string }> {
  const { sb, ownerId, today } = ctx;
  const { data, error } = await sb.from("tasks").select("id,status,due_date,times_moved").eq("owner_id", ownerId).eq("status", "todo").lt("due_date", today).limit(2000);
  if (error) {
    if (isMissingSchemaError(error)) return { moved: 0, skipped: "Database update 0010 is not applied yet" };
    throw new Error(error.message);
  }
  const tasks = (data ?? []) as Row[];
  if (!tasks.length) return { moved: 0 };
  const { data: open } = await sb.from("commitments").select("record_id").eq("owner_id", ownerId).eq("record_type", "tasks").in("status", ["open", "missed"]);
  const commitmentIds = new Set(((open ?? []) as Row[]).map((c) => c.record_id));
  const moves = planRollover(tasks as { id: string; status: string; due_date: string | null; times_moved: number }[], commitmentIds, today);
  for (const [timesMoved, ids] of groupMovesByCount(moves)) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error: upErr } = await sb.from("tasks").update({ due_date: today, times_moved: timesMoved }).in("id", ids.slice(i, i + 200));
      if (upErr) throw new Error(upErr.message);
    }
  }
  return { moved: moves.length };
}

/** A contact's follow-up date creates a task and a calendar event when the date arrives. */
export async function generateFollowUps(ctx: Ctx): Promise<{ created: number }> {
  const { sb, ownerId, today, tz } = ctx;
  const { data } = await sb.from("contacts").select("id,name,follow_up_date,follow_up_note").eq("owner_id", ownerId).lte("follow_up_date", today).gte("follow_up_date", addDaysISO(today, -7));
  let created = 0;
  for (const c of (data ?? []) as Row[]) {
    const title = `Follow up with ${c.name}${c.follow_up_note ? `: ${c.follow_up_note}` : ""}`;
    const id = await createTask(ctx, {
      title,
      due_date: c.follow_up_date,
      source: "follow_up",
      source_key: `followup:${c.id}:${c.follow_up_date}`,
      related_type: "contacts",
      related_id: c.id,
    });
    if (!id) continue;
    created++;
    const dedupe = `followup:${c.id}:${c.follow_up_date}`;
    const start = localDateTime(today, 10, 0, tz);
    const end = localDateTime(today, 10, 30, tz);
    let googleId: string | null = null;
    try {
      googleId = await createCalendarEvent(sb, ownerId, { summary: title, start, end, description: "Created by BF Personal App." });
    } catch {
      googleId = null;
    }
    await insertIgnoreDuplicate(sb, "calendar_events", { owner_id: ownerId, title, starts_at: start, ends_at: end, kind: "follow_up", task_id: id, google_event_id: googleId, dedupe_key: dedupe });
  }
  return { created };
}

/** Review events on Google Calendar: the daily close every evening, and the weekly, monthly, and quarterly reviews on their days. */
export async function scheduleReviewEvents(ctx: Ctx): Promise<{ created: number }> {
  const { sb, ownerId, today, tz, profile } = ctx;
  const d = parseDate(today);
  const evening = Number(profile.evening_hour ?? 20);
  const items: { key: string; title: string; hour: number; minutes: number; kind: string }[] = [
    { key: `review:daily:${today}`, title: "Daily close (about 3 minutes)", hour: evening, minutes: 15, kind: "daily" },
  ];
  if (d.getDay() === Number(profile.weekly_review_weekday ?? 0)) items.push({ key: `review:weekly:${today}`, title: "Weekly review", hour: 10, minutes: 60, kind: "weekly" });
  if (d.getDate() === 1) items.push({ key: `review:monthly:${today}`, title: "Monthly review", hour: 11, minutes: 60, kind: "monthly" });
  if (d.getDate() === 1 && [0, 3, 6, 9].includes(d.getMonth())) items.push({ key: `review:quarterly:${today}`, title: "Quarterly review", hour: 13, minutes: 90, kind: "quarterly" });
  let created = 0;
  for (const it of items) {
    const { data: exists } = await sb.from("calendar_events").select("id").eq("owner_id", ownerId).eq("dedupe_key", it.key).maybeSingle();
    if (exists) continue;
    const start = localDateTime(today, it.hour, 0, tz);
    const endH = it.hour + Math.floor(it.minutes / 60);
    const end = localDateTime(today, Math.min(23, endH), it.minutes % 60, tz);
    let googleId: string | null = null;
    try {
      googleId = await createCalendarEvent(sb, ownerId, { summary: it.title, start, end, description: `Open the app: Accountability, Reviews.` });
    } catch {
      googleId = null;
    }
    if (!googleId) return { created };
    await insertIgnoreDuplicate(sb, "calendar_events", { owner_id: ownerId, title: it.title, starts_at: start, ends_at: end, kind: "review", review_kind: it.kind, google_event_id: googleId, dedupe_key: it.key });
    created++;
  }
  return { created };
}

/**
 * Commitment check. A commitment is met when its task is done, its milestone is met, or its goal is met.
 * When the due date has passed without that, the miss is recorded and a one-line reason is requested.
 * `includeToday` is used by the evening job, when the day is over.
 */
export async function checkCommitments(ctx: Ctx, includeToday: boolean): Promise<{ met: number; missed: number }> {
  const { sb, ownerId, today } = ctx;
  const { data } = await sb.from("commitments").select("*").eq("owner_id", ownerId).eq("status", "open");
  const list = (data ?? []) as Row[];
  const ids = (type: string) => list.filter((c) => c.record_type === type).map((c) => c.record_id);
  const [tasks, milestones, goals] = await Promise.all([
    ids("tasks").length ? sb.from("tasks").select("id,status").in("id", ids("tasks")) : Promise.resolve({ data: [] }),
    ids("milestones").length ? sb.from("milestones").select("id,status").in("id", ids("milestones")) : Promise.resolve({ data: [] }),
    ids("goals").length ? sb.from("goals").select("id,status").in("id", ids("goals")) : Promise.resolve({ data: [] }),
  ]);
  const status: Record<string, string> = {};
  for (const r of [...((tasks.data ?? []) as Row[]), ...((milestones.data ?? []) as Row[]), ...((goals.data ?? []) as Row[])]) status[r.id] = r.status;
  let met = 0;
  let missed = 0;
  for (const c of list) {
    const s = status[c.record_id];
    const isMet = (c.record_type === "tasks" && s === "done") || (c.record_type !== "tasks" && s === "met");
    if (isMet) {
      await sb.from("commitments").update({ status: "met", met_on: today }).eq("id", c.id);
      met++;
      continue;
    }
    const pastDue = includeToday ? c.due_date <= today : c.due_date < today;
    if (!pastDue) continue;
    missed++;
    await sb.from("commitments").update({ status: "missed", miss_count: Number(c.miss_count ?? 0) + 1 }).eq("id", c.id);
    const missId = await insertIgnoreDuplicate(sb, "missed_commitments", { owner_id: ownerId, commitment_id: c.id, missed_on: c.due_date, resolution: "pending" });
    await createAlert(ctx, {
      kind: "missed_commitment",
      message: `Missed commitment: ${c.title}. Give a one-line reason and set a new date or open a decision.`,
      href: resolveHref(c.id, missId),
      related_type: "commitments",
      related_id: c.id,
      dedupe_key: `miss:${c.id}:${c.due_date}`,
    });
    await createTask(ctx, {
      title: `Resolve missed commitment: ${c.title}`,
      due_date: addDaysISO(today, includeToday ? 1 : 0),
      source: "missed_commitment",
      source_key: `miss:${c.id}:${c.due_date}`,
      priority: 1,
      related_type: "commitments",
      related_id: c.id,
    });
  }
  return { met, missed };
}

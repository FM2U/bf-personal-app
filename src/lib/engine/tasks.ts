import "server-only";
import { addDaysISO, parseDate } from "@/lib/calc/dates";
import { createCalendarEvent, localDateTime } from "@/lib/google";
import { insertIgnoreDuplicate } from "@/lib/data";
import type { Row } from "@/lib/types";
import { createAlert, createTask, type Ctx } from "./helpers";

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

/** Creates today's tasks from recurring templates (daily, weekly, monthly, quarterly). */
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
      if (t.is_commitment) {
        await insertIgnoreDuplicate(sb, "commitments", { owner_id: ownerId, title: t.title, record_type: "tasks", record_id: id, due_date: today, original_due_date: today });
      }
    }
    await sb.from("task_templates").update({ last_generated_on: today }).eq("id", t.id);
  }
  return { created };
}

/** Every pipeline item's next action appears in the task list on its due date. */
export async function generatePipelineTasks(ctx: Ctx): Promise<{ created: number }> {
  const { sb, ownerId, today } = ctx;
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
    if (id) created++;
  }
  return { created };
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

/** Time blocks on Google Calendar for today's priority tasks. */
export async function createTimeBlocks(ctx: Ctx, inputs: Record<string, number | null>): Promise<{ created: number }> {
  const { sb, ownerId, today, tz, profile } = ctx;
  const count = Math.max(0, Math.round(inputs.time_blocks_per_day ?? 2));
  const minutes = Math.max(15, Math.round(inputs.time_block_minutes ?? 60));
  if (!count) return { created: 0 };
  const { data } = await sb
    .from("tasks")
    .select("id,title,priority")
    .eq("owner_id", ownerId)
    .eq("status", "todo")
    .lte("due_date", today)
    .order("priority")
    .order("due_date")
    .limit(count);
  let created = 0;
  let startMin = (Number(profile.morning_hour ?? 7) + 2) * 60;
  for (const t of (data ?? []) as Row[]) {
    const dedupe = `block:${t.id}:${today}`;
    const { data: exists } = await sb.from("calendar_events").select("id").eq("owner_id", ownerId).eq("dedupe_key", dedupe).maybeSingle();
    if (exists) continue;
    const start = localDateTime(today, Math.floor(startMin / 60), startMin % 60, tz);
    const endMin = startMin + minutes;
    const end = localDateTime(today, Math.floor(endMin / 60), endMin % 60, tz);
    let googleId: string | null = null;
    try {
      googleId = await createCalendarEvent(sb, ownerId, { summary: `Focus: ${t.title}`, start, end, description: "Priority task time block from BF Personal App." });
    } catch {
      googleId = null;
    }
    if (!googleId) break; // Google not connected: no blocks
    await insertIgnoreDuplicate(sb, "calendar_events", { owner_id: ownerId, title: `Focus: ${t.title}`, starts_at: start, ends_at: end, kind: "time_block", task_id: t.id, google_event_id: googleId, dedupe_key: dedupe });
    await sb.from("tasks").update({ google_event_id: googleId }).eq("id", t.id);
    created++;
    startMin = endMin + 15;
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
      href: missId ? `/accountability?miss=${missId}` : "/accountability",
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

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertIgnoreDuplicate } from "@/lib/data";
import { todayInTz } from "@/lib/calc/dates";
import type { Row } from "@/lib/types";
import { GROUPED_ALERTS, groupedAlertStep, type GroupedAlertKind } from "@/lib/calc/commitment-rule";

export type Ctx = { sb: SupabaseClient; ownerId: string; today: string; tz: string; profile: Row };

export async function loadCtx(sb: SupabaseClient, ownerId: string): Promise<Ctx> {
  const { data } = await sb.from("owner_profile").select("*").eq("owner_id", ownerId).maybeSingle();
  const profile = (data as Row | null) ?? { timezone: "America/New_York", morning_hour: 7, evening_hour: 20, weekly_review_weekday: 0 };
  const tz = profile.timezone || "America/New_York";
  return { sb, ownerId, today: todayInTz(tz), tz, profile };
}

export async function createAlert(
  ctx: Pick<Ctx, "sb" | "ownerId">,
  a: { kind: string; message: string; severity?: string; related_type?: string; related_id?: string; href?: string; dedupe_key?: string },
) {
  return insertIgnoreDuplicate(ctx.sb, "alerts", { owner_id: ctx.ownerId, severity: "warning", ...a });
}

/**
 * One Home alert per kind (example: "3 pipeline items are stalled."), updated in place when the count changes
 * and resolved (dismissed) when the count reaches 0.
 */
export async function syncGroupedAlert(ctx: Pick<Ctx, "sb" | "ownerId">, kind: GroupedAlertKind, count: number) {
  const def = GROUPED_ALERTS[kind];
  const { data } = await ctx.sb.from("alerts").select("id,message").eq("owner_id", ctx.ownerId).eq("status", "open").eq("dedupe_key", def.dedupeKey).limit(1);
  const open = ((data ?? []) as Row[])[0] ?? null;
  const step = groupedAlertStep(kind, open ? { id: open.id, message: open.message } : null, count);
  if (step.action === "insert") {
    await insertIgnoreDuplicate(ctx.sb, "alerts", { owner_id: ctx.ownerId, kind: "other", severity: "warning", message: step.message, href: def.href, dedupe_key: def.dedupeKey });
  } else if (step.action === "update") {
    await ctx.sb.from("alerts").update({ message: step.message, href: def.href }).eq("id", step.id);
  } else if (step.action === "resolve") {
    await ctx.sb.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).eq("id", step.id);
  }
  return step.action;
}

/** Recounts open pipeline items without a next action and updates the grouped Home alert. */
export async function refreshNextActionAlert(ctx: Pick<Ctx, "sb" | "ownerId">) {
  const { data } = await ctx.sb.from("pipeline_items").select("id,next_action").eq("owner_id", ctx.ownerId).eq("status", "open");
  const count = ((data ?? []) as Row[]).filter((i) => !String(i.next_action ?? "").trim()).length;
  return syncGroupedAlert(ctx, "next_action", count);
}

/** Recounts open stage time limit decisions and updates the grouped Home alert. */
export async function refreshStageLimitAlert(ctx: Pick<Ctx, "sb" | "ownerId">) {
  const { count } = await ctx.sb.from("decisions").select("id", { count: "exact", head: true }).eq("owner_id", ctx.ownerId).eq("status", "open").eq("source", "pipeline_stage");
  return syncGroupedAlert(ctx, "stage_limit", count ?? 0);
}

export async function createTask(
  ctx: Pick<Ctx, "sb" | "ownerId">,
  t: {
    title: string;
    due_date?: string | null;
    source: string;
    source_key?: string;
    priority?: number;
    description?: string;
    initiative_id?: string | null;
    goal_id?: string | null;
    milestone_id?: string | null;
    pipeline_item_id?: string | null;
    template_id?: string | null;
    related_type?: string | null;
    related_id?: string | null;
  },
) {
  return insertIgnoreDuplicate(ctx.sb, "tasks", { owner_id: ctx.ownerId, status: "todo", priority: 2, ...t });
}

/** Opens a decision record with options written in advance. Returns the decision id. */
export async function openDecision(
  ctx: Pick<Ctx, "sb" | "ownerId">,
  d: {
    title: string;
    context?: string;
    source: string;
    source_id?: string | null;
    initiative_id?: string | null;
    due_date?: string | null;
    /** One decision per key (database update 0009). A duplicate key returns null and opens nothing. */
    dedupe_key?: string;
    options: { label: string; description?: string | null }[];
  },
): Promise<string | null> {
  const { data, error } = await ctx.sb
    .from("decisions")
    .insert({
      owner_id: ctx.ownerId,
      title: d.title,
      context: d.context ?? null,
      source: d.source,
      source_id: d.source_id ?? null,
      initiative_id: d.initiative_id ?? null,
      due_date: d.due_date ?? null,
      status: "open",
      ...(d.dedupe_key ? { dedupe_key: d.dedupe_key } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  if (d.options.length) {
    await ctx.sb.from("decision_options").insert(
      d.options.map((o, i) => ({ owner_id: ctx.ownerId, decision_id: data.id, label: o.label, description: o.description ?? null, sort_order: i + 1 })),
    );
  }
  return data.id;
}

export async function linkRecords(ctx: Pick<Ctx, "sb" | "ownerId">, fromType: string, fromId: string, toType: string, toId: string, relation?: string) {
  await insertIgnoreDuplicate(ctx.sb, "record_links", {
    owner_id: ctx.ownerId,
    from_type: fromType,
    from_id: fromId,
    to_type: toType,
    to_id: toId,
    relation: relation ?? null,
  });
}

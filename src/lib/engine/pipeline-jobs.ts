import "server-only";
import { addDaysISO } from "@/lib/calc/dates";
import { stageLimitDedupeKey } from "@/lib/calc/pipeline";
import { isReplacedPerItemAlert } from "@/lib/calc/commitment-rule";
import { loadPipelineStatus } from "@/lib/pipeline";
import { isMissingSchemaError } from "@/lib/schema-guard";
import type { Row } from "@/lib/types";
import { createTask, linkRecords, openDecision, refreshStageLimitAlert, syncGroupedAlert, type Ctx } from "./helpers";

export const STAGE_LIMIT_OPTIONS = { advance: "Advance to next stage", pass: "Pass" } as const;
export const extendLabel = (days: number) => `Extend ${days} days`;

/**
 * Daily pipeline accountability check (all pipelines):
 *   1. Open items without a next action: the task "Set next action: <item>" (a regular task).
 *   2. Items longer in a stage than the stage time limit (plus extensions): a decision with options written in advance.
 *   3. Stalled items (no stage change and no linked activity for pipeline_stall_days).
 * Home gets one grouped alert per kind ("3 pipeline items are stalled."), updated in place and resolved at 0.
 * Per-item badges stay on the board, list, and item pages. Earlier per-item alerts of these kinds are dismissed.
 * Works before database update 0009 (steps 1 and 3); step 2 needs the update and is skipped without it.
 */
export async function checkPipelineAccountability(ctx: Ctx) {
  const { sb, ownerId, today } = ctx;
  const out: Row = { missingNextAction: 0, overLimit: 0, decisionsOpened: 0, stalled: 0 };
  const [{ data: itemsData, error }, { data: pipes }, { data: alertRows }] = await Promise.all([
    sb.from("pipeline_items").select("*").eq("owner_id", ownerId).eq("status", "open"),
    sb.from("pipelines").select("id,name,initiative_id").eq("owner_id", ownerId),
    sb.from("alerts").select("id,dedupe_key,related_type,related_id").eq("owner_id", ownerId).eq("status", "open").like("dedupe_key", "%:%"),
  ]);
  if (error) throw new Error(error.message);
  const items = (itemsData ?? []) as Row[];
  const pipeById = Object.fromEntries(((pipes ?? []) as Row[]).map((p) => [p.id, p]));
  const openAlerts = (alertRows ?? []) as Row[];
  const dismiss = async (ids: string[]) => {
    if (ids.length) await sb.from("alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString() }).in("id", ids);
  };

  // 1. Next action required on every open item.
  for (const it of items) {
    const pipe = pipeById[it.pipeline_id];
    if (it.next_action && String(it.next_action).trim()) continue;
    out.missingNextAction++;
    await createTask(ctx, {
      title: `Set next action: ${it.name}`,
      due_date: today,
      source: "pipeline",
      source_key: `set-next-action:${it.id}:${it.stage_id ?? "none"}`,
      priority: 1,
      pipeline_item_id: it.id,
      initiative_id: pipe?.initiative_id ?? null,
      related_type: "pipeline_items",
      related_id: it.id,
      description: "Every open pipeline item needs a next action and a due date. Open the item, press Edit, and fill both.",
    });
  }
  const hasNext = new Set(items.filter((i) => i.next_action && String(i.next_action).trim()).map((i) => i.id));
  await syncGroupedAlert(ctx, "next_action", out.missingNextAction);
  // A "Set next action" task is done once the item has a next action.
  const { data: setTasks } = await sb.from("tasks").select("id,pipeline_item_id").eq("owner_id", ownerId).eq("status", "todo").like("source_key", "set-next-action:%");
  const doneIds = ((setTasks ?? []) as Row[]).filter((t) => hasNext.has(t.pipeline_item_id)).map((t) => t.id);
  if (doneIds.length) await sb.from("tasks").update({ status: "done" }).in("id", doneIds);

  const status = await loadPipelineStatus(sb, items, { ownerId, tz: ctx.tz, today });

  // 2. Stage time limits (needs update 0009).
  if (status.available) {
    const stageById = Object.fromEntries(status.stages.map((s) => [s.id, s]));
    for (const it of items) {
      const st = status.byItem[it.id];
      if (!st?.limit?.over || !st.enteredDate) continue;
      out.overLimit++;
      const stage = stageById[it.stage_id];
      const pipe = pipeById[it.pipeline_id];
      const next = status.stages
        .filter((s) => s.pipeline_id === it.pipeline_id && s.outcome !== "lost" && Number(s.position) > Number(stage?.position ?? 0))
        .sort((a, b) => Number(a.position) - Number(b.position))[0];
      const lost = status.stages.find((s) => s.pipeline_id === it.pipeline_id && s.outcome === "lost");
      try {
        const id = await openDecision(ctx, {
          title: `${it.name}: ${st.limit.daysInStage} days in ${stage?.name ?? "this stage"} (limit ${st.limit.limit})`,
          context: `${it.name} entered ${stage?.name ?? "its stage"} on ${st.enteredDate}. The time limit for this stage is ${stage?.max_days_in_stage} days${
            st.limit.extensionDays ? ` plus ${st.limit.extensionDays} extension days` : ""
          }. Choose one of the options written in advance.`,
          source: "pipeline_stage",
          source_id: it.id,
          initiative_id: pipe?.initiative_id ?? null,
          due_date: addDaysISO(today, 2),
          dedupe_key: stageLimitDedupeKey(it.id, it.stage_id, st.enteredDate, st.limit.extensionDays),
          options: [
            { label: STAGE_LIMIT_OPTIONS.advance, description: next ? `Move to ${next.name}. Required details are checked first.` : "There is no later open stage." },
            { label: STAGE_LIMIT_OPTIONS.pass, description: lost ? `Move to ${lost.name}. Open tasks for this item are closed.` : "Close the item as passed." },
            { label: extendLabel(status.extensionDays), description: `Allow ${status.extensionDays} more days in ${stage?.name ?? "this stage"} for this item only.` },
          ],
        });
        if (id) {
          out.decisionsOpened++;
          await linkRecords(ctx, "pipeline_items", it.id, "decisions", id, "time limit");
        }
      } catch (e) {
        if (!isMissingSchemaError(e as { message?: string })) throw e;
      }
    }
  }

  // The decision records stay per item (they are where Advance, Pass, or Extend is chosen); Home shows one alert.
  out.stageLimitAlert = await refreshStageLimitAlert(ctx);

  // 3. Stalled items.
  for (const it of items) if (status.byItem[it.id]?.stalled) out.stalled++;
  await syncGroupedAlert(ctx, "stalled", out.stalled);

  // Per-item alerts of these kinds (from before grouping) are dismissed.
  const { data: limitDecisions } = await sb.from("decisions").select("id").eq("owner_id", ownerId).eq("source", "pipeline_stage");
  const limitIds = new Set(((limitDecisions ?? []) as Row[]).map((d) => d.id));
  const replaced = openAlerts.filter((a) => isReplacedPerItemAlert(a, limitIds)).map((a) => a.id);
  await dismiss(replaced);
  out.perItemAlertsDismissed = replaced.length;
  return out;
}

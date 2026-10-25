import "server-only";
import { addDaysISO } from "@/lib/calc/dates";
import { evaluateCondition, parseActions, OPERATOR_LABELS, type Operator } from "@/lib/calc/conditions";
import { computeMetrics, metricValue } from "@/lib/metrics";
import { metricLabel } from "@/lib/metrics-list";
import type { Row } from "@/lib/types";
import { createAlert, createTask, linkRecords, openDecision, type Ctx } from "./helpers";

/** Checks every active decision condition. Runs daily and after data changes. */
export async function evaluateConditions(ctx: Ctx): Promise<{ checked: number; triggered: number }> {
  const { sb, ownerId, today } = ctx;
  const { data } = await sb.from("decision_conditions").select("*").eq("owner_id", ownerId).eq("is_active", true);
  const conditions = (data ?? []) as Row[];
  if (!conditions.length) return { checked: 0, triggered: 0 };
  const metrics = await computeMetrics(sb, today, ownerId);
  let triggered = 0;
  for (const c of conditions) {
    const value = metricValue(metrics, c.metric_key, c.metric_params);
    const ev = evaluateCondition(
      { id: c.id, metric_key: "m", operator: c.operator, threshold: Number(c.threshold), check_from: c.check_from, is_active: c.is_active, currently_met: c.currently_met },
      { m: value },
      today,
    );
    const update: Row = { last_value: value, last_evaluated_at: new Date().toISOString() };
    if (ev.applicable) update.currently_met = ev.met;
    if (ev.transition === "trigger") {
      triggered++;
      update.last_triggered_at = new Date().toISOString();
      const rule = `${metricLabel(c.metric_key)} ${OPERATOR_LABELS[c.operator as Operator]} ${c.threshold} (current value: ${value ?? "none"})`;
      for (const a of parseActions(c.actions)) {
        if (a.type === "create_task") {
          const taskId = await createTask(ctx, {
            title: a.title,
            due_date: addDaysISO(today, a.due_in_days ?? 0),
            source: "decision_condition",
            source_key: `condition:${c.id}:${today}:${a.title}`,
            priority: 1,
            initiative_id: c.initiative_id,
            description: `Created by the decision condition "${c.name}": ${rule}.`,
            related_type: "decision_conditions",
            related_id: c.id,
          });
          if (taskId) await linkRecords(ctx, "decision_conditions", c.id, "tasks", taskId, "created");
        } else if (a.type === "create_alert") {
          await createAlert(ctx, {
            kind: "decision_condition",
            severity: a.severity ?? "warning",
            message: a.message,
            related_type: "decision_conditions",
            related_id: c.id,
            href: `/records/decision_conditions/${c.id}`,
            dedupe_key: `condition:${c.id}`,
          });
        } else if (a.type === "open_decision") {
          const id = await openDecision(ctx, {
            title: a.title,
            context: `Opened by the decision condition "${c.name}": ${rule}.`,
            source: "decision_condition",
            source_id: c.id,
            initiative_id: c.initiative_id,
            due_date: addDaysISO(today, 7),
            options: a.options.map((label) => ({ label })),
          });
          if (id) {
            await linkRecords(ctx, "decision_conditions", c.id, "decisions", id, "opened");
            await createAlert(ctx, { kind: "decision_condition", message: `Decision required: ${a.title}`, href: `/records/decisions/${id}`, related_type: "decisions", related_id: id, dedupe_key: `decision:${id}` });
          }
        }
      }
    }
    await sb.from("decision_conditions").update(update).eq("id", c.id);
  }
  return { checked: conditions.length, triggered };
}

/** Missed milestones open a decision with the options written in advance. */
export async function checkMilestones(ctx: Ctx): Promise<{ missed: number }> {
  const { sb, ownerId, today } = ctx;
  const { data } = await sb.from("milestones").select("*").eq("owner_id", ownerId).in("status", ["planned", "active"]).lt("due_date", today);
  let missed = 0;
  for (const m of (data ?? []) as Row[]) {
    missed++;
    await sb.from("milestones").update({ status: "missed" }).eq("id", m.id);
    const { data: opts } = await sb.from("milestone_options").select("*").eq("milestone_id", m.id).order("sort_order");
    const options = ((opts ?? []) as Row[]).map((o) => ({ label: o.label, description: o.description }));
    const { data: goal } = m.goal_id ? await sb.from("goals").select("initiative_id,title").eq("id", m.goal_id).maybeSingle() : { data: null };
    const id = await openDecision(ctx, {
      title: `Milestone missed: ${m.title}`,
      context: `Completion test: ${m.completion_test}. Due ${m.due_date}.${goal ? ` Goal: ${goal.title}.` : ""} Choose one of the options written in advance.`,
      source: "milestone",
      source_id: m.id,
      initiative_id: goal?.initiative_id ?? null,
      due_date: addDaysISO(today, 3),
      options: options.length ? options : [{ label: "Set a new due date" }, { label: "Change the completion test" }, { label: "Drop this milestone" }],
    });
    if (id) await linkRecords(ctx, "milestones", m.id, "decisions", id, "opened");
    await createAlert(ctx, {
      kind: "milestone",
      severity: "critical",
      message: `Milestone missed: ${m.title}. A decision is open.`,
      href: id ? `/records/decisions/${id}` : `/records/milestones/${m.id}`,
      related_type: "milestones",
      related_id: m.id,
      dedupe_key: `milestone-missed:${m.id}`,
    });
  }
  return { missed };
}

/** Marks a milestone met (proof required) and makes the next milestone active. */
export async function markMilestoneMet(ctx: Pick<Ctx, "sb" | "ownerId" | "today">, milestoneId: string, proof: string | null) {
  const { sb } = ctx;
  const { data: m } = await sb.from("milestones").select("*").eq("id", milestoneId).single();
  if (!m) throw new Error("Milestone not found");
  const proofValue = proof?.trim() || m.proof_value;
  if (!proofValue) {
    const { count } = await sb.from("documents").select("id", { count: "exact", head: true }).eq("record_type", "milestones").eq("record_id", milestoneId);
    if (!count) throw new Error("Add proof of completion first: a number, a link, or an uploaded document.");
  }
  await sb.from("milestones").update({ status: "met", met_on: ctx.today, proof_value: proofValue }).eq("id", milestoneId);
  if (m.next_milestone_id) await sb.from("milestones").update({ status: "active" }).eq("id", m.next_milestone_id).neq("status", "met");
  await sb.from("commitments").update({ status: "met", met_on: ctx.today }).eq("record_type", "milestones").eq("record_id", milestoneId).eq("status", "open");
}

import "server-only";
import { resolveHref } from "@/lib/window-route";
import type { SupabaseClient } from "@supabase/supabase-js";
import { date as fmtDate, money } from "@/lib/format";
import { newRecordHref, recordHref } from "@/lib/resources";
import type { Row } from "@/lib/types";

/**
 * `due` is the action's due date (shown on its own line with "Overdue" or "Due today"); `text` never repeats it.
 * `tone` stays for actions with no date (example: a missing next action is "overdue").
 */
export type NextAction = { text: string; due?: string | null; href?: string; linkText?: string; tone: "normal" | "overdue" | "done" };

function due(d: string | null | undefined, today: string) {
  if (!d) return { label: " with no due date", overdue: false, date: null };
  return { label: "", overdue: d < today, date: d };
}

/** The next required action for any record, shown at the top of every record page. */
export async function nextActionFor(sb: SupabaseClient, table: string, row: Row, today: string): Promise<NextAction> {
  const self = recordHref(table, row.id);
  const edit = `${self}?edit=1`;
  const openTask = async (col: string, val: string) => {
    const { data } = await sb.from("tasks").select("id,title,due_date").eq(col, val).eq("status", "todo").order("due_date", { ascending: true, nullsFirst: false }).limit(1);
    return (data?.[0] as Row | undefined) ?? null;
  };
  switch (table) {
    case "tasks": {
      if (row.status !== "todo") return { text: `Task ${row.status === "done" ? "done" : "skipped"}. No action required.`, tone: "done" };
      const d = due(row.due_date, today);
      return { text: `Complete this task${d.label}.`, due: d.date, tone: d.overdue ? "overdue" : "normal" };
    }
    case "milestones": {
      if (row.status === "met") return { text: `Milestone met on ${fmtDate(row.met_on)}.`, tone: "done" };
      if (row.status === "missed") {
        const { data } = await sb.from("decisions").select("id,status").eq("source_id", row.id).eq("status", "open").limit(1);
        return data?.[0]
          ? { text: "Milestone missed. Choose one of the options written in advance.", href: recordHref("decisions", data[0].id), linkText: "Open the decision", tone: "overdue" }
          : { text: "Milestone missed.", tone: "overdue" };
      }
      const t = await openTask("milestone_id", row.id);
      if (t) {
        const d = due(t.due_date, today);
        return { text: `Next task: ${t.title}${d.label ? ` (${d.label.trim()})` : ""}.`, due: d.date, href: recordHref("tasks", t.id), linkText: "Open task", tone: d.overdue ? "overdue" : "normal" };
      }
      const { count } = await sb.from("tasks").select("id", { count: "exact", head: true }).eq("milestone_id", row.id);
      if (!count) return { text: "Add the tasks that produce this milestone.", href: newRecordHref("tasks", { milestone_id: row.id, due_date: row.due_date }), linkText: "Add task", tone: "normal" };
      const d = due(row.due_date, today);
      return { text: `All tasks done. Record proof and mark the milestone met${d.label}.`, due: d.date, tone: d.overdue ? "overdue" : "normal" };
    }
    case "goals": {
      if (row.status !== "active") return { text: `Goal ${row.status}.`, tone: "done" };
      const { data } = await sb.from("milestones").select("id,title,due_date").eq("goal_id", row.id).in("status", ["planned", "active"]).order("due_date").limit(1);
      if (data?.[0]) return { text: `Next milestone: ${data[0].title}.`, due: data[0].due_date, href: recordHref("milestones", data[0].id), linkText: "Open milestone", tone: data[0].due_date < today ? "overdue" : "normal" };
      return { text: "Add the milestones that lead to this goal.", href: newRecordHref("milestones", { goal_id: row.id }), linkText: "Add milestone", tone: "normal" };
    }
    case "pipeline_items": {
      if (row.status !== "open") return { text: `Closed (${row.status === "won" ? "won" : "passed or lost"}).`, tone: "done" };
      if (!row.next_action) return { text: "Set the next action and its due date.", href: edit, linkText: "Set next action", tone: "overdue" };
      const d = due(row.next_action_due, today);
      return { text: d.date ? row.next_action : `${row.next_action} (${d.label.trim()}).`, due: d.date, tone: d.overdue ? "overdue" : "normal" };
    }
    case "contacts":
      if (row.follow_up_date) return { text: `Follow up${row.follow_up_note ? `: ${row.follow_up_note}` : ""}.`, due: row.follow_up_date, tone: row.follow_up_date < today ? "overdue" : "normal" };
      return { text: "No follow-up date set.", href: edit, linkText: "Set follow-up date", tone: "normal" };
    case "debts":
      return { text: `Pay at least ${money(row.minimum_payment, true)}${row.due_day ? ` by day ${row.due_day} of the month` : " each month"}. Record each payment below.`, href: newRecordHref("debt_payments", { debt_id: row.id, amount: String(row.minimum_payment ?? "") }), linkText: "Record payment", tone: "normal" };
    case "funding_sources": {
      const { data } = await sb.from("repayment_schedules").select("*").eq("funding_source_id", row.id).order("due_date");
      const next = ((data ?? []) as Row[]).find((r) => Number(r.paid_amount) < Number(r.amount_due));
      if (next) return { text: `Next repayment: ${money(Number(next.amount_due) - Number(next.paid_amount), true)}.`, due: next.due_date, href: recordHref("repayment_schedules", next.id), linkText: "Record payment", tone: next.due_date < today ? "overdue" : "normal" };
      if (row.kind === "loan" && row.status === "received" && !(data ?? []).length) return { text: "Create the repayment schedule.", tone: "normal" };
      if (row.status === "offered") return { text: "Decide whether to accept this offer, then update the status.", href: edit, linkText: "Update status", tone: "normal" };
      return { text: "No repayment due.", tone: "done" };
    }
    case "repayment_schedules":
      if (Number(row.paid_amount) >= Number(row.amount_due)) return { text: `Paid on ${fmtDate(row.paid_on)}.`, tone: "done" };
      return { text: `Pay ${money(Number(row.amount_due) - Number(row.paid_amount), true)}, then enter the amount paid.`, due: row.due_date, href: edit, linkText: "Record payment", tone: row.due_date < today ? "overdue" : "normal" };
    case "decisions":
      if (row.status === "decided") return { text: row.outcome ? "Decided. Outcome recorded." : "Decided. Record the outcome when known.", href: row.outcome ? undefined : edit, linkText: "Record outcome", tone: "done" };
      return { text: "Choose an option and record the outcome.", due: row.due_date, tone: row.due_date && row.due_date < today ? "overdue" : "normal" };
    case "decision_conditions":
      return { text: `Checked every day and after each data change. Currently ${row.currently_met ? "met" : "not met"}${row.last_value !== null && row.last_value !== undefined ? ` (value ${row.last_value})` : ""}.`, tone: row.currently_met ? "overdue" : "done" };
    case "reduction_actions":
      if (row.status === "completed") return row.actual_monthly_savings === null ? { text: "Record the actual monthly savings.", href: edit, linkText: "Record savings", tone: "normal" } : { text: "Completed.", tone: "done" };
      if (row.status === "dropped") return { text: "Dropped.", tone: "done" };
      return { text: `Complete this action${due(row.deadline, today).label}, then mark it completed.`, due: row.deadline, href: edit, linkText: "Update status", tone: row.deadline && row.deadline < today ? "overdue" : "normal" };
    case "recurring_series":
      if (row.review_flag && row.review_status === "unreviewed") return { text: "Marked for review. Is this subscription still in use?", tone: "overdue" };
      return { text: "Ask for 3 reduction suggestions below.", tone: "normal" };
    case "transactions":
      if (!row.category_id && !row.is_transfer) return { text: "Choose a category.", href: edit, linkText: "Choose category", tone: "overdue" };
      if (Number(row.amount) < 0) return { text: "Optional: ask for 3 reduction suggestions below.", tone: "done" };
      return { text: "No action required.", tone: "done" };
    case "commitments":
      if (row.status === "open") return { text: "Keep this commitment.", due: row.due_date, tone: row.due_date < today ? "overdue" : "normal" };
      if (row.status === "missed") {
        const { data } = await sb.from("missed_commitments").select("id").eq("commitment_id", row.id).eq("resolution", "pending").order("missed_on", { ascending: false }).limit(1);
        return { text: "Missed. Give a one-line reason and set a new date or open a decision.", href: data?.[0] ? resolveHref(String(data[0].id)) : "/accountability?status=missed", linkText: "Resolve", tone: "overdue" };
      }
      return { text: `Status: ${row.status.replace(/_/g, " ")}.`, tone: "done" };
    case "missed_commitments":
      return row.resolution === "pending" ? { text: "Give a one-line reason and set a new date or open a decision.", href: resolveHref(String(row.id)), linkText: "Resolve", tone: "overdue" } : { text: "Resolved.", tone: "done" };
    case "partners":
      return { text: row.next_report_on ? `Next report draft on ${fmtDate(row.next_report_on)}.` : "Set the next report date.", href: row.next_report_on ? undefined : edit, linkText: "Set date", tone: "normal" };
    case "accounts": {
      const { data } = await sb.from("account_current_balances").select("as_of").eq("account_id", row.id).maybeSingle();
      if (!data) return { text: "Record the current balance.", href: newRecordHref("account_balances", { account_id: row.id, as_of: today }), linkText: "Record balance", tone: "overdue" };
      if (data.as_of < new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)) return { text: `Last balance is from ${fmtDate(data.as_of)}. Record the current balance.`, href: newRecordHref("account_balances", { account_id: row.id, as_of: today }), linkText: "Record balance", tone: "normal" };
      return { text: `Balance is current (as of ${fmtDate(data.as_of)}).`, tone: "done" };
    }
    case "initiatives": {
      const t = await openTask("initiative_id", row.id);
      if (t) return { text: `Next task: ${t.title}.`, due: t.due_date, href: recordHref("tasks", t.id), linkText: "Open task", tone: t.due_date && t.due_date < today ? "overdue" : "normal" };
      // No open task yet (example: a new initiative whose recurring tasks start on their day): the next milestone.
      const { data: goals } = await sb.from("goals").select("id").eq("initiative_id", row.id).eq("status", "active");
      const goalIds = ((goals ?? []) as Row[]).map((g) => g.id);
      if (goalIds.length) {
        const { data: ms } = await sb.from("milestones").select("id,title,due_date").in("goal_id", goalIds).in("status", ["planned", "active"]).order("due_date").limit(1);
        const m = (ms?.[0] as Row | undefined) ?? null;
        if (m) return { text: `Next milestone: ${m.title}.`, due: m.due_date, href: recordHref("milestones", m.id), linkText: "Open milestone", tone: m.due_date < today ? "overdue" : "normal" };
      }
      return { text: "No open tasks. Add a goal or a task.", href: newRecordHref("goals", { initiative_id: row.id }), linkText: "Add goal", tone: "normal" };
    }
  }
  const t = await openTask("related_id", row.id);
  if (t) return { text: `Open task: ${t.title}.`, due: t.due_date, href: recordHref("tasks", t.id), linkText: "Open task", tone: t.due_date && t.due_date < today ? "overdue" : "normal" };
  return { text: "No action required.", href: newRecordHref("tasks", { related_type: table, related_id: row.id }), linkText: "Add a task", tone: "done" };
}

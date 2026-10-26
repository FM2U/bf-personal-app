import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMetrics } from "@/lib/metrics";
import { baselineFromSnapshot, loadScenario, runScenario } from "@/lib/scenarios";
import { EXPORT_TABLES, getResource, SECRET_COLUMNS } from "@/lib/resources";
import type { Row } from "@/lib/types";

const READ_BLOCKED = new Set(["google_connections", "plaid_items", "partner_links", "ai_messages"]);
const READABLE = EXPORT_TABLES.filter((t) => !READ_BLOCKED.has(t));
const PROPOSE_BLOCKED = new Set(["ai_proposals", "ai_usage", "ai_messages", "ai_conversations", "change_log", "input_history", "google_connections", "plaid_items", "partner_links", "partner_reports", "owner_profile", "stage_history"]);

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_metrics",
    description: "Current calculated figures: runway, cash, average spending and income, net worth, debt, emergency fund, retirement target progress, savings, commitment score, overdue tasks.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_records",
    description: `Read records from one table. Tables: ${READABLE.join(", ")}. Use filters for exact matches (column: value). Returns up to 'limit' rows (max 200).`,
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        filters: { type: "object", description: "Exact-match filters, for example {\"status\":\"todo\"}" },
        order_by: { type: "string" },
        descending: { type: "boolean" },
        limit: { type: "number" },
      },
      required: ["table"],
    },
  },
  {
    name: "get_record",
    description: "Read one record by table and id, with its linked records, notes, and open tasks.",
    input_schema: { type: "object", properties: { table: { type: "string" }, id: { type: "string" } }, required: ["table", "id"] },
  },
  {
    name: "run_scenario",
    description: "Project the current numbers, or a saved scenario, or ad hoc overrides. Returns runway, cash by month (sampled), debt payoff date, net worth, emergency fund, retirement figures, and the job vs acquisition comparison.",
    input_schema: {
      type: "object",
      properties: {
        scenario_id: { type: "string" },
        overrides: { type: "object", description: "Input keys or baseline keys (monthly_spending, monthly_income, starting_cash, debt.<id>.apr) with numeric values" },
        horizon_months: { type: "number" },
      },
    },
  },
  {
    name: "propose_change",
    description:
      "Propose creating or updating one record. The change is NOT saved; Bram must approve it in the app. Use field names from the table. For create, omit id. For update, give record_id and only the fields that change.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        action: { type: "string", enum: ["create", "update"] },
        record_id: { type: "string" },
        fields: { type: "object" },
        summary: { type: "string", description: "One line describing the change" },
        reason: { type: "string" },
      },
      required: ["table", "action", "fields", "summary"],
    },
  },
];

function strip(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!SECRET_COLUMNS.includes(k) && k !== "owner_id") out[k] = v;
  return out;
}

export async function runTool(
  sb: SupabaseClient,
  ownerId: string,
  today: string,
  name: string,
  input: Row,
  conversationId: string | null,
): Promise<unknown> {
  switch (name) {
    case "get_metrics": {
      const m = await computeMetrics(sb, today);
      return {
        ...m.values,
        runway_months: m.snapshot.runway.months,
        runway_note: m.snapshot.runway.months === null ? "Cash is not decreasing (income covers spending)." : undefined,
        runway_target_months: m.snapshot.inputs.num.runway_target_months,
        retirement_target: m.snapshot.retirement.target,
        required_monthly_retirement_savings: m.snapshot.retirement.requiredMonthly,
        emergency_fund: m.snapshot.emergencyFund,
      };
    }
    case "list_records": {
      const table = String(input.table);
      if (!READABLE.includes(table)) return { error: `Table ${table} cannot be read.` };
      let q = sb.from(table).select("*");
      for (const [k, v] of Object.entries((input.filters as Row) ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v as string);
      if (input.order_by) q = q.order(String(input.order_by), { ascending: !input.descending });
      const { data, error } = await q.limit(Math.min(200, Number(input.limit ?? 50)));
      if (error) return { error: error.message };
      return ((data ?? []) as Row[]).map(strip);
    }
    case "get_record": {
      const table = String(input.table);
      if (!READABLE.includes(table)) return { error: `Table ${table} cannot be read.` };
      const { data } = await sb.from(table).select("*").eq("id", String(input.id)).maybeSingle();
      if (!data) return { error: "Not found" };
      const [{ data: l1 }, { data: l2 }, { data: notes }, { data: tasks }] = await Promise.all([
        sb.from("record_links").select("to_type,to_id,relation").eq("from_type", table).eq("from_id", String(input.id)),
        sb.from("record_links").select("from_type,from_id,relation").eq("to_type", table).eq("to_id", String(input.id)),
        sb.from("notes").select("body,created_at").eq("record_type", table).eq("record_id", String(input.id)),
        sb.from("tasks").select("id,title,due_date,status").eq("related_id", String(input.id)).eq("status", "todo"),
      ]);
      return { record: strip(data as Row), links: [...(l1 ?? []), ...(l2 ?? [])], notes, open_tasks: tasks };
    }
    case "run_scenario": {
      const m = await computeMetrics(sb, today);
      const base = baselineFromSnapshot(m.snapshot);
      let overrides: Record<string, number> = {};
      let horizon = Number(input.horizon_months ?? 60);
      if (input.scenario_id) {
        const s = await loadScenario(sb, String(input.scenario_id));
        if (!s) return { error: "Scenario not found" };
        overrides = s.overrides;
        horizon = Number(input.horizon_months ?? s.scenario.horizon_months);
      }
      for (const [k, v] of Object.entries((input.overrides as Row) ?? {})) overrides[k] = Number(v);
      const { result, jobVsAcquisition } = runScenario(base, overrides, Math.min(240, Math.max(1, horizon)));
      return {
        ...result,
        rows: result.rows.filter((_, i) => i % 6 === 5 || i === 0),
        jobVsAcquisition,
      };
    }
    case "propose_change": {
      const table = String(input.table);
      if (!getResource(table) || PROPOSE_BLOCKED.has(table)) return { error: `Changes to ${table} cannot be proposed.` };
      const action = input.action === "update" ? "update" : "create";
      if (action === "update" && !input.record_id) return { error: "record_id is required for an update." };
      const r = getResource(table)!;
      const allowed = new Set([...r.fields.map((f) => f.name), "related_type", "related_id", "category_source", "suggestions"]);
      const fields = Object.fromEntries(Object.entries((input.fields as Row) ?? {}).filter(([k]) => allowed.has(k)));
      if (!Object.keys(fields).length) return { error: "No valid fields. Use field names from the table." };
      const { data, error } = await sb
        .from("ai_proposals")
        .insert({
          owner_id: ownerId,
          table_name: table,
          action,
          record_id: action === "update" ? String(input.record_id) : null,
          payload: fields,
          summary: String(input.summary ?? "Proposed change"),
          reason: input.reason ? String(input.reason) : null,
          source: "chat",
          conversation_id: conversationId,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      return { proposal_id: data.id, status: "pending", note: "Saved as a proposal. Bram must approve it on the AI proposals page before anything changes." };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

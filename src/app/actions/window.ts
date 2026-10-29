"use server";

/**
 * Data and actions for the windows (src/components/app/window-host.tsx and src/components/app/windows/*): record
 * overviews, the editor, the step-by-step initiative setup, and Work through tasks. Nothing here redirects: the
 * window stays open and moves to the next view itself, then reloads the page underneath (router.refresh). The actions
 * here never revalidate on their own: a revalidating action answers with the page for the address it was sent from,
 * and the window may have moved on by then (that mismatch made Next.js reload the whole page).
 */
import { requireOwner } from "@/lib/auth";
import { getResource, recordHref } from "@/lib/resources";
import { labelMap, loadRefOptions, titleOf } from "@/lib/data";
import { quickCreateRefTables, type RefOption } from "@/lib/quick-create";
import { loadCtx, refreshNextActionAlert } from "@/lib/engine/helpers";
import { evaluateConditions } from "@/lib/engine/rules";
import { checkCommitments, releaseSupersededNextActions } from "@/lib/engine/tasks";
import { nextActionFor, type NextAction } from "@/lib/next-action";
import { formRules, optionExclusions, stageDefaultNextAction } from "@/lib/form-rules";
import type { FieldText } from "@/lib/pipeline-labels";
import { loadComposeSetup, type ComposeSetup } from "@/lib/compose-email";
import { loadInitiativeSummary } from "@/lib/initiative/summary-server";
import type { InitiativeSummary } from "@/lib/initiative/summary";
import { loadQuickView, type QuickViewData } from "@/app/actions/quick-view";
import { loadPipelineStatus, missingForStage, type ItemStatus } from "@/lib/pipeline";
import { moveItemToStage } from "@/lib/pipeline-moves";
import { sortTasksProprietaryFirst } from "@/lib/calc/pipeline";
import { loadDealRanks } from "@/lib/pipeline";
import { computeMetrics } from "@/lib/metrics";
import { baselineFromSnapshot, loadScenario, runScenario } from "@/lib/scenarios";
import { addDaysISO } from "@/lib/calc/dates";
import { date as fmtDate, money, months as fmtMonths, num } from "@/lib/format";
import { hasUpdate0014 } from "@/lib/update-0014";
import { DB_UPDATE_NOTICE_0014 } from "@/lib/schema-guard";
import { AIInvalidReply, AIUnavailable } from "@/lib/ai/claude";
import { isAIConfigured } from "@/lib/env";
import { approveInitiativeDraft, categorySpendAverages, createInitiativeDraft, createManualDraft, readDraftState, UpdateNeeded } from "@/lib/initiative/server";
import { describeCounts, validateForApproval } from "@/lib/initiative/proposal";
import { validateStep, type DraftState } from "@/lib/initiative/draft";
import { isSetupStep } from "@/lib/window-route";
import { METRICS } from "@/lib/metrics-list";
import type { Row } from "@/lib/types";
import { goalSuggestion, pipelineSuggestion, taskSuggestion, type Suggestion } from "@/lib/suggestions";
import { firstSuggestion } from "@/lib/suggestions-server";
import { buildScenarioSummary, type ScenarioSummaryData, type SummaryColumn } from "@/lib/scenario-summary";
import { loadDocuments, loadHistory, loadLinked, loadNotes, type DocumentItem, type HistoryItem, type LinkedData, type NoteItem } from "@/lib/record-panels-data";
import { loadChecklists } from "@/components/app/checklist-panel";
import { checklistProgress } from "@/lib/checklists";

type QuickOk = Extract<QuickViewData, { ok: true }>;
export type LineItem = { table: string; id: string; title: string; due: string | null; status: string | null; note?: string | null };
type Fail = { ok: false; error: string };

export type OverviewData =
  | Fail
  | { ok: true; kind: "quick"; base: QuickOk; compose: ComposeSetup | null; commitment: boolean; context: { table: string; id: string; title: string; singular: string; next: NextAction } | null; suggestion: Suggestion | null }
  | { ok: true; kind: "initiative"; id: string; title: string; summary: InitiativeSummary; next: NextAction; today: string }
  | { ok: true; kind: "goal"; base: QuickOk; milestones: LineItem[]; tasks: LineItem[]; initiative: { id: string; title: string } | null; progress: { current: string; target: string; rule: string; met: boolean | null } | null; suggestion: Suggestion | null }
  | {
      ok: true;
      kind: "pipeline";
      base: QuickOk;
      pipeline: { id: string; name: string; kind: string | null };
      stages: { id: string; name: string; outcome: string | null }[];
      stageId: string;
      nextStage: { id: string; name: string; missing: string[] } | null;
      status: ItemStatus | null;
      itemStatus: string;
      dealType: string | null;
      stageTasks: LineItem[];
      activity: LineItem[];
      people: { label: string; table: string; id: string; title: string }[];
      compose: ComposeSetup | null;
      tomorrow: string;
      suggestion: Suggestion | null;
    }
  | { ok: true; kind: "scenario"; id: string; title: string; description: string; results: { label: string; current: string; scenario: string }[]; changes: { label: string; value: string; table: string | null; id: string | null }[] };

const fail = (error: string): Fail => ({ ok: false, error });

/** The overview (large) or quick view (medium) of one record, with what its window needs. */
export async function loadRecordOverview(table: string, id: string): Promise<OverviewData> {
  if (!getResource(table)) return fail("This kind of record cannot be shown here.");
  const { supabase: sb, ownerId } = await requireOwner();
  if (table === "initiatives") {
    const { data: row } = await sb.from("initiatives").select("*").eq("id", id).maybeSingle();
    if (!row) return fail("This initiative was not found. It may have been deleted.");
    const ctx = await loadCtx(sb, ownerId);
    const [summary, next] = await Promise.all([loadInitiativeSummary(sb, row as Row), nextActionFor(sb, table, row as Row, ctx.today)]);
    return { ok: true, kind: "initiative", id, title: String(row.name), summary, next, today: ctx.today };
  }
  if (table === "scenarios") return loadScenarioOverview(id);
  const base = await loadQuickView(table, id);
  if (!base.ok) return base;
  if (table === "goals") return goalOverview(sb, base);
  if (table === "pipeline_items") return pipelineOverview(sb, ownerId, base);
  const { data: row } = await sb.from(table).select("*").eq("id", id).maybeSingle();
  const compose = row ? await loadComposeSetup(sb, ownerId, table, row as Row) : null;
  let commitment = false;
  let context: Extract<OverviewData, { kind: "quick" }>["context"] = null;
  if (table === "tasks" && row) {
    const { count } = await sb.from("commitments").select("id", { count: "exact", head: true }).eq("record_type", "tasks").eq("record_id", id).in("status", ["open", "missed"]);
    commitment = !!count;
    context = await taskContext(sb, row as Row, base.today);
  }
  const suggestion = table === "tasks" && row ? await firstSuggestion([taskSuggestion(row as { id: string; status: string; times_moved?: number | null })]) : null;
  return { ok: true, kind: "quick", base, compose, commitment, context, suggestion };
}

/** The record a task belongs to (pipeline item, milestone, goal, initiative, or its related record) and that record's next action. */
async function taskContext(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], task: Row, today: string) {
  const pairs: [string, string | null][] = [
    ["pipeline_items", task.pipeline_item_id],
    ["milestones", task.milestone_id],
    ["goals", task.goal_id],
    ["initiatives", task.initiative_id],
    [String(task.related_type ?? ""), task.related_id],
  ];
  for (const [t, rid] of pairs) {
    if (!rid || !getResource(t)) continue;
    const { data } = await sb.from(t).select("*").eq("id", rid).maybeSingle();
    if (!data) continue;
    return { table: t, id: rid, title: titleOf(t, data as Row), singular: getResource(t)!.singular, next: await nextActionFor(sb, t, data as Row, today) };
  }
  return null;
}

async function goalOverview(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], base: QuickOk): Promise<OverviewData> {
  const { data: goal } = await sb.from("goals").select("*").eq("id", base.id).maybeSingle();
  const g = (goal ?? {}) as Row;
  const [{ data: ms }, { data: tasks }, iniRes] = await Promise.all([
    sb.from("milestones").select("id,title,due_date,status").eq("goal_id", base.id).order("due_date"),
    sb.from("tasks").select("id,title,due_date,status").eq("goal_id", base.id).order("due_date").limit(20),
    g.initiative_id ? sb.from("initiatives").select("id,name").eq("id", g.initiative_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const metrics = g.metric_key ? await computeMetrics(sb, base.today).catch(() => null) : null;
  const current = metrics && g.metric_key ? ((metrics.values as Record<string, number | null>)[g.metric_key] ?? null) : null;
  const ini = iniRes.data as Row | null;
  const progress = goalProgress(g, current === null || current === undefined ? null : Number(current));
  return {
    ok: true,
    kind: "goal",
    base,
    initiative: ini ? { id: ini.id, title: ini.name } : null,
    milestones: ((ms ?? []) as Row[]).map((m) => ({ table: "milestones", id: m.id, title: m.title, due: m.due_date, status: m.status })),
    tasks: ((tasks ?? []) as Row[]).map((t) => ({ table: "tasks", id: t.id, title: t.title, due: t.due_date, status: t.status })),
    progress,
    suggestion: await firstSuggestion([goalSuggestion({ id: base.id, status: String(g.status ?? ""), deadline: g.deadline ?? null, met: progress?.met ?? null, today: base.today })]),
  };
}

/** "Measured now" on the goal overview, in the measured number's unit, and whether the target is met now. */
function goalProgress(g: Row, current: number | null): Extract<OverviewData, { kind: "goal" }>["progress"] {
  if (!g.metric_key && (g.target_value === null || g.target_value === undefined)) return null;
  const unit = METRICS.find((m) => m.key === g.metric_key)?.unit;
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? "Not measured" : unit === "usd" ? money(v) : unit === "percent" ? `${num(v, 1)}%` : unit === "months" ? `${num(v, 1)} months` : unit === "days" ? `${num(v, 0)} days` : num(v, 2));
  const target = g.target_value === null || g.target_value === undefined ? null : Number(g.target_value);
  const met = current === null || target === null ? null : g.comparison === "gte" ? current >= target : current <= target;
  return { current: show(current), target: target === null ? "Not set" : show(target), rule: g.comparison === "gte" ? "At or above the target" : "At or below the target", met };
}

async function pipelineOverview(sb: Awaited<ReturnType<typeof requireOwner>>["supabase"], ownerId: string, base: QuickOk): Promise<OverviewData> {
  const { data: item } = await sb.from("pipeline_items").select("*").eq("id", base.id).maybeSingle();
  if (!item) return fail("This pipeline item was not found.");
  const row = item as Row;
  const ctx = await loadCtx(sb, ownerId);
  const [{ data: pipe }, { data: stages }, { data: comms }, { data: stageTasks }] = await Promise.all([
    sb.from("pipelines").select("id,name,kind").eq("id", row.pipeline_id).maybeSingle(),
    sb.from("pipeline_stages").select("*").eq("pipeline_id", row.pipeline_id).order("position"),
    sb.from("communications").select("id,occurred_at,method,subject,summary").eq("pipeline_item_id", row.id).order("occurred_at", { ascending: false }).limit(5),
    sb.from("tasks").select("id,title,due_date,status").eq("pipeline_item_id", row.id).neq("status", "skipped").order("due_date").limit(12),
  ]);
  const stageList = (stages ?? []) as Row[];
  const current = stageList.find((s) => s.id === row.stage_id);
  const next = stageList.find((s) => s.outcome !== "lost" && Number(s.position) > Number(current?.position ?? 0));
  const missing = next && row.status === "open" ? await missingForStage(sb, row, next.id) : [];
  const status = await loadPipelineStatus(sb, [row], { ownerId, tz: ctx.tz, today: ctx.today, stages: stageList }).catch(() => null);
  const ids = [row.primary_contact_id, row.source_contact_id, row.introduced_by_contact_id].filter(Boolean) as string[];
  const [{ data: contacts }, orgRes] = await Promise.all([
    ids.length ? sb.from("contacts").select("id,name").in("id", ids) : Promise.resolve({ data: [] }),
    row.organization_id ? sb.from("organizations").select("id,name").eq("id", row.organization_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const name = (cid: string | null | undefined) => ((contacts ?? []) as Row[]).find((c) => c.id === cid)?.name as string | undefined;
  const people: { label: string; table: string; id: string; title: string }[] = [];
  const addPerson = (label: string, cid: string | null | undefined) => {
    const n = name(cid);
    if (cid && n && !people.some((p) => p.id === cid && p.label === label)) people.push({ label, table: "contacts", id: cid, title: n });
  };
  addPerson("Main contact", row.primary_contact_id);
  addPerson(pipe?.kind === "consulting" ? "Lead came from" : "Deal came from", row.source_contact_id);
  addPerson("Introduced by", row.introduced_by_contact_id);
  const org = orgRes.data as Row | null;
  if (org) people.push({ label: "Organization", table: "organizations", id: org.id, title: org.name });
  return {
    ok: true,
    kind: "pipeline",
    base,
    pipeline: { id: String(pipe?.id ?? row.pipeline_id), name: String(pipe?.name ?? "Pipeline"), kind: (pipe?.kind as string | null) ?? null },
    stages: stageList.map((s) => ({ id: s.id, name: s.name, outcome: s.outcome ?? null })),
    stageId: row.stage_id,
    nextStage: next ? { id: next.id, name: next.name, missing: missing.map((m) => m.label) } : null,
    status: status?.byItem[row.id] ?? null,
    itemStatus: row.status,
    dealType: row.deal_source_type ?? null,
    stageTasks: ((stageTasks ?? []) as Row[]).map((t) => ({ table: "tasks", id: t.id, title: t.title, due: t.due_date, status: t.status })),
    activity: ((comms ?? []) as Row[]).map((c) => ({ table: "communications", id: c.id, title: c.subject || c.summary || "Communication", due: String(c.occurred_at ?? "").slice(0, 10) || null, status: null, note: c.method })),
    people,
    compose: await loadComposeSetup(sb, ownerId, "pipeline_items", row),
    tomorrow: addDaysISO(ctx.today, 1),
    suggestion: await firstSuggestion([
      pipelineSuggestion({
        id: row.id,
        open: row.status === "open",
        today: ctx.today,
        lastActivity: status?.byItem[row.id]?.lastActivity ?? null,
        nextAction: row.next_action ?? null,
        nextTask: ((stageTasks ?? []) as Row[]).find((t) => t.status === "todo")?.title ?? null,
        sourceName: name(row.source_contact_id) ?? null,
        stallDays: status?.stallDays ?? 7,
        itemName: row.name ?? null,
      }),
    ]),
  };
}

async function loadScenarioOverview(id: string): Promise<OverviewData> {
  const { supabase: sb, ownerId } = await requireOwner();
  const loaded = await loadScenario(sb, id);
  if (!loaded) return fail("This scenario was not found.");
  const { scenario, overrides } = loaded;
  const ctx = await loadCtx(sb, ownerId);
  const metrics = await computeMetrics(sb, ctx.today);
  const base = baselineFromSnapshot(metrics.snapshot);
  const horizon = Number(scenario.horizon_months) || 60;
  const cur = runScenario(base, {}, horizon).result;
  const sc = runScenario(base, overrides, horizon).result;
  const out = (r: typeof cur) => r.cashRunsOutMonth ? `Month ${r.cashRunsOutMonth} (${fmtDate(r.rows[r.cashRunsOutMonth - 1]?.date, "MMM yyyy")})` : `Not within ${horizon} months`;
  const results = [
    { label: "Monthly spending", current: money(cur.monthlySpending), scenario: money(sc.monthlySpending) },
    { label: "Monthly income", current: money(cur.monthlyIncome), scenario: money(sc.monthlyIncome) },
    { label: "Runway", current: fmtMonths(cur.runwayFormulaMonths), scenario: fmtMonths(sc.runwayFormulaMonths) },
    { label: "Cash falls below zero in", current: out(cur), scenario: out(sc) },
    { label: "Cash at the end", current: money(cur.rows[cur.rows.length - 1]?.cash ?? 0), scenario: money(sc.rows[sc.rows.length - 1]?.cash ?? 0) },
    { label: "Net worth at the end", current: money(cur.netWorthEnd), scenario: money(sc.netWorthEnd) },
    { label: "Debt payoff date", current: cur.debtPayoffDate ? fmtDate(cur.debtPayoffDate, "MMM yyyy") : cur.debtFeasible ? "No debt" : "Not paid off", scenario: sc.debtPayoffDate ? fmtDate(sc.debtPayoffDate, "MMM yyyy") : sc.debtFeasible ? "No debt" : "Not paid off" },
  ];
  const { data: inputs } = await sb.from("inputs").select("id,key,label").in("key", Object.keys(overrides).length ? Object.keys(overrides) : ["__none__"]);
  const byKey = Object.fromEntries(((inputs ?? []) as Row[]).map((i) => [i.key, i]));
  const changes = Object.entries(overrides).map(([k, v]) => ({ label: byKey[k]?.label ?? k.replace(/_/g, " "), value: num(v, 2), table: byKey[k] ? "inputs" : null, id: byKey[k]?.id ?? null }));
  return {
    ok: true,
    kind: "scenario",
    id,
    title: String(scenario.name),
    description: `${scenario.kind === "job_vs_acquisition" ? "Job vs acquisition scenario" : "Scenario"}. ${changes.length} numbers changed from the current numbers. Projected ${horizon} months.`,
    results,
    changes,
  };
}

// ---------- Editor ----------

export type EditFormData =
  | Fail
  | {
      ok: true;
      table: string;
      id: string | null;
      title: string;
      singular: string;
      initial: Row;
      refOptions: Record<string, RefOption[]>;
      hide: string[];
      require: string[];
      text: Record<string, FieldText>;
      excludeOptions: Record<string, string[]>;
      extraHidden: Record<string, string>;
    };

/** What the shared record form needs inside a window: the record (or the new record's starting values) and its options. */
export async function loadEditForm(table: string, id: string | null, prefill: Record<string, string> = {}): Promise<EditFormData> {
  const r = getResource(table);
  if (!r) return fail("This kind of record cannot be edited here.");
  if (id ? r.noEdit : r.noCreate) return fail(`This ${r.singular.toLowerCase()} cannot be ${id ? "edited" : "added"} here. Open the full page.`);
  const { supabase: sb, ownerId } = await requireOwner();
  let initial: Row = {};
  const extraHidden: Record<string, string> = {};
  if (id) {
    const { data } = await sb.from(table).select("*").eq("id", id).maybeSingle();
    if (!data) return fail("This record was not found. It may have been deleted.");
    initial = data as Row;
  } else {
    const ctx = await loadCtx(sb, ownerId);
    for (const [k, v] of Object.entries(prefill)) {
      if (k === "related_type" || k === "related_id") extraHidden[`__set_${k}`] = v;
      else initial[k] = v;
    }
    for (const f of r.fields) {
      if (initial[f.name] !== undefined) continue;
      if (f.type === "date" && ["as_of", "paid_on", "date", "due_date", "deadline"].includes(f.name) && f.required) initial[f.name] = ctx.today;
      if (f.name === "occurred_at") initial[f.name] = new Date().toISOString();
    }
    if (table === "pipeline_items" && !initial.next_action) {
      const def = await stageDefaultNextAction(sb, initial.stage_id, ctx.today);
      if (def) {
        initial.next_action = def.title;
        initial.next_action_due = initial.next_action_due ?? def.due;
      }
    }
  }
  const refTables = new Set<string>();
  for (const f of r.fields) if (f.ref) refTables.add(f.ref);
  for (const t of quickCreateRefTables(r.fields)) refTables.add(t);
  if (table === "budget_lines") refTables.add("categories");
  if (table === "organizations") ["contacts", "organizations"].forEach((t) => refTables.add(t));
  const [refOptions, rules, excludeOptions] = await Promise.all([loadRefOptions(sb, [...refTables]), formRules(sb, table, initial), optionExclusions(sb)]);
  if (!id && refOptions.entities?.length && r.fields.some((f) => f.name === "entity_id") && !initial.entity_id) {
    initial.entity_id = refOptions.entities.find((e) => e.extra?.is_default)?.id ?? refOptions.entities[0].id;
  }
  return {
    ok: true,
    table,
    id,
    title: id ? titleOf(table, initial, labelMap(refOptions)) : `Add ${r.singular.toLowerCase()}`,
    singular: r.singular,
    initial,
    refOptions,
    hide: rules.hide,
    require: rules.require,
    text: rules.text,
    excludeOptions,
    extraHidden,
  };
}

// ---------- Pipeline item actions ----------

/** Move stage from the item's window. A move with missing required details is refused with the list. */
export async function moveStageInWindow(itemId: string, stageId: string): Promise<{ ok: true } | { ok: false; error: string; missing?: string[] }> {
  const { supabase: sb, ownerId } = await requireOwner();
  const { data: item } = await sb.from("pipeline_items").select("*").eq("id", itemId).maybeSingle();
  if (!item) return fail("The item was not found.");
  if (item.stage_id === stageId) return { ok: true };
  const { missing } = await moveItemToStage(sb, item as Row, stageId);
  if (missing.length) {
    const { data: st } = await sb.from("pipeline_stages").select("name").eq("id", stageId).maybeSingle();
    return { ok: false, error: `Not moved. Add these details before moving to ${(st as Row | null)?.name ?? "this stage"}: ${missing.map((m) => m.label).join(", ")}.`, missing: missing.map((m) => m.label) };
  }
  const ctx = await loadCtx(sb, ownerId);
  await releaseSupersededNextActions(ctx, itemId);
  await refreshNextActionAlert(ctx);
  await evaluateConditions(ctx);
  return { ok: true };
}

/**
 * Log activity from the item's window: one communication with the item. On an acquisition, "CIM requested" and
 * "Contacted the deal source" count toward the Deals advanced target (the same as Log deal activity on the page).
 */
export async function logActivityInWindow(input: { itemId: string; method: string; summary: string; purpose: string }): Promise<{ ok: true; message: string } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const { data: item } = await sb.from("pipeline_items").select("*").eq("id", input.itemId).maybeSingle();
  if (!item) return fail("The item was not found.");
  const method = ["email", "call", "text", "meeting", "other"].includes(input.method) ? input.method : "other";
  const purpose = input.purpose === "cim_request" || input.purpose === "source_contact" ? input.purpose : null;
  const summary = input.summary.trim().slice(0, 2000) || null;
  if (!purpose && !summary) return fail("Write what happened in one line.");
  const contactId = (item.source_contact_id as string | null) ?? (item.primary_contact_id as string | null) ?? null;
  const subject = purpose === "cim_request" ? `CIM requested: ${item.name}` : purpose === "source_contact" ? `Contacted the deal source: ${item.name}` : `${method === "other" ? "Activity" : method.charAt(0).toUpperCase() + method.slice(1)}: ${item.name}`;
  const row: Row = { owner_id: ownerId, occurred_at: new Date().toISOString(), method, direction: "outgoing", contact_id: contactId, organization_id: item.organization_id ?? null, subject, summary, pipeline_item_id: item.id };
  if (purpose) row.purpose = purpose;
  const { data: created, error } = await sb.from("communications").insert(row).select("id").single();
  if (error) return fail(`Not saved: ${error.message}`);
  if (created) await sb.from("record_links").insert({ owner_id: ownerId, from_type: "communications", from_id: created.id, to_type: "pipeline_items", to_id: item.id, relation: "concerns" });
  await evaluateConditions(await loadCtx(sb, ownerId));
  return { ok: true, message: purpose === "cim_request" ? "CIM request logged." : purpose === "source_contact" ? "Contact with the deal source logged." : "Activity logged." };
}

// ---------- Work through tasks ----------

export type WorkTask = { id: string; title: string; due: string | null; priority: number | null; overdue: boolean };

/** Today's open tasks (due today or overdue) in the Home order: priority, then due date, proprietary deals first. */
export async function loadWorkTasks(): Promise<{ ok: true; today: string; tomorrow: string; tasks: WorkTask[] } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const ctx = await loadCtx(sb, ownerId);
  const { data } = await sb.from("tasks").select("*").eq("status", "todo").lte("due_date", ctx.today).order("priority").order("due_date").limit(100);
  const rankOf = await loadDealRanks(sb, ownerId);
  const sorted = sortTasksProprietaryFirst((data ?? []) as Row[], rankOf);
  return {
    ok: true,
    today: ctx.today,
    tomorrow: addDaysISO(ctx.today, 1),
    tasks: sorted.map((t) => ({ id: t.id, title: t.title, due: t.due_date ?? null, priority: t.priority === null || t.priority === undefined ? null : Number(t.priority), overdue: !!t.due_date && t.due_date < ctx.today })),
  };
}

/** Move to tomorrow: a regular task's due date becomes tomorrow. A commitment keeps its date (the commitment rule). */
export async function moveTaskToTomorrow(taskId: string): Promise<{ ok: true } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const { count } = await sb.from("commitments").select("id", { count: "exact", head: true }).eq("record_type", "tasks").eq("record_id", taskId).in("status", ["open", "missed"]);
  if (count) return fail("This task is a commitment, so it keeps its date. Mark it done, or give a reason in the daily close.");
  const ctx = await loadCtx(sb, ownerId);
  const { error } = await sb.from("tasks").update({ due_date: addDaysISO(ctx.today, 1) }).eq("id", taskId);
  if (error) return fail(error.message);
  await checkCommitments(ctx, false);
  return { ok: true };
}

// ---------- The task and commitment window ----------

export type TaskWindowData =
  | Fail
  | {
      ok: true;
      /** The record the window shows: a task, or a commitment on a milestone or goal (a task's commitment shows the task). */
      table: "tasks" | "commitments";
      base: QuickOk;
      tomorrow: string;
      task: { done: boolean; due: string | null; timesMoved: number } | null;
      commitment: { id: string; due: string; originalDue: string | null; status: string; missCount: number; recordType: string; recordId: string; misses: { id: string; missedOn: string; reason: string | null; resolution: string; newDue: string | null }[] } | null;
      /** Mark as commitment (tasks without one): the suggested due date. */
      markDue: string | null;
      context: Extract<OverviewData, { kind: "quick" }>["context"];
      suggestion: Suggestion | null;
      checklists: { name: string; text: string }[];
      linked: LinkedData;
      documents: DocumentItem[];
      notes: NoteItem[];
      history: HistoryItem[];
    };

/**
 * Everything the full task page shows, for the one task and commitment window (quick view of a task or commitment,
 * Work through tasks, links on Home, task lists, and Commitments): details, next required action, the record it is
 * for, the commitment and its misses, checklists, linked records, documents, notes, and change history.
 */
export async function loadTaskWindow(table: string, id: string): Promise<TaskWindowData> {
  if (table !== "tasks" && table !== "commitments") return fail("This window shows tasks and commitments.");
  const { supabase: sb, ownerId } = await requireOwner();
  let subject: "tasks" | "commitments" = table;
  let subjectId = id;
  let commitmentRow: Row | null = null;
  if (table === "commitments") {
    const { data } = await sb.from("commitments").select("*").eq("id", id).maybeSingle();
    if (!data) return fail("This commitment was not found. It may have been deleted.");
    commitmentRow = data as Row;
    // A task's commitment shows the task (with its commitment and misses), exactly as when the task is opened.
    if (commitmentRow.record_type === "tasks") {
      subject = "tasks";
      subjectId = String(commitmentRow.record_id);
    }
  }
  const base = await loadQuickView(subject, subjectId, 60);
  if (!base.ok) return base;
  const { data: rowData } = await sb.from(subject).select("*").eq("id", subjectId).maybeSingle();
  const row = (rowData ?? {}) as Row;
  if (subject === "tasks" && !commitmentRow) {
    const { data } = await sb.from("commitments").select("*").eq("record_type", "tasks").eq("record_id", subjectId).order("created_at", { ascending: false }).limit(1);
    commitmentRow = ((data ?? []) as Row[])[0] ?? null;
  }
  const ctx = await loadCtx(sb, ownerId);
  const [missRes, context, linked, documents, notes, history, lists, suggestion] = await Promise.all([
    commitmentRow ? sb.from("missed_commitments").select("*").eq("commitment_id", commitmentRow.id).order("missed_on", { ascending: false }) : Promise.resolve({ data: [] }),
    subject === "tasks" ? taskContext(sb, row, ctx.today) : Promise.resolve(null),
    loadLinked(sb, subject, subjectId),
    loadDocuments(sb, subject, subjectId),
    loadNotes(sb, subject, subjectId),
    loadHistory(sb, subject, subjectId),
    subject === "tasks" && row.template_id ? loadChecklists(sb, { templateId: row.template_id }).catch(() => null) : Promise.resolve(null),
    subject === "tasks" ? firstSuggestion([taskSuggestion(row as { id: string; status: string; times_moved?: number | null })]) : Promise.resolve(null),
  ]);
  return {
    ok: true,
    table: subject,
    base,
    tomorrow: addDaysISO(ctx.today, 1),
    task: subject === "tasks" ? { done: row.status === "done", due: row.due_date ?? null, timesMoved: Number(row.times_moved ?? 0) } : null,
    commitment: commitmentRow
      ? {
          id: String(commitmentRow.id),
          due: String(commitmentRow.due_date),
          originalDue: commitmentRow.original_due_date ?? null,
          status: String(commitmentRow.status),
          missCount: Number(commitmentRow.miss_count ?? 0),
          recordType: String(commitmentRow.record_type),
          recordId: String(commitmentRow.record_id),
          misses: ((missRes.data ?? []) as Row[]).map((m) => ({ id: String(m.id), missedOn: String(m.missed_on), reason: m.reason ?? null, resolution: String(m.resolution ?? "pending"), newDue: m.new_due_date ?? null })),
        }
      : null,
    markDue: subject === "tasks" && !commitmentRow ? row.due_date ?? null : null,
    context,
    suggestion,
    checklists: (lists?.lists ?? []).map((l) => ({ name: String(l.name ?? "Checklist"), text: checklistProgress(((lists?.items ?? []) as Row[]).filter((i) => i.checklist_id === l.id) as { checked: boolean }[]).text })),
    linked,
    documents,
    notes,
    history,
  };
}

// ---------- Step-by-step initiative setup ----------

export type SetupData =
  | Fail
  | {
      ok: true;
      id: string;
      status: string;
      prompt: string;
      manual: boolean;
      fromIdea: boolean;
      state: DraftState;
      initiatives: string[];
      categories: string[];
      categorySpend: Record<string, number>;
      today: string;
      resultHref: string | null;
      savingsIdea: { title: string; steps: string[]; estimated_monthly_savings: number; estimate_basis: string; target_label: string; current_monthly_cost: number } | null;
    };

export async function loadSetup(draftId: string): Promise<SetupData> {
  const { supabase: sb, ownerId } = await requireOwner();
  if (!(await hasUpdate0014(sb))) return fail(DB_UPDATE_NOTICE_0014);
  const { data: draft } = await sb.from("initiative_drafts").select("*").eq("id", draftId).maybeSingle();
  if (!draft) return fail("This draft was not found.");
  const state = readDraftState(draft.proposal);
  if (!state) return fail("This draft could not be read. Discard it and start again.");
  const ctx = await loadCtx(sb, ownerId);
  const [{ data: inits }, { data: cats }, spend, ideaRes] = await Promise.all([
    sb.from("initiatives").select("name").order("sort_order"),
    sb.from("categories").select("id,name,kind").order("name"),
    categorySpendAverages(sb, ownerId, ctx.today),
    draft.savings_idea_id ? sb.from("savings_ideas").select("*").eq("id", draft.savings_idea_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const expense = ((cats ?? []) as Row[]).filter((c) => c.kind === "expense");
  const idea = ideaRes.data as Row | null;
  return {
    ok: true,
    id: draft.id,
    status: draft.status,
    prompt: String(draft.prompt ?? ""),
    manual: !String(draft.prompt ?? "").trim() && draft.source === "typed",
    fromIdea: draft.source === "savings_idea",
    state,
    initiatives: ((inits ?? []) as Row[]).map((i) => i.name),
    categories: expense.map((c) => c.name),
    categorySpend: Object.fromEntries(expense.filter((c) => spend[c.id] !== undefined).map((c) => [String(c.name).toLowerCase(), spend[c.id]])),
    today: ctx.today,
    resultHref: draft.result_initiative_id ? recordHref("initiatives", draft.result_initiative_id) : null,
    savingsIdea: idea
      ? { title: idea.title, steps: (idea.steps ?? []) as string[], estimated_monthly_savings: Number(idea.estimated_monthly_savings), estimate_basis: idea.estimate_basis ?? "", target_label: idea.target_label, current_monthly_cost: Number(idea.current_monthly_cost ?? 0) }
      : null,
  };
}

function aiMessage(e: unknown): string {
  if (e instanceof AIUnavailable || e instanceof AIInvalidReply || e instanceof UpdateNeeded) return e.message;
  return `The AI request failed: ${e instanceof Error ? e.message : String(e)}`;
}

/** Step 1 (Describe): the AI drafts the initiative from a few sentences. Only the draft is saved. */
export async function startSetupDraft(description: string): Promise<{ ok: true; id: string } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const text = description.trim();
  if (text.length < 8) return fail("Describe the initiative in a sentence or more first.");
  try {
    const id = await createInitiativeDraft(sb, ownerId, text, "typed");
    return { ok: true, id };
  } catch (e) {
    return fail(aiMessage(e));
  }
}

/** Add manually: an empty draft; the setup opens at Name and purpose. */
export async function startManualDraft(): Promise<{ ok: true; id: string } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  try {
    return { ok: true, id: await createManualDraft(sb, ownerId) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function parseDraftJson(raw: string): DraftState | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && v.proposal && v.include ? (v as DraftState) : null;
  } catch {
    return null;
  }
}

/** Save on one step: that step's included items are checked, then the whole draft is kept (nothing else is created). */
export async function saveSetupStep(draftId: string, stateJson: string, step: string): Promise<{ ok: true } | Fail> {
  const { supabase: sb } = await requireOwner();
  const state = parseDraftJson(stateJson);
  if (!state) return fail("The setup sent no readable data. Close the window and open the draft again.");
  if (isSetupStep(step)) {
    const problem = validateStep(state, step);
    if (problem) return fail(problem);
  }
  const { error } = await sb.from("initiative_drafts").update({ proposal: state }).eq("id", draftId).eq("status", "draft");
  if (error) return fail(error.message);
  return { ok: true };
}

/** Approve on the last step: every included item is created in one transaction, linked to the new initiative. */
export async function approveSetup(draftId: string, stateJson: string): Promise<{ ok: true; initiativeId: string; message: string } | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const raw = parseDraftJson(stateJson);
  if (!raw) return fail("The setup sent no readable data. Close the window and open the draft again.");
  const p = validateForApproval(raw.proposal);
  if (!p.ok) return fail(`Some fields need a fix before approval: ${p.error}`);
  let mapped;
  try {
    mapped = await approveInitiativeDraft(sb, ownerId, draftId, { proposal: p.proposal, include: raw.include });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  await evaluateConditions(await loadCtx(sb, ownerId)).catch(() => null);
  const savings = mapped.estimatedMonthlySavings ? ` Estimated savings: ${money(mapped.estimatedMonthlySavings)} per month.` : "";
  const warn = mapped.warnings.length ? ` Note: ${mapped.warnings.join(" ")}` : "";
  return { ok: true, initiativeId: mapped.initiativeId, message: `Approved and saved: ${mapped.initiativeName} with ${describeCounts(mapped.counts)}.${savings}${warn}` };
}

export async function discardSetup(draftId: string): Promise<{ ok: true } | Fail> {
  const { supabase: sb } = await requireOwner();
  const { error } = await sb.from("initiative_drafts").update({ status: "discarded", decided_at: new Date().toISOString() }).eq("id", draftId).eq("status", "draft");
  if (error) return fail(error.message);
  return { ok: true };
}

/** Plan document text for the plan view (initiative overview, "Read full plan"). */
export async function loadPlanText(initiativeId: string): Promise<{ ok: true; title: string; body: string } | Fail> {
  const { supabase: sb } = await requireOwner();
  if (!(await hasUpdate0014(sb))) return fail(DB_UPDATE_NOTICE_0014);
  const { data } = await sb.from("plan_documents").select("title,body").eq("initiative_id", initiativeId).order("created_at").limit(1);
  const doc = ((data ?? []) as Row[])[0];
  return doc ? { ok: true, title: String(doc.title), body: String(doc.body ?? "") } : fail("This initiative has no plan document.");
}

/** Step 1 (Describe) of a new setup: whether the AI and update 0014 are ready, and the drafts waiting for review. */
export async function loadSetupStart(): Promise<{ ok: true; aiReady: boolean; available: boolean; drafts: { id: string; name: string; source: string; manual: boolean; created: string }[] } | Fail> {
  const { supabase: sb } = await requireOwner();
  const available = await hasUpdate0014(sb);
  const { data } = available ? await sb.from("initiative_drafts").select("id,proposal,source,prompt,created_at").eq("status", "draft").order("created_at", { ascending: false }).limit(6) : { data: [] };
  return {
    ok: true,
    aiReady: isAIConfigured(),
    available,
    drafts: ((data ?? []) as Row[]).map((d) => ({ id: d.id, name: String(d.proposal?.proposal?.initiative?.name || "Untitled draft"), source: d.source, manual: !String(d.prompt ?? "").trim() && d.source === "typed", created: d.created_at })),
  };
}

// ---------- Scenario summary ----------

/** The scenario summary window for one scenario or the scenarios being compared (src/lib/scenario-summary.ts). */
export async function loadScenarioSummary(ids: string[]): Promise<({ ok: true } & ScenarioSummaryData) | Fail> {
  const { supabase: sb, ownerId } = await requireOwner();
  const loaded = (await Promise.all(ids.slice(0, 5).map((id) => loadScenario(sb, id)))).filter((x) => x !== null);
  if (!loaded.length) return fail("The scenario was not found. It may have been deleted.");
  const ctx = await loadCtx(sb, ownerId);
  const metrics = await computeMetrics(sb, ctx.today);
  const base = baselineFromSnapshot(metrics.snapshot);
  const horizon = Math.max(12, ...loaded.map((l) => Number(l.scenario.horizon_months) || 60));
  const column = (id: string | null, name: string, overrides: Record<string, number>, h: number): SummaryColumn => {
    const r = runScenario(base, overrides, h);
    return { id, name, overrides, horizon: h, result: r.result, jva: r.jobVsAcquisition, bridge: r.bridge };
  };
  const single = loaded.length === 1;
  const columns = loaded.map((l) => column(String(l.scenario.id), String(l.scenario.name), l.overrides, single ? Number(l.scenario.horizon_months) || 60 : horizon));
  const current = column(null, "Current numbers", {}, single ? columns[0].horizon : horizon);
  const inputs = Object.fromEntries(
    (metrics.snapshot.inputs.rows as Row[]).map((i) => [i.key, { id: String(i.id), label: String(i.label), unit: i.unit ?? null, value: i.value_number === null || i.value_number === undefined ? null : Number(i.value_number) }]),
  );
  const data = buildScenarioSummary({
    columns,
    current,
    inputs,
    baseline: { starting_cash: base.cash, monthly_spending: base.monthlySpending, monthly_income: base.monthlyIncome, monthly_investment_contribution: 0, one_time_amount: 0, one_time_month: 0 },
    debts: base.debts.map((d) => ({ id: d.id, name: d.name, apr: d.apr, minPayment: d.minPayment })),
  });
  return { ok: true, ...data };
}

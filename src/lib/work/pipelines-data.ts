import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadComposeSetup, loadGmailSetup, type ComposeSetup, type GmailSetup } from "@/lib/compose-email";
import { date as fmtDate } from "@/lib/format";
import { isValidEmail } from "@/lib/email-address";
import { loadPipelineOfKind, loadWorkCtx, type Stage, type WorkCtx, type WorkPipeline } from "@/lib/work/data";
import { compareNames } from "@/lib/work/names";
import { CONSULTING_CLOSED, CONSULTING_STAGES, JOB_CLOSED, JOB_STAGES, findOutLines, noteLine, openStageIndex } from "@/lib/work/pipelines";
import { parseOpenQuestions } from "@/lib/work/questions";
import { dayInStage, type WaitLevel } from "@/lib/work/stages";
import { waitLines, waitSummary, type SavedWait, type WaitLine } from "@/lib/work/waiting";
import { loadWaitReplies, loadWaitsFor, withReplies } from "@/lib/work/waits-data";
import { commKind, commTitle, type TimelineEvent } from "@/lib/work/timeline";
import { RECORD_TASK_COLUMNS, sortTodos, toDealTodo, topTodo, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * What the Job search and Consulting pages, the opportunity and consulting record pages, and the Home rows and the
 * Job search tile read (batch B2, database updates 0022 and 0023). An opportunity is a pipeline item of the Job
 * search pipeline (kind job): the company is its name, the role is role_title, the contact is contact_name, the pay
 * range is pay_range, "What to find out" lives in open_questions_json. A consulting item is a pipeline item of the
 * Consulting pipeline (kind consulting): the client is its name, the project is what_it_does, the fee is fee, the
 * scope and the start date are in consulting_details. Both have one next action with a due date and a waiting-on.
 * Nothing here writes; the actions are in src/app/actions/pipelines.ts.
 */

export type ItemKind = "job" | "consulting";

/** One opportunity or consulting item as the pages show it. Plain data for client components. */
export type ItemRow = {
  id: string;
  kind: ItemKind;
  /** The company (job) or the client (consulting). */
  name: string;
  /** The role (job) or the project (consulting). */
  title: string | null;
  contactName: string | null;
  contactId: string | null;
  contactEmail: string | null;
  status: string;
  stageId: string | null;
  stageName: string | null;
  /** 0-based in the four open stages; -1 when closed. */
  stageIndex: number;
  dayInStage: number;
  whatItDoes: string | null;
  location: string | null;
  source: string | null;
  link: string | null;
  payRange: string | null;
  fee: number | null;
  /** Consulting: the scope and the start date (consulting_details). */
  scope: string | null;
  startDate: string | null;
  /** The one-line note (the first line of the item's notes). */
  note: string | null;
  findOut: string[];
  topTodo: { id: string; text: string } | null;
  nextAction: string | null;
  nextActionDue: string | null;
  nextActionMinutes: number | null;
  actionIsDefault: boolean;
  /** Push E2: every wait on this item, longest first; the four fields under it are the longest wait. */
  waits: WaitLine[];
  waitingOn: string | null;
  waitingSince: string | null;
  waitDays: number;
  waitLevel: WaitLevel;
  /** For the filters (the role and the contact, so Find matches them too). */
  searchText: string;
  createdAt: string;
  stageEnteredAt: string | null;
};

const ITEM_COLUMNS = "id,name,company_name,status,stage_id,pipeline_id,primary_contact_id,source,next_action,next_action_due,next_action_minutes,what_it_does,location,listing_url,role_title,contact_name,fee,pay_range,open_questions,open_questions_json,created_at,stage_entered_at,notes";
const TASK_COLUMNS = RECORD_TASK_COLUMNS;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function toTask(t: Row): DealTodo {
  return toDealTodo(t);
}

function toItemRow(kind: ItemKind, i: Row, pipe: WorkPipeline, ctx: WorkCtx, contact: Row | undefined, details: Row | undefined, todos: readonly DealTodo[] = [], saved: readonly SavedWait[] = []): ItemRow {
  const stage = i.stage_id ? pipe.byId[i.stage_id] : undefined;
  const stageName = stage?.name ?? null;
  const waits = waitLines(saved, ctx.today, ctx.threshold);
  const top = topTodo(todos);
  const defaultTitle = stage?.defaultTitle ?? null;
  const name = String(i.company_name || i.name);
  const title = kind === "job" ? (i.role_title ? String(i.role_title) : null) : i.what_it_does ? String(i.what_it_does) : null;
  const contactName = i.contact_name ? String(i.contact_name) : contact?.name ? String(contact.name) : null;
  return {
    id: String(i.id),
    kind,
    name,
    title,
    contactName,
    contactId: i.primary_contact_id ? String(i.primary_contact_id) : null,
    contactEmail: contact?.email ? String(contact.email) : null,
    status: String(i.status ?? "open"),
    stageId: stage?.id ?? null,
    stageName,
    stageIndex: openStageIndex(kind, stageName),
    dayInStage: dayInStage(i.stage_entered_at, ctx.today, (ts) => todayInTz(ctx.tz, new Date(ts))),
    whatItDoes: i.what_it_does ?? null,
    location: i.location ?? null,
    source: i.source ?? null,
    link: i.listing_url ?? null,
    payRange: i.pay_range ?? null,
    fee: num(i.fee),
    scope: details?.scope_notes ? String(details.scope_notes) : null,
    startDate: details?.start_date ? String(details.start_date).slice(0, 10) : null,
    note: noteLine(i.notes),
    findOut: findOutLines(parseOpenQuestions(i.open_questions_json, i.open_questions as string | null)),
    topTodo: top ? { id: top.id, text: top.text } : null,
    nextAction: i.next_action ?? null,
    nextActionDue: i.next_action_due ? String(i.next_action_due).slice(0, 10) : null,
    nextActionMinutes: num(i.next_action_minutes),
    actionIsDefault: !!defaultTitle && String(i.next_action ?? "").trim().toLowerCase() === defaultTitle.trim().toLowerCase(),
    waits,
    ...waitSummary(waits),
    searchText: [title, contactName, i.location].filter(Boolean).join(" "),
    createdAt: String(i.created_at),
    stageEnteredAt: i.stage_entered_at ? String(i.stage_entered_at) : null,
  };
}

async function loadItems(sb: SupabaseClient, ctx: WorkCtx, kind: ItemKind, pipe: WorkPipeline): Promise<ItemRow[]> {
  const { data, error } = await sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ctx.ownerId).eq("pipeline_id", pipe.id).limit(500);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as Row[];
  const ids = items.map((i) => String(i.id));
  const contactIds = [...new Set(items.map((i) => i.primary_contact_id).filter(Boolean))];
  const [{ data: cs }, { data: td }, { data: det }, waits] = await Promise.all([
    contactIds.length ? sb.from("contacts").select("id,name,email").in("id", contactIds) : Promise.resolve({ data: [] as Row[] }),
    ids.length ? sb.from("deal_todos").select(TASK_COLUMNS).eq("owner_id", ctx.ownerId).eq("record_type", "pipeline_items").in("record_id", ids).is("done_at", null).limit(2000) : Promise.resolve({ data: [] as Row[] }),
    ids.length && kind === "consulting" ? sb.from("consulting_details").select("item_id,scope_notes,start_date").in("item_id", ids) : Promise.resolve({ data: [] as Row[] }),
    ids.length ? loadWaitsFor(sb, ctx.ownerId, { itemIds: ids }) : Promise.resolve({ byItem: {} as Record<string, SavedWait[]> }),
  ]);
  const contacts = Object.fromEntries(((cs ?? []) as Row[]).map((c) => [String(c.id), c]));
  const details = Object.fromEntries(((det ?? []) as Row[]).map((d) => [String(d.item_id), d]));
  const todos: Record<string, DealTodo[]> = {};
  for (const t of (td ?? []) as Row[]) (todos[String(t.record_id)] ??= []).push(toTask(t));
  return items.map((i) => toItemRow(kind, i, pipe, ctx, contacts[String(i.primary_contact_id)], details[String(i.id)], todos[String(i.id)] ?? [], waits.byItem[String(i.id)]));
}

type ItemStageGroup = { stage: Stage; hint: string | null; deals: ItemRow[] };

export type PipelineBoardData = {
  available: boolean;
  today: string;
  threshold: number;
  pipeline: WorkPipeline | null;
  /** The open stages in order, each with its open items (soonest due first). */
  groups: ItemStageGroup[];
  /** The closed stages (Declined, Not chosen, Accepted; Lost, Done), newest first. */
  closed: { name: string; label: string; tone: "charcoal" | "green"; items: ItemRow[] }[];
  active: number;
};

const byDue = (a: ItemRow, b: ItemRow) => ((a.nextActionDue ?? "9999") < (b.nextActionDue ?? "9999") ? -1 : (a.nextActionDue ?? "9999") > (b.nextActionDue ?? "9999") ? 1 : compareNames(a.name, b.name));
const byRecent = (a: ItemRow, b: ItemRow) => ((a.stageEnteredAt ?? "") < (b.stageEnteredAt ?? "") ? 1 : -1);

/** The Job search or Consulting page: the open stages with their items, and the closed stages. */
export async function loadPipelineBoard(sb: SupabaseClient, ownerId: string, kind: ItemKind): Promise<PipelineBoardData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: PipelineBoardData = { available: false, today: ctx.today, threshold: ctx.threshold, pipeline: null, groups: [], closed: [], active: 0 };
  const pipe = await loadPipelineOfKind(sb, ownerId, kind);
  if (!pipe) return { ...base, available: true };
  const items = await loadItems(sb, ctx, kind, pipe);
  const open: readonly string[] = kind === "job" ? JOB_STAGES : CONSULTING_STAGES;
  const groups: ItemStageGroup[] = open.map((name) => {
    const stage = pipe.byName[name] ?? { id: name, name, position: 0, outcome: "open", defaultTitle: null, defaultDueInDays: null };
    return { stage, hint: stage.defaultTitle, deals: items.filter((i) => i.stageName === name && i.status === "open").sort(byDue) };
  });
  const closedList = kind === "job" ? JOB_CLOSED : CONSULTING_CLOSED;
  return {
    ...base,
    available: true,
    pipeline: pipe,
    groups,
    closed: closedList.map((c) => ({ name: c.name, label: c.label, tone: c.tone, items: items.filter((i) => i.stageName === c.name).sort(byRecent) })),
    active: groups.reduce((s, g) => s + g.deals.length, 0),
  };
}

type ItemPageData = {
  available: boolean;
  today: string;
  tz: string;
  threshold: number;
  item: ItemRow | null;
  timeline: TimelineEvent[];
  todos: DealTodo[];
  lastContact: { on: string; kind: string } | null;
  compose: ComposeSetup | null;
  /** The next open stage (Advance). */
  advanceTo: Stage | null;
  /** The closed stages the Decision card offers, with their ids. */
  closeTo: { name: string; label: string; stageId: string }[];
  /** False before UPDATE_PREVIEW_PUSH_E2.sql (the waits list says so and cannot save). */
  waitsReady: boolean;
};

/** The email setup for an item: to its contact record when it has an email, otherwise a typed address, logged to the item. */
function composeForItem(gmail: GmailSetup, item: ItemRow): ComposeSetup {
  const valid = !!item.contactEmail && isValidEmail(item.contactEmail);
  return {
    ...gmail,
    title: `Email about ${item.name}`,
    recipients: valid && item.contactId ? [{ contactId: item.contactId, name: item.contactName ?? "Contact", email: item.contactEmail!.trim(), role: "Contact" }] : [],
    defaultTo: valid ? item.contactEmail!.trim() : "",
    contactId: valid ? item.contactId : null,
    pipelineItemId: item.id,
    organizationId: null,
    toNote: valid ? null : item.contactName ? `${item.contactName} has no email address saved here. Type the address.` : "Type the address.",
  };
}

/** The opportunity or consulting record page: the item, its timeline, its tasks, the email setup, Advance and Close. */
export async function loadItemPage(sb: SupabaseClient, ownerId: string, kind: ItemKind, id: string): Promise<ItemPageData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: ItemPageData = { available: true, today: ctx.today, tz: ctx.tz, threshold: ctx.threshold, item: null, timeline: [], todos: [], lastContact: null, compose: null, advanceTo: null, closeTo: [], waitsReady: false };
  const pipe = await loadPipelineOfKind(sb, ownerId, kind);
  if (!pipe) return base;
  const { data: row } = await sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  const i = row as Row | null;
  if (!i) return base;
  const [{ data: contact }, { data: details }, { data: notes }, { data: comms }, { data: links }, { data: history }, { data: taskRows }, { data: full }] = await Promise.all([
    i.primary_contact_id ? sb.from("contacts").select("id,name,email").eq("id", i.primary_contact_id).maybeSingle() : Promise.resolve({ data: null }),
    kind === "consulting" ? sb.from("consulting_details").select("item_id,scope_notes,start_date").eq("item_id", id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("notes").select("id,body,kind,source_url,created_at").eq("record_type", "pipeline_items").eq("record_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,call_outcome,awaiting_log").eq("pipeline_item_id", id).order("occurred_at", { ascending: false }).limit(50),
    sb.from("record_links").select("from_id").eq("from_type", "communications").eq("to_type", "pipeline_items").eq("to_id", id),
    sb.from("stage_history").select("id,stage_id,entered_at").eq("item_id", id).order("entered_at", { ascending: false }).limit(50),
    sb.from("deal_todos").select(TASK_COLUMNS).eq("owner_id", ownerId).eq("record_type", "pipeline_items").eq("record_id", id).limit(500),
    sb.from("pipeline_items").select("*").eq("id", id).maybeSingle(),
  ]);
  const todos = sortTodos(((taskRows ?? []) as Row[]).map(toTask));
  const waits = await loadWaitsFor(sb, ownerId, { itemIds: [id] });
  const itemRow = toItemRow(kind, i, pipe, ctx, (contact as Row | null) ?? undefined, (details as Row | null) ?? undefined, todos, waits.byItem[id]);
  // Edits of Nov 5 (item 6): Replied and Clear on a wait whose email has a reply.
  const item: ItemRow = { ...itemRow, waits: withReplies(itemRow.waits, await loadWaitReplies(sb, ownerId, waits.byItem[id] ?? [], ctx.tz)) };
  const commRows = ((comms ?? []) as Row[]).filter((c) => !c.awaiting_log);
  const linkedIds = ((links ?? []) as Row[]).map((l) => l.from_id).filter((x) => !commRows.some((c) => c.id === x));
  if (linkedIds.length) {
    const { data: more } = await sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,call_outcome,awaiting_log").in("id", linkedIds);
    commRows.push(...((more ?? []) as Row[]).filter((c) => !c.awaiting_log));
  }
  const lastComm = [...commRows].filter((c) => ["email", "call", "meeting", "video", "text"].includes(String(c.method))).sort((a, b) => (String(a.occurred_at) < String(b.occurred_at) ? 1 : -1))[0];
  const stageLabel = (name: string) => {
    if (kind === "job") return name === "Contact" ? "Contact" : name === "Accepted" ? "Accepted" : name === "Declined" ? "Declined" : name === "Not chosen" ? "Not chosen" : `Moved to ${name}`;
    return name === "Lead" ? "Lead" : name === "Done" ? "Done" : name === "Lost" ? "Lost" : `Moved to ${name}`;
  };
  const timeline: TimelineEvent[] = [
    ...((notes ?? []) as Row[]).map((n) => {
      const body = String(n.body ?? "");
      const finding = n.kind === "finding";
      return { id: `note:${n.id}`, kind: finding ? ("finding" as const) : ("note" as const), when: String(n.created_at), date: fmtDate(String(n.created_at), "MMM d"), title: finding ? body.split("\n")[0].slice(0, 200) : "Note", detail: (finding ? body.split("\n").slice(1).join(" ").trim() : body.slice(0, 400)) || null, href: finding && n.source_url ? String(n.source_url) : null };
    }),
    ...commRows.map((c) => ({
      id: `comm:${c.id}`,
      kind: commKind(c.method),
      when: String(c.occurred_at),
      date: fmtDate(String(c.occurred_at), "MMM d"),
      title: commTitle(c),
      detail: [c.summary ? String(c.summary).slice(0, 240) : null, c.call_outcome ? `Next: ${String(c.call_outcome).slice(0, 160)}` : null].filter(Boolean).join(" ") || null,
      href: null,
    })),
    ...((history ?? []) as Row[]).map((h) => {
      const s = h.stage_id ? pipe.byId[h.stage_id] : null;
      return { id: `move:${h.id}`, kind: "move" as const, when: String(h.entered_at), date: fmtDate(String(h.entered_at), "MMM d"), title: s ? stageLabel(s.name) : "Added", detail: null, href: null };
    }),
  ].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  const current = item.stageId ? pipe.byId[item.stageId] : null;
  const advanceTo = current && current.outcome === "open" ? pipe.stages.find((s) => s.outcome === "open" && s.position > current.position) ?? null : null;
  const closedList = kind === "job" ? JOB_CLOSED : CONSULTING_CLOSED;
  const gmail = await loadGmailSetup(sb, ownerId);
  const compose = full ? await loadComposeSetup(sb, ownerId, "pipeline_items", full as Row).catch(() => null) : null;
  return {
    ...base,
    item,
    timeline,
    todos,
    lastContact: lastComm ? { on: todayInTz(ctx.tz, new Date(String(lastComm.occurred_at))), kind: String(lastComm.method) } : null,
    compose: compose && compose.recipients.length ? { ...compose, title: `Email about ${item.name}` } : composeForItem(gmail, item),
    advanceTo,
    closeTo: closedList.map((c) => ({ name: c.name, label: c.label, stageId: pipe.byName[c.name]?.id ?? "" })).filter((c) => c.stageId),
    waitsReady: waits.available,
  };
}

/** The Job search tile on Home and the opportunity and consulting rows on Next actions. */
export type PipelinesHome = {
  /** Open opportunities and consulting items whose next action is due today or earlier, or with none. */
  jobs: ItemRow[];
  consulting: ItemRow[];
  tile: {
    /** The soonest open item at Conversation (next conversation) and at Interview (next interview). */
    nextConversation: ItemRow | null;
    nextInterview: ItemRow | null;
    open: number;
    needsAction: number;
    waiting: number;
  };
};

export async function loadPipelinesHome(sb: SupabaseClient, ctx: WorkCtx): Promise<PipelinesHome> {
  const [jobPipe, conPipe] = await Promise.all([loadPipelineOfKind(sb, ctx.ownerId, "job"), loadPipelineOfKind(sb, ctx.ownerId, "consulting")]);
  const [jobs, consulting] = await Promise.all([jobPipe ? loadItems(sb, ctx, "job", jobPipe) : Promise.resolve([]), conPipe ? loadItems(sb, ctx, "consulting", conPipe) : Promise.resolve([])]);
  const openJobs = jobs.filter((i) => i.status === "open" && i.stageIndex >= 0);
  const openCon = consulting.filter((i) => i.status === "open" && i.stageIndex >= 0);
  const due = (i: ItemRow) => !i.nextAction || (!!i.nextActionDue && i.nextActionDue <= ctx.today);
  const soonest = (list: ItemRow[]) => [...list].sort(byDue)[0] ?? null;
  return {
    jobs: openJobs.filter(due).sort(byDue),
    consulting: openCon.filter(due).sort(byDue),
    tile: {
      nextConversation: soonest(openJobs.filter((i) => i.stageName === "Conversation")),
      nextInterview: soonest(openJobs.filter((i) => i.stageName === "Interview")),
      open: openJobs.length,
      needsAction: openJobs.filter((i) => !i.nextAction).length,
      waiting: openJobs.filter((i) => i.waitLevel !== "none").length,
    },
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { loadDocuments, type DocumentItem } from "@/lib/record-panels-data";
import { loadComposeSetup, type ComposeSetup } from "@/lib/compose-email";
import { DB_UPDATE_NOTICE_0020, DB_UPDATE_NOTICE_0021, DB_UPDATE_NOTICE_0022, DB_UPDATE_NOTICE_0023, DB_UPDATE_NOTICE_0024 } from "@/lib/schema-guard";
import { hasUpdate0020 } from "@/lib/update-0020";
import { hasUpdate0021 } from "@/lib/update-0021";
import { hasUpdate0022 } from "@/lib/update-0022";
import { hasUpdate0023 } from "@/lib/update-0023";
import { hasUpdate0024 } from "@/lib/update-0024";
import { countOutreachDue, loadOutreachHome, type OutreachHome } from "@/lib/work/outreach-data";
import { askingMultiple, checkBuyBox, earningsOf, passReasonLabel } from "@/lib/work/buy-box";
import { glanceCounts, type GlanceCounts } from "@/lib/work/home";
import { compareNames, displayName } from "@/lib/work/names";
import { parseOpenQuestions, type QuestionGroups } from "@/lib/work/questions";
import { DEFAULT_WAIT_THRESHOLD_DAYS, WORK_STAGES, dayInStage, daysWaiting, doneOutcome, nextStageName, stageIndex, waitLevel, type WaitLevel } from "@/lib/work/stages";
import { commTitle, type TimelineEvent } from "@/lib/work/timeline";
export type { TimelineEvent } from "@/lib/work/timeline";
import { sortTodos, topTodo, type DealTodo } from "@/lib/work/todos";
import type { Row } from "@/lib/types";

/**
 * Everything the Work screens read (Home, Screen listings, Deals, the deal page). One pipeline: the owner's
 * acquisition pipeline (kind acquisition). Listings are its items with screened = false and no stage; deals are its
 * screened items. Nothing here writes; the actions are in src/app/actions/work.ts. Every loader first checks database
 * updates 0020 to 0024; before them `available` is false and `notice` names the file to run.
 */

export type WorkCtx = Ctx & { threshold: number };

/** The "Database update needed" line for the first update that is missing, or null when all five are applied. */
export async function workUpdateNotice(sb: SupabaseClient): Promise<string | null> {
  if (!(await hasUpdate0020(sb))) return DB_UPDATE_NOTICE_0020;
  if (!(await hasUpdate0021(sb))) return DB_UPDATE_NOTICE_0021;
  if (!(await hasUpdate0022(sb))) return DB_UPDATE_NOTICE_0022;
  if (!(await hasUpdate0023(sb))) return DB_UPDATE_NOTICE_0023;
  if (!(await hasUpdate0024(sb))) return DB_UPDATE_NOTICE_0024;
  return null;
}

export type Stage = { id: string; name: string; position: number; outcome: string; defaultTitle: string | null; defaultDueInDays: number | null };

export type WorkPipeline = { id: string; name: string; stages: Stage[]; byName: Record<string, Stage>; byId: Record<string, Stage> };

/** One deal (a screened item) as every Work screen shows it. Plain data for client components. */
export type DealRow = {
  id: string;
  /** What the screens show: the company name when set, otherwise the listing name. */
  name: string;
  /** The listing name ("00 Industrial Filtration Distributor" until the company is named). */
  listingName: string;
  companyName: string | null;
  status: string;
  stageId: string | null;
  stageName: string | null;
  /** 0-based in the nine working stages; -1 for Passed, Lost, Closed. */
  stageIndex: number;
  nextStage: string | null;
  dayInStage: number;
  whatItDoes: string | null;
  location: string | null;
  industry: string | null;
  brokerName: string | null;
  source: string | null;
  listingUrl: string | null;
  whySelling: string | null;
  keyFinding: string | null;
  openQuestions: QuestionGroups;
  /** The first open item of the Also to do checklist (offered as the next action when the current one is Done). */
  topTodo: { id: string; text: string } | null;
  nextAction: string | null;
  nextActionDue: string | null;
  nextActionMinutes: number | null;
  /** The action is the stage's default, so Done asks about moving on. */
  actionIsDefault: boolean;
  waitingOn: string | null;
  waitingSince: string | null;
  waitDays: number;
  waitLevel: WaitLevel;
  passReason: string | null;
  passReasonLabel: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  askingPrice: number | null;
  earnings: number | null;
  earningsLabel: "EBITDA" | "SDE" | null;
  askingMultiple: string | null;
  createdAt: string;
  /** When the item entered its stage (ISO timestamp). */
  stageEnteredAt: string | null;
};

export type ListingRow = DealRow & { buyBox: { fits: boolean; label: string } };

export async function loadWorkCtx(sb: SupabaseClient, ownerId: string): Promise<WorkCtx> {
  const ctx = await loadCtx(sb, ownerId);
  const { data } = await sb.from("inputs").select("value_number").eq("owner_id", ownerId).eq("key", "waiting_threshold_days").maybeSingle();
  const n = Number((data as Row | null)?.value_number);
  return { ...ctx, threshold: Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_WAIT_THRESHOLD_DAYS };
}

/** The acquisition pipeline with its stages and each stage's default next action. Null when there is none. */
export async function loadWorkPipeline(sb: SupabaseClient, ownerId: string): Promise<WorkPipeline | null> {
  return loadPipelineOfKind(sb, ownerId, "acquisition");
}

/** A pipeline by kind (acquisition, job, consulting) with its stages and each stage's default next action. Null when there is none. */
export async function loadPipelineOfKind(sb: SupabaseClient, ownerId: string, kind: "acquisition" | "job" | "consulting"): Promise<WorkPipeline | null> {
  const { data: pipes } = await sb.from("pipelines").select("id,name,kind,sort_order,created_at").eq("owner_id", ownerId).eq("kind", kind).order("sort_order").order("created_at").limit(1);
  const pipe = ((pipes ?? []) as Row[])[0];
  if (!pipe) return null;
  const [{ data: stageRows }, { data: taskRows }] = await Promise.all([
    sb.from("pipeline_stages").select("id,name,position,outcome").eq("pipeline_id", pipe.id).order("position"),
    sb.from("stage_tasks").select("pipeline_stage_id,title,due_in_days,sort_order,is_next_action_default").eq("owner_id", ownerId).eq("is_next_action_default", true).order("sort_order").order("title"),
  ]);
  const defaults: Record<string, Row> = {};
  for (const t of (taskRows ?? []) as Row[]) if (!defaults[t.pipeline_stage_id]) defaults[t.pipeline_stage_id] = t;
  const stages: Stage[] = ((stageRows ?? []) as Row[]).map((s) => ({
    id: String(s.id),
    name: String(s.name),
    position: Number(s.position),
    outcome: String(s.outcome ?? "open"),
    defaultTitle: defaults[s.id]?.title ? String(defaults[s.id].title) : null,
    defaultDueInDays: defaults[s.id] ? Number(defaults[s.id].due_in_days) || 0 : null,
  }));
  return { id: String(pipe.id), name: String(pipe.name), stages, byName: Object.fromEntries(stages.map((s) => [s.name, s])), byId: Object.fromEntries(stages.map((s) => [s.id, s])) };
}

/** Listings waiting to be screened: shown as the badge on the Screen listings tab and in the sidebar. Null before update 0020. */
export async function countToScreen(sb: SupabaseClient, ownerId: string): Promise<number | null> {
  const { count, error } = await sb.from("pipeline_items").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("screened", false).eq("status", "open");
  if (error) return null;
  return count ?? 0;
}

/** The two badges on the Work tabs: listings to screen and people due on Outreach (null before their updates). */
export type TabCounts = { toScreen: number | null; outreachDue: number | null };

export async function loadTabCounts(sb: SupabaseClient, ownerId: string, today: string): Promise<TabCounts> {
  const [toScreen, outreachDue] = await Promise.all([countToScreen(sb, ownerId), countOutreachDue(sb, ownerId, today)]);
  return { toScreen, outreachDue };
}

const ITEM_COLUMNS = "id,name,company_name,status,stage_id,pipeline_id,primary_contact_id,source,next_action,next_action_due,next_action_minutes,what_it_does,location,industry,listing_url,broker_name,why_selling,key_finding,open_questions,open_questions_json,waiting_on,waiting_since,pass_reason,screened,created_at,stage_entered_at,notes";

const TODO_COLUMNS = "id,deal_id,text,position,done_at,created_at";

export function toTodo(t: Row): DealTodo {
  return { id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") };
}

type Loaded = { items: Row[]; financials: Record<string, Row>; contacts: Record<string, Row>; todos: Record<string, DealTodo[]> };

async function loadItems(sb: SupabaseClient, ownerId: string, pipelineId: string, screened: boolean | null): Promise<Loaded> {
  let q = sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ownerId).eq("pipeline_id", pipelineId).limit(500);
  if (screened !== null) q = q.eq("screened", screened);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const items = (data ?? []) as Row[];
  const ids = items.map((i) => i.id);
  const contactIds = [...new Set(items.map((i) => i.primary_contact_id).filter(Boolean))];
  const [{ data: fin }, { data: cs }, { data: td }] = await Promise.all([
    ids.length ? sb.from("deal_financials").select("item_id,revenue,ebitda,sde,asking_price").in("item_id", ids) : Promise.resolve({ data: [] as Row[] }),
    contactIds.length ? sb.from("contacts").select("id,name,email,organization_id").in("id", contactIds) : Promise.resolve({ data: [] as Row[] }),
    ids.length && screened !== false ? sb.from("deal_todos").select(TODO_COLUMNS).eq("owner_id", ownerId).in("deal_id", ids).is("done_at", null).limit(2000) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const todos: Record<string, DealTodo[]> = {};
  for (const t of (td ?? []) as Row[]) (todos[String(t.deal_id)] ??= []).push(toTodo(t));
  return {
    items,
    financials: Object.fromEntries(((fin ?? []) as Row[]).map((f) => [f.item_id, f])),
    contacts: Object.fromEntries(((cs ?? []) as Row[]).map((c) => [c.id, c])),
    todos,
  };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function toDealRow(i: Row, f: Row | undefined, contact: Row | undefined, pipe: WorkPipeline, ctx: WorkCtx, todos: readonly DealTodo[] = []): DealRow {
  const stage = i.stage_id ? pipe.byId[i.stage_id] : undefined;
  const stageName = stage?.name ?? null;
  const days = daysWaiting(i.waiting_since, ctx.today);
  const { amount, label } = earningsOf(f?.ebitda, f?.sde);
  const outcome = doneOutcome({ stageName, nextAction: i.next_action ?? null, defaultTitle: stage?.defaultTitle ?? null });
  const top = topTodo(todos);
  return {
    id: String(i.id),
    name: displayName({ name: String(i.name), companyName: i.company_name as string | null }),
    listingName: String(i.name),
    companyName: i.company_name ? String(i.company_name) : null,
    status: String(i.status ?? "open"),
    stageId: stage?.id ?? null,
    stageName,
    stageIndex: stageIndex(stageName),
    nextStage: nextStageName(stageName),
    dayInStage: dayInStage(i.stage_entered_at, ctx.today, (ts) => todayInTz(ctx.tz, new Date(ts))),
    whatItDoes: i.what_it_does ?? null,
    location: i.location ?? null,
    industry: i.industry ?? null,
    brokerName: i.broker_name ?? null,
    source: i.source ?? null,
    listingUrl: i.listing_url ?? null,
    whySelling: i.why_selling ?? null,
    keyFinding: i.key_finding ?? null,
    openQuestions: parseOpenQuestions(i.open_questions_json, i.open_questions as string | null),
    topTodo: top ? { id: top.id, text: top.text } : null,
    nextAction: i.next_action ?? null,
    nextActionDue: i.next_action_due ? String(i.next_action_due).slice(0, 10) : null,
    nextActionMinutes: num(i.next_action_minutes),
    actionIsDefault: outcome.kind === "ask",
    waitingOn: i.waiting_on ?? null,
    waitingSince: i.waiting_since ? String(i.waiting_since).slice(0, 10) : null,
    waitDays: days,
    waitLevel: waitLevel(i.waiting_on, days, ctx.threshold),
    passReason: i.pass_reason ?? null,
    passReasonLabel: i.pass_reason ? passReasonLabel(i.pass_reason) : null,
    contactId: i.primary_contact_id ?? null,
    contactName: contact?.name ? String(contact.name) : null,
    contactEmail: contact?.email ? String(contact.email) : null,
    revenue: num(f?.revenue),
    ebitda: num(f?.ebitda),
    sde: num(f?.sde),
    askingPrice: num(f?.asking_price),
    earnings: amount,
    earningsLabel: label,
    askingMultiple: askingMultiple(f?.asking_price, f?.ebitda, f?.sde),
    createdAt: String(i.created_at),
    stageEnteredAt: i.stage_entered_at ? String(i.stage_entered_at) : null,
  };
}

/** One listing on the Home tile: name, broker, and location. */
export type ListingTile = { id: string; name: string; meta: string };

export type WorkNowData = {
  available: boolean;
  /** The "Database update needed" line when a Work update is missing. */
  notice: string | null;
  today: string;
  tz: string;
  threshold: number;
  toScreen: number;
  /** The open deals in the nine working stages (every Home section and filter reads these). */
  deals: DealRow[];
  /** The newest three listings to screen. */
  listings: ListingTile[];
  glance: GlanceCounts;
  /** The Outreach tile and the outreach rows on Next actions (batch B). */
  outreach: OutreachHome;
};

/** Home (Work on now): the open deals in the nine stages, the newest listings to screen, and the Deals at a glance counts. */
export async function loadWorkNow(sb: SupabaseClient, ownerId: string): Promise<WorkNowData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: WorkNowData = { available: false, notice: null, today: ctx.today, tz: ctx.tz, threshold: ctx.threshold, toScreen: 0, deals: [], listings: [], glance: { active: 0, early: 0, evaluate: 0, decide: 0, waitingOver: 0, needsAction: 0 }, outreach: { counter: { count: 0, target: 10, pct: 0 }, dueToday: [], due: [], overdue: 0 } };
  const notice = await workUpdateNotice(sb);
  if (notice) return { ...base, notice };
  const [pipe, outreach] = await Promise.all([loadWorkPipeline(sb, ownerId), loadOutreachHome(sb, ctx)]);
  if (!pipe) return { ...base, available: true, outreach };
  const loaded = await loadItems(sb, ownerId, pipe.id, null);
  const rows = loaded.items.map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx, loaded.todos[i.id]));
  const deals = rows.filter((d, n) => loaded.items[n].screened !== false && d.status === "open" && d.stageIndex >= 0).sort((a, b) => compareNames(a.name, b.name));
  const listings = rows
    .filter((d, n) => loaded.items[n].screened === false && d.status === "open")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : compareNames(a.name, b.name)));
  const groups = WORK_STAGES.map((name) => ({ stage: { name }, deals: deals.filter((d) => d.stageName === name) }));
  return {
    ...base,
    available: true,
    toScreen: listings.length,
    deals,
    listings: listings.slice(0, 3).map((l) => ({ id: l.id, name: l.name, meta: [l.brokerName, l.location].filter(Boolean).join(" · ") })),
    glance: glanceCounts(groups),
    outreach,
  };
}

export type PassedRow = { id: string; name: string; reasonLabel: string; date: string; earnings: number | null; earningsLabel: "EBITDA" | "SDE" | null; location: string | null };

export type ListingsData = { available: boolean; notice: string | null; today: string; listings: ListingRow[]; passed: PassedRow[] };

/** Screen listings: the unscreened listings (newest first) and the passed list (newest first). */
export async function loadListings(sb: SupabaseClient, ownerId: string): Promise<ListingsData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: ListingsData = { available: false, notice: null, today: ctx.today, listings: [], passed: [] };
  const notice = await workUpdateNotice(sb);
  if (notice) return { ...base, notice };
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const loaded = await loadItems(sb, ownerId, pipe.id, null);
  const rows = loaded.items.map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx));
  const listings: ListingRow[] = rows
    .filter((d, n) => loaded.items[n].screened === false && d.status === "open")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : compareNames(a.name, b.name)))
    .map((d) => {
      const check = checkBuyBox({ name: d.name, whatItDoes: d.whatItDoes, industry: d.industry, location: d.location, ebitda: d.ebitda, sde: d.sde });
      return { ...d, buyBox: { fits: check.fits, label: check.label } };
    });
  const passed: PassedRow[] = rows
    .filter((d) => d.stageName === "Passed")
    .sort((a, b) => ((a.stageEnteredAt ?? "") < (b.stageEnteredAt ?? "") ? 1 : -1))
    .map((d) => ({ id: d.id, name: d.name, reasonLabel: d.passReasonLabel ?? "Passed", date: d.stageEnteredAt ? fmtDate(d.stageEnteredAt, "MMM d") : "", earnings: d.earnings, earningsLabel: d.earningsLabel, location: d.location }));
  return { ...base, available: true, listings, passed };
}

export type StageGroup = { stage: Stage; hint: string | null; deals: DealRow[] };

export type DealsData = {
  available: boolean;
  notice: string | null;
  today: string;
  threshold: number;
  groups: StageGroup[];
  counts: Record<string, number>;
  active: number;
  waitingOver: number;
  needsAction: number;
  passed: DealRow[];
  lost: DealRow[];
  closed: DealRow[];
};

/** Deals: every screened item grouped by stage in the nine's order; Passed, Lost, and Closed apart. */
export async function loadDeals(sb: SupabaseClient, ownerId: string): Promise<DealsData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: DealsData = { available: false, notice: null, today: ctx.today, threshold: ctx.threshold, groups: [], counts: {}, active: 0, waitingOver: 0, needsAction: 0, passed: [], lost: [], closed: [] };
  const notice = await workUpdateNotice(sb);
  if (notice) return { ...base, notice };
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const loaded = await loadItems(sb, ownerId, pipe.id, true);
  const deals = loaded.items.map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx, loaded.todos[i.id]));
  const byDue = (a: DealRow, b: DealRow) => (a.nextActionDue ?? "9999") < (b.nextActionDue ?? "9999") ? -1 : (a.nextActionDue ?? "9999") > (b.nextActionDue ?? "9999") ? 1 : compareNames(a.name, b.name);
  const groups: StageGroup[] = WORK_STAGES.map((name) => {
    const stage = pipe.byName[name] ?? { id: name, name, position: 0, outcome: "open", defaultTitle: null, defaultDueInDays: null };
    const list = deals.filter((d) => d.stageName === name && d.status === "open").sort(byDue);
    return { stage, hint: stage.defaultTitle, deals: list };
  });
  const active = groups.reduce((s, g) => s + g.deals.length, 0);
  const byRecent = (a: DealRow, b: DealRow) => ((a.stageEnteredAt ?? "") < (b.stageEnteredAt ?? "") ? 1 : -1);
  return {
    ...base,
    available: true,
    groups,
    counts: Object.fromEntries(groups.map((g) => [g.stage.name, g.deals.length])),
    active,
    waitingOver: groups.flatMap((g) => g.deals).filter((d) => d.waitLevel === "amber" || d.waitLevel === "red").length,
    needsAction: groups.flatMap((g) => g.deals).filter((d) => !d.nextAction).length,
    passed: deals.filter((d) => d.stageName === "Passed").sort(byRecent),
    lost: deals.filter((d) => d.stageName === "Lost").sort(byRecent),
    closed: deals.filter((d) => d.stageName === "Closed").sort(byRecent),
  };
}

/** A person the "Email these questions" message can go to: the broker (the deal's main contact) and, when known, the seller. */
export type QuestionsRecipient = { contactId: string; name: string; email: string; role: "Broker" | "Seller" | "Deal came from" | "Introduced by" | "At the organization" };

export type DealPageData = {
  available: boolean;
  notice: string | null;
  today: string;
  tz: string;
  threshold: number;
  deal: DealRow | null;
  timeline: TimelineEvent[];
  documents: DocumentItem[];
  /** The Tasks checklist (was Also to do), open items first. */
  todos: DealTodo[];
  /** The last logged email or call on this deal (the header figure): the owner's date (YYYY-MM-DD) and what kind. */
  lastContact: { on: string; kind: string } | null;
  compose: ComposeSetup | null;
  /** The email setup for "Email these questions": to the broker by default, the seller selectable when the app knows one. */
  questionsCompose: ComposeSetup | null;
  /** The next open stage after this one in the pipeline (Advance), with its id. */
  advanceTo: Stage | null;
  passedStageId: string | null;
  lostStageId: string | null;
};

/** The deal page: the deal, its timeline (notes, communications, stage moves; newest first), documents, and the email setup. */
export async function loadDealPage(sb: SupabaseClient, ownerId: string, id: string): Promise<DealPageData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: DealPageData = { available: false, notice: null, today: ctx.today, tz: ctx.tz, threshold: ctx.threshold, deal: null, timeline: [], documents: [], todos: [], lastContact: null, compose: null, questionsCompose: null, advanceTo: null, passedStageId: null, lostStageId: null };
  const notice = await workUpdateNotice(sb);
  if (notice) return { ...base, notice };
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const { data: row } = await sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  const item = row as Row | null;
  if (!item) return { ...base, available: true };
  const [{ data: fin }, { data: contact }, { data: notes }, { data: comms }, { data: links }, { data: history }, documents, { data: full }, { data: todoRows }] = await Promise.all([
    sb.from("deal_financials").select("item_id,revenue,ebitda,sde,asking_price").eq("item_id", id).maybeSingle(),
    item.primary_contact_id ? sb.from("contacts").select("id,name,email,organization_id").eq("id", item.primary_contact_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("notes").select("id,body,created_at").eq("record_type", "pipeline_items").eq("record_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,awaiting_log").eq("pipeline_item_id", id).order("occurred_at", { ascending: false }).limit(50),
    sb.from("record_links").select("from_id").eq("from_type", "communications").eq("to_type", "pipeline_items").eq("to_id", id),
    sb.from("stage_history").select("id,stage_id,entered_at").eq("item_id", id).order("entered_at", { ascending: false }).limit(50),
    loadDocuments(sb, "pipeline_items", id),
    sb.from("pipeline_items").select("*").eq("id", id).maybeSingle(),
    sb.from("deal_todos").select(TODO_COLUMNS).eq("owner_id", ownerId).eq("deal_id", id).limit(500),
  ]);
  const todos = sortTodos(((todoRows ?? []) as Row[]).map(toTodo));
  const deal = toDealRow(item, (fin as Row | null) ?? undefined, (contact as Row | null) ?? undefined, pipe, ctx, todos);
  // Communications linked through record_links but not stamped with the item (older rows).
  const commRows = ((comms ?? []) as Row[]).filter((c) => !c.awaiting_log);
  const linkedIds = ((links ?? []) as Row[]).map((l) => l.from_id).filter((x) => !commRows.some((c) => c.id === x));
  if (linkedIds.length) {
    const { data: more } = await sb.from("communications").select("id,occurred_at,method,direction,subject,summary,call_minutes,awaiting_log").in("id", linkedIds);
    commRows.push(...((more ?? []) as Row[]).filter((c) => !c.awaiting_log));
  }
  const lastComm = [...commRows].filter((c) => ["email", "call", "meeting", "video", "text"].includes(String(c.method))).sort((a, b) => (String(a.occurred_at) < String(b.occurred_at) ? 1 : -1))[0];
  const events: TimelineEvent[] = [
    ...((notes ?? []) as Row[]).map((n) => ({ id: `note:${n.id}`, kind: "note" as const, when: String(n.created_at), date: fmtDate(String(n.created_at), "MMM d"), title: String(n.body ?? "").split("\n")[0].slice(0, 140), detail: String(n.body ?? "").split("\n").slice(1).join(" ").trim() || null, href: null })),
    ...commRows.map((c) => ({
      id: `comm:${c.id}`,
      kind: (c.method === "email" ? "email" : c.method === "call" || c.method === "meeting" || c.method === "video" ? "call" : "other") as TimelineEvent["kind"],
      when: String(c.occurred_at),
      date: fmtDate(String(c.occurred_at), "MMM d"),
      title: commTitle(c),
      detail: c.summary ? String(c.summary).slice(0, 240) : null,
      href: `/records/communications/${c.id}`,
    })),
    ...((history ?? []) as Row[]).map((h) => {
      const s = h.stage_id ? pipe.byId[h.stage_id] : null;
      return { id: `move:${h.id}`, kind: "move" as const, when: String(h.entered_at), date: fmtDate(String(h.entered_at), "MMM d"), title: s ? (s.name === "Interested" ? "Interested" : s.name === "Passed" ? "Passed" : s.name === "Lost" ? "Lost" : `Moved to ${s.name}`) : "Added", detail: s?.name === "Interested" ? "From Screen listings" : null, href: null };
    }),
  ].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  const current = deal.stageId ? pipe.byId[deal.stageId] : null;
  const advanceTo = current ? pipe.stages.find((s) => s.outcome === "open" && s.position > current.position) ?? null : pipe.stages.find((s) => s.outcome === "open") ?? null;
  const compose = full ? await loadComposeSetup(sb, ownerId, "pipeline_items", full as Row).catch(() => null) : null;
  return {
    ...base,
    available: true,
    deal,
    timeline: events,
    documents,
    todos,
    lastContact: lastComm ? { on: todayInTz(ctx.tz, new Date(String(lastComm.occurred_at))), kind: String(lastComm.method) } : null,
    compose: compose ? { ...compose, title: `Email about ${deal.name}` } : null,
    questionsCompose: compose ? await questionsComposeSetup(sb, compose, deal) : null,
    advanceTo,
    passedStageId: pipe.byName.Passed?.id ?? null,
    lostStageId: pipe.byName.Lost?.id ?? null,
  };
}

/** True for a contact that reads as the seller: a role of seller or owner, or a title such as Owner, Founder, President, CEO. */
export function isSellerContact(c: { roles?: unknown; title?: unknown }): boolean {
  const roles = Array.isArray(c.roles) ? c.roles.map((r) => String(r).toLowerCase()) : [];
  if (roles.includes("seller") || roles.includes("owner")) return true;
  return /\b(owner|founder|president|ceo|seller)\b/i.test(String(c.title ?? ""));
}

/**
 * "Email these questions": the deal's main contact as the broker (the default), the seller when one of the deal's
 * people reads as the owner (selectable in the editor), and the deal's other people after them.
 */
async function questionsComposeSetup(sb: SupabaseClient, compose: ComposeSetup, deal: DealRow): Promise<ComposeSetup> {
  const ids = compose.recipients.map((r) => r.contactId);
  const { data } = ids.length ? await sb.from("contacts").select("id,roles,title").in("id", ids) : { data: [] as Row[] };
  const byId = Object.fromEntries(((data ?? []) as Row[]).map((c) => [String(c.id), c]));
  const recipients = compose.recipients.map((r) => {
    const c = byId[r.contactId];
    const seller = c ? isSellerContact(c) : false;
    const role = seller ? "Seller" : r.contactId === deal.contactId ? "Broker" : r.role;
    return { ...r, role };
  });
  // Broker first, then the seller, then the rest.
  const order = (role: string) => (role === "Broker" ? 0 : role === "Seller" ? 1 : 2);
  recipients.sort((a, b) => order(a.role) - order(b.role));
  const broker = recipients.find((r) => r.role === "Broker") ?? recipients[0] ?? null;
  return {
    ...compose,
    title: `Email these questions about ${deal.name}`,
    recipients,
    defaultTo: broker?.email ?? "",
    toNote: broker ? null : "This deal has no broker or seller with an email address. Type the address.",
  };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInTz } from "@/lib/calc/dates";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { loadDocuments, type DocumentItem } from "@/lib/record-panels-data";
import { loadComposeSetup, type ComposeSetup } from "@/lib/compose-email";
import { hasUpdate0020 } from "@/lib/update-0020";
import { askingMultiple, checkBuyBox, earningsOf, passReasonLabel } from "@/lib/work/buy-box";
import { DEFAULT_WAIT_THRESHOLD_DAYS, WORK_STAGES, dayInStage, daysWaiting, doneOutcome, nextStageName, stageIndex, waitLevel, type WaitLevel } from "@/lib/work/stages";
import type { Row } from "@/lib/types";

/**
 * Everything the Work screens read (Work on now, Screen listings, Deals, the deal page). One pipeline: the owner's
 * acquisition pipeline (kind acquisition). Listings are its items with screened = false and no stage; deals are its
 * screened items. Nothing here writes; the actions are in src/app/actions/work.ts.
 */

export type WorkCtx = Ctx & { threshold: number };

export type Stage = { id: string; name: string; position: number; outcome: string; defaultTitle: string | null; defaultDueInDays: number | null };

export type WorkPipeline = { id: string; name: string; stages: Stage[]; byName: Record<string, Stage>; byId: Record<string, Stage> };

/** One deal (a screened item) as every Work screen shows it. Plain data for client components. */
export type DealRow = {
  id: string;
  name: string;
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
  openQuestions: string | null;
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
  const { data: pipes } = await sb.from("pipelines").select("id,name,kind,sort_order,created_at").eq("owner_id", ownerId).eq("kind", "acquisition").order("sort_order").order("created_at").limit(1);
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

const ITEM_COLUMNS = "id,name,status,stage_id,pipeline_id,primary_contact_id,source,next_action,next_action_due,next_action_minutes,what_it_does,location,industry,listing_url,broker_name,why_selling,key_finding,open_questions,waiting_on,waiting_since,pass_reason,screened,created_at,stage_entered_at,notes";

type Loaded = { items: Row[]; financials: Record<string, Row>; contacts: Record<string, Row> };

async function loadItems(sb: SupabaseClient, ownerId: string, pipelineId: string, screened: boolean | null): Promise<Loaded> {
  let q = sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ownerId).eq("pipeline_id", pipelineId).limit(500);
  if (screened !== null) q = q.eq("screened", screened);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const items = (data ?? []) as Row[];
  const ids = items.map((i) => i.id);
  const contactIds = [...new Set(items.map((i) => i.primary_contact_id).filter(Boolean))];
  const [{ data: fin }, { data: cs }] = await Promise.all([
    ids.length ? sb.from("deal_financials").select("item_id,revenue,ebitda,sde,asking_price").in("item_id", ids) : Promise.resolve({ data: [] as Row[] }),
    contactIds.length ? sb.from("contacts").select("id,name,email,organization_id").in("id", contactIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
  return {
    items,
    financials: Object.fromEntries(((fin ?? []) as Row[]).map((f) => [f.item_id, f])),
    contacts: Object.fromEntries(((cs ?? []) as Row[]).map((c) => [c.id, c])),
  };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function toDealRow(i: Row, f: Row | undefined, contact: Row | undefined, pipe: WorkPipeline, ctx: WorkCtx): DealRow {
  const stage = i.stage_id ? pipe.byId[i.stage_id] : undefined;
  const stageName = stage?.name ?? null;
  const days = daysWaiting(i.waiting_since, ctx.today);
  const { amount, label } = earningsOf(f?.ebitda, f?.sde);
  const outcome = doneOutcome({ stageName, nextAction: i.next_action ?? null, defaultTitle: stage?.defaultTitle ?? null });
  return {
    id: String(i.id),
    name: String(i.name),
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
    openQuestions: i.open_questions ?? null,
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

export const NEXT_ACTIONS_SHOWN = 10;

export type WorkNowData = {
  available: boolean;
  today: string;
  threshold: number;
  toScreen: number;
  nextActions: DealRow[];
  nextActionsMore: number;
  waiting: DealRow[];
  waitingOver: number;
};

/** Work on now: next actions due today or earlier (soonest first), who you are waiting on (longest first), the counts. */
export async function loadWorkNow(sb: SupabaseClient, ownerId: string): Promise<WorkNowData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: WorkNowData = { available: false, today: ctx.today, threshold: ctx.threshold, toScreen: 0, nextActions: [], nextActionsMore: 0, waiting: [], waitingOver: 0 };
  if (!(await hasUpdate0020(sb))) return base;
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const [loaded, toScreen] = await Promise.all([loadItems(sb, ownerId, pipe.id, true), countToScreen(sb, ownerId)]);
  const deals = loaded.items.filter((i) => i.status === "open").map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx)).filter((d) => d.stageIndex >= 0);
  const due = deals.filter((d) => d.nextAction && d.nextActionDue && d.nextActionDue <= ctx.today).sort((a, b) => (a.nextActionDue! < b.nextActionDue! ? -1 : a.nextActionDue! > b.nextActionDue! ? 1 : a.name.localeCompare(b.name)));
  const waiting = deals.filter((d) => d.waitLevel !== "none").sort((a, b) => b.waitDays - a.waitDays || a.name.localeCompare(b.name));
  return {
    ...base,
    available: true,
    toScreen: toScreen ?? 0,
    nextActions: due.slice(0, NEXT_ACTIONS_SHOWN),
    nextActionsMore: Math.max(0, due.length - NEXT_ACTIONS_SHOWN),
    waiting,
    waitingOver: waiting.filter((d) => d.waitLevel === "amber" || d.waitLevel === "red").length,
  };
}

export type PassedRow = { id: string; name: string; reasonLabel: string; date: string; earnings: number | null; earningsLabel: "EBITDA" | "SDE" | null; location: string | null };

export type ListingsData = { available: boolean; today: string; listings: ListingRow[]; passed: PassedRow[] };

/** Screen listings: the unscreened listings (newest first) and the passed list (newest first). */
export async function loadListings(sb: SupabaseClient, ownerId: string): Promise<ListingsData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: ListingsData = { available: false, today: ctx.today, listings: [], passed: [] };
  if (!(await hasUpdate0020(sb))) return base;
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const loaded = await loadItems(sb, ownerId, pipe.id, null);
  const rows = loaded.items.map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx));
  const listings: ListingRow[] = rows
    .filter((d, n) => loaded.items[n].screened === false && d.status === "open")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name.localeCompare(b.name)))
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
  const base: DealsData = { available: false, today: ctx.today, threshold: ctx.threshold, groups: [], counts: {}, active: 0, waitingOver: 0, needsAction: 0, passed: [], lost: [], closed: [] };
  if (!(await hasUpdate0020(sb))) return base;
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const loaded = await loadItems(sb, ownerId, pipe.id, true);
  const deals = loaded.items.map((i) => toDealRow(i, loaded.financials[i.id], loaded.contacts[i.primary_contact_id], pipe, ctx));
  const byDue = (a: DealRow, b: DealRow) => (a.nextActionDue ?? "9999") < (b.nextActionDue ?? "9999") ? -1 : (a.nextActionDue ?? "9999") > (b.nextActionDue ?? "9999") ? 1 : a.name.localeCompare(b.name);
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

/** "Email received: CIM received", "Call with Rachel Kim, 20 min" (no "Call:" twice), "Meeting: ...". */
function commTitle(c: Row): string {
  const kind = c.method === "email" ? (c.direction === "incoming" ? "Email received" : "Email sent") : c.method === "call" ? "Call" : c.method === "meeting" ? "Meeting" : c.method === "video" ? "Video call" : "Contact";
  const subject = c.subject ? String(c.subject).slice(0, 120) : "";
  if (!subject) return kind;
  if (new RegExp(`^${c.method === "email" ? "email" : kind}\\b`, "i").test(subject)) return subject;
  return `${kind}: ${subject}`;
}

export type TimelineEvent = { id: string; kind: "note" | "email" | "call" | "move" | "other"; when: string; date: string; title: string; detail: string | null; href: string | null };

export type DealPageData = {
  available: boolean;
  today: string;
  threshold: number;
  deal: DealRow | null;
  timeline: TimelineEvent[];
  documents: DocumentItem[];
  compose: ComposeSetup | null;
  /** The next open stage after this one in the pipeline (Advance), with its id. */
  advanceTo: Stage | null;
  passedStageId: string | null;
  lostStageId: string | null;
};

/** The deal page: the deal, its timeline (notes, communications, stage moves; newest first), documents, and the email setup. */
export async function loadDealPage(sb: SupabaseClient, ownerId: string, id: string): Promise<DealPageData> {
  const ctx = await loadWorkCtx(sb, ownerId);
  const base: DealPageData = { available: false, today: ctx.today, threshold: ctx.threshold, deal: null, timeline: [], documents: [], compose: null, advanceTo: null, passedStageId: null, lostStageId: null };
  if (!(await hasUpdate0020(sb))) return base;
  const pipe = await loadWorkPipeline(sb, ownerId);
  if (!pipe) return { ...base, available: true };
  const { data: row } = await sb.from("pipeline_items").select(ITEM_COLUMNS).eq("owner_id", ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  const item = row as Row | null;
  if (!item) return { ...base, available: true };
  const [{ data: fin }, { data: contact }, { data: notes }, { data: comms }, { data: links }, { data: history }, documents, { data: full }] = await Promise.all([
    sb.from("deal_financials").select("item_id,revenue,ebitda,sde,asking_price").eq("item_id", id).maybeSingle(),
    item.primary_contact_id ? sb.from("contacts").select("id,name,email,organization_id").eq("id", item.primary_contact_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("notes").select("id,body,created_at").eq("record_type", "pipeline_items").eq("record_id", id).order("created_at", { ascending: false }).limit(50),
    sb.from("communications").select("id,occurred_at,method,direction,subject,summary").eq("pipeline_item_id", id).order("occurred_at", { ascending: false }).limit(50),
    sb.from("record_links").select("from_id").eq("from_type", "communications").eq("to_type", "pipeline_items").eq("to_id", id),
    sb.from("stage_history").select("id,stage_id,entered_at").eq("item_id", id).order("entered_at", { ascending: false }).limit(50),
    loadDocuments(sb, "pipeline_items", id),
    sb.from("pipeline_items").select("*").eq("id", id).maybeSingle(),
  ]);
  const deal = toDealRow(item, (fin as Row | null) ?? undefined, (contact as Row | null) ?? undefined, pipe, ctx);
  // Communications linked through record_links but not stamped with the item (older rows).
  const commRows = (comms ?? []) as Row[];
  const linkedIds = ((links ?? []) as Row[]).map((l) => l.from_id).filter((x) => !commRows.some((c) => c.id === x));
  if (linkedIds.length) {
    const { data: more } = await sb.from("communications").select("id,occurred_at,method,direction,subject,summary").in("id", linkedIds);
    commRows.push(...((more ?? []) as Row[]));
  }
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
    compose: compose ? { ...compose, title: `Email about ${deal.name}` } : null,
    advanceTo,
    passedStageId: pipe.byName.Passed?.id ?? null,
    lostStageId: pipe.byName.Lost?.id ?? null,
  };
}

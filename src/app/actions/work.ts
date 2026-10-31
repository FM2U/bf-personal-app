"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { addDaysISO } from "@/lib/calc/dates";
import { loadCtx, refreshNextActionAlert, type Ctx } from "@/lib/engine/helpers";
import { checkCommitments, releaseSupersededNextActions } from "@/lib/engine/tasks";
import { evaluateConditions } from "@/lib/engine/rules";
import { AIUnavailable, callClaude, cleanDeep, parseJsonFromText, textOf } from "@/lib/ai/claude";
import { AI_SYSTEM_BASE } from "@/lib/ai/claude";
import { missingForStage } from "@/lib/pipeline";
import { DB_UPDATE_NOTICE_0020, isMissingSchemaError } from "@/lib/schema-guard";
import { hasUpdate0020 } from "@/lib/update-0020";
import { checkBuyBox, dealSourceTypeFor, isPassReason, LISTING_SOURCES, parseMoneyText } from "@/lib/work/buy-box";
import { listingNumbers, listingPrompt, readListingFields, type ListingFields } from "@/lib/work/listing-text";
import { loadWorkPipeline, type WorkPipeline } from "@/lib/work/data";
import type { Row } from "@/lib/types";

/**
 * The Work module's saves (batch A). Every action returns { ok: false, error } instead of throwing, so what the
 * owner typed stays on the screen with the message. Pages re-read on the next load (router.refresh in the component).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0020 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx; pipe: WorkPipeline } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  if (!(await hasUpdate0020(supabase))) return fail(DB_UPDATE_NOTICE_0020);
  const pipe = await loadWorkPipeline(supabase, ownerId);
  if (!pipe) return fail("There is no acquisition pipeline. Add one under More, Pipelines.");
  const ctx = await loadCtx(supabase, ownerId);
  return { sb: supabase, ctx, pipe };
}

async function dealOf(sb: SupabaseClient, ctx: Ctx, pipe: WorkPipeline, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This deal was not found.");
  const { data } = await sb.from("pipeline_items").select("*").eq("owner_id", ctx.ownerId).eq("id", id).eq("pipeline_id", pipe.id).maybeSingle();
  return (data as Row | null) ?? fail("This deal was not found. It may have been deleted.");
}

const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;

function done() {
  revalidatePath("/", "layout");
}

/**
 * The inline actions (Pass, Interested, Done, Later, Chase) do not revalidate here: a revalidation would re-render
 * the list in the same round trip and remove the row before its confirmation line is seen. The row shows the line,
 * then refreshes the page itself (router.refresh).
 */
function doneQuietly() {}

// ---------- Screen listings ----------

/** "Fill from text": the pasted listing text goes to the AI; the fields come back for the owner to correct. */
export async function fillListingFromText(text: string): Promise<{ ok: true; fields: ListingFields } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const body = String(text ?? "").trim();
  if (body.length < 20) return fail("Paste the listing text first (the broker email or the page), then press Fill from text.");
  try {
    const msg = await callClaude({ sb: supabase, ownerId, purpose: "listing_fields", system: AI_SYSTEM_BASE, messages: [{ role: "user", content: listingPrompt(body) }], maxTokens: 600 });
    const fields = readListingFields(cleanDeep(parseJsonFromText<unknown>(textOf(msg))));
    if (!fields) return fail("The AI could not read the fields from this text. Fill them in by hand.");
    return { ok: true, fields };
  } catch (e) {
    const why = e instanceof AIUnavailable ? e.message : "The AI request failed.";
    return fail(`${why} Fill the fields in by hand.`);
  }
}

/** Save to the list: a new listing (a pipeline item with screened = false and no stage) and its numbers. */
export async function createListing(input: ListingFields): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const name = clean(input.name, 200);
  if (!name) return fail("Give the listing a name.");
  const source = (LISTING_SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : "Other";
  const numbers = listingNumbers(input);
  const row: Row = {
    owner_id: ctx.ownerId,
    pipeline_id: pipe.id,
    stage_id: null,
    name,
    screened: false,
    source,
    deal_source_type: dealSourceTypeFor(source),
    what_it_does: clean(input.what_it_does, 300),
    broker_name: clean(input.broker_name, 200),
    location: clean(input.location, 120),
    industry: clean(input.industry, 120),
    listing_url: clean(input.listing_url, 500),
  };
  row.buy_box_note = checkBuyBox({ name, whatItDoes: row.what_it_does, industry: row.industry, location: row.location, ebitda: numbers.ebitda, sde: numbers.sde }).label;
  const { data, error } = await sb.from("pipeline_items").insert(row).select("id").single();
  if (error) return notSaved(error);
  const id = String(data.id);
  if (numbers.revenue !== null || numbers.ebitda !== null || numbers.sde !== null || numbers.asking_price !== null) {
    const { error: e2 } = await sb.from("deal_financials").insert({ owner_id: ctx.ownerId, item_id: id, revenue: numbers.revenue, ebitda: numbers.ebitda, sde: numbers.sde, asking_price: numbers.asking_price });
    if (e2) return fail(`The listing was saved, but its numbers were not: ${e2.message}. Open the deal to add them.`);
  }
  done();
  return { ok: true, id };
}

/** Pass (a listing or a deal): the reason is kept, the item goes to Passed and counts as screened. */
export async function passDeal(id: string, reason: string): Promise<{ ok: true } | Fail> {
  if (!isPassReason(reason)) return fail("Choose one of the pass reasons.");
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const passed = pipe.byName.Passed;
  if (!passed) return fail('The acquisition pipeline has no "Passed" stage. Run the database update again.');
  const { error } = await sb.from("pipeline_items").update({ stage_id: passed.id, pass_reason: reason, screened: true, waiting_on: null, waiting_since: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, item.id);
  await refreshNextActionAlert(ctx);
  doneQuietly();
  return { ok: true };
}

/** Interested: the listing becomes a deal at Interested; the stage's default next action is set, due tomorrow. */
export async function markInterested(id: string): Promise<{ ok: true; nextAction: string | null; due: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const stage = pipe.byName.Interested;
  if (!stage) return fail('The acquisition pipeline has no "Interested" stage. Run the database update again.');
  const title = stage.defaultTitle ?? "Sign the NDA and ask the broker for a call";
  const due = addDaysISO(ctx.today, stage.defaultDueInDays ?? 1);
  // The next action is written here too (the stage trigger sets the same values when it is empty).
  const { error } = await sb.from("pipeline_items").update({ stage_id: stage.id, screened: true, pass_reason: null, next_action: title, next_action_due: due, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await evaluateConditions(ctx).catch(() => null);
  doneQuietly();
  return { ok: true, nextAction: title, due };
}

// ---------- Next actions (Work on now and the deal page) ----------

/** Marks the task that mirrors the deal's next action done (so its commitment counts as kept). */
async function completeActionTask(sb: SupabaseClient, ctx: Ctx, item: Row) {
  if (!item.next_action) return;
  await sb.from("tasks").update({ status: "done" }).eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  await checkCommitments(ctx, false);
}

/**
 * Done. With `move`, the deal goes to the next stage and gets that stage's default next action and due date;
 * otherwise the action is cleared and the deal stays where it is ("Needs a next action").
 */
export async function completeNextAction(id: string, move: boolean): Promise<{ ok: true; movedTo: string | null } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  await completeActionTask(sb, ctx, item);
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = move && current ? pipe.stages.find((st) => st.outcome === "open" && st.position > current.position) ?? null : null;
  let update: Row;
  if (move && next) {
    update = { stage_id: next.id, next_action: next.defaultTitle, next_action_due: next.defaultTitle ? addDaysISO(ctx.today, next.defaultDueInDays ?? 0) : null, next_action_minutes: null, waiting_on: null, waiting_since: null };
  } else {
    update = { next_action: null, next_action_due: null, next_action_minutes: null };
  }
  const { error } = await sb.from("pipeline_items").update(update).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, item.id);
  await refreshNextActionAlert(ctx);
  await evaluateConditions(ctx).catch(() => null);
  doneQuietly();
  return { ok: true, movedTo: move && next ? next.name : null };
}

/** Later: the next action's due date moves to the chosen date (tomorrow by default); the mirrored task moves with it. */
export async function deferNextAction(id: string, date: string): Promise<{ ok: true; due: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const due = DATE.test(String(date ?? "")) ? String(date) : addDaysISO(ctx.today, 1);
  if (due <= ctx.today) return fail("Choose a date after today.");
  const { error } = await sb.from("pipeline_items").update({ next_action_due: due }).eq("id", item.id);
  if (error) return notSaved(error);
  await moveActionTask(sb, ctx, item, due);
  doneQuietly();
  return { ok: true, due };
}

/** The task that mirrors the next action (and its commitment) takes the new date too. */
async function moveActionTask(sb: SupabaseClient, ctx: Ctx, item: Row, due: string) {
  if (!item.next_action) return;
  const { data: tasks } = await sb.from("tasks").select("id,times_moved").eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  for (const t of (tasks ?? []) as Row[]) {
    await sb.from("tasks").update({ due_date: due, times_moved: Number(t.times_moved ?? 0) + 1 }).eq("id", t.id);
    await sb.from("commitments").update({ due_date: due }).eq("record_type", "tasks").eq("record_id", t.id).eq("status", "open");
  }
}

export type NextActionInput = { action: string; due: string; minutes: string | number | null; waitingOn: string; waitingSince: string };

/** The Next action card on the deal page: action, due date, block minutes, waiting on, waiting since. */
export async function saveNextAction(id: string, input: NextActionInput): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const action = clean(input.action, 300);
  const due = DATE.test(String(input.due ?? "")) ? String(input.due) : null;
  const minutesRaw = input.minutes === null || input.minutes === undefined || input.minutes === "" ? null : Number(String(input.minutes).replace(/[^\d.]/g, ""));
  const minutes = minutesRaw === null || !Number.isFinite(minutesRaw) ? null : Math.max(0, Math.min(1440, Math.round(minutesRaw)));
  const waitingOn = clean(input.waitingOn, 120);
  const since = DATE.test(String(input.waitingSince ?? "")) ? String(input.waitingSince) : ctx.today;
  if (action && !due) return fail("Give the next action a due date.");
  const { error } = await sb.from("pipeline_items").update({ next_action: action, next_action_due: action ? due : null, next_action_minutes: minutes, waiting_on: waitingOn, waiting_since: waitingOn ? since : null }).eq("id", item.id);
  if (error) return notSaved(error);
  if (action && due && action === item.next_action && due !== item.next_action_due) await moveActionTask(sb, ctx, item, due);
  await releaseSupersededNextActions(ctx, item.id);
  await refreshNextActionAlert(ctx);
  done();
  return { ok: true };
}

/** Chase sent: the wait starts again today (the email itself is logged by the send). */
export async function resetWaiting(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  if (!item.waiting_on) return { ok: true };
  const { error } = await sb.from("pipeline_items").update({ waiting_since: ctx.today }).eq("id", item.id);
  if (error) return notSaved(error);
  doneQuietly();
  return { ok: true };
}

// ---------- The deal page ----------

export async function saveFindings(id: string, input: { keyFinding: string; openQuestions: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const { error } = await sb.from("pipeline_items").update({ key_finding: clean(input.keyFinding, 300), open_questions: cleanText(input.openQuestions, 4000) }).eq("id", item.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

export type FactsInput = { name: string; whatItDoes: string; location: string; revenue: string; ebitda: string; sde: string; askingPrice: string; industry: string; brokerName: string; source: string; whySelling: string; listingUrl: string };

/** The Facts card: the deal's text facts and its numbers (deal_financials). */
export async function saveFacts(id: string, input: FactsInput): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const name = clean(input.name, 200);
  if (!name) return fail("The deal needs a name.");
  const source = (LISTING_SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : clean(input.source, 80);
  const { error } = await sb
    .from("pipeline_items")
    .update({
      name,
      what_it_does: clean(input.whatItDoes, 300),
      location: clean(input.location, 120),
      industry: clean(input.industry, 120),
      broker_name: clean(input.brokerName, 200),
      source,
      why_selling: clean(input.whySelling, 300),
      listing_url: clean(input.listingUrl, 500),
    })
    .eq("id", item.id);
  if (error) return notSaved(error);
  const numbers = { revenue: parseMoneyText(input.revenue), ebitda: parseMoneyText(input.ebitda), sde: parseMoneyText(input.sde), asking_price: parseMoneyText(input.askingPrice) };
  const { data: fin } = await sb.from("deal_financials").select("id").eq("item_id", item.id).maybeSingle();
  const { error: e2 } = fin ? await sb.from("deal_financials").update(numbers).eq("id", fin.id) : await sb.from("deal_financials").insert({ owner_id: ctx.ownerId, item_id: item.id, ...numbers });
  if (e2) return fail(`The facts were saved, but the numbers were not: ${e2.message}`);
  // The old task titles follow the name.
  if (name !== item.name && item.next_action) await sb.from("tasks").update({ title: `${name}: ${item.next_action}` }).eq("owner_id", ctx.ownerId).eq("pipeline_item_id", item.id).eq("status", "todo").eq("title", `${item.name}: ${item.next_action}`);
  done();
  return { ok: true };
}

/** Advance to the next stage (the Decision card). Blocked when the stage's required details are missing. */
export async function advanceDeal(id: string): Promise<{ ok: true; stage: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const current = item.stage_id ? pipe.byId[item.stage_id] : null;
  const next = pipe.stages.find((st) => st.outcome === "open" && st.position > (current?.position ?? 0));
  if (!next) return fail("This deal is at the last stage.");
  const missing = await missingForStage(sb, item, next.id);
  if (missing.length) return fail(`Not moved to ${next.name}: add ${missing.map((m) => m.label).join(", ")} in Facts first.`);
  // The stage trigger sets the default next action when the current one was the old stage's default or empty.
  const { error } = await sb.from("pipeline_items").update({ stage_id: next.id, waiting_on: null, waiting_since: null, next_action_minutes: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, item.id);
  await refreshNextActionAlert(ctx);
  await evaluateConditions(ctx).catch(() => null);
  done();
  return { ok: true, stage: next.name };
}

/** Lost: the seller chose someone else or withdrew (a stage, separate from Passed). */
export async function markLost(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const lost = pipe.byName.Lost;
  if (!lost) return fail('The acquisition pipeline has no "Lost" stage. Run the database update again.');
  const { error } = await sb.from("pipeline_items").update({ stage_id: lost.id, waiting_on: null, waiting_since: null }).eq("id", item.id);
  if (error) return notSaved(error);
  await releaseSupersededNextActions(ctx, item.id);
  await refreshNextActionAlert(ctx);
  done();
  return { ok: true };
}

/** Add a note (the Timeline card). */
export async function addDealNote(id: string, body: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx, pipe } = s;
  const item = await dealOf(sb, ctx, pipe, id);
  if (isFail(item)) return item;
  const text = cleanText(body, 4000);
  if (!text) return fail("Type the note first.");
  const { error } = await sb.from("notes").insert({ owner_id: ctx.ownerId, record_type: "pipeline_items", record_id: item.id, body: text });
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

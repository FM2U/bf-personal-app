"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { DB_UPDATE_NOTICE_0025, DB_UPDATE_NOTICE_PUSH_D, DB_UPDATE_NOTICE_PUSH_F, isMissingSchemaError } from "@/lib/schema-guard";
import { recordWorkEvent } from "@/lib/accountability/events";
import { buildEndOfDay, factsSince, loadEodRow, loadFacts, loadOwedFromSkipped, loadPartners, loadSentCopies, loadTargets, cleanEditedAt, EDITED_AT_KEY, GENERAL_COPY, type EndOfDayPage, type PartnerCopy } from "@/lib/accountability/data";
import { cleanPartnerSettings } from "@/lib/accountability/partners";
import { replyTaskText } from "@/lib/gmail-replies";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition } from "@/lib/work/todos";
import { reasonsPrompt, validateReasonsReply, type ReasonDraft } from "@/lib/accountability/ask-ai";
import { cleanChoices, cleanNotes, cleanReview, hasChoices, NOTE_MAX, NOTES_KEY, SECTION_ORDER, type ReportChoices, type ReportNotes, type SectionKey, type WeeklyReview } from "@/lib/accountability/report-sections";
import { personHref } from "@/lib/work/people";
import { countable, isCountKey, owedReasons, type Cadence } from "@/lib/accountability/targets";
import { loadWorkCtx } from "@/lib/work/data";
import { loadWeeklyFocus } from "@/lib/work/projects-data";
import type { Row } from "@/lib/types";
import { signOffName } from "@/lib/work/names";
import { approveAndSendCore, type SendResult } from "@/lib/accountability/send-core";

/**
 * Targets, End of day, and Reports (batch C, database update 0025): add, edit, remove (archive) a target and its
 * Commitment switch; the reasons, tomorrow's line, and the edited report of a day; Approve and send (the email goes
 * through the existing Gmail sending to the partner's address, the sent report becomes a partner report, and the day
 * is marked sent); Skip today; the Rosara focus marked done. Every action returns { ok: false, error } instead of
 * throwing.
 */

type Fail = { ok: false; error: string; reply?: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isFail = (v: unknown): v is Fail => !!v && typeof v === "object" && (v as Fail).ok === false;
const notSaved = (e: { message?: string | null } | null | undefined) => fail(isMissingSchemaError(e) ? DB_UPDATE_NOTICE_0025 : `Not saved: ${e?.message ?? "try again."}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const notice = null;
  if (notice) return fail(notice);
  return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
}

function done() {
  revalidatePath("/", "layout");
}

// ---------- Targets ----------

type TargetInput = { name: string; key: string; cadence: string; number: number | string; commitment: boolean };

export async function addTarget(input: TargetInput): Promise<{ ok: true; id: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!isCountKey(input.key)) return fail("Choose what the target counts.");
  const cadence: Cadence = input.cadence === "day" ? "day" : "week";
  const n = Math.round(Number(input.number));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return fail("The number must be between 1 and 1000.");
  const name = clean(input.name, 80) || countable(input.key).label;
  const { data: rows } = await sb.from("targets").select("id,name,counts_key,archived_at,sort_order").eq("owner_id", ctx.ownerId).limit(500);
  const all = (rows ?? []) as Row[];
  const same = all.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
  const sortOrder = all.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0) + 1;
  if (same) {
    if (!same.archived_at && same.counts_key) return fail(`A target named "${name}" is already on the list.`);
    // The name exists from an earlier version (or was removed): that row comes back with the new definition.
    const { error } = await sb.from("targets").update({ counts_key: input.key, period: cadence, minimum_count: n, is_commitment: !!input.commitment, active: true, archived_at: null, sort_order: sortOrder }).eq("id", same.id);
    if (error) return notSaved(error);
    done();
    return { ok: true, id: String(same.id) };
  }
  const { data, error } = await sb.from("targets").insert({ owner_id: ctx.ownerId, name, period: cadence, minimum_count: n, active_weekdays: [1, 2, 3, 4, 5], count_source: "manual", is_commitment: !!input.commitment, show_to_partners: false, active: true, sort_order: sortOrder, counts_key: input.key, notes: "Counted from what you do in the app (Targets, batch C)." }).select("id").single();
  if (error) return notSaved(error);
  done();
  return { ok: true, id: String(data.id) };
}

async function targetOf(sb: SupabaseClient, ctx: Ctx, id: string): Promise<Row | Fail> {
  if (!UUID.test(id)) return fail("This target was not found.");
  const { data } = await sb.from("targets").select("id,name,counts_key,period,minimum_count,is_commitment,archived_at").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? fail("This target was not found.");
}

/** Edit: the number and the cadence. */
export async function editTarget(id: string, input: { number: number | string; cadence: string }): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const n = Math.round(Number(input.number));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return fail("The number must be between 1 and 1000.");
  const { error } = await sb.from("targets").update({ minimum_count: n, period: input.cadence === "day" ? "day" : "week" }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** Remove target: archived (nothing is deleted; its history stays and Add a target with the same name brings it back). */
export async function removeTarget(id: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const { error } = await sb.from("targets").update({ archived_at: new Date().toISOString(), active: false }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/** The Commitment switch. */
export async function setCommitment(id: string, on: boolean): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const t = await targetOf(sb, ctx, id);
  if (isFail(t)) return t;
  const { error } = await sb.from("targets").update({ is_commitment: !!on }).eq("id", t.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- End of day ----------

/** The day's row, created when missing (open). */
async function ensureEod(sb: SupabaseClient, ctx: Ctx, day: string): Promise<Row | Fail> {
  if (!DATE.test(day)) return fail("The day was not valid.");
  const { data } = await sb.from("end_of_day").select("*").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle();
  if (data) return data as Row;
  const { data: made, error } = await sb.from("end_of_day").insert({ owner_id: ctx.ownerId, day }).select("*").single();
  if (error) return notSaved(error);
  return made as Row;
}

/** The reason boxes (one or all, from "Same reason for all"): merged into the day's reasons by target id. */
export async function saveReasons(day: string, reasons: Record<string, string>): Promise<{ ok: true; owed: number } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const current = (row.reasons && typeof row.reasons === "object" ? (row.reasons as Record<string, string>) : {}) ?? {};
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(reasons ?? {})) {
    if (!/^(owed:\d{4}-\d{2}-\d{2}:)?[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
    const text = clean(v, 300);
    if (text) next[k] = text;
    else delete next[k];
  }
  const { error } = await sb.from("end_of_day").update({ reasons: next }).eq("id", row.id);
  if (error) return notSaved(error);
  // A reason owed from a skipped day is written on that day's row too (its report never went; the record is kept there).
  for (const [k, v] of Object.entries(next)) {
    const m = k.match(/^owed:(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_-]{1,64})$/);
    if (!m) continue;
    const { data: prev } = await sb.from("end_of_day").select("id,reasons").eq("owner_id", ctx.ownerId).eq("day", m[1]).maybeSingle();
    if (prev) await sb.from("end_of_day").update({ reasons: { ...((prev as Row).reasons as Record<string, string>), [m[2]]: v } }).eq("id", (prev as Row).id);
  }
  const page = await loadPage(sb, ctx, day);
  done();
  return { ok: true, owed: owedCount(page) };
}

export async function saveTomorrow(day: string, text: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const line = String(text ?? "").replace(/\r\n/g, "\n").trim().slice(0, 600);
  const { error } = await sb.from("end_of_day").update({ tomorrow_line: line || null }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

/**
 * The Weekly review on Friday's End of day (push D): the three answers, merged by key (what went well, what slipped,
 * next week's focus). They go into Friday's report to each partner who gets the Weekly review section.
 */
export async function saveWeeklyReview(day: string, patch: Partial<WeeklyReview>): Promise<{ ok: true; review: WeeklyReview } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  if (!("weekly_review" in row)) return fail(DB_UPDATE_NOTICE_PUSH_D);
  const review = cleanReview({ ...cleanReview(row.weekly_review), ...Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => ["well", "slipped", "focus"].includes(k))) });
  const { error } = await sb.from("end_of_day").update({ weekly_review: review }).eq("id", row.id);
  if (error) return fail(isMissingSchemaError(error) ? DB_UPDATE_NOTICE_PUSH_D : `Not saved: ${error.message}`);
  done();
  return { ok: true, review };
}

/** The copy a per-partner action is about: that partner's, or the first one when none is named. */
function copyOf(page: EndOfDayPage, contactId: string | null | undefined): PartnerCopy | null {
  if (contactId === GENERAL_COPY) return page.general;
  return page.copies.find((c) => c.partner.id === contactId) ?? (contactId ? null : page.copies[0] ?? null);
}

/**
 * The review window (push B edits): one partner's choices for today's copy, saved with the day's End of day row by
 * contact id (the include boxes, what Change shows, the 3 deals of Top 3, each section's text from Edit). An empty
 * choice set goes back to the built report. The other partners' choices are kept. Applies to today only.
 */
export async function saveReportChoices(day: string, contactId: string | null, choices: ReportChoices): Promise<{ ok: true; html: string; choices: ReportChoices } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const before = await loadPage(sb, ctx, day);
  const copy = copyOf(before, contactId);
  if (!copy) return fail("No partner gets the report today, so there is nothing to change.");
  if (copy.sentAt) return fail(`The report to ${copy.partner.first} was already sent. A sent report never changes.`);
  const cleaned = cleanChoices(choices);
  const all = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
  // When each section's Edit was saved (2026-11-08): an Edit saved before a send today is marked in the window.
  const was = cleanChoices(all[copy.partner.id]).edits ?? {};
  const at = cleanEditedAt(all[EDITED_AT_KEY]);
  const now = new Date().toISOString();
  for (const k of new Set([...Object.keys(was), ...Object.keys(cleaned.edits ?? {})]) as Set<SectionKey>) {
    const v = cleaned.edits?.[k];
    if (!v) delete at[`${copy.partner.id}:${k}`];
    else if (v !== was[k]) at[`${copy.partner.id}:${k}`] = now;
  }
  if (Object.keys(at).length) all[EDITED_AT_KEY] = at;
  else delete all[EDITED_AT_KEY];
  if (hasChoices(cleaned)) all[copy.partner.id] = cleaned;
  else delete all[copy.partner.id];
  const { error } = await sb.from("end_of_day").update({ report_edits: all, report_html: null, report_edited: false }).eq("id", row.id);
  if (error) return notSaved(error);
  const page = await loadPage(sb, ctx, day);
  done();
  const after = copyOf(page, copy.partner.id);
  return { ok: true, html: after?.html ?? page.reportHtml, choices: cleaned };
}

/**
 * "+ Note" on a report section (approved 2026-11-05): a few lines under that section, for today's report only. Kept
 * once for the day by section key, in the End of day row's report_edits under "_notes" next to each partner's choices
 * (keyed by contact id), so every partner's copy that includes the section gets the same note. An empty text removes
 * the note. A note on a section left out of a copy stays saved but is not sent in that copy.
 */
export async function saveReportNote(day: string, section: string, text: string): Promise<{ ok: true; notes: ReportNotes } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!(SECTION_ORDER as string[]).includes(section)) return fail("This section was not found.");
  if (String(text ?? "").length > NOTE_MAX * 2) return fail(`A note can be up to ${NOTE_MAX} characters.`);
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const all = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
  const notes = cleanNotes({ ...cleanNotes(all[NOTES_KEY]), [section]: String(text ?? "") });
  if (!notes[section as SectionKey]) delete notes[section as SectionKey];
  if (Object.keys(notes).length) all[NOTES_KEY] = notes;
  else delete all[NOTES_KEY];
  const at = cleanEditedAt(all[EDITED_AT_KEY]);
  if (notes[section as SectionKey]) at[`note:${section}`] = new Date().toISOString();
  else delete at[`note:${section}`];
  if (Object.keys(at).length) all[EDITED_AT_KEY] = at;
  else delete all[EDITED_AT_KEY];
  const { error } = await sb.from("end_of_day").update({ report_edits: all, report_html: null, report_edited: false }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true, notes };
}

/**
 * The partner checkbox on End of day (fix list item 1, approved 2026-11-06): unticked, that partner is skipped today
 * only; tomorrow every partner is ticked again. One setting for the day, shown on the report card and in the View
 * report window. A partner already sent to today cannot be unticked.
 */
export async function setPartnerToday(day: string, contactId: string, on: boolean): Promise<{ ok: true; skipped: string[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(contactId ?? ""))) return fail("This partner was not found.");
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (!("skipped_partners" in row)) return fail(DB_UPDATE_NOTICE_PUSH_F);
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const sent = await loadSentCopies(sb, ctx.ownerId, day);
  if (!on && sent.some((c) => c.contactId === contactId)) return fail("This partner already got today's report.");
  const now = new Set(Array.isArray(row.skipped_partners) ? (row.skipped_partners as unknown[]).map(String) : []);
  if (on) now.delete(contactId);
  else now.add(contactId);
  const skipped = [...now];
  const { error } = await sb.from("end_of_day").update({ skipped_partners: skipped }).eq("id", row.id);
  if (error) return fail(isMissingSchemaError(error) ? DB_UPDATE_NOTICE_PUSH_F : `Not saved: ${error.message}`);
  done();
  return { ok: true, skipped };
}

/**
 * "Use the short version" (the Ask AI panel on the report): that partner's copy keeps Targets with the reasons, the
 * week, and the tomorrow line for today; the other sections are left out today (each can be ticked back).
 */
export async function putShortReport(day: string, contactId?: string | null): Promise<{ ok: true; html: string; choices: ReportChoices } | Fail> {
  const page = await (async () => {
    const s = await setup();
    if (isFail(s)) return s;
    return loadPage(s.sb, s.ctx, day);
  })();
  if (isFail(page)) return page;
  const copy = copyOf(page, contactId);
  if (!copy) return fail("No partner gets the report today.");
  const prev = copy.report.choices ?? {};
  return saveReportChoices(day, copy.partner.id, { ...prev, include: { ...(prev.include ?? {}), today: false, top: false, active: false, waiting: false, jobs: false, targets: true, week: true, tomorrow: true } });
}

async function loadPage(sb: SupabaseClient, ctx: Ctx, day: string): Promise<EndOfDayPage> {
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle, row, partners, owed, sent] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, factsSince(day)), loadEodRow(sb, ctx.ownerId, day), loadPartners(sb, ctx.ownerId), loadOwedFromSkipped(sb, ctx.ownerId, day), loadSentCopies(sb, ctx.ownerId, day)]);
  return buildEndOfDay({ targets, bundle, row, partners, sent, owed, day, tz: ctx.tz, threshold: wctx.threshold, eodTime: wctx.eodTime, signName: signOffName(wctx.profile?.display_name), autoSend: wctx.autoSend });
}

function owedCount(page: EndOfDayPage): number {
  const todays = owedReasons(page.judged, page.reasons).length;
  const prev = page.owed ? page.owed.items.filter((j) => !String(page.reasons[`owed:${page.owed!.day}:${j.targetId}`] ?? "").trim()).length : 0;
  return todays + prev;
}

/**
 * Approve and send (push B; one place for every send since 2026-11-08, src/lib/accountability/send-core.ts): to every
 * partner due today and ticked, then the people saved under Also send to. With reasons still owed and `force` false it
 * stops with "N commitments have no reason yet".
 */
export async function approveAndSend(day: string, requestId: string, force = false, intro: string | null = null): Promise<SendResult> {
  const s = await setup();
  if (isFail(s)) return { ok: false, error: s.error, reason: "invalid" };
  if (!REQUEST_ID.test(String(requestId ?? ""))) return { ok: false, error: "The send request was not valid. Reload the page and try again.", reason: "invalid" };
  return approveAndSendCore(s.sb, s.ctx, day, requestId, force, intro);
}

/** Skip today with a reason: nothing is sent; the judgment is kept so the owed reasons are asked on the next End of day. */
export async function skipToday(day: string, reason: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const page = await loadPage(sb, ctx, day);
  const why = clean(reason, 200) || "No reason given";
  const { error } = await sb.from("end_of_day").update({ status: "skipped", skipped_at: new Date().toISOString(), skip_reason: why, judged: page.judged }).eq("id", row.id);
  if (error) return notSaved(error);
  done();
  return { ok: true };
}

// ---------- The Rosara focus marked done ----------

/** "Done" on the Weekly focus bar: a work event for today (the Rosara focus done target counts it this week). */
export async function markFocusDone(): Promise<{ ok: true } | Fail> {
  const { supabase, ownerId } = await requireOwner();
  const ctx = await loadCtx(supabase, ownerId);
  const focus = await loadWeeklyFocus(supabase, ownerId);
  const ok = await recordWorkEvent(supabase, ownerId, { kind: "focus_done", recordType: "inputs", recordId: null, label: focus || "Weekly focus", on: ctx.today });
  if (!ok) return fail(DB_UPDATE_NOTICE_0025);
  done();
  return { ok: true };
}

// ---------- The AI drafts on End of day ----------

function aiError(e: unknown): Fail {
  if (e instanceof AIInvalidReply) return e.cutOff ? fail(AI_REPLY_CUT_OFF) : { ok: false, error: `${AI_REPLY_UNUSABLE} Try again.`, reply: replySnippet(e.reply) };
  return fail(e instanceof AIUnavailable ? e.message : `The AI request failed: ${e instanceof Error ? e.message : String(e)}`);
}

/** "Draft the reasons for the missed commitments": one line per missed Commitment, from what the day shows. */
export async function draftReasons(day: string): Promise<{ ok: true; drafts: ReasonDraft[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!DATE.test(day)) return fail("The day was not valid.");
  const page = await loadPage(sb, ctx, day);
  const asked = page.judged.filter((j) => j.judged && !j.met && j.commitment);
  if (!asked.length) return fail("No missed commitment asks for a reason today.");
  try {
    const drafts = await callForJson<ReasonDraft[]>({ sb, ownerId: ctx.ownerId, purpose: "eod_reasons", prompt: reasonsPrompt(page, asked), maxTokens: 1500, shape: "items", validate: (v) => validateReasonsReply(cleanDeep(v), asked) });
    return { ok: true, drafts };
  } catch (e) {
    return aiError(e);
  }
}

// ---------- A partner's report settings (the Reports card on their page) and replies ----------

/** The Reports card: the weekdays the partner gets the End of day report and the sections they get. */
export async function savePartnerReports(contactId: string, input: { days: number[]; sections: string[] }): Promise<{ ok: true; days: number[]; sections: string[] } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(contactId ?? ""))) return fail("This person was not found.");
  const { data } = await sb.from("contacts").select("id,outreach_role,report_sections").eq("owner_id", ctx.ownerId).eq("id", contactId).maybeSingle();
  const c = data as Row | null;
  if (!c) return fail("This person was not found.");
  if (c.outreach_role !== "accountability_partner") return fail("Only an accountability partner gets the report. Set the role in Facts first.");
  const clean = cleanPartnerSettings(input, c.report_sections);
  if (!clean.ok) return fail(clean.error);
  const { error } = await sb.from("contacts").update({ report_days: clean.days, report_sections: clean.sections }).eq("id", contactId);
  if (error) return notSaved(error);
  done();
  return { ok: true, days: clean.days, sections: clean.sections };
}

/** "Make a task from this" under a reply on Reports: a task on the partner's page with the reply's first words. */
export async function taskFromReply(contactId: string, first: string, text: string): Promise<{ ok: true; href: string } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!UUID.test(String(contactId ?? ""))) return fail("The person who replied was not found.");
  const { data } = await sb.from("contacts").select("id,name").eq("owner_id", ctx.ownerId).eq("id", contactId).maybeSingle();
  if (!data) return fail("The person who replied was not found.");
  const line = replyTaskText(clean(first, 40) || String((data as Row).name).split(" ")[0], String(text ?? "")).slice(0, TODO_MAX_LENGTH);
  const { data: existing } = await sb.from("deal_todos").select("id,text,position,done_at,created_at").eq("owner_id", ctx.ownerId).eq("record_type", "contacts").eq("record_id", contactId).limit(500);
  const rows = ((existing ?? []) as Row[]).map((t) => ({ id: String(t.id), text: String(t.text ?? ""), position: Number(t.position ?? 0), doneAt: t.done_at ? String(t.done_at) : null, createdAt: String(t.created_at ?? "") }));
  if (rows.some((t) => !t.doneAt && t.text === line)) return { ok: true, href: personHref(contactId) };
  const { error } = await sb.from("deal_todos").insert({ owner_id: ctx.ownerId, record_type: "contacts", record_id: contactId, text: line, position: nextTodoPosition(rows) });
  if (error) return notSaved(error);
  done();
  return { ok: true, href: personHref(contactId) };
}

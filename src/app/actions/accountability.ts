"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { AI_REPLY_CUT_OFF, AI_REPLY_UNUSABLE, AIInvalidReply, AIUnavailable, callForJson, cleanDeep, replySnippet } from "@/lib/ai/claude";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { DB_UPDATE_NOTICE_0025, DB_UPDATE_NOTICE_PUSH_D, DB_UPDATE_NOTICE_PUSH_F, isMissingSchemaError } from "@/lib/schema-guard";
import { recordWorkEvent } from "@/lib/accountability/events";
import { cleanOpening, loadEndOfDay, loadSentCopies, OPENING_KEY, OPENING_MAX, cleanEditedAt, EDITED_AT_KEY, GENERAL_COPY, SECTION_EDITS_KEY, type EndOfDayPage, type PartnerCopy } from "@/lib/accountability/data";
import { cleanPartnerSettings } from "@/lib/accountability/partners";
import { replyTaskText } from "@/lib/gmail-replies";
import { TODO_MAX_LENGTH } from "@/lib/work/questions";
import { nextTodoPosition } from "@/lib/work/todos";
import { reasonsPrompt, validateReasonsReply, type ReasonDraft } from "@/lib/accountability/ask-ai";
import { cleanChoices, cleanNotes, cleanReview, hasChoices, NOTE_MAX, NOTES_KEY, SECTION_ORDER, SECTION_ORDER_OLD, type ReportChoices, type ReportNotes, type SectionKey, type WeeklyReview } from "@/lib/accountability/report-sections";
import { personHref } from "@/lib/work/people";
import { countable, isCountKey, owedReasons, type Cadence } from "@/lib/accountability/targets";
import { loadWeeklyFocus } from "@/lib/work/projects-data";
import type { Row } from "@/lib/types";
import { approveAndSendCore, type SendResult } from "@/lib/accountability/send-core";
import { cleanDrafts, DRAFTS_KEY, NOW_MAX } from "@/lib/accountability/report-drafts";
import { editEod } from "@/lib/accountability/eod-write";
import { ACTIVITY_DROPPED_KEY, cleanDropped, type ActivityRow } from "@/lib/accountability/activity";
import { dayCalendarRows, refreshCalendarActivity } from "@/lib/accountability/calendar-activity";
import { handLoggedRowIds, loadDayCalendar, syncCalendarMeetings } from "@/lib/accountability/calendar-meetings-data";
import { recordOfRow } from "@/lib/accountability/report-worked";
import { writeReportDrafts } from "@/lib/accountability/report-drafts-run";

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

/** The report's opening paragraph on End of day (v8, 2026-11-15): a few lines on the day, under the greeting. */
export async function saveOpening(day: string, text: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (String(text ?? "").length > OPENING_MAX * 2) return fail(`The opening can be up to ${OPENING_MAX} characters.`);
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const t = cleanOpening(text);
  const r = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    if (t) all[OPENING_KEY] = t;
    else delete all[OPENING_KEY];
    // Typed over (or cleared): no longer an AI draft (step 4, 2026-11-15).
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    if (drafts.opening) all[DRAFTS_KEY] = { ...drafts, opening: false };
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!r.ok) return fail(r.error);
  done();
  return { ok: true };
}

/** "Redraft" on End of day (step 4, 2026-11-15): the AI writes again what is empty or still its draft. */
export async function redraftReport(day: string): Promise<{ ok: true; wrote: { opening: boolean; tomorrow: boolean; today: number } } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const r = await writeReportDrafts(sb, ctx, day);
  if (!r.ok) return fail(r.error);
  done();
  return r;
}

/** "Keep" on an AI draft (the opening, tomorrow's line, or one Today line, or every Today line with no id): it is yours now. */
export async function keepDraft(day: string, part: "opening" | "tomorrow" | "today", id?: string | null): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const r = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    if (part === "opening") drafts.opening = false;
    else if (part === "tomorrow") drafts.tomorrow = false;
    else for (const [k, n] of Object.entries(drafts.today)) if (!id || k === String(id).toLowerCase()) drafts.today[k] = { ...n, ai: false };
    all[DRAFTS_KEY] = drafts;
    return { edits: all };
  });
  if (!r.ok) return fail(r.error);
  done();
  return { ok: true };
}

/** A record's Today line typed on End of day (release 4): saved as yours; empty goes back to the kept rows of Today's activity. */
export async function saveTodayLine(day: string, rawId: string, text: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const id = String(rawId ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail("This record was not found.");
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const t = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NOW_MAX);
  const r = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    if (t) drafts.today[id] = { text: t, ai: false };
    else delete drafts.today[id];
    all[DRAFTS_KEY] = drafts;
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!r.ok) return fail(r.error);
  done();
  return { ok: true };
}

export async function saveTomorrow(day: string, text: string): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const line = String(text ?? "").replace(/\r\n/g, "\n").trim().slice(0, 600);
  // Typed over (or cleared): no longer an AI draft (step 4, 2026-11-15).
  const r = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    const drafts = cleanDrafts(all[DRAFTS_KEY]);
    if (drafts.tomorrow) all[DRAFTS_KEY] = { ...drafts, tomorrow: false };
    return { edits: all, patch: { tomorrow_line: line || null } };
  });
  if (!r.ok) return fail(r.error);
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
  const saved = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    // Edits are saved on their own, once for every copy (saveSectionEdit, 2026-11-16): this saves only include, Change
    // and Top picks. An Edit saved before then on this copy is kept as it was.
    const own = cleanChoices(all[copy.partner.id]);
    const rest: ReportChoices = { ...cleaned };
    delete rest.edits;
    const next: ReportChoices = own.edits ? { ...rest, edits: own.edits } : rest;
    if (hasChoices(next)) all[copy.partner.id] = next;
    else delete all[copy.partner.id];
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!saved.ok) return fail(saved.error);
  const page = await loadPage(sb, ctx, day);
  done();
  const after = copyOf(page, copy.partner.id);
  return { ok: true, html: after?.html ?? page.reportHtml, choices: cleaned };
}

/**
 * Edit on a report section (Bram, 2026-11-16): the section's text rewritten for today, saved once for the day and used
 * in every copy that includes the section, like + Note. Null takes the Edit away ("Use the app's text"), also an Edit
 * saved before then on one partner's copy, so every copy shows the app's text again.
 */
export async function saveSectionEdit(day: string, section: string, text: string | null): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (![...SECTION_ORDER, ...SECTION_ORDER_OLD].includes(section as SectionKey)) return fail("This section was not found.");
  const t = text === null ? null : String(text).replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (t !== null && t.length > 6000) return fail("An edited section can be up to 6000 characters.");
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const key = section as SectionKey;
  const saved = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    const shared = cleanChoices({ edits: all[SECTION_EDITS_KEY] }).edits ?? {};
    const at = cleanEditedAt(all[EDITED_AT_KEY]);
    if (t && t.trim()) {
      // When it was saved (2026-11-08): an Edit saved before a send today is marked in the window.
      if (shared[key] !== t) at[`edit:${key}`] = new Date().toISOString();
      shared[key] = t;
    } else {
      delete shared[key];
      delete at[`edit:${key}`];
      // An older Edit kept on one partner's copy (before 2026-11-16) goes too.
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith("_") && k !== GENERAL_COPY) continue;
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        const c = cleanChoices(v);
        delete at[`${k}:${key}`];
        if (!c.edits?.[key]) continue;
        delete c.edits[key];
        if (!Object.keys(c.edits).length) delete c.edits;
        if (hasChoices(c)) all[k] = c;
        else delete all[k];
      }
    }
    if (Object.keys(shared).length) all[SECTION_EDITS_KEY] = shared;
    else delete all[SECTION_EDITS_KEY];
    if (Object.keys(at).length) all[EDITED_AT_KEY] = at;
    else delete all[EDITED_AT_KEY];
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!saved.ok) return fail(saved.error);
  done();
  return { ok: true };
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
  let notes: ReportNotes = {};
  const saved = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    notes = cleanNotes({ ...cleanNotes(all[NOTES_KEY]), [section]: String(text ?? "") });
    if (!notes[section as SectionKey]) delete notes[section as SectionKey];
    if (Object.keys(notes).length) all[NOTES_KEY] = notes;
    else delete all[NOTES_KEY];
    const at = cleanEditedAt(all[EDITED_AT_KEY]);
    if (notes[section as SectionKey]) at[`note:${section}`] = new Date().toISOString();
    else delete at[`note:${section}`];
    if (Object.keys(at).length) all[EDITED_AT_KEY] = at;
    else delete all[EDITED_AT_KEY];
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!saved.ok) return fail(saved.error);
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
  // v8 (2026-11-15): the short version keeps the opening, Acquisition, the week (Fridays) and tomorrow.
  const short = copy.report.layout === "v8" ? { opening: true, acquisition: true, jobs: false, consulting: false, startup: false, review: true, tomorrow: true } : { today: false, top: false, active: false, waiting: false, jobs: false, targets: true, week: true, tomorrow: true };
  return saveReportChoices(day, copy.partner.id, { ...prev, include: { ...(prev.include ?? {}), ...short } });
}

async function loadPage(sb: SupabaseClient, ctx: Ctx, day: string): Promise<EndOfDayPage> {
  return loadEndOfDay(sb, ctx, day);
}

function owedCount(page: EndOfDayPage): number {
  // The new layout (2026-11-15) sends no targets, so no reason is asked before sending; they stay on End of day.
  if (page.v8) return 0;
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

// ---------- Today's activity (release 3b, Bram 2026-11-16) ----------

/** Keep or drop one row of Today's activity on End of day (a meeting that did not happen). Saved with the day. */
export async function setActivityKept(day: string, id: string, keep: boolean, /** The row's record page, so a Drop takes back the record's AI Today line (release 4). */ recordHref?: string | null): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  const key = String(id ?? "").slice(0, 200);
  if (!key) return fail("This row was not found.");
  const row = await ensureEod(sb, ctx, day);
  if (isFail(row)) return row;
  if (row.status !== "open") return fail(`Today is already ${row.status}.`);
  const r = await editEod(sb, ctx.ownerId, day, ({ edits: all }) => {
    const dropped = new Set(cleanDropped(all[ACTIVITY_DROPPED_KEY]));
    if (keep) dropped.delete(key);
    else dropped.add(key);
    if (dropped.size) all[ACTIVITY_DROPPED_KEY] = [...dropped];
    else delete all[ACTIVITY_DROPPED_KEY];
    // Release 4: a Drop takes back the record's Today line while it is still the AI's (it may name what was dropped);
    // the report then lists the kept rows, and Redraft writes the line again. A line you typed or kept stays.
    const rec = !keep ? recordOfRow({ href: recordHref ?? null }) : null;
    if (rec) {
      const drafts = cleanDrafts(all[DRAFTS_KEY]);
      if (drafts.today[rec.id]?.ai) {
        delete drafts.today[rec.id];
        all[DRAFTS_KEY] = drafts;
      }
    }
    return { edits: all, patch: { report_html: null, report_edited: false } };
  });
  if (!r.ok) return fail(r.error);
  // Push K: a calendar row dropped takes its meeting off the person's record; kept again, the meeting is saved again.
  if (key.startsWith("cal:")) await syncCalendarMeetings(sb, ctx, day).catch(() => false);
  // No full page reload: the card shows the change at once; the report (release 4) is read again in the background.
  done();
  return { ok: true };
}

/**
 * The day's Google Calendar events that belong in Today's activity (release 3b; src/lib/accountability/calendar-activity.ts).
 * Read after End of day shows, so the page opens at its normal speed. Release 4: on an open day the rows are also saved
 * with the day for the report; `saved` says they changed, so the page reads the report again.
 */
export async function calendarActivity(day: string): Promise<{ ok: true; status: string; rows: ActivityRow[]; saved: boolean } | Fail> {
  const s = await setup();
  if (isFail(s)) return s;
  const { sb, ctx } = s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return fail("This day was not found.");
  // Today's row is made when missing (as any save on End of day does), so the rows are saved from the first visit.
  const row = day === ctx.today ? await ensureEod(sb, ctx, day) : (((await sb.from("end_of_day").select("status").eq("owner_id", ctx.ownerId).eq("day", day).maybeSingle()).data as Row | null) ?? null);
  const open = !!row && !isFail(row) && row.status === "open";
  const r = open ? await refreshCalendarActivity(sb, ctx, day) : { ...(await dayCalendarRows(sb, ctx, day)), saved: false };
  if (r.saved) done();
  // Push K: an event whose meeting was logged by hand shows as that logged meeting only. (An event the app saved as a
  // meeting shows as the page's own row of the same id; the card leaves the calendar row out while that row is there.)
  const byHand = handLoggedRowIds((await loadDayCalendar(sb, ctx, day, r.rows).catch(() => null))?.comms ?? []);
  return { ok: true, status: r.status, rows: r.rows.filter((x) => !byHand.has(x.id)), saved: r.saved };
}

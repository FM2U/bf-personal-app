"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "@/lib/auth";
import { loadCtx, type Ctx } from "@/lib/engine/helpers";
import { isValidEmail } from "@/lib/email-address";
import { cleanExtras, loadEndOfDay, loadPartners } from "@/lib/accountability/data";
import { REPORT_SECTIONS, type ReportSectionKey } from "@/lib/accountability/partners";
import type { ReportData } from "@/lib/accountability/report-email";
import { baseFor, saveExtrasCore, sendExtras, sendReportCore, type SendReportResult, type SendReportTo } from "@/lib/accountability/send-core";
import { date as fmtDate } from "@/lib/format";
import type { Row } from "@/lib/types";

/**
 * Send a report (Bram, 2026-11-07; claude/2026-11-07-part-b-fix-list.md, design A). From End of day or Reports: today's
 * report (as it stands now) or an earlier sent day's, to partners, any contact with an email address, or a new address;
 * the sections to include; a short note of your own under the greeting. Each send goes through Gmail like Approve and
 * send, is kept as a partner report copy (so replies show on Reports and the person's timeline), and is logged on the
 * person's timeline. Sending today's report counts the day as sent; resending an earlier day changes nothing about it.
 * A new address is saved as a contact unless that box is unticked (then it is sent only, with nothing kept).
 */

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export type SendReportDay = { day: string; label: string; today: boolean; sent: boolean };
export type SendReportPerson = { id: string; name: string; email: string; partner: boolean; org: string | null };
export type SendReportSetup = { ok: true; today: string; days: SendReportDay[]; people: SendReportPerson[]; sections: { key: ReportSectionKey; label: string; hint: string | null }[] };

async function setup(): Promise<{ sb: SupabaseClient; ctx: Ctx } | Fail> {
  try {
    const { supabase, ownerId } = await requireOwner();
    return { sb: supabase, ctx: await loadCtx(supabase, ownerId) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sign in again.");
  }
}

/** What the window offers: today and the sent days (newest first), everyone with an email address, the sections. */
export async function sendReportSetup(): Promise<SendReportSetup | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  const { sb, ctx } = s;
  const [{ data: days }, { data: people }, partners] = await Promise.all([
    sb.from("end_of_day").select("day,status").eq("owner_id", ctx.ownerId).eq("status", "sent").order("day", { ascending: false }).limit(90),
    sb.from("contacts").select("id,name,email,organization_id,archived_at").eq("owner_id", ctx.ownerId).not("email", "is", null).is("archived_at", null).order("name").limit(3000),
    loadPartners(sb, ctx.ownerId),
  ]);
  const orgIds = [...new Set(((people ?? []) as Row[]).map((p) => p.organization_id).filter(Boolean).map(String))];
  const { data: orgs } = orgIds.length ? await sb.from("organizations").select("id,name").in("id", orgIds) : { data: [] as Row[] };
  const orgName = new Map(((orgs ?? []) as Row[]).map((o) => [String(o.id), String(o.name)]));
  const partnerIds = new Set(partners.map((p) => p.id));
  const sent = ((days ?? []) as Row[]).map((r) => String(r.day).slice(0, 10)).filter((d) => d !== ctx.today);
  return {
    ok: true,
    today: ctx.today,
    days: [{ day: ctx.today, label: `Today, ${fmtDate(ctx.today, "EEE MMM d")}`, today: true, sent: false }, ...sent.map((d) => ({ day: d, label: fmtDate(d, "EEE MMM d, yyyy"), today: false, sent: true }))],
    people: ((people ?? []) as Row[])
      .filter((p) => isValidEmail(String(p.email ?? "")))
      .map((p) => ({ id: String(p.id), name: String(p.name ?? ""), email: String(p.email), partner: partnerIds.has(String(p.id)), org: p.organization_id ? (orgName.get(String(p.organization_id)) ?? null) : null }))
      .sort((a, b) => Number(b.partner) - Number(a.partner) || a.name.localeCompare(b.name)),
    sections: REPORT_SECTIONS.map((x) => ({ key: x.key, label: x.label, hint: x.hint })),
  };
}

export type SendReportDayData = { ok: true; kind: "data"; report: ReportData; subject: string | null } | { ok: true; kind: "html"; html: string; subject: string | null };

/**
 * The report of a day for the window (Bram, 2026-11-08): its data, so the window shows the same review as End of day
 * (the include box, Change, Edit and + Note on each section), with today's notes from End of day to start; or, for an
 * older day kept only as its sent email, that email.
 */
export async function loadSendReportDay(day: string): Promise<SendReportDayData | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  const { sb, ctx } = s;
  if (!DATE.test(String(day ?? ""))) return fail("Pick a day.");
  const b = await baseFor(sb, ctx, day);
  if ("ok" in b) return b;
  if (b.base.data) return { ok: true, kind: "data", report: { ...b.base.data, choices: null, intro: null }, subject: b.base.subject };
  return { ok: true, kind: "html", html: String(b.base.html), subject: b.base.subject };
}

export type { SendReportResult, SendReportTo };

/** Sends the report to the people given (an earlier day, or today's from the window): see sendReportCore. */
export async function sendReport(input: Parameters<typeof sendReportCore>[2]): Promise<SendReportResult> {
  const s = await setup();
  if ("ok" in s) return s;
  return sendReportCore(s.sb, s.ctx, input);
}

/** Saves today's Also send to list and note under the greeting with the day (2026-11-08). */
export async function saveReportExtras(day: string, extras: unknown): Promise<{ ok: true } | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  if (!DATE.test(String(day ?? "")) || day !== s.ctx.today) return fail("Only today's report keeps people and a note.");
  const r = await saveExtrasCore(s.sb, s.ctx, day, cleanExtras(extras));
  if (r.ok) revalidatePath("/work/end-of-day");
  return r;
}

/** Sends today's report now to the people saved under Also send to only; the day stays open for the partners. */
export async function sendExtrasNow(day: string, requestId: string): Promise<{ ok: true; sentTo: string[] } | Fail> {
  const s = await setup();
  if ("ok" in s) return s;
  if (!REQUEST_ID.test(String(requestId ?? ""))) return fail("The send request was not valid. Close the window and try again.");
  const page = await loadEndOfDay(s.sb, s.ctx, day);
  const r = await sendExtras(s.sb, s.ctx, day, page, requestId);
  revalidatePath("/", "layout");
  if (r.alsoError) return fail(r.alsoError);
  return { ok: true, sentTo: r.alsoTo ?? [] };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, todayInTz } from "@/lib/calc/dates";
import type { Ctx } from "@/lib/engine/helpers";
import { date as fmtDate } from "@/lib/format";
import { DB_UPDATE_NOTICE_PUSH_D, isMissingSchemaError } from "@/lib/schema-guard";
import { loadWorkCtx, readWorkInputs, workInputs } from "@/lib/work/data";
import { loadFacts, loadTargets } from "@/lib/accountability/data";
import { countable } from "@/lib/accountability/targets";
import {
  monthLabel, monthName, monthResults, monthSlug, monthSummary, nextMonthStart, readNextTargets, readResults, reviewListLine, reviewMonthFor,
  type MonthResult, type NextTarget,
} from "@/lib/accountability/monthly";
import type { Row } from "@/lib/types";

/**
 * The monthly review (push D, approved 2026-11-04): the review rows (table monthly_reviews), the review page of one
 * month, the list under Reports, Monthly reviews, and the row on Work on now. A finished review shows what was kept on
 * it; an open one is counted live from the app's facts with the targets as they are now. Before the push D database
 * update the table is missing: the list is empty, the page says the update is needed, and Work on now has no row.
 */

/** Counting starts on (2026-11-09), from the settings row the page reads once (no extra trip). */
async function countingStartOf(sb: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data } = await readWorkInputs(sb, ownerId);
  return workInputs((data ?? []) as Row[]).countingStart;
}

type ReviewRow = { id: string; month: string; finishedAt: string | null; exportedAt: string | null; results: MonthResult[]; nextTargets: NextTarget[] };

async function loadRows(sb: SupabaseClient, ownerId: string): Promise<{ rows: ReviewRow[]; available: boolean }> {
  const { data, error } = await sb.from("monthly_reviews").select("*").eq("owner_id", ownerId).order("month", { ascending: false }).limit(240);
  if (error) return { rows: [], available: !isMissingSchemaError(error) };
  return {
    available: true,
    rows: ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), month: String(r.month).slice(0, 10), finishedAt: (r.finished_at as string | null) ?? null, exportedAt: (r.exported_at as string | null) ?? null, results: readResults(r.results), nextTargets: readNextTargets(r.next_targets) })),
  };
}

/** The review due on Work on now: the month before, from the first workday of this month until it is finished. */
export type MonthlyDue = { month: string; slug: string; name: string; nextName: string; opensOn: string };

export async function loadMonthlyDue(sb: SupabaseClient, ctx: Pick<Ctx, "ownerId" | "today">): Promise<MonthlyDue | null> {
  if (!reviewMonthFor(ctx.today)) return null;
  const [{ rows, available }, start] = await Promise.all([loadRows(sb, ctx.ownerId), countingStartOf(sb, ctx.ownerId)]);
  const open = reviewMonthFor(ctx.today, start);
  if (!open || !available) return null;
  if (rows.some((r) => r.month === open.month && r.finishedAt)) return null;
  return { month: open.month, slug: monthSlug(open.month), name: monthName(open.month), nextName: monthName(nextMonthStart(open.month)), opensOn: open.opensOn };
}

/** One month under Reports, Monthly reviews. */
export type MonthlyListItem = { month: string; slug: string; label: string; line: string; finished: boolean; current: boolean };

export async function loadMonthlyList(sb: SupabaseClient, ctx: Ctx): Promise<{ items: MonthlyListItem[]; available: boolean }> {
  const [{ rows, available }, start] = await Promise.all([loadRows(sb, ctx.ownerId), countingStartOf(sb, ctx.ownerId)]);
  const open = reviewMonthFor(ctx.today, start);
  const months = new Map(rows.map((r) => [r.month, r]));
  // The review of the month under review shows before it was opened once (no row yet).
  if (open && !months.has(open.month)) months.set(open.month, { id: "", month: open.month, finishedAt: null, exportedAt: null, results: [], nextTargets: [] });
  const local = (ts: string) => todayInTz(ctx.tz, new Date(ts));
  const items = [...months.values()]
    .filter((r) => r.month < `${ctx.today.slice(0, 7)}-01`)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((r) => {
      const current = !!open && r.month === open.month;
      const finishedOn = r.finishedAt ? local(r.finishedAt) : null;
      return { month: r.month, slug: monthSlug(r.month), label: monthLabel(r.month), line: reviewListLine({ finishedOn, exported: !!r.exportedAt, current }, (d) => fmtDate(d, "MMM d")), finished: !!r.finishedAt, current };
    });
  return { items, available };
}

export type MonthlyReviewPage = {
  available: boolean;
  notice: string | null;
  today: string;
  month: string;
  slug: string;
  /** "October 2026". */
  label: string;
  /** "October", "November". */
  name: string;
  nextName: string;
  /** The month's review can be finished: the latest month, opened, not finished yet. */
  canFinish: boolean;
  /** This is the review open now (on Work on now until finished). */
  current: boolean;
  finishedOn: string | null;
  exportedOn: string | null;
  /** The newest export of any review ("Last export Oct 1"). */
  lastExportOn: string | null;
  results: MonthResult[];
  summary: string;
  /** Next month's targets: as set on a finished review; otherwise the targets as they are now. */
  next: NextTarget[];
  weeks: number;
};

/** The review page of one month (YYYY-MM-01). */
export async function loadMonthlyReviewPage(sb: SupabaseClient, ctx: Ctx, month: string): Promise<MonthlyReviewPage> {
  const [{ rows, available }, start] = await Promise.all([loadRows(sb, ctx.ownerId), countingStartOf(sb, ctx.ownerId)]);
  const row = rows.find((r) => r.month === month) ?? null;
  const open = reviewMonthFor(ctx.today, start);
  const current = !!open && open.month === month;
  const local = (ts: string | null) => (ts ? todayInTz(ctx.tz, new Date(ts)) : null);
  const lastExport = rows.map((r) => r.exportedAt).filter((x): x is string => !!x).sort().slice(-1)[0] ?? null;
  const base = { available, notice: available ? null : DB_UPDATE_NOTICE_PUSH_D, today: ctx.today, month, slug: monthSlug(month), label: monthLabel(month), name: monthName(month), nextName: monthName(nextMonthStart(month)), current, finishedOn: local(row?.finishedAt ?? null), exportedOn: local(row?.exportedAt ?? null), lastExportOn: local(lastExport) };
  if (row?.finishedAt && row.results.length) {
    return { ...base, canFinish: false, results: row.results, summary: monthSummary(row.results), next: row.nextTargets, weeks: row.results[0]?.weeks ?? 0 };
  }
  const wctx = await loadWorkCtx(sb, ctx.ownerId);
  const [targets, bundle] = await Promise.all([loadTargets(sb, ctx.ownerId), loadFacts(sb, wctx, addDaysISO(month, -7))]);
  const results = monthResults(targets, bundle.facts, month, bundle.skippedDays);
  const next: NextTarget[] = targets.map((t) => ({ targetId: t.id, name: t.name, cadence: t.cadence, number: t.number, commitment: t.commitment, unit: countable(t.key).unit, before: t.number }));
  return { ...base, canFinish: available && current && !row?.finishedAt, results, summary: monthSummary(results), next, weeks: results[0]?.weeks ?? 0 };
}

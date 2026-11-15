import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A safe save of the day's report text (step 4, 2026-11-15). Several things change report_edits on the day's row (the
 * opening, the Now lines, the AI drafts, notes, partner choices, the report job's record): each reads the row, changes
 * its part and writes the whole value back. Without a check, two saves at the same moment would let the later one
 * write an older copy over the earlier one (typed text lost, or AI text losing its "AI draft" mark).
 *
 * Every save goes through editEod: the row carries a revision number in report_edits._rev, the write only lands when
 * the number is still the one read, and on a clash the row is read again and the change made again (up to 4 times).
 */
export const REV_KEY = "_rev";

export type EodNow = { id: string; status: string; tomorrowLine: string; edits: Record<string, unknown> };
/** What to write: the new report_edits (the revision is added here) and any other columns. */
export type EodChange = { edits?: Record<string, unknown>; patch?: Record<string, unknown> };

export async function editEod(
  sb: SupabaseClient,
  ownerId: string,
  day: string,
  /** The change, made on the row as it is now; null writes nothing, a string is an error shown to you. */
  change: (row: EodNow) => EodChange | string | null,
  /** Only an open day may change (default). The report job's record is also saved on a sent day. */
  opts: { open?: boolean } = {},
): Promise<{ ok: true; wrote: boolean } | { ok: false; error: string }> {
  const open = opts.open ?? true;
  for (let i = 0; i < 4; i++) {
    const { data: row, error: readError } = await sb.from("end_of_day").select("id,status,tomorrow_line,report_edits").eq("owner_id", ownerId).eq("day", day).maybeSingle();
    if (readError) return { ok: false, error: `Not saved: ${readError.message}` };
    if (!row) return { ok: false, error: "The day was not found." };
    if (open && row.status !== "open") return { ok: false, error: `Today is already ${row.status}.` };
    const edits = { ...((row.report_edits && typeof row.report_edits === "object" && !Array.isArray(row.report_edits) ? row.report_edits : {}) as Record<string, unknown>) };
    const rev = typeof edits[REV_KEY] === "number" ? (edits[REV_KEY] as number) : null;
    const c = change({ id: String(row.id), status: String(row.status), tomorrowLine: String(row.tomorrow_line ?? ""), edits });
    if (typeof c === "string") return { ok: false, error: c };
    if (!c) return { ok: true, wrote: false };
    const next = { ...(c.edits ?? edits), [REV_KEY]: (rev ?? 0) + 1 };
    let q = sb.from("end_of_day").update({ ...(c.patch ?? {}), report_edits: next }).eq("id", row.id);
    if (open) q = q.eq("status", "open");
    q = rev === null ? q.is("report_edits->>_rev", null) : q.eq("report_edits->>_rev", String(rev));
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: `Not saved: ${error.message}` };
    if (data && data.length) return { ok: true, wrote: true };
    // Changed by another save since it was read (or sent): read it again.
  }
  return { ok: false, error: "Not saved: the day kept changing while saving. Try again." };
}

/**
 * Listings reviewed (Bram, 2026-11-23; claude/2026-11-23-report-h-listings-reviewed-build-plan.md): how many listings
 * the owner looked at, entered by hand on End of day or Home, each entry with where the listings came from. Entries of
 * a day add up; an entry of 0 means "none today" and still counts as entered (the End of day checklist and the
 * reminder emails stop asking). Pure and tested in listings-reviewed.test.ts.
 */
import type { ActivityRow } from "@/lib/accountability/activity";

export type ReviewedEntry = { id: string; day: string; reviewed: number; source: string | null; createdAt: string };

export const REVIEWED_MAX = 2000;
export const SOURCE_MAX = 80;
/** Offered first in the Source box until the owner's own sources take their place. */
export const DEFAULT_SOURCES = ["BizBuySell", "Broker email", "Axial", "BizQuest", "Rejigg"] as const;

/** A row from the table as an entry, or null when it does not read as one. */
export function toEntry(r: Record<string, unknown>): ReviewedEntry | null {
  const n = Number(r.reviewed);
  if (!r.id || !r.day || !Number.isFinite(n)) return null;
  const source = String(r.source ?? "").replace(/\s+/g, " ").trim();
  return { id: String(r.id), day: String(r.day).slice(0, 10), reviewed: Math.max(0, Math.round(n)), source: source || null, createdAt: String(r.created_at ?? "") };
}

/** The number typed in the box: a whole number from 0 to 2,000, or an error line. */
export function parseReviewed(v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const t = String(v ?? "").replace(/[,\s]/g, "");
  if (!t) return { ok: false, error: "Type how many listings you reviewed (0 if none)." };
  if (!/^\d+$/.test(t)) return { ok: false, error: "Type a whole number, like 15." };
  const n = Number(t);
  if (n > REVIEWED_MAX) return { ok: false, error: `Type a number up to ${REVIEWED_MAX.toLocaleString("en-US")}.` };
  return { ok: true, value: n };
}

/** The source as saved: one line, at most 80 characters, or null. */
export function cleanSource(v: unknown): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, SOURCE_MAX);
  return t || null;
}

/** A day's total, and whether anything was entered (an entry of 0 counts as entered). */
export function dayTotal(entries: readonly ReviewedEntry[], day: string): { total: number; entered: boolean; sources: string[] } {
  const own = entries.filter((e) => e.day === day);
  const by = new Map<string, number>();
  for (const e of own) if (e.source && e.reviewed > 0) by.set(e.source, (by.get(e.source) ?? 0) + e.reviewed);
  const sources = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  return { total: own.reduce((s, e) => s + e.reviewed, 0), entered: own.length > 0, sources };
}

/** The sources to offer: the owner's most used first (from recent entries), then the defaults not already listed; at most 8. */
export function sourceChoices(entries: readonly ReviewedEntry[]): string[] {
  const n = new Map<string, number>();
  for (const e of entries) if (e.source) n.set(e.source, (n.get(e.source) ?? 0) + 1);
  const mine = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const lower = new Set(mine.map((s) => s.toLowerCase()));
  return [...mine, ...DEFAULT_SOURCES.filter((s) => !lower.has(s.toLowerCase()))].slice(0, 8);
}

/** "Reviewed 15 listings" (one entry's words). */
export function reviewedWords(n: number): string {
  return n === 0 ? "No listings reviewed" : `Reviewed ${n} ${n === 1 ? "listing" : "listings"}`;
}

/** One Today's activity row per entry: "Reviewed 15 listings", with the source where the record name goes. */
export function reviewedRows(entries: readonly ReviewedEntry[], day: string, timeOf: (ts: string) => string | null): ActivityRow[] {
  return entries
    .filter((e) => e.day === day)
    .map((e) => ({ id: `reviewed:${e.id}`, kind: "reviewed" as const, text: reviewedWords(e.reviewed), record: e.source, time: e.createdAt ? timeOf(e.createdAt) : null, href: null }));
}

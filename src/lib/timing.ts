import "server-only";
import { cache } from "react";

/**
 * Page speed timing line (Bram, 2026-11-06), on the preview only (VERCEL_ENV "preview") or locally with SHOW_TIMING=1.
 * Never on Production. Every server request to the database (Supabase), Google or the AI is counted for the page
 * being built; the line at the bottom of the page reads, for example, "Server 1.8 s · 23 lookups · 2 Google calls ·
 * slowest 0.4 s" (Google calls with their time since 2026-11-07). "Server" runs from the start of the page's build to the end of its last outside call.
 * TIMING_LOG=1 (local only) also prints each call with its start and end, to see which ones wait on others.
 */
export const TIMING_ON = process.env.VERCEL_ENV === "preview" || process.env.SHOW_TIMING === "1";

type Call = { kind: "db" | "google" | "ai" | "other"; what: string; start: number; end: number | null };
export type RequestTiming = { t0: number; calls: Call[]; inFlight: number; lastEvent: number };

/** One record per page request (React's cache lasts for one request). */
export const requestTiming = cache((): RequestTiming => {
  const now = performance.now();
  return { t0: now, calls: [], inFlight: 0, lastEvent: now };
});

function kindOf(url: string): Call["kind"] {
  const db = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if ((db && url.startsWith(db)) || url.includes(".supabase.co") || url.includes(":54321")) return "db";
  if (url.includes("googleapis.com") || url.includes("google.com") || url.includes(":54329")) return "google";
  if (url.includes("anthropic")) return "ai";
  return "other";
}

/** Short label for the log: the table or the Google path. */
function whatOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\/rest\/v1\//, "")}${u.search ? "?" + u.search.slice(1, 60) : ""}`;
  } catch {
    return url.slice(0, 80);
  }
}

type Flagged = typeof globalThis & { __bfTimingFetch?: boolean };

/** Counts outside calls made while a page is built. Installed once, only when the timing line is on. */
export function installTiming(): void {
  const g = globalThis as Flagged;
  if (!TIMING_ON || g.__bfTimingFetch) return;
  g.__bfTimingFetch = true;
  const base = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let r: RequestTiming | null = null;
    try {
      r = requestTiming();
    } catch {
      r = null;
    }
    if (!r) return base(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: Call = { kind: kindOf(url), what: whatOf(url), start: performance.now(), end: null };
    r.calls.push(call);
    r.inFlight++;
    r.lastEvent = call.start;
    try {
      return await base(input, init);
    } finally {
      call.end = performance.now();
      r.inFlight--;
      r.lastEvent = call.end;
    }
  };
}

/**
 * Times one Google call into the page's record (2026-11-07). The Google library (googleapis, through gaxios 8) sends
 * its requests with node-fetch, not the global fetch counted above, so src/lib/google.ts wraps each call here.
 * `what` names it in the log ("token", "calendar events"). Off the preview this only runs `fn`.
 */
export async function timeGoogle<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (!TIMING_ON) return fn();
  let r: RequestTiming | null = null;
  try {
    r = requestTiming();
  } catch {
    r = null;
  }
  if (!r) return fn();
  const call: Call = { kind: "google", what, start: performance.now(), end: null };
  r.calls.push(call);
  r.inFlight++;
  r.lastEvent = call.start;
  try {
    return await fn();
  } finally {
    call.end = performance.now();
    r.inFlight--;
    r.lastEvent = call.end;
  }
}

/** The time covered by a set of calls, counting overlaps once (two Google calls side by side cost the longer one). */
function covered(calls: Call[]): number {
  const spans = calls.map((c) => [c.start, c.end!] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let from = -Infinity;
  let to = -Infinity;
  for (const [s, e] of spans) {
    if (s > to) {
      if (to > from) total += to - from;
      from = s;
      to = e;
    } else if (e > to) to = e;
  }
  if (to > from) total += to - from;
  return total;
}

/** Waits until no outside call has run for `quietMs` (the page's data is all in), up to `maxMs`. */
export async function settled(r: RequestTiming, quietMs = 250, maxMs = 25000): Promise<void> {
  const until = performance.now() + maxMs;
  while (performance.now() < until) {
    if (r.inFlight === 0 && performance.now() - r.lastEvent >= quietMs) return;
    await new Promise((res) => setTimeout(res, 50));
  }
}

export function timingLine(r: RequestTiming): string {
  const done = r.calls.filter((c) => c.end !== null);
  const end = done.length ? Math.max(...done.map((c) => c.end!)) : r.t0;
  const n = (k: Call["kind"]) => done.filter((c) => c.kind === k).length;
  const slow = done.length ? done.reduce((a, c) => (c.end! - c.start > a.end! - a.start ? c : a)) : null;
  const slowest = slow ? slow.end! - slow.start : 0;
  // Which read it was (2026-11-06): the table, "sign-in check", or "Google".
  const slowName = !slow ? "" : slow.kind === "google" ? "Google" : slow.kind === "ai" ? "AI" : slow.what.startsWith("/auth/") ? "sign-in check" : slow.what.split(/[?/]/).filter(Boolean)[0] ?? "";
  const s = (ms: number) => `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`;
  const parts = [`Server ${s(end - r.t0)}`, `${n("db")} lookups`];
  // 2026-11-07: the Google calls with the time they took ("1 Google call 0.40 s"; side by side calls count once).
  if (n("google")) parts.push(`${n("google")} Google ${n("google") === 1 ? "call" : "calls"} ${s(covered(done.filter((c) => c.kind === "google")))}`);
  if (n("ai")) parts.push(`${n("ai")} AI calls`);
  if (done.length) parts.push(`slowest ${s(slowest)}${slowName ? ` (${slowName})` : ""}`);
  if (process.env.TIMING_LOG === "1") {
    const rows = done.map((c) => `${String(Math.round(c.start - r.t0)).padStart(6)} → ${String(Math.round(c.end! - r.t0)).padStart(6)} ms  ${c.kind.padEnd(6)} ${c.what}`);
    console.log(`[timing] ${parts.join(" · ")}\n${rows.join("\n")}`);
  }
  return parts.join(" · ");
}

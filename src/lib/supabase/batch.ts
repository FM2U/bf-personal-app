import "server-only";
import { noteBatchedReads } from "@/lib/timing";

/**
 * One trip per page (speed plan, Bram 2026-11-07; claude/2026-11-07-speed-plan.md).
 *
 * Every read a page makes still goes through the Supabase library the usual way. This fetch sits under the library:
 * reads asked for at the same moment (the same "wave" of a page build) are sent together in one trip to the database
 * function read_batch (supabase/read_batch.sql), and each read gets back exactly the answer it would have had alone.
 *
 * Nothing can go missing:
 * - A read the function cannot express (a joined select, a rare comparison) goes out on its own, as before.
 * - A read that fails inside the trip is asked again on its own, so its error is the one it always gave.
 * - When the function is not in the database yet (before Bram runs UPDATE_PREVIEW_PUSH_G.sql), every read goes out on
 *   its own, as before; the app checks again after a few minutes.
 * - Saving (insert, update, delete) never goes through here.
 * BATCH_VERIFY=1 (local checks only) also asks every read on its own and logs any difference between the two answers.
 */

type Cond = { and: Cond[] } | { or: Cond[] } | { c: string; o: string; v: string | string[]; n?: boolean };
export type BatchRead = { t: string; s?: string[]; w?: Cond; o?: { c: string; d?: boolean; nf?: boolean }[]; l?: number; f?: number; h?: boolean; n?: boolean };
type Answer = { d?: unknown[] | null; n?: number | null; e?: { code: string; message: string } };

const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "cs"]);
const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

/** Splits "a,b(c,d),"e,f"" at the top-level commas (not inside brackets or quotes). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** One condition "col" + "op.value" (op may start with "not."), or null when the function cannot express it. */
function cond(col: string, expr: string): Cond | null {
  if (col === "or" || col === "and") return group(col, expr);
  if (!NAME.test(col)) return null;
  let n = false;
  if (expr.startsWith("not.")) {
    n = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf(".");
  if (dot < 0) return null;
  const o = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  if (!OPS.has(o)) return null;
  if (o === "is" && !["null", "true", "false"].includes(raw)) return null;
  if (o === "in") {
    if (!raw.startsWith("(") || !raw.endsWith(")")) return null;
    const v = splitTop(raw.slice(1, -1))
      .map((x) => (x.startsWith('"') && x.endsWith('"') ? x.slice(1, -1).replace(/\\"/g, '"') : x))
      .filter((x) => x !== "");
    return { c: col, o, v, ...(n ? { n } : {}) };
  }
  return { c: col, o, v: raw, ...(n ? { n } : {}) };
}

/** "(a.eq.1,b.is.null,and(c.gt.2,d.lt.3))" for or= / and=, or null. */
function group(kind: "or" | "and", expr: string): Cond | null {
  if (!expr.startsWith("(") || !expr.endsWith(")")) return null;
  const parts: Cond[] = [];
  for (const part of splitTop(expr.slice(1, -1))) {
    const nested = part.match(/^(or|and)(\(.*\))$/);
    let c: Cond | null;
    if (nested) c = group(nested[1] as "or" | "and", nested[2]);
    else {
      const i = part.indexOf(".");
      c = i < 0 ? null : cond(part.slice(0, i), part.slice(i + 1));
    }
    if (!c) return null;
    parts.push(c);
  }
  return kind === "or" ? { or: parts } : { and: parts };
}

type Parsed = { read: BatchRead; single: boolean; head: boolean };

/** Turns a Supabase read (its address and headers) into a read for read_batch, or null when it cannot. */
export function parseRead(url: URL, method: string, headers: Headers, base: string): Parsed | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (!url.href.startsWith(`${base}/rest/v1/`)) return null;
  const table = url.pathname.slice(url.pathname.lastIndexOf("/rest/v1/") + "/rest/v1/".length);
  if (!NAME.test(table)) return null;
  const profile = headers.get("accept-profile");
  if (profile && profile !== "public") return null;
  const accept = headers.get("accept") ?? "";
  if (accept && !accept.includes("application/json") && !accept.includes("vnd.pgrst.object") && accept !== "*/*") return null;
  const prefer = headers.get("prefer") ?? "";
  const countKind = prefer.match(/count=(exact|planned|estimated)/)?.[1];
  if (countKind && countKind !== "exact") return null;
  const read: BatchRead = { t: table };
  const select = url.searchParams.get("select");
  if (select && select !== "*") {
    const cols = select.split(",");
    if (!cols.every((c) => NAME.test(c))) return null;
    read.s = cols;
  }
  const order = url.searchParams.get("order");
  if (order) {
    const o: NonNullable<BatchRead["o"]> = [];
    for (const part of order.split(",")) {
      const [c, ...mods] = part.split(".");
      if (!NAME.test(c) || mods.some((m) => !["asc", "desc", "nullsfirst", "nullslast"].includes(m))) return null;
      o.push({ c, ...(mods.includes("desc") ? { d: true } : {}), ...(mods.includes("nullsfirst") ? { nf: true } : mods.includes("nullslast") ? { nf: false } : {}) });
    }
    read.o = o;
  }
  for (const [k, key] of [["limit", "l"], ["offset", "f"]] as const) {
    const v = url.searchParams.get(k);
    if (v === null) continue;
    if (!/^\d+$/.test(v)) return null;
    read[key] = Number(v);
  }
  const conds: Cond[] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) {
      if (k === "columns" || k === "on_conflict") return null;
      continue;
    }
    const c = cond(k, v);
    if (!c) return null;
    conds.push(c);
  }
  if (conds.length) read.w = { and: conds };
  const head = method === "HEAD";
  if (head) read.h = true;
  if (countKind) read.n = true;
  return { read, single: accept.includes("vnd.pgrst.object"), head };
}

/** The answer the read would have had on its own, as the Supabase library expects it; null to ask on its own instead. */
function answerFor(p: Parsed, a: Answer | undefined): Response | null {
  if (!a || a.e) return null;
  const rows = a.d ?? [];
  if (!p.head && !Array.isArray(rows)) return null;
  if (p.single && rows.length !== 1) return null;
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (p.read.n) headers.set("content-range", rows.length && !p.head ? `0-${rows.length - 1}/${a.n ?? "*"}` : `*/${a.n ?? 0}`);
  const body = p.head ? null : JSON.stringify(p.single ? rows[0] : rows);
  return new Response(body, { status: 200, headers });
}

/** When the function was last found missing (per server instance); reads go out one by one until RECHECK_MS later. */
let missingAt = 0;
const RECHECK_MS = 5 * 60 * 1000;
const ON = process.env.BATCH_READS !== "0";

type Waiting = { parsed: Parsed; input: string; init: RequestInit | undefined; resolve: (r: Response) => void; reject: (e: unknown) => void };

/** A fetch for one Supabase client (one page build, or one action): reads asked at the same moment go in one trip. */
export function batchingFetch(base: string, real: typeof fetch = (i, n) => fetch(i, n)): typeof fetch {
  let queue: Waiting[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const alone = (w: Waiting) => real(w.input, w.init).then(w.resolve, w.reject);

  async function flush() {
    const wave = queue;
    queue = [];
    timer = null;
    if (process.env.READ_LOG === "1") console.log(`[batch] ${wave.length} reads: ${wave.map((w) => w.parsed.read.t).join(", ")}`);
    if (wave.length === 1 || Date.now() - missingAt < RECHECK_MS) return wave.forEach(alone);
    const h = new Headers(wave[0].init?.headers);
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    for (const k of ["apikey", "authorization", "x-client-info"]) {
      const v = h.get(k);
      if (v) headers.set(k, v);
    }
    let answers: Answer[] | null = null;
    try {
      const res = await real(`${base}/rest/v1/rpc/read_batch`, { method: "POST", headers, body: JSON.stringify({ p_reads: wave.map((w) => w.parsed.read) }) });
      if (res.ok) answers = (await res.json()) as Answer[];
      else {
        const text = await res.text().catch(() => "");
        // PGRST202: the function is not in the database (yet); 404 from older PostgREST.
        if (res.status === 404 || text.includes("PGRST202") || text.includes("read_batch")) missingAt = Date.now();
      }
    } catch {
      answers = null;
    }
    if (!Array.isArray(answers) || answers.length !== wave.length) return wave.forEach(alone);
    let served = 0;
    wave.forEach((w, i) => {
      const r = answerFor(w.parsed, answers![i]);
      if (!r) return alone(w);
      served++;
      if (process.env.BATCH_VERIFY === "1") void verify(w, r.clone(), real);
      w.resolve(r);
    });
    noteBatchedReads(served);
  }

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let parsed: Parsed | null = null;
    if (ON && typeof input !== "object") {
      try {
        parsed = parseRead(new URL(href), method, new Headers(init?.headers), base);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) return real(input, init);
    return new Promise<Response>((resolve, reject) => {
      queue.push({ parsed: parsed!, input: href, init, resolve, reject });
      // The same moment: every read asked before the next turn of the server's event loop joins this trip.
      timer ??= setTimeout(flush, 0);
    });
  };
}

/** Local checks only: the read asked on its own must give the same rows and count as from the trip. */
async function verify(w: Waiting, fromTrip: Response, real: typeof fetch) {
  try {
    // Marked so the speed line does not count this second read as a trip of the page (timing.ts).
    const h = new Headers(w.init?.headers);
    h.set("x-bf-verify", "1");
    const own = await real(w.input, { ...w.init, headers: h });
    const a = await fromTrip.text();
    const b = await own.text();
    const same = canonical(a ? JSON.parse(a) : null) === canonical(b ? JSON.parse(b) : null);
    const ra = fromTrip.headers.get("content-range")?.split("/")[1] ?? null;
    const rb = own.headers.get("content-range")?.split("/")[1] ?? null;
    if (!same || (w.parsed.read.n && ra !== rb)) console.error(`[batch-verify] DIFFERENT ${w.input}\n  trip: ${a.slice(0, 400)} (${ra})\n  alone: ${b.slice(0, 400)} (${rb})`);
    else console.log(`[batch-verify] same ${w.parsed.read.t}`);
  } catch (e) {
    console.error(`[batch-verify] could not compare ${w.input}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  // The local stand-in writes times as "…48.673Z", the database as "…48.673765+00:00": compare the instant (to the ms).
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(v)) return `t${Date.parse(v)}`;
  return JSON.stringify(v);
}

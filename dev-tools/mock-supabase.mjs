// LOCAL TESTING ONLY. Not used in production.
// A small stand-in for the Supabase API (auth user endpoint + PostgREST subset + RPC) backed by a local
// Postgres database that has the app's migrations applied. It lets the app run end to end on a laptop,
// with Row Level Security enforced exactly as in Supabase (queries run as role "authenticated" with the
// signed-in user's id and assurance level).
//
// Usage: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bf_scratch node dev-tools/mock-supabase.mjs
// Then run the app with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321.

import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.MOCK_PORT || 54321);
const SERVICE_KEY = process.env.MOCK_SERVICE_KEY || "service-role-test-key";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
pg.types.setTypeParser(1082, (v) => v); // date as YYYY-MM-DD
const ts = (v) => (v === null ? null : new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString());
pg.types.setTypeParser(1184, ts); // timestamptz
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(`${v.replace(" ", "T")}Z`).toISOString()));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

function colExpr(c) {
  // supports json paths: payload->>key, payload->key
  const m = c.match(/^([a-zA-Z0-9_]+)(->>?)([a-zA-Z0-9_]+)$/);
  if (m) return `${q(m[1])}${m[2]}'${m[3]}'`;
  return q(c);
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function condition(col, expr, params) {
  let negate = false;
  if (expr.startsWith("not.")) {
    negate = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const c = colExpr(col);
  let sql;
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  switch (op) {
    case "eq": sql = `${c} = ${p(val)}`; break;
    case "neq": sql = `${c} <> ${p(val)}`; break;
    case "gt": sql = `${c} > ${p(val)}`; break;
    case "gte": sql = `${c} >= ${p(val)}`; break;
    case "lt": sql = `${c} < ${p(val)}`; break;
    case "lte": sql = `${c} <= ${p(val)}`; break;
    case "like": sql = `${c}::text like ${p(val.replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${c}::text ilike ${p(val.replace(/\*/g, "%"))}`; break;
    case "is": sql = `${c} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`; break;
    case "in": {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).filter((x) => x !== "");
      sql = items.length ? `${c}::text = any(${p(items)}::text[])` : "false";
      break;
    }
    case "cs": sql = `${c} @> ${p(val)}`; break;
    default: throw Object.assign(new Error(`Unsupported operator ${op}`), { code: "PGRST100" });
  }
  return negate ? `not (${sql})` : sql;
}

function orGroup(expr, params) {
  const inner = expr.replace(/^\(|\)$/g, "");
  return `(${splitTopLevel(inner)
    .map((part) => {
      const i = part.indexOf(".");
      return condition(part.slice(0, i), part.slice(i + 1), params);
    })
    .join(" or ")})`;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function buildWhere(url, params) {
  const conds = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === "or") conds.push(orGroup(v, params));
    else if (k === "and") conds.push(`(${splitTopLevel(v.replace(/^\(|\)$/g, "")).map((part) => { const i = part.indexOf("."); return condition(part.slice(0, i), part.slice(i + 1), params); }).join(" and ")})`);
    else conds.push(condition(k, v, params));
  }
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

function selectList(s) {
  if (!s || s === "*") return "*";
  return s.split(",").map((c) => c.trim()).filter(Boolean).map((c) => (c === "*" ? "*" : colExpr(c))).join(", ");
}

function orderBy(o) {
  if (!o) return "";
  return ` order by ${o
    .split(",")
    .map((part) => {
      const [col, ...mods] = part.split(".");
      let s = colExpr(col);
      if (mods.includes("desc")) s += " desc";
      else s += " asc";
      if (mods.includes("nullsfirst")) s += " nulls first";
      if (mods.includes("nullslast")) s += " nulls last";
      return s;
    })
    .join(", ")}`;
}

async function withRole(auth, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (auth.service) {
      await client.query("set local role service_role");
      await client.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    } else if (auth.sub) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.aal', $2, true)", [auth.sub, auth.aal || "aal1"]);
    } else {
      await client.query("set local role anon");
    }
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function pgError(res, e) {
  const status = e.code === "23505" ? 409 : e.code === "42501" ? 403 : e.code?.startsWith("PGRST") ? 400 : 400;
  send(res, status, { code: e.code ?? "", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : null;
}

function authFrom(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.apikey;
  if (token === SERVICE_KEY || (!token && apikey === SERVICE_KEY)) return { service: true };
  const payload = token ? decodeJwt(token) : null;
  if (payload?.sub) return { sub: payload.sub, aal: payload.aal, email: payload.email };
  return {};
}

// ---------- Storage stand-in (LOCAL TESTING ONLY) ----------
// The documents bucket, kept in memory. The rules of the storage policies in migration 0007 are checked here:
// signed in, assurance level aal2, and the first folder of the path is the user's id. Signed upload URLs
// (createSignedUploadUrl, then uploadToSignedUrl from the browser), signed download URLs, and remove.
// Test controls: GET /__storage lists the stored files; POST /__storage {"failUpload": true} makes the next uploads fail.
const stored = new Map();
const uploadTokens = new Map();
let storageMode = { failUpload: false };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
async function storage(req, res, url) {
  const out = (status, body) => send(res, status, body, CORS);
  if (req.method === "OPTIONS") return send(res, 204, undefined, CORS);
  if (url.pathname === "/__storage") {
    if (req.method === "POST") {
      storageMode = { ...storageMode, ...((await readBody(req)) || {}) };
      return out(200, storageMode);
    }
    return out(200, [...stored.entries()].map(([path, f]) => ({ path, size: f.size, type: f.type })));
  }
  const owns = (auth, path) => auth.service || (auth.sub && auth.aal === "aal2" && path.split("/")[0] === auth.sub);
  const deny = () => out(403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
  let m = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/documents\/(.+)$/);
  if (m && req.method === "POST") {
    const path = decodeURIComponent(m[1]);
    if (!owns(authFrom(req), path)) return deny();
    if (stored.has(path)) return out(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const token = Math.random().toString(36).slice(2);
    uploadTokens.set(token, path);
    return out(200, { url: `/object/upload/sign/documents/${m[1]}?token=${token}` });
  }
  if (m && req.method === "PUT") {
    const path = decodeURIComponent(m[1]);
    const body = await rawBody(req);
    if (uploadTokens.get(url.searchParams.get("token") ?? "") !== path) return out(400, { statusCode: "400", error: "InvalidSignature", message: "invalid signature" });
    if (storageMode.failUpload) return out(500, { statusCode: "500", error: "internal", message: "Storage is not reachable (test)" });
    uploadTokens.delete(url.searchParams.get("token"));
    stored.set(path, { size: body.length, type: String(req.headers["content-type"] ?? ""), body });
    return out(200, { Key: `documents/${path}` });
  }
  m = url.pathname.match(/^\/storage\/v1\/object\/sign\/documents\/(.+)$/);
  if (m && req.method === "POST") {
    const path = decodeURIComponent(m[1]);
    if (!owns(authFrom(req), path)) return deny();
    if (!stored.has(path)) return out(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    return out(200, { signedURL: `/object/sign/documents/${m[1]}?token=download` });
  }
  if (m && req.method === "GET") {
    const f = stored.get(decodeURIComponent(m[1]));
    if (!f) return out(404, { message: "Object not found" });
    res.writeHead(200, { "Content-Type": "application/octet-stream", ...CORS });
    return res.end(f.body);
  }
  if (url.pathname === "/storage/v1/object/documents" && req.method === "DELETE") {
    const auth = authFrom(req);
    const { prefixes = [] } = (await readBody(req)) || {};
    const removed = prefixes.filter((p) => owns(auth, p) && stored.delete(p));
    return out(200, removed.map((name) => ({ name })));
  }
  return out(400, { message: "Not supported by the local storage stand-in" });
}

// Page speed (2026-11-06): MOCK_DB_DELAY_MS adds that many milliseconds before every database or sign-in answer, to
// imitate the trip from Vercel to Supabase (about 70 ms on the preview), so local timings show the waiting chains.
const DB_DELAY_MS = Number(process.env.MOCK_DB_DELAY_MS) || 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (DB_DELAY_MS > 0 && !url.pathname.startsWith("/__")) await new Promise((r) => setTimeout(r, DB_DELAY_MS));
  try {
    // Auth
    if (url.pathname === "/auth/v1/user") {
      const auth = authFrom(req);
      if (!auth.sub) return send(res, 401, { code: 401, msg: "invalid JWT", message: "invalid JWT" });
      return send(res, 200, {
        id: auth.sub,
        aud: "authenticated",
        role: "authenticated",
        email: auth.email || OWNER_EMAIL,
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: "2026-10-01T00:00:00Z",
        last_sign_in_at: new Date().toISOString(),
        factors: [{ id: "00000000-0000-0000-0000-00000000f001", friendly_name: "Authenticator (test)", factor_type: "totp", status: "verified", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
      });
    }
    if (url.pathname.startsWith("/auth/v1/logout")) return send(res, 204);
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 400, { message: "Not supported by the local mock" });
    if (url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/__storage")) return storage(req, res, url);

    // RPC
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    if (rpc) {
      const body = (await readBody(req)) || {};
      const keys = Object.keys(body);
      const params = keys.map((k) => (body[k] !== null && typeof body[k] === "object" ? JSON.stringify(body[k]) : body[k]));
      const sql = `select ${q(rpc[1])}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(", ")}) as result`;
      const out = await withRole(authFrom(req), (c) => c.query(sql, params));
      return send(res, 200, out.rows[0]?.result ?? null);
    }

    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return send(res, 404, { message: "Not found" });
    const table = q(m[1]);
    const prefer = String(req.headers.prefer || "");
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const single = String(req.headers.accept || "").includes("vnd.pgrst.object");
    const auth = authFrom(req);
    const params = [];

    if (req.method === "GET" || req.method === "HEAD") {
      const where = buildWhere(url, params);
      let limit = url.searchParams.get("limit");
      let offset = url.searchParams.get("offset");
      const range = req.headers.range;
      if (range) {
        const [a, b] = range.split("-").map(Number);
        offset = String(a);
        limit = String(b - a + 1);
      }
      const sql = `select ${selectList(url.searchParams.get("select"))} from ${table}${where}${orderBy(url.searchParams.get("order"))}${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
      const out = await withRole(auth, async (c) => {
        const rows = req.method === "HEAD" ? { rows: [] } : await c.query(sql, params);
        let count = null;
        if (wantCount) count = (await c.query(`select count(*)::int as n from ${table}${where}`, params)).rows[0].n;
        return { rows: rows.rows, count };
      });
      const start = Number(offset || 0);
      const headers = { "Content-Range": `${out.rows.length ? `${start}-${start + out.rows.length - 1}` : "*"}/${out.count ?? "*"}` };
      if (req.method === "HEAD") return send(res, 200, undefined, headers);
      if (single) {
        if (out.rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `Results contain ${out.rows.length} rows`, hint: null });
        return send(res, 200, out.rows[0], headers);
      }
      return send(res, 200, out.rows, headers);
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length) return send(res, 201, []);
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const colList = cols.map(q).join(", ");
      params.push(JSON.stringify(rows));
      let sql = `insert into ${table} (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1)`;
      const onConflict = url.searchParams.get("on_conflict");
      if (prefer.includes("resolution=ignore-duplicates")) sql += onConflict ? ` on conflict (${onConflict.split(",").map(q).join(", ")}) do nothing` : " on conflict do nothing";
      else if (prefer.includes("resolution=merge-duplicates") && onConflict) {
        const conflictCols = onConflict.split(",");
        const updates = cols.filter((c) => !conflictCols.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`);
        sql += ` on conflict (${conflictCols.map(q).join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"}`;
      }
      sql += ` returning ${selectList(url.searchParams.get("select"))}`;
      const out = await withRole(auth, (c) => c.query(sql, params));
      if (single) return send(res, 201, out.rows[0] ?? null);
      return send(res, 201, prefer.includes("return=representation") ? out.rows : undefined);
    }

    if (req.method === "PATCH") {
      const body = (await readBody(req)) || {};
      const cols = Object.keys(body);
      if (!cols.length) return send(res, 204);
      params.push(JSON.stringify(body));
      const where = buildWhere(url, params);
      const colList = cols.map(q).join(", ");
      const sql = `update ${table} set (${colList}) = (select ${colList} from json_populate_record(null::${table}, $1))${where} returning ${selectList(url.searchParams.get("select"))}`;
      const out = await withRole(auth, (c) => c.query(sql, params));
      if (single) return send(res, 200, out.rows[0] ?? null);
      return send(res, prefer.includes("return=representation") ? 200 : 204, prefer.includes("return=representation") ? out.rows : undefined);
    }

    if (req.method === "DELETE") {
      const where = buildWhere(url, params);
      const out = await withRole(auth, (c) => c.query(`delete from ${table}${where} returning *`, params));
      return send(res, prefer.includes("return=representation") ? 200 : 204, prefer.includes("return=representation") ? out.rows : undefined);
    }
    return send(res, 405, { message: "Method not allowed" });
  } catch (e) {
    if (process.env.MOCK_DEBUG) console.error(req.method, req.url, e.message);
    return pgError(res, e);
  }
});

server.listen(PORT, () => console.log(`Mock Supabase listening on http://localhost:${PORT}`));

// ---------- Google stand-in (LOCAL TESTING ONLY) ----------
// The app talks to it when GOOGLE_API_MOCK_URL=http://localhost:54329 (dev-tools/local.env); the app honors that
// variable only for a localhost address. Sign-in returns at once, tokens are fake, nothing leaves this machine.
// Test controls: POST /__mode {"grantSend": false} (the next sign-in grants no gmail.send, like the old connection),
// {"grantSignature": false} (the next sign-in grants no gmail.settings.basic), {"sendError": "scope" | "server" | null};
// GET /__sent lists the emails "sent" and GET /__drafts the drafts created (decoded: to, subject, body = the text part,
// html = the HTML part, contentType, parts); GET /__events lists the calendar events created (approved time blocks,
// reviews, follow-ups); POST /__reset clears them. GET /gmail/v1/users/me/settings/sendAs returns two send-as
// addresses; the default one has SAMPLE_SIGNATURE (a link, a phone number, an https image, and unsafe parts that the
// app must remove).
// Push B (reply reading): {"grantRead": false} makes the next sign-in grant no gmail.readonly (like a connection made
// before push B). GET /gmail/v1/users/me/threads/<id> returns the thread of an email "sent" here (the sent message,
// labeled SENT, from owner@example.com) plus any reply queued with POST /__reply {"to": "jake.morgan@example.com"} or
// {"threadId": "..."}, optional "text", "from", "minutesAfter" (default 3); an unknown thread is a 404.
// Push C (Today's calendar, Block time): GET /calendar/v3/calendars/primary/events lists two sample events on
// weekdays (12:30 lunch, 15:30 call) plus the events created here; {"calendarEvents": false} leaves the sample events
// out; {"calendarError": 403} makes every calendar call fail like a connection without the calendar permission.
const GOOGLE_PORT = Number(process.env.MOCK_GOOGLE_PORT || 54329);
const BASE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const SEND = "https://www.googleapis.com/auth/gmail.send";
const SETTINGS = "https://www.googleapis.com/auth/gmail.settings.basic";
const READ = "https://www.googleapis.com/auth/gmail.readonly";
const SAMPLE_SIGNATURE =
  '<div dir="ltr"><div dir="ltr"><table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:#333333"><tbody><tr>' +
  '<td style="padding-right:12px;vertical-align:top"><img src="https://lh3.googleusercontent.com/mock-signature/cyan-arc-logo.png" width="64" height="64" alt="Cyan Arc" onerror="alert(1)"></td>' +
  '<td style="vertical-align:top"><b style="color:#1d4ed8">Bram Frankel</b><br>Founder, Cyan Arc LLC<br>' +
  '<a href="tel:+14045550123" style="color:#333333">(404) 555-0123</a> | <a href="https://cyanarc.com" target="_blank">cyanarc.com</a><br>' +
  '<a href="javascript:alert(2)">Unsafe link</a><script>alert(3)</script></td></tr></tbody></table></div></div>';
let gmode = { grantSend: true, grantSignature: true, grantRead: true, sendError: null };
let greplies = [];
let gthreadReads = 0;
let gsent = [];
let gdraftList = [];
let gdrafts = 0;
let gEvents = 0;
let gEventList = [];

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function decodeRaw(raw) {
  const text = Buffer.from(String(raw || ""), "base64url").toString("utf8");
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers = {};
  let last = null;
  for (const line of head.split("\r\n")) {
    if (/^\s/.test(line) && last) headers[last] += line.slice(1);
    else {
      const i = line.indexOf(":");
      last = line.slice(0, i).toLowerCase();
      headers[last] = line.slice(i + 1).trim();
    }
  }
  const subject = (headers.subject || "").replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8")).replace(/\?=\s*=\?UTF-8\?B\?/g, "");
  const bodyRaw = rest.join("\r\n\r\n");
  const contentType = headers["content-type"] || "";
  const boundary = (contentType.match(/boundary="?([^";]+)"?/) || [])[1];
  if (boundary) {
    // multipart/alternative: decode every part; body is the text part, html the HTML part.
    // multipart/mixed (a file attached): the first part is the multipart/alternative message, then each file
    // (listed in attachments with its type, file name, and size; the PDF's first bytes in head).
    const splitParts = (raw, bnd) => {
      const chunks = raw.split(`--${bnd}`);
      return {
        closed: chunks[chunks.length - 1].startsWith("--"),
        parts: chunks.slice(1, -1).map((c) => {
          const part = c.replace(/^\r\n/, "");
          const i = part.indexOf("\r\n\r\n");
          const ph = part.slice(0, i);
          const encoded = part.slice(i + 4).replace(/\r\n$/, "");
          const type = ((ph.match(/Content-Type:\s*([^;\r\n]+)/i) || [])[1] || "").trim().toLowerCase();
          const charset = ((ph.match(/charset=([^;\r\n]+)/i) || [])[1] || "").trim();
          const inner = (ph.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
          const filename = (ph.match(/filename="([^"]*)"/i) || [])[1] || null;
          const bytes = /base64/i.test(ph) ? Buffer.from(encoded.replace(/\r\n/g, ""), "base64") : Buffer.from(encoded, "utf8");
          return { type, charset, inner, filename, bytes, raw: encoded, content: bytes.toString("utf8") };
        }),
      };
    };
    const top = splitParts(bodyRaw, boundary);
    let parts = top.parts;
    const attachments = [];
    if (/multipart\/mixed/i.test(contentType)) {
      const alt = parts.find((x) => x.type === "multipart/alternative");
      for (const x of parts) if (x !== alt) attachments.push({ type: x.type, filename: x.filename, size: x.bytes.length, head: x.bytes.subarray(0, 5).toString("latin1") });
      parts = alt ? splitParts(alt.raw, alt.inner).parts : [];
    }
    const text = parts.find((x) => x.type === "text/plain");
    const html = parts.find((x) => x.type === "text/html");
    return { to: headers.to, subject, body: text?.content ?? "", html: html?.content ?? null, contentType, parts: parts.map((x) => `${x.type}; ${x.charset}`), attachments, closed: top.closed, headers };
  }
  const body = headers["content-transfer-encoding"] === "base64" ? Buffer.from(bodyRaw.replace(/\r\n/g, ""), "base64").toString("utf8") : bodyRaw;
  return { to: headers.to, subject, body, html: null, contentType, parts: [], headers };
}

const google = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${GOOGLE_PORT}`);
  const p = url.pathname;
  try {
    if (p === "/__mode" && req.method === "POST") {
      gmode = { ...gmode, ...JSON.parse((await readRaw(req)) || "{}") };
      return send(res, 200, gmode);
    }
    if (p === "/__reset" && req.method === "POST") {
      gmode = { grantSend: true, grantSignature: true, grantRead: true, sendError: null };
      greplies = [];
      gthreadReads = 0;
      gsent = [];
      gdraftList = [];
      gEventList = [];
      return send(res, 200, { ok: true });
    }
    if (p === "/__sent") return send(res, 200, gsent);
    if (p === "/__replies") return send(res, 200, { replies: greplies, threadReads: gthreadReads });
    if (p === "/__reply" && req.method === "POST") {
      const b = JSON.parse((await readRaw(req)) || "{}");
      const to = String(b.to || "").toLowerCase();
      const sent = b.threadId ? gsent.find((m) => m.threadId === b.threadId) : [...gsent].reverse().find((m) => String(m.to || "").toLowerCase().includes(to));
      if (!sent) return send(res, 404, { error: "No sent email to reply to" });
      const id = `mock-reply-${greplies.length + 1}-${Date.now().toString(36)}`;
      const from = b.from || (to ? `${to.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} <${to}>` : "Someone <someone@example.com>");
      const at = (sent.at || Date.now()) + Number(b.minutesAfter ?? 3) * 60000;
      greplies.push({ id, threadId: sent.threadId, from, subject: `Re: ${sent.subject}`, text: b.text || "Good day. What happened with Summit?", at });
      return send(res, 200, { id, threadId: sent.threadId });
    }
    {
      const m = p.match(/^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/);
      if (m && req.method === "GET") {
        gthreadReads++;
        if (!gmode.grantRead) return send(res, 403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
        const threadId = decodeURIComponent(m[1]);
        const sent = gsent.filter((x) => x.threadId === threadId);
        if (!sent.length) return send(res, 404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
        const b64 = (t) => Buffer.from(t, "utf8").toString("base64url");
        const msg = (id, from, subject, text, at, labels) => ({ id, threadId, labelIds: labels, internalDate: String(at), snippet: text.slice(0, 80), payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }, { name: "Subject", value: subject }], parts: [{ mimeType: "text/plain", body: { data: b64(text) } }, { mimeType: "text/html", body: { data: b64(`<div>${text}</div>`) } }] } });
        const messages = [
          ...sent.map((x) => msg(x.id, "Bram Frankel <owner@example.com>", x.subject, x.body || "", x.at || Date.now(), ["SENT"])),
          ...greplies.filter((r) => r.threadId === threadId).map((r) => msg(r.id, r.from, r.subject, `${r.text}\n\nOn ${new Date(r.at).toUTCString()} Bram Frankel <owner@example.com> wrote:\n> Hello`, r.at, ["INBOX", "UNREAD"])),
        ];
        return send(res, 200, { id: threadId, messages });
      }
    }
    if (p === "/__drafts") return send(res, 200, gdraftList);
    if (p === "/__events") return send(res, 200, gEventList);
    if (p === "/o/oauth2/v2/auth") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", `mock-code-${gmode.grantSend ? "send" : "nosend"}-${gmode.grantSignature ? "sig" : "nosig"}-${gmode.grantRead ? "read" : "noread"}`);
      back.searchParams.set("state", url.searchParams.get("state") || "");
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (p === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readRaw(req));
      const scopes = [...BASE_SCOPES, ...(gmode.grantSend ? [SEND] : []), ...(gmode.grantSignature ? [SETTINGS] : []), ...(gmode.grantRead ? [READ] : [])];
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") || "";
        const granted = [...BASE_SCOPES, ...(code.includes("-send-") ? [SEND] : []), ...(code.includes("-sig-") ? [SETTINGS] : []), ...(code.endsWith("-read") ? [READ] : [])];
        return send(res, 200, { access_token: "mock-access", refresh_token: "mock-refresh-token", scope: granted.join(" "), expires_in: 3600, token_type: "Bearer" });
      }
      return send(res, 200, { access_token: "mock-access", scope: scopes.join(" "), expires_in: 3600, token_type: "Bearer" });
    }
    if (p === "/gmail/v1/users/me/messages/send" && req.method === "POST") {
      if (gmode.sendError === "scope") return send(res, 403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
      if (gmode.sendError === "server") return send(res, 500, { error: { code: 500, message: "Backend Error", status: "INTERNAL" } });
      const body = JSON.parse((await readRaw(req)) || "{}");
      const id = `mock-msg-${gsent.length + 1}-${Date.now().toString(36)}`;
      gsent.push({ id, threadId: body.threadId || `thread-${id}`, at: Date.now(), ...decodeRaw(body.raw) });
      return send(res, 200, { id, threadId: body.threadId || `thread-${id}`, labelIds: ["SENT"] });
    }
    if (p === "/gmail/v1/users/me/drafts" && req.method === "POST") {
      const body = JSON.parse((await readRaw(req)) || "{}");
      const id = `mock-draft-${++gdrafts}`;
      gdraftList.push({ id, ...decodeRaw(body.message?.raw) });
      return send(res, 200, { id, message: { id: `mock-draft-msg-${gdrafts}` } });
    }
    if (p === "/gmail/v1/users/me/settings/sendAs" && req.method === "GET") {
      return send(res, 200, {
        sendAs: [
          { sendAsEmail: "alias@example.com", displayName: "Alias", isPrimary: false, isDefault: false, signature: "<div>Alias signature (not the default)</div>" },
          { sendAsEmail: "owner@example.com", displayName: "Bram Frankel", isPrimary: true, isDefault: true, signature: SAMPLE_SIGNATURE },
        ],
      });
    }
    if (p.startsWith("/calendar/v3/calendars/primary/events")) {
      if (gmode.calendarError) return send(res, Number(gmode.calendarError), { error: { code: Number(gmode.calendarError), message: "Request had insufficient authentication scopes." } });
      if (req.method === "POST") {
        const body = JSON.parse((await readRaw(req)) || "{}");
        const id = `mock-event-${++gEvents}`;
        gEventList.push({ id, summary: body.summary, description: body.description ?? null, start: body.start?.dateTime ?? null, end: body.end?.dateTime ?? null, timeZone: body.start?.timeZone ?? null });
        return send(res, 200, { id });
      }
      // Push C: the day's events. timeMin is the owner's local midnight, so the two sample events sit at 12:30 and
      // 15:30 local time on weekdays; the events created here (blocks) are listed when they fall in the range.
      const min = Date.parse(url.searchParams.get("timeMin") || "");
      const max = Date.parse(url.searchParams.get("timeMax") || "");
      const items = [];
      if (Number.isFinite(min) && Number.isFinite(max)) {
        const dow = new Date(min + 12 * 3600e3).getUTCDay();
        if (gmode.calendarEvents !== false && dow >= 1 && dow <= 5) {
          const at = (h, m) => new Date(min + (h * 60 + m) * 60e3).toISOString();
          items.push({ id: `sample-lunch-${min}`, status: "confirmed", summary: "Lunch with Dana Whitfield", start: { dateTime: at(12, 30) }, end: { dateTime: at(13, 0) } });
          items.push({ id: `sample-call-${min}`, status: "confirmed", summary: "Call with Greg Thornton, Sullivan Wickley", start: { dateTime: at(15, 30) }, end: { dateTime: at(16, 0) } });
          items.push({ id: `sample-allday-${min}`, status: "confirmed", summary: "Office closed (all day)", start: { date: "2026-01-01" }, end: { date: "2026-01-02" } });
        }
        for (const e of gEventList) {
          const t = Date.parse(e.start || "");
          if (t >= min && t < max) items.push({ id: e.id, status: "confirmed", summary: e.summary, start: { dateTime: e.start }, end: { dateTime: e.end } });
        }
      }
      items.sort((a, b) => String(a.start.dateTime || "").localeCompare(String(b.start.dateTime || "")));
      return send(res, 200, { items });
    }
    if (p.startsWith("/calendar/v3/users/me/calendarList")) return send(res, 200, { items: [] });
    return send(res, 404, { error: { code: 404, message: `Not in the Google mock: ${req.method} ${p}` } });
  } catch (e) {
    return send(res, 500, { error: { code: 500, message: e.message } });
  }
});
google.listen(GOOGLE_PORT, () => console.log(`Mock Google listening on http://localhost:${GOOGLE_PORT}`));

// ---------- Anthropic stand-in (LOCAL TESTING ONLY) ----------
// The app talks to it when ANTHROPIC_API_MOCK_URL=http://localhost:54330 (dev-tools/local.env); the app honors that
// variable only for a localhost address. Replies:
//   "TASK: initiative_proposal" -> the weekly meal plan proposal (dev-tools/fixtures/meal-plan.cjs)
//   "TASK: savings_ideas"       -> up to 3 ideas built from the expense keys in the request
//   "TASK: compose_email"       -> a short email built from the one-line instruction (Email button, Write with AI)
//   "TASK: listing_fields"      -> the listing fields read from the pasted text with simple patterns (Fill from text);
//                                  with {"listing": "invalid"} a plain sentence instead (never the fields, so the app
//                                  shows the reply after its retry)
//   "TASK: open_questions"      -> three groups of questions built from the deal name in the request (Interested, Suggest questions)
//   "TASK: deal_todos"          -> three task lines built from the deal name (Suggest tasks); with {"todos": "plain"} the same
//                                  three lines as plain bulleted text (no JSON); with {"todos": "invalid"} a JSON object
//                                  without a list, so the app shows the reply after its retry
//   "TASK: next_steps"          -> three suggested next steps built from the page title (the Ask AI panel, batch B2; also
//                                  the suggested tasks of the Tasks card star)
//   "TASK: ask_page"            -> a bulleted answer to the question with a next action and an email draft (Ask about this page)
//   "TASK: key_finding"         -> strengths, risks, growth paths (revision 1), a key finding, and broker questions (the Key finding star, AI instructions 2026-11-02)
//   "TASK: field_draft"         -> one line for the field named in the request (the star inside a field; "Use this");
//                                  with {"field": "plain"} the line as plain text (no JSON)
//   "TASK: next_action"         -> one next action due two days after the "Today is" date (a Monday when that is a weekend),
//                                  30 minutes (none for a person), built from the page title (the next action star, Edit batch C round 2)
//   "TASK: ai_order"            -> the rows of the request in reverse order with one reason each (By the AI on Home)
//   chat (a request with tools) -> a short bulleted answer
//   anything else               -> HTTP 400, so morning plans, review drafts, and message drafts use their templates
// Test controls: POST /__mode {"initiative": "valid" | "invalid_once" | "invalid", "listing": "valid" | "invalid", "todos": "valid" | "plain" | "invalid",
// "field": "valid" | "plain", "cutoff": "none" | "once" (the next next_steps and ask_page replies come back cut off before
// their JSON closes, with stop_reason max_tokens, once each, like a reply that hit the length limit; the retry with the
// higher limit gets the full reply), "delay": <ms before every AI reply, 0 by default>, "answerNext": "action" | "none" | "YYYY-MM-DD"
// (the Ask about this page answer's next action: the default line, none, or the line with that date)}; GET /__calls; GET /__limits (max_tokens per next_steps and ask_page request);
// GET /__last_chat (the last chat request's system prompt and messages, to check "Ask AI about this" context); GET /__prompts
// (the last prompt of each task by its TASK name, to check what the app sent, such as the facts in the Key finding draft); GET /__full
// (push D: the same with the system prompt, to check the writing rules are sent once per click); POST /__reset.
import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);
const { mealPlanProposal } = requireCjs("./fixtures/meal-plan.cjs");
const AI_PORT = Number(process.env.MOCK_AI_PORT || 54330);
let aiMode = { initiative: "valid", listing: "valid", todos: "valid", field: "valid", cutoff: "none", delay: 0, answerNext: "action" };
let aiCalls = [];
let invalidSent = false;
/** The tasks whose cut-off reply went out already under cutoff "once". */
let cutSent = new Set();
/** The max_tokens of every next_steps and ask_page request, in order (GET /__limits), to check the retry asks with double the limit. */
let aiLimits = [];
let lastChat = null;
/** The last prompt of each task ("field_draft", "next_action", ...), so a check can read what the app sent (GET /__prompts). */
let lastPrompts = {};
/** Push D: the last request of each task with its system prompt (GET /__full). */
let lastFull = {};

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function aiMessage(text, stopReason = "end_turn") {
  return { id: `msg_mock_${Date.now().toString(36)}`, type: "message", role: "assistant", model: "mock-model", content: [{ type: "text", text }], stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 900 } };
}

/** Under cutoff "once": the first reply of a task is its full text cut at about 40%, with stop_reason max_tokens, as the API returns a reply that hit max_tokens. */
function maybeCut(task, full, body) {
  aiLimits.push({ task, max_tokens: body.max_tokens });
  if (aiMode.cutoff !== "once" || cutSent.has(task)) return aiMessage(full);
  cutSent.add(task);
  aiCalls.push(`${task}_cut`);
  const text = full.slice(0, Math.floor(full.length * 0.4));
  if (process.env.MOCK_DEBUG) console.error("cut-off reply", task, "max_tokens", body.max_tokens, JSON.stringify(text));
  return aiMessage(text, "max_tokens");
}

function savingsReply(prompt) {
  const m = prompt.match(/Expenses \(key, type, monthly cost, last 90 days, flags\): (\[.*\])\n/);
  const list = m ? JSON.parse(m[1]) : [];
  const ideas = [];
  const unused = list.find((c) => c.type === "recurring_series" && c.unused_subscription_flag);
  if (unused) ideas.push({ title: `Cancel ${unused.name}`, target_keys: [unused.key], estimate: { method: "cancel" }, effort: "low", steps: ["Sign in to the account settings", "Cancel the plan and save the confirmation", "Check the next card statement"] });
  const storage = list.filter((c) => c.type === "recurring_series" && /storage/i.test(c.name) && !/cloud/i.test(c.name)).sort((a, b) => a.monthly - b.monthly)[0];
  if (storage) ideas.push({ title: `Close ${storage.name} and combine units`, target_keys: [storage.key], estimate: { method: "cancel" }, effort: "medium", steps: ["Move what is kept into the other two units", "Give 30 days notice", "Confirm the last charge"] });
  const groceries = list.find((c) => c.type === "category" && /grocer/i.test(c.name));
  if (groceries) ideas.push({ title: "Shop once a week from a list", target_keys: [groceries.key], estimate: { method: "reduce_percent", percent: 25 }, effort: "medium", steps: ["Plan the week's meals on Saturday", "Shop once with the list", "Cook on Sunday for the week"] });
  return { ideas: ideas.slice(0, 3) };
}

const ai = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${AI_PORT}`);
  try {
    if (url.pathname === "/__mode" && req.method === "POST") {
      aiMode = { ...aiMode, ...JSON.parse((await readRaw(req)) || "{}") };
      invalidSent = false;
      cutSent = new Set();
      return send(res, 200, aiMode);
    }
    if (url.pathname === "/__reset" && req.method === "POST") {
      aiMode = { initiative: "valid", listing: "valid", todos: "valid", field: "valid", cutoff: "none", delay: 0, answerNext: "action" };
      aiCalls = [];
      aiLimits = [];
      lastPrompts = {};
      lastFull = {};
      invalidSent = false;
      cutSent = new Set();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__calls") return send(res, 200, aiCalls);
    if (url.pathname === "/__limits") return send(res, 200, aiLimits);
    if (url.pathname === "/__last_chat") return send(res, 200, lastChat ?? {});
    if (url.pathname === "/__prompts") return send(res, 200, lastPrompts);
    if (url.pathname === "/__full") return send(res, 200, lastFull);
    if (url.pathname.startsWith("/v1/models")) return send(res, 200, { data: [{ id: "mock-model", type: "model" }], has_more: false });
    if (url.pathname === "/v1/messages" && req.method === "POST") {
      const body = JSON.parse((await readRaw(req)) || "{}");
      // A delay before the reply (the checks look at the Thinking state while the AI works).
      if (Number(aiMode.delay) > 0) await new Promise((r) => setTimeout(r, Number(aiMode.delay)));
      const text = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => b.text ?? "").join("\n"))).join("\n");
      const taskName = (text.match(/TASK: ([a-z_]+)/) || [])[1];
      if (taskName) lastPrompts[taskName] = text;
      // Push D: the system prompt with the messages, to check the writing rules go once per click (GET /__full).
      if (taskName) lastFull[taskName] = { system: typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? ""), text };
      if (text.includes("TASK: initiative_proposal")) {
        aiCalls.push("initiative_proposal");
        const retry = (body.messages ?? []).length > 1;
        if (aiMode.initiative === "invalid" || (aiMode.initiative === "invalid_once" && !invalidSent && !retry)) {
          invalidSent = true;
          return send(res, 200, aiMessage("Here is a plan: shop on Saturday and cook on Sunday."));
        }
        return send(res, 200, aiMessage("```json\n" + JSON.stringify(mealPlanProposal(nyToday()), null, 2) + "\n```"));
      }
      if (text.includes("TASK: savings_ideas")) {
        aiCalls.push("savings_ideas");
        const reply = savingsReply(text);
        if (process.env.MOCK_DEBUG) console.error("savings reply", JSON.stringify(reply));
        return send(res, 200, aiMessage(JSON.stringify(reply)));
      }
      if (text.includes("TASK: compose_email")) {
        aiCalls.push("compose_email");
        const line = (text.match(/What (?:Bram|the user) wants the email to do: "([^"]*)"/) || [])[1] || "check in";
        const first = (text.match(/using the first name ([^.\s]+)/) || [])[1] || "there";
        const reply = { subject: `Quick question: ${line}`.slice(0, 80), body: `Hi ${first},\n\nI hope things are going well. I wanted to reach out to ${line}.\n\n- What you are seeing right now\n- Anyone I should talk to\n\nWould you have 15 minutes this week?\n\nThanks,\nBram` };
        return send(res, 200, aiMessage(JSON.stringify(reply)));
      }
      if (text.includes("TASK: listing_fields")) {
        aiCalls.push("listing_fields");
        const listing = (text.split('"""')[1] || "").trim();
        if (aiMode.listing === "invalid") return send(res, 200, aiMessage("I can see an industrial filtration distributor in Macon with about $4M in sales, but the text gives no asking price or earnings figure, so I cannot fill the fields."));
        const pick = (re) => (listing.match(re) || [])[1] || "";
        // "$ 10,000,000" (a space after the dollar sign, as on Website Closers) reads as "$10,000,000".
        const money = (label) => pick(new RegExp(`${label}[^$\\d]{0,12}(\\$?\\s?\\d[\\d,.]*\\s*[MmKk]?)`)).replace(/^\$\s+/, "$").trim();
        const sde = money("SDE") || money("Cash Flow");
        const headline = pick(/^(?:Business|Listing|Name)?:?\s*([^\n]{3,80})/m).replace(/^(For sale|Listing|Name):\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
        // A line "Company: X" names the company; otherwise the headline is the listing description.
        const company = pick(/^Company:\s*([^\n]{3,80})/m);
        const reply = {
          listing_name: headline.replace(/\s+(Co|Company|Inc|LLC)\.?$/i, ""),
          company_name: company,
          source: /newsletter/i.test(listing) ? "Broker newsletter" : /network|intro/i.test(listing) ? "Network" : "Broker outreach",
          what_it_does: pick(/(?:What it does|Description|Overview)[:\s]+([^\n]{5,160})/i) || (listing.split("\n").find((l) => /\b(for|serving|provides|offers)\b/i.test(l)) || "").trim().slice(0, 160),
          broker_name: pick(/(?:Broker|Listed by|Contact):\s*([^\n]{3,60})/i),
          revenue: money("Revenue") || money("Gross Income"),
          earnings: money("EBITDA") || (sde ? `${sde} SDE` : ""),
          asking_price: money("Asking(?: price)?"),
          location: pick(/(?:Location|Based in|Located in)[:\s]+([^\n]{3,60})/i),
          industry: pick(/Industry[:\s]+([^\n]{3,60})/i),
          listing_url: pick(/(https?:\/\/\S+|\b[a-z0-9.-]+\.(?:com|net|org)\/\S*)/i),
          // Fix 2026-11-02: the three facts read when the text states them.
          why_selling: pick(/(?:Why selling|Reason for selling)[:\s]+([^\n]{3,120})/i),
          year_established: pick(/(?:Year Established|Established|Founded)[:\s]+(\d{4})/i),
          employees: pick(/Employees[:\s]+([^\n]{1,60})/i) || pick(/team of (\d+\+? [a-z ]{3,30}?coaches)/i),
        };
        // Edit batch C round 3: "no_url" leaves the link empty, so the app's own search of the text fills it.
        if (aiMode.listing === "no_url") reply.listing_url = "";
        return send(res, 200, aiMessage(JSON.stringify(reply)));
      }
      if (text.includes("TASK: open_questions")) {
        aiCalls.push("open_questions");
        const deal = (text.match(/^Deal: ([^\n]+)/m) || [])[1] || "this deal";
        const asked = (text.split("Questions already on the deal (do not repeat):")[1] || "").toLowerCase();
        const seller = [`Why are you selling ${deal} now?`, `Which customers make up the top 20% of ${deal}'s revenue?`].filter((q) => !asked.includes(q.toLowerCase()));
        const broker = [`Can we get 3 years of financials for ${deal}?`, `Are there other bidders on ${deal}?`].filter((q) => !asked.includes(q.toLowerCase()));
        const self = [`Who are the local competitors of ${deal}?`].filter((q) => !asked.includes(q.toLowerCase()));
        return send(res, 200, aiMessage("```json\n" + JSON.stringify({ seller, broker, self }) + "\n```"));
      }
      if (text.includes("TASK: deal_todos")) {
        aiCalls.push("deal_todos");
        const deal = (text.match(/^Deal: ([^\n]+)/m) || [])[1] || "this deal";
        const listed = (text.match(/Items already listed \(do not repeat\): ([^\n]+)/) || [])[1] || "";
        const todos = [`Read the CIM of ${deal} end to end`, `Ask for the customer list of ${deal}`, `Compare ${deal} with the last two deals passed on`].filter((t) => !listed.toLowerCase().includes(t.toLowerCase()));
        if (aiMode.todos === "invalid") return send(res, 200, aiMessage(JSON.stringify({ note: "Nothing to add for this deal." })));
        if (aiMode.todos === "plain") return send(res, 200, aiMessage(`Here are a few things to do:\n${todos.map((t) => `- ${t}`).join("\n")}`));
        return send(res, 200, aiMessage(JSON.stringify({ items: todos })));
      }
      if (text.includes("TASK: next_steps")) {
        aiCalls.push("next_steps");
        const page = (text.match(/^Page: ([^\n]+)/m) || [])[1] || "this record";
        const steps = [
          { text: `Email the main contact on ${page} today`, reason: "The last contact is the oldest line on the page" },
          { text: `Write the key finding for ${page}`, reason: "Nothing on the page says what decides it yet" },
          { text: "Book 30 minutes to clear the open tasks", reason: "The tasks are short and unblock the next action" },
        ];
        return send(res, 200, maybeCut("next_steps", "```json\n" + JSON.stringify({ steps }) + "\n```", body));
      }
      if (text.includes("TASK: ask_page")) {
        aiCalls.push("ask_page");
        const q = (text.match(/(?:Bram|The signed-in user) asks about this page: "([^"]*)"/) || [])[1] || "your question";
        const page = (text.match(/^Page: ([^\n]+)/m) || [])[1] || "this page";
        const first = (text.match(/^- (?:deal|person|project|opportunity|consulting): ([^|]+?) \|/m) || [])[1] || "the first record";
        const canEmail = !text.includes("Set email to null");
        const reply = {
          bullets: [`**First:** ${first.trim()} comes first on ${page}.`, `**Then:** the rest of the page in due order (you asked: ${q}).`, "**Watch:** anything waiting over 5 days."],
          // "answerNext": "none" answers with no next action; a YYYY-MM-DD value gives that date as next_action_due.
          next_action: aiMode.answerNext === "none" ? null : `Deal with ${first.trim()} first`,
          next_action_due: /^\d{4}-\d{2}-\d{2}$/.test(String(aiMode.answerNext ?? "")) ? aiMode.answerNext : null,
          email: canEmail ? { subject: `Quick follow-up on ${first.trim()}`, body: `Hi there,\n\nQuick follow-up on ${first.trim()}. Is there an update on timing?\n\nThanks,\nBram` } : null,
        };
        return send(res, 200, maybeCut("ask_page", JSON.stringify(reply), body));
      }
      if (text.includes("TASK: key_finding")) {
        // AI instructions (2026-11-02): Strengths, Risks, the Key finding, and Check with the broker in one reply.
        aiCalls.push("key_finding");
        const page = ((text.match(/^Page: ([^\n]+)/m) || [])[1] || "this deal").replace(/^(Deal|Listing): /, "");
        const revenue = (text.match(/^- revenue: (\$[\d,]+)/m) || [])[1] || "the stated revenue";
        const reply = {
          strengths: [`Mock strength: revenue of ${revenue} with repeat clients`, "Mock strength: a team of coaches delivers the work"],
          risks: ["Mock risk: the owner's role after the sale is not clear"],
          // Revision 1: up to 3 growth paths, the main one first.
          growth_paths: [`Mock growth path: sell to employer groups, using revenue of ${revenue}`, "Mock growth path: raise prices on renewals", "Mock growth path: add a second coaching program"],
          key_finding: `Mock key finding: ${page} has steady revenue; the owner transition decides it.`,
          broker_questions: ["Mock question: which period does the revenue figure cover?", "Mock question: how many clients renew each year?"],
        };
        return send(res, 200, maybeCut("key_finding", JSON.stringify(reply), body));
      }
      if (text.includes("TASK: field_draft")) {
        aiCalls.push("field_draft");
        const what = (text.match(/^Write (.+?)\.\n/m) || [])[1] || "the text";
        const page = (text.match(/^Page: ([^\n]+)/m) || [])[1] || "this page";
        const drafts = [
          // Batch C: the tomorrow line and a missed commitment's reason.
          [/next working day/, "Finish the Meridian model before 10, then chase Mark Reed on the Summit seller call"],
          [/missed commitment/, "The Dalton CIM review and the broker calls took the screening block; 2 listings carry to tomorrow"],
          // Push D: an answer of the Friday Weekly review.
          [/weekly review/, "Screened 27 listings and hit the outreach target for the first time in three weeks"],
          [/subject line/, `Next step on ${page}`],
          [/email message/, `Hi there,\n\nQuick note about ${page}: what is the next step on your side?\n\nThanks,\nBram`],
          [/key finding/, `Mock finding: ${page} turns on one number the page does not show yet`],
          [/one thing Rosara/, "This week: finish the agency hub onboarding flow and send the deck to two investors"],
          [/one task/, `Ask about the next step on ${page}`],
          [/short note/, `Mock note: the page ${page} was reviewed by the local test AI`],
          [/one question/, `What decides ${page}, and who makes that call?`],
          [/next action/, `Call the main contact about ${page}`],
        ];
        const hit = drafts.find(([re]) => re.test(what));
        if (aiMode.field === "plain") return send(res, 200, aiMessage(hit ? hit[1] : `Mock text for ${page}`));
        return send(res, 200, aiMessage(JSON.stringify({ text: hit ? hit[1] : `Mock text for ${page}` })));
      }
      if (text.includes("TASK: next_action")) {
        aiCalls.push("next_action");
        const page = (text.match(/^Page: ([^\n]+)/m) || [])[1] || "this record";
        const today = (text.match(/Today is [A-Za-z]+, (\d{4}-\d{2}-\d{2})/) || [])[1] || nyToday();
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 2);
        if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
        if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
        const person = text.includes("Set minutes to null");
        const reply = { action: person ? `Check in about the next step (${page.replace(/^Person: /, "")})` : `Mock next action: confirm the next step on ${page}`, due: d.toISOString().slice(0, 10), minutes: person ? null : 30, reason: "The stage default and the last timeline line point here" };
        return send(res, 200, maybeCut("next_action", JSON.stringify(reply), body));
      }
      if (text.includes("TASK: eod_reasons")) {
        aiCalls.push("eod_reasons");
        // "Name (figure; id <id>)" per missed commitment.
        const asked = [...text.matchAll(/([A-Za-z' -]+?) \(([^;)]+); id ([^)]+)\)/g)].map((m) => ({ name: m[1].trim(), figure: m[2], id: m[3] }));
        const reasons = asked.map((a, i) => ({ target_id: a.id, reason: i === 0 ? `Mock reason: the ${a.name.toLowerCase()} block went to the Dalton CIM; ${a.figure} and the rest carries to tomorrow` : `Mock reason: deal work filled the afternoons; ${a.name.toLowerCase()} ${a.figure}, the rest moves to next week` }));
        return send(res, 200, maybeCut("eod_reasons", JSON.stringify({ reasons }), body));
      }
      if (text.includes("TASK: ai_order")) {
        aiCalls.push("ai_order");
        const keys = [...text.matchAll(/^- key=([^ |]+)/gm)].map((m) => m[1]);
        const order = keys.slice().reverse().map((key, i) => ({ key, reason: i === 0 ? "Mock: the local test AI puts the last row first" : `Mock reason ${i + 1} for ${key.split(":")[0]}` }));
        return send(res, 200, aiMessage("```json\n" + JSON.stringify({ order }) + "\n```"));
      }
      if (Array.isArray(body.tools) && body.tools.length) {
        aiCalls.push("chat");
        lastChat = { system: typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? ""), messages: body.messages ?? [] };
        return send(res, 200, aiMessage("- **Runway:** this is the local test AI. It answers without reading your data.\n- **Next step:** ask again on the live app."));
      }
      aiCalls.push("other");
      return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "The local AI stand-in answers only initiative, savings, listing, question, to-do, Ask AI, order, End of day reasons, and chat requests." } });
    }
    return send(res, 404, { type: "error", error: { type: "not_found_error", message: `Not in the AI mock: ${req.method} ${url.pathname}` } });
  } catch (e) {
    return send(res, 500, { type: "error", error: { type: "api_error", message: e.message } });
  }
});
ai.listen(AI_PORT, () => console.log(`Mock Anthropic listening on http://localhost:${AI_PORT}`));

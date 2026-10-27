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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
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
    if (url.pathname.startsWith("/storage/v1/")) return send(res, 400, { message: "Storage is not supported by the local mock" });

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
// {"sendError": "scope" | "server" | null}; GET /__sent lists the emails "sent" (decoded); POST /__reset clears both.
const GOOGLE_PORT = Number(process.env.MOCK_GOOGLE_PORT || 54329);
const BASE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const SEND = "https://www.googleapis.com/auth/gmail.send";
let gmode = { grantSend: true, sendError: null };
let gsent = [];
let gdrafts = 0;
let gEvents = 0;

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
  const subject = (headers.subject || "").replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8"));
  const bodyRaw = rest.join("\r\n\r\n");
  const body = headers["content-transfer-encoding"] === "base64" ? Buffer.from(bodyRaw.replace(/\r\n/g, ""), "base64").toString("utf8") : bodyRaw;
  return { to: headers.to, subject, body, headers };
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
      gmode = { grantSend: true, sendError: null };
      gsent = [];
      return send(res, 200, { ok: true });
    }
    if (p === "/__sent") return send(res, 200, gsent);
    if (p === "/o/oauth2/v2/auth") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", gmode.grantSend ? "mock-code-send" : "mock-code-nosend");
      back.searchParams.set("state", url.searchParams.get("state") || "");
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (p === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readRaw(req));
      const scopes = gmode.grantSend ? [...BASE_SCOPES, SEND] : BASE_SCOPES;
      if (form.get("grant_type") === "authorization_code") {
        const granted = form.get("code") === "mock-code-send" ? [...BASE_SCOPES, SEND] : BASE_SCOPES;
        return send(res, 200, { access_token: "mock-access", refresh_token: "mock-refresh-token", scope: granted.join(" "), expires_in: 3600, token_type: "Bearer" });
      }
      return send(res, 200, { access_token: "mock-access", scope: scopes.join(" "), expires_in: 3600, token_type: "Bearer" });
    }
    if (p === "/gmail/v1/users/me/messages/send" && req.method === "POST") {
      if (gmode.sendError === "scope") return send(res, 403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
      if (gmode.sendError === "server") return send(res, 500, { error: { code: 500, message: "Backend Error", status: "INTERNAL" } });
      const body = JSON.parse((await readRaw(req)) || "{}");
      const id = `mock-msg-${gsent.length + 1}-${Date.now().toString(36)}`;
      gsent.push({ id, threadId: body.threadId || `thread-${id}`, ...decodeRaw(body.raw) });
      return send(res, 200, { id, threadId: body.threadId || `thread-${id}`, labelIds: ["SENT"] });
    }
    if (p === "/gmail/v1/users/me/drafts" && req.method === "POST") return send(res, 200, { id: `mock-draft-${++gdrafts}`, message: { id: `mock-draft-msg-${gdrafts}` } });
    if (p.startsWith("/calendar/v3/calendars/primary/events")) {
      if (req.method === "POST") return send(res, 200, { id: `mock-event-${++gEvents}` });
      return send(res, 200, { items: [] });
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
//   chat (a request with tools) -> a short bulleted answer
//   anything else               -> HTTP 400, so morning plans, review drafts, and message drafts use their templates
// Test controls: POST /__mode {"initiative": "valid" | "invalid_once" | "invalid"}; GET /__calls; POST /__reset.
import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);
const { mealPlanProposal } = requireCjs("./fixtures/meal-plan.cjs");
const AI_PORT = Number(process.env.MOCK_AI_PORT || 54330);
let aiMode = { initiative: "valid" };
let aiCalls = [];
let invalidSent = false;

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function aiMessage(text) {
  return { id: `msg_mock_${Date.now().toString(36)}`, type: "message", role: "assistant", model: "mock-model", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 900 } };
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
      return send(res, 200, aiMode);
    }
    if (url.pathname === "/__reset" && req.method === "POST") {
      aiMode = { initiative: "valid" };
      aiCalls = [];
      invalidSent = false;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__calls") return send(res, 200, aiCalls);
    if (url.pathname.startsWith("/v1/models")) return send(res, 200, { data: [{ id: "mock-model", type: "model" }], has_more: false });
    if (url.pathname === "/v1/messages" && req.method === "POST") {
      const body = JSON.parse((await readRaw(req)) || "{}");
      const text = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => b.text ?? "").join("\n"))).join("\n");
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
      if (Array.isArray(body.tools) && body.tools.length) {
        aiCalls.push("chat");
        return send(res, 200, aiMessage("- **Runway:** this is the local test AI. It answers without reading your data.\n- **Next step:** ask again on the live app."));
      }
      aiCalls.push("other");
      return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "The local AI stand-in answers only initiative, savings, and chat requests." } });
    }
    return send(res, 404, { type: "error", error: { type: "not_found_error", message: `Not in the AI mock: ${req.method} ${url.pathname}` } });
  } catch (e) {
    return send(res, 500, { type: "error", error: { type: "api_error", message: e.message } });
  }
});
ai.listen(AI_PORT, () => console.log(`Mock Anthropic listening on http://localhost:${AI_PORT}`));

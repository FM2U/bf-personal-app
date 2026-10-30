// LOCAL TESTING ONLY. Opens key pages as the signed-in owner (fake session for the local mock) and
// saves screenshots to docs/screenshots. Reports pages that fail to render.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-pages.cjs [baseUrl]
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const OWNER = process.env.OWNER_ID || "00000000-0000-0000-0000-000000000001";
const EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

function fakeJwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.${Buffer.from("local-test-signature").toString("base64url")}`;
}

const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 30;
const user = { id: OWNER, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
const session = {
  access_token: fakeJwt({ sub: OWNER, email: EMAIL, role: "authenticated", aal: "aal2", amr: [{ method: "totp", timestamp: 1 }], exp, aud: "authenticated" }),
  refresh_token: "local-refresh",
  expires_in: 3600 * 24 * 30,
  expires_at: exp,
  token_type: "bearer",
  user,
};
const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

const PAGES = (process.env.PAGES || [
  "/", "/today/close", "/today/close?step=2", "/today/close?step=3", "/more", "/more/old-home", "/plan", "/plan/goals", "/plan/milestones", "/plan/conditions", "/plan/inputs", "/plan/scenarios", "/plan/decisions",
  "/finance", "/finance/balance-sheet", "/finance/expenses", "/finance/import", "/finance/budget", "/finance/debt", "/finance/funding", "/finance/income", "/finance/savings",
  "/opportunities", "/people", "/people/organizations", "/people/communications", "/people/outreach",
  "/productivity", "/productivity/tasks", "/productivity/recurring", "/productivity/calendar", "/productivity/pipeline-actions",
  "/accountability", "/accountability/targets", "/accountability/reviews", "/accountability/scores", "/accountability/partners", "/accountability/reports", "/accountability/report-templates",
  "/settings", "/settings/email", "/settings/ai", "/settings/imports", "/settings/partner-access", "/settings/initiatives", "/settings/categories", "/settings/export", "/settings/profile", "/settings/change-log",
  "/proposals", "/plan/start", "/settings/data", "/records/tasks/new", "/records/decision_conditions/new", "/records/pipeline_items/new", "/records/contacts/new", "/records/organizations/new",
].join(",")).split(",");

// Record pages found in the local demo database (consulting list and item, acquisition item form, contact with deal credit).
// Shown at 1440 and 1280 wide and on the phone, with Outreach Queue and Finance, Income Received.
async function keyPages() {
  let pg;
  try {
    pg = require(path.join(__dirname, "..", "node_modules", "pg"));
  } catch {
    return [];
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
  try {
    await client.connect();
    const one = async (sql) => (await client.query(sql)).rows[0]?.id;
    const out = [];
    const con = await one("select id from pipelines where kind = 'consulting' limit 1").catch(() => null);
    if (con) out.push(`/opportunities/${con}?view=list`);
    const item = await one("select id from pipeline_items where name = 'Demo Retail Group: operations retainer' limit 1").catch(() => null);
    if (item) out.push(`/records/pipeline_items/${item}`);
    const acq = await one("select id from pipeline_items where name = 'Demo HVAC Services Co' limit 1").catch(() => null);
    if (acq) out.push(`/records/pipeline_items/${acq}?edit=1`);
    const contact = await one("select id from contacts where name = 'Jamie Fictional' limit 1").catch(() => null);
    if (contact) out.push(`/records/contacts/${contact}`);
    // Next required action states: one item overdue (seed) and one due today (set here, local demo data only).
    const late = await one("select id from pipeline_items where name = 'Demo Landscaping LLC' limit 1").catch(() => null);
    if (late) out.push(`/records/pipeline_items/${late}#overdue`);
    const dueToday = await one(
      "update pipeline_items set next_action_due = (now() at time zone 'America/New_York')::date where name = 'Demo Bookkeeping Firm' returning id",
    ).catch(() => null);
    if (dueToday) out.push(`/records/pipeline_items/${dueToday}#due-today`);
    const org = await one("select id from organizations where name = 'Demo Retail Group' limit 1").catch(() => null);
    if (org) out.push(`/records/organizations/${org}`);
    const acqPipe = await one("select id from pipelines where kind = 'acquisition' limit 1").catch(() => null);
    if (acqPipe) out.push(`/opportunities/${acqPipe}?view=board&closed=1`, `/opportunities/${acqPipe}#funnel`);
    return [...out, "/accountability/targets", "/people/outreach", "/finance/income", "/records/contacts/new", "/records/organizations/new", "/finance/import"];
  } catch {
    return [];
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  const KEY = process.env.KEY_PAGES === "0" ? [] : await keyPages();
  const named = (p) => {
    if (p === "/today/close") return "close-step-1";
    if (p === "/today/close?step=2") return "close-step-2";
    if (p === "/today/close?step=3") return "close-step-3";
    if (p.startsWith("/opportunities/") && p.includes("view=list")) return "consulting-list";
    if (p.startsWith("/opportunities/") && p.includes("view=board")) return "board-closed-stages";
    if (p.startsWith("/opportunities/") && p.endsWith("#funnel")) return "acquisitions-funnel";
    if (p.startsWith("/records/organizations/") && !p.endsWith("/new")) return "organization-page";
    if (p.startsWith("/records/pipeline_items/") && p.endsWith("?edit=1")) return "acquisition-item-form";
    if (p.startsWith("/records/pipeline_items/") && p.endsWith("#due-today")) return "pipeline-item-due-today";
    if (p.startsWith("/records/pipeline_items/") && p.endsWith("#overdue")) return "pipeline-item-overdue";
    if (p.startsWith("/records/pipeline_items/")) return "consulting-item";
    if (p.startsWith("/records/contacts/")) return "contact-deal-credit";
    return null;
  };
  for (const [vpName, viewport] of [["desktop", { width: 1440, height: 900 }], ["desktop1280", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: "sb-localhost-auth-token", value: cookieValue, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const base = vpName === "desktop" ? PAGES : vpName === "phone" ? (process.env.PHONE_PAGES || "/,/today/close,/more,/finance/expenses,/finance/balance-sheet,/accountability/report-templates,/opportunities,/plan/inputs,/accountability/targets,/people/outreach,/productivity").split(",") : [];
    const list = [...new Set([...base, ...KEY])];
    for (const p of list) {
      errors.length = 0;
      const res = await page.goto(BASE + p, { waitUntil: "networkidle" }).catch((e) => ({ status: () => 0, err: e }));
      const status = res.status();
      const body = await page.innerText("body").catch(() => "");
      const bad = status >= 400 || status === 0 || /Application error|Internal Server Error|This page could not be found|Unhandled Runtime Error/i.test(body || "") || page.url().includes("/login");
      const name = named(p) ? `${vpName}-${named(p)}.png` : `${vpName}${p === "/" ? "-home" : p.replace(/\//g, "-").replace(/[?=&]/g, "_")}.png`;
      if (process.env.SHOTS !== "0") await page.screenshot({ path: path.join(OUT, name), fullPage: true });
      const realErrors = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
      if (bad || realErrors.length) failures.push({ page: p, viewport: vpName, status, url: page.url(), errors: realErrors.slice(0, 3) });
      console.log(`${bad ? "FAIL" : "ok  "} ${vpName} ${status} ${p}${realErrors.length ? `  console: ${realErrors[0].slice(0, 160)}` : ""}`);
    }
    await ctx.close();
  }
  await browser.close();
  if (failures.length) {
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
})();

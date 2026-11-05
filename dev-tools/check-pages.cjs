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
  "/", "/work", "/work/listings", "/work/listings?add=1", "/work/deals", "/work/people", "/work/people?add=1", "/work/people?view=people", "/work/people?view=everyone&role=accountability_partner", "/work/people?view=orgs", "/work/people?view=orgs&add=1", "/work/todos", "/work/rosara", "/work/jobs", "/work/jobs?add=1", "/work/consulting", "/work/consulting?add=1", "/work/targets", "/work/targets?add=1", "/work/end-of-day", "/work/reports", "/work/reports?view=sent", "/work/reports?view=monthly", `/work/reports/monthly/${(() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })()}`,
  "/settings", "/settings/email", "/settings/ai", "/settings/buy-box", "/settings/export", "/settings/profile", "/settings/data",
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
    // The deal page of the Work module (Dalton Services from the sample data, otherwise any open deal).
    const deal = (await one("select id from pipeline_items where name = 'Dalton Services' limit 1").catch(() => null)) ?? (await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'acquisition' and i.screened and i.stage_id is not null order by i.created_at limit 1").catch(() => null));
    if (deal) out.push(`/work/deals/${deal}`);
    // Edit batch C round 3: a listing to screen opens the same page in the Listing state (when the sample listings are loaded).
    const listing = await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'acquisition' and i.screened = false and i.status = 'open' order by i.created_at limit 1").catch(() => null);
    if (listing) out.push(`/work/deals/${listing}#listing`);
    // The person page of the Work module (Mark Reed from the sample data, otherwise any contact).
    const person = (await one("select id from contacts where name = 'Mark Reed' limit 1").catch(() => null)) ?? (await one("select id from contacts order by created_at limit 1").catch(() => null));
    if (person) out.push(`/work/people/${person}`);
    // Push B: the organization page (Transworld from the sample data, otherwise any) and an accountability partner's page.
    const org = (await one("select id from organizations where name = 'Transworld Business Advisors' limit 1").catch(() => null)) ?? (await one("select id from organizations order by created_at limit 1").catch(() => null));
    if (org) out.push(`/work/people/organizations/${org}`);
    const partner = (await one("select id from contacts where outreach_role = 'accountability_partner' and archived_at is null order by created_at limit 1").catch(() => null));
    if (partner) out.push(`/work/people/${partner}#partner`);
    // Sent reports with one day's drawer open (a partner's timeline links there).
    const day = await one("select to_char(day, 'YYYY-MM-DD') as id from end_of_day where status = 'sent' order by day desc limit 1").catch(() => null);
    if (day) out.push(`/work/reports?view=sent&day=${day}`);
    // Batch B2: a project, an opportunity, and a consulting item (the sample's when loaded, otherwise any).
    const project = (await one("select id from projects where name = 'Market research' limit 1").catch(() => null)) ?? (await one("select id from projects order by created_at limit 1").catch(() => null));
    if (project) out.push(`/work/rosara/${project}`);
    const opp = (await one("select id from pipeline_items where name = 'Harbor Health Partners' limit 1").catch(() => null)) ?? (await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'job' order by i.created_at limit 1").catch(() => null));
    if (opp) out.push(`/work/jobs/${opp}`);
    const conItem = (await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'consulting' and i.name = 'Sullivan Wickley' order by i.created_at limit 1").catch(() => null)) ?? (await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'consulting' order by i.created_at limit 1").catch(() => null));
    if (conItem) out.push(`/work/consulting/${conItem}`);
    return out;
  } catch {
    return [];
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // The browser keeps the real clock even under dev-tools/late-evening.sh: libfaketime makes Chromium's own timers
  // unsteady (clicks and waits stall for seconds), and the app's "today" comes from the server, which runs on the fake clock.
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  if (process.env.FAKETIME) {
    // The pages still see the fake date: Date starts at this process's (fake) time and runs, the browser's own timers left real.
    const raw = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const c = await raw(options);
      await c.clock.setSystemTime(Date.now());
      return c;
    };
  }
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
    if (p.startsWith("/work/deals/") && p.endsWith("#listing")) return "work-listing-page";
    if (p.startsWith("/work/deals/")) return "work-deal";
    if (p.startsWith("/work/people/organizations/")) return "work-organization";
    if (p.startsWith("/work/people/") && p.endsWith("#partner")) return "work-partner";
    if (p.startsWith("/work/people/")) return "work-person";
    if (p.startsWith("/work/reports?view=sent&day=")) return "work-reports-sent-drawer";
    if (p.startsWith("/work/rosara/")) return "work-project";
    if (p.startsWith("/work/jobs/")) return "work-opportunity";
    if (p.startsWith("/work/consulting/")) return "work-consulting-item";
    if (p === "/work/jobs?add=1") return "work-jobs-add";
    if (p === "/work/consulting?add=1") return "work-consulting-add";
    if (p === "/work/listings?add=1") return "work-listings-add";
    if (p === "/work/people?add=1") return "work-people-add";
    if (p === "/work/people?view=people") return "work-people-people";
    if (p === "/work/people?view=everyone&role=accountability_partner") return "work-people-partners";
    if (p === "/work/people?view=orgs") return "work-people-orgs";
    if (p === "/work/people?view=orgs&add=1") return "work-people-orgs-add";
    if (p === "/work/targets?add=1") return "work-targets-add";
    if (p === "/work/reports?view=sent") return "work-reports-sent";
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
    const base = vpName === "desktop" || vpName === "desktop1280" ? PAGES : vpName === "phone" ? (process.env.PHONE_PAGES || "/work,/work/listings,/work/deals,/work/people,/work/people?view=people,/work/people?view=orgs,/work/todos,/work/rosara,/work/jobs,/work/consulting,/work/targets,/work/end-of-day,/work/reports,/settings").split(",") : [];
    const list = [...new Set([...base, ...KEY])];
    for (const p of list) {
      errors.length = 0;
      const res = await page.goto(BASE + p, { waitUntil: "networkidle" }).catch((e) => ({ status: () => 0, err: e }));
      const status = res.status();
      const body = await page.innerText("body").catch(() => "");
      const bad = status >= 400 || status === 0 || /Application error|Internal Server Error|This page could not be found|Unhandled Runtime Error/i.test(body || "") || page.url().includes("/login");
      const name = named(p) ? `${vpName}-${named(p)}.png` : `${vpName}${p === "/" ? "-home" : p.replace(/\//g, "-").replace(/[?=&]/g, "_")}.png`;
      if (process.env.SHOTS !== "0") await page.screenshot({ path: path.join(OUT, name), fullPage: true });
      // The fake-clock script Playwright adds to every frame is refused by the sandboxed email preview frame; not an app error.
      const realErrors = errors.filter((e) => !/favicon|Download the React DevTools|Blocked script execution in 'about:srcdoc'/i.test(e));
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

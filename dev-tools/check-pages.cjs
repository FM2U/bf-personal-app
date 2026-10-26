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
  "/", "/plan", "/plan/goals", "/plan/milestones", "/plan/conditions", "/plan/inputs", "/plan/scenarios", "/plan/decisions",
  "/finance", "/finance/expenses", "/finance/import", "/finance/budget", "/finance/debt", "/finance/funding", "/finance/income", "/finance/savings",
  "/opportunities", "/people", "/people/organizations", "/people/communications", "/people/outreach",
  "/productivity", "/productivity/tasks", "/productivity/recurring", "/productivity/calendar", "/productivity/pipeline-actions",
  "/accountability", "/accountability/targets", "/accountability/reviews", "/accountability/scores", "/accountability/partners", "/accountability/reports",
  "/settings", "/settings/ai", "/settings/imports", "/settings/partner-access", "/settings/initiatives", "/settings/categories", "/settings/export", "/settings/profile", "/settings/change-log",
  "/proposals", "/records/tasks/new", "/records/decision_conditions/new", "/records/pipeline_items/new", "/records/contacts/new",
].join(",")).split(",");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  for (const [vpName, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: "sb-localhost-auth-token", value: cookieValue, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const list = vpName === "desktop" ? PAGES : (process.env.PHONE_PAGES || "/,/finance/expenses,/opportunities,/plan/inputs,/accountability/targets,/people/outreach,/productivity").split(",");
    for (const p of list) {
      errors.length = 0;
      const res = await page.goto(BASE + p, { waitUntil: "networkidle" }).catch((e) => ({ status: () => 0, err: e }));
      const status = res.status();
      const body = await page.innerText("body").catch(() => "");
      const bad = status >= 400 || status === 0 || /Application error|Internal Server Error|This page could not be found|Unhandled Runtime Error/i.test(body || "") || page.url().includes("/login");
      const name = `${vpName}${p === "/" ? "-home" : p.replace(/\//g, "-").replace(/[?=&]/g, "_")}.png`;
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

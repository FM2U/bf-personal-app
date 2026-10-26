// LOCAL TESTING ONLY. Clicks through the main workflows against the local mock and reports each step.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs
const { chromium } = require("playwright");
const path = require("node:path");

const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const OWNER = "00000000-0000-0000-0000-000000000001";
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
const session = {
  access_token: `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub: OWNER, email: "owner@example.com", role: "authenticated", aal: "aal2", exp })}.${Buffer.from("sig").toString("base64url")}`,
  refresh_token: "r",
  expires_in: 86400 * 30,
  expires_at: exp,
  token_type: "bearer",
  user: { id: OWNER, email: "owner@example.com", aud: "authenticated", role: "authenticated" },
};
const cookie = { name: "sb-localhost-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, domain: "localhost", path: "/" };

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["ok  ", name]);
  } catch (e) {
    results.push(["FAIL", `${name}: ${e.message.split("\n")[0]}`]);
  }
}
const expectText = async (page, text) => {
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 15000 });
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  await step("Resolve a missed commitment with a reason and new date", async () => {
    await page.goto(`${BASE}/accountability`);
    const before = await page.locator('input[name="reason"]').count();
    if (!before) throw new Error("no missed commitments to resolve");
    await page.locator('input[name="reason"]').first().fill("Spent the afternoon on the broker call.");
    await page.locator('form:has(input[name="reason"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const after = await page.locator('input[name="reason"]').count();
    if (after !== before - 1) throw new Error(`expected ${before - 1} left, found ${after}`);
  });

  await step("Open the decision created by the missed milestone and choose an option", async () => {
    await page.goto(`${BASE}/plan/decisions`);
    await page.locator("table a").first().click();
    await expectText(page, "Options");
    await page.screenshot({ path: path.join(OUT, "flow-decision.png"), fullPage: true });
    await page.getByRole("button", { name: "Choose this option" }).first().click();
    await expectText(page, "Chosen");
  });

  await step("Complete the daily close (reasons required for tasks not done)", async () => {
    await page.goto(`${BASE}/accountability/reviews`);
    await page.getByRole("button", { name: "Open today's daily close" }).click();
    await page.waitForURL(/\/accountability\/reviews\/.+/);
    await page.screenshot({ path: path.join(OUT, "flow-daily-close.png"), fullPage: true });
    for (const input of await page.locator('input[name^="a_reason_"], input[name^="a_target_reason_"]').all()) if (await input.isEnabled()) await input.fill("Ran out of time.");
    await page.getByRole("button", { name: "Complete review" }).click();
    await expectText(page, "Completed");
  });

  await step("Weekly review draft renders", async () => {
    await page.goto(`${BASE}/accountability/reviews`);
    await page.getByRole("button", { name: "Open the latest weekly review" }).click();
    await page.waitForURL(/\/accountability\/reviews\/.+/);
    await expectText(page, "Next week's priorities");
    await page.screenshot({ path: path.join(OUT, "flow-weekly-review.png"), fullPage: true });
  });

  let publicLink = null;
  await step("Create a partner link and a report, then finalize it", async () => {
    await page.goto(`${BASE}/accountability/partners`);
    await page.locator("table a").first().click();
    await expectText(page, "Private report links");
    await page.getByRole("button", { name: "Create link" }).click();
    await page.waitForLoadState("networkidle");
    publicLink = (await page.locator("p.font-mono").first().innerText()).trim();
    await page.getByRole("button", { name: "Create a report now" }).click();
    await page.waitForURL(/\/accountability\/reports\/.+/);
    await page.screenshot({ path: path.join(OUT, "flow-partner-report-draft.png"), fullPage: true });
    await page.getByRole("button", { name: /^Finalize/ }).click();
    await expectText(page, "This saved copy does not change");
  });

  await step("Public partner page shows the report and accepts Reviewed", async () => {
    if (!publicLink) throw new Error("no link");
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await anon.newPage();
    await p.goto(publicLink.replace(/^https?:\/\/[^/]+/, BASE));
    await p.getByRole("button", { name: "Reviewed" }).click();
    await p.waitForURL(/done=reviewed/);
    await p.waitForFunction(() => document.body.innerText.includes("Marked as reviewed"));
    await p.screenshot({ path: path.join(OUT, "phone-public-report.png"), fullPage: true });
    const bad = await (await anon.newPage()).goto(`${BASE}/report/not-a-real-token-1234567890`);
    if (bad.status() !== 200) throw new Error("bad token page failed");
    await anon.close();
  });

  await step("Scenario: change monthly spending and recalculate", async () => {
    await page.goto(`${BASE}/plan/scenarios`);
    await page.locator("ul a").first().click();
    await page.waitForURL(/\/plan\/scenarios\/.+/);
    await page.fill('input[name="ov:monthly_spending"]', "4000");
    await page.getByRole("button", { name: "Save and recalculate" }).click();
    await page.waitForLoadState("networkidle");
    await expectText(page, "Results side by side");
    await page.screenshot({ path: path.join(OUT, "flow-scenario.png"), fullPage: true });
  });

  await step("Job vs acquisition scenario and compare page", async () => {
    await page.goto(`${BASE}/plan/scenarios`);
    for (const cb of await page.locator('input[name="ids"]').all()) await cb.check();
    await page.getByRole("button", { name: "Compare selected" }).click();
    await expectText(page, "Compare scenarios");
    await page.screenshot({ path: path.join(OUT, "flow-scenario-compare.png"), fullPage: true });
  });

  await step("Pipeline board and item: move to the next stage", async () => {
    await page.goto(`${BASE}/opportunities`);
    await page.getByRole("link", { name: "Open pipeline" }).first().click();
    await page.screenshot({ path: path.join(OUT, "flow-pipeline-board.png"), fullPage: true });
    await page.locator("a[href^='/records/pipeline_items/']:not([href*='/new'])").first().click();
    await expectText(page, "Deal financials");
    const select = page.locator('select[name="stage_id"]');
    const options = await select.locator("option").all();
    const current = await select.inputValue();
    const idx = (await Promise.all(options.map((o) => o.getAttribute("value")))).indexOf(current);
    await select.selectOption({ index: Math.min(idx + 1, options.length - 1) });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const rows = await page.locator("table >> text=Current").count();
    if (!rows) throw new Error("stage history not shown");
    await page.screenshot({ path: path.join(OUT, "flow-pipeline-item.png"), fullPage: true });
  });

  await step("Required details block a stage move and list what is missing", async () => {
    await page.goto(`${BASE}/opportunities`);
    await page.getByRole("link", { name: "Open pipeline" }).first().click();
    await page.getByRole("link", { name: "Demo Sign Shop" }).first().click();
    await expectText(page, "Accountability");
    await page.locator('select[name="stage_id"]').selectOption({ label: "5. IOI sent" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await expectText(page, "Not moved to IOI sent");
    await expectText(page, "Asking price");
    await page.screenshot({ path: path.join(OUT, "flow-stage-blocked.png"), fullPage: true });
  });

  await step("Log a CIM request on an acquisition item (Deals advanced)", async () => {
    await page.getByRole("button", { name: "Log it" }).click();
    await expectText(page, "CIM request logged.");
  });

  await step("Stage time limit decision: Extend adds days for the item", async () => {
    await page.goto(`${BASE}/plan/decisions`);
    await page.getByRole("link", { name: /Demo Pest Control: \d+ days in Screened/ }).first().click();
    await expectText(page, "Advance to next stage");
    await page.screenshot({ path: path.join(OUT, "flow-stage-limit-decision.png"), fullPage: true });
    await page.locator("form:has(button:text('Choose this option'))").filter({ hasText: "" }).nth(2).getByRole("button", { name: "Choose this option" }).click();
    await expectText(page, "Chosen");
  });

  await step("Outreach Queue: deal source first, deal sourcing draft", async () => {
    await page.goto(`${BASE}/people/outreach`);
    const first = await page.locator("a[href^='/records/contacts/']").first().innerText();
    if (!first.includes("Quinn Demo")) throw new Error(`first contact is ${first}`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    await expectText(page, "off-market");
  });

  await step("Add a task through the form", async () => {
    await page.goto(`${BASE}/records/tasks/new`);
    await page.fill('input[name="title"]', "Flow test task");
    await page.getByRole("button", { name: "Add task" }).click();
    await page.waitForURL(/\/records\/tasks\/[0-9a-f-]{36}$/);
    await expectText(page, "NEXT REQUIRED ACTION");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectText(page, "Mark as not done");
  });

  await step("Form validation shows an error for a missing required field", async () => {
    await page.goto(`${BASE}/records/debts/new`);
    await page.fill('input[name="name"]', "Validation test");
    await page.evaluate(() => document.querySelectorAll("[required]").forEach((e) => e.removeAttribute("required")));
    await page.getByRole("button", { name: "Add debt" }).click();
    await expectText(page, "is required");
  });

  await step("Transaction page shows reduction actions and category edit", async () => {
    await page.goto(`${BASE}/finance/expenses?month=${new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7)}`);
    await page.locator("a[href^='/records/transactions/']:not([href*='/new'])").first().click();
    await expectText(page, "Reduction actions");
    await page.screenshot({ path: path.join(OUT, "flow-transaction.png"), fullPage: true });
  });

  await step("Recurring charge page shows subscription review", async () => {
    await page.goto(`${BASE}/finance/expenses`);
    await page.locator("a[href^='/records/recurring_series/']").first().click();
    await page.getByRole("button", { name: "Still in use" }).click();
    await page.waitForLoadState("networkidle");
  });

  await step("Budget page with data", async () => {
    await page.goto(`${BASE}/finance/budget?month=${new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 7)}`);
    await expectText(page, "Actual vs. budget");
    await page.screenshot({ path: path.join(OUT, "flow-budget.png"), fullPage: true });
  });

  await step("Update an input and see its history", async () => {
    await page.goto(`${BASE}/plan/inputs`);
    const form = page.locator("form:has(input[aria-label='Runway target'])");
    await form.locator("input[name='value']").fill("10");
    await form.getByRole("button", { name: "Save" }).click();
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Runway target" }).click();
    await expectText(page, "History of past values");
    await expectText(page, "Owner");
  });

  await step("Home after jobs (plan written, alerts)", async () => {
    await page.goto(`${BASE}/`);
    await page.screenshot({ path: path.join(OUT, "flow-home-after-jobs.png"), fullPage: true });
  });

  await step("Full export downloads a zip", async () => {
    const res = await page.request.get(`${BASE}/api/export/full`);
    if (res.status() !== 200 || !(res.headers()["content-type"] || "").includes("zip")) throw new Error(`status ${res.status()}`);
    const csv = await page.request.get(`${BASE}/api/export/transactions`);
    if (!(await csv.text()).startsWith("id,")) throw new Error("csv export");
  });

  await step("Settings: run the morning job from the page", async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByRole("button", { name: "Run the morning job now" }).click();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: path.join(OUT, "flow-settings.png"), fullPage: true });
  });

  await step("Chat panel opens and explains the AI is not set up", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Open AI chat" }).click();
    await expectText(page, "The AI is not set up yet");
    await page.fill("textarea[aria-label='Message']", "What is my runway?");
    await page.getByRole("button", { name: "Send" }).click();
    await expectText(page, "ANTHROPIC_API_KEY");
  });

  await step("Change log shows changes", async () => {
    await page.goto(`${BASE}/settings/change-log`);
    await expectText(page, "Number value");
  });

  await browser.close();
  for (const r of results) console.log(r.join(" "));
  if (results.some((r) => r[0] === "FAIL")) process.exit(1);
})();

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
  // FLOWS=<regular expression> runs only the matching steps (for example FLOWS="Send|Google").
  if (process.env.FLOWS && !new RegExp(process.env.FLOWS).test(name)) return;
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

  await step("Home: grouped alerts open the filtered pipeline list", async () => {
    await page.goto(`${BASE}/`);
    await expectText(page, "pipeline item");
    if (await page.locator("#alerts a", { hasText: /^Stalled:|^Set the next action/ }).count()) throw new Error("per-item pipeline alerts still shown");
    await page.locator("#alerts a", { hasText: /need(s)? a next action/ }).first().click();
    await page.waitForURL(/filter=needs-next-action/);
    await expectText(page, "Pipeline items that need a next action");
    await expectText(page, "Demo Car Wash Co");
    await page.screenshot({ path: path.join(OUT, "flow-opportunities-filter.png"), fullPage: true });
  });

  await step("Daily close: one shared reason covers several misses (an unchecked item without a reason blocks completion)", async () => {
    await page.goto(`${BASE}/accountability/reviews`);
    await page.getByRole("button", { name: "Open today's daily close" }).click();
    await page.waitForURL(/\/accountability\/reviews\/.+/);
    await expectText(page, "One reason for every checked item");
    const boxes = page.locator('input[name^="a_use_shared_"]');
    const n = await boxes.count();
    if (n < 3) throw new Error(`expected several missed items, found ${n}`);
    if (await page.locator('input[name^="a_reason_t_"], input[name^="a_reason_c_"]').first().isVisible()) throw new Error("own-reason fields should start folded");
    await page.fill('input[name="a_shared_reason"]', "The broker call ran all afternoon.");
    await page.screenshot({ path: path.join(OUT, "flow-daily-close.png"), fullPage: true });
    // Uncheck one item with no reason of its own: completion is refused and what was typed is kept.
    const key = (await boxes.first().getAttribute("name")).replace("a_use_shared_", "");
    await boxes.first().uncheck();
    await page.getByRole("button", { name: "Complete review" }).click();
    await page.waitForURL(/missing=/);
    await expectText(page, "Not completed. Give a reason for");
    if ((await page.inputValue('input[name="a_shared_reason"]')) !== "The broker call ran all afternoon.") throw new Error("shared reason not kept");
    if (await page.locator(`input[name="a_use_shared_${key}"]`).isChecked()) throw new Error("unchecked item came back checked");
    await page.screenshot({ path: path.join(OUT, "flow-daily-close-refused.png"), fullPage: true });
    // Give that item its own reason (its field is open) and complete.
    await page.locator(`input[name="a_reason_${key}"]`).fill("Waited for the owner to reply.");
    await page.getByRole("button", { name: "Complete review" }).click();
    await expectText(page, "Completed");
    await page.screenshot({ path: path.join(OUT, "flow-daily-close-completed.png"), fullPage: true });
  });

  await step("Commitments page shows the shared reason on today's misses", async () => {
    await page.goto(`${BASE}/accountability`);
    const values = await page.locator('input[name="reason"]').evaluateAll((els) => els.map((e) => e.value));
    if (!values.some((v) => v.includes("broker call ran all afternoon"))) throw new Error(`reasons: ${values.join(" | ")}`);
  });

  await step("Weekly review draft renders and lists tasks moved 5 or more times (reschedule one)", async () => {
    await page.goto(`${BASE}/accountability/reviews`);
    await page.getByRole("button", { name: "Open the latest weekly review" }).click();
    await page.waitForURL(/\/accountability\/reviews\/.+/);
    await expectText(page, "Next week's priorities");
    await expectText(page, "Tasks moved 5 or more times");
    await expectText(page, "Update the LinkedIn headline");
    await page.screenshot({ path: path.join(OUT, "flow-weekly-review.png"), fullPage: true });
    const row = page.locator('li:has(input[name="task_id"])', { hasText: "Update the LinkedIn headline" });
    await row.locator('input[name="due_date"]').fill(new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
    await row.getByRole("button", { name: "Reschedule" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    if (await page.locator('li:has(input[name="task_id"])', { hasText: "Update the LinkedIn headline" }).count()) throw new Error("rescheduled task still listed");
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

  await step("Add a task marked as a commitment", async () => {
    await page.goto(`${BASE}/records/tasks/new?due_date=${new Date().toISOString().slice(0, 10)}`);
    await page.fill('input[name="title"]', "Flow test commitment");
    await page.locator('input[name="__is_commitment"]').check();
    await page.getByRole("button", { name: "Add task" }).click();
    await page.waitForURL(/\/records\/tasks\/[0-9a-f-]{36}$/);
    await expectText(page, "Marked as a commitment");
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

  await step("Pipelines open in list view; the board is one click away and remembered", async () => {
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await fresh.addCookies([cookie]);
    const p = await fresh.newPage();
    await p.goto(`${BASE}/opportunities`);
    await p.getByRole("link", { name: "Open pipeline" }).first().click();
    await p.waitForURL(/\/opportunities\/[0-9a-f-]{36}/);
    await p.waitForFunction(() => document.body.innerText.toLowerCase().includes("days in stage"));
    const id = p.url().match(/opportunities\/([0-9a-f-]{36})/)[1];
    await p.getByRole("link", { name: "Board", exact: true }).click();
    await p.waitForURL(/view=board/);
    await p.waitForSelector("[role=region][aria-label$='board']");
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 0) throw new Error(`page scrolls sideways by ${sw}px at 1280`);
    await p.goto(`${BASE}/opportunities/${id}`);
    await p.waitForSelector("[role=region][aria-label$='board']");
    await p.getByRole("link", { name: "List", exact: true }).click();
    await p.waitForURL(/view=list/);
    await p.goto(`${BASE}/opportunities/${id}`);
    await p.waitForFunction(() => document.body.innerText.toLowerCase().includes("days in stage"));
    await fresh.close();
  });

  let itemEdit = null;
  const homeLink = () => page.locator("aside a[href='/']").filter({ hasText: "Home" });
  await step("Unsaved changes: Stay keeps the typed value; a value changed back does not ask", async () => {
    await page.goto(`${BASE}/opportunities`);
    await page.getByRole("link", { name: "Open pipeline" }).first().click();
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("days in stage"));
    const href = await page.locator("a[href^='/records/pipeline_items/']:not([href*='/new'])").first().getAttribute("href");
    itemEdit = `${BASE}${href}?edit=1`;
    await page.goto(itemEdit);
    const original = await page.inputValue('textarea[name="notes"]');
    await page.fill('textarea[name="notes"]', "Flow test source");
    await homeLink().click();
    await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-unsaved-dialog.png") });
    await page.getByTestId("unsaved-stay").click();
    await page.waitForTimeout(300);
    if (!page.url().includes("edit=1")) throw new Error("left the page after Stay");
    if ((await page.inputValue('textarea[name="notes"]')) !== "Flow test source") throw new Error("typed value lost after Stay");
    // Browser Back asks too.
    await page.goBack();
    await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
    await page.getByTestId("unsaved-stay").click();
    if (!page.url().includes("edit=1")) throw new Error("left the page after Back and Stay");
    // Changed back to the original: no question.
    await page.fill('textarea[name="notes"]', original);
    await homeLink().click();
    await page.waitForURL(`${BASE}/`);
  });

  await step("Unsaved changes: Leave without saving goes and keeps the old value", async () => {
    await page.goto(itemEdit);
    const original = await page.inputValue('textarea[name="notes"]');
    await page.fill('textarea[name="notes"]', "Not saved value");
    await homeLink().click();
    await page.getByTestId("unsaved-leave").click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(itemEdit);
    if ((await page.inputValue('textarea[name="notes"]')) !== original) throw new Error("value was saved");
  });

  await step("Unsaved changes: Save and leave saves, then opens the link", async () => {
    await page.goto(itemEdit);
    await page.fill('textarea[name="notes"]', "Saved by Save and leave");
    await homeLink().click();
    await page.getByTestId("unsaved-save").click();
    await page.waitForURL(`${BASE}/`);
    await page.goto(itemEdit);
    if ((await page.inputValue('textarea[name="notes"]')) !== "Saved by Save and leave") throw new Error("value not saved");
  });

  await step("Unsaved changes: Save and leave stays and shows the error when the save fails", async () => {
    await page.goto(itemEdit);
    await page.fill('textarea[name="notes"]', "Will not save");
    await page.evaluate(() => {
      document.querySelectorAll("[required]").forEach((e) => e.removeAttribute("required"));
      document.querySelector('input[name="next_action"]').value = "";
    });
    await page.locator('input[name="next_action"]').fill("");
    await homeLink().click();
    await page.getByTestId("unsaved-save").click();
    await expectText(page, "Next action is required.");
    if (!page.url().includes("edit=1")) throw new Error("left the page after a failed save");
    if ((await page.inputValue('textarea[name="notes"]')) !== "Will not save") throw new Error("typed value lost after failed save");
    await page.goto(itemEdit);
  });

  await step("+ New contact from the pipeline item form keeps typed values and selects the new contact", async () => {
    await page.goto(itemEdit);
    await page.fill('input[name="next_action"]', "Call the owner about the CIM");
    await page.getByRole("button", { name: "New contact for Main contact" }).click();
    const dlg = page.getByRole("dialog", { name: "New contact" });
    await dlg.waitFor();
    await dlg.locator('input[name="name"]').fill("Flow New Contact");
    await dlg.locator('input[name="email"]').fill("flow.contact@example.com");
    await page.screenshot({ path: path.join(OUT, "flow-new-contact-dialog.png") });
    await dlg.getByRole("button", { name: "Add contact" }).click();
    await dlg.waitFor({ state: "detached" });
    if ((await page.inputValue("#f_primary_contact_id")) !== "Flow New Contact") throw new Error("new contact not selected");
    if ((await page.inputValue('input[name="next_action"]')) !== "Call the owner about the CIM") throw new Error("typed value lost");
    // The other contact field can choose it too (type to filter).
    await page.locator("#f_source_contact_id").fill("flow new");
    if (!(await page.locator("[role=option]", { hasText: "Flow New Contact" }).count())) throw new Error("new contact not in the other list");
    await page.keyboard.press("Escape");
    // The form still asks before leaving, then saves with the new contact.
    await homeLink().click();
    await page.getByRole("dialog", { name: "Save your changes?" }).waitFor();
    await page.getByTestId("unsaved-stay").click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await expectText(page, "Flow New Contact");
    await expectText(page, "Call the owner about the CIM");
  });

  await step("Consulting: add an item, a move is blocked until rate type and rate are set, then it moves", async () => {
    await page.goto(`${BASE}/opportunities`);
    await page.getByRole("link", { name: "Consulting", exact: true }).first().click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}/);
    await expectText(page, "Pipeline value per month");
    await page.getByRole("link", { name: "Add item" }).click();
    await page.fill('input[name="name"]', "Flow Consulting Client: strategy project");
    await page.getByRole("button", { name: "Add pipeline item" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await expectText(page, "Engagement terms");
    await expectText(page, "Research the client and their need");
    await page.locator('select[name="stage_id"]').selectOption({ label: "4. Proposal sent" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await expectText(page, "Not moved to Proposal sent");
    await expectText(page, "Rate type");
    const terms = page.locator("#item-details");
    await terms.locator('select[name="rate_type"]').selectOption("project");
    await terms.locator('input[name="rate"]').fill("9000");
    await terms.locator('input[name="project_months"]').fill("3");
    await terms.getByRole("button", { name: "Save terms" }).click();
    await page.waitForLoadState("networkidle");
    await expectText(page, "$3,000");
    await page.locator('select[name="stage_id"]').selectOption({ label: "4. Proposal sent" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await page.waitForLoadState("networkidle");
    await expectText(page, "Follow up on the proposal");
    await page.screenshot({ path: path.join(OUT, "flow-consulting-item.png"), fullPage: true });
  });

  await step("Introduced by: credit shows on the contact page", async () => {
    await page.goto(`${BASE}/opportunities`);
    await page.getByRole("link", { name: "Open pipeline" }).first().click();
    await page.getByRole("link", { name: "Demo Sign Shop" }).first().click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}/);
    await page.goto(`${page.url().split("?")[0]}?edit=1`);
    await page.locator("#f_introduced_by_contact_id").fill("riley");
    await page.locator("[role=option]", { hasText: "Riley Test" }).first().click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "Riley Test" }).first().click();
    await page.waitForURL(/\/records\/contacts\//);
    await expectText(page, "Introduced 1 deal");
    await expectText(page, "Demo Sign Shop");
  });

  await step("Acquisition form suggests the deal type from the Deal came from contact", async () => {
    await page.goto(`${BASE}/records/pipeline_items/new?pipeline_id=${await (async () => {
      await page.goto(`${BASE}/opportunities`);
      await page.getByRole("link", { name: "Open pipeline" }).first().click();
      await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}/);
      return page.url().match(/opportunities\/([0-9a-f-]{36})/)[1];
    })()}`);
    await page.locator("#f_source_contact_id").fill("alex");
    await page.locator("[role=option]", { hasText: "Alex Example" }).first().click();
    await expectText(page, "Suggested: Brokered");
    await page.getByRole("button", { name: "Use Brokered" }).click();
    if ((await page.inputValue('select[name="deal_source_type"]')) !== "brokered") throw new Error("suggestion not applied");
    await page.locator("#f_source_contact_id").fill("pat");
    await page.locator("[role=option]", { hasText: "Pat Example" }).first().click();
    await expectText(page, "Suggested: Proprietary");
    if ((await page.inputValue('select[name="deal_source_type"]')) !== "brokered") throw new Error("the chosen value was changed");
    await page.goto(`${BASE}/`);
    const leave = page.getByTestId("unsaved-leave");
    if (await leave.count()) await leave.click();
  });

  await step("Runway: counting signed consulting income changes runway and its explanation", async () => {
    await page.goto(`${BASE}/`);
    await expectText(page, "Signed consulting income is not counted");
    const before = await page.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.trim() === "Runway")?.nextElementSibling?.textContent ?? "");
    await page.goto(`${BASE}/plan/inputs`);
    const form = page.locator("form:has(input[aria-label^='Count signed consulting income in runway'])");
    await form.locator("input[name='value']").fill("1");
    await form.getByRole("button", { name: "Save" }).click();
    await page.waitForLoadState("networkidle");
    await page.goto(`${BASE}/`);
    await expectText(page, "Signed consulting income is counted");
    // Only the signed engagement without a payment yet (Demo Dental Group, $2,500) is added; the paid retainer is not.
    await expectText(page, "$2,500 per month expected from Signed and Active consulting work with no payment received yet");
    const after = await page.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.trim() === "Runway")?.nextElementSibling?.textContent ?? "");
    if (before === after) throw new Error(`runway did not change (${before})`);
    await page.screenshot({ path: path.join(OUT, "flow-runway-consulting.png"), fullPage: true });
  });

  await step("Board shows closed stages by default; Hide closed stages is remembered", async () => {
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await fresh.addCookies([cookie]);
    const p = await fresh.newPage();
    await p.goto(`${BASE}/opportunities`);
    await p.getByRole("link", { name: "Open pipeline" }).first().click();
    await p.waitForURL(/\/opportunities\/[0-9a-f-]{36}/);
    const id = p.url().match(/opportunities\/([0-9a-f-]{36})/)[1];
    await p.goto(`${BASE}/opportunities/${id}?view=board`);
    const board = p.locator("[role=region][aria-label$='board']");
    await board.waitFor();
    if (!(await board.locator("section[aria-label='Passed']").count())) throw new Error("closed stage Passed not shown by default");
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (sw > 0) throw new Error(`page scrolls sideways by ${sw}px at 1280`);
    const inner = await board.evaluate((e) => e.scrollWidth - e.clientWidth);
    if (inner > 0) throw new Error(`board scrolls inside its box by ${inner}px at 1280 (all stages should fit)`);
    await p.screenshot({ path: path.join(OUT, "flow-board-closed-1280.png"), fullPage: true });
    await p.getByRole("link", { name: "Hide closed stages" }).click();
    await p.waitForURL(/closed=0/);
    await p.goto(`${BASE}/opportunities/${id}?view=board`);
    await board.waitFor();
    if (await board.locator("section[aria-label='Passed']").count()) throw new Error("hide choice not remembered");
    await p.getByRole("link", { name: /Show closed stages/ }).click();
    await p.waitForURL(/closed=1/);
    await fresh.close();
  });

  await step("Pipeline and Stage fields have search but no + New", async () => {
    await page.goto(itemEdit);
    if (await page.getByRole("button", { name: /^New pipeline for/ }).count()) throw new Error("+ New on Pipeline");
    if (await page.getByRole("button", { name: /^New stage for/ }).count()) throw new Error("+ New on Stage");
    if (!(await page.getByRole("button", { name: "New contact for Deal came from" }).count())) throw new Error("+ New missing on Deal came from");
  });

  await step("+ New contact dialog has email, phone, organization (with + New), title, roles, group; email is saved", async () => {
    await page.goto(itemEdit);
    await page.getByRole("button", { name: "New contact for Deal came from" }).click();
    const dlg = page.getByRole("dialog", { name: "New contact" });
    await dlg.waitFor();
    for (const n of ["name", "email", "phone", "title", "relationship_group", "roles"]) if (!(await dlg.locator(`[name="${n}"]`).count())) throw new Error(`dialog has no ${n}`);
    if (!(await dlg.getByRole("button", { name: "New organization for Organization" }).count())) throw new Error("no + New organization inside the contact dialog");
    await dlg.locator('input[name="name"]').fill("Flow Dialog Person");
    await dlg.locator('input[name="email"]').fill("flow.dialog@example.com");
    await dlg.locator('input[name="phone"]').fill("555-0142");
    await dlg.locator('input[name="title"]').fill("Owner");
    await dlg.locator('select[name="relationship_group"]').selectOption("friend");
    await dlg.locator('input[name="roles"][value="friend"]').check();
    await page.screenshot({ path: path.join(OUT, "flow-new-contact-dialog.png") });
    await dlg.getByRole("button", { name: "Add contact" }).click();
    await dlg.waitFor({ state: "detached" });
    if ((await page.inputValue("#f_source_contact_id")) !== "Flow Dialog Person") throw new Error("new contact not chosen");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "Flow Dialog Person" }).first().click();
    await page.waitForURL(/\/records\/contacts\//);
    await expectText(page, "flow.dialog@example.com");
    await expectText(page, "555-0142");
    await expectText(page, "Friend");
  });

  await step("Deal came from: Not a person saves the typed source and suggests no deal type", async () => {
    await page.goto(itemEdit);
    await page.locator("#f_source_contact_id").click();
    await page.locator("[role=option]", { hasText: "Not a person: type the source" }).click();
    const box = page.getByRole("textbox", { name: /the source \(not a person\)/ });
    await box.waitFor();
    if ((await box.getAttribute("placeholder")) !== "Examples: BizBuySell listing, Cold email campaign") throw new Error("placeholder examples missing");
    await box.fill("Flow BizBuySell listing");
    await expectText(page, "A typed source gives no suggestion");
    if (await page.locator('input[name="source"][type="text"], input[name="source"]:not([type])').count() !== 1) throw new Error("expected one source text box");
    await page.screenshot({ path: path.join(OUT, "flow-source-not-a-person.png"), fullPage: true });
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await expectText(page, "Flow BizBuySell listing (not a person)");
    await page.goto(itemEdit);
    if ((await page.inputValue("#f_source_contact_id")) !== "Not a person (type it below)") throw new Error("does not open as Not a person");
    if ((await page.getByRole("textbox", { name: /the source \(not a person\)/ }).inputValue()) !== "Flow BizBuySell listing") throw new Error("typed source not kept");
    if (await page.locator("label", { hasText: "Where it came from" }).count()) throw new Error("separate Where it came from field still shown");
  });

  await step("Organization form adds two new people; the page lists them and can unlink one", async () => {
    await page.goto(`${BASE}/records/organizations/new`);
    await page.fill('input[name="name"]', "Flow People Org");
    await page.getByRole("textbox", { name: "New person 1: name" }).fill("Flow Person One");
    await page.getByRole("textbox", { name: "New person 1: email" }).fill("one@example.com");
    await page.getByRole("button", { name: "Add another person" }).click();
    await page.getByRole("textbox", { name: "New person 2: name" }).fill("Flow Person Two");
    await page.getByRole("textbox", { name: "New person 2: title" }).fill("CFO");
    await page.getByRole("combobox", { name: "Search contacts to link" }).fill("riley");
    await page.locator("[role=option]", { hasText: "Riley Test" }).first().click();
    await page.getByRole("button", { name: "Add organization" }).click();
    await page.waitForURL(/\/records\/organizations\/[0-9a-f-]{36}$/);
    const people = page.locator("#people");
    for (const n of ["Flow Person One", "Flow Person Two", "Riley Test"]) await people.getByRole("link", { name: n }).waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-org-people.png"), fullPage: true });
    await page.getByRole("button", { name: "Unlink Riley Test" }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => !document.querySelector("#people")?.textContent.includes("Riley Test"));
    // The contact is kept.
    await page.goto(`${BASE}/people`);
    await expectText(page, "Riley Test");
  });

  await step("CSV import: leaving with a file chosen asks (Stay or Leave and discard)", async () => {
    const fs = require("node:fs");
    const csv = path.join(require("node:os").tmpdir(), "flow-import.csv");
    fs.writeFileSync(csv, "Posted Date,Description,Amount\n10/01/2026,FLOW TEST STORE,-12.50\n10/02/2026,FLOW TEST PAY,100.00\n");
    await page.goto(`${BASE}/finance/import`);
    await page.setInputFiles("#csv_file", csv);
    await expectText(page, "2 rows found");
    await page.getByTestId("csv-fill-note").waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-csv-wizard.png"), fullPage: true });
    await homeLink().click();
    const dlg = page.getByRole("dialog", { name: "Leave this page?" });
    await dlg.waitFor();
    if (await page.getByTestId("unsaved-save").count()) throw new Error("Save and leave offered on the import");
    if ((await page.getByTestId("unsaved-leave").innerText()).trim() !== "Leave and discard") throw new Error("leave button text");
    await page.getByTestId("unsaved-stay").click();
    if (!page.url().includes("/finance/import")) throw new Error("left after Stay");
    // A required column not chosen: a clear error names it.
    await page.locator("#csv_date_column").selectOption("");
    await page.getByRole("button", { name: "Review the rows" }).click();
    await expectText(page, "Choose a column for: Date.");
    await homeLink().click();
    await page.getByTestId("unsaved-leave").click();
    await page.waitForURL(`${BASE}/`);
    // A restarted import fills the column choices made last time for this account.
    await page.goto(`${BASE}/finance/import`);
    await page.setInputFiles("#csv_file", csv);
    await expectText(page, "Columns filled from your last choices for this account");
    if ((await page.inputValue("#csv_date_column")) !== "") throw new Error("restarted import did not keep the last choices");
    await page.locator("#csv_date_column").selectOption("Posted Date");
    await page.getByRole("button", { name: "Review the rows" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions/ }).click();
    await expectText(page, "Imported");
    // Nothing left to lose: leaving does not ask.
    await homeLink().click();
    await page.waitForURL(`${BASE}/`);
  });


  // ---------- Send email from the app (Google stand-in on :54329, see dev-tools/mock-supabase.mjs) ----------
  const GMOCK = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
  const gpost = async (pathName, body = {}) => (await fetch(`${GMOCK}${pathName}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const gsent = async () => (await fetch(`${GMOCK}/__sent`)).json();
  const pg = new (require("pg").Client)({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  const outreachCount = async () => {
    const text = await page.locator("body").innerText();
    const m = text.match(/Network outreach today\s*(\d+) of (\d+)/);
    if (!m) throw new Error("Network outreach today not shown");
    return Number(m[1]);
  };
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phone.addCookies([cookie]);
  const ph = await phone.newPage();

  await step("Google connected before sending was asked for: Settings shows Reconnect", async () => {
    await gpost("/__reset");
    await gpost("/__mode", { grantSend: false });
    await page.goto(`${BASE}/api/google/connect`);
    await page.waitForURL(/\/settings\?google=connected_no_send/);
    await expectText(page, "Reconnect Google to allow sending from the app (1 minute)");
    if ((await one("select count(*)::int n from google_connections")).n !== 1) throw new Error("expected one connection row");
    if ((await one("select scopes from google_connections")).scopes.includes("gmail.send")) throw new Error("scopes should not include gmail.send");
    await page.goto(`${BASE}/settings`);
    await page.screenshot({ path: path.join(OUT, "flow-settings-reconnect-send.png"), fullPage: true });
    await ph.goto(`${BASE}/settings`);
    await ph.screenshot({ path: path.join(OUT, "phone-settings-reconnect-send.png"), fullPage: true });
  });

  await step("Send now without the send permission shows Reconnect and sends nothing", async () => {
    await page.goto(`${BASE}/people/outreach`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-reconnect").waitFor();
    await expectText(page, "Sending from the app is not allowed yet");
    if (await page.getByRole("dialog").count()) throw new Error("the confirmation dialog opened");
    if ((await page.getByTestId("send-reconnect").getByRole("link", { name: "Reconnect Google" }).getAttribute("href")) !== "/api/google/connect") throw new Error("Reconnect link");
    if ((await gsent()).length) throw new Error("an email was sent");
  });

  await step("Reconnect Google keeps the same connection row and allows sending", async () => {
    const before = (await one("select id from google_connections")).id;
    await gpost("/__mode", { grantSend: true });
    await page.goto(`${BASE}/settings`);
    await page.getByTestId("send-reconnect").getByRole("link", { name: "Reconnect Google" }).click();
    await page.waitForURL(/\/settings\?google=connected$/);
    await expectText(page, "Sending from the app");
    await expectText(page, "Allowed");
    const rows = await pg.query("select id, scopes from google_connections");
    if (rows.rows.length !== 1 || rows.rows[0].id !== before) throw new Error("connection row was not kept");
    if (!rows.rows[0].scopes.includes("https://www.googleapis.com/auth/gmail.send")) throw new Error("gmail.send not saved");
    if (await page.getByTestId("send-reconnect").count()) throw new Error("Reconnect still shown");
    await page.goto(`${BASE}/settings`);
    await page.screenshot({ path: path.join(OUT, "flow-settings-send-allowed.png"), fullPage: true });
    await ph.goto(`${BASE}/settings`);
    await ph.screenshot({ path: path.join(OUT, "phone-settings-send-allowed.png"), fullPage: true });
  });

  await step("Send now: confirmation dialog, Edit returns to the editor, Send email sends once, logs outreach, target +1", async () => {
    await page.goto(`${BASE}/people/outreach`);
    const before = await outreachCount();
    const first = (await page.locator("a[href^='/records/contacts/']").first().innerText()).trim();
    await page.getByRole("button", { name: "Draft message" }).first().click();
    const box = page.locator("textarea");
    await box.waitFor();
    await page.locator('label:has-text("Subject") input').fill("Café check-in ✓");
    await box.fill("Hi Quinn,\n\nDoes anyone come to mind?\n- Owner-operated\n- No broker yet\n\nThanks,\nBram");
    await page.getByTestId("send-now").click();
    const dlg = page.getByRole("dialog", { name: "Send this email?" });
    await dlg.waitFor();
    const shown = await dlg.innerText();
    for (const t of ["To", "quinn@example.com", "Subject", "Café check-in ✓", "Does anyone come to mind?", "Send email", "Edit"]) if (!shown.includes(t)) throw new Error(`dialog is missing ${t}`);
    const pre = await page.getByTestId("send-preview-body").innerText();
    if (!pre.includes("Hi Quinn,\n\nDoes anyone come to mind?\n- Owner-operated")) throw new Error(`line breaks not kept: ${JSON.stringify(pre)}`);
    await page.screenshot({ path: path.join(OUT, "flow-send-confirm.png") });
    await page.getByTestId("send-edit").click();
    await dlg.waitFor({ state: "hidden" });
    if (!(await box.evaluate((el) => el === document.activeElement))) throw new Error("Edit did not return to the message");
    if ((await gsent()).length) throw new Error("sent before confirming");
    await page.getByTestId("send-now").click();
    await dlg.waitFor();
    await page.getByTestId("send-confirm").dblclick();
    await page.waitForURL(/notice=Sent/);
    await expectText(page, "It is in Gmail, Sent.");
    await expectText(page, `Logged as outreach to ${first}`);
    await page.screenshot({ path: path.join(OUT, "flow-send-success.png"), fullPage: true });
    const sent = await gsent();
    if (sent.length !== 1) throw new Error(`expected 1 email, Gmail got ${sent.length}`);
    if (sent[0].to !== "quinn@example.com" || sent[0].subject !== "Café check-in ✓") throw new Error(`headers: ${sent[0].to} / ${sent[0].subject}`);
    if (!sent[0].body.includes("Hi Quinn,\r\n\r\nDoes anyone come to mind?\r\n- Owner-operated")) throw new Error("body line breaks");
    const comm = await one("select * from communications where gmail_message_id = $1", [sent[0].id]);
    if (!comm) throw new Error("no communication with the Gmail id");
    if (!comm.is_outreach || comm.purpose !== "deal_sourcing" || comm.method !== "email" || comm.direction !== "outgoing" || comm.subject !== "Café check-in ✓") throw new Error(`communication: ${JSON.stringify(comm)}`);
    if ((await one("select name from contacts where id = $1", [comm.contact_id])).name !== first) throw new Error("not linked to the contact");
    const log = await one("select * from change_log where field = 'email_sent' and record_id = $1", [comm.id]);
    if (!log || log.actor !== "owner" || log.new_value.gmail_message_id !== sent[0].id) throw new Error("change log entry");
    const after = await outreachCount();
    if (after !== before + 1) throw new Error(`target count ${before} to ${after}`);
  });

  await step("Send failure: plain English error, text kept, Save to Gmail drafts offered", async () => {
    await gpost("/__mode", { sendError: "server" });
    await page.goto(`${BASE}/people/outreach`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    const box = page.locator("textarea");
    await box.waitFor();
    await box.fill("Kept text after a failure.\nSecond line.");
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-failed").waitFor();
    await expectText(page, "Not sent. Gmail had a problem on its side.");
    await expectText(page, "Google said: Backend Error");
    if ((await box.inputValue()) !== "Kept text after a failure.\nSecond line.") throw new Error("text not kept");
    await page.screenshot({ path: path.join(OUT, "flow-send-failed.png"), fullPage: true });
    await page.getByTestId("save-draft").click();
    await expectText(page, "Gmail draft created for");
    if ((await gsent()).length !== 1) throw new Error("a failed send was recorded");
    await gpost("/__mode", { sendError: null });
  });

  await step("Phone: confirmation dialog and Sent", async () => {
    await ph.goto(`${BASE}/people/outreach`);
    await ph.getByRole("button", { name: "Draft message" }).first().click();
    await ph.locator("textarea").waitFor();
    await ph.getByTestId("send-now").click();
    await ph.getByRole("dialog", { name: "Send this email?" }).waitFor();
    await ph.screenshot({ path: path.join(OUT, "phone-send-confirm.png") });
    await ph.getByTestId("send-confirm").click();
    await ph.waitForURL(/notice=Sent/);
    await ph.screenshot({ path: path.join(OUT, "phone-send-success.png"), fullPage: true });
    if ((await gsent()).length !== 2) throw new Error("expected a second email");
  });

  await step("Partner report: Send now marks the report sent with the date and logs the communication", async () => {
    await page.goto(`${BASE}/accountability/reports`);
    const id = (await one("select id from partner_reports where status = 'finalized' order by finalized_at desc limit 1")).id;
    await page.goto(`${BASE}/accountability/reports/${id}`);
    await page.getByTestId("send-now").click();
    const dlg = page.getByRole("dialog", { name: "Send this email?" });
    await dlg.waitFor();
    const shown = await dlg.innerText();
    if (!shown.includes("partner-one@example.com") || !shown.includes("Cancel") || shown.includes("Edit")) throw new Error("report dialog");
    await page.screenshot({ path: path.join(OUT, "flow-report-send-confirm.png") });
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor();
    await expectText(page, "Sent from the app on");
    await page.screenshot({ path: path.join(OUT, "flow-report-sent.png"), fullPage: true });
    const r = await one("select sent_at, gmail_message_id, delivered_via from partner_reports where id = $1", [id]);
    if (!r.sent_at || !r.gmail_message_id || !r.delivered_via.includes("gmail_sent")) throw new Error(`report: ${JSON.stringify(r)}`);
    const comm = await one("select * from communications where gmail_message_id = $1", [r.gmail_message_id]);
    if (!comm || comm.is_outreach) throw new Error("report communication");
    if (!(await one("select 1 x from record_links where from_type = 'communications' and from_id = $1 and to_type = 'partners'", [comm.id]))) throw new Error("not linked to the partner");
    if (!(await one("select 1 x from change_log where field = 'email_sent' and table_name = 'partner_reports' and record_id = $1 and actor = 'owner'", [id]))) throw new Error("change log");
  });

  await step("Change log lists the sends", async () => {
    await page.goto(`${BASE}/settings/change-log`);
    await expectText(page, "Email sent from the app");
  });

  await phone.close();
  await pg.end();

  await browser.close();
  for (const r of results) console.log(r.join(" "));
  if (results.some((r) => r[0] === "FAIL")) process.exit(1);
})();

// LOCAL TESTING ONLY. Clicks through the main workflows against the local mock and reports each step.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

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

// Dates as the app sees them: the app's "today" is the New York date (owner time zone), never the UTC date, which is
// already tomorrow late in the evening. nyDate(0) is today, nyDate(5) is 5 days from today (YYYY-MM-DD).
const nyDate = (offsetDays = 0) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
// Last month (YYYY-MM) in New York.
const nyPrevMonth = () => {
  const [y, m] = nyDate(0).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

const results = [];
async function step(name, fn) {
  // FLOWS=<regular expression> runs only the matching steps (for example FLOWS="Send|Google").
  if (process.env.FLOWS && !new RegExp(process.env.FLOWS).test(name)) return;
  try {
    await fn();
    results.push(["ok  ", name]);
  } catch (e) {
    results.push(["FAIL", `${name}: ${e.message.split("\n")[0]}`]);
    if (process.env.FAIL_SHOTS && global.__page) await global.__page.screenshot({ path: `/tmp/fail-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
// Links to tasks, contacts, organizations, pipeline items, goals, and milestones open the quick view window;
// "Open full page" goes to the record page.
const openFull = async (page, link) => {
  await link.click();
  await page.getByTestId("quick-view-full-page").click();
  await page.waitForURL(/\/records\/[a-z_]+\/[0-9a-f-]{36}$/);
};
// The Google stand-in's sample signature has an https image (as Gmail-hosted images are); the browser gets a local
// test logo for that address instead of reaching the internet.
const SIGNATURE_LOGO = fs.readFileSync(path.join(__dirname, "fixtures", "signature-logo.png"));
const routeSignatureImage = (context) => context.route("https://lh3.googleusercontent.com/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: SIGNATURE_LOGO }));
// The confirmation dialog shows the email in a frame (exactly as an email app shows it).
// A blank line (Gmail's <div><br></div>) reads as 3 line breaks in innerText; it is one blank line on screen.
const previewText = async (pg_, testId = "send-preview-frame") => (await pg_.frameLocator(`[data-testid=${testId}]`).locator("body").innerText()).replace(/\n{3,}/g, "\n\n");
// The email Message box is a formatted editor (contenteditable). fillEditor replaces its content by pasting plain
// text (the editor turns "- " and "1. " lines into lists, as it does for AI drafts); editorText reads what it shows.
const fillEditor = async (loc, text) => {
  await loc.waitFor();
  await loc.click();
  await loc.press("ControlOrMeta+a");
  await loc.press("Delete");
  await loc.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
};
// editorText: the box as plain text (one line per paragraph, list items with "- " or "1. ", as the text part is made).
const editorText = (loc) =>
  loc.evaluate((root) => {
    const out = [];
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (c.tagName === "P") out.push(c.textContent);
        else if (c.tagName === "UL" || c.tagName === "OL") {
          let n = Number(c.getAttribute("start") || 1);
          for (const li of c.children) {
            const own = [...li.children].filter((x) => x.tagName === "P").map((x) => x.textContent).join(" ");
            out.push(`${"  ".repeat(depth)}${c.tagName === "OL" ? `${n++}. ` : "- "}${own}`);
            for (const sub of li.children) if (sub.tagName === "UL" || sub.tagName === "OL") walk({ children: [sub] }, depth + 1);
          }
        }
      }
    };
    walk(root, 0);
    return out.join("\n").replace(/\s+$/, "");
  });
// The text a person reads in the box (list marks are drawn, not text): no line may start with "- ".
const shownText = (loc) => loc.evaluate((el) => el.innerText);
const expectText = async (page, text) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 15000 });
  } catch {
    throw new Error(`text not shown: "${text}" on ${page.url()}`);
  }
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addCookies([cookie]);
  await routeSignatureImage(ctx);
  const page = await ctx.newPage();
  global.__page = page;
  page.on("dialog", (d) => d.accept());

  await step("Resolve a missed commitment with a reason and new date", async () => {
    await page.goto(`${BASE}/accountability`);
    const before = await page.locator('input[name="reason"]').count();
    if (!before) throw new Error("no missed commitments to resolve");
    await page.locator('input[name="reason"]').first().fill("Spent the afternoon on the broker call.");
    await page.locator('form:has(input[name="reason"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");
    // Wait for the list to refresh (a fixed wait was too short on a slow run).
    await page.waitForFunction((n) => document.querySelectorAll('input[name="reason"]').length === n, before - 1, { timeout: 15000 }).catch(() => {});
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
    await row.locator('input[name="due_date"]').fill(nyDate(5));
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
    // A scenario opens its overview in the window first; Open full page has the charts and the numbers to change.
    await page.locator("ul a").first().click();
    await page.getByTestId("overview-window").waitFor();
    await expectText(page, "Numbers changed");
    await page.screenshot({ path: path.join(OUT, "desktop-window-scenario.png") });
    await page.getByTestId("quick-view-full-page").click();
    await page.waitForURL(/\/plan\/scenarios\/[0-9a-f-]{36}$/);
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
    await openFull(page, page.locator("a[href^='/records/pipeline_items/']:not([href*='/new'])").first());
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
    await openFull(page, page.getByRole("link", { name: "Demo Sign Shop" }).first());
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
    await page.goto(`${BASE}/records/tasks/new?due_date=${nyDate(0)}`);
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
    await page.goto(`${BASE}/finance/expenses?month=${nyPrevMonth()}`);
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
    await page.goto(`${BASE}/finance/budget?month=${nyPrevMonth()}`);
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

  await step("Chat panel opens and answers (local AI stand-in)", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Open AI chat" }).click();
    await page.fill("textarea[aria-label='Message']", "What is my runway?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expectText(page, "this is the local test AI");
    await page.getByRole("button", { name: "Close AI chat" }).click();
  });

  await step("Change log shows changes", async () => {
    await page.goto(`${BASE}/settings/change-log`);
    await expectText(page, "Number value");
  });

  await step("Pipelines always open in list view, even after choosing the board; ?view=board still opens the board", async () => {
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
    // The next visit opens the list again (the board is not remembered).
    await p.goto(`${BASE}/opportunities/${id}`);
    await p.waitForFunction(() => document.body.innerText.toLowerCase().includes("days in stage"));
    if (await p.locator("[role=region][aria-label$='board']").count()) throw new Error("board remembered as the default");
    await p.goto(`${BASE}/opportunities`);
    await p.getByRole("link", { name: "Open pipeline" }).first().click();
    await p.waitForFunction(() => document.body.innerText.toLowerCase().includes("days in stage"));
    await p.goto(`${BASE}/opportunities/${id}?view=board`);
    await p.waitForSelector("[role=region][aria-label$='board']");
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
    await openFull(page, page.getByRole("link", { name: "Demo Sign Shop" }).first());
    await page.goto(`${page.url().split("?")[0]}?edit=1`);
    await page.locator("#f_introduced_by_contact_id").fill("riley");
    await page.locator("[role=option]", { hasText: "Riley Test" }).first().click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}$/);
    await openFull(page, page.getByRole("link", { name: "Riley Test" }).first());
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
    await openFull(page, page.getByRole("link", { name: "Flow Dialog Person" }).first());
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
  await routeSignatureImage(phone);
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
    const box = page.getByTestId("draft-body");
    await box.waitFor();
    await page.locator('label:has-text("Subject") input').fill("Café check-in ✓");
    await fillEditor(box, "Hi Quinn,\n\nDoes anyone come to mind?\n- Owner-operated\n- No broker yet\n\nThanks,\nBram");
    await page.getByTestId("send-now").click();
    const dlg = page.getByRole("dialog", { name: "Send this email?" });
    await dlg.waitFor();
    const shown = await dlg.innerText();
    for (const t of ["To", "quinn@example.com", "Subject", "Café check-in ✓", "Send email", "Edit"]) if (!shown.includes(t)) throw new Error(`dialog is missing ${t}`);
    const pre = await previewText(page);
    if (!pre.includes("Hi Quinn,\n\nDoes anyone come to mind?\nOwner-operated\nNo broker yet")) throw new Error(`line breaks not kept: ${JSON.stringify(pre)}`);
    if ((await page.frameLocator("[data-testid=send-preview-frame]").locator("li").count()) !== 2) throw new Error("the two bullets are not a list");
    await page.screenshot({ path: path.join(OUT, "flow-send-confirm.png") });
    await page.getByTestId("send-edit").click();
    await dlg.waitFor({ state: "hidden" });
    // The editor takes focus on the next frame after the dialog closes.
    try {
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "draft-body", null, { timeout: 3000 });
    } catch {
      throw new Error("Edit did not return to the message");
    }
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
    const box = page.getByTestId("draft-body");
    await box.waitFor();
    await fillEditor(box, "Kept text after a failure.\nSecond line.");
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-failed").waitFor();
    await expectText(page, "Not sent. Gmail had a problem on its side.");
    await expectText(page, "Google said: Backend Error");
    if ((await editorText(box)) !== "Kept text after a failure.\nSecond line.") throw new Error(`text not kept: ${JSON.stringify(await editorText(box))}`);
    await page.screenshot({ path: path.join(OUT, "flow-send-failed.png"), fullPage: true });
    await page.getByTestId("save-draft").click();
    await expectText(page, "Gmail draft created for");
    if ((await gsent()).length !== 1) throw new Error("a failed send was recorded");
    await gpost("/__mode", { sendError: null });
  });

  await step("Phone: confirmation dialog and Sent", async () => {
    await ph.goto(`${BASE}/people/outreach`);
    await ph.getByRole("button", { name: "Draft message" }).first().click();
    await ph.getByTestId("draft-body").waitFor();
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

  // ---------- Email button (contacts, organizations, pipeline items) and "Email them" (Outreach Queue) ----------
  const e1280ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await e1280ctx.addCookies([cookie]);
  await routeSignatureImage(e1280ctx);
  const e1280 = await e1280ctx.newPage();
  const EVIEWS = [["desktop", page], ["desktop1280", e1280], ["phone", ph]];
  const composeTo = (pg_) => pg_.getByTestId("compose-to").inputValue();
  const commByGmail = (id) => one("select * from communications where gmail_message_id = $1", [id]);

  await step("Email button: contact page, Write with AI, Send now, confirm, sent, logged as outreach, target +1", async () => {
    await page.goto(`${BASE}/people/outreach`);
    const before = await outreachCount();
    const sentBefore = (await gsent()).length;
    const c = await one("select id, email from contacts where name = 'Morgan Example'");
    for (const [vp, pg_] of EVIEWS) {
      await pg_.goto(`${BASE}/records/contacts/${c.id}`);
      await pg_.getByTestId("email-button").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-contact-email-button.png`), fullPage: vp !== "phone" });
    }
    await page.getByTestId("email-button").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    if ((await composeTo(page)) !== c.email) throw new Error(`To is ${await composeTo(page)}`);
    if (await page.getByTestId("compose-recipient").count()) throw new Error("a one-person chooser is shown on a contact page");
    if (!(await page.getByTestId("send-now").isDisabled())) throw new Error("Send now is enabled with an empty message");
    await page.getByTestId("compose-ai-line").fill("ask about off-market deals");
    await page.getByTestId("compose-ai-write").click();
    await page.waitForFunction(() => (document.querySelector("[data-testid=compose-body]")?.innerText ?? "").includes("Hi Morgan"), null, { timeout: 15000 });
    // The AI's "- " bullets show as a real list in the Message box (no "- " text left).
    const body = page.getByTestId("compose-body");
    if ((await body.locator("ul > li").count()) !== 2) throw new Error(`AI bullets are not a list: ${await body.innerHTML()}`);
    if (/(^|\n)- /.test(await shownText(body))) throw new Error("a leading '- ' is still shown as text");
    if (!(await page.getByTestId("compose-subject").inputValue()).includes("off-market deals")) throw new Error("AI subject not filled");
    await page.screenshot({ path: path.join(OUT, "desktop-compose-email.png") });
    await page.getByTestId("send-now").click();
    const confirm = page.getByRole("dialog", { name: "Send this email?" });
    await confirm.waitFor();
    const shown = await confirm.innerText();
    for (const t of ["To", c.email, "Subject", "Send email", "Edit"]) if (!shown.includes(t)) throw new Error(`confirmation is missing ${t}`);
    if (!(await previewText(page)).includes("Hi Morgan")) throw new Error("confirmation preview is missing the message");
    await page.screenshot({ path: path.join(OUT, "desktop-compose-confirm.png") });
    if ((await gsent()).length !== sentBefore) throw new Error("sent before confirming");
    await page.getByTestId("send-confirm").dblclick();
    await dlg.getByTestId("send-success").waitFor();
    const sent = await gsent();
    if (sent.length !== sentBefore + 1) throw new Error(`expected 1 email, Gmail got ${sent.length - sentBefore}`);
    const last = sent[sent.length - 1];
    if (last.to !== c.email || !last.body.includes("Hi Morgan")) throw new Error(`sent: ${last.to}`);
    const comm = await commByGmail(last.id);
    if (!comm || comm.contact_id !== c.id || !comm.is_outreach || comm.purpose !== "deal_sourcing" || comm.method !== "email" || comm.direction !== "outgoing") throw new Error(`communication: ${JSON.stringify(comm)}`);
    if (!(await one("select 1 x from change_log where field = 'email_sent' and record_id = $1 and actor = 'owner'", [comm.id]))) throw new Error("change log entry");
    await page.getByTestId("compose-close").click();
    await dlg.waitFor({ state: "hidden" });
    await expectText(page, comm.subject);
    await page.goto(`${BASE}/people/outreach`);
    const after = await outreachCount();
    if (after !== before + 1) throw new Error(`target count ${before} to ${after}`);
  });

  await step("Email button: pipeline item defaults to the main contact, then Deal came from; send links the item", async () => {
    const morgan = await one("select id, email from contacts where name = 'Morgan Example'");
    const pat = await one("select id, email from contacts where name = 'Pat Example, CPA'");
    const itemId = (await one("select id from pipeline_items where name = 'Demo Landscaping LLC'")).id;
    await pg.query("update pipeline_items set primary_contact_id = $1, source_contact_id = $2 where id = $3", [morgan.id, pat.id, itemId]);
    const item = { id: itemId, source_contact_id: pat.id, source_email: pat.email };
    await page.goto(`${BASE}/records/pipeline_items/${item.id}`);
    await page.getByTestId("email-button").click();
    await page.getByTestId("compose-dialog").waitFor();
    if ((await composeTo(page)) !== morgan.email) throw new Error(`main contact not chosen: ${await composeTo(page)}`);
    const opts = await page.getByTestId("compose-recipient").locator("option").allInnerTexts();
    if (!opts.some((o) => o.includes("(Main contact)")) || !opts.some((o) => o.includes("(Deal came from)"))) throw new Error(`choices: ${opts.join(" | ")}`);
    // Changeable: choose Deal came from, then type another address.
    await page.getByTestId("compose-recipient").selectOption(item.source_contact_id);
    if ((await composeTo(page)) !== item.source_email) throw new Error("choosing Deal came from did not fill To");
    await page.getByTestId("compose-to").fill("bad@");
    await fillEditor(page.getByTestId("compose-body"), "Test");
    await page.getByTestId("compose-to-error").waitFor();
    if (!(await page.getByTestId("send-now").isDisabled())) throw new Error("Send now enabled with an invalid address");
    await page.keyboard.press("Escape");
    await page.getByTestId("compose-discard").waitFor();
    await page.getByRole("button", { name: "Discard email" }).click();
    await page.getByTestId("compose-dialog").waitFor({ state: "hidden" });
    // No main contact: Deal came from.
    await pg.query("update pipeline_items set primary_contact_id = null where id = $1", [item.id]);
    await page.reload();
    await page.getByTestId("email-button").click();
    if ((await composeTo(page)) !== item.source_email) throw new Error(`Deal came from not chosen: ${await composeTo(page)}`);
    await page.getByTestId("compose-subject").fill("Following up on the CIM");
    await fillEditor(page.getByTestId("compose-body"), "Hi Pat,\n\nCould you send the CIM?\n\nThanks,\nBram");
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const sent = await gsent();
    const comm = await commByGmail(sent[sent.length - 1].id);
    if (comm.pipeline_item_id !== item.id || comm.contact_id !== item.source_contact_id || comm.purpose !== "deal_sourcing" || !comm.is_outreach) throw new Error(`communication: ${JSON.stringify(comm)}`);
    if (!(await one("select 1 x from record_links where from_type = 'communications' and from_id = $1 and to_type = 'pipeline_items' and to_id = $2", [comm.id, item.id]))) throw new Error("not linked to the item");
    await page.getByTestId("compose-close").click();
    await expectText(page, "Following up on the CIM");
  });

  await step("Email button: organization page, choose a person, Save to Gmail drafts sends nothing; unsaved text asks before closing", async () => {
    const robin = await one("select id, email, organization_id from contacts where name = 'Robin Client (demo)'");
    const sentBefore = (await gsent()).length;
    await page.goto(`${BASE}/records/organizations/${robin.organization_id}`);
    await page.getByTestId("email-button").click();
    await page.getByTestId("compose-dialog").waitFor();
    if (await page.getByTestId("compose-recipient").count()) {
      const opts = await page.getByTestId("compose-recipient").locator("option").allInnerTexts();
      if (!opts.some((o) => o.includes("Robin Client"))) throw new Error(`choices: ${opts.join(" | ")}`);
      await page.getByTestId("compose-recipient").selectOption(robin.id);
    }
    if ((await composeTo(page)) !== robin.email) throw new Error(`To: ${await composeTo(page)}`);
    await page.getByTestId("compose-subject").fill("Consulting next quarter");
    await fillEditor(page.getByTestId("compose-body"), "Hi Robin,\n\nA quick note about next quarter.\n\nBest,\nBram");
    await page.keyboard.press("Escape");
    await page.getByTestId("compose-discard").waitFor();
    await page.getByRole("button", { name: "Keep writing" }).click();
    if ((await editorText(page.getByTestId("compose-body"))).indexOf("next quarter") < 0) throw new Error("text not kept");
    await page.getByTestId("save-draft").click();
    await expectText(page, `Gmail draft created for ${robin.email}`);
    if ((await gsent()).length !== sentBefore) throw new Error("Save to Gmail drafts sent an email");
    // Saved to drafts: closing no longer asks.
    await page.keyboard.press("Escape");
    await page.getByTestId("compose-dialog").waitFor({ state: "hidden" });
  });

  await step("Outreach Queue: Email them from the not-in-queue card with a typed address (logged without a contact)", async () => {
    const addr = "new.person@example.org";
    for (const [vp, pg_] of EVIEWS) {
      await pg_.goto(`${BASE}/people/outreach`);
      const card = pg_.locator("div.rounded-xl", { hasText: "Outreach to someone not in the queue" }).last();
      await card.getByRole("button", { name: "Log outreach" }).click();
      await card.getByTestId("log-outreach-form").waitFor();
      // Every label sits above its field and no field is squeezed.
      const boxes = await card.locator("[data-testid=log-outreach-form] form > div").evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, x: r.x, y: r.y, h: r.height }; }));
      if (boxes.some((bx) => bx.w < 100)) throw new Error(`${vp}: a field is narrower than 100px: ${JSON.stringify(boxes)}`);
      const close = await card.getByRole("button", { name: "Close Log outreach" }).boundingBox();
      const panel = await card.getByTestId("log-outreach-form").boundingBox();
      if (panel.x + panel.width - (close.x + close.width) < 12) throw new Error(`${vp}: close button too close to the edge`);
      await card.screenshot({ path: path.join(OUT, `${vp}-outreach-not-in-queue.png`) });
    }
    const sentBefore = (await gsent()).length;
    await page.goto(`${BASE}/people/outreach`);
    await page.getByTestId("not-in-queue-email").fill(addr);
    await page.getByTestId("email-them").click();
    await page.getByTestId("compose-dialog").waitFor();
    if ((await composeTo(page)) !== addr) throw new Error(`To: ${await composeTo(page)}`);
    await page.getByTestId("compose-subject").fill("Nice to meet you");
    await fillEditor(page.getByTestId("compose-body"), "Hi,\n\nGood to meet you at the event.\n\nBram");
    for (const [vp, pg_] of EVIEWS.slice(1)) {
      await pg_.goto(`${BASE}/people/outreach`);
      await pg_.getByTestId("not-in-queue-email").fill(addr);
      await pg_.getByTestId("email-them").click();
      await pg_.getByTestId("compose-dialog").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-compose-email.png`) });
    }
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const sent = await gsent();
    if (sent.length !== sentBefore + 1 || sent[sent.length - 1].to !== addr) throw new Error("not sent to the typed address");
    const comm = await commByGmail(sent[sent.length - 1].id);
    if (comm.contact_id !== null || !comm.is_outreach || comm.purpose !== "general" || !String(comm.summary).includes(addr)) throw new Error(`communication: ${JSON.stringify(comm)}`);
    // Log outreach still works from the card.
    await page.getByTestId("compose-close").click();
    const card = page.locator("div.rounded-xl", { hasText: "Outreach to someone not in the queue" }).last();
    await card.getByRole("button", { name: "Log outreach" }).click();
    await card.locator("input[name=summary]").fill("Called about a referral");
    await card.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/notice=Outreach/);
    await expectText(page, "Outreach logged.");
  });


  // ---------- Gmail signature on app emails (Google stand-in: settings scope and a sample sendAs signature) ----------
  const gdrafts = async () => (await fetch(`${GMOCK}/__drafts`)).json();
  const SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
  const googleCard = () => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: /^Google/ }) }).first();
  const morgan = async () => one("select id, email from contacts where name = 'Morgan Example'");
  const openCompose = async (pg_, contactId, subject, body) => {
    await pg_.goto(`${BASE}/records/contacts/${contactId}`);
    await pg_.getByTestId("email-button").click();
    await pg_.getByTestId("compose-dialog").waitFor();
    await pg_.getByTestId("compose-subject").fill(subject);
    await fillEditor(pg_.getByTestId("compose-body"), body);
  };
  const unsafeGone = (html, where) => {
    for (const bad of ["<script", "onerror", "javascript:", "alert("]) if (html.includes(bad)) throw new Error(`${where} still has ${bad}`);
  };

  await step("Gmail signature: connected without the settings permission, Settings shows Reconnect for the signature (one row, sending still allowed)", async () => {
    await gpost("/__mode", { grantSignature: false });
    await page.goto(`${BASE}/api/google/connect`);
    await page.waitForURL(/\/settings\?google=connected_no_signature/);
    await page.goto(`${BASE}/settings`);
    await expectText(page, "Reconnect Google to use your Gmail signature (1 minute)");
    await expectText(page, "Sending from the app");
    const rows = await pg.query("select scopes from google_connections");
    if (rows.rows.length !== 1) throw new Error("expected one connection row");
    if (!rows.rows[0].scopes.includes("gmail.send") || rows.rows[0].scopes.includes(SETTINGS_SCOPE)) throw new Error(`scopes: ${rows.rows[0].scopes}`);
    const card = googleCard();
    if ((await card.getByRole("link", { name: "Reconnect Google" }).count()) !== 1) throw new Error("expected exactly one Reconnect Google button on the Google card");
    if ((await page.getByTestId("send-reconnect").count()) !== 1) throw new Error("expected one Reconnect message");
    await page.screenshot({ path: path.join(OUT, "flow-settings-reconnect-signature.png"), fullPage: true });
    await ph.goto(`${BASE}/settings`);
    await ph.screenshot({ path: path.join(OUT, "phone-settings-reconnect-signature.png"), fullPage: true });
    // The signature page: Reconnect shown, Copy from Gmail not available.
    await page.goto(`${BASE}/settings/email`);
    await expectText(page, "Reconnect Google to use your Gmail signature (1 minute)");
    if (!(await page.getByTestId("signature-copy").isDisabled())) throw new Error("Copy from Gmail enabled without the permission");
    // Sending still works without the permission (no signature saved yet).
    const c = await morgan();
    const before = (await gsent()).length;
    await openCompose(page, c.id, "Before the signature", "Hi Morgan,\n\nA quick note.\n\nBram");
    if (await page.getByTestId("include-signature").count()) throw new Error("Include signature shown with no signature saved");
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const sent = await gsent();
    if (sent.length !== before + 1) throw new Error("not sent");
    const last = sent[sent.length - 1];
    if (!last.contentType.startsWith("multipart/alternative") || last.parts.length !== 2 || !last.closed) throw new Error(`not multipart: ${last.contentType} ${JSON.stringify(last.parts)}`);
    if (last.body.includes("-- ") || (last.html || "").includes("gmail_signature")) throw new Error("a signature was added with none saved");
  });

  await step("Gmail signature: Reconnect, Copy from Gmail fills the preview (unsafe parts removed), edit and save", async () => {
    await gpost("/__mode", { grantSignature: true });
    await page.goto(`${BASE}/settings`);
    await googleCard().getByTestId("send-reconnect").getByRole("link", { name: "Reconnect Google" }).click();
    await page.waitForURL(/\/settings\?google=connected$/);
    await expectText(page, "Gmail signature");
    await expectText(page, "Can be copied");
    if (await page.getByTestId("send-reconnect").count()) throw new Error("Reconnect still shown");
    if (!(await one("select scopes from google_connections")).scopes.includes(SETTINGS_SCOPE)) throw new Error("settings scope not saved");
    await page.getByRole("link", { name: "Email signature" }).first().click();
    await page.waitForURL(/\/settings\/email$/);
    await page.getByTestId("signature-preview-empty").waitFor();
    if ((await page.getByTestId("signature-copy").innerText()).trim() !== "Copy from Gmail") throw new Error("button label");
    if (!(await page.getByTestId("signature-enabled").isChecked())) throw new Error("the setting should start on");
    await page.getByTestId("signature-copy").click();
    await page.getByTestId("signature-status").filter({ hasText: "Copied from Gmail (owner@example.com)" }).waitFor();
    const html = await page.getByTestId("signature-html").inputValue();
    if (!html.includes("Bram Frankel") || html.includes("Alias signature")) throw new Error("not the default send-as signature");
    unsafeGone(html, "copied signature");
    const preview = await previewText(page, "signature-preview");
    for (const t of ["Your message appears here.", "Bram Frankel", "(404) 555-0123", "cyanarc.com", "Unsafe link"]) if (!preview.includes(t)) throw new Error(`preview is missing ${t}`);
    const img = page.frameLocator("[data-testid=signature-preview]").locator("img");
    if ((await img.getAttribute("src")) !== "https://lh3.googleusercontent.com/mock-signature/cyan-arc-logo.png") throw new Error("image address changed");
    await page.waitForFunction(() => {
      const f = document.querySelector("[data-testid=signature-preview]");
      const im = f?.contentDocument?.querySelector("img");
      return !!im && im.complete && im.naturalWidth > 0;
    }, null, { timeout: 10000 });
    const plain = await page.getByTestId("signature-text").innerText();
    if (!plain.includes("Bram Frankel\nFounder, Cyan Arc LLC\n(404) 555-0123 | cyanarc.com")) throw new Error(`plain text: ${JSON.stringify(plain)}`);
    await page.screenshot({ path: path.join(OUT, "desktop-email-signature-copied.png"), fullPage: true });
    // A copied signature that is not saved yet counts as unsaved work: leaving asks first (in-app link and tab close/reload).
    await page.getByRole("link", { name: "Connections" }).first().click();
    await page.getByRole("dialog").filter({ hasText: /not saved/i }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: /Stay/ }).click();
    if (!/\/settings\/email$/.test(page.url())) throw new Error("left the page with an unsaved copied signature");
    {
      const probe = await ctx.newPage();
      await probe.goto(`${BASE}/settings/email`);
      await probe.getByTestId("signature-copy").click();
      await probe.getByTestId("signature-status").filter({ hasText: "Copied from Gmail" }).waitFor();
      let kind = null;
      probe.on("dialog", async (d) => {
        kind = d.type();
        await d.dismiss();
      });
      await probe.close({ runBeforeUnload: true });
      for (let i = 0; i < 40 && kind === null; i++) await new Promise((r) => setTimeout(r, 250));
      if (kind !== "beforeunload") throw new Error("no reload/close prompt after Copy from Gmail");
      if (!probe.isClosed()) await probe.close();
    }
    // Edit: the preview follows the box; Save stores it.
    await page.getByTestId("signature-html").fill(html.replace("Founder, Cyan Arc LLC", "Founder and CEO, Cyan Arc LLC"));
    await page.waitForFunction(() => document.querySelector("[data-testid=signature-preview]")?.contentDocument?.body?.innerText.includes("Founder and CEO"), null, { timeout: 5000 });
    await expectText(page, "Not saved yet.");
    await page.getByTestId("signature-save").click();
    await page.getByTestId("signature-status").filter({ hasText: "Signature saved." }).waitFor();
    const row = await one("select email_signature_html h, email_signature_text t, email_signature_enabled e, email_signature_updated_at u from owner_profile");
    if (!row.h.includes("Founder and CEO") || !row.t.includes("Founder and CEO, Cyan Arc LLC") || row.e !== true || !row.u) throw new Error(`saved: ${JSON.stringify(row)}`);
    unsafeGone(row.h, "saved signature");
    await page.reload();
    if ((await page.getByTestId("signature-copy").innerText()).trim() !== "Refresh from Gmail") throw new Error("Refresh from Gmail not shown after saving");
    await expectText(page, "Saved ");
    await page.screenshot({ path: path.join(OUT, "desktop-email-signature.png"), fullPage: true });
    await ph.goto(`${BASE}/settings/email`);
    await ph.getByTestId("signature-preview").waitFor();
    await ph.waitForTimeout(500);
    await ph.screenshot({ path: path.join(OUT, "phone-email-signature.png"), fullPage: true });
  });

  await step("Send with signature: Include signature is checked, the confirmation shows it, Gmail gets both parts with the signature", async () => {
    const c = await morgan();
    const before = (await gsent()).length;
    await openCompose(page, c.id, "Signature check ✓", "Hi Morgan,\n\nTwo things:\n- The CIM\n- A call next week\n\nThanks,\nBram");
    if (!(await page.getByTestId("include-signature").isChecked())) throw new Error("Include signature not checked by default");
    await page.screenshot({ path: path.join(OUT, "desktop-compose-signature.png") });
    await page.getByTestId("send-now").click();
    const dlg = page.getByRole("dialog", { name: "Send this email?" });
    await dlg.waitFor();
    if (!(await page.getByTestId("confirm-include-signature").isChecked())) throw new Error("dialog checkbox not checked");
    await page.waitForFunction(() => {
      const im = document.querySelector("[data-testid=send-preview-frame]")?.contentDocument?.querySelector("img");
      return !!im && im.complete && im.naturalWidth > 0;
    }, null, { timeout: 10000 });
    const shown = await previewText(page);
    for (const t of ["Hi Morgan,", "The CIM", "--", "Bram Frankel", "Founder and CEO, Cyan Arc LLC", "(404) 555-0123"]) if (!shown.includes(t)) throw new Error(`preview is missing ${t}`);
    await page.screenshot({ path: path.join(OUT, "desktop-confirm-signature.png") });
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const sent = await gsent();
    if (sent.length !== before + 1) throw new Error("not sent once");
    const last = sent[sent.length - 1];
    if (!last.contentType.startsWith("multipart/alternative") || !last.closed) throw new Error(`content type ${last.contentType}`);
    if (JSON.stringify(last.parts) !== JSON.stringify(["text/plain; UTF-8", "text/html; UTF-8"])) throw new Error(`parts: ${JSON.stringify(last.parts)}`);
    if (last.subject !== "Signature check ✓") throw new Error(`subject: ${last.subject}`);
    if (!last.body.includes("- The CIM\r\n") || !last.body.includes("Bram\r\n\r\n-- \r\nBram Frankel\r\nFounder and CEO, Cyan Arc LLC\r\n(404) 555-0123 | cyanarc.com")) throw new Error(`text part: ${JSON.stringify(last.body)}`);
    for (const t of ["<li>The CIM</li>", 'class="gmail_signature"', "Founder and CEO", 'href="tel:+14045550123"', 'href="https://cyanarc.com"', 'src="https://lh3.googleusercontent.com/mock-signature/cyan-arc-logo.png"'])
      if (!last.html.includes(t)) throw new Error(`HTML part is missing ${t}`);
    unsafeGone(last.html, "sent HTML part");
    // The phone: compose box with the checkbox, and the confirmation with the signature (not sent).
    await ph.goto(`${BASE}/records/contacts/${c.id}`);
    await ph.getByTestId("email-button").click();
    await ph.getByTestId("compose-subject").fill("Signature check");
    await fillEditor(ph.getByTestId("compose-body"), "Hi Morgan,\n\nA short note to check the signature.\n\nThanks,\nBram");
    await ph.getByTestId("include-signature").scrollIntoViewIfNeeded();
    await ph.screenshot({ path: path.join(OUT, "phone-compose-signature.png") });
    await ph.getByTestId("send-now").click();
    await ph.getByRole("dialog", { name: "Send this email?" }).waitFor();
    await ph.waitForTimeout(600);
    await ph.screenshot({ path: path.join(OUT, "phone-confirm-signature.png") });
    await ph.getByTestId("send-edit").click();
  });

  await step("Unchecking Include signature sends without it (both parts)", async () => {
    const c = await morgan();
    await openCompose(page, c.id, "No signature this time", "Hi Morgan,\n\nJust the note.\n\nBram");
    await page.getByTestId("include-signature").uncheck();
    await page.getByTestId("send-now").click();
    await page.getByRole("dialog", { name: "Send this email?" }).waitFor();
    if (await page.getByTestId("confirm-include-signature").isChecked()) throw new Error("dialog checkbox should follow the compose box");
    if ((await previewText(page)).includes("Founder and CEO")) throw new Error("preview shows the signature");
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const last = (await gsent()).pop();
    if (last.subject !== "No signature this time") throw new Error("wrong email");
    if (last.parts.length !== 2 || last.body.includes("-- ") || last.body.includes("Founder") || last.html.includes("gmail_signature") || last.html.includes("Founder")) throw new Error("signature was added");
  });

  await step("Save to Gmail drafts includes the signature", async () => {
    const c = await morgan();
    const before = (await gdrafts()).length;
    await openCompose(page, c.id, "Draft with signature", "Hi Morgan,\n\nDraft text.\n\nBram");
    await page.getByTestId("save-draft").click();
    await expectText(page, "Gmail draft created for");
    const drafts = await gdrafts();
    if (drafts.length !== before + 1) throw new Error("no draft");
    const d = drafts[drafts.length - 1];
    if (!d.contentType.startsWith("multipart/alternative") || d.parts.length !== 2) throw new Error(`draft not multipart: ${d.contentType}`);
    if (!d.body.includes("\r\n-- \r\nBram Frankel") || !d.html.includes('class="gmail_signature"') || !d.html.includes("Founder and CEO")) throw new Error("draft has no signature");
    await page.keyboard.press("Escape");
  });

  await step("Partner report: the send dialog has Include signature and the sent report has the signature", async () => {
    const id = (await one("select id from partner_reports where status = 'finalized' order by finalized_at desc limit 1")).id;
    await page.goto(`${BASE}/accountability/reports/${id}`);
    if (!(await page.getByTestId("include-signature").isChecked())) throw new Error("Include signature not checked on the report");
    await page.getByTestId("send-now").click();
    await page.getByRole("dialog", { name: "Send this email?" }).waitFor();
    if (!(await page.getByTestId("confirm-include-signature").isChecked())) throw new Error("report dialog checkbox");
    if (!(await previewText(page)).includes("Founder and CEO")) throw new Error("report preview has no signature");
    await page.screenshot({ path: path.join(OUT, "desktop-report-confirm-signature.png") });
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor();
    const last = (await gsent()).pop();
    if (last.to !== "partner-one@example.com" || !last.html.includes("gmail_signature") || !last.body.includes("\r\n-- \r\nBram Frankel")) throw new Error("report sent without the signature");
  });

  await step("Outreach Queue Draft message: Include signature shown and checked", async () => {
    await page.goto(`${BASE}/people/outreach`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    await page.getByTestId("draft-body").waitFor();
    await page.getByTestId("include-signature").waitFor();
    if (!(await page.getByTestId("include-signature").isChecked())) throw new Error("not checked");
  });

  // ---------- Formatted message box (bullets, numbers, bold, italic, links shown as they will be sent) ----------
  const lastOf = async (list) => (await list())[(await list()).length - 1];

  await step("Formatted message: Draft message shows the template's bullets as a real list", async () => {
    await page.goto(`${BASE}/people/outreach`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    const box = page.getByTestId("draft-body");
    await box.waitFor();
    await page.waitForFunction(() => (document.querySelector("[data-testid=draft-body]")?.innerText ?? "").includes("Hi "), null, { timeout: 15000 });
    if ((await box.locator("ul > li").count()) < 2) throw new Error(`bullets are not a list: ${await box.innerHTML()}`);
    if (/(^|\n)- /.test(await shownText(box))) throw new Error("a leading '- ' is still shown as text");
  });

  await step("Formatted message: toolbar Bold and Bulleted list, typed '- ' and '1. ' start lists, Ctrl+I, Ctrl+K link; Send now gives HTML lists and '- ' text", async () => {
    const c = await morgan();
    const before = (await gsent()).length;
    await page.goto(`${BASE}/records/contacts/${c.id}`);
    await page.getByTestId("email-button").click();
    await page.getByTestId("compose-dialog").waitFor();
    await page.getByTestId("compose-subject").fill("Formatting check");
    const ed = page.getByTestId("compose-body");
    await ed.click();
    const kb = page.keyboard;
    await kb.type("Plain then ");
    await page.getByTestId("editor-bold").click();
    await kb.type("bold words");
    await page.getByTestId("editor-bold").click();
    await kb.type(" after.");
    if ((await ed.locator("strong").innerText()) !== "bold words") throw new Error(`Bold did not apply: ${await ed.innerHTML()}`);
    await kb.press("Enter");
    await page.getByTestId("editor-bullets").click();
    if ((await page.getByTestId("editor-bullets").getAttribute("aria-pressed")) !== "true") throw new Error("Bulleted list button not shown as on");
    await kb.type("First item");
    await kb.press("Enter");
    await kb.type("Second item");
    await kb.press("Enter");
    await kb.press("Enter");
    await kb.type("Middle line");
    await kb.press("Enter");
    await kb.type("- Typed bullet");
    await kb.press("Enter");
    await kb.press("Enter");
    await kb.type("1. Typed number");
    await kb.press("Enter");
    await kb.press("Enter");
    await kb.press("ControlOrMeta+i");
    await kb.type("italic");
    await kb.press("ControlOrMeta+i");
    await kb.type(" see ");
    await kb.press("ControlOrMeta+k");
    await page.getByTestId("editor-link-input").fill("example.com/deck");
    await page.getByTestId("editor-link-input").press("Enter");
    if ((await ed.locator("ul").count()) !== 2 || (await ed.locator("ul").first().locator("li").count()) !== 2) throw new Error(`bulleted lists: ${await ed.innerHTML()}`);
    if ((await ed.locator("ol > li").innerText()) !== "Typed number") throw new Error(`numbered list: ${await ed.innerHTML()}`);
    if ((await ed.locator("em").innerText()) !== "italic") throw new Error("Ctrl+I did not apply");
    if ((await ed.locator("a").getAttribute("href")) !== "https://example.com/deck") throw new Error(`link: ${await ed.innerHTML()}`);
    if (/(^|\n)(- |1\. )/.test(await shownText(ed))) throw new Error("typed list marks are still text");
    await page.screenshot({ path: path.join(OUT, "desktop-compose-formatting.png") });
    // The link can be edited and removed from the same button.
    await ed.locator("a").click();
    await page.getByTestId("editor-link").click();
    if ((await page.getByTestId("editor-link-input").inputValue()) !== "https://example.com/deck") throw new Error("Edit link does not show the address");
    await page.getByTestId("editor-link-input").fill("https://example.com/deck2");
    await page.getByTestId("editor-link-save").click();
    if ((await ed.locator("a").getAttribute("href")) !== "https://example.com/deck2") throw new Error("link not changed");
    await page.getByTestId("include-signature").uncheck();
    await page.getByTestId("send-now").click();
    await page.getByRole("dialog", { name: "Send this email?" }).waitFor();
    const frame = page.frameLocator("[data-testid=send-preview-frame]");
    if ((await frame.locator("ul > li").count()) !== 3 || (await frame.locator("ol > li").count()) !== 1 || !(await frame.locator("strong").count()) || !(await frame.locator("em").count())) throw new Error("confirmation does not show the formatting");
    await page.screenshot({ path: path.join(OUT, "desktop-confirm-formatting.png") });
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const sent = await gsent();
    if (sent.length !== before + 1) throw new Error("not sent once");
    const last = sent[sent.length - 1];
    for (const t of ['<ul style="margin:0;padding-left:24px"><li>First item</li><li>Second item</li></ul>', "<strong>bold words</strong>", "<em>italic</em>", '<ol style="margin:0;padding-left:24px"><li>Typed number</li></ol>', '<a href="https://example.com/deck2">example.com/deck</a>'])
      if (!last.html.includes(t)) throw new Error(`HTML part is missing ${t}: ${last.html}`);
    if (last.html.includes("<p>")) throw new Error("HTML part has editor paragraphs");
    for (const t of ["Plain then bold words after.\r\n- First item\r\n- Second item\r\nMiddle line\r\n- Typed bullet\r\n1. Typed number\r\n", "italic see example.com/deck (https://example.com/deck2)"])
      if (!last.body.includes(t)) throw new Error(`text part is missing ${JSON.stringify(t)}: ${JSON.stringify(last.body)}`);
    const comm = await commByGmail(last.id);
    if (!String(comm.summary).includes("- First item")) throw new Error(`communication summary: ${comm.summary}`);
  });

  await step("Formatted message: Write with AI then Send now and Save to Gmail drafts both carry <ul><li> and '- '", async () => {
    const c = await morgan();
    await page.goto(`${BASE}/records/contacts/${c.id}`);
    await page.getByTestId("email-button").click();
    await page.getByTestId("compose-ai-line").fill("ask about off-market deals");
    await page.getByTestId("compose-ai-write").click();
    await page.getByTestId("compose-body").locator("ul > li").nth(1).waitFor({ timeout: 15000 });
    const draftsBefore = (await gdrafts()).length;
    await page.getByTestId("save-draft").click();
    await expectText(page, "Gmail draft created for");
    if ((await gdrafts()).length !== draftsBefore + 1) throw new Error("no draft");
    const d = await lastOf(gdrafts);
    if (!d.html.includes("<li>What you are seeing right now</li><li>Anyone I should talk to</li></ul>") || !d.body.includes("\r\n- What you are seeing right now\r\n- Anyone I should talk to\r\n")) throw new Error(`draft: ${JSON.stringify(d.body)} ${d.html}`);
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("compose-dialog").getByTestId("send-success").waitFor();
    const s2 = await lastOf(gsent);
    if (s2.html.replace(/gmail_signature[\s\S]*$/, "") !== d.html.replace(/gmail_signature[\s\S]*$/, "")) throw new Error("Send now and the Gmail draft differ");
    if (s2.body !== d.body) throw new Error("text parts differ");
  });

  await step("Formatted message: typing in the editor counts as unsaved (close asks, reload asks, Draft message link asks)", async () => {
    const c = await morgan();
    await page.goto(`${BASE}/records/contacts/${c.id}`);
    await page.getByTestId("email-button").click();
    await page.getByTestId("compose-body").click();
    await page.keyboard.type("Typed only");
    await page.keyboard.press("Escape");
    await page.getByTestId("compose-discard").waitFor();
    await page.getByRole("button", { name: "Discard email" }).click();
    {
      const probe = await ctx.newPage();
      await probe.goto(`${BASE}/records/contacts/${c.id}`);
      await probe.getByTestId("email-button").click();
      await probe.getByTestId("compose-body").click();
      await probe.keyboard.type("Typed only");
      let kind = null;
      probe.on("dialog", async (dlg) => {
        kind = dlg.type();
        await dlg.dismiss();
      });
      await probe.close({ runBeforeUnload: true });
      for (let i = 0; i < 40 && kind === null; i++) await new Promise((r) => setTimeout(r, 250));
      if (kind !== "beforeunload") throw new Error("no reload/close prompt after typing in the editor");
      if (!probe.isClosed()) await probe.close();
    }
    await page.goto(`${BASE}/people/outreach`);
    await page.getByRole("button", { name: "Draft message" }).first().click();
    const box = page.getByTestId("draft-body");
    await page.waitForFunction(() => (document.querySelector("[data-testid=draft-body]")?.innerText ?? "").includes("Hi "), null, { timeout: 15000 });
    await box.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Edited.");
    await page.locator("nav a[href='/']").first().click();
    await page.getByRole("dialog").filter({ hasText: "Leaving discards it" }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Stay on this page" }).click();
    if (!/\/people\/outreach/.test(page.url())) throw new Error("left the page with an edited draft");
  });

  await step("Phone: Write with AI shows bullets in the Message box; the confirmation shows them", async () => {
    const c = await morgan();
    await ph.goto(`${BASE}/records/contacts/${c.id}`);
    await ph.getByTestId("email-button").click();
    await ph.getByTestId("compose-ai-line").fill("ask about off-market deals");
    await ph.getByTestId("compose-ai-write").click();
    await ph.getByTestId("compose-body").locator("ul > li").nth(1).waitFor({ timeout: 15000 });
    await ph.getByTestId("compose-body").scrollIntoViewIfNeeded();
    await ph.screenshot({ path: path.join(OUT, "phone-compose-ai-draft.png") });
    const vw = await ph.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (vw[0] > vw[1]) throw new Error(`page scrolls sideways: ${vw}`);
    await ph.getByTestId("send-now").click();
    await ph.getByRole("dialog", { name: "Send this email?" }).waitFor();
    await ph.waitForTimeout(600);
    if ((await ph.frameLocator("[data-testid=send-preview-frame]").locator("ul > li").count()) !== 2) throw new Error("confirmation has no list");
    await ph.screenshot({ path: path.join(OUT, "phone-confirm-ai-draft.png") });
    await ph.getByTestId("send-edit").click();
    await ph.keyboard.press("Escape");
    await ph.getByRole("button", { name: "Discard email" }).click();
  });

  await e1280ctx.close();

  // ---------- Start an initiative, savings ideas, voice input, sample data, Reset (database update 0014) ----------
  // The AI stand-in on :54330 (dev-tools/mock-supabase.mjs) answers with the meal plan proposal and savings ideas.
  const AIMOCK = process.env.ANTHROPIC_API_MOCK_URL || "http://localhost:54330";
  const aipost = async (pathName, body = {}) => (await fetch(`${AIMOCK}${pathName}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const aicalls = async () => (await fetch(`${AIMOCK}/__calls`)).json();
  const cron = async (job) => (await fetch(`${BASE}/api/cron/${job}`, { headers: { Authorization: "Bearer test-cron-secret" } })).json();
  // A stand-in for the browser's speech recognition: "hears" one sentence, then stops.
  const FAKE_SPEECH = () => {
    class FakeRecognition {
      start() {
        window.__micStarts = (window.__micStarts || 0) + 1;
        setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "weekly meal plan, shop on Saturday and cook on Sunday" }], { isFinal: true })] }), 400);
        setTimeout(() => this.onend && this.onend(), 1500);
      }
      stop() { this.onend && this.onend(); }
      abort() {}
    }
    window.webkitSpeechRecognition = FakeRecognition;
    window.SpeechRecognition = FakeRecognition;
  };
  const d1280 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await d1280.addCookies([cookie]);
  const p1280 = await d1280.newPage();
  const VIEWS = [["desktop", page], ["desktop1280", p1280], ["phone", ph]];
  const shoot3 = async (url, name, prep) => {
    for (const [vp, pg_] of VIEWS) {
      await pg_.goto(url);
      await pg_.waitForLoadState("networkidle");
      if (prep) await prep(pg_);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-${name}.png`), fullPage: true });
    }
  };
  let mealInitiative = null;
  const sampleLike = () => one(`select (select count(*)::int from accounts where name like 'Sample %') sa,
      (select count(*)::int from transactions where merchant_name like 'Sample %') st,
      (select count(*)::int from recurring_series where merchant_name like 'Sample %') ss,
      (select count(*)::int from pipeline_items where name like 'Sample %') si,
      (select count(*)::int from tasks where title like 'Sample %') tasks`);
  let sampleBefore = null;

  await step("Start an initiative: box with a microphone on Plan, a button on Home; speech fills the box and never submits", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("link", { name: "Start an initiative" }).first().click();
    await page.getByTestId("setup-window").waitFor();
    await page.waitForURL(/[?&]w=setup$/);
    await expectText(page, "Step 1 of 8: Describe");
    await page.keyboard.press("Escape");
    await page.getByTestId("setup-window").waitFor({ state: "detached" });
    await page.goto(`${BASE}/plan`);
    await page.locator("#initiative-description").waitFor();
    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await vctx.addCookies([cookie]);
    await vctx.addInitScript(FAKE_SPEECH);
    const vp = await vctx.newPage();
    const draftsBefore = (await one("select count(*)::int n from initiative_drafts")).n;
    await vp.goto(`${BASE}/plan/start`);
    await vp.locator("#initiative-description").fill("Cut food spending.");
    await vp.getByTestId("mic-button").click();
    await vp.getByTestId("mic-listening").waitFor();
    await vp.screenshot({ path: path.join(OUT, "desktop-start-initiative-listening.png"), fullPage: true });
    await vp.waitForFunction(() => document.querySelector("#initiative-description").value.includes("cook on Sunday"));
    const v = await vp.inputValue("#initiative-description");
    if (v !== "Cut food spending. weekly meal plan, shop on Saturday and cook on Sunday") throw new Error(`speech text: ${v}`);
    await vp.waitForFunction(() => !document.querySelector("[data-testid=mic-listening]"));
    if (!/\/plan\/start$/.test(vp.url())) throw new Error("speech submitted the form");
    if ((await one("select count(*)::int n from initiative_drafts")).n !== draftsBefore) throw new Error("a draft was created by speech");
    // Chat input has the microphone too, and spoken words wait for Send.
    await vp.getByRole("button", { name: "Open AI chat" }).first().click();
    await vp.locator("textarea[aria-label='Message']").waitFor();
    await vp.locator("[aria-label^='Speak your message']").click();
    await vp.waitForFunction(() => document.querySelector("textarea[aria-label='Message']").value.includes("cook on Sunday"));
    if ((await aicalls()).filter((c) => c === "chat").length > 1) throw new Error("spoken chat text was sent");
    await vctx.close();
    // Without speech recognition (Firefox) the button is hidden.
    const nctx = await browser.newContext();
    await nctx.addCookies([cookie]);
    await nctx.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
    const np = await nctx.newPage();
    await np.goto(`${BASE}/plan/start`);
    await np.locator("#initiative-description").waitFor();
    if (await np.getByTestId("mic-button").count()) throw new Error("mic shown without speech recognition");
    await nctx.close();
    await shoot3(`${BASE}/plan/start`, "start-initiative-box", async (p_) => p_.locator("#initiative-description").fill("Weekly meal plan: shop once a week, cook Sunday for lunches and dinners, separate breakfast plan, cut food spending"));
  });

  await step("Start an initiative, step by step in the window: Draft the plan, Save moves on, jump to a step, Save for later, then approve the meal plan", async () => {
    await aipost("/__reset");
    const initsBefore = (await one("select count(*)::int n from initiatives")).n;
    await page.goto(`${BASE}/plan`);
    await page.getByRole("button", { name: "Use the meal plan example" }).click();
    await page.getByRole("button", { name: "Draft the plan" }).click();
    // The setup opens in the window over Plan, at Name and purpose, with its own address.
    await page.getByTestId("setup-body-name").waitFor({ timeout: 30000 });
    if (!/\/plan\?w=setup%2F[0-9a-f-]{36}%2Fname$/.test(page.url())) throw new Error(`setup address: ${page.url()}`);
    await page.getByTestId("setup-steps").waitFor();
    if ((await page.inputValue("#i-name")) !== "Weekly meal plan") throw new Error("name not drafted");
    if ((await one("select count(*)::int n from initiatives")).n !== initsBefore) throw new Error("records saved before approval");
    const draftId = page.url().match(/setup%2F([0-9a-f-]{36})/)[1];
    // Save moves to the next step.
    await page.getByTestId("setup-save").click();
    await page.getByTestId("setup-body-goals").waitFor();
    await expectText(page, "Step 3 of 8: Goals");
    for (const [vp, pg_] of VIEWS) {
      if (pg_ !== page) {
        await pg_.goto(page.url());
        await pg_.getByTestId("setup-body-goals").waitFor({ timeout: 20000 });
      }
      await pg_.waitForTimeout(300);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-window-setup-goals.png`) });
    }
    // A step's check: an empty goal title is refused with a plain message, and the step stays.
    const title = await page.inputValue("#g-title-0");
    await page.fill("#g-title-0", "");
    await page.getByTestId("setup-save").click();
    await page.getByTestId("setup-error").waitFor();
    if (!(await page.getByTestId("setup-error").innerText()).includes("Goal 1")) throw new Error("goal error not shown");
    await page.fill("#g-title-0", title);
    // Any step opens directly from the step bar.
    await page.getByTestId("setup-step-tasks").click();
    await page.getByTestId("setup-body-tasks").waitFor();
    // The second of two tasks starts collapsed: Edit opens it.
    await page.locator("[data-repeat-item]").nth(1).getByTestId("repeat-item-toggle").click();
    await page.locator("#t-title-1").fill("Cook lunches and dinners for the week");
    await page.getByTestId("setup-save").click();
    await page.getByTestId("setup-body-target").waitFor();
    // Browser Back goes back one step inside the window.
    await page.goBack();
    await page.getByTestId("setup-body-tasks").waitFor();
    if ((await page.inputValue("#t-title-1")) !== "Cook lunches and dinners for the week") throw new Error("edit lost on Back");
    // Save for later keeps the draft (Drafts waiting for review) and closes the window.
    await page.getByTestId("setup-save-later").click();
    await page.getByTestId("setup-window").waitFor({ state: "detached" });
    await page.getByTestId("page-flash").waitFor();
    if (new URL(page.url()).search) throw new Error(`window address left behind: ${page.url()}`);
    const saved = await one("select status, proposal from initiative_drafts where id = $1", [draftId]);
    if (saved.status !== "draft" || saved.proposal.proposal.recurring_tasks[1].title !== "Cook lunches and dinners for the week") throw new Error("draft not kept with the edit");
    // The full review page still shows every item (Open full page).
    for (const [vp, pg_] of VIEWS) {
      await pg_.goto(`${BASE}/plan/initiatives/drafts/${draftId}`);
      await pg_.getByTestId("approve-selected").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-initiative-review.png`), fullPage: true });
    }
    // The only checklist starts open with its 24 items.
    await expectText(page, "Grocery list");
    if ((await page.getByTestId("review-checklist-0").locator('input[aria-label^="Item "]').count()) !== 24) throw new Error("checklist does not show 24 items");
    await expectText(page, "Shop for the week's groceries");
    await expectText(page, "Breakfast plan (separate)");
    // Drafts waiting for review: the draft opens in the window; Review and approve; Approve selected.
    await page.goto(`${BASE}/plan/start`);
    await page.locator(`a[href="/plan/initiatives/drafts/${draftId}"]`).click();
    await page.getByTestId("draft-window").waitFor();
    await page.getByTestId("draft-continue").click();
    await page.getByTestId("setup-review").waitFor();
    await expectText(page, "Cook lunches and dinners for the week");
    await expectText(page, "Estimated monthly savings");
    await page.getByTestId("setup-approve").click();
    await page.getByTestId("summary-window").waitFor({ timeout: 30000 });
    await page.getByTestId("window-flash").waitFor();
    if (!(await page.getByTestId("window-flash").innerText()).includes("Approved and saved: Weekly meal plan")) throw new Error("approval message");
    if (!/w=r%2Finitiatives%2F/.test(page.url())) throw new Error(`after approval: ${page.url()}`);
    await expectText(page, "Weekly meal plan: menu and recipes");
    await page.getByTestId("quick-view-full-page").click();
    await page.waitForURL(/\/records\/initiatives\/[0-9a-f-]{36}$/);
    const init = await one("select i.*, p.name parent from initiatives i left join initiatives p on p.id = i.parent_initiative_id where i.id = (select result_initiative_id from initiative_drafts where status = 'approved' order by decided_at desc limit 1)");
    mealInitiative = init.id;
    if (init.parent !== "Personal Finance") throw new Error("not under Personal Finance");
    const c = await one(`select
      (select count(*)::int from goals where initiative_id = $1) goals,
      (select count(*)::int from milestones m join goals g on g.id = m.goal_id where g.initiative_id = $1) milestones,
      (select count(*)::int from milestone_options o join milestones m on m.id = o.milestone_id join goals g on g.id = m.goal_id where g.initiative_id = $1) options,
      (select count(*)::int from commitments c join milestones m on m.id = c.record_id join goals g on g.id = m.goal_id where g.initiative_id = $1) commitments,
      (select count(*)::int from task_templates where initiative_id = $1 and not is_commitment) templates,
      (select count(*)::int from task_templates where initiative_id = $1 and title = 'Cook lunches and dinners for the week') edited,
      (select count(*)::int from targets where initiative_id = $1 and count_source = 'manual') targets,
      (select count(*)::int from plan_documents where initiative_id = $1) plans,
      (select count(*)::int from checklists where initiative_id = $1 and reset_weekly and task_template_id is not null) checklists,
      (select count(*)::int from checklist_items i join checklists c on c.id = i.checklist_id where c.initiative_id = $1) items,
      (select count(*)::int from record_links where from_type = 'initiatives' and from_id = $1) links,
      (select count(*)::int from change_log where record_id = $1 and actor = 'ai') ai_logged`, [init.id]);
    const want = { goals: 1, milestones: 1, options: 3, commitments: 1, templates: 2, edited: 1, targets: 1, plans: 1, checklists: 1, items: 24, ai_logged: 1 };
    for (const [k, v] of Object.entries(want)) if (c[k] !== v) throw new Error(`${k}: ${c[k]} (expected ${v})`);
    if (c.links < 8) throw new Error(`links: ${c.links}`);
    const line = await one("select bl.target_monthly from budget_lines bl join categories c on c.id = bl.category_id where c.name = 'Groceries'");
    if (Number(line.target_monthly) !== 700) throw new Error("groceries budget target");
    if ((await one("select status from initiative_drafts order by created_at desc limit 1")).status !== "approved") throw new Error("draft not marked approved");
    await expectText(page, "Weekly meal plan: menu and recipes");
    await expectText(page, "0 of 24 checked");
  });

  await step("Repeated items: collapsed rows with Expand all, a 2-row grid when open, an item with an empty required field starts open, edits save", async () => {
    await page.goto(`${BASE}/plan`);
    await page.getByRole("button", { name: "Use the meal plan example" }).click();
    await page.getByRole("button", { name: "Draft the plan" }).click();
    await page.getByTestId("setup-body-name").waitFor({ timeout: 30000 });
    const draftId = page.url().match(/setup%2F([0-9a-f-]{36})/)[1];
    const stepUrl = (s) => `${BASE}/plan?w=setup%2F${draftId}%2F${s}`;
    await page.goto(stepUrl("milestones"));
    await page.getByTestId("setup-body-milestones").waitFor({ timeout: 20000 });
    const items = page.locator("[data-repeat-item]");
    const openCount = (p_) => p_.locator("[data-repeat-item][data-open]").count();
    // One milestone: it starts open. Added blank milestones start open (empty required fields).
    if ((await items.count()) !== 1 || (await openCount(page)) !== 1) throw new Error("a single milestone should start open");
    await page.getByTestId("add-milestone").click();
    await page.getByTestId("add-milestone").click();
    if ((await openCount(page)) !== 3) throw new Error("added blank milestones should start open");
    for (const [i, t, c] of [[1, "Shopping list made", "List saved in the app"], [2, "First Sunday cook done", "Cook task marked done"]]) {
      await page.fill(`#m-title-${i}`, t);
      await page.fill(`#m-test-${i}`, c);
    }
    // Filling the fields does not close an item while it is being edited.
    if ((await openCount(page)) !== 3) throw new Error("an item closed while typing");
    await page.getByTestId("setup-save").click();
    await page.getByTestId("setup-body-tasks").waitFor();
    const saved = await one("select proposal from initiative_drafts where id = $1", [draftId]);
    if (saved.proposal.proposal.milestones.length !== 3 || saved.proposal.proposal.milestones[2].title !== "First Sunday cook done") throw new Error("milestone edits not saved");
    // A new viewer (nothing remembered): 3 milestones show as collapsed rows with Expand all.
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c2.addCookies([cookie]);
    const p2 = await c2.newPage();
    await p2.goto(stepUrl("milestones"));
    await p2.getByTestId("setup-body-milestones").waitFor({ timeout: 20000 });
    const rows = p2.locator("[data-repeat-item]");
    if ((await rows.count()) !== 3) throw new Error("3 milestones expected");
    if (await openCount(p2)) throw new Error("rows should start collapsed when there are more than 2");
    await p2.getByTestId("expand-all").waitFor();
    const facts = await rows.nth(2).getByTestId("item-facts").innerText();
    for (const t of ["Due", "Goal", "Test", "Cook task marked done"]) if (!facts.includes(t)) throw new Error(`collapsed row has no "${t}": ${facts}`);
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: path.join(OUT, "desktop-setup-milestones-collapsed.png") });
    // Expand all opens every row; each open row is a 2-row grid: name, due date, goal; then test and options side by side.
    await p2.getByTestId("expand-all").click();
    if ((await openCount(p2)) !== 3) throw new Error("Expand all did not open every row");
    const box = async (sel) => (await p2.locator(sel).boundingBox());
    const [n, d, g, t, o] = await Promise.all(["#m-title-0", "#m-due-0", "#m-goal-0", "#m-test-0", "#m-opts-0"].map(box));
    if (Math.abs(n.y - d.y) > 2 || Math.abs(n.y - g.y) > 2 || !(n.x < d.x && d.x < g.x)) throw new Error("row 1 is not Milestone, Due date, Belongs to goal side by side");
    if (Math.abs(t.y - o.y) > 2 || !(t.x < o.x) || !(t.y > n.y + n.height)) throw new Error("row 2 is not the test and options side by side");
    if (t.width > o.width * 1.8 || t.width < o.width) throw new Error(`test and options widths ${t.width} ${o.width}`);
    await p2.getByTestId("collapse-all").click();
    if (await openCount(p2)) throw new Error("Collapse all did not close every row");
    await rows.nth(0).getByTestId("repeat-item-toggle").click();
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: path.join(OUT, "desktop-setup-milestones-expanded.png") });
    // The open state is remembered for this viewer.
    await p2.reload();
    await p2.getByTestId("setup-body-milestones").waitFor({ timeout: 20000 });
    await p2.waitForTimeout(300);
    if ((await openCount(p2)) !== 1 || !(await rows.nth(0).getAttribute("data-open") !== null)) throw new Error("open state not remembered");
    // An item with an empty required field starts open, even for a viewer who closed it.
    await rows.nth(0).getByTestId("repeat-item-toggle").click();
    await rows.nth(1).getByTestId("repeat-item-toggle").click();
    await p2.fill("#m-test-1", "");
    await rows.nth(1).getByTestId("repeat-item-toggle").click();
    await p2.getByTestId("setup-save-later").click();
    await p2.getByTestId("setup-window").waitFor({ state: "detached" });
    await p2.goto(stepUrl("milestones"));
    await p2.getByTestId("setup-body-milestones").waitFor({ timeout: 20000 });
    await p2.waitForTimeout(300);
    if ((await rows.nth(1).getAttribute("data-open")) === null) throw new Error("item with an empty required field should start open");
    if ((await openCount(p2)) !== 1) throw new Error("only the item with the empty field should be open");
    // Save refuses it with the plain message, and the item stays open.
    await p2.getByTestId("setup-save").click();
    await p2.getByTestId("setup-error").waitFor();
    if (!(await p2.getByTestId("setup-error").innerText()).includes("Milestone 2")) throw new Error("milestone error not shown");
    await p2.fill("#m-test-1", "List saved in the app");
    if ((await rows.nth(1).getAttribute("data-open")) === null) throw new Error("item closed once fixed");
    await p2.getByTestId("setup-save").click();
    await p2.getByTestId("setup-body-tasks").waitFor();
    // Phone: the fields of an open item stack in one column.
    const ph2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ph2.addCookies([cookie]);
    const pp = await ph2.newPage();
    await pp.goto(stepUrl("milestones"));
    await pp.getByTestId("setup-body-milestones").waitFor({ timeout: 20000 });
    await pp.getByTestId("expand-all").click();
    const [pn, pd] = [await pp.locator("#m-title-0").boundingBox(), await pp.locator("#m-due-0").boundingBox()];
    if (!(pd.y > pn.y + pn.height)) throw new Error("phone: fields should stack");
    await ph2.close();
    await p2.getByTestId("setup-step-review").click();
    await p2.getByTestId("setup-discard").click();
    await p2.getByTestId("setup-window").waitFor({ state: "detached" });
    await c2.close();
  });

  // ---------- Windows: summary, quick view, focused work windows; Add manually ----------
  const dialogs = (p_) => p_.locator("[role=dialog]").count();

  await step("Add manually: a small link under the Start an initiative box opens the same steps at Name and purpose (no AI); approve with only a name", async () => {
    for (const url of [`${BASE}/plan`, `${BASE}/plan/start`]) {
      await page.goto(url);
      const link = page.getByTestId("add-initiative-manually");
      await link.waitFor();
      if ((await link.getAttribute("href")) !== "/records/initiatives/new") throw new Error("Add manually has no full page fallback");
      if ((await link.innerText()).trim() !== "Add manually") throw new Error("link text");
    }
    await page.goto(`${BASE}/plan`);
    if (await page.locator("main h1 ~ * a, main a").filter({ hasText: /^Add initiative$/ }).count()) throw new Error("Add initiative button still shown");
    const calls = (await aicalls()).length;
    await page.getByTestId("add-initiative-manually").first().click();
    await page.getByTestId("setup-body-name").waitFor({ timeout: 20000 });
    if ((await aicalls()).length !== calls) throw new Error("Add manually called the AI");
    await page.fill("#i-name", "Morning walk");
    await page.getByTestId("setup-save").click();
    await page.getByTestId("setup-body-goals").waitFor();
    await expectText(page, "No goals yet");
    await page.getByTestId("setup-step-review").click();
    await page.getByTestId("setup-approve").click();
    await page.getByTestId("summary-window").waitFor({ timeout: 30000 });
    await expectText(page, "Morning walk");
    if (!(await one("select count(*)::int n from initiatives where name = 'Morning walk'")).n) throw new Error("initiative not created");
    await page.keyboard.press("Escape");
    await page.getByTestId("summary-window").waitFor({ state: "detached" });
  });

  await step("View summary on the review screen: large window; a line closes it and focuses that item's field", async () => {
    await page.goto(`${BASE}/plan`);
    await page.getByRole("button", { name: "Use the meal plan example" }).click();
    await page.getByRole("button", { name: "Draft the plan" }).click();
    await page.getByTestId("setup-body-name").waitFor({ timeout: 30000 });
    // "Open full page": the review page with every item.
    await page.locator("[data-url-window] [data-testid=quick-view-full-page]").click();
    await page.waitForURL(/\/plan\/initiatives\/drafts\/[0-9a-f-]{36}$/, { timeout: 30000 });
    await page.getByRole("button", { name: "View summary" }).click();
    const win = page.getByTestId("summary-window");
    await win.waitFor();
    for (const t of ["Estimated monthly savings", "Goals", "Milestones", "Recurring tasks", "Saturday", "Sunday", "Grocery list", "24 items", "Read full plan"]) {
      if (!(await win.innerText()).includes(t)) throw new Error(`summary has no "${t}"`);
    }
    const box = await win.boundingBox();
    if (box.width < 1440 * 0.8 || box.width > 1440 * 0.9) throw new Error(`window width ${box.width}`);
    if (box.height > 900 * 0.9 + 2) throw new Error(`window height ${box.height}`);
    for (const [vp, pg_] of VIEWS) {
      if (pg_ === page) continue;
      await pg_.goto(page.url());
      await pg_.getByRole("button", { name: "View summary" }).click();
      await pg_.getByTestId("summary-window").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-summary-review.png`) });
    }
    await page.screenshot({ path: path.join(OUT, "desktop-summary-review.png") });
    await win.locator('[data-summary-ref="t-title-1"]').click();
    await win.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "t-title-1");
    await page.getByRole("button", { name: "Discard this draft" }).click();
    await page.waitForLoadState("networkidle");
  });

  await step("View summary on an initiative page: lines open records in the same window with Back; Read full plan", async () => {
    if (!mealInitiative) throw new Error("no approved meal plan initiative");
    await page.goto(`${BASE}/records/initiatives/${mealInitiative}`);
    await page.getByRole("button", { name: "View summary" }).click();
    await page.getByTestId("summary-window").waitFor();
    if (!(await page.getByTestId("summary-content").innerText()).includes("Cook lunches and dinners for the week")) throw new Error("saved recurring task not listed");
    if (!/\?w=r%2Finitiatives%2F/.test(page.url())) throw new Error("View summary has no address");
    await page.locator('[data-summary-ref^="goals:"]').first().click();
    await page.getByTestId("goal-overview").waitFor();
    if ((await dialogs(page)) !== 1) throw new Error("a second window opened");
    await page.getByTestId("window-back").click();
    await page.getByTestId("summary-content").waitFor();
    await page.getByTestId("summary-read-plan").click();
    await page.getByTestId("plan-window").waitFor();
    await expectText(page, "Sunday");
    await page.keyboard.press("Escape");
    await page.getByTestId("plan-window").waitFor({ state: "detached" });
    if (!page.url().includes(`/records/initiatives/${mealInitiative}`)) throw new Error("left the initiative page");
  });

  await step("Quick view: a task link opens the window; record links inside open in the same window (Back); Open full page; never two windows", async () => {
    await page.goto(`${BASE}/`);
    await page.locator("main a[href^='/records/tasks/']").first().click();
    await page.getByTestId("quick-view-body").waitFor();
    if (!/next required action/i.test(await page.getByTestId("quick-view-body").innerText())) throw new Error("no Next required action card");
    if (new URL(page.url()).pathname !== "/") throw new Error("left Home");
    await page.screenshot({ path: path.join(OUT, "desktop-quick-view.png") });
    const inner = page.locator("[data-window-host] dd a[href^='/records/']").first();
    if (await inner.count()) {
      await inner.click();
      await page.getByTestId("window-back").waitFor();
      if ((await dialogs(page)) !== 1) throw new Error("a second window opened");
      await page.getByTestId("window-back").click();
    }
    const box = await page.locator("[data-window-host]").boundingBox();
    if (box.width > 960 + 2 || box.width < 1440 * 0.55) throw new Error(`quick view width ${box.width}`);
    await page.getByTestId("quick-view-full-page").click();
    await page.waitForURL(/\/records\/tasks\/[0-9a-f-]{36}$/);
    if (await dialogs(page)) throw new Error("window still open on the full page");
    // A modified click still goes to the full page in a new tab, not the window.
    await page.goto(`${BASE}/productivity/tasks`);
    const [tab] = await Promise.all([ctx.waitForEvent("page"), page.locator("main a[href^='/records/tasks/']").first().click({ modifiers: ["Control"] })]);
    await tab.close();
    if (await dialogs(page)) throw new Error("Ctrl-click opened the window");
  });

  await step("Daily close opens in the large window from Home and from the evening task; the full page stays at its address; links inside go to the full page (no window on a window)", async () => {
    await page.goto(`${BASE}/`);
    await page.locator("main").getByRole("button", { name: "Daily close", exact: true }).click();
    const win = page.getByTestId("work-window");
    await win.waitFor({ timeout: 20000 });
    await page.waitForURL(/\/accountability\/reviews\/[0-9a-f-]{36}/);
    const reviewUrl = page.url();
    const box = await win.boundingBox();
    if (box.width < 1440 * 0.8 || box.width > 1440 * 0.9) throw new Error(`window width ${box.width}`);
    await expectText(page, "Missed today: commitments and daily targets");
    await page.screenshot({ path: path.join(OUT, "desktop-daily-close-window.png") });
    await page.keyboard.press("Escape");
    await win.waitFor({ state: "detached" });
    await page.waitForURL(`${BASE}/`);
    const task = page.locator("main").getByRole("button", { name: "Complete the daily close" });
    if (await task.count()) {
      await task.first().click();
      await win.waitFor({ timeout: 20000 });
      await page.keyboard.press("Escape");
      await win.waitFor({ state: "detached" });
    }
    await page.goto(`${BASE}/accountability`);
    await page.getByRole("button", { name: "Weekly review" }).click();
    await win.waitFor({ timeout: 20000 });
    await expectText(page, "Next week's priorities");
    const link = win.locator("a[href^='/records/tasks/']").first();
    if (await link.count()) {
      await link.click();
      await page.waitForURL(/\/records\/tasks\//);
      if (await dialogs(page)) throw new Error("a window stayed or opened over the task page");
    } else await page.keyboard.press("Escape");
    // The address opens the full page (no window).
    await page.goto(reviewUrl);
    await expectText(page, "Your review");
    if (await page.getByTestId("work-window").count()) throw new Error("the address opened a window");
    if (!(await page.locator("main h1").innerText()).startsWith("Daily close")) throw new Error("full page title");
  });

  await step("Start an initiative: an invalid AI reply is retried once; a second invalid reply shows a plain message", async () => {
    await aipost("/__reset");
    await aipost("/__mode", { initiative: "invalid_once" });
    await page.goto(`${BASE}/plan/start`);
    await page.locator("#initiative-description").fill("Morning walk plan: walk 30 minutes before work.");
    await page.getByRole("button", { name: "Draft the plan" }).click();
    await page.getByTestId("setup-body-name").waitFor({ timeout: 30000 });
    if ((await aicalls()).filter((x) => x === "initiative_proposal").length !== 2) throw new Error("expected one retry");
    await page.getByTestId("setup-step-review").click();
    await page.getByTestId("setup-discard").click();
    await page.getByTestId("setup-window").waitFor({ state: "detached" });
    await aipost("/__mode", { initiative: "invalid" });
    await page.locator("#initiative-description").fill("Morning walk plan: walk 30 minutes before work.");
    await page.getByRole("button", { name: "Draft the plan" }).click();
    await expectText(page, "could not be used, even after one retry");
    await aipost("/__reset");
  });

  await step("Grocery checklist: check items, shown on the Saturday shop task, and reset when the weekly task is created", async () => {
    await page.goto(`${BASE}/records/initiatives/${mealInitiative}`);
    await page.getByTestId("checklist-item-toggle").nth(0).click();
    await expectText(page, "1 of 24 checked");
    await page.getByTestId("checklist-item-toggle").nth(1).click();
    await expectText(page, "2 of 24 checked");
    // Make the shop task due today (local test only) and pretend the list was last reset a week ago.
    const tpl = await one("select id from task_templates where initiative_id = $1 and title = 'Shop for the week''s groceries'", [mealInitiative]);
    await pg.query("update task_templates set weekday = extract(dow from (now() at time zone 'America/New_York'))::int where id = $1", [tpl.id]);
    await pg.query("update checklists set last_reset_on = (now() at time zone 'America/New_York')::date - 7 where task_template_id = $1", [tpl.id]);
    await cron("recurring-tasks");
    const task = await one("select id from tasks where template_id = $1", [tpl.id]);
    if (!task) throw new Error("shop task not created");
    if ((await one("select count(*)::int n from checklist_items i join checklists c on c.id = i.checklist_id where c.task_template_id = $1 and i.checked", [tpl.id])).n !== 0) throw new Error("items not unchecked");
    await page.goto(`${BASE}/records/tasks/${task.id}`);
    await expectText(page, "Grocery list");
    await expectText(page, "0 of 24 checked");
    await page.getByTestId("checklist-item-toggle").first().click();
    await expectText(page, "1 of 24 checked");
    // Created again the same day: no second reset.
    await cron("recurring-tasks");
    if ((await one("select count(*)::int n from checklist_items i join checklists c on c.id = i.checklist_id where c.task_template_id = $1 and i.checked", [tpl.id])).n !== 1) throw new Error("reset twice");
    await shoot3(`${BASE}/records/initiatives/${mealInitiative}`, "initiative-plan-checklist");
  });

  await step("Chat command: Start an initiative drafts the plan and opens the setup in the window", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Open AI chat" }).first().click();
    await page.fill("textarea[aria-label='Message']", "Start an initiative: weekly meal plan, shop once a week and cook on Sunday");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByTestId("chat-draft-link").click();
    // The setup opens in the window at Name and purpose; the chat closes so it never covers the window.
    await page.getByTestId("setup-body-name").waitFor({ timeout: 20000 });
    if (await page.locator("textarea[aria-label='Message']").count()) throw new Error("chat still open over the window");
    if ((await one("select source from initiative_drafts order by created_at desc limit 1")).source !== "chat") throw new Error("draft source");
    await page.getByTestId("setup-step-review").click();
    await page.getByTestId("setup-discard").click();
    await page.getByTestId("setup-window").waitFor({ state: "detached" });
  });

  // ---------- Windows with their own address (Build A) ----------
  const winBox = async (p_) => p_.locator("[data-url-window]").boundingBox();

  await step("Window address: an initiative from Plan opens its overview with its own address; Back closes it; Forward and reload open it again; Escape keeps the page and its scroll", async () => {
    await page.goto(`${BASE}/plan`);
    await page.evaluate(() => (window.__samePage = 1));
    const link = page.locator("main a[href^='/records/initiatives/']:not([href$='/new'])").last();
    await link.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => window.scrollY);
    await link.click();
    await page.getByTestId("summary-window").waitFor();
    await page.getByTestId("summary-content").waitFor();
    if (!/\/plan\?w=r%2Finitiatives%2F[0-9a-f-]{36}$/.test(page.url())) throw new Error(`address: ${page.url()}`);
    const box = await winBox(page);
    if (box.width < 1440 * 0.8 || box.width > 1440 * 0.9) throw new Error(`window width ${box.width}`);
    const winUrl = page.url();
    await page.goBack();
    await page.getByTestId("summary-window").waitFor({ state: "detached" });
    if (page.url() !== `${BASE}/plan`) throw new Error(`Back went to ${page.url()}`);
    await page.goForward();
    await page.getByTestId("summary-content").waitFor();
    if ((await page.evaluate(() => window.__samePage)) !== 1) throw new Error("the page reloaded");
    // Escape closes it and leaves the page exactly where it was.
    await page.keyboard.press("Escape");
    await page.getByTestId("summary-window").waitFor({ state: "detached" });
    if (page.url() !== `${BASE}/plan`) throw new Error(`Escape left ${page.url()}`);
    const y1 = await page.evaluate(() => window.scrollY);
    if (Math.abs(y1 - y0) > 2) throw new Error(`scroll moved from ${y0} to ${y1}`);
    if ((await page.evaluate(() => window.__samePage)) !== 1) throw new Error("the page reloaded");
    // A refresh or a bookmarked link opens the same window over the same page.
    for (const [vp, pg_] of VIEWS) {
      await pg_.goto(winUrl);
      await pg_.getByTestId("summary-content").waitFor({ timeout: 20000 });
      await pg_.waitForTimeout(300);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-window-initiative-overview.png`) });
    }
    if (!(await page.locator("main h1").count())) throw new Error("no page under the window");
    await page.reload();
    await page.getByTestId("summary-content").waitFor();
    await page.getByTestId("window-close").click();
    await page.getByTestId("summary-window").waitFor({ state: "detached" });
    if (page.url() !== `${BASE}/plan`) throw new Error(`Close after a reload left ${page.url()}`);
  });

  await step("Edit inside the window: collapsible sections (remembered per viewer, Expand all, Collapse all); closing with changes asks; Save returns to the overview with Saved", async () => {
    await page.goto(`${BASE}/people`);
    await page.locator("main a[href^='/records/contacts/']:not([href$='/new'])").first().click();
    await page.getByTestId("quick-view-body").waitFor();
    await page.getByTestId("window-edit").click();
    await page.getByTestId("edit-window").waitFor();
    await page.locator("[data-url-window] form[data-window-form]").waitFor({ timeout: 20000 });
    if (!/w=e%2Fcontacts%2F/.test(page.url())) throw new Error(`edit address: ${page.url()}`);
    const editUrl = page.url();
    const contactId = editUrl.match(/contacts%2F([0-9a-f-]{36})/)[1];
    const box = await winBox(page);
    if (box.width < 1440 * 0.8) throw new Error(`editor window is not large: ${box.width}`);
    const section = (name) => page.locator(`[data-url-window] [data-section="${name}"]`);
    if (await section("Name and contact details").isHidden()) throw new Error("first section closed");
    if (await section("Follow-up").isVisible()) throw new Error("Follow-up should start closed");
    await page.getByTestId("form-section-toggle").filter({ hasText: "Follow-up" }).click();
    await section("Follow-up").waitFor();
    await page.reload();
    await section("Follow-up").waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Collapse all" }).click();
    if (await section("Name and contact details").isVisible()) throw new Error("Collapse all left a section open");
    await page.getByRole("button", { name: "Expand all" }).click();
    await section("Notes").waitFor();
    for (const [vp, pg_] of VIEWS) {
      if (pg_ === page) continue;
      await pg_.goto(editUrl);
      await pg_.locator("[data-url-window] form[data-window-form]").waitFor({ timeout: 20000 });
      await pg_.waitForTimeout(300);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-window-edit.png`) });
    }
    await page.screenshot({ path: path.join(OUT, "desktop-window-edit.png") });
    const value = `Owner ${Date.now() % 100000}`;
    await page.locator("[data-url-window] input[name=title]").fill(value);
    await page.keyboard.press("Escape");
    await page.getByTestId("window-unsaved").waitFor();
    await page.getByTestId("window-unsaved-stay").click();
    if (!page.url().includes("w=e%2Fcontacts")) throw new Error("Keep editing closed the window");
    await page.locator("[data-url-window] [data-save-and-leave]").click();
    await page.getByTestId("quick-view-body").waitFor({ timeout: 20000 });
    await page.getByTestId("window-flash").waitFor();
    if (!(await page.getByTestId("window-flash").innerText()).includes("Saved")) throw new Error("no Saved note");
    if (!/w=r%2Fcontacts%2F/.test(page.url())) throw new Error(`after save: ${page.url()}`);
    if ((await one("select title from contacts where id = $1", [contactId])).title !== value) throw new Error("not saved");
    await expectText(page, value);
    await page.keyboard.press("Escape");
    await page.getByTestId("quick-view").waitFor({ state: "detached" });
    // The initiative overview has Edit too; Save returns to the overview.
    await page.goto(`${BASE}/plan`);
    await page.locator("main a[href^='/records/initiatives/']:not([href$='/new'])").first().click();
    await page.getByTestId("summary-content").waitFor();
    await page.getByTestId("window-edit").click();
    await page.locator("[data-url-window] textarea[name=description]").fill("Expense reduction, debt payoff, savings, and a weekly review.");
    await page.locator("[data-url-window] [data-save-and-leave]").click();
    await page.getByTestId("summary-content").waitFor({ timeout: 20000 });
    await expectText(page, "and a weekly review.");
    await page.keyboard.press("Escape");
  });

  await step("Work through tasks: today's tasks one at a time (3 of 12), Done, Move to tomorrow, Skip, linked record, end summary", async () => {
    await page.goto(`${BASE}/`);
    await page.getByTestId("work-through-tasks").first().click();
    await page.getByTestId("work-task").waitFor();
    if (!/\/\?w=work/.test(page.url())) throw new Error(`address: ${page.url()}`);
    const progress = async () => (await page.getByTestId("work-progress").innerText()).match(/(\d+) of (\d+)/);
    const [, first, total] = await progress();
    if (first !== "1" || Number(total) < 3) throw new Error(`progress ${first} of ${total}`);
    await page.getByTestId("work-task-title").waitFor();
    for (const [vp, pg_] of VIEWS) {
      if (pg_ !== page) {
        await pg_.goto(`${BASE}/?w=work`);
        await pg_.getByTestId("work-task-title").waitFor({ timeout: 20000 });
      }
      await pg_.waitForTimeout(300);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-window-work-tasks.png`) });
    }
    const t1 = (await page.getByTestId("work-task-title").innerText()).trim();
    await page.getByTestId("work-done").click();
    await page.waitForFunction(() => /^2 of/.test(document.querySelector("[data-testid=work-progress]")?.innerText ?? ""));
    if ((await one("select status from tasks where title = $1 order by updated_at desc limit 1", [t1])).status !== "done") throw new Error("Done did not save");
    // Move to tomorrow on the first regular task (a commitment keeps its date).
    let moved = false;
    for (let i = 0; i < Number(total) && !moved; i++) {
      if (await page.getByTestId("work-summary").count()) break;
      await page.getByTestId("work-task-title").waitFor();
      const tomorrow = page.getByTestId("work-tomorrow");
      if (await tomorrow.isEnabled()) {
        const title = (await page.getByTestId("work-task-title").innerText()).trim();
        await tomorrow.click();
        await page.waitForFunction((t) => (document.querySelector("[data-testid=work-task-title]")?.innerText ?? "").trim() !== t || !!document.querySelector("[data-testid=work-summary]"), title);
        const row = await one("select due_date::text d, (now() at time zone 'America/New_York')::date + 1 = due_date tomorrow from tasks where title = $1 order by updated_at desc limit 1", [title]);
        if (!row.tomorrow) throw new Error(`not moved to tomorrow: "${title}" ${row.d}`);
        moved = true;
      } else {
        // Skip, then wait for the next task to show (its buttons belong to the next task only after that).
        const skipped = (await page.getByTestId("work-task-title").innerText()).trim();
        await page.getByTestId("work-skip").click();
        await page.waitForFunction((t) => (document.querySelector("[data-testid=work-task-title]")?.innerText ?? "").trim() !== t || !!document.querySelector("[data-testid=work-summary]"), skipped);
        await page.waitForTimeout(200);
      }
    }
    if (!moved) throw new Error("no regular task to move");
    // The linked record opens in the same window, and Back returns to the task.
    const linked = page.getByTestId("work-linked-record");
    if (!(await page.getByTestId("work-summary").count()) && (await linked.count())) {
      const before = page.url();
      await linked.click();
      await page.getByTestId("window-back").waitFor();
      if ((await dialogs(page)) !== 1) throw new Error("a second window opened");
      await page.getByTestId("window-back").click();
      await page.getByTestId("work-task").waitFor();
      if (page.url() !== before) throw new Error("Back did not return to the task");
    }
    for (let i = 0; i < Number(total) + 2 && !(await page.getByTestId("work-summary").count()); i++) {
      await page.getByTestId("work-skip").click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId("work-summary").waitFor();
    const summary = await page.getByTestId("work-summary").innerText();
    if (!/Done\s*1/.test(summary) || !/Moved to tomorrow\s*1/.test(summary)) throw new Error(`summary: ${summary.slice(0, 120)}`);
    await page.getByTestId("work-close").click();
    await page.getByTestId("tasks-window").waitFor({ state: "detached" });
    // Productivity has the button too.
    await page.goto(`${BASE}/productivity`);
    await page.getByTestId("work-through-tasks").waitFor();
  });

  await step("Pipeline next actions: an item opens its overview in the window with Move to tomorrow, Log activity, and Move stage inside it", async () => {
    await page.goto(`${BASE}/productivity/pipeline-actions`);
    const item = await one("select id, name from pipeline_items where status = 'open' and next_action is not null and next_action_due is not null order by next_action_due limit 1");
    await page.locator(`main a[href="/records/pipeline_items/${item.id}"]`).first().click();
    await page.getByTestId("pipeline-overview").waitFor();
    if (!page.url().includes(`/productivity/pipeline-actions?w=r%2Fpipeline_items%2F${item.id}`)) throw new Error(`address: ${page.url()}`);
    const box = await winBox(page);
    if (box.width < 1440 * 0.8) throw new Error(`overview is not large: ${box.width}`);
    await page.screenshot({ path: path.join(OUT, "desktop-window-pipeline-item.png") });
    const comms = (await one("select count(*)::int n from communications where pipeline_item_id = $1", [item.id])).n;
    await page.locator("[data-testid=pipeline-log-activity] input").fill("Called the owner about timing");
    await page.getByTestId("pipeline-log").click();
    await expectText(page, "Activity logged.");
    if ((await one("select count(*)::int n from communications where pipeline_item_id = $1", [item.id])).n !== comms + 1) throw new Error("activity not saved");
    await page.getByTestId("pipeline-tomorrow").click();
    await page.waitForFunction(() => !document.querySelector("[data-testid=pipeline-tomorrow]")?.hasAttribute("disabled"));
    await page.waitForTimeout(500);
    if (!(await one("select (now() at time zone 'America/New_York')::date + 1 = next_action_due ok from pipeline_items where id = $1", [item.id])).ok) throw new Error("next action not moved to tomorrow");
    const stageBefore = (await one("select stage_id from pipeline_items where id = $1", [item.id])).stage_id;
    await page.getByTestId("pipeline-move").click();
    await page.waitForTimeout(1500);
    const stageAfter = (await one("select stage_id from pipeline_items where id = $1", [item.id])).stage_id;
    const refused = await page.locator("[data-url-window] [role=alert]").count();
    if (stageAfter === stageBefore && !refused) throw new Error("Move stage did nothing and said nothing");
    // The page underneath is reloaded once the window closes.
    await page.keyboard.press("Escape");
    await page.getByTestId("overview-window").waitFor({ state: "detached" });
    if (!page.url().endsWith("/productivity/pipeline-actions")) throw new Error(`closed to ${page.url()}`);
  });

  await step("Home: the morning plan shows only Top 3 and Watch (Show all for the rest); the runway card has the runway trend chart", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: /Rewrite plan|Write today's plan/ }).click();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("morning-plan").waitFor();
    const stored = (await one("select content from daily_plans where plan_date = (now() at time zone 'America/New_York')::date")).content;
    if (!stored.includes("**Top 3**") || !stored.includes("**Watch**") || /Also today|Daily targets/.test(stored)) throw new Error(`stored plan: ${stored.slice(0, 200)}`);
    const plan = await page.getByTestId("morning-plan").innerText();
    if (!plan.includes("Top 3") || !plan.includes("Watch")) throw new Error("plan sections");
    const more = page.getByTestId("morning-plan-more");
    if (await more.count()) {
      await more.locator("summary").click();
      await expectText(page, "Daily targets");
    }
    const chart = page.getByTestId("runway-chart");
    await chart.waitFor();
    if (!(await chart.locator("svg path.recharts-curve").count())) throw new Error("no runway line");
    await shoot3(`${BASE}/`, "home");
  });

  // ---------- Build B: AI visibility, suggestion lines, progressive disclosure, task filter, time blocks, scenario summary ----------
  const lastChat = async () => (await fetch(`${AIMOCK}/__last_chat`)).json();
  const itemId = async (name) => (await one("select id from pipeline_items where name = $1 limit 1", [name])).id;

  await step("Ask AI about this: a pipeline item window opens the chat inside the window about that record; the AI gets its fields; Escape closes the chat first", async () => {
    const id = await itemId("Demo HVAC Services Co");
    await page.goto(`${BASE}/opportunities?w=r/pipeline_items/${id}`);
    await page.getByTestId("pipeline-overview").waitFor();
    await page.locator("[data-url-window]").getByTestId("ask-ai").click();
    const chat = page.locator("[data-url-window] [data-testid=ai-chat]");
    await chat.waitFor();
    if (!(await page.getByTestId("ai-chat-context").innerText()).includes("Demo HVAC Services Co")) throw new Error("context chip");
    await chat.getByRole("button", { name: "What should I do next on this?" }).click();
    await chat.getByTestId("ai-chat-assistant").waitFor();
    const sent = await lastChat();
    if (!/Ask AI about this/.test(sent.system) || !sent.system.includes("Demo HVAC Services Co") || !/Fields:/.test(sent.system) || !sent.system.includes(`id "${id}"`)) throw new Error(`system prompt: ${String(sent.system).slice(-400)}`);
    if (!/proposal Bram approves/.test(sent.system)) throw new Error("proposal rule missing");
    await page.screenshot({ path: path.join(OUT, "desktop-window-ask-ai.png") });
    await page.keyboard.press("Escape");
    await chat.waitFor({ state: "detached" });
    if (!(await page.getByTestId("pipeline-overview").isVisible())) throw new Error("Escape closed the window too");
    await page.keyboard.press("Escape");
    await page.getByTestId("overview-window").waitFor({ state: "detached" });
    // Page header: the chat is about the page.
    await page.goto(`${BASE}/plan/inputs`);
    await page.getByTestId("ask-ai").first().click();
    if (!(await page.getByTestId("ai-chat-context").innerText()).includes("Inputs and Assumptions")) throw new Error("page context");
    await page.getByTestId("ai-chat-close").click();
  });

  await step("Suggestion line: a quiet pipeline item shows one line with Suggest a next step (AI only on click); a dismissed line stays hidden", async () => {
    const stalled = await one("select id, name from pipeline_items where status = 'open' and name = 'Demo Pest Control' limit 1");
    await page.goto(`${BASE}/opportunities?w=r/pipeline_items/${stalled.id}`);
    await page.getByTestId("pipeline-overview").waitFor();
    const line = page.locator("[data-url-window] [data-testid=suggestion-line]");
    await line.waitFor();
    if (!/No activity in \d+ days\. Suggested next step:/.test(await line.innerText())) throw new Error(`line: ${await line.innerText()}`);
    if ((await page.locator("[data-url-window] [data-testid=suggestion-line]").count()) !== 1) throw new Error("more than one line");
    await page.screenshot({ path: path.join(OUT, "desktop-window-suggestion.png") });
    const before = (await aicalls()).filter((c) => c === "chat").length;
    await line.getByTestId("suggestion-ai").click();
    await page.locator("[data-url-window] [data-testid=ai-chat-assistant]").waitFor();
    if ((await aicalls()).filter((c) => c === "chat").length !== before + 1) throw new Error("expected one AI call on click");
    if (!(await lastChat()).messages.some((m) => JSON.stringify(m).includes("Suggest one next step"))) throw new Error("prompt not sent");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Dismiss: hidden at once and after a reload; other pages keep their own line.
    await page.goto(`${BASE}/`);
    const home = page.getByTestId("suggestion-line");
    await home.waitFor();
    const key = await home.getAttribute("data-key");
    await home.getByTestId("suggestion-dismiss").click();
    await home.waitFor({ state: "detached" });
    await page.reload();
    await page.getByTestId("home-start-initiative").waitFor();
    if (await page.locator(`[data-testid=suggestion-line][data-key="${key}"]`).count()) throw new Error("dismissed line came back");
    await page.goto(`${BASE}/opportunities?w=r/pipeline_items/${stalled.id}`);
    await page.locator("[data-url-window] [data-testid=suggestion-line]").waitFor();
  });

  await step("Inputs and Assumptions: cards collapse with a one-line summary; Collapse all and Expand all; the choice is remembered", async () => {
    await page.goto(`${BASE}/plan/inputs`);
    const cards = page.getByTestId("inputs-card");
    const n = await cards.count();
    if (n < 5) throw new Error(`cards: ${n}`);
    if ((await page.locator("[data-testid=inputs-card][data-open]").count()) !== 1) throw new Error("only the first card should start open");
    await page.getByTestId("collapse-all").click();
    if (await page.locator("[data-testid=inputs-card][data-open]").count()) throw new Error("Collapse all left one open");
    if (!/Runway target: \d+ months/.test(await cards.first().getByTestId("collapsible-summary").innerText())) throw new Error("summary line");
    await page.reload();
    await cards.first().waitFor();
    await page.waitForTimeout(300);
    if (await page.locator("[data-testid=inputs-card][data-open]").count()) throw new Error("collapsed state not remembered");
    for (const [vp, pg_] of VIEWS) {
      await pg_.goto(`${BASE}/plan/inputs`);
      await pg_.getByTestId("collapse-all").click();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-inputs-collapsed.png`), fullPage: true });
    }
    await page.getByTestId("expand-all").click();
    if ((await page.locator("[data-testid=inputs-card][data-open]").count()) !== n) throw new Error("Expand all");
    // One card opens alone.
    await page.getByTestId("collapse-all").click();
    await cards.nth(1).getByTestId("collapsible-toggle").click();
    if ((await page.locator("[data-testid=inputs-card][data-open]").count()) !== 1) throw new Error("toggle one card");
  });

  await step("Task filter: one Filter button opens 3 columns of checkboxes; Apply sets the address; labels remove one filter; Back keeps filters; Clear all", async () => {
    await page.goto(`${BASE}/productivity/tasks`);
    await page.getByTestId("filter-button").click();
    const pop = page.getByTestId("filter-popover");
    await pop.waitFor();
    if ((await pop.locator("fieldset").count()) < 4) throw new Error("columns");
    for (const [vp, pg_] of VIEWS) {
      if (pg_ !== page) {
        await pg_.goto(`${BASE}/productivity/tasks`);
        await pg_.getByTestId("filter-button").click();
        await pg_.getByTestId("filter-popover").waitFor();
      }
      await pg_.screenshot({ path: path.join(OUT, `${vp}-task-filter-popover.png`), fullPage: vp !== "phone" });
    }
    await page.getByTestId("filter-due-today").check();
    await page.getByTestId("filter-priority-1").check();
    await page.getByTestId("filter-apply").click();
    await page.waitForURL(/due=today&priority=1|priority=1.*due=today|due=today.*priority=1/);
    const labels = async () => (await page.getByTestId("filter-label").allInnerTexts()).map((t) => t.trim());
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=filter-label]").length === 3);
    if ((await labels()).join("|") !== "To do|Due today|High priority") throw new Error(`labels: ${(await labels()).join("|")}`);
    const rows = await page.locator("[data-testid=task-table] tbody tr").allInnerTexts();
    if (!rows.length || rows.some((r) => !/Due today/.test(r) || !/High/.test(r))) throw new Error(`rows: ${rows.slice(0, 3).join(" / ")}`);
    await page.getByTestId("filter-label").filter({ hasText: "High priority" }).click();
    await page.waitForURL((u) => !u.search.includes("priority"));
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=filter-label]").length === 2);
    await page.goBack();
    await page.waitForURL(/priority=1/);
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=filter-label]").length === 3);
    await page.getByTestId("filter-button").click();
    if (!(await page.getByTestId("filter-due-today").isChecked())) throw new Error("popover does not show the active filters");
    await page.getByTestId("filter-clear").click();
    await page.getByTestId("filter-apply").click();
    await page.waitForURL(/status=all/);
    if (await page.getByTestId("filter-label").count()) throw new Error("labels after Clear all");
    // Older links still work.
    await page.goto(`${BASE}/productivity/tasks?status=done&due=all`);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=filter-label]")].map((e) => e.textContent.trim()).join("|") === "Done");
  });

  await step("Time blocks: the morning job only suggests; Approve adds one Google Calendar event (stand-in); Delete removes a suggestion for the day; Home notice", async () => {
    const eventsBefore = (await (await fetch(`${GMOCK}/__events`)).json()).length;
    await fetch(`${BASE}/api/cron/morning`, { headers: { Authorization: "Bearer test-cron-secret" } });
    const rows = await pg.query("select id, title, google_event_id, dedupe_key from calendar_events where kind = 'time_block' and dedupe_key like 'suggest:%'");
    if (rows.rows.length < 2) throw new Error(`suggestions: ${rows.rows.length}`);
    if (rows.rows.some((r) => r.google_event_id)) throw new Error("a suggestion has a Google event");
    const evNow = await (await fetch(`${GMOCK}/__events`)).json();
    if (evNow.slice(eventsBefore).some((e) => /^Focus:/.test(e.summary))) throw new Error("the morning job sent a time block to Google");
    await page.goto(`${BASE}/`);
    await page.getByTestId("home-time-blocks").waitFor();
    if (!/\d+ time blocks? suggested/.test(await page.getByTestId("home-time-blocks").innerText())) throw new Error("Home notice");
    await page.getByTestId("home-time-blocks").click();
    await page.waitForURL(/\/productivity\/calendar/);
    await expectText(page, "Approve the ones you want; only approved blocks go to Google Calendar.");
    if (await page.getByRole("button", { name: /Add today's time blocks now/ }).count()) throw new Error("old button still shown");
    await page.getByTestId("add-block-manually").waitFor();
    const list = page.getByTestId("time-block-row");
    const n = await list.count();
    for (const [vp, pg_] of VIEWS) {
      if (pg_ !== page) await pg_.goto(`${BASE}/productivity/calendar`);
      await pg_.getByTestId("time-block-suggestions").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${vp}-time-block-suggestions.png`), fullPage: true });
    }
    // Edit the first: 2:30 PM for 30 minutes.
    await list.first().getByTestId("time-block-edit").click();
    await page.getByTestId("time-block-edit-row").locator('input[type="time"]').fill("14:30");
    await page.getByTestId("time-block-edit-row").locator("select").selectOption("30");
    await page.getByTestId("time-block-save").click();
    await page.waitForFunction(() => /2:30 PM \(30 min\)/.test(document.querySelector("[data-testid=time-block-suggestions]")?.innerText ?? ""));
    // Approve it: one event in Google, the row is approved.
    const first = page.getByTestId("time-block-row").filter({ hasText: "2:30 PM" });
    const title = (await first.getByTestId("time-block-title").innerText()).trim();
    await first.getByTestId("time-block-approve").click();
    await page.waitForFunction((n0) => document.querySelectorAll("[data-testid=time-block-row]").length === n0 - 1, n);
    const ev = await (await fetch(`${GMOCK}/__events`)).json();
    const added = ev.slice(evNow.length).filter((e) => /^Focus:/.test(e.summary));
    const at = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    if (added.length !== 1 || !added[0].summary.includes(title) || at(added[0].start) !== "2:30 PM" || at(added[0].end) !== "3:00 PM") throw new Error(`events: ${JSON.stringify(added)}`);
    await page.getByTestId("time-blocks-added").waitFor();
    // Delete the next suggestion: gone, and Suggest blocks now does not bring it back today.
    const second = page.getByTestId("time-block-row").first();
    const delTitle = (await second.getByTestId("time-block-title").innerText()).trim();
    await second.getByTestId("time-block-delete").click();
    await page.waitForFunction((t) => ![...document.querySelectorAll("[data-testid=time-block-row]")].some((r) => r.innerText.includes(t)), delTitle);
    await page.getByTestId("suggest-blocks").click();
    await page.waitForTimeout(1500);
    if ((await page.locator("[data-testid=time-block-row]").allInnerTexts()).some((t) => t.includes(delTitle))) throw new Error("deleted suggestion came back");
    const evEnd = await (await fetch(`${GMOCK}/__events`)).json();
    if (evEnd.length !== ev.length) throw new Error("Suggest blocks now sent events to Google");
  });

  await step("Scenario summary: View summary opens a large window with 3 columns and charts; lines drill down (input quick view with Back, page sections); comparison too", async () => {
    const sc = await pg.query("select id from scenarios order by created_at limit 2");
    const [a, b2] = sc.rows.map((r) => r.id);
    await page.goto(`${BASE}/plan/scenarios/${a}`);
    await page.getByTestId("scenario-view-summary").first().click();
    const win = page.getByTestId("scenario-summary-window");
    await win.getByTestId("scenario-summary").waitFor();
    if (!page.url().includes("w=ss%2F") && !page.url().includes("w=ss/")) throw new Error(`address: ${page.url()}`);
    for (const t of ["summary-changed", "summary-results", "summary-savings", "summary-paths"]) await win.getByTestId(t).waitFor();
    if ((await win.locator(".recharts-surface").count()) < 2) throw new Error("charts");
    await expectText(page, "Cash at 12 months");
    for (const [vp, pg_] of VIEWS) {
      if (pg_ !== page) {
        await pg_.goto(`${BASE}/plan/scenarios/${a}?w=ss/${a}`);
        await pg_.getByTestId("scenario-summary").waitFor();
      }
      await pg_.waitForTimeout(400);
      await pg_.screenshot({ path: path.join(OUT, `${vp}-window-scenario-summary.png`) });
    }
    const inputLine = win.getByTestId("summary-changed").locator("button[data-testid=summary-line]").first();
    if (await inputLine.count()) {
      await inputLine.click();
      await page.getByTestId("quick-view").waitFor();
      await page.getByTestId("window-back").click();
      await page.getByTestId("scenario-summary").waitFor();
    }
    await win.getByTestId("summary-paths").getByTestId("summary-line").first().click();
    await page.waitForURL(/#job-vs-acquisition/);
    await page.getByTestId("scenario-summary-window").waitFor({ state: "detached" });
    // The comparison.
    await page.goto(`${BASE}/plan/scenarios/compare?ids=${a},${b2}`);
    await page.getByTestId("scenario-view-summary").click();
    await page.getByTestId("scenario-summary").waitFor();
    const head = await page.getByTestId("summary-results").innerText();
    if (!/now/i.test(head) || (await page.getByTestId("summary-results").locator("[data-testid=summary-line]").first().locator("span").count()) !== 4) throw new Error("columns");
    await page.screenshot({ path: path.join(OUT, "desktop-window-scenario-compare-summary.png") });
  });

  // ---------- Deal funnel (database update 0016) ----------
  const acqPipe = (await one("select id from pipelines where kind = 'acquisition' order by sort_order limit 1")).id;
  const NY_TODAY = "(now() at time zone 'America/New_York')::date";
  const listingsTotal = async () => (await one(`select coalesce(sum(e.count), 0)::int n from target_entries e join targets t on t.id = e.target_id where t.name = 'Listings screened' and e.entry_date = ${NY_TODAY}`)).n;
  // The big number on a target card ("7 of 20"), read from the page.
  const cardCount = async (name) => {
    const card = page.locator("[data-testid=target-card]", { has: page.locator("h3", { hasText: new RegExp(`^${name}`) }) });
    const text = await card.getByTestId("target-today").innerText();
    const m = text.match(/(\d+)\s*of\s*(\d+)/);
    if (!m) throw new Error(`${name}: no count in "${text}"`);
    return Number(m[1]);
  };
  const waitFor = async (fn, want, label) => {
    for (let i = 0; i < 40; i++) {
      if ((await fn()) === want) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`${label}: expected ${want}, found ${await fn()}`);
  };
  const clickCount = async (scope, name) => {
    await scope.getByRole("button", { name: new RegExp(`^${name.replace("+", "\\+")} `) }).first().click();
  };
  // Opens a deal's window on the Acquisitions page.
  const openDeal = async (name) => {
    const item = await one("select id from pipeline_items where name = $1", [name]);
    await page.goto(`${BASE}/opportunities/${acqPipe}?w=r%2Fpipeline_items%2F${item.id}`);
    await page.getByTestId("pipeline-overview").waitFor();
    return item.id;
  };
  const closeWindow = async () => {
    await page.keyboard.press("Escape");
    await page.getByTestId("overview-window").waitFor({ state: "detached" });
    await page.waitForLoadState("networkidle");
  };
  const moveTo = async (name, stage) => {
    const id = await openDeal(name);
    const sel = page.getByTestId("pipeline-move-stage").getByLabel("Stage");
    await sel.selectOption({ label: stage });
    await page.getByTestId("pipeline-move").click();
    for (let i = 0; i < 40; i++) {
      const r = await one("select s.name from pipeline_items i join pipeline_stages s on s.id = i.stage_id where i.id = $1", [id]);
      if (r.name === stage) break;
      await page.waitForTimeout(250);
    }
    await closeWindow();
  };

  await step("Listings screened: +1, +5, and Undo last on the target card (note saved), the Acquisitions header, Home, and Productivity", async () => {
    await page.goto(`${BASE}/accountability/targets`);
    const start = await listingsTotal();
    if ((await cardCount("Listings screened")) !== start) throw new Error("card count differs from the entries");
    const card = page.locator("[data-testid=target-card]", { has: page.locator("h3", { hasText: /^Listings screened/ }) });
    await card.getByLabel("Note (optional)").fill("BizBuySell HVAC listings in Georgia");
    await clickCount(card, "Add 5");
    await waitFor(listingsTotal, start + 5, "after +5");
    await waitFor(() => cardCount("Listings screened"), start + 5, "card after +5");
    const note = await one("select note, count from target_entries order by created_at desc limit 1");
    if (note.note !== "BizBuySell HVAC listings in Georgia" || note.count !== 5) throw new Error(`entry: ${JSON.stringify(note)}`);
    await clickCount(card, "Add 1");
    await waitFor(() => cardCount("Listings screened"), start + 6, "card after +1");
    await card.getByRole("button", { name: /^Undo last entry/ }).click();
    await waitFor(() => cardCount("Listings screened"), start + 5, "card after Undo last (removes the +1 only)");
    await page.screenshot({ path: path.join(OUT, "flow-listings-target.png"), fullPage: false });

    // Acquisitions page header
    await page.goto(`${BASE}/opportunities/${acqPipe}`);
    const header = page.getByTestId("header-listings");
    const headerCount = async () => Number((await page.getByTestId("header-listings-count").innerText()).match(/^(\d+)/)[1]);
    if ((await headerCount()) !== start + 5) throw new Error(`header shows ${await headerCount()}`);
    await clickCount(header, "Add 1");
    await waitFor(headerCount, start + 6, "header after +1");
    await clickCount(header, "Add 5");
    await waitFor(headerCount, start + 11, "header after +5");
    await header.getByRole("button", { name: /^Undo last entry/ }).click();
    await waitFor(headerCount, start + 6, "header after Undo last");

    // Home tile
    await page.goto(`${BASE}/`);
    const tile = page.getByTestId("home-listings");
    const tileCount = async () => Number((await tile.innerText()).match(/(\d+) of 20/)[1]);
    if ((await tileCount()) !== start + 6) throw new Error(`Home shows ${await tileCount()}`);
    await clickCount(tile, "Add 5");
    await waitFor(tileCount, start + 11, "Home after +5");
    await tile.getByRole("button", { name: /^Undo last entry/ }).click();
    await waitFor(tileCount, start + 6, "Home after Undo last");

    // Productivity counters
    await page.goto(`${BASE}/productivity`);
    const counter = page.locator("div.rounded-lg", { has: page.getByRole("link", { name: "Listings screened" }) }).last();
    await clickCount(counter, "Add 1");
    await waitFor(listingsTotal, start + 7, "Productivity after +1");
    await counter.getByRole("button", { name: /^Undo last entry/ }).click();
    await waitFor(listingsTotal, start + 6, "Productivity after Undo last");
  });

  await step("CIMs reviewed: a deal moved past CIM reviewed counts today, once (moving back and forward again does not count twice)", async () => {
    await page.goto(`${BASE}/accountability/targets`);
    const before = await cardCount("CIMs reviewed");
    // Demo Machine Shop is in Screened: moving it straight to CIM reviewed skips NDA signed and still counts.
    await moveTo("Demo Machine Shop", "CIM reviewed");
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`after the move: ${await cardCount("CIMs reviewed")}, expected ${before + 1}`);
    await moveTo("Demo Machine Shop", "NDA signed");
    await moveTo("Demo Machine Shop", "CIM reviewed");
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`counted twice: ${await cardCount("CIMs reviewed")}`);
    // A new deal added at CIM reviewed is not a move: it does not count.
    await page.goto(`${BASE}/records/pipeline_items/new?pipeline_id=${acqPipe}&stage_id=${(await one("select id from pipeline_stages where pipeline_id = $1 and name = 'CIM reviewed'", [acqPipe])).id}`);
    await page.locator('input[name="name"]').fill("Demo Added At CIM Co");
    await page.locator('input[name="next_action"]').fill("Enter revenue, EBITDA, asking price");
    if (await page.locator('input[name="next_action_due"]').count()) await page.locator('input[name="next_action_due"]').fill(nyDate(2));
    await page.locator('select[name="deal_source_type"]').selectOption("brokered");
    await page.locator("form button[type=submit]").filter({ hasText: /^(Save|Create|Add)/ }).first().click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}/);
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`a deal added at CIM reviewed was counted: ${await cardCount("CIMs reviewed")}`);
  });

  await step("Broker or owner calls: a call logged on an acquisition deal counts this week; a second call on the same deal the same day and an email do not", async () => {
    await page.goto(`${BASE}/accountability/targets`);
    const before = await cardCount("Broker or owner calls");
    const log = async (method, text) => {
      await page.getByTestId("pipeline-log-activity").getByLabel("How").selectOption(method);
      await page.locator("[data-testid=pipeline-log-activity] input").fill(text);
      await page.getByTestId("pipeline-log").click();
      await expectText(page, "Activity logged.");
      await page.waitForTimeout(300);
    };
    await openDeal("Demo Plumbing Supply");
    await log("call", "Called the owner about timing and price");
    await log("call", "Second call the same day");
    await log("email", "Sent the NDA");
    await closeWindow();
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("Broker or owner calls")) !== before + 1) throw new Error(`calls this week: ${await cardCount("Broker or owner calls")}, expected ${before + 1}`);
    await openDeal("Demo Bookkeeping Firm");
    await log("meeting", "Met the broker");
    await closeWindow();
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("Broker or owner calls")) !== before + 2) throw new Error(`a meeting on another deal did not count`);
  });

  await step("Funnel card: counts match the records for 30 and 90 days, with percent of the previous step and the proprietary and brokered split", async () => {
    const expected = async (days) => {
      const from = `${NY_TODAY} - ${days - 1}`;
      const reached = async (stage) =>
        (await one(
          `with h as (select sh.item_id, sh.entered_at, s.position, s.outcome, sh.entered_at = pi.created_at creation
                       from stage_history sh join pipeline_items pi on pi.id = sh.item_id join pipeline_stages s on s.id = sh.stage_id where pi.pipeline_id = $1),
                th as (select position from pipeline_stages where pipeline_id = $1 and name = $2),
                skip as (select item_id from h, th where h.creation and h.position >= th.position and h.outcome <> 'lost'),
                first as (select item_id, min(entered_at) at from h, th where not h.creation and h.position >= th.position and h.outcome <> 'lost'
                          and item_id not in (select item_id from skip) group by item_id)
           select count(*)::int n from first where (at at time zone 'America/New_York')::date >= ${from}`,
          [acqPipe, stage],
        )).n;
      return {
        listings: (await one(`select coalesce(sum(e.count), 0)::int n from target_entries e join targets t on t.id = e.target_id where t.name = 'Listings screened' and e.entry_date >= ${from}`)).n,
        sourced: (await one(`select count(*)::int n from pipeline_items where pipeline_id = $1 and (created_at at time zone 'America/New_York')::date >= ${from}`, [acqPipe])).n,
        ndas: await reached("NDA signed"),
        cims: await reached("CIM reviewed"),
        calls: (await one(
          `select count(distinct (c.pipeline_item_id, (c.occurred_at at time zone 'America/New_York')::date))::int n from communications c join pipeline_items i on i.id = c.pipeline_item_id
           where i.pipeline_id = $1 and c.method in ('call', 'meeting', 'video') and (c.occurred_at at time zone 'America/New_York')::date >= ${from}`,
          [acqPipe],
        )).n,
        lois: await reached("LOI signed"),
      };
    };
    for (const days of [30, 90]) {
      await page.goto(`${BASE}/opportunities/${acqPipe}${days === 90 ? "?funnel=90" : ""}`);
      await expectText(page, `Deal funnel, last ${days} days`);
      const want = await expected(days);
      const shown = {};
      for (const k of Object.keys(want)) shown[k] = Number((await page.getByTestId(`funnel-${k}`).getByTestId("funnel-count").innerText()).trim());
      if (JSON.stringify(shown) !== JSON.stringify(want)) throw new Error(`${days} days: shown ${JSON.stringify(shown)}, records ${JSON.stringify(want)}`);
      if (!want.cims || !want.calls || !want.listings) throw new Error(`expected some CIMs, calls, and listings: ${JSON.stringify(want)}`);
      const pct = want.listings ? `${Math.round((want.sourced / want.listings) * 100)}% of previous` : "No previous step count";
      if (!(await page.getByTestId("funnel-sourced").innerText()).includes(pct)) throw new Error(`sourced percent: ${await page.getByTestId("funnel-sourced").innerText()}`);
      const split = await one(
        `select count(*) filter (where deal_source_type = 'proprietary')::int p, count(*) filter (where deal_source_type = 'brokered')::int b from pipeline_items
         where pipeline_id = $1 and (created_at at time zone 'America/New_York')::date >= ${`${NY_TODAY} - ${days - 1}`}`,
        [acqPipe],
      );
      if (!(await page.getByTestId("funnel-sourced").innerText()).includes(`${split.p} proprietary, ${split.b} brokered`)) throw new Error("sourced split");
    }
    // The 90 day choice is kept when switching to the board.
    await page.getByRole("link", { name: "Board" }).click();
    await page.waitForURL(/funnel=90/);
    await expectText(page, "Deal funnel, last 90 days");
  });

  await step("Suggested targets: one line on the funnel card and on Targets, computed from the Inputs (search hours changed in Plan, Inputs)", async () => {
    const line2 = "With 2 hours a day: screen 17 listings, reply to 4, review 1 CIM, 2 calls a week.";
    await page.goto(`${BASE}/opportunities/${acqPipe}`);
    if (!(await page.getByTestId("suggested-targets").innerText()).includes(line2)) throw new Error(`funnel line: ${await page.getByTestId("suggested-targets").innerText()}`);
    await expectText(page, "Your current targets take about 2 hours 22 minutes a day, 22 minutes more than the time set.");
    await page.goto(`${BASE}/accountability/targets`);
    if (!(await page.getByTestId("suggested-targets").innerText()).includes(line2)) throw new Error("Targets page line");
    // Change the hours in Plan, Inputs (the input's own record form) and check the line follows.
    const input = await one("select id from inputs where key = 'search_hours_per_day'");
    await page.goto(`${BASE}/records/inputs/${input.id}?edit=1`);
    await page.locator('input[name="value_number"]').fill("4");
    await page.locator("form button[type=submit]").filter({ hasText: /^Save/ }).first().click();
    await page.waitForLoadState("networkidle");
    await waitFor(async () => Number((await one("select value_number from inputs where key = 'search_hours_per_day'")).value_number), 4, "hours saved");
    await page.goto(`${BASE}/opportunities/${acqPipe}`);
    if (!(await page.getByTestId("suggested-targets").innerText()).includes("With 4 hours a day: screen 34 listings, reply to 8, review 2 CIMs, 3 calls a week.")) {
      throw new Error(`after 4 hours: ${await page.getByTestId("suggested-targets").innerText()}`);
    }
    await page.screenshot({ path: path.join(OUT, "flow-funnel-suggested.png"), fullPage: false });
    await pg.query("update inputs set value_number = 2 where key = 'search_hours_per_day'");
  });

  await step("Load sample data: warns about real records first, then loads marked sample rows", async () => {
    const before = await one("select (select count(*)::int from transactions) t, (select count(*)::int from accounts) a");
    sampleBefore = await sampleLike();
    await page.goto(`${BASE}/settings/data`);
    await expectText(page, "You already have");
    await page.getByTestId("sample-load").click();
    // The checkbox is required: nothing is loaded without it.
    if ((await one("select count(*)::int n from sample_records")).n !== 0) throw new Error("loaded without confirming");
    await page.getByTestId("sample-confirm-real").check();
    await page.getByTestId("sample-load").click();
    await expectText(page, "Sample data loaded:");
    const s = await one(`select (select count(*)::int from sample_records) marked,
      (select count(*)::int from sample_records where table_name = 'recurring_series') series,
      (select count(*)::int from accounts where name like 'Sample %') accounts,
      (select count(*)::int from transactions) t,
      (select count(*)::int from recurring_series s where review_flag and review_status = 'unreviewed' and exists (select 1 from sample_records r where r.record_id = s.id)) unused`);
    if (s.marked < 450 || s.accounts !== 5 || s.t <= before.t) throw new Error(JSON.stringify(s));
    if (s.unused !== 2) throw new Error(`unused subscriptions flagged: ${s.unused}`);
    if (s.series < 10) throw new Error(`recurring charges found: ${s.series}`);
    const unmarked = await one("select count(*)::int n from accounts a where a.name like 'Sample %' and not exists (select 1 from sample_records r where r.record_id = a.id)");
    if (unmarked.n) throw new Error("an unmarked sample account");
    await expectText(page, "Sample data is loaded");
  });

  await step("Savings ideas: propose now, shown on Home with a count, Edit, Later, Decline (not proposed again), Approve as a reduction action", async () => {
    await aipost("/__reset");
    await page.goto(`${BASE}/finance/expenses`);
    await page.getByRole("button", { name: "Propose savings ideas now" }).click();
    await expectText(page, "3 savings ideas are ready");
    if ((await page.getByTestId("savings-idea").count()) !== 3) throw new Error("expected 3 idea cards");
    await expectText(page, "Cancel it: the current cost is");
    for (const [vp, pg_] of VIEWS) {
      await pg_.goto(`${BASE}/finance/expenses#savings-ideas`);
      await pg_.getByTestId("savings-idea").first().waitFor();
      await pg_.locator("#savings-ideas").screenshot({ path: path.join(OUT, `${vp}-savings-ideas.png`) });
    }
    await page.goto(`${BASE}/`);
    await expectText(page, "Savings ideas");
    if ((await page.getByTestId("home-savings-ideas").locator("li").count()) !== 3) throw new Error("Home lists the ideas");
    // Edit the storage idea's savings
    await page.goto(`${BASE}/finance/expenses`);
    const ideaCard = (re) => page.getByTestId("savings-idea").filter({ has: page.getByRole("heading", { name: re }) }).first();
    const storage = ideaCard(/storage/i);
    await storage.getByText("Edit", { exact: true }).click();
    await storage.locator("input[name='estimated_monthly_savings']").fill("250");
    await storage.getByRole("button", { name: "Save idea" }).click();
    await expectText(page, "Savings idea saved.");
    if (Number((await one("select estimated_monthly_savings from savings_ideas where title ilike '%storage%'")).estimated_monthly_savings) !== 250) throw new Error("edit not saved");
    // Later
    const grocery = ideaCard(/Shop once a week/);
    await grocery.getByRole("button", { name: "Later" }).click();
    await expectText(page, "Saved for later.");
    await expectText(page, "saved for later");
    // Decline with a reason
    const cancel = ideaCard(/^Cancel /);
    await cancel.getByText("Decline", { exact: true }).click();
    await cancel.locator("input[name='reason']").fill("I use it every week.");
    await cancel.getByTestId("idea-decline").click();
    await expectText(page, "Declined. Ideas for this expense");
    const declined = await one("select target_key, decline_reason from savings_ideas where status = 'declined'");
    if (declined.decline_reason !== "I use it every week.") throw new Error("reason");
    // Propose again: the declined expense and the open ideas' expenses are not proposed again.
    await page.getByRole("button", { name: "Propose savings ideas now" }).click();
    await page.waitForLoadState("networkidle");
    const dup = await one("select count(*)::int n from savings_ideas where target_key = $1", [declined.target_key]);
    if (dup.n !== 1) throw new Error("declined expense proposed again");
    // Approve the storage idea as a reduction action (the same review screen)
    await page.goto(`${BASE}/finance/expenses`);
    const edited = (await one("select title from savings_ideas where estimated_monthly_savings = 250 and status = 'pending'")).title;
    await page.getByTestId("savings-idea").filter({ has: page.getByRole("heading", { name: edited, exact: true }) }).first().getByTestId("idea-approve").click();
    await page.waitForURL(/\/plan\/initiatives\/drafts\//);
    await expectText(page, "Turn this savings idea into");
    await page.getByText("A reduction action on the expense").click();
    await page.getByTestId("approve-reduction").click();
    await page.waitForURL(/\/records\/reduction_actions\//);
    await expectText(page, "Approved and saved as a reduction action");
    const ra = await one("select r.projected_monthly_savings, r.recurring_series_id, i.status from reduction_actions r join savings_ideas i on i.result_id = r.id order by r.created_at desc limit 1");
    if (!ra || ra.status !== "approved" || !ra.recurring_series_id || Number(ra.projected_monthly_savings) !== 250) throw new Error(JSON.stringify(ra));
    // Approve the grocery idea (from Later) as an initiative
    await page.goto(`${BASE}/finance/expenses`);
    await page.locator("li", { hasText: "Shop once a week" }).getByRole("button", { name: "Approve" }).click();
    await page.waitForURL(/\/plan\/initiatives\/drafts\//);
    await page.getByTestId("approve-selected").click();
    await page.waitForURL(/\/records\/initiatives\//);
    await expectText(page, "Approved and saved: Shop once a week");
  });

  await step("Savings ideas: when the AI monthly cap is reached, the plain message shows and the weekly step skips", async () => {
    await pg.query("insert into ai_usage (owner_id, purpose, model, cost_usd) values ($1, 'test_cap', 'test', 1000)", [OWNER]);
    try {
      await page.goto(`${BASE}/finance/expenses`);
      await expectText(page, "The AI monthly cap is reached, so no savings ideas were proposed");
      if (!(await page.getByRole("button", { name: "Propose savings ideas now" }).isDisabled())) throw new Error("button enabled at the cap");
      await pg.query("delete from savings_ideas where source = 'weekly'");
      const r = await cron("savings-ideas");
      const res = Object.values(r.results)[0];
      if (res.skipped !== "cap") throw new Error(JSON.stringify(res));
    } finally {
      await pg.query("delete from ai_usage where purpose = 'test_cap'");
    }
  });

  await step("Sample data and reset tab screenshots", async () => {
    await shoot3(`${BASE}/settings/data`, "sample-data-reset");
  });

  await step("Remove sample data deletes only sample rows", async () => {
    const demo = await one("select (select count(*)::int from accounts where name not like 'Sample %') a, (select count(*)::int from contacts where name not like 'Sample %') c, (select count(*)::int from transactions t where not exists (select 1 from sample_records r where r.record_id = t.id)) t");
    await page.goto(`${BASE}/settings/data`);
    await page.getByTestId("sample-remove").click();
    await expectText(page, "Sample data removed:");
    const after = await one(`select (select count(*)::int from sample_records) marked,
      (select count(*)::int from accounts where name not like 'Sample %') a, (select count(*)::int from contacts where name not like 'Sample %') c, (select count(*)::int from transactions) t`);
    // Rows named "Sample ..." that were there before loading (the demo data has a few) stay; every other one is gone.
    const left = await sampleLike();
    if (after.marked || JSON.stringify(left) !== JSON.stringify(sampleBefore)) throw new Error(`sample rows left: ${JSON.stringify({ left, sampleBefore })}`);
    if (after.a !== demo.a || after.c !== demo.c || after.t !== demo.t) throw new Error(`real rows changed: ${JSON.stringify({ demo, after })}`);
    if (!(await one("select 1 x from change_log where field = 'sample_data_removed'"))) throw new Error("no change log entry");
  });

  await step("Reset all data: export first, RESET typed, data deleted, setup kept", async () => {
    const before = await one(`select (select count(*)::int from pipelines) p, (select count(*)::int from stage_tasks) st, (select count(*)::int from task_templates) tt,
      (select count(*)::int from targets) tg, (select count(*)::int from categories) cat, (select count(*)::int from inputs) inp, (select count(*)::int from ai_usage) ai`);
    const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await rctx.addCookies([cookie]);
    const rp = await rctx.newPage();
    await rp.goto(`${BASE}/settings/data`);
    if (!(await rp.locator("#reset-confirm").isDisabled())) throw new Error("step 2 enabled before the export");
    const dl = rp.waitForEvent("download").catch((e) => e);
    await rp.getByTestId("reset-download-export").click();
    await dl;
    await rp.getByTestId("reset-export-done").waitFor({ timeout: 30000 });
    await rp.fill("#reset-confirm", "reset");
    if (!(await rp.getByTestId("reset-submit").isDisabled())) throw new Error("enabled for lowercase reset");
    await rp.fill("#reset-confirm", "RESET");
    await rp.screenshot({ path: path.join(OUT, "flow-reset-ready.png"), fullPage: true });
    await rp.getByTestId("reset-submit").click();
    await rp.waitForURL(/reset=done/, { timeout: 30000 });
    await expectText(rp, "All data was reset on");
    await rp.getByTestId("reset-summary").waitFor();
    await rp.screenshot({ path: path.join(OUT, "flow-reset-done.png"), fullPage: true });
    const after = await one(`select (select count(*)::int from transactions) t, (select count(*)::int from accounts) a, (select count(*)::int from contacts) c,
      (select count(*)::int from pipeline_items) pi, (select count(*)::int from tasks) tasks, (select count(*)::int from checklists) cl, (select count(*)::int from savings_ideas) si,
      (select count(*)::int from initiatives) inits, (select count(*)::int from pipelines) p, (select count(*)::int from stage_tasks) st, (select count(*)::int from task_templates) tt,
      (select count(*)::int from targets) tg, (select count(*)::int from categories) cat, (select count(*)::int from inputs) inp, (select count(*)::int from ai_usage) ai,
      (select bool_and(start_date = (now() at time zone 'America/New_York')::date) from targets) today,
      (select count(*)::int from change_log where field = 'all_data_reset') logged`);
    for (const k of ["t", "a", "c", "pi", "tasks", "cl", "si"]) if (after[k]) throw new Error(`${k} not deleted: ${after[k]}`);
    if (after.inits !== 6) throw new Error(`initiatives: ${after.inits}`);
    for (const k of ["p", "st", "tt", "tg", "cat", "inp", "ai"]) if (after[k] !== before[k]) throw new Error(`${k} changed: ${before[k]} to ${after[k]}`);
    if (!after.today || after.logged !== 1) throw new Error(JSON.stringify(after));
    // A second reset in the same session needs a new export.
    await rp.goto(`${BASE}/settings/data`);
    if (!(await rp.locator("#reset-confirm").isDisabled())) throw new Error("export cookie not cleared");
    await rctx.close();
    await page.goto(`${BASE}/settings/change-log`);
    await expectText(page, "All data reset");
  });

  await d1280.close();

  await phone.close();
  await pg.end();

  await browser.close();
  for (const r of results) console.log(r.join(" "));
  if (results.some((r) => r[0] === "FAIL")) process.exit(1);
})();

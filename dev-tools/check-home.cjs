// LOCAL TESTING ONLY: the new Home (releases H1 and H2 of the Home redesign, approved by Bram 2026-11-17;
// claude/2026-11-17-home-redesign-build-plan.md). The bento cards, the Next actions card (5 rows, overdue first; Done and
// Later on the row under the pointer, working as on the full list), the calendar day view, the card links, Find, the
// phone order. Screenshots go to SHOTS_DIR (default /tmp/home-shots).
// Needs a fresh local database and the built app with the stand-ins (dev-tools/start-local.sh).
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || "/tmp/home-shots";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e && e.message ? e.message : e).split("\n").slice(0, 4).join("\n     ")}`);
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const until = async (fn, msg, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(msg);
};
const CARDS = ["home-next", "home-calendar", "home-waiting", "home-contacts", "home-targets", "home-priorities", "home-deals", "home-eod", "home-todos", "home-listings", "home-rosara", "home-jobs", "home-consulting"];

(async () => {
  await db.connect();
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  const open = async (p) => {
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState("networkidle");
  };
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await step("Sample data is loaded", async () => {
    await open("/settings/data");
    if (!(await page.getByText("Sample data loaded").count()) && (await page.getByTestId("sample-load").count())) {
      const confirm = page.getByTestId("sample-confirm-real");
      if (await confirm.count()) await confirm.check();
      await page.getByTestId("sample-load").click();
      await page.getByText("Sample data loaded").first().waitFor({ timeout: 60000 });
    }
  });

  await step("Home shows the bento: every card, and none of the old Home parts (area row, tiles, long list, Contacts buttons)", async () => {
    await open("/work");
    for (const id of CARDS) await page.getByTestId(id).first().waitFor({ timeout: 15000 });
    for (const old of ["area-option", "status-tiles", "home-row", "home-person-email", "home-glance", "top-priorities"]) assert((await page.getByTestId(old).count()) === 0, `old part still on Home: ${old}`);
    assert((await page.locator("main h1").innerText()).trim() === "Work on now", "title");
    const text = await page.locator("main").innerText();
    assert(!/\b(wedge|lanes?|shapes?)\b/i.test(text), "a banned word on Home");
    assert(!text.includes("\u2014"), "an em-dash on Home");
    await shot("home-1440");
  });

  await step("Next actions card: at most 5 rows, overdue before today, the counts match the full list, 'All N next actions' opens it", async () => {
    await open("/work");
    const rows = page.getByTestId("home-next-row");
    const n = await rows.count();
    assert(n > 0 && n <= 5, `rows ${n}`);
    const sections = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    assert(sections.every((s) => s === "overdue" || s === "today"), `sections ${sections}`);
    assert(sections.join(",") === [...sections].sort((a, b) => (a === b ? 0 : a === "overdue" ? -1 : 1)).join(","), `order ${sections}`);
    const all = Number(/All (\d+) next actions/.exec(await page.getByTestId("home-next-all").innerText())[1]);
    const overdue = Number(((await page.getByTestId("home-next-overdue").innerText().catch(() => "0")).match(/\d+/) || ["0"])[0]);
    await page.getByTestId("home-next-all").click();
    await page.waitForURL(/\/work\/next-actions\?view=all$/);
    await page.waitForLoadState("networkidle");
    const listRows = await page.locator('[data-testid="home-all-section"] [data-testid="home-row"]').count();
    assert(listRows === all, `All ${all} on Home, ${listRows} rows on the list`);
    const allTile = Number(await page.locator('[data-testid="status-tile"][data-key="all"]').getAttribute("data-count"));
    assert(allTile === all, `All tile ${allTile} vs Home ${all}`);
    const overdueTile = Number(await page.locator('[data-testid="status-tile"][data-key="overdue"]').getAttribute("data-count"));
    assert(overdueTile === overdue, `overdue ${overdue} vs tile ${overdueTile}`);
  });

  await step("Done and Later show only on the row under the pointer; the due word shows otherwise", async () => {
    await open("/work");
    const row = page.getByTestId("home-next-row").first();
    assert(!(await row.getByTestId("home-next-done").isVisible()), "Done shows without the pointer");
    assert(await row.getByTestId("home-next-due").isVisible(), "the due word is missing");
    await row.hover();
    assert(await row.getByTestId("home-next-done").isVisible(), "Done is missing under the pointer");
    assert(!(await row.getByTestId("home-next-due").isVisible()), "the due word still shows under the pointer");
    await page.screenshot({ path: path.join(SHOTS, "home-hover.png"), clip: { x: 0, y: 0, width: 1440, height: 560 } });
  });

  await step("Later on a to-do row moves it (as on the full list) and the row leaves the card", async () => {
    await open("/work");
    const row = page.locator('[data-testid="home-next-row"][data-lane="to-dos"]').first();
    assert(await row.count(), "no to-do row in the card");
    const key = await row.getAttribute("data-key");
    const id = key.split(":")[1];
    const before = (await one("select due_on::text as d from deal_todos where id = $1", [id])).d;
    await row.hover();
    await row.getByTestId("home-next-later").click();
    const run = page.locator(`[data-testid="home-next-run"][data-key="${key}"]`);
    await run.getByTestId("next-action-result").waitFor();
    assert(/Moved to/.test(await run.innerText()), "no 'Moved to'");
    await until(async () => (await one("select due_on::text as d from deal_todos where id = $1", [id])).d > before, "the date did not move");
    await until(async () => (await page.locator(`[data-testid="home-next-row"][data-key="${key}"], [data-testid="home-next-run"][data-key="${key}"]`).count()) === 0, "the row stayed");
  });

  await step("Done on a contact row asks when to follow up next, as on the full list; Close puts the row back", async () => {
    await open("/work");
    const row = page.locator('[data-testid="home-next-row"][data-lane="people"]').first();
    assert(await row.count(), "no contact row in the card (the sample data has contacts due)");
    const key = await row.getAttribute("data-key");
    await row.hover();
    await row.getByTestId("home-next-done").click();
    const run = page.locator(`[data-testid="home-next-run"][data-key="${key}"]`);
    await run.getByTestId("person-done-choice").first().waitFor();
    await run.getByTestId("home-next-run-close").click();
    await page.locator(`[data-testid="home-next-row"][data-key="${key}"]`).waitFor();
  });

  await step("A click on a row opens its record; a click on a card opens its page", async () => {
    await open("/work");
    await page.getByTestId("home-next-title").first().click();
    await page.waitForURL((u) => !u.pathname.endsWith("/work"));
    for (const [id, re] of [["home-deals", /\/work\/deals$/], ["home-contacts", /\/work\/people$/], ["home-targets", /\/work\/targets$/], ["home-eod", /\/work\/end-of-day$/], ["home-todos", /\/work\/todos$/], ["home-listings", /\/work\/listings$/], ["home-rosara", /\/work\/rosara$/], ["home-jobs", /\/work\/jobs$/], ["home-consulting", /\/work\/consulting$/], ["home-waiting", /\/work\/next-actions#now-wait$/]]) {
      await open("/work");
      await page.getByTestId(id).click();
      await page.waitForURL(re);
    }
  });

  await step("The cards show their numbers: Waiting in red at the threshold, Deals with its bar, End of day with its time", async () => {
    await open("/work");
    const shown = Number(await page.getByTestId("home-waiting-count").innerText());
    const parts = [...(await page.getByTestId("home-waiting-line").innerText()).matchAll(/(\d+) (?:at|under) \d+/g)].reduce((n, m) => n + Number(m[1]), 0);
    assert(shown === parts, `Waiting ${shown} vs its line ${parts}`);
    const red = await page.getByTestId("home-waiting-count").evaluate((e) => getComputedStyle(e).color);
    const over = /at \d+\+ days/.test(await page.getByTestId("home-waiting-line").innerText());
    assert(over === (red === "rgb(180, 35, 24)"), `Waiting red ${red}, over ${over}`);
    assert(Number(await page.getByTestId("home-deals-count").innerText()) >= 0, "Deals number");
    assert((await page.getByTestId("home-deals-bar").locator("i").count()) === 3, "Deals bar parts");
    assert(/^\d{1,2}:\d{2}$|^Sent$|^Skipped$/.test((await page.getByTestId("home-eod-badge").innerText()).trim()), "End of day badge");
    assert((await page.getByTestId("home-priority").count()) + (await page.getByTestId("home-priority-empty").count()) === 3, "three priority lines");
  });

  await step("Today's calendar as a day view: the hours, one item per event, the count, Block time", async () => {
    await open("/work");
    const day = page.getByTestId("home-calendar-day");
    await day.waitFor();
    assert(Number(await day.getAttribute("data-from")) <= 8 && Number(await day.getAttribute("data-to")) >= 18, "8 to 6");
    const more = (await page.getByText(/^and \d+ more$/).allInnerTexts()).reduce((n, t) => n + Number(t.match(/\d+/)[0]), 0);
    const items = (await page.getByTestId("calendar-item").count()) + more + Number((await page.getByTestId("calendar-all-day").getAttribute("data-count", { timeout: 500 }).catch(() => "0")) || 0);
    const count = Number((await page.getByTestId("home-calendar-count").innerText()).match(/\d+/)[0]);
    assert(items === count, `items ${items} vs count ${count}`);
    assert((await page.getByTestId("home-calendar-block").getAttribute("href")) === "/work/next-actions", "Block time link");
  });

  await step("Find on Home opens the full list with the words in its Find box", async () => {
    await open("/work");
    await page.getByTestId("home-search").fill("Dalton");
    await page.getByTestId("home-search").press("Enter");
    await page.waitForURL(/\/work\/next-actions\?find=Dalton$/);
    await page.waitForLoadState("networkidle");
    assert((await page.getByTestId("home-search").inputValue()) === "Dalton", "Find text");
  });

  await step("Phone: one column, the calendar right after Next actions, then Waiting", async () => {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await pctx.addCookies([cookie]);
    const p = await pctx.newPage();
    await p.goto(`${BASE}/work`);
    await p.waitForLoadState("networkidle");
    await p.getByTestId("home-waiting").waitFor();
    const y = async (id) => (await p.getByTestId(id).boundingBox()).y;
    const [a, b, c] = [await y("home-next"), await y("home-calendar"), await y("home-waiting")];
    assert(a < b && b < c, `order ${a} ${b} ${c}`);
    assert(await p.getByTestId("home-next-done").first().isVisible(), "Done shows on the phone");
    const wide = await p.evaluate(() => document.documentElement.scrollWidth);
    assert(wide <= 392, `page wider than the phone: ${wide}`);
    await p.screenshot({ path: path.join(SHOTS, "home-phone.png"), fullPage: true });
    await pctx.close();
  });

  await step("No page errors", async () => {
    assert(!errors.length, errors.join("\n"));
  });

  await browser.close();
  await db.end();
  console.log(failed ? `${failed} step(s) failed` : "All Home steps passed");
  process.exit(failed ? 1 : 0);
})();

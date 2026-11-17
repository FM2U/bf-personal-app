// LOCAL TESTING ONLY: the new Home (layout v8 of the Home redesign, approved by Bram 2026-11-17 4:47 pm;
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
const CARDS = ["home-next", "home-contacts", "home-calendar", "home-todos", "home-waiting", "home-targets", "home-priorities", "home-listings", "home-rosara", "home-jobs", "home-consulting"];

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
    for (const old of ["area-option", "status-tiles", "home-row", "home-person-email", "home-glance", "top-priorities", "now-wait", "home-deals", "home-eod"]) assert((await page.getByTestId(old).count()) === 0, `old part still on Home: ${old}`);
    assert((await page.locator("main h1").innerText()).trim() === "Work on now", "title");
    const text = await page.locator("main").innerText();
    assert(!/\b(wedge|lanes?|shapes?)\b/i.test(text), "a banned word on Home");
    assert(!text.includes("\u2014"), "an em-dash on Home");
    await shot("home-1440");
  });

  await step("Layout v8: Next actions and Contacts due today side by side and equally tall; To-dos and Waiting lined up under them; Targets today and Top priorities; four small cards; no Deals or End of day; all above the fold at 1440 x 790", async () => {
    await page.setViewportSize({ width: 1440, height: 790 });
    await open("/work");
    const box = async (id) => page.getByTestId(id).first().boundingBox();
    const [n, c] = [await box("home-next"), await box("home-contacts")];
    assert(Math.abs(n.y - c.y) < 1 && Math.abs(n.height - c.height) < 1.5, `Next actions ${n.y}/${n.height} vs Contacts ${c.y}/${c.height}`);
    for (const id of ["home-waiting", "home-targets"]) await page.getByTestId(id).first().waitFor();
    const order = async (id) => (await page.getByTestId(id).locator(":scope > *").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).join(",");
    assert((await order("home-row-2")) === "home-todos,home-waiting", `row 2 ${await order("home-row-2")}`);
    assert((await order("home-row-3")) === "home-targets,home-priorities", `row 3 ${await order("home-row-3")}`);
    // Layout v8: row 2 has row 1's split (wide, narrow); row 3 is the stagger (narrow, wide).
    const [t, w, tg] = [await box("home-todos"), await box("home-waiting"), await box("home-targets")];
    assert(Math.abs(t.width - n.width) < 1.5 && Math.abs(w.x - c.x) < 1.5, "row 2 is not lined up with row 1");
    assert(Math.abs(tg.width - c.width) < 1.5, "Targets today is not the narrow width");
    const bottom = (await box("home-row-4")).y + (await box("home-row-4")).height;
    assert(bottom <= 790, `the last row ends at ${bottom}, below 790`);
    for (const t of ["home-next-overdue", "home-next-today", "home-next-needs", "home-next-counts"]) assert((await page.getByTestId(t).count()) === 0, `count in the title: ${t}`);
    await shot("home-v8-1440x790");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("Next actions sections: Overdue and Today open with 1 row each, Later closed; the arrow opens Later to 1 row; the counts match the full list", async () => {
    await open("/work");
    const sec = (k) => page.locator(`[data-testid="home-next-section"][data-section="${k}"]`);
    assert((await sec("overdue").getAttribute("data-open")) === "1" && (await sec("today").getAttribute("data-open")) === "1" && (await sec("later").getAttribute("data-open")) === "0", "default open states");
    for (const k of ["overdue", "today"]) assert((await sec(k).getByTestId("home-next-row").count()) <= 1, `${k} shows more than 1 row`);
    assert((await sec("later").getByTestId("home-next-row").count()) === 0, "Later shows rows while closed");
    await sec("later").getByTestId("home-next-toggle").click();
    assert((await sec("later").getAttribute("data-open")) === "1", "Later did not open");
    assert((await sec("later").getByTestId("home-next-row").count()) <= 1, "Later shows more than 1 row");
    const counts = {};
    for (const k of ["overdue", "today", "later"]) counts[k] = Number(await sec(k).getByTestId("home-next-count").innerText());
    await page.getByTestId("home-next-all").click();
    const win = page.getByTestId("window-next");
    await win.waitFor();
    for (const k of ["overdue", "today", "later"]) {
      const tile = Number(await win.locator(`[data-testid="status-tile"][data-key="${k}"]`).getAttribute("data-count"));
      assert(tile === counts[k], `${k}: card ${counts[k]}, window tile ${tile}`);
    }
  });

  await step("Open on Overdue starts on Overdue, soonest first, even after By the AI was picked on the list page; choices in the window are not kept", async () => {
    await open("/work/next-actions");
    await page.getByTestId("home-order-ai").click();
    await open("/work");
    await page.locator('[data-testid="home-next-section"][data-section="overdue"] [data-testid="home-next-open"]').click();
    const win = page.getByTestId("window-next");
    await win.waitFor();
    assert((await win.locator('[data-testid="status-tile"][data-key="overdue"]').getAttribute("data-selected")) === "1", "Overdue is not selected");
    assert((await win.getByTestId("home-order-soonest").getAttribute("aria-checked")) === "true", "not soonest first");
    await win.locator('[data-testid="status-tile"][data-key="today"]').click();
    await page.getByTestId("large-window-close").click();
    await open("/work/next-actions");
    assert((await page.getByTestId("home-order-ai").getAttribute("aria-checked")) === "true", "the list page lost By the AI");
    await page.getByTestId("home-order-soonest").click();
  });

  await step("Open on Overdue opens the large window on that section, its top edge about 20% down the screen; Close goes back to Home", async () => {
    await open("/work");
    await page.locator('[data-testid="home-next-section"][data-section="overdue"] [data-testid="home-next-open"]').click();
    const win = page.getByTestId("window-next");
    await win.waitFor();
    const y = (await win.boundingBox()).y;
    const h = page.viewportSize().height;
    assert(Math.abs(y - h * 0.2) < 4, `window top ${y}, expected about ${h * 0.2}`);
    assert((await win.locator('[data-testid="status-tile"][data-key="overdue"]').getAttribute("data-selected")) === "1", "Overdue is not selected");
    assert((await win.getByTestId("home-row").count()) > 0, "no rows in the window");
    await shot("window-overdue");
    await page.getByTestId("large-window-close").click();
    await win.waitFor({ state: "detached" });
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

  await step("Done on the first Overdue row asks its usual question (or saves), as on the full list; Close puts the row back", async () => {
    await open("/work");
    const row = page.locator('[data-testid="home-next-section"][data-section="overdue"] [data-testid="home-next-row"]').first();
    assert(await row.count(), "no overdue row (the sample data has overdue actions)");
    const key = await row.getAttribute("data-key");
    await row.hover();
    await row.getByTestId("home-next-done").click();
    const run = page.locator(`[data-testid="home-next-run"][data-key="${key}"]`);
    await until(async () => (await run.locator('[data-testid="person-done-choice"], [data-testid="next-action-ask"], [data-testid="next-action-result"]').count()) > 0, "no question or result after Done");
    if ((await run.getByTestId("next-action-result").count()) === 0) {
      await run.getByTestId("home-next-run-close").click();
      await page.locator(`[data-testid="home-next-row"][data-key="${key}"]`).waitFor();
    }
  });

  await step("To-dos window: Later on a to-do moves it (as on To-dos)", async () => {
    await open("/work");
    await page.getByTestId("home-todos-open").click();
    const win = page.getByTestId("window-todos");
    await win.waitFor();
    const row = win.getByTestId("todo-action-row").first();
    const id = await row.getAttribute("data-todo");
    const before = (await one("select due_on::text as d from deal_todos where id = $1", [id])).d;
    await row.getByTestId("next-action-later").click();
    await row.getByTestId("next-action-result").waitFor();
    await until(async () => (await one("select due_on::text as d from deal_todos where id = $1", [id])).d > before, "the date did not move");
    await page.getByTestId("large-window-close").click();
  });

  await step("Contacts window: everyone due, each with Email, Log a call and Log a meeting; Log a meeting opens its drawer", async () => {
    await open("/work");
    const cardRows = await page.getByTestId("home-contact").count();
    await page.getByTestId("home-contacts-open").click();
    const win = page.getByTestId("window-contacts");
    await win.waitFor();
    const n = await win.getByTestId("window-contact").count();
    assert(n === cardRows && n > 0, `window ${n}, card ${cardRows}`);
    const groups = await win.getByTestId("window-contacts-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
    assert(groups.length && groups.every((g, i, a) => (g === "overdue" ? i === 0 : g === "today")) && groups.length === new Set(groups).size, `groups ${groups}`);
    for (const b of ["home-person-email", "home-person-log-call", "home-person-log-meeting"]) assert((await win.getByTestId(b).count()) === n, `${b} missing`);
    await shot("window-contacts");
    await win.getByTestId("home-person-log-meeting").first().click();
    await page.getByTestId("log-call-form").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("log-call-form").waitFor({ state: "detached" });
    assert(await win.isVisible(), "the Contacts window closed with the drawer");
  });

  await step("Waiting and Targets windows open with their full cards (Follow up on Waiting)", async () => {
    await open("/work");
    await page.getByTestId("home-waiting-open").click();
    await page.getByTestId("window-waiting").getByTestId("now-wait").waitFor();
    await page.getByTestId("large-window-close").click();
    await page.getByTestId("home-targets-open").click();
    await page.getByTestId("window-targets").getByTestId("home-targets").waitFor();
    await page.getByTestId("large-window-close").click();
  });

  await step("A click on a row opens its record; a click on a card opens its page", async () => {
    await open("/work");
    await page.getByTestId("home-next-title").first().click();
    await page.waitForURL((u) => !u.pathname.endsWith("/work"));
    for (const [id, re] of [["home-listings", /\/work\/listings$/], ["home-rosara", /\/work\/rosara$/], ["home-jobs", /\/work\/jobs$/], ["home-consulting", /\/work\/consulting$/], ["home-contact", /\/work\/people\//], ["home-todo", /\/work\//], ["home-target", /\/work\/targets$/]]) {
      await open("/work");
      await page.getByTestId(id).first().click();
      await page.waitForURL(re);
    }
  });

  await step("The cards show their numbers: Waiting in red at the threshold; three Top priorities lines", async () => {
    await open("/work");
    const red = await page.getByTestId("home-waiting-count").evaluate((e) => getComputedStyle(e).color);
    const over = (await page.getByTestId("home-wait").evaluateAll((els) => els.map((e) => getComputedStyle(e.lastElementChild).color))).includes("rgb(180, 35, 24)");
    assert(over === (red === "rgb(180, 35, 24)"), `Waiting red ${red}, a row at the threshold ${over}`);
    assert((await page.getByTestId("home-priority").count()) + (await page.getByTestId("home-priority-empty").count()) === 3, "three priority lines");
  });

  await step("Today's calendar as a day view: the hours, one item per event, the count, Block time", async () => {
    await open("/work");
    const day = page.getByTestId("home-calendar-day");
    await day.waitFor();
    assert(Number(await day.getAttribute("data-from")) === 8 && Number(await day.getAttribute("data-to")) === 18, "8 to 6");
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

  await step("Phone: one column: Next actions, Contacts, the calendar, To-dos, Waiting", async () => {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await pctx.addCookies([cookie]);
    const p = await pctx.newPage();
    await p.goto(`${BASE}/work`);
    await p.waitForLoadState("networkidle");
    await p.getByTestId("home-waiting").waitFor();
    const y = async (id) => (await p.getByTestId(id).boundingBox()).y;
    const ys = [await y("home-next"), await y("home-contacts"), await y("home-calendar"), await y("home-todos"), await y("home-waiting")];
    assert(ys.every((v, i) => !i || v > ys[i - 1]), `order ${ys}`);
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

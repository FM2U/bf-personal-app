// LOCAL TESTING ONLY. Click-through checks of push C (Work additions) against the local stand-ins: the header of
// 2026-11-04 (tiles that work like tabs on Work on now, Contacts and To-dos, the Area filter, By the AI with no tile
// selected, the day-start Soonest first, the slim pinned bar, no top menu row on desktop), Work through, a
// repeating to-do adds the next, the Link to picker (click, type, chips, keyboard), a linked to-do shows on the
// record, a dated record task shows on To-dos and Home and checks off everywhere, Block time creates a Google event
// in the stand-in and the row shows "Blocked", Today's calendar, and Remove sample data.
// Needs a fresh local database (dev-tools/setup-local-db.sh) and the built app with the stand-ins (dev-tools/start-local.sh).
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-push-c.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const GOOGLE = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
const SHOTS = process.env.SHOTS_DIR || null;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const g = (p, body) => fetch(`${GOOGLE}${p}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const ny = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nextWeekday = (iso) => {
  let d = addDays(iso, 1);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
};

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
const shot = async (page, name, full = false) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: full });
};
const until = async (fn, msg, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(msg);
};

(async () => {
  await db.connect();
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (process.env.FAKETIME) await ctx.clock.setSystemTime(Date.now());
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await g("/__reset", {});
  const today = ny();
  // Picks a status tile (2026-11-04: the tiles work like tabs; the card shows only the selected tile's list).
  const pickTile = async (tiles, key) => {
    await page.waitForLoadState("networkidle");
    const t = page.getByTestId(tiles).locator(`[data-testid="status-tile"][data-key="${key}"]`);
    await t.click();
    await until(async () => (await t.getAttribute("aria-selected")) === "true", `the ${key} tile is selected`);
  };
  const tileCount = async (tiles, key) => Number(await page.getByTestId(tiles).locator(`[data-testid="status-tile"][data-key="${key}"]`).getAttribute("data-count"));
  const homeRow = (text) => page.getByTestId("home-row").filter({ hasText: text }).first();
  const todoLine = (text) => page.getByTestId("personal-todo").filter({ hasText: text }).first();

  await step("Sample data is loaded (loads it when missing) and Google is connected through the stand-in", async () => {
    if ((await one("select count(*)::int n from sample_records")).n === 0) {
      await page.goto(`${BASE}/settings/data`);
      const c = page.getByTestId("sample-confirm-real");
      if (await c.count()) await c.check();
      await page.getByTestId("sample-load").click();
      await page.waitForSelector("text=Sample data loaded", { timeout: 60000 });
    }
    await page.goto(`${BASE}/api/google/connect`);
    await page.waitForURL(/\/settings\?google=/);
    const conn = await one("select scopes from google_connections");
    assert(conn.scopes.includes("calendar.readonly") && conn.scopes.includes("calendar.events"), "the calendar permissions are saved");
    const s = await one("select (select count(*)::int from deal_todos where record_id is null) personal, (select count(*)::int from deal_todos where repeat is not null) repeating, (select count(*)::int from time_blocks) blocks, (select count(*)::int from sample_records where table_name = 'time_blocks') tracked");
    assert(s.personal >= 6 && s.repeating >= 3 && s.blocks === 2 && s.tracked === 2, `sample: ${JSON.stringify(s)}`);
  });

  // ---------- The header of 2026-11-04: tiles that work like tabs, the Area filter, By the AI, the slim pinned bar ----------
  const tileKeys = (tiles) => page.getByTestId(tiles).locator('[data-testid="status-tile"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  const tileCounts = (tiles, p = page) => p.getByTestId(tiles).locator('[data-testid="status-tile"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))));
  const selectedKeys = (tiles) => page.getByTestId(tiles).locator('[aria-selected="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  const firstWithItems = (keys, counts) => keys[counts.findIndex((n) => n > 0)] ?? keys[0];

  /**
   * One header at a time: scrolls down a few pixels at a time; while any part of a tile is still below the bar's
   * bottom edge the bar is hidden; once every tile is above it the bar shows; back at the top it leaves.
   */
  const oneHeaderAtATime = async (p, tilesId) => {
    const bar = p.getByTestId("slim-bar");
    assert((await bar.getAttribute("data-shown")) === "0", "no slim bar at rest");
    const barH = await bar.evaluate((e) => e.offsetHeight);
    const tilesBottom = async () => (await p.getByTestId(tilesId).boundingBox()).y + (await p.getByTestId(tilesId).boundingBox()).height;
    const start = await tilesBottom();
    let seen = false;
    for (let y = 0; y <= start + 40; y += 8) {
      await p.evaluate((v) => window.scrollTo(0, v), y);
      await p.waitForTimeout(40);
      const bottom = await tilesBottom();
      const shown = (await bar.getAttribute("data-shown")) === "1";
      if (bottom > barH + 0.5) assert(!shown, `the bar shows while a tile is on screen (tiles end at ${bottom}, bar ${barH})`);
      if (shown) seen = true;
    }
    await until(async () => (await bar.getAttribute("data-shown")) === "1", "the slim bar slides in once the header is gone");
    assert(seen, "the bar showed");
    await p.evaluate(() => window.scrollTo(0, 0));
    await until(async () => (await bar.getAttribute("data-shown")) === "0", "the slim bar leaves when the header comes back");
    await p.evaluate((v) => window.scrollTo(0, v), start + 40);
    await until(async () => (await bar.getAttribute("data-shown")) === "1", "and comes back");
  };

  // Fix list items 2, 3, 4 (approved 2026-11-06): All first and selected; under All every row in four sections.
  const HOME_KEYS = ["all", "overdue", "today", "needs", "later"];
  const SECTION_KEYS = ["overdue", "today", "needs", "later"];
  const homeRowsShown = (p = page) => p.locator('[data-testid="home-all"] [data-testid="home-row"], [data-testid="home-list"] [data-testid="home-row"]').evaluateAll((els) => els.map((e) => ({ section: e.getAttribute("data-section"), area: e.getAttribute("data-area"), lane: e.getAttribute("data-lane") })));

  await step("Work on now: All plus four tiles work like tabs; All is selected and shows every row in four sections with grey bands; Due later holds rows due after today; the tile is kept for the day", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-tiles").waitFor();
    const keys = await tileKeys("home-tiles");
    const counts = await tileCounts("home-tiles");
    assert(JSON.stringify(keys) === JSON.stringify(HOME_KEYS), `tiles ${keys}`);
    assert(counts[0] === counts.slice(1).reduce((x, y) => x + y, 0), `All counts every section ${counts}`);
    assert(counts[4] > 0, `the sample has rows due later ${counts}`);
    assert(JSON.stringify(await selectedKeys("home-tiles")) === '["all"]', `default tile ${await selectedKeys("home-tiles")}`);
    // Under All: the four sections in tile order, each with its flat grey band and count badge, the rows in their section.
    const sections = await page.locator('[data-testid="home-all-section"]').evaluateAll((els) => els.map((e) => ({ k: e.getAttribute("data-section"), badge: Number(e.querySelector('[data-testid="section-count"]')?.textContent), rows: [...e.querySelectorAll('[data-testid="home-row"]')].map((r) => r.getAttribute("data-section")) })));
    assert(JSON.stringify(sections.map((x) => x.k)) === JSON.stringify(SECTION_KEYS), `sections ${sections.map((x) => x.k)}`);
    sections.forEach((x, i) => assert(x.badge === counts[i + 1] && x.rows.length === counts[i + 1] && x.rows.every((r) => r === x.k), `section ${JSON.stringify(x)} for ${counts[i + 1]}`));
    const band = page.getByTestId("home-all-band").first();
    assert((await band.evaluate((e) => e.tagName)) === "DIV" && (await band.locator("svg").count()) === 0 && /bg-slate-50/.test(await band.getAttribute("class")), "the bands are flat and grey: no caret, not a button");
    assert((await page.getByTestId("collapse-all").count()) === 0 && (await page.getByTestId("home-filters").count()) === 0 && (await page.getByTestId("home-show").count()) === 0, "no Collapse all and no pill row");
    // The Next actions count is the full count, and the line under the title no longer says "due today or earlier".
    const head = (await page.getByTestId("now-actions").innerText()).split("\n").slice(0, 3).join(" ");
    assert(new RegExp(`Next actions\\s*${counts[0]}\\b`).test(head), `Next actions counts every row: "${head}" for ${counts[0]}`);
    assert(!/due today or earlier/.test(await page.getByTestId("now-actions").innerText()), "the line under Next actions");
    // A tile shows only its list; Due later's rows come from more than one area.
    await pickTile("home-tiles", "later");
    let l = await homeRowsShown();
    assert((await page.getByTestId("home-list").getAttribute("data-section")) === "later" && l.length === counts[4] && l.every((x) => x.section === "later"), `later list ${JSON.stringify(l)}`);
    assert(new Set(l.map((x) => x.area)).size > 1, `Due later areas ${[...new Set(l.map((x) => x.area))]}`);
    await shot(page, "home-due-later.png");
    await pickTile("home-tiles", "today");
    l = await homeRowsShown();
    assert(l.length === counts[2] && l.every((x) => x.section === "today"), `today list ${JSON.stringify(l)}`);
    // A click on the selected tile does nothing; the arrow keys move between tiles.
    await page.getByTestId("home-tiles").locator('[data-key="today"]').click();
    assert((await page.getByTestId("home-list").getAttribute("data-section")) === "today", "the selected tile stays");
    await page.getByTestId("home-tiles").locator('[data-key="today"]').focus();
    await page.keyboard.press("ArrowRight");
    await until(async () => JSON.stringify(await selectedKeys("home-tiles")) === '["needs"]', "ArrowRight selects the next tile");
    await page.keyboard.press("ArrowLeft");
    await until(async () => JSON.stringify(await selectedKeys("home-tiles")) === '["today"]', "ArrowLeft selects the one before");
    // Kept for the rest of the day; another day starts on All.
    await page.reload();
    await until(async () => JSON.stringify(await selectedKeys("home-tiles")) === '["today"]', "the tile is kept on reload");
    await page.evaluate(() => window.localStorage.setItem("work-home-tile", JSON.stringify({ tile: "today", day: "2000-01-01" })));
    await page.reload();
    await until(async () => JSON.stringify(await selectedKeys("home-tiles")) === '["all"]', "a new day starts on All");
    // The right column starts level with the tiles; Waiting on someone's groups start closed (push E: three, with No reply yet).
    const tb = await page.getByTestId("home-tiles").boundingBox();
    const wb = await page.getByTestId("home-right").getByTestId("now-wait").boundingBox();
    assert(Math.abs(tb.y - wb.y) <= 1, `tiles at ${tb.y}, Waiting at ${wb.y}`);
    const wait = await page.locator('[data-testid="home-section"][data-section^="wait-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-collapsed")));
    assert(wait.length === 3 && wait.every((c) => c === "1"), `waiting groups ${wait}`);
    await shot(page, "home-tiles.png");
  });

  // The Area selector (one area or All) on a page: the choices with their numbers, greyed zero areas.
  const areaOpts = (p = page) => p.getByTestId("area-selector").locator('[data-testid="area-option"]').evaluateAll((els) => els.map((e) => ({ v: e.getAttribute("data-value"), n: Number(e.getAttribute("data-count")), on: e.getAttribute("aria-checked") === "true", off: e.disabled, label: e.innerText.replace(/\s+\d+$/, "").trim() })));
  const pickArea = async (v, p = page) => {
    await p.getByTestId("area-selector").locator(`[data-testid="area-option"][data-value="${v}"]`).click();
    await until(async () => (await p.getByTestId("area-selector").locator(`[data-value="${v}"]`).getAttribute("aria-checked")) === "true", `${v} is picked`);
  };

  await step("Work on now: the Area selector above the tiles picks one area; it narrows Next actions and the tile numbers; zero areas are greyed; no Filter button; Waiting on someone is not narrowed", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-tiles").waitFor();
    assert((await page.getByTestId("filter-open").count()) === 0 && (await page.getByTestId("slim-filter").count()) === 0, "no Filter button on Work on now");
    const before = await tileCounts("home-tiles");
    const waitBefore = await page.getByTestId("home-right").getByTestId("now-wait").innerText();
    let opts = await areaOpts();
    assert(JSON.stringify(opts.map((o) => o.label)) === JSON.stringify(["All", "Deals", "Contacts", "Rosara", "Job search", "Consulting", "To-dos", "Tasks"]), `areas ${opts.map((o) => o.label)}`);
    assert(opts[0].on && opts[0].n === before[0], `All is picked with ${opts[0].n} (All tile ${before[0]})`);
    assert(opts.every((o) => (o.v !== "all" && o.n === 0) === o.off), `zero areas greyed ${JSON.stringify(opts)}`);
    assert(opts.some((o) => o.off), "the sample has an empty area (Consulting)");
    // Placed above the tiles, left-aligned with them, the right column still level with the tiles. The Waiting card
    // arrives after the list (Home list first, 2026-11-07), so the check waits for it.
    await page.getByTestId("home-right").getByTestId("now-wait").waitFor({ timeout: 15000 });
    const sb = await page.getByTestId("area-selector").boundingBox();
    const tb = await page.getByTestId("home-tiles").boundingBox();
    const wb = await page.getByTestId("home-right").getByTestId("now-wait").boundingBox();
    assert(sb.y + sb.height <= tb.y && Math.abs(sb.x - tb.x) <= 1 && Math.abs(wb.y - tb.y) <= 1, `selector ${JSON.stringify(sb)} tiles ${JSON.stringify(tb)}`);
    await pickTile("home-tiles", "needs");
    const contactsN = opts.find((o) => o.v === "contacts").n;
    await pickArea("contacts");
    const after = await tileCounts("home-tiles");
    assert(after[0] === contactsN && after.slice(1).reduce((a, b) => a + b, 0) === contactsN && after[3] === 0, `tile numbers ${after} for ${contactsN}`);
    // Needs a next action dropped to 0, so the first tile with items is selected (All).
    assert(JSON.stringify(await selectedKeys("home-tiles")) === JSON.stringify([firstWithItems(HOME_KEYS, after)]), `selected ${await selectedKeys("home-tiles")}`);
    const areas = [...new Set((await homeRowsShown()).map((x) => x.area))];
    assert(JSON.stringify(areas) === '["contacts"]', `areas shown ${areas}`);
    assert((await page.getByTestId("home-right").getByTestId("now-wait").innerText()) === waitBefore, "Waiting on someone did not change");
    // Single choice: Deals replaces Contacts; a greyed area cannot be picked.
    await pickArea("deals");
    opts = await areaOpts();
    assert(opts.filter((o) => o.on).map((o) => o.v).join() === "deals", "one area at a time");
    const off = opts.find((o) => o.off);
    await page.getByTestId("area-selector").locator(`[data-value="${off.v}"]`).click({ force: true });
    assert((await areaOpts()).find((o) => o.on).v === "deals", "a greyed area is not picked");
    await shot(page, "home-area-deals.png");
    // The arrow keys move between the areas that can be picked.
    await page.getByTestId("area-selector").locator('[data-value="deals"]').focus();
    await page.keyboard.press("ArrowLeft");
    await until(async () => (await areaOpts()).find((o) => o.on).v === "all", "ArrowLeft picks All");
    await page.keyboard.press("ArrowRight");
    await until(async () => (await areaOpts()).find((o) => o.on).v === "deals", "ArrowRight picks Deals");
    // Remembered for the rest of the day; another day starts on All.
    await page.reload();
    await until(async () => (await areaOpts()).find((o) => o.on)?.v === "deals", "remembered on reload");
    await page.evaluate(() => window.localStorage.setItem("work-home-areas", JSON.stringify({ area: "deals", day: "2000-01-01" })));
    await page.reload();
    await until(async () => (await areaOpts()).find((o) => o.on)?.v === "all", "a new day starts on All");
    assert(JSON.stringify(await tileCounts("home-tiles")) === JSON.stringify(before), "All again");
  });

  await step("Next actions title row: Work through right after the title and count, Order and the AI star on the right", async () => {
    for (const w of [1440, 1280, 1100]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${BASE}/work`);
      const card = page.getByTestId("now-actions");
      await card.waitFor();
      const title = await card.locator("h2").first().boundingBox();
      const wt = await page.getByTestId("work-through-open").boundingBox();
      const ord = await page.getByTestId("home-order").boundingBox();
      const star = await card.getByTestId("ai-card-star").first().boundingBox();
      const cb = await card.boundingBox();
      assert(Math.abs(wt.y + wt.height / 2 - (title.y + title.height / 2)) <= 3 && wt.x - (title.x + title.width) >= 16 && wt.x - (title.x + title.width) <= 32, `${w}: Work through right after the title (${wt.x} after ${title.x + title.width})`);
      const wrapped = ord.y > wt.y + wt.height;
      if (wrapped) {
        // Too narrow for one line: Order and the star take the next line, lined up with the title.
        assert(ord.x - title.x >= 0 && ord.x - title.x <= 60 && ord.y - (wt.y + wt.height) >= 6 && star.x + star.width <= cb.x + cb.width - 20, `${w}: the second line lines up with the title`);
      } else {
        assert(ord.x - (wt.x + wt.width) >= 28, `${w}: clear space before Order`);
        assert(cb.x + cb.width - (star.x + star.width) >= 20 && cb.x + cb.width - (star.x + star.width) <= 24, `${w}: the star at the card's right edge`);
      }
      if (w === 1440) assert(!wrapped, "one line at 1440");
      if (w === 1440 && SHOTS) await page.screenshot({ path: path.join(SHOTS, "next-actions-title-row.png"), clip: { x: cb.x - 8, y: cb.y - 8, width: cb.width + 16, height: 110 } });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("By the AI: no tile selected, the full ranked list of the three kinds due today or earlier (no Due later); a tile click goes back to Soonest first; a new day starts on Soonest first", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-tiles").waitFor();
    const counts = await tileCounts("home-tiles");
    await page.getByTestId("home-order-ai").click();
    await page.getByTestId("ai-order-rows").waitFor({ timeout: 30000 });
    assert((await selectedKeys("home-tiles")).length === 0, "no tile selected");
    assert(JSON.stringify(await tileCounts("home-tiles")) === JSON.stringify(counts), "the tiles keep their numbers");
    const rows = await page.locator('[data-testid="ai-order-rows"] [data-testid="home-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    // By the AI keeps its single list of the three kinds (fix list item 2): Due later rows are not ranked.
    // Push D: the Monthly review row (from the first workday of the month until finished) shows first, unranked.
    const review = await page.locator('[data-testid="ai-order-rows"] [data-testid="home-row"][data-lane="review"]').count();
    const total = counts[1] + counts[2] + counts[3] + review;
    assert(rows.length === total && (await page.getByTestId("ai-order-number").count()) === total - review, `${rows.length} ranked rows for ${total} (${review} review row)`);
    const ranked = await page.locator('[data-testid="ai-order-rows"] [data-testid="home-row"]:not([data-lane="review"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    assert(["overdue", "today", "needs"].every((k, i) => !counts[i + 1] || ranked.includes(k)) && !ranked.includes("later"), `kinds ${[...new Set(ranked)]}`);
    const head = await page.getByTestId("ai-order-heading").innerText();
    assert(/ordered by the ai/i.test(head) && head.includes("Order again"), head);
    await shot(page, "home-by-the-ai.png");
    // Remembered for the rest of the day.
    await page.reload();
    await page.getByTestId("ai-order-rows").waitFor();
    // A tile click goes back to Soonest first with that tile's list.
    await pickTile("home-tiles", "today");
    assert((await page.getByTestId("home-order-soonest").getAttribute("aria-checked")) === "true", "Soonest first");
    assert((await page.getByTestId("home-list").getAttribute("data-section")) === "today" && (await page.getByTestId("ai-order-rows").count()) === 0, "the Due today list");
    // By the AI saved on another day: the page opens on Soonest first.
    await page.evaluate(() => window.localStorage.setItem("work-home-order", JSON.stringify({ choice: "ai", day: "2000-01-01" })));
    await page.reload();
    await page.getByTestId("home-list").waitFor();
    assert((await page.getByTestId("home-order-soonest").getAttribute("aria-checked")) === "true" && (await selectedKeys("home-tiles")).length === 1, "a new day starts on Soonest first");
  });

  await step("Contacts: the view choice under the title; tiles only on Follow-ups; Filter has Role and Project; the slim bar after scrolling", async () => {
    await page.goto(`${BASE}/work/people`);
    await page.getByTestId("follow-tiles").waitFor();
    const keys = await tileKeys("follow-tiles");
    const counts = await tileCounts("follow-tiles");
    assert(JSON.stringify(keys) === '["overdue","today","week","later","nodate"]', `tiles ${keys}`);
    const sel = firstWithItems(keys, counts);
    assert(JSON.stringify(await selectedKeys("follow-tiles")) === JSON.stringify([sel]), "default tile");
    assert((await page.getByTestId("outreach-row").count()) === counts[keys.indexOf(sel)], "the selected tile's list");
    assert((await page.getByTestId("collapse-all").count()) === 0, "no Collapse all");
    const vb = await page.getByTestId("people-view").boundingBox();
    const tb = await page.getByTestId("title-row").boundingBox();
    assert(vb.y > tb.y + tb.height - 1 && vb.height >= 40, `the view choice sits under the title (${vb.y}, ${vb.height} tall)`);
    // Follow-ups: the small box with Role and Project; a tick applies at once and the label says it.
    const fbtn = page.getByTestId("filter-open");
    assert((await fbtn.getAttribute("data-label")) === "Filter: All", `label ${await fbtn.getAttribute("data-label")}`);
    await fbtn.click();
    const pop = page.getByTestId("filter-popover");
    await pop.waitFor();
    let groups = await pop.getByTestId("filter-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
    assert(JSON.stringify(groups) === '["role","proj"]', `Follow-ups groups ${groups}`);
    const brokerN = Number(await pop.locator('[data-testid="filter-option"][data-value="broker"]').getAttribute("data-count"));
    await page.locator("#fp-role-broker").check();
    await until(async () => (await tileCounts("follow-tiles")).reduce((a, b) => a + b, 0) === brokerN, "the follow-up tiles follow the tick at once");
    await page.locator("#fp-proj-rosara").check();
    await page.locator("#fp-proj-off_market_deals").check();
    assert((await fbtn.getAttribute("data-label")) === "Filter: Broker, Off-market deals +1", `label ${await fbtn.getAttribute("data-label")}`);
    assert((await page.getByTestId("filter-chips").count()) === 0, "no chip row on Follow-ups");
    await page.getByTestId("filter-clear").click();
    assert(JSON.stringify(await tileCounts("follow-tiles")) === JSON.stringify(counts), "Clear");
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "detached" });
    // People: the large centered window stays (four groups), with its chips.
    await page.getByTestId("people-view-people").click();
    await page.getByTestId("everyone-card").waitFor();
    assert((await page.getByTestId("follow-tiles").count()) === 0, "no tiles on People");
    await page.getByTestId("filter-open").click();
    await page.getByTestId("filter-window").waitFor();
    groups = await page.getByTestId("filter-window").getByTestId("filter-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
    assert(JSON.stringify(groups) === '["role","lc","fu","org"]', `People groups ${groups}`);
    await page.locator("#fo-role-broker").check();
    await page.getByTestId("filter-show").click();
    await page.getByTestId("filter-chips").waitFor();
    await page.getByTestId("filter-chips-clear").click();
    await page.getByTestId("people-view-orgs").click();
    await page.getByTestId("orgs-card").waitFor();
    assert((await page.getByTestId("follow-tiles").count()) === 0, "no tiles on Organizations");
    await page.getByTestId("people-view-follow").click();
    await page.getByTestId("follow-tiles").waitFor();
    // The slim pinned bar: hidden while any tile is on screen, in once the whole header is gone, with the compact view
    // choice, the chips, Find and Filter.
    await pickTile("follow-tiles", keys[counts.indexOf(Math.max(...counts))]);
    const bar = page.getByTestId("slim-bar");
    // A shorter window, so the list is long enough to scroll the whole header away.
    await page.setViewportSize({ width: 1440, height: 560 });
    await oneHeaderAtATime(page, "follow-tiles");
    assert((await bar.getByTestId("slim-chip").count()) === 5 && (await bar.getByTestId("slim-view").count()) === 1 && (await bar.getByTestId("slim-find").count()) === 1 && (await bar.getByTestId("slim-filter").count()) === 1, "chips, view choice, Find and Filter");
    const bb = await bar.boundingBox();
    assert(bb.height < 80, `slim bar ${bb.height}px tall`);
    await shot(page, "contacts-slim-bar.png");
    const other = keys.find((k, i) => counts[i] > 0 && k !== keys[counts.indexOf(Math.max(...counts))]);
    await bar.locator(`[data-testid="slim-chip"][data-key="${other}"]`).click();
    await until(async () => JSON.stringify(await selectedKeys("follow-tiles")) === JSON.stringify([other]), "a chip picks the tile");
    await page.evaluate(() => window.scrollTo(0, 0));
    await until(async () => (await bar.getAttribute("data-shown")) === "0", "the slim bar leaves at the top");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("To-dos: four tiles (Done today's dot blue) and the intro line; one list at a time", async () => {
    await page.goto(`${BASE}/work/todos`);
    await page.getByTestId("todos-tiles").waitFor();
    const keys = await tileKeys("todos-tiles");
    const counts = await tileCounts("todos-tiles");
    assert(JSON.stringify(keys) === '["today","week","later","done"]', `tiles ${keys}`);
    const dots = await page.getByTestId("todos-tiles").locator("[data-dot]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dot")));
    assert(dots.length === 4 && dots.every((d) => d === "blue"), `dots ${dots}`);
    assert((await page.getByTestId("todos-card").innerText()).includes("Personal to-dos and record tasks with a date"), "the intro line");
    assert(JSON.stringify(await selectedKeys("todos-tiles")) === JSON.stringify([firstWithItems(keys, counts)]), "default tile");
    await pickTile("todos-tiles", "later");
    assert((await page.getByTestId("todos-section").getAttribute("data-section")) === "later" && (await page.getByTestId("personal-todo").count()) === counts[2], "the Later list");
    assert((await page.getByTestId("collapse-all").count()) === 0, "no Collapse all");
    // The Area selector: a personal to-do is To-dos, a record task counts by its record's area.
    await pickTile("todos-tiles", "today");
    assert((await page.getByTestId("filter-open").count()) === 0, "no Filter button on To-dos");
    const opts = await areaOpts();
    assert(JSON.stringify(opts.map((o) => o.label)) === JSON.stringify(["All", "Deals", "Contacts", "Rosara", "Job search", "Consulting", "To-dos"]), `areas ${opts.map((o) => o.label)}`);
    assert(opts.every((o) => (o.v !== "all" && o.n === 0) === o.off), "zero areas greyed");
    const dealsN = opts.find((o) => o.v === "deals").n;
    await pickArea("deals");
    await until(async () => (await tileCounts("todos-tiles")).reduce((a, b) => a + b, 0) === dealsN, "the tile numbers follow");
    const pills = await page.getByTestId("personal-todo").evaluateAll((els) => els.map((e) => e.getAttribute("data-record")));
    assert(pills.length > 0 && pills.every((r) => r.startsWith("listing:") || r.startsWith("deal:")), `only deal tasks ${pills}`);
    await shot(page, "todos-area-deals.png");
    await pickArea("todos");
    const personal = await page.getByTestId("personal-todo").evaluateAll((els) => els.map((e) => e.getAttribute("data-record")));
    assert(personal.every((r) => r === ""), `only personal to-dos ${personal}`);
    await page.reload();
    await until(async () => (await areaOpts()).find((o) => o.on)?.v === "todos", "remembered for the day");
    await pickArea("all");
    assert(JSON.stringify(await tileCounts("todos-tiles")) === JSON.stringify(counts), "All again");
  });

  await step("No top menu row at 1440 (the left menu has the pages and badges); the row shows at 400; Settings keeps its tabs; no 'lane' in the text", async () => {
    for (const p of ["/work", "/work/people", "/work/todos", "/work/deals", "/work/targets"]) {
      await page.goto(`${BASE}${p}`);
      await page.waitForLoadState("networkidle");
      assert(!(await page.getByTestId("top-menu-row").isVisible()), `no top menu row on ${p}`);
    }
    assert(await page.getByTestId("accountability-subnav").isVisible(), "the left menu lists Accountability's pages");
    await page.goto(`${BASE}/work`);
    assert(await page.getByTestId("work-subnav").isVisible(), "the left menu lists Work's pages");
    assert(!/\blanes?\b/i.test(await page.locator("main").innerText()), "no 'lane' on Work on now");
    await page.goto(`${BASE}/settings`);
    assert(await page.locator("nav[aria-label='Settings sections']").isVisible(), "Settings keeps its tabs");
    const phone = await ctx.browser().newContext({ viewport: { width: 400, height: 860 } });
    await phone.addCookies([cookie]);
    const pp = await phone.newPage();
    await pp.goto(`${BASE}/work`);
    await pp.getByTestId("home-tiles").waitFor();
    assert(await pp.getByTestId("top-menu-row").isVisible(), "the top menu row at 400");
    await oneHeaderAtATime(pp, "home-tiles");
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, "phone-work-scrolled.png") });
    await phone.close();
  });

  await step("Work on now in a short desktop window (1440 x 700): the page scrolls and the slim bar shows only once the title row and tiles are gone", async () => {
    const short = await ctx.browser().newContext({ viewport: { width: 1440, height: 700 } });
    await short.addCookies([cookie]);
    const sp = await short.newPage();
    await sp.goto(`${BASE}/work`);
    await sp.getByTestId("home-tiles").waitFor();
    await sp.waitForLoadState("networkidle");
    await oneHeaderAtATime(sp, "home-tiles");
    // The slim bar's area chip ("All") opens the same choices in a small menu; picking one narrows the list.
    await sp.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await until(async () => (await sp.getByTestId("slim-bar").getAttribute("data-shown")) === "1", "the bar shows");
    const chip = sp.getByTestId("slim-area");
    assert((await chip.innerText()).trim() === "All", `chip ${await chip.innerText()}`);
    await chip.click();
    const menu = sp.getByTestId("slim-area-menu");
    await menu.waitFor();
    const cb = await chip.boundingBox();
    const mb = await menu.boundingBox();
    assert(mb.y >= cb.y + cb.height && Math.abs(mb.x - cb.x) <= 2, "the menu hangs under the chip");
    assert(await menu.locator('[data-value="consulting"]').isDisabled(), "a zero area is greyed in the menu");
    const dealsN = Number((await sp.getByTestId("area-selector").locator('[data-value="deals"]').getAttribute("data-count")));
    await menu.locator('[data-value="deals"]').click();
    await menu.waitFor({ state: "detached" });
    await until(async () => (await chip.innerText()).trim() === "Deals", "the chip says Deals");
    assert((await tileCounts("home-tiles", sp))[0] === dealsN, "the tiles follow");
    assert((await sp.getByTestId("area-selector").locator('[data-value="deals"]').getAttribute("aria-checked")) === "true", "the selector above the tiles follows");
    await chip.click();
    await sp.getByTestId("slim-area-menu").locator('[data-value="all"]').click();
    await short.close();
  });

  await step("Record page: the slim bar shows once the header is gone, with the page's Email and Log a call", async () => {
    const mark = await one("select id from contacts where name = 'Mark Reed'");
    await page.goto(`${BASE}/work/people/${mark.id}`);
    await page.getByTestId("record-pinned").waitFor();
    await page.waitForLoadState("networkidle");
    const bar = page.getByTestId("slim-bar");
    assert((await bar.getAttribute("data-shown")) === "0", "no slim bar at rest");
    const hb = await page.getByTestId("record-pinned").boundingBox();
    const barH = await bar.evaluate((e) => e.offsetHeight);
    await page.evaluate((v) => window.scrollTo(0, v), hb.y + hb.height - barH - 10);
    await page.waitForTimeout(150);
    assert((await bar.getAttribute("data-shown")) === "0", "hidden while the header strip is still on screen");
    await page.evaluate((v) => window.scrollTo(0, v), hb.y + hb.height - barH + 5);
    await until(async () => (await bar.getAttribute("data-shown")) === "1", "the slim bar slides in");
    await page.waitForTimeout(300);
    const b = await bar.boundingBox();
    for (const id of ["person-page-email", "person-page-log-call", "ask-ai"]) {
      const x = await page.getByTestId("record-actions").getByTestId(id).boundingBox();
      assert(x && x.y >= b.y && x.y + x.height <= b.y + b.height && x.x > b.x + 100, `${id} sits in the slim bar (${JSON.stringify(x)} in ${JSON.stringify(b)})`);
    }
    assert((await page.getByTestId("person-page-email").count()) === 1, "one Email button, not a copy");
    await shot(page, "record-slim-bar.png");
    await page.getByTestId("person-page-log-call").click();
    await page.getByRole("dialog").first().waitFor();
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.scrollTo(0, 0));
    await until(async () => (await page.getByTestId("record-actions").getAttribute("data-docked")) === "0", "the buttons go back to the title row");
  });

  await step("Today's calendar on Home: Google Calendar events and the app's blocks (marked), in time order", async () => {
    await page.goto(`${BASE}/work`);
    const tile = page.getByTestId("home-calendar");
    await tile.waitFor();
    const items = tile.getByTestId("calendar-item");
    assert((await items.count()) === 4, `4 items, got ${await items.count()}`);
    const kinds = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    assert(JSON.stringify(kinds) === JSON.stringify(["block", "event", "block", "event"]), `kinds ${kinds}`);
    const text = await tile.innerText();
    assert(text.includes("Lunch with Dana Whitfield") && text.includes("Meridian Industrial Coatings: Finish the 7-year model") && text.includes("Blocked from Next actions"), "tile text");
    assert(!text.includes("Office closed"), "all-day events are left out");
    // The tile sits in the right column, beside Next actions, not stretched across.
    const t = await tile.boundingBox();
    const n = await page.getByTestId("now-actions").boundingBox();
    assert(t.x > n.x + n.width && t.width < 420, `tile at ${t.x}, ${t.width} wide`);
    await shot(page, "home-calendar.png");
  });

  await step("Home rows: a block icon beside Done on every row with Done, and Blocked 9:00 under Meridian's date", async () => {
    await pickTile("home-tiles", "overdue");
    const meridian = homeRow("Meridian Industrial Coatings");
    assert((await meridian.getByTestId("blocked-note").innerText()) === "Blocked 9:00", "Meridian blocked note");
    await pickTile("home-tiles", "today");
    // Push D: the Monthly review row has Open instead of Done, and the block icon too.
    const rows = page.locator('[data-testid="home-list"] :is([data-testid="next-action-done"], [data-testid="monthly-review-open"])');
    const icons = page.locator('[data-testid="home-list"] [data-testid="block-time"]');
    assert((await rows.count()) > 5 && (await icons.count()) === (await rows.count()), `${await icons.count()} icons for ${await rows.count()} rows`);
    // The icon column and the Done column sit at the same x on every row.
    const xs = await page.locator('[data-testid="home-list"] [data-col="block"]').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x)))]);
    assert(xs.length === 1, `block icons at ${xs}`);
    const task = homeRow("Check the data room for new files");
    assert((await task.getByTestId("lane-pill").innerText()) === "Task", "a dated record task has the Task pill");
    assert((await task.getByTestId("record-pill").innerText()).includes("Summit Logistics Group"), "and the gray record pill");
    assert((await task.getByTestId("blocked-note").innerText()) === "Blocked 2:00", "the sample block on the task");
    await shot(page, "home-rows.png");
  });

  await step("Work through: steps one row at a time across every lane due today or earlier, with the progress bar", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-tiles").waitFor();
    // Push D: the Monthly review row counts in Due today but is a page to open, not a step of Work through.
    await pickTile("home-tiles", "today");
    const review = await page.locator('[data-testid="home-row"][data-lane="review"]').count();
    const total = (await tileCount("home-tiles", "overdue")) + (await tileCount("home-tiles", "today")) - review;
    await page.getByTestId("work-through-open").click();
    const w = page.getByTestId("work-through");
    await w.waitFor();
    assert((await w.getByTestId("wt-count").innerText()) === `1 of ${total}`, `count ${await w.getByTestId("wt-count").innerText()} for ${total}`);
    const box = await w.boundingBox();
    assert(box.width > 820 && box.width <= 862, `window ${box.width} wide`);
    assert((await w.getByTestId("wt-context").locator(".label-caps").count()) === 2, "two context lines");
    await shot(page, "work-through.png");
    const first = await w.getByTestId("wt-step").getAttribute("data-key");
    await w.getByTestId("wt-skip").click();
    assert((await w.getByTestId("wt-count").innerText()) === `2 of ${total}`, "Skip goes to the next");
    assert(Number(await w.getByTestId("wt-progress").getAttribute("data-pct")) > 0, "the progress bar moves");
    assert((await w.getByTestId("wt-step").getAttribute("data-key")) !== first, "a new row");
    // Later on this step: tomorrow, saved like the row's Later.
    const second = await w.getByTestId("wt-step").getAttribute("data-key");
    await w.getByTestId("wt-later").click();
    await w.getByTestId("wt-later-tomorrow").click();
    await until(async () => (await w.getByTestId("wt-count").innerText()) === `3 of ${total}`, "Later moves on");
    const [kind, id] = second.split(":");
    if (process.env.DEBUG) console.log("     second step", second, await w.getByTestId("wt-count").innerText());
    const table = { deal: "pipeline_items", job: "pipeline_items", consulting: "pipeline_items", project: "projects" }[kind];
    if (table) assert(String((await one(`select next_action_due::text d from ${table} where id = $1`, [id])).d) === addDays(today, 1), "moved to tomorrow");
    if (kind === "person") assert(String((await one("select follow_up_date::text d from contacts where id = $1", [id])).d) === addDays(today, 1), "follow-up moved to tomorrow");
    if (kind === "todo") assert(String((await one("select due_on::text d from deal_todos where id = $1", [id])).d) === addDays(today, 1), "to-do moved to tomorrow");
    // Edit on this step: the action changes in place.
    await w.getByTestId("wt-edit").click();
    const act = w.getByTestId("wt-edit-action");
    await act.fill(`${await act.inputValue()} (edited)`);
    await w.getByTestId("wt-edit-save").click();
    await until(async () => (await w.getByTestId("wt-action").innerText()).includes("(edited)"), "the edit shows");
    // Skip until Meridian's dated task, then Done checks it off.
    const target = `todo:${(await one("select id from deal_todos where text = 'Ask for the top 10 customers by year'")).id}`;
    for (let i = 0; i < total && (await w.getByTestId("wt-step").count()) && (await w.getByTestId("wt-step").getAttribute("data-key")) !== target; i++) await w.getByTestId("wt-skip").click();
    const todoKey = await w.getByTestId("wt-step").getAttribute("data-key");
    assert(todoKey === target, "the task step is reached");
    assert((await w.getByTestId("wt-lane").innerText()) === "Task", "a record task steps with the Task pill");
    await shot(page, "work-through-task.png");
    await w.getByTestId("wt-done").click();
    await until(async () => !!(await one("select done_at from deal_todos where id = $1", [todoKey.split(":")[1]])).done_at, "Done checks the to-do off");
    while (await w.getByTestId("wt-skip").count()) await w.getByTestId("wt-skip").click();
    await w.getByTestId("wt-finished").waitFor();
    assert((await w.getByTestId("wt-finished").innerText()).includes(`All ${total} gone through: 1 done, 1 moved`), await w.getByTestId("wt-finished").innerText());
    await w.getByTestId("wt-close").click();
    await page.getByTestId("work-through").waitFor({ state: "detached" });
  });

  await step("A repeating to-do: checking it off adds the next one (from its date); unticking removes the copy", async () => {
    await page.goto(`${BASE}/work/todos`);
    const line = todoLine("Read the broker listing emails");
    assert((await line.getByTestId("repeat-chip").innerText()).includes("Every weekday"), "the Repeat chip");
    const t = await one("select id, due_on::text due from deal_todos where text = 'Read the broker listing emails' and done_at is null");
    await line.getByTestId("personal-todo-check").check();
    await until(async () => (await one("select count(*)::int n from deal_todos where repeat_from = $1", [t.id])).n === 1, "the next one is added");
    const copy = await one("select due_on::text due, repeat, done_at from deal_todos where repeat_from = $1", [t.id]);
    assert(copy.due === nextWeekday(t.due) && copy.repeat === "weekdays" && !copy.done_at, `copy ${JSON.stringify(copy)} from ${t.due}`);
    await page.getByTestId("todos-note").waitFor();
    // Untick in Done today: the copy goes away again.
    await page.reload();
    await pickTile("todos-tiles", "done");
    await page.locator('[data-testid="todos-section"][data-section="done"]').getByTestId("personal-todo").filter({ hasText: "Read the broker listing emails" }).getByTestId("personal-todo-check").uncheck();
    await until(async () => (await one("select count(*)::int n from deal_todos where repeat_from = $1", [t.id])).n === 0, "unticking removes the copy");
    assert(!(await one("select done_at from deal_todos where id = $1", [t.id])).done_at, "the item is open again");
  });

  await step("To-dos: Next 7 days has a Tomorrow line", async () => {
    await page.goto(`${BASE}/work/todos`);
    await pickTile("todos-tiles", "week");
    const week = page.locator('[data-testid="todos-section"][data-section="week"]');
    await week.getByTestId("todos-tomorrow").waitFor();
    const text = await week.innerText();
    assert(text.indexOf("TOMORROW") < text.indexOf("Pick up the dry cleaning") && text.indexOf("Pick up the dry cleaning") < text.indexOf("REST OF THE WEEK"), "tomorrow's items sit under the Tomorrow line");
    await shot(page, "todos-week.png", true);
  });

  await step("The Link to picker: click (today's records), type (matches by type with a status), chips, keyboard", async () => {
    await page.goto(`${BASE}/work/todos`);
    const input = page.getByTestId("add-link-input");
    await input.click();
    const list = page.getByTestId("add-link-list");
    await list.waitFor();
    const groups = await list.getByTestId("add-link-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
    assert(groups.length >= 2 && groups[0] === "Deals", `today's groups ${groups}`);
    assert((await list.innerText()).includes("Today's records"), "the hint");
    await input.pressSequentially("summ");
    const opt = list.getByTestId("add-link-option").filter({ hasText: "Summit Logistics Group" });
    assert((await opt.innerText()).includes("CIM review"), "the status at the right");
    await list.locator('[data-chip="People"]').click();
    await list.getByTestId("add-link-all-types").waitFor();
    assert((await list.getByTestId("add-link-empty").innerText()).includes("No match in People"), "no match in the type");
    await list.getByTestId("add-link-all-types").click();
    await opt.waitFor();
    await input.fill("");
    await input.pressSequentially("passed");
    assert((await list.getByTestId("add-link-option").count()) === 0, "a status word does not bring back closed records");
    await input.fill("");
    await input.pressSequentially("lakeside");
    assert((await list.innerText()).includes("Lakeside Car Wash"), "a closed record shows when its name is typed");
    await input.fill("");
    await input.pressSequentially("summ");
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    await input.press("Enter");
    await page.getByTestId("link-chip").waitFor();
    assert((await page.getByTestId("link-chip").innerText()).includes("Summit Logistics Group"), "the chip");
    await page.getByTestId("link-chip-remove").click();
    await input.click();
    await list.waitFor();
    await input.press("Escape");
    await list.waitFor({ state: "detached" });
    await input.pressSequentially("summit");
    await input.press("Enter");
    await page.getByTestId("link-chip").waitFor();
    await page.getByTestId("personal-todo-input").fill("Call the Summit owner about the shippers");
    await page.getByTestId("personal-todo-due").fill(addDays(today, 2));
    await page.getByTestId("personal-todo-add").click();
    await until(async () => !!(await one("select id from deal_todos where text = 'Call the Summit owner about the shippers'")), "added");
    const r = await one("select record_type, d.record_id, p.name from deal_todos d join pipeline_items p on p.id = d.record_id where d.text = 'Call the Summit owner about the shippers'");
    assert(r.record_type === "pipeline_items" && r.name === "Summit Logistics Group", JSON.stringify(r));
  });

  await step("A linked to-do is one of the record's tasks: it shows on the deal page; the edit box links and unlinks", async () => {
    const summit = await one("select id from pipeline_items where name = 'Summit Logistics Group'");
    await page.goto(`${BASE}/work/deals/${summit.id}`);
    const card = page.getByTestId("deal-todos");
    await card.getByText("Call the Summit owner about the shippers").waitFor();
    assert((await card.innerText()).includes("Tasks with a date also show on To-dos and Home"), "the muted note");
    await shot(page, "deal-tasks.png");
    // On To-dos: link a personal to-do to Mark Reed, then unlink it.
    await page.goto(`${BASE}/work/todos`);
    await todoLine("Renew the Cyan Arc registered agent").getByTestId("personal-todo-text").click();
    const box = page.getByTestId("todo-edit-box");
    await box.waitFor();
    await box.getByTestId("edit-link-input").pressSequentially("mark re");
    await box.getByTestId("edit-link-input").press("Enter");
    await box.getByTestId("link-chip").waitFor();
    await shot(page, "todo-edit-box.png", true);
    await box.getByTestId("todo-edit-save").click();
    await until(async () => (await one("select record_type from deal_todos where text = 'Renew the Cyan Arc registered agent'")).record_type === "contacts", "linked to the person");
    const mark = await one("select id from contacts where name = 'Mark Reed'");
    await page.goto(`${BASE}/work/people/${mark.id}`);
    await page.getByTestId("person-tasks").getByText("Renew the Cyan Arc registered agent").waitFor();
    await page.goto(`${BASE}/work/todos`);
    assert((await todoLine("Renew the Cyan Arc registered agent").getByTestId("record-pill").innerText()).includes("Mark Reed"), "the gray record pill on To-dos");
    await todoLine("Renew the Cyan Arc registered agent").getByTestId("personal-todo-text").click();
    await page.getByTestId("todo-edit-box").getByTestId("link-chip-remove").click();
    await page.getByTestId("todo-edit-save").click();
    await until(async () => (await one("select record_id from deal_todos where text = 'Renew the Cyan Arc registered agent'")).record_id === null, "unlinked: a personal to-do again");
  });

  await step("A dated record task shows on To-dos and Home with the record pill and checks off everywhere", async () => {
    const t = await one("select d.id, d.due_on::text due from deal_todos d where d.text = 'Send Mark Reed my questions on the CIM'");
    await page.goto(`${BASE}/work/todos`);
    const line = todoLine("Send Mark Reed my questions on the CIM");
    assert((await line.getByTestId("record-pill").innerText()).includes("Summit Logistics Group"), "record pill on To-dos");
    await page.goto(`${BASE}/work`);
    await pickTile("home-tiles", "overdue");
    const row = homeRow("Send Mark Reed my questions on the CIM");
    if (process.env.DEBUG) {
      await page.screenshot({ path: "/tmp/claude-0/-home-claude/9e8793b9-af27-5d6f-8d92-05e4cf5adea2/scratchpad/push-c-build/explore/dbg-home.png", fullPage: true });
      console.log(JSON.stringify(await one("select due_on::text, done_at from deal_todos where text = 'Send Mark Reed my questions on the CIM'")));
    }
    assert((await row.getByTestId("lane-pill").innerText()) === "Task", "Task pill on Home");
    await row.getByTestId("next-action-done").click();
    await until(async () => !!(await one("select done_at from deal_todos where id = $1", [t.id])).done_at, "Done on Home checks it off");
    const summit = await one("select id from pipeline_items where name = 'Summit Logistics Group'");
    await page.goto(`${BASE}/work/deals/${summit.id}`);
    const item = page.getByTestId("deal-todos").getByTestId("todo-item").filter({ hasText: "Send Mark Reed my questions on the CIM" });
    assert((await item.getAttribute("data-done")) === "1" && (await item.getByTestId("todo-check").isChecked()), "checked on the deal page");
    // On the deal page: the edit box gives an undated task a date and Repeat; it then shows on To-dos.
    const undated = page.getByTestId("deal-todos").getByTestId("todo-item").filter({ hasText: "Look up the two largest customers online" });
    await undated.getByTestId("todo-text").click();
    const box = page.getByTestId("task-edit-box");
    await box.getByTestId("task-edit-due").fill(addDays(today, 3));
    await box.getByTestId("task-edit-repeat").selectOption("weekly");
    await shot(page, "deal-task-edit.png");
    await box.getByTestId("task-edit-save").click();
    await until(async () => (await one("select repeat from deal_todos where text = 'Look up the two largest customers online'")).repeat === "weekly", "saved");
    await undated.getByTestId("due-chip").waitFor();
    assert((await undated.getByTestId("repeat-chip").innerText()).includes("Every week"), "the Repeat chip on the second line");
    // + Add with a date.
    await page.getByTestId("deal-todos").getByTestId("todo-add").click();
    await page.getByTestId("todo-input").fill("Ask Mark for the shipper contracts");
    await page.getByTestId("todo-input-due").fill(today);
    await page.getByTestId("todo-save").click();
    await until(async () => !!(await one("select id from deal_todos where text = 'Ask Mark for the shipper contracts' and due_on = $1", [today])), "added with a date");
    await page.goto(`${BASE}/work/todos`);
    await todoLine("Ask Mark for the shipper contracts").waitFor();
    // Unticking on To-dos opens it again on the deal page too.
    await pickTile("todos-tiles", "done");
    await page.locator('[data-testid="todos-section"][data-section="done"]').getByTestId("personal-todo").filter({ hasText: "Send Mark Reed my questions on the CIM" }).getByTestId("personal-todo-check").uncheck();
    await until(async () => !(await one("select done_at from deal_todos where id = $1", [t.id])).done_at, "unticked everywhere");
  });

  await step("Block time: the drawer shows the day, warns on an overlap, and adds a real event; the row shows Blocked", async () => {
    await page.goto(`${BASE}/work`);
    await pickTile("home-tiles", "today");
    const row = homeRow("BrightPath Home Care");
    await row.getByTestId("block-time").click();
    const d = page.getByTestId("block-drawer");
    await d.waitFor();
    const box = await d.boundingBox();
    assert(box.x > 900 && box.width <= 482, `a side drawer (${box.x}, ${box.width})`);
    assert((await d.getByTestId("block-day-item").count()) === 4, "Already on lists the day");
    assert((await d.locator('[data-testid="block-length"][aria-checked="true"]').getAttribute("data-minutes")) === "10", "the length starts at the row's minutes");
    await d.getByTestId("block-start").selectOption("12:30");
    await d.getByTestId("block-overlap").waitFor();
    assert((await d.getByTestId("block-overlap").innerText()).includes("Lunch with Dana Whitfield"), "the amber line names the event");
    await shot(page, "block-drawer.png");
    await d.getByTestId("block-start").selectOption("16:30");
    await d.locator('[data-testid="block-length"][data-minutes="30"]').click();
    assert((await d.getByTestId("block-overlap").count()) === 0, "no overlap at 4:30");
    await d.getByTestId("block-add").click();
    await d.getByTestId("block-result").waitFor();
    assert((await d.getByTestId("block-result").innerText()).includes("Added to Google Calendar"), await d.getByTestId("block-result").innerText());
    const events = await g("/__events");
    const ev = events.find((e) => e.summary.startsWith("BrightPath Home Care"));
    assert(ev && ev.description.includes("/work/deals/") && ev.timeZone === "America/New_York", `the stand-in got the event ${JSON.stringify(events)}`);
    const tb = await one("select row_key, google_event_id, extract(epoch from ends_at - starts_at)::int s from time_blocks where google_event_id = $1", [ev.id]);
    assert(tb && tb.row_key.startsWith("deal:") && tb.s === 1800, `kept: ${JSON.stringify(tb)}`);
    await d.getByTestId("block-close").click();
    await page.reload();
    await pickTile("home-tiles", "today");
    await until(async () => (await homeRow("BrightPath Home Care").getByTestId("blocked-note").count()) === 1, "the row shows Blocked");
    assert((await homeRow("BrightPath Home Care").getByTestId("blocked-note").innerText()) === "Blocked 4:30", "Blocked 4:30");
    assert((await page.getByTestId("home-calendar").getByTestId("calendar-item").count()) === 5, "the tile shows the new block");
  });

  await step("Without the calendar permission the tile shows a plain note, never an error; the blocks still show", async () => {
    const before = await one("select scopes from google_connections");
    await db.query("update google_connections set scopes = $1", [before.scopes.split(" ").filter((s) => !s.includes("calendar")).join(" ")]);
    await page.goto(`${BASE}/work`);
    const tile = page.getByTestId("home-calendar");
    assert((await tile.getByTestId("calendar-note").innerText()).includes("Reconnect Google to see your calendar"), "the note");
    assert((await tile.getByTestId("calendar-item").count()) === 3, "the app's three blocks still show");
    await db.query("update google_connections set scopes = $1", [before.scopes]);
    await g("/__mode", { calendarError: 403 });
    await page.reload();
    assert((await page.getByTestId("home-calendar").getByTestId("calendar-note").innerText()).includes("Reconnect Google"), "a refused call reads as reconnect");
    await g("/__mode", { calendarError: null });
  });

  await step("Remove sample data removes every block, task, to-do and repeating copy it added; real to-dos stay", async () => {
    await page.goto(`${BASE}/work/todos`);
    await page.getByTestId("personal-todo-input").fill("A real to-do of mine");
    await page.getByTestId("personal-todo-add").click();
    await until(async () => !!(await one("select id from deal_todos where text = 'A real to-do of mine'")), "added");
    // A repeating copy of a sample to-do, made by checking it off.
    await todoLine("Read the broker listing emails").getByTestId("personal-todo-check").check();
    await until(async () => (await one("select count(*)::int n from deal_todos where repeat_from is not null")).n >= 1, "copy made");
    await page.goto(`${BASE}/settings/data`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sample-remove").click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /Remove/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
    for (let i = 0; i < 40 && (await one("select count(*)::int n from sample_records")).n; i++) await page.waitForTimeout(500);
    const left = await one("select (select count(*)::int from sample_records) s, (select count(*)::int from time_blocks) b, (select string_agg(text, ',') from deal_todos) t");
    assert(left.s === 0 && left.b === 0 && left.t === "A real to-do of mine", JSON.stringify(left));
    // Counting starts on (Bram, 2026-11-09): removing the sample data sets it to today.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await until(async () => (await one("select value_text from inputs where key = 'counting_start'"))?.value_text === today, "Counting starts on was not set to today");
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-calendar").waitFor();
    await page.goto(`${BASE}/work/targets`);
    await page.getByTestId("targets-card").waitFor();
    assert(!(await page.getByTestId("past-weeks-line").count()), "Past weeks still shows after the sample data went");
  });

  if (errors.length) {
    failed++;
    console.log(`FAIL page errors: ${errors.slice(0, 3).join(" | ")}`);
  }
  await browser.close();
  await db.end();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})();

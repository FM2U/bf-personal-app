// LOCAL TESTING ONLY. Click-through checks of push D against the local stand-ins: an end date for Repeat (To-dos Add
// and edit box, a record's Tasks card, the chip, no new copy after it), the Weekly review on Friday's End of day
// (three answers, the status line, the report section with include, Change and Edit, a partner who unticks it), End of
// day sent, the Monthly review (the row on Work on now under All only, the page, Export, Finish, read only after,
// Reports > Monthly reviews), Settings (Gmail and Google Calendar, Work settings, stage defaults, AI cap), the four
// fixes (the listing page's menu item and tab, the writing rules once per click, Write with AI gets the deal facts,
// Contacts rows on Home open the person), and Remove sample data.
// Run it on a fake Monday and a fake Friday with dev-tools/push-d-days.sh (fresh database each). On its own:
// Needs a fresh local database (dev-tools/setup-local-db.sh) and the built app with the stand-ins (dev-tools/start-local.sh).
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-push-d.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const GOOGLE = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
const AI = process.env.ANTHROPIC_API_MOCK_URL || "http://localhost:54330";
const SHOTS = process.env.SHOTS_DIR || null;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const g = (p, body) => fetch(`${GOOGLE}${p}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const ai = (p, body) => fetch(`${AI}${p}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const ny = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const WRITING = "Writing rules: No metaphors, no jargon, no colloquialisms.";

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
const until = async (fn, msg, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(msg);
};

(async () => {
  await db.connect();
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  if (process.env.FAKETIME) await ctx.clock.setSystemTime(Date.now());
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await g("/__reset", {});
  await ai("/__reset", {});
  const today = ny();
  const isoDow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const friday = isoDow === 5;
  const month = `${today.slice(0, 7)}-01`;
  const lastMonth = (() => {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  })();
  const slug = lastMonth.slice(0, 7);
  console.log(`     App day: ${today} (${["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][isoDow]}); review of ${slug}`);
  const pickTile = async (key) => {
    await page.waitForLoadState("networkidle");
    const t = page.getByTestId("home-tiles").locator(`[data-testid="status-tile"][data-key="${key}"]`);
    await t.click();
    await until(async () => (await t.getAttribute("aria-selected")) === "true", `the ${key} tile is selected`);
  };
  const tileCount = async (key) => Number(await page.getByTestId("home-tiles").locator(`[data-testid="status-tile"][data-key="${key}"]`).getAttribute("data-count"));
  const todoLine = (text) => page.getByTestId("personal-todo").filter({ hasText: text }).first();

  await step("Sample data loads with the push D records; Google is connected through the stand-in", async () => {
    if ((await one("select count(*)::int n from sample_records")).n === 0) {
      await page.goto(`${BASE}/settings/data`);
      const c = page.getByTestId("sample-confirm-real");
      if (await c.count()) await c.check();
      await page.getByTestId("sample-load").click();
      await page.waitForSelector("text=Sample data loaded", { timeout: 90000 });
    }
    await page.goto(`${BASE}/api/google/connect`);
    await page.waitForURL(/\/settings\?google=/);
    const s = await one("select (select count(*)::int from monthly_reviews) reviews, (select count(*)::int from monthly_reviews where finished_at is not null) finished, (select count(*)::int from end_of_day where weekly_review <> '{}'::jsonb) answered, (select count(*)::int from deal_todos where repeat_until is not null) ending, (select count(*)::int from sample_records where table_name = 'monthly_reviews') tracked");
    assert(s.reviews === 2 && s.finished === 1 && s.answered === 1 && s.ending === 1 && s.tracked === 2, JSON.stringify(s));
    // The targets are made the first time Targets or End of day opens (as in the live app).
    await page.goto(`${BASE}/work/targets`);
    await page.waitForLoadState("networkidle");
  });

  // ---------- Repeat: an end date ----------
  await step("To-dos Add: Ends shows only when Repeat is not 'Does not repeat'; the chip reads 'Every week, until <date>'", async () => {
    await page.goto(`${BASE}/work/todos`);
    await page.getByTestId("todo-add-form").waitFor();
    assert((await page.getByTestId("personal-todo-until").count()) === 0, "no Ends before Repeat");
    await page.getByTestId("personal-todo-input").fill("Water the office plants");
    await page.getByTestId("personal-todo-due").fill(today);
    await page.getByTestId("personal-todo-repeat").selectOption("weekly");
    await page.getByTestId("personal-todo-until").waitFor();
    const until1 = addDays(today, 3);
    await page.getByTestId("personal-todo-until").fill(until1);
    await page.getByTestId("personal-todo-add").click();
    await until(async () => !!(await one("select id from deal_todos where text = 'Water the office plants'")), "added");
    const r = await one("select repeat, repeat_until::text u, due_on::text d from deal_todos where text = 'Water the office plants'");
    assert(r.repeat === "weekly" && r.u === until1 && r.d === today, JSON.stringify(r));
    await page.reload();
    await page.getByTestId("todos-tiles").locator('[data-testid="status-tile"][data-key="today"]').click();
    const chip = todoLine("Water the office plants").getByTestId("repeat-chip");
    assert((await chip.innerText()).trim() === `Every week, until ${short(until1)}`, await chip.innerText());
  });

  await step("Checking it off after the end date adds no new copy and says it was the last one; before it, the next copy keeps the end date", async () => {
    await todoLine("Water the office plants").getByTestId("personal-todo-check").check();
    await page.getByTestId("todos-note").waitFor();
    const note = await page.getByTestId("todos-note").innerText();
    assert(/That was the last one; it repeated until/.test(note), note);
    const copies = await one("select count(*)::int n from deal_todos where repeat_from = (select id from deal_todos where text = 'Water the office plants' and repeat_from is null)");
    assert(copies.n === 0, `copies ${copies.n}`);
    // A daily one ending in a week adds the next copy, which carries the same end date.
    await page.getByTestId("personal-todo-input").fill("Stretch at lunch");
    await page.getByTestId("personal-todo-due").fill(today);
    await page.getByTestId("personal-todo-repeat").selectOption("daily");
    await page.getByTestId("personal-todo-until").fill(addDays(today, 7));
    await page.getByTestId("personal-todo-add").click();
    await until(async () => !!(await one("select id from deal_todos where text = 'Stretch at lunch'")), "added");
    await page.reload();
    await page.getByTestId("todos-tiles").locator('[data-testid="status-tile"][data-key="today"]').click();
    await todoLine("Stretch at lunch").getByTestId("personal-todo-check").check();
    await page.getByTestId("todos-note").waitFor();
    assert(/The next one is on/.test(await page.getByTestId("todos-note").innerText()), "next one");
    const copy = await one("select due_on::text d, repeat_until::text u from deal_todos where text = 'Stretch at lunch' and repeat_from is not null");
    assert(copy && copy.d === addDays(today, 1) && copy.u === addDays(today, 7), JSON.stringify(copy));
  });

  await step("The to-do edit box: Ends beside Repeat (hidden for Does not repeat); clearing Repeat clears the end date", async () => {
    await page.reload();
    await page.getByTestId("todos-tiles").locator('[data-testid="status-tile"][data-key="week"]').click();
    const line = todoLine("Post the job search update in the alumni group");
    await line.getByTestId("personal-todo-text").click();
    const box = page.getByTestId("todo-edit-box");
    await box.waitFor();
    assert((await box.getByTestId("todo-edit-repeat").inputValue()) === "weekly", "weekly");
    const until0 = await box.getByTestId("todo-edit-until").inputValue();
    assert(until0 === addDays(today, 21), `sample end date ${until0}`);
    // The labels line up: Due date, Repeat, Ends, Link to on one row.
    const tops = await box.locator("label").evaluateAll((els) => [...new Set(els.slice(1).map((e) => Math.round(e.getBoundingClientRect().top)))]);
    assert(tops.length === 1, `labels at ${tops}`);
    await shot(page, "todo-edit-box-repeat-ends.png");
    await box.getByTestId("todo-edit-repeat").selectOption("");
    assert((await box.getByTestId("todo-edit-until").count()) === 0, "Ends hides");
    await box.getByTestId("todo-edit-save").click();
    await until(async () => (await one("select repeat, repeat_until from deal_todos where text = 'Post the job search update in the alumni group'")).repeat === null, "saved");
    assert((await one("select repeat_until from deal_todos where text = 'Post the job search update in the alumni group'")).repeat_until === null, "end date cleared");
  });

  await step("A record's Tasks card: Add has Repeat and Ends; the edit box has Ends; the chip shows the end date", async () => {
    const summit = (await one("select id from pipeline_items where name = 'Summit Logistics Group'")).id;
    await page.goto(`${BASE}/work/deals/${summit}`);
    const card = page.getByTestId("deal-todos");
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId("todo-add").click();
    await card.getByTestId("todo-input").fill("Check the broker's new listings");
    await card.getByTestId("todo-input-due").fill(addDays(today, 1));
    assert((await card.getByTestId("todo-input-until").count()) === 0, "no Ends before Repeat");
    await card.getByTestId("todo-input-repeat").selectOption("weekly");
    await card.getByTestId("todo-input-until").fill(addDays(today, 29));
    await card.getByTestId("todo-save").click();
    await until(async () => !!(await one("select id from deal_todos where text = $1", ["Check the broker's new listings"])), "added");
    const r = await one("select repeat, repeat_until::text u, record_id from deal_todos where text = $1", ["Check the broker's new listings"]);
    assert(r.repeat === "weekly" && r.u === addDays(today, 29) && r.record_id === summit, JSON.stringify(r));
    await page.reload();
    const item = page.getByTestId("deal-todos").getByTestId("todo-item").filter({ hasText: "Check the broker's new listings" });
    assert((await item.getByTestId("repeat-chip").innerText()).includes(`until ${short(addDays(today, 29))}`), await item.getByTestId("repeat-chip").innerText());
    await item.getByTestId("todo-text").click();
    const box = page.getByTestId("task-edit-box");
    await box.waitFor();
    assert((await box.getByTestId("task-edit-until").inputValue()) === addDays(today, 29), "edit box end date");
    await box.getByTestId("task-edit-until").fill(addDays(today, 15));
    await box.getByTestId("task-edit-save").click();
    await until(async () => (await one("select repeat_until::text u from deal_todos where text = $1", ["Check the broker's new listings"])).u === addDays(today, 15), "end date saved");
  });

  // ---------- Fix: Write with AI gets the deal facts; the writing rules once per click ----------
  await step("Write with AI in the deal's email box gets the deal facts; the writing rules go once per click", async () => {
    const summit = (await one("select id from pipeline_items where name = 'Summit Logistics Group'")).id;
    await page.goto(`${BASE}/work/deals/${summit}`);
    await page.getByTestId("deal-email").first().click();
    await page.getByTestId("compose-ai-line").waitFor();
    await page.getByTestId("compose-ai-line").fill("ask for the seller call date");
    await page.getByTestId("compose-ai-write").click();
    await until(async () => !!(await ai("/__prompts")).compose_email, "the AI was asked");
    const p = (await ai("/__prompts")).compose_email;
    assert(p.includes('"deal_facts"') && p.includes("revenue: $18,000,000") && p.includes("asking price: $9,500,000") && p.includes("key finding: Margins thin"), "deal facts in the prompt");
    const full = (await ai("/__full")).compose_email;
    const n = `${full.system}\n${full.text}`.split(WRITING).length - 1;
    assert(n === 1, `writing rules ${n} times`);
    await page.keyboard.press("Escape");
  });

  // ---------- Fix: the listing page ----------
  await step("A listing's page: Screen listings is the current menu item and the tab reads 'Listing: <name>'", async () => {
    const l = await one("select id, coalesce(company_name, name) n from pipeline_items where screened = false and status = 'open' order by created_at limit 1");
    await page.goto(`${BASE}/work/deals/${l.id}`);
    await page.getByTestId("deal-page-state").waitFor({ state: "attached" });
    assert((await page.title()).startsWith(`Listing: ${l.n}`), await page.title());
    const current = await page.getByTestId("work-subnav").locator("a.font-semibold").innerText();
    assert(current.startsWith("Screen listings"), `menu: ${current}`);
    const deal = await one("select id from pipeline_items where name = 'Summit Logistics Group'");
    await page.goto(`${BASE}/work/deals/${deal.id}`);
    await page.getByTestId("deal-page-state").waitFor({ state: "attached" });
    assert((await page.getByTestId("work-subnav").locator("a.font-semibold").innerText()).startsWith("Deals"), "a deal stays under Deals");
  });

  // ---------- Work on now: the Monthly review row ----------
  await step("Work on now: 'Monthly review: <month>' leads Due today under All, counts in Due today, and leaves on picking an area", async () => {
    await page.goto(`${BASE}/work`);
    await pickTile("today");
    const row = page.getByTestId("monthly-review-home-row");
    await row.waitFor();
    const text = await row.innerText();
    const name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(slug.slice(5)) - 1];
    assert(text.includes(`Monthly review: ${name}`) && text.includes(`See how ${name} went`) && text.includes("15 min") && /Today|Since/.test(text), text);
    const first = await page.locator('[data-testid="home-list"] [data-testid="home-row"]').first().getAttribute("data-lane");
    assert(first === "review", `first row ${first}`);
    const shown = await page.locator('[data-testid="home-list"] [data-testid="home-row"]').count();
    assert((await tileCount("today")) === shown, `Due today ${await tileCount("today")} for ${shown} rows`);
    assert((await page.getByTestId("home-band").innerText()).includes(String(shown)), "the band counts it too");
    await shot(page, "work-on-now-monthly-review.png");
    // An area hides it (it belongs to no single area) and the number goes down by one.
    await page.getByTestId("home-area").getByTestId("area-option").filter({ hasText: "Deals" }).first().click();
    await until(async () => (await page.getByTestId("monthly-review-home-row").count()) === 0, "gone under Deals");
    await page.getByTestId("home-area").getByTestId("area-option").filter({ hasText: "All" }).first().click();
    await page.getByTestId("monthly-review-home-row").waitFor();
  });

  await step("Contacts rows on Home: a click on the row opens the person page", async () => {
    await page.goto(`${BASE}/work`);
    const r = page.getByTestId("home-outreach-row").first();
    await r.waitFor();
    const id = await r.getAttribute("data-person");
    await r.scrollIntoViewIfNeeded();
    const box = await r.boundingBox();
    await page.mouse.click(box.x + box.width - 20, box.y + 12);
    await page.waitForURL(new RegExp(`/work/people/${id}`));
  });

  // ---------- End of day: the Weekly review (Friday) and the send ----------
  await step(friday ? "Friday's End of day: the Weekly review card, the status line (2 of 3), answers saved" : "Monday's End of day: no Weekly review card and no review in the status line", async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-card").waitFor();
    if (!friday) {
      assert((await page.getByTestId("eod-review").count()) === 0 && (await page.getByTestId("eod-step-review").count()) === 0, "no Weekly review on a Monday");
      return;
    }
    const card = page.getByTestId("eod-review");
    assert((await card.getByTestId("eod-review-field").count()) === 3, "three questions");
    assert((await card.innerText()).includes("What went well this week") && (await card.innerText()).includes("What slipped") && (await card.innerText()).includes("Next week's focus"), "the questions");
    const fields = card.getByTestId("eod-review-input");
    await fields.nth(0).fill("Screened 26 listings and finished the Meridian model.");
    await fields.nth(1).fill("Brokers contacted came in one short.");
    await fields.nth(2).click();
    await until(async () => (await one("select weekly_review from end_of_day where day = $1", [today]))?.weekly_review?.slipped === "Brokers contacted came in one short.", "two answers saved");
    await until(async () => (await page.getByTestId("eod-step-review").getAttribute("data-word")) === "2 of 3", "status line 2 of 3");
    // The field star drafts the third (the AI stand-in's answer), and Use this saves it.
    await card.getByTestId("eod-review-field").nth(2).getByTestId("ai-field-star").click();
    await page.getByTestId("ask-ai-use").waitFor({ timeout: 20000 });
    await page.getByTestId("ask-ai-use").click();
    await until(async () => /three weeks/.test((await one("select weekly_review from end_of_day where day = $1", [today]))?.weekly_review?.focus ?? ""), "third answer saved from the star");
    assert(/weekly review/i.test((await ai("/__prompts")).field_draft ?? ""), "the star asked for a Weekly review answer");
    const full = (await ai("/__full")).field_draft;
    assert(`${full.system}\n${full.text}`.split(WRITING).length - 1 === 1, "the writing rules once in the star's click");
    await page.keyboard.press("Escape");
    await page.reload();
    await until(async () => (await page.getByTestId("eod-step-review").getAttribute("data-word")) === "done", "status line done");
    // Bram's own words for the focus, and Monday's line, as on a real Friday.
    await page.getByTestId("eod-review-input").nth(2).fill("The Meridian partner deck, and a yes or no on Summit by Wednesday.");
    await page.getByTestId("tomorrow-input").fill("Meridian partner deck first; call Mark about Summit at 10.");
    await page.getByTestId("eod-review-input").nth(0).click();
    await until(async () => /Wednesday/.test((await one("select weekly_review from end_of_day where day = $1", [today]))?.weekly_review?.focus ?? ""), "focus saved");
    await page.reload();
    await page.getByTestId("eod-review").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await shot(page, "friday-end-of-day-weekly-review.png", true);
  });

  await step(friday ? "Friday's report: Weekly review in each partner's copy with include, Change, Edit; a partner who unticks it on their page does not get it" : "Monday's report: no Weekly review section", async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    const sec = page.locator("[data-testid=report-section][data-section=review]");
    if (!friday) {
      assert((await sec.count()) === 0, "no Weekly review on Monday");
      await page.getByTestId("report-window-close").click();
      return;
    }
    assert((await sec.getAttribute("data-included")) === "1", "Jake gets it");
    assert((await sec.getByTestId("section-change").count()) === 1 && (await sec.getByTestId("section-edit").count()) === 1, "Change and Edit");
    const body = await sec.innerText();
    assert(body.includes("Went well: Screened 26 listings") && body.includes("Slipped: Brokers contacted came in one short."), body);
    // Change hides one answer today.
    await sec.getByTestId("section-change").click();
    await sec.locator("[data-testid=picker-option][data-id=slipped] input").uncheck();
    await sec.getByTestId("picker-done").click();
    await until(async () => !(await sec.innerText()).includes("Slipped:"), "Slipped hidden today");
    await sec.getByTestId("section-change").click();
    await sec.locator("[data-testid=picker-option][data-id=slipped] input").check();
    await sec.getByTestId("picker-done").click();
    await until(async () => (await sec.innerText()).includes("Slipped:"), "back");
    await page.waitForTimeout(800);
    await page.locator("[data-testid=report-section][data-section=review]").scrollIntoViewIfNeeded();
    await shot(page, "friday-report-preview.png");
    await page.locator("[data-testid=report-tab][data-partner=Sarah]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hello Sarah,"));
    assert((await page.locator("[data-testid=report-section][data-section=review]").getAttribute("data-included")) === "1", "Sarah gets it");
    await page.getByTestId("report-window-close").click();
    // Sarah unticks it on her page: her copy leaves it out; ticked again, it is back.
    const sarah = (await one("select id from contacts where name = 'Sarah Klein'")).id;
    await page.goto(`${BASE}/work/people/${sarah}`);
    const box = page.getByTestId("partner-section-review");
    assert(await box.isChecked(), "on by default");
    await box.uncheck();
    await until(async () => (await one("select report_sections from contacts where id = $1", [sarah])).report_sections.includes("review_off"), "saved off");
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-view").click();
    await page.locator("[data-testid=report-tab][data-partner=Sarah]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hello Sarah,"));
    assert((await page.locator("[data-testid=report-section][data-section=review]").getAttribute("data-included")) === "0", "left out for Sarah");
    await page.getByTestId("report-window-close").click();
    await page.goto(`${BASE}/work/people/${sarah}`);
    await page.getByTestId("partner-section-review").check();
    await until(async () => {
      const s = (await one("select report_sections from contacts where id = $1", [sarah])).report_sections;
      return s.includes("review") && !s.includes("review_off");
    }, "saved on");
  });

  await step(`Approve and send on ${friday ? "Friday: both copies go out, with the Weekly review" : "Monday: Jake's copy goes out"}`, async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-card").waitFor();
    const before = (await g("/__sent")).length;
    await page.getByTestId("report-send").click();
    const check = page.getByTestId("send-check-anyway");
    await Promise.race([check.waitFor({ timeout: 20000 }).then(() => check.click()), page.getByTestId("sent-line").waitFor({ timeout: 20000 })]).catch(() => {});
    await page.getByTestId("sent-line").waitFor({ timeout: 40000 });
    const sent = (await g("/__sent")).slice(before).filter((m) => /Daily report/.test(m.subject));
    assert(sent.length === (friday ? 2 : 1), `sent ${sent.length}`);
    for (const m of sent) {
      const has = m.body.includes("WEEKLY REVIEW") && m.body.includes("Went well: Screened 26 listings");
      assert(friday ? has : !m.body.includes("WEEKLY REVIEW"), `${m.to}: Weekly review ${has}`);
    }
    assert((await one("select status from end_of_day where day = $1", [today])).status === "sent", "the day is sent");
  });

  // ---------- The Monthly review ----------
  await step("The Monthly review page: how the month went, next month's targets, Export not yet; Open from Work on now", async () => {
    await page.goto(`${BASE}/work`);
    await pickTile("today");
    await page.getByTestId("monthly-review-open").click();
    await page.waitForURL(new RegExp(`/work/reports/monthly/${slug}`));
    await page.getByTestId("monthly-went").waitFor();
    assert((await page.getByTestId("monthly-crumb").innerText()) === "Work on now", "crumb from Home");
    assert((await page.title()).startsWith("Monthly review:"), await page.title());
    assert((await page.getByTestId("monthly-went-row").count()) === 6 && (await page.getByTestId("monthly-next-row").count()) === 6, "six targets");
    assert(/\(not yet\)/.test(await page.getByTestId("monthly-step-export").innerText()), "export not yet");
    assert((await page.getByTestId("monthly-finish-note").innerText()) === "Export not downloaded yet. You can still finish.", "the note");
    // Cards side by side line up: the two title rows are level.
    const tops = await page.locator("[data-testid=monthly-went] h2, [data-testid=monthly-next] h2").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert(tops.length === 2 && tops[0] === tops[1], `titles at ${tops}`);
    await shot(page, "monthly-review.png", true);
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.addCookies([cookie]);
    const pp = await phone.newPage();
    await pp.goto(`${BASE}/work/reports/monthly/${slug}`);
    await pp.getByTestId("monthly-went").waitFor();
    const over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 0, `phone page scrolls sideways by ${over}px`);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, "phone-monthly-review.png"), fullPage: true });
    await phone.close();
  });

  await step("Export downloads and is noted on the review; Finish saves next month's targets and the copy; the row leaves Work on now; read only after", async () => {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("monthly-export-download").click()]);
    assert(/bf-personal-app-export-.*\.zip$/.test(download.suggestedFilename()), download.suggestedFilename());
    await until(async () => !!(await one("select exported_at from monthly_reviews where month = $1", [lastMonth]))?.exported_at, "export noted");
    // Change Network outreach to 12 and make Brokers contacted a commitment.
    const outreach = page.getByTestId("monthly-next-row").filter({ hasText: "Network outreach" });
    await outreach.getByTestId("monthly-next-number").fill("12");
    const brokers = page.getByTestId("monthly-next-row").filter({ hasText: "Brokers contacted" });
    await brokers.getByTestId("monthly-next-commitment").check({ force: true });
    await page.getByTestId("monthly-finish").click();
    await page.getByTestId("monthly-finished").waitFor({ timeout: 30000 });
    const t = await all("select name, minimum_count n, is_commitment c from targets where archived_at is null and name in ('Network outreach', 'Brokers contacted') order by name");
    assert(t[0].c === true && t[1].n === 12, JSON.stringify(t));
    const r = await one("select finished_at, jsonb_array_length(results) a, jsonb_array_length(next_targets) b from monthly_reviews where month = $1", [lastMonth]);
    assert(r.finished_at && r.a === 6 && r.b === 6, JSON.stringify(r));
    await page.reload();
    await page.getByTestId("monthly-as-set").waitFor();
    assert((await page.getByTestId("monthly-finish").count()) === 0 && (await page.getByTestId("monthly-next-number").count()) === 0, "read only");
    assert((await page.getByTestId("monthly-as-set-row").filter({ hasText: "Network outreach" }).innerText()).includes("12"), "as set");
    await page.goto(`${BASE}/work`);
    await pickTile("today");
    assert((await page.getByTestId("monthly-review-home-row").count()) === 0, "the row left Work on now");
  });

  await step("Reports > Monthly reviews: each month's review; a finished one opens read only", async () => {
    await page.goto(`${BASE}/work/reports?view=monthly`);
    await page.getByTestId("monthly-reviews-card").waitFor();
    const rows = await page.getByTestId("monthly-review-row").evaluateAll((els) => els.map((e) => [e.getAttribute("data-month"), e.getAttribute("data-finished")]));
    assert(rows.length === 2 && rows[0][0] === slug && rows.every((x) => x[1] === "1"), JSON.stringify(rows));
    await shot(page, "reports-monthly-reviews.png");
    await page.getByTestId("monthly-review-row").nth(1).click();
    await page.getByTestId("monthly-as-set").waitFor();
    assert((await page.getByTestId("monthly-crumb").innerText()) === "Reports", "crumb");
    assert(/Read only/.test(await page.getByTestId("monthly-read-only-line").innerText()), "read only line");
  });

  // ---------- Settings ----------
  await step("Settings: one page with Gmail and Google Calendar (the calendar line), Work settings, stage defaults, Buy box, AI, Profile and export", async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByTestId("google-card").waitFor();
    assert((await page.getByTestId("conn-calendar").innerText()).includes("Shows your events, adds the time you block"), "calendar line");
    assert((await page.getByTestId("conn-gmail").getAttribute("data-perm")) === "allowed", "gmail allowed");
    for (const id of ["work-settings", "stage-defaults", "settings-buy-box", "settings-ai", "settings-profile"]) assert(await page.getByTestId(id).isVisible(), id);
    const tops = await page.locator("[data-testid=google-card] h2, [data-testid=work-settings] h2").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert(tops[0] === tops[1], `titles at ${tops}`);
    assert(/^AI this month: \$\d+\.\d\d of \$\d+\.\d\d$/.test((await page.getByTestId("ai-spend-line").innerText()).trim()), "AI line");
  });

  await step("Work settings save: waiting threshold, outreach target, End of day time (the badge follows), default block length", async () => {
    await page.getByTestId("work-threshold").fill("6");
    await page.getByTestId("work-outreach").fill("12");
    await page.getByTestId("work-eod-time").fill("17:45");
    await page.getByTestId("work-block-minutes").fill("45");
    await page.locator("#s-work").scrollIntoViewIfNeeded();
    await shot(page, "settings-work-settings.png");
    await page.getByTestId("work-settings-save").click();
    await until(async () => (await page.getByTestId("work-settings-note").count()) && (await page.getByTestId("work-settings-note").innerText()) === "Saved", "saved");
    const v = await all("select key, value_number::float n, value_text t from inputs where key in ('waiting_threshold_days', 'outreach_weekly_target', 'end_of_day_time') order by key");
    const b = await one("select default_block_minutes m from owner_profile");
    assert(JSON.stringify(v.map((x) => x.n ?? x.t)) === JSON.stringify(["17:45", 12, 6]) && b.m === 45, JSON.stringify([v, b]));
    await page.goto(`${BASE}/work`);
    assert((await page.getByTestId("now-wait").innerText()).includes("Amber at 6 days, red at 12"), "the waiting line follows");
    await page.goto(`${BASE}/work/targets`);
    const badge = await page.getByTestId("subnav-eod-badge").getAttribute("data-badge");
    assert(badge === "Sent" || badge === "5:45", `badge ${badge}`);
    // Back to the defaults.
    await page.goto(`${BASE}/settings`);
    await page.getByTestId("work-threshold").fill("5");
    await page.getByTestId("work-outreach").fill("10");
    await page.getByTestId("work-eod-time").fill("17:30");
    await page.getByTestId("work-block-minutes").fill("60");
    await page.getByTestId("work-settings-save").click();
    await until(async () => (await one("select default_block_minutes m from owner_profile")).m === 60, "back");
    // A bad value says so and saves nothing.
    await page.getByTestId("work-block-minutes").fill("2");
    await page.getByTestId("work-settings-save").click();
    await until(async () => /Default block length/.test((await page.getByTestId("work-settings-note").innerText().catch(() => "")) || ""), "the error");
    await page.getByTestId("work-block-minutes").fill("60");
  });

  await step("Pipelines and stage defaults: the table per pipeline; Save changes the default next action", async () => {
    await page.goto(`${BASE}/settings`);
    const row = page.getByTestId("stage-default-row").filter({ hasText: "NDA signed" });
    await row.getByTestId("stage-default-title").fill("Ask the broker for the CIM and the last 3 years of P&Ls");
    await row.getByTestId("stage-default-due").fill("2");
    await page.getByTestId("stage-defaults-save").click();
    await until(async () => (await one("select t.title, t.due_in_days d from stage_tasks t join pipeline_stages s on s.id = t.pipeline_stage_id where s.name = 'NDA signed' and t.is_next_action_default")).d === 2, "saved");
    await page.getByTestId("pipeline-job").click();
    assert((await page.getByTestId("stage-defaults-table").getAttribute("data-pipeline")) === "job", "job table");
    assert((await page.getByTestId("stage-default-row").filter({ hasText: "Interview" }).count()) === 1, "job stages");
    await page.getByTestId("pipeline-consulting").click();
    assert((await page.getByTestId("stage-default-row").filter({ hasText: "Proposal" }).count()) === 1, "consulting stages");
    await page.getByTestId("ai-cap-input").fill("20");
    await page.getByTestId("ai-cap-save").click();
    await until(async () => Number((await one("select value_number from inputs where key = 'ai_monthly_cap_usd'"))?.value_number) === 20, "cap saved");
    await page.getByTestId("ai-cap-input").fill("25");
    await page.getByTestId("ai-cap-save").click();
    await until(async () => Number((await one("select value_number from inputs where key = 'ai_monthly_cap_usd'"))?.value_number) === 25, "cap back");
  });

  await step("Remove sample data clears the monthly reviews, the Weekly review answers, and the to-do with an end date; real ones stay", async () => {
    await page.goto(`${BASE}/settings/data`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sample-remove").click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /Remove/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
    for (let i = 0; i < 60 && (await one("select count(*)::int n from sample_records")).n; i++) await page.waitForTimeout(500);
    const left = await one("select (select count(*)::int from sample_records) s, (select count(*)::int from monthly_reviews) m, (select count(*)::int from end_of_day where weekly_review <> '{}'::jsonb and day <> $1) w, (select count(*)::int from deal_todos where text = 'Post the job search update in the alumni group') t, (select count(*)::int from deal_todos where text = 'Water the office plants') real", [today]);
    // The review finished in this run was a sample row (it is removed); today's End of day is real and stays.
    assert(left.s === 0 && left.m === 0 && left.w === 0 && left.t === 0 && left.real === 1, JSON.stringify(left));
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

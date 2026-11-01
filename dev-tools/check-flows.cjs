// LOCAL TESTING ONLY. Clicks through the main workflows against the local mock and reports each step.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
// The Work module (2026-10-30): "/" opens Work on now (/work); Today is at /today; the previous home page with its tiles
// and cards is at /more/old-home.
const OLD_HOME = `${BASE}/more/old-home`;
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
    // Under the fake clock the page's Date is set again at every step: a page in the background counts time slowly.
    if (process.env.FAKETIME && global.__page) await global.__page.context().clock.setSystemTime(Date.now()).catch(() => null);
    await fn();
    results.push(["ok  ", name]);
    process.stderr.write(`ok   ${name}\n`);
  } catch (e) {
    results.push(["FAIL", `${name}: ${e.message.split("\n")[0]}`]);
    process.stderr.write(`FAIL ${name}: ${e.message.split("\n")[0]}\n`);
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
// Under the fake clock the pages still see the fake date (the Log a call drawer's "now", date pickers): every new
// context starts its Date at this process's (fake) time and lets it run, with the browser's own timers left real.
const fakeBrowserDate = (browser) => {
  if (!process.env.FAKETIME) return;
  const raw = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const c = await raw(options);
    await c.clock.setSystemTime(Date.now());
    return c;
  };
};
const expectText = async (page, text) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 15000 });
  } catch {
    throw new Error(`text not shown: "${text}" on ${page.url()}`);
  }
};

(async () => {
  // The browser keeps the real clock even under dev-tools/late-evening.sh: libfaketime makes Chromium's own timers
  // unsteady (clicks and waits stall for seconds), and the app's "today" comes from the server, which runs on the fake clock.
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  fakeBrowserDate(browser);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addCookies([cookie]);
  await routeSignatureImage(ctx);
  const page = await ctx.newPage();
  global.__page = page;
  page.on("dialog", (d) => d.accept());
  // Database checks (local Postgres).
  const pg = new (require("pg").Client)({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
  await pg.connect();
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];

  await step("Resolve a missed commitment with a reason and new date (count bar, Resolve opens the task window with Resolve open)", async () => {
    await page.goto(`${BASE}/accountability`);
    // Three tiles: To resolve, Open (with "N due this week"), Met. No "Due this week" tile.
    const tiles = await page.getByTestId("commitment-counts").locator("a").count();
    if (tiles !== 3 || (await page.getByTestId("count-week").count())) throw new Error(`expected 3 tiles, found ${tiles}`);
    if (!/\d+ due this week/.test(await page.getByTestId("count-open").innerText())) throw new Error("Open tile note");
    const tile = Number((await page.getByTestId("count-resolve").locator("p").nth(1).innerText()).trim());
    const before = await page.getByTestId("commitment-resolve").count();
    if (!before) throw new Error("no missed commitments to resolve");
    if (tile < before) throw new Error(`To resolve tile ${tile}, Resolve buttons ${before}`);
    // Missed rows that need a reason come first.
    const statuses = await page.getByTestId("commitment-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    const firstOther = statuses.findIndex((x) => x !== "missed");
    if (firstOther >= 0 && statuses.slice(firstOther).includes("missed")) throw new Error(`order: ${statuses.join(",")}`);
    await page.getByTestId("commitment-resolve").first().click();
    await page.waitForURL(/w=r(%2F|\/)commitments(%2F|\/)[0-9a-f-]{36}(%2F|\/)resolve/);
    const win = page.locator("[data-url-window]");
    await win.getByTestId("resolve-form").waitFor({ timeout: 20000 });
    await win.getByTestId("resolve-new-date").check();
    await win.getByLabel(/Why was it missed/).fill("Spent the afternoon on the broker call.");
    await win.getByTestId("resolve-save").click();
    await win.waitFor({ state: "detached", timeout: 20000 });
    await page.getByTestId("page-flash").waitFor();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="commitment-resolve"]').length === n, before - 1, { timeout: 15000 }).catch(() => {});
    const after = await page.getByTestId("commitment-resolve").count();
    if (after !== before - 1) throw new Error(`expected ${before - 1} left, found ${after}`);
    // A tile applies its filter in the address and is shown as the active one.
    await page.getByTestId("count-open").click();
    await page.waitForURL(/status=open/);
    if ((await page.getByTestId("count-open").getAttribute("aria-current")) !== "true") throw new Error("Open tile not active");
    const shown = await page.getByTestId("commitment-row").count();
    const want = (await one("select count(*)::int n from commitments where status = 'open'")).n;
    if (shown !== want) throw new Error(`open rows ${shown}, want ${want}`);
    // Open rows due soon have a small label (Due today or This week).
    const soon = (await one("select count(*)::int n from commitments where status = 'open' and due_date between $1 and $2", [nyDate(0), nyDate(7)])).n;
    const labels = await page.getByTestId("commitment-when").count();
    if (labels !== soon) throw new Error(`due-soon labels ${labels}, want ${soon}`);
    // Older links (?miss=<id> and ?w=resolve/<id>) open the task window with Resolve open.
    const m = await one("select id from missed_commitments where resolution = 'pending' limit 1");
    if (m) {
      await page.goto(`${BASE}/accountability?miss=${m.id}`);
      await page.locator("[data-url-window] [data-testid=task-window-resolve-section]").waitFor({ timeout: 20000 });
      await page.waitForURL(/w=r(%2F|\/)commitments/);
      await page.goto(`${BASE}/accountability?w=resolve/${m.id}`);
      await page.locator("[data-url-window] [data-testid=resolve-form]").waitFor({ timeout: 20000 });
    }
  });

  await step("Resolve via Done late from the Commitments list: task window with Resolve open, other sections closed; task done on that date; still a miss", async () => {
    // A task commitment missed yesterday, with a miss that needs a reason.
    const t = await one("insert into tasks (owner_id, title, due_date, priority) values ($1, 'Send the LOI draft to the broker', $2, 2) returning id", [OWNER, nyDate(-1)]);
    const c0 = await one("insert into commitments (owner_id, title, record_type, record_id, due_date, original_due_date, status, miss_count) values ($1, 'Send the LOI draft to the broker', 'tasks', $2, $3, $3, 'missed', 1) returning id", [OWNER, t.id, nyDate(-1)]);
    await pg.query("insert into missed_commitments (owner_id, commitment_id, missed_on) values ($1, $2, $3)", [OWNER, c0.id, nyDate(-1)]);
    await page.goto(`${BASE}/accountability`);
    const row = page.locator("[data-testid=commitment-row]", { hasText: "Send the LOI draft to the broker" });
    const href = await row.getByTestId("commitment-resolve").getAttribute("href");
    const missId = href.match(/resolve\/([0-9a-f-]{36})/)[1];
    const before = await one("select c.id, c.record_type, c.record_id, m.missed_on::text missed_on from missed_commitments m join commitments c on c.id = m.commitment_id where m.id = $1", [missId]);
    await row.getByTestId("commitment-resolve").click();
    const win = page.locator("[data-url-window]");
    await win.getByTestId("resolve-form").waitFor({ timeout: 20000 });
    // Resolve this miss is open at the top; every other section is closed.
    const sections = await win.locator("section[data-testid]").evaluateAll((els) => els.filter((e) => e.querySelector("[data-testid=collapsible-toggle]")).map((e) => [e.getAttribute("data-testid"), e.hasAttribute("data-open")]));
    if (!sections.length || sections[0][0] !== "task-window-resolve-section" || !sections[0][1]) throw new Error(`first section: ${JSON.stringify(sections[0])}`);
    const openOthers = sections.slice(1).filter(([, o]) => o);
    if (openOthers.length) throw new Error(`open sections: ${JSON.stringify(openOthers)}`);
    // Done late is the first choice; the date defaults to today and cannot be in the future.
    if (!(await win.getByTestId("resolve-done-late").isChecked())) throw new Error("Done late not chosen first");
    if ((await win.getByTestId("resolve-done-on").inputValue()) !== nyDate(0)) throw new Error("done date default");
    if ((await win.getByTestId("resolve-done-on").getAttribute("max")) !== nyDate(0)) throw new Error("done date max");
    if ((await win.getByTestId("resolve-done-on").getAttribute("min")) !== before.missed_on) throw new Error("done date min");
    await page.screenshot({ path: path.join(OUT, "flow-resolve-done-late.png") });
    // A reason is required.
    await win.getByTestId("resolve-save").click();
    if (!(await win.getByTestId("resolve-form").isVisible())) throw new Error("saved without a reason");
    await win.getByLabel(/Why was it missed/).fill("Sent it the next morning.");
    await win.getByTestId("resolve-done-on").fill(nyDate(0));
    await win.getByTestId("resolve-note").fill("The broker asked for one more day.");
    await win.getByTestId("resolve-save").click();
    await win.waitFor({ state: "detached", timeout: 20000 });
    await expectText(page, "Marked done late");
    const m = await one("select resolution, done_on::text done_on, reason from missed_commitments where id = $1", [missId]);
    if (m.resolution !== "done_late" || m.done_on !== nyDate(0) || m.reason !== "Sent it the next morning.") throw new Error(`miss: ${JSON.stringify(m)}`);
    const c = await one("select status from commitments where id = $1", [before.id]);
    if (c.status !== "done_late") throw new Error(`commitment: ${c.status}`);
    if (before.record_type === "tasks") {
      const t = await one("select status, (completed_at at time zone 'America/New_York')::date::text d from tasks where id = $1", [before.record_id]);
      if (t.status !== "done" || t.d !== nyDate(0)) throw new Error(`task: ${JSON.stringify(t)}`);
    }
    // The Misses table shows the label; the Done late filter value lists it.
    await page.goto(`${BASE}/accountability?status=done_late`);
    await page.locator("[data-testid=commitment-row][data-status=done_late]").first().waitFor();
    const label = (await page.getByTestId("miss-resolution").allInnerTexts()).find((x) => x.startsWith("Done late, "));
    if (!label) throw new Error("Misses table label");
    await page.screenshot({ path: path.join(OUT, "flow-commitments-done-late.png"), fullPage: true });
  });

  await step("Open the decision created by the missed milestone and choose an option", async () => {
    await page.goto(`${BASE}/plan/decisions`);
    await page.locator("table a").first().click();
    await expectText(page, "Options");
    await page.screenshot({ path: path.join(OUT, "flow-decision.png"), fullPage: true });
    await page.getByRole("button", { name: "Choose this option" }).first().click();
    await expectText(page, "Chosen");
  });

  await step("Old Home: grouped alerts open the filtered pipeline list", async () => {
    await page.goto(OLD_HOME);
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
    // The reason given in the daily close is filled in when the resolve window opens.
    const pend = await one("select id, reason from missed_commitments where resolution = 'pending' and reason like '%broker call ran all afternoon%' limit 1");
    if (!pend) throw new Error("no pending miss with the shared reason");
    await page.goto(`${BASE}/accountability`);
    await page.locator(`[data-testid=commitment-resolve][data-window$="/resolve/${pend.id}"]`).click();
    const v = await page.locator("[data-url-window]").getByLabel(/Why was it missed/).inputValue();
    if (!v.includes("broker call ran all afternoon")) throw new Error(`reason: ${v}`);
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
    await page.locator('select[name="stage_id"]').selectOption({ label: "8. IOI or LOI" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await expectText(page, "Not moved to IOI or LOI");
    await expectText(page, "Asking price");
    await page.screenshot({ path: path.join(OUT, "flow-stage-blocked.png"), fullPage: true });
  });

  await step("Log a CIM request on an acquisition item (Deals advanced)", async () => {
    await page.getByRole("button", { name: "Log it" }).click();
    await expectText(page, "CIM request logged.");
  });

  await step("Stage time limit decision: Extend adds days for the item", async () => {
    await page.goto(`${BASE}/plan/decisions`);
    await page.getByRole("link", { name: /Demo Pest Control: \d+ days in Interested/ }).first().click();
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

  await step("Old Home after jobs (plan written, alerts)", async () => {
    await page.goto(OLD_HOME);
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
    // "/" goes to Work on now; wait for the page to settle so the click lands after hydration.
    await page.waitForURL(/\/work$/);
    await page.waitForLoadState("networkidle");
    await page.locator("aside").getByRole("button", { name: "Open AI chat" }).click();
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
  const homeLink = () => page.locator("aside a[href='/work']").filter({ hasText: "Work" }).first();
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
    await page.waitForURL(/\/work$/);
  });

  await step("Unsaved changes: Leave without saving goes and keeps the old value", async () => {
    await page.goto(itemEdit);
    const original = await page.inputValue('textarea[name="notes"]');
    await page.fill('textarea[name="notes"]', "Not saved value");
    await homeLink().click();
    await page.getByTestId("unsaved-leave").click();
    await page.waitForURL(/\/work$/);
    await page.goto(itemEdit);
    if ((await page.inputValue('textarea[name="notes"]')) !== original) throw new Error("value was saved");
  });

  await step("Unsaved changes: Save and leave saves, then opens the link", async () => {
    await page.goto(itemEdit);
    await page.fill('textarea[name="notes"]', "Saved by Save and leave");
    await homeLink().click();
    await page.getByTestId("unsaved-save").click();
    await page.waitForURL(/\/work$/);
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
    // The Consulting stages since database update 0022: Lead (default "Find out what they need and who decides"), Proposal, Engagement, Paid, Done, Lost.
    await expectText(page, "Find out what they need and who decides");
    await page.locator('select[name="stage_id"]').selectOption({ label: "2. Proposal" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await expectText(page, "Not moved to Proposal");
    await expectText(page, "Rate type");
    const terms = page.locator("#item-details");
    await terms.locator('select[name="rate_type"]').selectOption("project");
    await terms.locator('input[name="rate"]').fill("9000");
    await terms.locator('input[name="project_months"]').fill("3");
    await terms.getByRole("button", { name: "Save terms" }).click();
    await page.waitForLoadState("networkidle");
    await expectText(page, "$3,000");
    await page.locator('select[name="stage_id"]').selectOption({ label: "2. Proposal" });
    await page.getByRole("button", { name: "Move to stage" }).click();
    await page.waitForLoadState("networkidle");
    await expectText(page, "Send the scope and fee");
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
    await page.goto(OLD_HOME);
    await expectText(page, "Signed consulting income is not counted");
    const before = await page.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.trim() === "Runway")?.nextElementSibling?.textContent ?? "");
    await page.goto(`${BASE}/plan/inputs`);
    const form = page.locator("form:has(input[aria-label^='Count signed consulting income in runway'])");
    await form.locator("input[name='value']").fill("1");
    await form.getByRole("button", { name: "Save" }).click();
    await page.waitForLoadState("networkidle");
    await page.goto(OLD_HOME);
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
    // Up to nine stages fit at 1280; the acquisition board has twelve since database update 0020 and may scroll inside its box.
    const inner = await board.evaluate((e) => e.scrollWidth - e.clientWidth);
    const stageCount = await board.locator("section[aria-label]").count();
    if (inner > 0 && stageCount <= 9) throw new Error(`board scrolls inside its box by ${inner}px at 1280 (all stages should fit)`);
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
    await page.waitForURL(/\/work$/);
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
    await page.waitForURL(/\/work$/);
  });


  // ---------- Send email from the app (Google stand-in on :54329, see dev-tools/mock-supabase.mjs) ----------
  const GMOCK = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
  const gpost = async (pathName, body = {}) => (await fetch(`${GMOCK}${pathName}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const gsent = async () => (await fetch(`${GMOCK}/__sent`)).json();
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
    const id = (await one("select id from partner_reports where status = 'finalized' and report_kind = 'regular' order by finalized_at desc limit 1")).id;
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

  // ---------- Daily partner reports (database update 0018) ----------
  const weekday = ![0, 6].includes(new Date(`${nyDate(0)}T12:00:00Z`).getUTCDay());
  let dailyCommId = null;
  await step("Daily close then approve and send the daily report (Google stand-in); Not today for the other partner", async () => {
    // Two partners get daily reports (Both and Daily); today's close is opened again and completed.
    for (const [name, email] of [["Partner One (pseudonym)", "partner-one@example.com"], ["Partner Two (pseudonym)", "partner-two@example.com"]]) {
      if (!(await one("select 1 x from partners where name = $1", [name]))) await pg.query("insert into partners (owner_id, name, is_pseudonym, email) values ($1, $2, true, $3)", [OWNER, name, email]);
    }
    const partners = (await pg.query("select id, name from partners where is_active and email is not null order by name limit 2")).rows;
    if (partners.length < 2) throw new Error("need two partners with an email address");
    await pg.query("update partners set report_frequency = 'both' where id = $1", [partners[0].id]);
    await pg.query("update partners set report_frequency = 'daily' where id = $1", [partners[1].id]);
    await pg.query("delete from partner_reports where report_kind = 'daily'");
    await pg.query("update reviews set status = 'draft', completed_at = null where kind = 'daily' and period_start = $1", [nyDate(0)]);
    // The frequency shows on Report templates.
    await page.goto(`${BASE}/accountability/report-templates`);
    if ((await page.getByTestId("partner-frequency").first().inputValue()) !== "both") throw new Error("frequency select");
    await page.goto(`${BASE}/accountability/reviews`);
    await page.getByRole("button", { name: "Open today's daily close" }).click();
    await page.waitForURL(/\/accountability\/reviews\/.+/);
    await page.getByRole("button", { name: "Complete review" }).waitFor();
    if (await page.locator('input[name="a_shared_reason"]').count()) {
      await page.fill('input[name="a_shared_reason"]', "The broker call ran all afternoon.");
      for (const box of await page.locator('input[name^="a_use_shared_"]').all()) await box.check();
    }
    await page.getByRole("button", { name: "Complete review" }).click();
    await expectText(page, "Completed");
    if (!weekday) {
      if (await page.getByTestId("daily-reports-card").count()) throw new Error("daily reports drafted on a weekend");
      return;
    }
    await page.getByTestId("daily-reports-card").waitFor({ timeout: 20000 });
    const drafts = (await one("select count(*)::int n from partner_reports where report_kind = 'daily' and period_end = $1 and status = 'draft'", [nyDate(0)])).n;
    if (drafts !== 2) throw new Error(`expected 2 daily drafts, found ${drafts}`);
    if ((await page.getByTestId("daily-report").count()) !== 2) throw new Error("two previews");
    const frame = page.getByTestId("daily-preview").first().contentFrame();
    await frame.getByText("Daily accountability report").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-daily-close-reports.png"), fullPage: true });
    // Nothing was sent yet.
    const sentBefore = (await gsent()).length;
    // Edit note on the first, then Approve and send; Not today on the second.
    const first = page.getByTestId("daily-report").filter({ hasText: partners[0].name });
    await first.getByTestId("daily-edit-note").click();
    await first.getByTestId("daily-note").fill("- Two broker calls moved to Monday.");
    await first.getByTestId("daily-note-save").click();
    await first.getByTestId("daily-message").filter({ hasText: "Note saved" }).waitFor();
    await first.getByTestId("daily-preview").contentFrame().getByText("Two broker calls moved to Monday.").waitFor();
    await first.getByTestId("daily-send").click();
    await page.getByTestId("daily-report").filter({ hasText: partners[0].name }).and(page.locator("[data-state=sent]")).waitFor({ timeout: 20000 });
    const second = page.getByTestId("daily-report").filter({ hasText: partners[1].name });
    await second.getByTestId("daily-skip").click();
    await page.getByTestId("daily-report").filter({ hasText: partners[1].name }).and(page.locator("[data-state=skipped]")).waitFor({ timeout: 20000 });
    const sent = await gsent();
    if (sent.length !== sentBefore + 1) throw new Error(`expected 1 email, Gmail got ${sent.length - sentBefore}`);
    const r = await one("select id, status, sent_at, gmail_message_id, summary from partner_reports where report_kind = 'daily' and partner_id = $1 and period_end = $2", [partners[0].id, nyDate(0)]);
    if (r.status !== "finalized" || !r.sent_at || !r.summary.includes("Two broker calls")) throw new Error(`report: ${JSON.stringify(r)}`);
    const skipped = await one("select status, skipped_at from partner_reports where report_kind = 'daily' and partner_id = $1", [partners[1].id]);
    if (skipped.status !== "draft" || !skipped.skipped_at) throw new Error(`skipped: ${JSON.stringify(skipped)}`);
    const comm = await one("select id, subject from communications where gmail_message_id = $1", [r.gmail_message_id]);
    if (!comm || !comm.subject.startsWith("Daily accountability report")) throw new Error(`communication: ${JSON.stringify(comm)}`);
    if (!(await one("select 1 x from record_links where from_type = 'communications' and from_id = $1 and to_type = 'partner_reports' and to_id = $2", [comm.id, r.id]))) throw new Error("not linked to the report");
    dailyCommId = comm.id;
    await page.screenshot({ path: path.join(OUT, "flow-daily-close-reports-sent.png"), fullPage: true });
    // The close again on the same day drafts nothing new.
    if ((await one("select count(*)::int n from partner_reports where report_kind = 'daily'")).n !== 2) throw new Error("duplicate daily reports");
  });

  await step("A sent partner report opens from Communications as the report, in the full page and in the window", async () => {
    const commId = dailyCommId ?? (await one("select from_id from record_links where from_type = 'communications' and to_type = 'partners' order by created_at desc limit 1"))?.from_id;
    if (!commId) throw new Error("no sent report communication");
    const subject = (await one("select subject from communications where id = $1", [commId])).subject;
    await page.goto(`${BASE}/people/communications`);
    await page.locator("main tr", { hasText: subject }).locator("a").first().click();
    await page.waitForURL(new RegExp(`/records/communications/${commId}`));
    await page.getByTestId("sent-report-card").waitFor();
    await page.getByTestId("sent-report-frame").contentFrame().getByText(/accountability report/i).first().waitFor();
    if (await page.getByTestId("sent-report-details").getAttribute("data-open") !== null) throw new Error("details should start closed");
    for (const t of ["panel-linked", "panel-notes", "panel-history"]) if ((await page.getByTestId(t).getAttribute("data-open")) !== null) throw new Error(`${t} should start closed`);
    const pdf = await page.getByTestId("sent-report-pdf").getAttribute("href");
    const res = await page.request.get(`${BASE}${pdf}`);
    if (res.status() !== 200 || !(res.headers()["content-type"] ?? "").includes("pdf")) throw new Error("PDF link");
    await page.screenshot({ path: path.join(OUT, "flow-communication-report.png"), fullPage: true });
    await page.getByTestId("sent-report-record").click();
    await page.waitForURL(/\/accountability\/reports\/[0-9a-f-]{36}/);
    // The window (a communication opened inside a window).
    await page.goto(`${BASE}/people/communications?w=r/communications/${commId}`);
    const win = page.locator("[data-url-window]");
    await win.getByTestId("sent-report-view").waitFor({ timeout: 20000 });
    await win.getByTestId("sent-report-frame").contentFrame().getByText(/accountability report/i).first().waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-communication-report-window.png") });
    await ph.goto(`${BASE}/records/communications/${commId}`);
    await ph.getByTestId("sent-report-card").waitFor();
    await ph.screenshot({ path: path.join(OUT, "phone-communication-report.png"), fullPage: true });
  });


  // ---------- Email button (contacts, organizations, pipeline items) and "Email them" (Outreach Queue) ----------
  const e1280ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await e1280ctx.addCookies([cookie]);
  await routeSignatureImage(e1280ctx);
  const e1280 = await e1280ctx.newPage();
  const EVIEWS = [["desktop", page], ["desktop1280", e1280], ["phone", ph]];
  const composeTo = (pg_) => pg_.getByTestId("compose-to").inputValue();
  const commByGmail = (id) => one("select * from communications where gmail_message_id = $1", [id]);

  // ---------- The focused version, batch 1: Today, Close the day (dev-tools/check-flows.cjs runs these on the demo data) ----------

  await step("Morning plan: three outcomes incl. one picked from next actions", async () => {
    await pg.query("delete from daily_outcomes where plan_date = $1", [nyDate(0)]);
    // The day is open again when an earlier step completed the old daily close.
    await pg.query("update reviews set status = 'draft', completed_at = null, answers = '{}'::jsonb where kind = 'daily' and period_start = $1", [nyDate(0)]);
    await page.goto(`${BASE}/today`);
    await page.getByTestId("today").waitFor();
    await page.getByTestId("close-day").first().waitFor();
    // The menu: Work, Accountability, More (Today is under More). No tiles, no tabs on Today.
    const menu = await page.locator("aside nav[aria-label='Main menu'] > div > a").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (menu.join(",") !== "Work,Accountability,More") throw new Error(`menu: ${menu.join(",")}`);
    if (await page.locator("main").getByTestId("home-next-review").count()) throw new Error("tiles on Today");
    // Focused hours.
    await page.getByTestId("focused-hours-input").fill("4");
    await page.getByTestId("focused-hours-input").press("Enter");
    await page.waitForFunction(() => true);
    // Outcome 1 typed; blur saves it.
    const rows = page.getByTestId("outcome-row");
    await rows.nth(0).getByTestId("outcome-title").fill("Review the Dalton CIM");
    await rows.nth(0).getByTestId("outcome-block").fill("90");
    await rows.nth(0).getByTestId("outcome-block").press("Tab");
    await page.getByTestId("outcomes-note").filter({ hasText: "Saved" }).waitFor({ timeout: 15000 });
    // Outcome 2 picked from next actions: fills the next empty row with the title and the link, and leaves the list.
    const firstPick = page.getByTestId("pick-row").first();
    const pickTitle = (await firstPick.locator("span").first().innerText()).split(" (")[0].trim();
    await firstPick.getByTestId("pick-add").click();
    await page.waitForFunction((t) => document.querySelectorAll("[data-testid=outcome-title]")[1]?.value.startsWith(t), pickTitle, { timeout: 15000 }).catch(async () => {
      throw new Error(`pick "${pickTitle}" not in row 2: ${JSON.stringify(await page.getByTestId("outcome-title").evaluateAll((els) => els.map((e) => e.value)))}`);
    });
    await page.waitForFunction((t) => ![...document.querySelectorAll("[data-testid=pick-row]")].some((r) => r.querySelector("span").innerText.split(" (")[0].trim() === t), pickTitle, { timeout: 15000 }).catch(() => {
      throw new Error(`pick "${pickTitle}" still listed`);
    });
    // Outcome 3 typed with an initiative.
    await rows.nth(2).getByTestId("outcome-title").fill("Call two brokers about new listings");
    const init = rows.nth(2).getByTestId("outcome-initiative");
    await init.selectOption({ label: "Acquisition Search" });
    await rows.nth(2).getByTestId("outcome-title").press("Enter");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=pick-list]").length === 0, null, { timeout: 15000 }).catch(() => {
      throw new Error("the pick list is still shown with three outcomes");
    });
    // Saved in the database with the links.
    await page.waitForFunction(() => true);
    const saved = await new Promise((r) => setTimeout(r, 1500)).then(() => pg.query("select position, title, block_minutes, initiative_id, task_id, pipeline_item_id from daily_outcomes where plan_date = $1 order by position", [nyDate(0)]));
    if (saved.rows.length !== 3) throw new Error(`outcomes saved: ${saved.rows.length}`);
    if (saved.rows[0].title !== "Review the Dalton CIM" || saved.rows[0].block_minutes !== 90) throw new Error(`row 1: ${JSON.stringify(saved.rows[0])}`);
    if (!saved.rows[1].task_id && !saved.rows[1].pipeline_item_id) throw new Error("picked outcome has no link");
    if (!saved.rows[2].initiative_id) throw new Error("row 3 has no initiative");
    const hours = await one("select focused_hours from daily_plans where plan_date = $1", [nyDate(0)]);
    if (Number(hours?.focused_hours) !== 4) throw new Error(`focused hours: ${JSON.stringify(hours)}`);
    // A reload shows the same three outcomes and no pick list.
    await page.reload();
    await page.getByTestId("today").waitFor();
    if ((await page.getByTestId("outcome-title").nth(0).inputValue()) !== "Review the Dalton CIM") throw new Error("outcome lost on reload");
    if ((await page.getByTestId("focused-hours-input").inputValue()) !== "4") throw new Error("focused hours lost on reload");
    // Today's activity: +1 on a target counted by hand.
    const row = page.getByTestId("activity-row").filter({ hasText: "Listings screened" });
    const before = Number((await row.getByTestId("activity-count").innerText()).match(/(\d+) of/)[1]);
    await row.getByTestId("activity-plus").click();
    await page.waitForFunction(([n]) => {
      const r = [...document.querySelectorAll("[data-testid=activity-row]")].find((e) => e.innerText.includes("Listings screened"));
      return r && r.querySelector("[data-testid=activity-count]").innerText.startsWith(`${n + 1} of`);
    }, [before], { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, "flow-today-morning.png"), fullPage: true });
  });

  await step("Close the day: three steps, resolve a miss in step 2, send the report through the Google stand-in in step 3, Today then shows Day closed", async () => {
    // A commitment missed yesterday with a pending reason (resolved in step 2), partners set to Daily and Both.
    await pg.query("update reviews set status = 'draft', completed_at = null, answers = '{}'::jsonb where kind = 'daily' and period_start = $1", [nyDate(0)]);
    // Only drafts can be deleted (a report sent by an earlier step stays and shows as Sent); the two partners of this step get fresh drafts.
    await pg.query("delete from partner_reports where report_kind = 'daily' and period_end = $1 and status = 'draft' and sent_at is null", [nyDate(0)]);
    await pg.query("update daily_plans set changes_note = null, tomorrow_priority = null where plan_date = $1", [nyDate(0)]);
    await pg.query("delete from missed_commitments where commitment_id in (select id from commitments where title = 'Send the model to the lender')");
    await pg.query("delete from commitments where title = 'Send the model to the lender'");
    await pg.query("delete from tasks where title = 'Send the model to the lender'");
    const t = await one("insert into tasks (owner_id, title, due_date, priority) values ($1, 'Send the model to the lender', $2, 2) returning id", [OWNER, nyDate(-1)]);
    const c0 = await one("insert into commitments (owner_id, title, record_type, record_id, due_date, original_due_date, status, miss_count) values ($1, 'Send the model to the lender', 'tasks', $2, $3, $3, 'missed', 1) returning id", [OWNER, t.id, nyDate(-1)]);
    await pg.query("insert into missed_commitments (owner_id, commitment_id, missed_on) values ($1, $2, $3)", [OWNER, c0.id, nyDate(-1)]);
    for (const [name, email] of [["Partner Three (pseudonym)", "partner-three@example.com"], ["Partner Four (pseudonym)", "partner-four@example.com"]]) {
      if (!(await one("select 1 x from partners where name = $1", [name]))) await pg.query("insert into partners (owner_id, name, is_pseudonym, email) values ($1, $2, true, $3)", [OWNER, name, email]);
    }
    await pg.query("update partners set report_frequency = 'weekly' where report_frequency <> 'weekly'");
    await pg.query("update partners set report_frequency = 'both' where name = 'Partner Three (pseudonym)'");
    await pg.query("update partners set report_frequency = 'daily' where name = 'Partner Four (pseudonym)'");
    const partners = (await pg.query("select id, name, report_frequency from partners where is_active and email is not null and report_frequency in ('daily', 'both') order by name")).rows;
    if (partners.length !== 2) throw new Error("need two partners set to daily reports");
    await page.goto(`${BASE}/today`);
    await page.getByTestId("close-day").first().click();
    await page.waitForURL(/\/today\/close\?step=1/);
    // Step 1: outcomes with Complete, Partial, Incomplete and a result line.
    if ((await page.getByTestId("close-step-1").getAttribute("data-active")) !== "true") throw new Error("step 1 not active");
    const items = page.getByTestId("close-outcome");
    if ((await items.count()) !== 3) throw new Error(`outcomes in step 1: ${await items.count()}`);
    await items.nth(0).getByTestId("close-status-complete").click();
    await items.nth(0).getByTestId("close-result").fill("Read it. The asking price is high for the earnings.");
    await items.nth(0).getByTestId("close-result").press("Tab");
    await items.nth(1).getByTestId("close-status-partial").click();
    await items.nth(2).getByTestId("close-status-incomplete").click();
    const addActual = items.nth(0).getByTestId("close-add-actual");
    if (await addActual.count()) await addActual.click();
    await items.nth(0).getByTestId("close-actual").fill("75");
    await items.nth(0).getByTestId("close-actual").press("Tab");
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=close-outcome]")].map((e) => e.getAttribute("data-status")).join() === "complete,partial,incomplete");
    await page.screenshot({ path: path.join(OUT, "flow-close-step-1.png"), fullPage: true });
    await page.getByTestId("close-next").click().catch((e) => {
      throw new Error(`step 1 Next: ${e.message.split("\n").slice(0, 8).join(" | ")}`);
    });
    await page.waitForURL(/\/today\/close\?step=2/);
    await page.waitForLoadState("networkidle");
    const st = (await pg.query("select status, result_note, actual_minutes from daily_outcomes where plan_date = $1 order by position", [nyDate(0)])).rows;
    if (st.map((r) => r.status).join() !== "complete,partial,incomplete" || st[0].actual_minutes !== 75 || !st[0].result_note.startsWith("Read it")) throw new Error(`step 1 saved: ${JSON.stringify(st)}`);
    // Step 2: changes, tomorrow's priority (required), and the miss resolved right here.
    if ((await page.getByTestId("close-step-2").getAttribute("data-active")) !== "true") throw new Error("step 2 not active");
    const miss = page.getByTestId("close-miss").filter({ hasText: "Send the model to the lender" });
    await miss.waitFor();
    if ((await miss.getAttribute("data-resolution")) !== "pending") throw new Error("miss not pending");
    await page.getByTestId("close-next").click();
    await page.getByTestId("close-error").filter({ hasText: "tomorrow's top priority" }).waitFor();
    if (!/step=2/.test(page.url())) throw new Error("moved on without tomorrow's priority");
    await page.getByTestId("close-changes-text").fill("The broker call moved to Monday.");
    await page.getByTestId("close-tomorrow").fill("Finish the Dalton model");
    await page.getByTestId("close-tomorrow").press("Tab");
    if (!(await miss.getByTestId("resolve-form").isVisible())) await miss.getByTestId("close-miss-resolve").click();
    await miss.getByTestId("resolve-new-date").check();
    await miss.getByLabel(/Why was it missed/).fill("Waited for the lender's numbers.");
    await page.screenshot({ path: path.join(OUT, "flow-close-step-2.png"), fullPage: true });
    await miss.getByTestId("resolve-save").click();
    await page.getByTestId("close-miss").filter({ hasText: "Send the model to the lender" }).and(page.locator("[data-resolution=new_date]")).waitFor({ timeout: 20000 });
    await page.getByTestId("close-next").click();
    await page.waitForURL(/\/today\/close\?step=3/);
    await page.waitForLoadState("networkidle");
    const plan = await one("select changes_note, tomorrow_priority from daily_plans where plan_date = $1", [nyDate(0)]);
    if (plan.tomorrow_priority !== "Finish the Dalton model" || !plan.changes_note.includes("Monday")) throw new Error(`step 2 saved: ${JSON.stringify(plan)}`);
    // Step 3: the daily report for each partner set to Daily or Both, with the day's content; Approve and send one.
    if ((await page.getByTestId("close-step-3").getAttribute("data-active")) !== "true") throw new Error("step 3 not active");
    if (!weekday) {
      if (await page.getByTestId("daily-report").count()) throw new Error("daily reports drafted on a weekend");
      await page.getByTestId("close-report-note").waitFor();
    } else {
      await page.getByTestId("daily-reports-panel").waitFor({ timeout: 20000 });
      for (const p of partners) if (!(await page.getByTestId("daily-report").filter({ hasText: p.name }).count())) throw new Error(`no preview for ${p.name}`);
      const frame = page.getByTestId("daily-report").filter({ hasText: partners[0].name }).getByTestId("daily-preview").contentFrame();
      await frame.getByText("Planned outcomes").first().waitFor();
      const text = await frame.locator("body").innerText();
      for (const want of ["Review the Dalton CIM", "Read it. The asking price is high", "Tomorrow's top priority", "Finish the Dalton model"]) if (!text.includes(want)) throw new Error(`report preview is missing "${want}"`);
      await page.screenshot({ path: path.join(OUT, "flow-close-step-3.png"), fullPage: true });
      const r = await one("select snapshot from partner_reports where report_kind = 'daily' and partner_id = $1 and period_end = $2", [partners[0].id, nyDate(0)]);
      if (!r.snapshot.day || r.snapshot.day.outcomes.length !== 3 || r.snapshot.day.tomorrow !== "Finish the Dalton model") throw new Error(`saved day content: ${JSON.stringify(r.snapshot.day).slice(0, 200)}`);
      const first = page.getByTestId("daily-report").filter({ hasText: partners[0].name });
      // Sending needs the Google stand-in connected (the Send email steps above connect it); on its own this step skips the send.
      if (await first.getByTestId("daily-send").isEnabled()) {
        const sentBefore = (await gsent()).length;
        await first.getByTestId("daily-send").click();
        await page.getByTestId("daily-report").filter({ hasText: partners[0].name }).and(page.locator("[data-state=sent]")).waitFor({ timeout: 20000 });
        const sent = await gsent();
        if (sent.length !== sentBefore + 1) throw new Error(`expected 1 email, Gmail got ${sent.length - sentBefore}`);
        const last = sent[sent.length - 1];
        if (!/Daily accountability report/.test(JSON.stringify(last))) throw new Error("the sent email is not the daily report");
        if (!/Planned outcomes/.test(JSON.stringify(last))) throw new Error("the sent email has no Planned outcomes section");
      } else {
        process.stderr.write("     (Google not connected in this run: the send was skipped)\n");
        await first.getByTestId("daily-skip").click();
        await page.getByTestId("daily-report").filter({ hasText: partners[0].name }).and(page.locator("[data-state=skipped]")).waitFor({ timeout: 20000 });
      }
      const second = page.getByTestId("daily-report").filter({ hasText: partners[1].name });
      await second.getByTestId("daily-skip").click();
      await page.getByTestId("daily-report").filter({ hasText: partners[1].name }).and(page.locator("[data-state=skipped]")).waitFor({ timeout: 20000 });
    }
    await page.getByTestId("close-finish").click();
    await page.waitForURL(/\/today\?closed=1/);
    await page.getByTestId("day-closed").first().waitFor();
    if (await page.getByTestId("close-day").count()) throw new Error("Close the day still shown");
    const rev = await one("select status, answers from reviews where kind = 'daily' and period_start = $1", [nyDate(0)]);
    if (rev.status !== "completed" || rev.answers.close_version !== "focused") throw new Error(`review: ${JSON.stringify(rev)}`);
    const tomorrowTask = await one("select id from tasks where title = 'Finish the Dalton model' and due_date = $1 and status = 'todo'", [nyDate(1)]);
    if (!tomorrowTask) throw new Error("tomorrow's priority is not a task due tomorrow");
    // The outcomes are read-only with their status; Reopen brings the button back.
    const statuses = await page.getByTestId("outcome-status").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    if (statuses.join() !== "Complete,Partial,Incomplete") throw new Error(`statuses: ${statuses.join()}`);
    await page.screenshot({ path: path.join(OUT, "flow-today-closed.png"), fullPage: true });
    await page.getByTestId("day-reopen").first().click();
    await page.getByTestId("close-day").first().waitFor({ timeout: 20000 });
    if ((await one("select status from reviews where kind = 'daily' and period_start = $1", [nyDate(0)])).status !== "draft") throw new Error("reopen did not reopen the review");
    // Leaving and returning resumes at the saved step (step 1 after Reopen).
    await page.getByTestId("close-day").first().click();
    await page.waitForURL(/step=1/);
  });

  await step("Waiting on: set in task window, appears on Today", async () => {
    const t =
      (await one("select id, title from tasks where status = 'todo' and title = 'Send the model to the lender'")) ??
      (await one("insert into tasks (owner_id, title, due_date, priority) values ($1, 'Send the model to the lender', $2, 2) returning id, title", [OWNER, nyDate(0)]));
    await page.goto(`${BASE}/?w=r/tasks/${t.id}`);
    const win = page.locator("[data-url-window]");
    await win.getByTestId("task-waiting").waitFor({ timeout: 20000 });
    await win.getByTestId("task-waiting-who").fill("Lender Pat");
    await win.getByTestId("task-waiting-since").fill(nyDate(-3));
    await win.getByTestId("task-waiting-save").click();
    await win.getByText("Saved. It is on Today under Waiting on someone.").waitFor({ timeout: 20000 });
    const row = await one("select waiting_on, waiting_since::text as since from tasks where id = $1", [t.id]);
    if (row.waiting_on !== "Lender Pat" || row.since !== nyDate(-3)) throw new Error(`saved: ${JSON.stringify(row)}`);
    await page.keyboard.press("Escape");
    await win.waitFor({ state: "detached" });
    await page.goto(`${BASE}/today`);
    const wrow = page.getByTestId("waiting-row").filter({ hasText: "Lender Pat" });
    await wrow.waitFor();
    if (!(await wrow.innerText()).includes(t.title)) throw new Error("waiting row without the task title");
    await page.screenshot({ path: path.join(OUT, "flow-today-waiting.png"), fullPage: true });
    // Clearing the name removes it from Today.
    await wrow.locator("a").click();
    await win.getByTestId("task-waiting").waitFor({ timeout: 20000 });
    await win.getByTestId("task-waiting-who").fill("");
    await win.getByTestId("task-waiting-save").click();
    await win.getByText("Cleared.").waitFor({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/today`);
    await page.getByTestId("today-waiting").waitFor();
    if (await page.getByTestId("waiting-row").filter({ hasText: "Lender Pat" }).count()) throw new Error("still listed after clearing");
  });

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
    const id = (await one("select id from partner_reports where status = 'finalized' and report_kind = 'regular' order by finalized_at desc limit 1")).id;
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
    await page.locator("nav a[href='/work']").first().click();
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

  await step("Start an initiative: box with a microphone on Plan, a button on the old Home; speech fills the box and never submits", async () => {
    await page.goto(OLD_HOME);
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
    await page.goto(OLD_HOME);
    await page.locator("main a[href^='/records/tasks/']").first().click();
    await page.getByTestId("quick-view-body").waitFor();
    if (!/next required action/i.test(await page.getByTestId("quick-view-body").innerText())) throw new Error("no Next required action card");
    if (new URL(page.url()).pathname !== "/more/old-home") throw new Error("left Home");
    await page.screenshot({ path: path.join(OUT, "desktop-quick-view.png") });
    const inner = page.locator("[data-window-host] dd a[href^='/records/']").first();
    if (await inner.count()) {
      await inner.click();
      await page.getByTestId("window-back").waitFor();
      if ((await dialogs(page)) !== 1) throw new Error("a second window opened");
      await page.getByTestId("window-back").click();
    }
    const box = await page.locator("[data-window-host]").boundingBox();
    // A task opens the one task window (large: 85% of the width, at most 1400px).
    if (box.width > 1400 + 2 || box.width < 1440 * 0.8) throw new Error(`task window width ${box.width}`);
    await page.getByTestId("quick-view-full-page").click();
    await page.waitForURL(/\/records\/tasks\/[0-9a-f-]{36}$/);
    if (await dialogs(page)) throw new Error("window still open on the full page");
    // A modified click still goes to the full page in a new tab, not the window.
    await page.goto(`${BASE}/productivity/tasks`);
    const [tab] = await Promise.all([ctx.waitForEvent("page"), page.locator("main a[href^='/records/tasks/']").first().click({ modifiers: ["Control"] })]);
    await tab.close();
    if (await dialogs(page)) throw new Error("Ctrl-click opened the window");
  });

  await step("Old daily close opens in the large window from the old Home and from the evening task; the full page stays at its address; links inside go to the full page (no window on a window)", async () => {
    await page.goto(OLD_HOME);
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
    await page.waitForURL(OLD_HOME);
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
    await page.goto(OLD_HOME);
    await page.getByTestId("work-through-tasks").first().click();
    await page.getByTestId("work-task").waitFor();
    if (!/\/more\/old-home\?w=work/.test(page.url())) throw new Error(`address: ${page.url()}`);
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

  await step("Old Home: the morning plan shows only Top 3 and Watch (Show all for the rest); the runway card has the runway trend chart", async () => {
    await page.goto(OLD_HOME);
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
    await shoot3(OLD_HOME, "old-home");
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
    await page.goto(OLD_HOME);
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
    await page.goto(OLD_HOME);
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

  await step("Listings screened: +1, +5, and Undo last on the target card (note saved), the Acquisitions daily count card, Home, and Productivity", async () => {
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

    // Acquisitions page: the Daily count card under the header
    await page.goto(`${BASE}/opportunities/${acqPipe}`);
    const header = page.getByTestId("daily-count");
    if (!/^Daily count: Listings screened/.test(await header.innerText())) throw new Error("daily count card title");
    if (!(await header.getByRole("button", { name: /^Add 1 to/ }).innerText()).includes("+1 listing")) throw new Error("button text: +1 listing");
    if (!/Press after you review listings on broker sites or email lists\./.test(await header.innerText())) throw new Error("help line");
    const headerCount = async () => Number((await page.getByTestId("daily-count-number").innerText()).match(/^(\d+)/)[1]);
    if ((await headerCount()) !== start + 5) throw new Error(`header shows ${await headerCount()}`);
    await clickCount(header, "Add 1");
    await waitFor(headerCount, start + 6, "header after +1");
    await clickCount(header, "Add 5");
    await waitFor(headerCount, start + 11, "header after +5");
    await header.getByRole("button", { name: /^Undo last entry/ }).click();
    await waitFor(headerCount, start + 6, "header after Undo last");

    // Old Home tile
    await page.goto(OLD_HOME);
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

  await step("CIMs reviewed: a deal moved past CIM review counts today, once (moving back and forward again does not count twice)", async () => {
    await page.goto(`${BASE}/accountability/targets`);
    const before = await cardCount("CIMs reviewed");
    // Demo Machine Shop is in Interested: moving it straight to CIM review skips NDA signed and still counts.
    await moveTo("Demo Machine Shop", "CIM review");
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`after the move: ${await cardCount("CIMs reviewed")}, expected ${before + 1}`);
    await moveTo("Demo Machine Shop", "NDA signed");
    await moveTo("Demo Machine Shop", "CIM review");
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`counted twice: ${await cardCount("CIMs reviewed")}`);
    // A new deal added at CIM review is not a move: it does not count.
    await page.goto(`${BASE}/records/pipeline_items/new?pipeline_id=${acqPipe}&stage_id=${(await one("select id from pipeline_stages where pipeline_id = $1 and name = 'CIM review'", [acqPipe])).id}`);
    await page.locator('input[name="name"]').fill("Demo Added At CIM Co");
    await page.locator('input[name="next_action"]').fill("Enter revenue, EBITDA, asking price");
    if (await page.locator('input[name="next_action_due"]').count()) await page.locator('input[name="next_action_due"]').fill(nyDate(2));
    await page.locator('select[name="deal_source_type"]').selectOption("brokered");
    await page.locator("form button[type=submit]").filter({ hasText: /^(Save|Create|Add)/ }).first().click();
    await page.waitForURL(/\/records\/pipeline_items\/[0-9a-f-]{36}/);
    await page.goto(`${BASE}/accountability/targets`);
    if ((await cardCount("CIMs reviewed")) !== before + 1) throw new Error(`a deal added at CIM review was counted: ${await cardCount("CIMs reviewed")}`);
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
        cims: await reached("CIM review"),
        calls: (await one(
          `select count(distinct (c.pipeline_item_id, (c.occurred_at at time zone 'America/New_York')::date))::int n from communications c join pipeline_items i on i.id = c.pipeline_item_id
           where i.pipeline_id = $1 and c.method in ('call', 'meeting', 'video') and (c.occurred_at at time zone 'America/New_York')::date >= ${from}`,
          [acqPipe],
        )).n,
        lois: await reached("IOI or LOI"),
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

  // ---------- Build C1: windows, uploads, add steps, task window, filters, Ask AI in a window ----------

  await step("Windows open on every address change: away and back to Home, then Work through tasks (also while the page underneath is still reloading)", async () => {
    await page.goto(`${BASE}/work`);
    for (const href of ["/work/deals", "/accountability", "/more", "/work"]) {
      await page.locator(`nav a[href='${href}']`).first().click();
      await page.waitForURL((u) => u.pathname === href);
    }
    await page.goto(OLD_HOME);
    await page.getByTestId("work-through-tasks").first().click();
    await page.waitForURL(/\?w=work/);
    await page.getByTestId("tasks-window").waitFor({ timeout: 3000 });
    await page.getByTestId("work-skip").click();
    await page.getByTestId("window-close").click();
    await page.getByTestId("tasks-window").waitFor({ state: "detached" });
    // The page underneath reloads after the window changed something: make that reload slow, then open the window again.
    await page.route("**/*", async (r) => {
      const h = r.request().headers();
      if (h.rsc && !h["next-router-prefetch"]) await new Promise((res) => setTimeout(res, 4000));
      await r.continue().catch(() => {});
    });
    const t0 = Date.now();
    await page.getByTestId("work-through-tasks").first().click();
    await page.getByTestId("tasks-window").waitFor({ timeout: 2000 });
    if (Date.now() - t0 > 2000) throw new Error(`window took ${Date.now() - t0} ms`);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.keyboard.press("Escape");
    await page.getByTestId("tasks-window").waitFor({ state: "detached" });
    // Other windows: a task from Task lists, then Back and Forward.
    await page.goto(`${BASE}/productivity/tasks`);
    await page.locator("table a[href^='/records/tasks/']").first().click();
    await page.getByTestId("task-window-body").waitFor();
    await page.goBack();
    await page.getByTestId("task-window-body").waitFor({ state: "detached" });
    await page.goForward();
    await page.getByTestId("task-window-body").waitFor({ timeout: 3000 });
  });

  await step("Documents and add steps: buttons gray until something is chosen; leaving names each unfinished step; Finish all saves the link, the file (straight to storage), and the note", async () => {
    const c = await one("select id from commitments order by created_at limit 1");
    const file = path.join(require("node:os").tmpdir(), "c1-upload.pdf");
    fs.writeFileSync(file, Buffer.alloc(2_500_000, 65));
    await page.goto(`${BASE}/records/commitments/${c.id}`);
    for (const t of ["Linked records", "Documents"]) {
      const b = page.getByRole("button", { name: new RegExp(`^${t}`) });
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    }
    if ((await page.getByTestId("upload-submit").getAttribute("data-filled")) !== null) throw new Error("Upload cobalt before a file is chosen");
    const sel = page.getByLabel("Record to link");
    await sel.selectOption(await sel.locator("option").nth(1).getAttribute("value"));
    await page.setInputFiles("[data-testid=upload-form] input[type=file]", file);
    await page.getByLabel("Note", { exact: true }).fill("Note from the C1 check");
    for (const id of ["link-submit", "upload-submit", "note-submit"]) if ((await page.getByTestId(id).getAttribute("data-filled")) === null) throw new Error(`${id} not cobalt`);
    await page.locator("nav a[href='/plan']").first().click();
    const steps = (await page.getByTestId("unsaved-steps").innerText()).split("\n");
    if (steps.join("|") !== "You chose a record but did not press Link.|You chose a file but did not press Upload.|You typed a note but did not press Add note.") throw new Error(`steps: ${steps.join("|")}`);
    if ((await page.getByTestId("unsaved-save").innerText()) !== "Finish all 3 and leave") throw new Error("finish button");
    await page.getByTestId("unsaved-save").click();
    await page.waitForURL(/\/plan$/, { timeout: 20000 });
    const doc = await one("select storage_path, size_bytes from documents where record_id = $1", [c.id]);
    if (!doc || Number(doc.size_bytes) !== 2_500_000) throw new Error(`document: ${JSON.stringify(doc)}`);
    const stored = await (await fetch("http://localhost:54321/__storage")).json();
    if (!stored.some((f) => f.path === doc.storage_path)) throw new Error("file not in storage");
    if (!(await one("select 1 from notes where record_id = $1 and body = 'Note from the C1 check'", [c.id]))) throw new Error("note");
    if (!(await one("select 1 from record_links where from_id = $1", [c.id]))) throw new Error("link");
    // One step only: the dialog names it and offers Upload and leave.
    await page.goto(`${BASE}/records/commitments/${c.id}`);
    await page.setInputFiles("[data-testid=upload-form] input[type=file]", file);
    await page.locator("nav a[href='/plan']").first().click();
    if ((await page.getByTestId("unsaved-save").innerText()) !== "Upload and leave") throw new Error("Upload and leave");
    await page.getByTestId("unsaved-stay").click();
    // Over 25 MB: a message under the form, nothing uploaded.
    const big = path.join(require("node:os").tmpdir(), "c1-big.pdf");
    fs.writeFileSync(big, Buffer.alloc(26 * 1024 * 1024, 65));
    await page.setInputFiles("[data-testid=upload-form] input[type=file]", big);
    await page.getByTestId("upload-submit").click();
    if (!/The limit is 25 MB/.test(await page.getByTestId("panel-error").innerText())) throw new Error("size message");
    if ((await one("select count(*)::int n from documents where record_id = $1", [c.id])).n !== 1) throw new Error("big file uploaded");
    await page.getByLabel("Note", { exact: true }).fill("");
    await page.setInputFiles("[data-testid=upload-form] input[type=file]", []);
  });

  await step("Task window: the same full content (details, commitment and misses, linked records, documents, notes, history) from Task lists, Commitments, and Work through tasks", async () => {
    const t = await one("select t.id, t.title from tasks t join commitments c on c.record_type = 'tasks' and c.record_id = t.id where t.status = 'todo' order by t.due_date limit 1");
    const sections = async () => {
      await page.getByTestId("task-window-body").waitFor();
      for (const id of ["task-window-details", "task-window-commitment", "panel-linked", "panel-documents", "panel-notes", "panel-history"]) await page.locator(`[data-url-window] [data-testid=${id}]`).waitFor();
    };
    await page.goto(`${BASE}/productivity/tasks?w=r/tasks/${t.id}`);
    await sections();
    await page.screenshot({ path: path.join(OUT, "desktop-window-task.png") });
    await page.goto(`${BASE}/accountability`);
    await page.locator(`a[href='/records/tasks/${t.id}']`).first().click();
    await sections();
    // Add a note inside the window: saved, the window shows it, no page reload of the window.
    await page.locator("[data-url-window]").getByLabel("Note", { exact: true }).fill("Note added in the window");
    await page.locator("[data-url-window]").getByTestId("note-submit").click();
    await page.locator("[data-url-window]").getByText("Note added in the window", { exact: true }).waitFor();
    await page.goto(`${BASE}/?w=work`);
    await page.getByTestId("work-task").waitFor();
    await page.locator("[data-url-window] [data-testid=panel-notes]").waitFor();
  });

  await step("Filters: communications, commitments, and the pipeline list filter in the address; hairlines between columns", async () => {
    await page.goto(`${BASE}/people/communications`);
    await page.getByTestId("filter-button").click();
    const cols = page.getByTestId("filter-column");
    if ((await cols.count()) !== 4) throw new Error(`columns: ${await cols.count()}`);
    const border = await cols.nth(1).evaluate((el) => getComputedStyle(el).borderLeftColor);
    if (border !== "rgb(213, 219, 227)") throw new Error(`divider color ${border}`);
    await page.getByTestId("filter-method-call").check();
    await page.getByTestId("filter-apply").click();
    await page.waitForURL(/method=call/);
    const rows = await page.locator("table tbody tr").count();
    const calls = (await one("select count(*)::int n from communications where method = 'call'")).n;
    if (rows !== calls) throw new Error(`rows ${rows}, calls ${calls}`);
    await page.getByTestId("filter-label").first().click();
    await page.waitForURL((u) => !u.search.includes("method"));
    await page.goto(`${BASE}/accountability?status=all&type=tasks`);
    const shown = await page.getByTestId("commitment-row").count();
    const want = (await one("select count(*)::int n from commitments where record_type = 'tasks'")).n;
    if (shown !== want) throw new Error(`commitments shown ${shown}, want ${want}`);
    await page.goto(`${BASE}/opportunities/${acqPipe}?status=lost`);
    const lost = (await one("select count(*)::int n from pipeline_items where pipeline_id = $1 and status = 'lost'", [acqPipe])).n;
    // The last table is the item list (the Deal source card above has its own table).
    if ((await page.locator("table").last().locator("tbody tr").count()) !== lost) throw new Error("pipeline filter");
    if (!lost && !(await page.getByText("No items match these filters.").count())) throw new Error("no-match line");
  });

  await step("Ask AI in a window: a question grows the window to about 85% of the screen height; the reply is in view", async () => {
    const t = await one("select id from tasks where status = 'todo' limit 1");
    await page.goto(`${BASE}/?w=r/tasks/${t.id}`);
    const win = page.locator("[data-url-window]");
    await win.getByRole("button", { name: /Ask AI about this/ }).click();
    const h0 = (await win.boundingBox()).height;
    await page.getByTestId("ai-chat").getByLabel("Message", { exact: true }).fill("What should I do next on this?");
    await page.getByTestId("ai-chat").getByRole("button", { name: "Send", exact: true }).click();
    await page.getByTestId("ai-chat-assistant").waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const h1 = (await win.boundingBox()).height;
    const vh = page.viewportSize().height;
    if (h1 < vh * 0.8 || h1 < h0) throw new Error(`window ${h0} to ${h1} of ${vh}`);
    const reply = await page.getByTestId("ai-chat-assistant").last().boundingBox();
    const box = await page.getByTestId("ai-chat-scroll").boundingBox();
    if (reply.y < box.y - 1 || reply.y > box.y + box.height) throw new Error("reply not in view");
    await page.screenshot({ path: path.join(OUT, "desktop-window-ask-ai.png") });
  });

  // ---------- Build C2: deal scorecard, balance sheet, partner report templates, visual report email ----------
  // Own 1280 window (the Email button section's 1280 window is closed by now); the phone page is still open.
  const c2ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await c2ctx.addCookies([cookie]);
  const c2page = await c2ctx.newPage();
  const C2VIEWS = [["desktop", page], ["desktop1280", c2page], ["phone", ph]];

  await step("Deal scorecard: card on the item page and in the window (top right), four checks with colors, hover help; dots in the list", async () => {
    const acq = await one("select id from pipelines where kind = 'acquisition' limit 1");
    const item = await one("select id from pipeline_items where name = 'Demo Landscaping LLC' limit 1");
    // An overdue next action makes the Next action check red and the overall red.
    await pg.query("update pipeline_items set next_action = 'Call the broker', next_action_due = $2, status = 'open' where id = $1", [item.id, nyDate(-2)]);
    await page.goto(`${BASE}/records/pipeline_items/${item.id}`);
    const card = page.getByTestId("deal-scorecard");
    await card.waitFor();
    if ((await card.getByTestId("scorecard-next_action").getAttribute("data-color")) !== "red") throw new Error("overdue next action is not red");
    if ((await card.getByTestId("scorecard-overall").getAttribute("data-color")) !== "red") throw new Error("overall is not red");
    if (!/Overdue 2 days/.test(await card.getByTestId("scorecard-next_action").innerText())) throw new Error("overdue value");
    if (!/\d of 4 on track/.test(await card.getByTestId("scorecard-overall").innerText())) throw new Error("score text");
    for (const k of ["stage_time", "next_action", "required", "activity"]) await card.getByTestId(`scorecard-${k}`).waitFor();
    // Top right: the card is the first thing in the side column, level with the Next required action card.
    const cb = await card.boundingBox();
    const nb = await page.locator("#next-action").first().boundingBox();
    if (nb && (cb.x < nb.x + nb.width || Math.abs(cb.y - nb.y) > 4)) throw new Error(`card not top right: ${JSON.stringify(cb)} vs ${JSON.stringify(nb)}`);
    // Hover shows what the check means and what to do.
    const help = card.getByTestId("scorecard-help-next_action");
    if (await help.isVisible()) throw new Error("help shown before hover");
    await card.getByTestId("scorecard-next_action").hover();
    await page.waitForTimeout(250);
    if (!(await help.isVisible()) || !/Do the next action today/.test(await help.innerText())) throw new Error("hover help");
    await page.screenshot({ path: path.join(OUT, "desktop-scorecard-hover.png") });
    // Due today: the check turns amber.
    await pg.query("update pipeline_items set next_action_due = $2 where id = $1", [item.id, nyDate(0)]);
    await page.reload();
    if ((await page.getByTestId("scorecard-next_action").getAttribute("data-color")) !== "amber") throw new Error("due today is not amber");
    // Window: the card is in the top row, on the right on wide screens.
    for (const [name, pg_] of C2VIEWS) {
      await pg_.goto(`${BASE}/opportunities/${acq.id}?w=r/pipeline_items/${item.id}`);
      const w = pg_.locator("[data-url-window]").getByTestId("deal-scorecard");
      await w.waitFor();
      if (name !== "phone") {
        const wb = await w.boundingBox();
        const na = await pg_.locator("[data-url-window]").getByTestId("pipeline-move-stage").boundingBox();
        if (name === "desktop" && !(wb.x > na.x && Math.abs(wb.y - na.y) < 4)) throw new Error(`${name}: scorecard not right of Move stage`);
      }
      await pg_.screenshot({ path: path.join(OUT, `${name}-scorecard-window.png`) });
      await pg_.goto(`${BASE}/records/pipeline_items/${item.id}`);
      await pg_.getByTestId("deal-scorecard").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${name}-scorecard-page.png`), fullPage: name === "phone" });
    }
    // List: one dot per open item, in the overall color.
    await page.goto(`${BASE}/opportunities/${acq.id}`);
    const open = (await one("select count(*)::int n from pipeline_items where pipeline_id = $1 and status = 'open'", [acq.id])).n;
    const dots = await page.getByTestId("scorecard-dot").count();
    if (dots !== open) throw new Error(`dots ${dots}, open items ${open}`);
    const row = page.locator("tr", { hasText: "Demo Landscaping LLC" }).getByTestId("scorecard-dot");
    if (!["amber", "red"].includes(await row.getAttribute("data-color"))) throw new Error("list dot color");
    await page.screenshot({ path: path.join(OUT, "desktop-scorecard-list.png") });
  });

  await step("Balance sheet: assets by type, liabilities, net worth equal to Accounts and Cash, Personal / Cyan Arc LLC / Both, trend", async () => {
    await page.goto(`${BASE}/finance`);
    const overview = (await page.getByTestId("net-worth-tile").innerText()).trim();
    await page.getByTestId("net-worth-tile").click();
    await page.waitForURL(/\/finance\/balance-sheet/);
    // Runway counts Personal accounts only (default setting), so the sheet opens on Personal.
    if ((await page.getByTestId("sheet-scope").getByRole("link", { name: "Personal" }).getAttribute("aria-current")) !== "page") throw new Error("not Personal by default");
    await page.getByTestId("sheet-assets").waitFor();
    await page.getByTestId("sheet-group-cash").waitFor();
    const money = (t) => Number(t.replace(/[^0-9.-]/g, ""));
    const db = await one(`select
      (select coalesce(sum(b.balance), 0) from accounts a join account_current_balances b on b.account_id = a.id join entities e on e.id = a.entity_id where a.is_active and a.kind not in ('credit_card','loan') and e.kind <> 'business') assets,
      (select coalesce(sum(abs(b.balance)), 0) from accounts a join account_current_balances b on b.account_id = a.id join entities e on e.id = a.entity_id where a.is_active and a.kind in ('credit_card','loan') and e.kind <> 'business') liab`);
    const unlinked = (await one("select coalesce(sum(abs(current_balance)),0) d from debts d left join entities e on e.id = d.entity_id where d.is_active and d.account_id is null and coalesce(e.kind, 'personal') <> 'business'")).d;
    const want = Math.round((Number(db.assets) - Number(db.liab) - Number(unlinked)) * 100) / 100;
    const shown = money(await page.getByTestId("sheet-net-worth").innerText());
    if (Math.abs(shown - want) > 0.01) throw new Error(`Personal net worth ${shown}, records ${want}`);
    await page.getByTestId("sheet-scope").getByRole("link", { name: "Both" }).click();
    await page.waitForURL(/scope=all/);
    const both = (await page.getByTestId("sheet-net-worth").innerText()).trim();
    if (money(both) !== money(overview)) throw new Error(`Both ${both} differs from Accounts and Cash ${overview}`);
    await page.getByTestId("sheet-trend").waitFor();
    const chart = await page.getByTestId("sheet-trend").locator(".recharts-surface").count();
    const empty = await page.getByTestId("sheet-trend-empty").count();
    if (!chart && !empty) throw new Error("no trend and no explanation");
    for (const [name, pg_] of C2VIEWS) {
      await pg_.goto(`${BASE}/finance/balance-sheet`);
      await pg_.getByTestId("sheet-assets").waitFor();
      await pg_.waitForTimeout(300);
      await pg_.screenshot({ path: path.join(OUT, `${name}-balance-sheet.png`), fullPage: true });
      const over = await pg_.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (over) throw new Error(`${name}: the page scrolls sideways`);
    }
    // Nav link
    await page.goto(`${BASE}/finance`);
    await page.getByRole("link", { name: "Balance Sheet", exact: true }).first().click();
    await page.waitForURL(/\/finance\/balance-sheet/);
  });

  await step("Report templates: three starters; add, edit and rename, delete; choose a partner's default", async () => {
    await page.goto(`${BASE}/accountability/report-templates`);
    await page.getByTestId("template-list").waitFor();
    const names = await page.getByTestId("template-card").locator("p.font-medium").allInnerTexts();
    for (const n of ["Summary", "Standard", "Detailed"]) if (!names.includes(n)) throw new Error(`missing starter ${n}: ${names}`);
    // Add
    await page.getByTestId("template-add").click();
    await page.getByTestId("template-name").fill("Deal search weekly");
    await page.getByTestId("template-period").selectOption("two_weeks");
    await page.getByTestId("template-note").fill("This period I focused on screening and broker calls.");
    for (const k of ["listings_screened", "cims_reviewed", "deal_calls", "completion_pct"]) await page.getByTestId(`measure-${k}`).check();
    await page.screenshot({ path: path.join(OUT, "desktop-report-template-editor.png"), fullPage: true });
    await page.getByTestId("template-save").click();
    await expectText(page, "Added Deal search weekly.");
    let t = await one("select * from partner_report_templates where name = 'Deal search weekly'");
    if (!t || t.period !== "two_weeks" || t.measures.join(",") !== "completion_pct,listings_screened,cims_reviewed,deal_calls" || t.starter_key) throw new Error(`added: ${JSON.stringify(t)}`);
    // Saving with no measures is refused with a plain message.
    await page.getByTestId("template-add").click();
    await page.getByTestId("template-name").fill("Empty one");
    await page.getByTestId("template-save").click();
    await expectText(page, "Choose at least one measure.");
    await page.getByLabel("Close the template editor").click();
    // Edit and rename
    await page.getByTestId("template-card").filter({ hasText: "Deal search weekly" }).getByTestId("template-edit").click();
    await page.getByTestId("template-name").fill("Deal search focus");
    await page.getByTestId("measure-completion_pct").uncheck();
    await page.getByTestId("measure-pipeline_moves").check();
    await page.getByTestId("template-save").click();
    await expectText(page, "Saved Deal search focus.");
    t = await one("select * from partner_report_templates where id = $1", [t.id]);
    if (t.name !== "Deal search focus" || t.measures.includes("completion_pct") || !t.measures.includes("pipeline_moves")) throw new Error(`edited: ${JSON.stringify(t)}`);
    // Delete another one
    await page.getByTestId("template-add").click();
    await page.getByTestId("template-name").fill("To delete");
    await page.getByTestId("measure-tasks_done").check();
    await page.getByTestId("template-save").click();
    await expectText(page, "Added To delete.");
    await page.getByTestId("template-card").filter({ hasText: "To delete" }).getByTestId("template-delete").click();
    await page.getByTestId("template-delete-confirm").click();
    await expectText(page, "Deleted To delete.");
    if (await one("select 1 x from partner_report_templates where name = 'To delete'")) throw new Error("not deleted");
    // Partner default
    // The partner whose finalized report the next step opens (not the first by name: the close-the-day step adds partners).
    const partner = await one("select p.id, p.name from partners p join partner_reports r on r.partner_id = p.id where r.status = 'finalized' and r.report_kind = 'regular' order by r.finalized_at desc limit 1");
    await page.getByLabel(`Default template for ${partner.name}`).selectOption({ label: "Deal search focus" });
    await expectText(page, "Saved");
    const chosen = await one("select t.name from partners p join partner_report_templates t on t.id = p.report_template_id where p.id = $1", [partner.id]);
    if (chosen?.name !== "Deal search focus") throw new Error(`partner default: ${JSON.stringify(chosen)}`);
    for (const [name, pg_] of C2VIEWS) {
      await pg_.goto(`${BASE}/accountability/report-templates`);
      await pg_.getByTestId("template-list").waitFor();
      await pg_.screenshot({ path: path.join(OUT, `${name}-report-templates.png`), fullPage: true });
    }
  });

  await step("Partner report: two templates in one email with the PDF attached; preview first; Gmail gets HTML tiles, text, and the PDF (Google stand-in)", async () => {
    const id = (await one("select id from partner_reports where status = 'finalized' and report_kind = 'regular' order by finalized_at desc limit 1")).id;
    const partner = await one("select p.* from partners p join partner_reports r on r.partner_id = p.id where r.id = $1", [id]);
    await page.goto(`${BASE}/accountability/reports/${id}`);
    await page.getByTestId("report-email-panel").waitFor();
    // The partner's default template is chosen first.
    const firstLabel = await page.getByTestId("report-template-first").locator("option:checked").innerText();
    if (partner.report_template_id && !/partner's default/.test(firstLabel)) throw new Error(`default not chosen: ${firstLabel}`);
    const std = await one("select id from partner_report_templates where starter_key = 'standard'");
    const focus = await one("select id from partner_report_templates where name = 'Deal search focus'");
    await page.getByTestId("report-template-first").selectOption(std.id);
    await page.getByTestId("report-template-second").selectOption(focus.id);
    if (await page.getByTestId("report-attach-pdf").isChecked()) throw new Error("PDF checked by default");
    await page.getByTestId("report-attach-pdf").check();
    const preview = await page.frameLocator("[data-testid=report-email-preview]").locator("body").innerText();
    for (const want of ["Accountability report", "Standard", "Deal search focus", "Commitments completed", "Listings screened"]) if (!preview.includes(want)) throw new Error(`preview misses ${want}`);
    for (const [name, pg_] of C2VIEWS) {
      if (pg_ !== page) {
        await pg_.goto(`${BASE}/accountability/reports/${id}`);
        await pg_.getByTestId("report-template-first").selectOption(std.id);
        await pg_.getByTestId("report-template-second").selectOption(focus.id, { timeout: 10000 }).catch(async (e) => {
          await pg_.screenshot({ path: `/tmp/fail-${name}.png`, fullPage: true });
          throw new Error(`${name}: ${e.message.split("\n")[0]}`);
        });
      }
      await pg_.getByTestId("report-email-panel").scrollIntoViewIfNeeded();
      await pg_.waitForTimeout(400);
      await pg_.screenshot({ path: path.join(OUT, `${name}-report-email-preview.png`), fullPage: true });
    }
    // The PDF link answers with a PDF.
    const href = await page.getByTestId("report-pdf-link").getAttribute("href");
    const pdf = await page.request.get(`${BASE}${href}`);
    if (pdf.headers()["content-type"] !== "application/pdf" || !(await pdf.body()).subarray(0, 5).toString().startsWith("%PDF")) throw new Error("PDF link");
    const before = (await gsent()).length;
    await page.getByTestId("send-now").click();
    const dlg = page.getByRole("dialog", { name: "Send this email?" });
    await dlg.waitFor();
    if (!/Accountability report .*\.pdf/.test(await dlg.getByTestId("send-preview-attachment").innerText())) throw new Error("dialog has no attachment line");
    const shown = await previewText(page);
    if (!shown.includes("Deal search focus") || !shown.includes("Standard")) throw new Error("dialog preview");
    await page.screenshot({ path: path.join(OUT, "desktop-report-send-two-templates.png") });
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor();
    const list = await gsent();
    if (list.length !== before + 1) throw new Error("expected one email");
    const m = list[list.length - 1];
    if (!m.contentType.startsWith("multipart/mixed")) throw new Error(`not multipart/mixed: ${m.contentType}`);
    if (m.parts.length !== 2 || !m.html || !m.body) throw new Error("text and HTML parts");
    const pdfPart = m.attachments.find((a) => a.type === "application/pdf");
    if (!pdfPart || pdfPart.head !== "%PDF-" || !/^Accountability report \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.pdf$/.test(pdfPart.filename)) throw new Error(`pdf: ${JSON.stringify(m.attachments)}`);
    for (const want of [">Standard <span", ">Deal search focus <span", "max-width:600px", "background-color:#d9bd84", 'role="presentation"']) if (!m.html.includes(want)) throw new Error(`html misses ${want}`);
    if (/<style|<script|<img (?!.*googleusercontent)/i.test(m.html.split("gmail_signature")[0])) throw new Error("html not email-safe");
    if (!m.body.includes("STANDARD (") || !m.body.includes("DEAL SEARCH FOCUS (") || !m.body.includes("- Listings screened:")) throw new Error("text part");
    const log = await one("select new_value from change_log where field = 'email_sent' and table_name = 'partner_reports' and record_id = $1 order by created_at desc limit 1", [id]);
    if (log.new_value.templates.join(",") !== "Standard,Deal search focus" || log.new_value.pdf_attached !== true) throw new Error(`change log: ${JSON.stringify(log.new_value)}`);
    // Save to Gmail drafts with the default template and no PDF: multipart/alternative with the tiles.
    await page.goto(`${BASE}/accountability/reports/${id}`);
    const draftsBefore = (await gdrafts()).length;
    await page.getByTestId("save-draft").click();
    await expectText(page, "Gmail draft created");
    const dr = (await gdrafts()).slice(draftsBefore).pop();
    if (!dr || !dr.contentType.startsWith("multipart/alternative") || !dr.html.includes("Deal search focus") || dr.html.includes("Standard <span")) throw new Error("draft with the partner's default template");
    // Public page uses the partner's default template.
    if (publicLink) {
      const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await anon.newPage();
      await p.goto(publicLink.replace(/^https?:\/\/[^/]+/, BASE));
      await p.getByTestId("report-tiles").waitFor();
      if (!(await p.getByTestId("report-tiles").innerText()).includes("Deal search focus")) throw new Error("public page template");
      await p.screenshot({ path: path.join(OUT, "phone-public-report-tiles.png"), fullPage: true });
      await anon.close();
    }
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
    if (s.marked < 450 || s.accounts !== 7 || s.t <= before.t) throw new Error(JSON.stringify(s));
    if (s.unused !== 2) throw new Error(`unused subscriptions flagged: ${s.unused}`);
    if (s.series < 10) throw new Error(`recurring charges found: ${s.series}`);
    const unmarked = await one("select count(*)::int n from accounts a where a.name like 'Sample %' and not exists (select 1 from sample_records r where r.record_id = a.id)");
    if (unmarked.n) throw new Error("an unmarked sample account");
    await expectText(page, "Sample data is loaded");
  });

  // ---------- The Work module (batch A and Edit batch A, database updates 0020 and 0021): the sample listings and deals are loaded above ----------
  const dealByName = (name) => one("select i.id, i.name, i.company_name, i.next_action, i.next_action_due::text, i.waiting_on, i.waiting_since::text, i.screened, i.pass_reason, i.open_questions_json, i.key_finding, s.name as stage from pipeline_items i left join pipeline_stages s on s.id = i.stage_id where i.name = $1 or i.company_name = $1", [name]);
  const todosOf = (dealId) => pg.query("select id, text, position, done_at from deal_todos where deal_id = $1 order by position", [dealId]).then((r) => r.rows);
  const personByName = (name) => one("select id, name, follow_up_date::text, follow_up_note, last_contact_at::text, last_contact_kind, archived_at::text, purposes, outreach_role, notes from contacts where name = $1", [name]);
  const projectByName = (name) => one("select id, name, status, closed_at::text, next_action, next_action_due::text, milestone from projects where name = $1", [name]);
  const itemByName = (name, kind) => one("select i.id, i.name, i.next_action, i.next_action_due::text, i.waiting_on, i.status, s.name as stage from pipeline_items i join pipelines p on p.id = i.pipeline_id left join pipeline_stages s on s.id = i.stage_id where i.name = $1 and p.kind = $2 order by i.created_at limit 1", [name, kind]);

  await step("Work: the start page is Home (Work on now); the menu is Work, Accountability, More; the tiles and pills match the sample data", async () => {
    await page.goto(`${BASE}/`);
    await page.waitForURL(/\/work$/);
    await page.getByTestId("work-now").waitFor();
    const menu = await page.locator("aside nav[aria-label='Main menu'] > div > a").allInnerTexts();
    if (menu.map((m) => m.trim()).join("|") !== "Work|Accountability|More") throw new Error(`menu: ${menu.join("|")}`);
    const sub = (await page.getByTestId("work-subnav").locator("a").allInnerTexts()).map((t) => t.trim().split("\n")[0]);
    if (sub.join("|") !== "Home|Screen listings|Deals|Outreach|Rosara|Job search|Consulting|To-dos") throw new Error(`work subnav: ${sub.join("|")}`);
    if ((await page.locator("h1").first().innerText()).trim() !== "Work on now") throw new Error("the heading stays Work on now");
    const tabs = (await page.locator("nav[aria-label='Work sections'] a").allInnerTexts()).map((t) => t.trim().split("\n")[0]);
    if (tabs.join("|") !== "Home|Screen listings|Deals|Outreach|Rosara|Job search|Consulting|To-dos") throw new Error(`tabs: ${tabs.join("|")}`);
    // The Outreach badge (amber) counts the people due today or overdue.
    const dueCount = (await one("select count(*)::int n from contacts where archived_at is null and follow_up_date <= $1", [nyDate(0)])).n;
    if (dueCount < 5) throw new Error(`expected the sample's 5 people due or overdue, found ${dueCount}`);
    for (const t of ["subnav-outreach-due", "tab-outreach-due"]) if ((await page.getByTestId(t).innerText()).trim() !== String(dueCount)) throw new Error(`${t} count`);
    // Ask AI sits in the page header.
    if (!(await page.getByTestId("ask-ai").count())) throw new Error("no Ask AI pill");
    const toScreen = (await one("select count(*)::int n from pipeline_items where screened = false and status = 'open'")).n;
    if (toScreen < 7) throw new Error(`expected the 7 sample listings, found ${toScreen}`);
    for (const t of ["subnav-to-screen", "tab-to-screen", "home-to-screen"]) if ((await page.getByTestId(t).innerText()).trim() !== String(toScreen)) throw new Error(`${t} count`);
    if ((await page.getByTestId("home-listing").count()) !== 3) throw new Error("the Screen listings tile shows the newest three");
    // No count chips; the numbers live in the tiles and the filter pills.
    if (await page.getByTestId("work-chips").count()) throw new Error("count chips are still on Home");
    const glance = Object.fromEntries(await page.getByTestId("glance-row").evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.dataset.count)])));
    // Edit batch B: Broker call sits in Evaluate after CIM review.
    const inDb = await one(`select (select count(*)::int from pipeline_items i join pipeline_stages s on s.id = i.stage_id where i.status = 'open' and i.screened and s.name in ('Interested', 'NDA signed')) early,
      (select count(*)::int from pipeline_items i join pipeline_stages s on s.id = i.stage_id where i.status = 'open' and i.screened and s.name in ('CIM review', 'Broker call', 'Seller call', 'Model')) evaluate,
      (select count(*)::int from pipeline_items i join pipeline_stages s on s.id = i.stage_id where i.status = 'open' and i.screened and s.name in ('Partner presentation', 'IOI or LOI', 'Diligence')) decide`);
    if (glance.early !== inDb.early || glance.evaluate !== inDb.evaluate || glance.decide !== inDb.decide) throw new Error(`glance: ${JSON.stringify(glance)} vs ${JSON.stringify(inDb)}`);
    if (glance.wait !== 2) throw new Error("Waiting over 5 days should count the two long waits");
    // Sections: Overdue (Meridian), Due today, Needs a next action (none in the sample); Waiting over and under 5 days.
    const sections = await page.getByTestId("home-section").evaluateAll((els) => els.map((e) => [e.dataset.section, e.querySelector("[data-testid=section-heading]")?.dataset.count]));
    if (sections.map((x) => x[0]).join(",") !== "overdue,today,needs,wait-over,wait-under") throw new Error(`sections: ${JSON.stringify(sections)}`);
    if (Number(sections[0][1]) < 1 || Number(sections[1][1]) < 3 || Number(sections[3][1]) !== 2) throw new Error(`section counts: ${JSON.stringify(sections)}`);
    if ((await page.getByTestId("next-action-row").count()) < 5) throw new Error("next action rows");
    const pills = await page.getByTestId("waiting-days").evaluateAll((els) => els.map((e) => `${e.innerText}:${e.dataset.tone}`));
    if (!pills.includes("11 days:red") || !pills.includes("6 days:amber")) throw new Error(`wait pills: ${pills.join(",")}`);
    if ((await page.getByTestId("follow-up-button").count()) < 3) throw new Error("Follow up buttons");
    if (await page.locator("button", { hasText: /^Chase$/ }).count()) throw new Error("a Chase button is still shown");
    if (!(await page.getByTestId("work-date").innerText()).match(/^[A-Z][a-z]+day, [A-Z][a-z]{2} \d/)) throw new Error("date");
    // The company name shows where it is set ("00 Fleet Repair Shop, Jacksonville" is listed as Coastal Fleet Maintenance).
    const body = await page.locator("body").innerText();
    if (!body.includes("Coastal Fleet Maintenance") || body.includes("00 Fleet Repair Shop")) throw new Error("the company name should show instead of the listing name");
    if (!(await page.getByTestId("home-listings").innerText()).includes("00 Medicaid Transport Provider")) throw new Error("a listing without a company name shows its 00 name");
    // Today and Close the day are under More.
    await page.goto(`${BASE}/more`);
    const more = await page.getByTestId("more-links").innerText();
    for (const t of ["Today", "Close the day", "Pipelines", "Partner reports", "Old Home"]) if (!more.includes(t)) throw new Error(`More is missing ${t}`);
    await page.goto(`${BASE}/today`);
    await page.getByTestId("today").waitFor();
  });

  // The screenshots of the Work screens, taken on the sample data as loaded (before the steps below change it).
  await step("Work screens at 1280 and on the phone", async () => {
    const reed = await personByName("Mark Reed");
    await shoot3(`${BASE}/work/outreach`, "work-outreach");
    await shoot3(`${BASE}/work/outreach/${reed.id}`, "work-person");
    await shoot3(`${BASE}/work/todos`, "work-todos");
    const dalton = await dealByName("Dalton Services");
    await shoot3(`${BASE}/work`, "work-now");
    await shoot3(`${BASE}/work/listings?add=1`, "work-listings");
    await shoot3(`${BASE}/work/deals`, "work-deals");
    await shoot3(`${BASE}/work/deals/${dalton.id}`, "work-deal");
    // Batch B2: Rosara, a project, Job search, an opportunity, Consulting, a consulting item.
    const platform = await projectByName("Rosara platform");
    const lumen = await itemByName("Lumen Industrial Holdings", "job");
    const sw = await itemByName("Sullivan Wickley", "consulting");
    await shoot3(`${BASE}/work/rosara`, "work-rosara");
    await shoot3(`${BASE}/work/rosara/${platform.id}`, "work-project");
    await shoot3(`${BASE}/work/jobs`, "work-jobs");
    await shoot3(`${BASE}/work/jobs/${lumen.id}`, "work-opportunity");
    await shoot3(`${BASE}/work/consulting`, "work-consulting");
    await shoot3(`${BASE}/work/consulting/${sw.id}`, "work-consulting-item");
  });

  await step("Home: the filter pills show only matching rows and collapse the other sections; Find narrows by name; Collapse all flips to Expand all and is remembered", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-bento").waitFor();
    const pill = async (k) => Number(await page.getByTestId(`home-filter-${k}`).getAttribute("data-count"));
    const shownRows = () => page.locator("[data-testid=home-row][data-hidden='0']").count();
    if ((await pill("all")) !== (await shownRows())) throw new Error("All counts every row");
    await page.getByTestId("home-filter-wait").click();
    if ((await shownRows()) !== (await pill("wait"))) throw new Error("the Waiting filter shows the wrong rows");
    const collapsed = await page.getByTestId("home-section").evaluateAll((els) => els.map((e) => [e.dataset.section, e.dataset.collapsed, !!e.querySelector("[data-testid=home-row][data-hidden='0']"), Number(e.querySelector("[data-testid=section-heading]")?.dataset.count)]));
    for (const [name, c, hasMatch, n] of collapsed) if (n && c !== (hasMatch ? "0" : "1")) throw new Error(`${name} should be ${hasMatch ? "open" : "collapsed"} under Waiting on someone`);
    await page.screenshot({ path: path.join(OUT, "flow-work-home-filter.png") });
    await page.getByTestId("home-filter-all").click();
    if ((await shownRows()) !== (await pill("all"))) throw new Error("All shows every row again");
    await page.getByTestId("home-search").fill("summit");
    const found = await page.locator("[data-testid=home-row][data-hidden='0']").allInnerTexts();
    if (!found.length || found.some((t) => !t.includes("Summit Logistics Group"))) throw new Error(`Find: ${found.join(" | ").slice(0, 120)}`);
    await page.getByTestId("home-search").fill("");
    // Collapse all: every section with rows collapses, the label flips, the choice is remembered in this browser.
    const ca = page.getByTestId("collapse-all");
    if ((await ca.innerText()).trim() !== "Collapse all") throw new Error("label before");
    await ca.click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Expand all");
    if (await page.locator("[data-testid=home-section][data-collapsed='0'] [data-testid=section-heading]:not([data-count='0'])").count()) throw new Error("a section with rows is still open");
    if (await page.getByTestId("home-row").count()) throw new Error("rows still drawn under collapsed sections");
    await page.screenshot({ path: path.join(OUT, "flow-work-home-collapsed.png") });
    await page.reload();
    await page.getByTestId("home-bento").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Expand all", null, { timeout: 10000 }).catch(() => { throw new Error("Collapse all not remembered"); });
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Collapse all");
    if ((await shownRows()) !== (await pill("all"))) throw new Error("Expand all shows every row");
    // Deals at a glance: "Waiting over 5 days" opens Deals with the Waiting on someone filter on; "Needs a next action" too.
    await page.locator("[data-testid=glance-row][data-key=wait]").click();
    await page.waitForURL(/\/work\/deals\?filter=wait$/);
    await page.getByTestId("deals-columns").waitFor();
    if ((await page.getByTestId("deals-filter-wait").getAttribute("aria-pressed")) !== "true") throw new Error("the Waiting filter is not preselected on Deals");
    const dealsPill = Number(await page.getByTestId("deals-filter-wait").getAttribute("data-count"));
    if ((await page.locator("[data-testid=deal-row][data-hidden='0']").count()) !== dealsPill) throw new Error("Deals shows only the waiting cards");
    await page.goto(`${BASE}/work/deals?filter=needs`);
    await page.getByTestId("deals-columns").waitFor();
    if ((await page.getByTestId("deals-filter-needs").getAttribute("aria-pressed")) !== "true") throw new Error("the Needs filter is not preselected");
    await page.goto(`${BASE}/work/deals?filter=nonsense`);
    await page.getByTestId("deals-columns").waitFor();
    if ((await page.getByTestId("deals-filter-all").getAttribute("aria-pressed")) !== "true") throw new Error("an unknown filter should mean All");
  });

  await step("Screen listings: Add a listing by pasting text (the AI stand-in fills both names and the fields), save, the buy box says Fits", async () => {
    await page.goto(`${BASE}/work/listings?add=1`);
    await page.getByTestId("add-listing-card").waitFor();
    await page.getByTestId("listing-text").fill(["For sale: Commercial cleaning company (broker newsletter)", "Company: Riverbend Commercial Cleaning", "Janitorial for office parks and medical buildings, 60 recurring contracts", "Revenue: $4.1M. SDE: $1.2M. Asking price: $3.9M", "Location: Macon, GA", "Industry: Commercial services", "Broker: Sunbelt, Dana Whitfield", "https://www.example.com/listings/riverbend"].join("\n"));
    await page.getByTestId("listing-fill").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=listing-name]")?.value === "00 Commercial Cleaning", null, { timeout: 15000 });
    const got = {};
    for (const k of ["company", "earnings", "revenue", "asking", "location", "broker", "link", "industry"]) got[k] = await page.getByTestId(`listing-${k}`).inputValue();
    if (got.company !== "Riverbend Commercial Cleaning" || got.earnings !== "$1.2M SDE" || got.revenue !== "$4.1M" || got.asking !== "$3.9M" || got.location !== "Macon, GA" || !got.broker.includes("Sunbelt") || !got.link.includes("riverbend")) throw new Error(`filled: ${JSON.stringify(got)}`);
    // A typed value is kept when Fill from text runs again.
    await page.getByTestId("listing-what").fill("Janitorial for office parks and medical buildings");
    await page.getByTestId("listing-save").click();
    await page.waitForURL(/\/work\/listings\?saved=/);
    await expectText(page, "Saved Riverbend Commercial Cleaning to the list.");
    const row = page.getByTestId("listing-row").filter({ hasText: "Riverbend Commercial Cleaning" });
    await row.waitFor();
    if ((await row.innerText()).includes("00 Commercial Cleaning")) throw new Error("the row should show the company name, not the listing name");
    if ((await row.getByTestId("buy-box-pill").innerText()).trim() !== "Fits") throw new Error(`buy box: ${await row.getByTestId("buy-box-pill").innerText()}`);
    if (!(await row.getByTestId("listing-earnings-stat").innerText()).includes("SDE")) throw new Error("earnings stat should say SDE");
    // Interested is the soft blue button, Add a listing the solid one.
    const soft = await row.getByTestId("interested-button").evaluate((e) => getComputedStyle(e).backgroundColor);
    const solid = await page.getByTestId("add-listing-button").evaluate((e) => getComputedStyle(e).backgroundColor);
    if (soft !== "rgb(234, 242, 255)" || solid !== "rgb(20, 41, 123)") throw new Error(`button colors: interested ${soft}, add ${solid}`);
    const d = await dealByName("Riverbend Commercial Cleaning");
    const fin = await one("select revenue, ebitda, sde, asking_price from deal_financials where item_id = $1", [d.id]);
    if (d.name !== "00 Commercial Cleaning" || d.company_name !== "Riverbend Commercial Cleaning" || d.screened !== false || d.stage !== null || Number(fin.sde) !== 1200000 || fin.ebitda !== null || Number(fin.revenue) !== 4100000 || Number(fin.asking_price) !== 3900000) throw new Error(JSON.stringify({ d, fin }));
    await page.screenshot({ path: path.join(OUT, "flow-work-listings.png"), fullPage: true });
  });

  await step("Fill from text: when the AI never returns the fields, the error shows its reply (first 300 characters) and Try again; a typed listing saves with its 00 name", async () => {
    await aipost("/__mode", { listing: "invalid" });
    await page.goto(`${BASE}/work/listings?add=1`);
    await page.getByTestId("add-listing-card").waitFor();
    await page.getByTestId("listing-text").fill("Industrial filtration distributor in Macon, about $4M in sales, serving plants across Georgia. Broker: Sunbelt.");
    const callsBefore = (await aicalls()).filter((c) => c === "listing_fields").length;
    await page.getByTestId("listing-fill").click();
    await page.getByTestId("listing-fill-error").waitFor({ timeout: 20000 });
    const reply = (await page.getByTestId("listing-fill-reply").innerText()).trim();
    if (!reply.startsWith("I can see an industrial filtration distributor") || reply.length > 300) throw new Error(`reply shown: ${reply.slice(0, 80)}`);
    // Asked once more with the problems listed (two calls), then gave up.
    if ((await aicalls()).filter((c) => c === "listing_fields").length !== callsBefore + 2) throw new Error("expected one retry");
    await page.getByTestId("listing-fill-retry").click();
    // The retry runs: the error line goes away while the AI is asked, then comes back.
    await page.waitForFunction(() => !document.querySelector("[data-testid=listing-fill-reply]"), null, { timeout: 5000 }).catch(() => null);
    await page.getByTestId("listing-fill-error").waitFor({ timeout: 20000 });
    if ((await aicalls()).filter((c) => c === "listing_fields").length !== callsBefore + 4) throw new Error("Try again should ask again");
    if ((await page.getByTestId("listing-text").inputValue()).length < 20) throw new Error("the pasted text was lost");
    await aipost("/__mode", { listing: "valid" });
    // Typed by hand: the listing name and no company name.
    await page.getByTestId("listing-name").fill("00 Industrial Filtration Distributor");
    await page.getByTestId("listing-revenue").fill("$4M");
    await page.getByTestId("listing-earnings").fill("$900K cash flow");
    await page.getByTestId("listing-location").fill("Macon, GA");
    await page.getByTestId("listing-save").click();
    await page.waitForURL(/\/work\/listings\?saved=/);
    await expectText(page, "Saved 00 Industrial Filtration Distributor to the list.");
    const d = await dealByName("00 Industrial Filtration Distributor");
    const fin = await one("select sde, ebitda from deal_financials where item_id = $1", [d.id]);
    if (d.company_name !== null || Number(fin.sde) !== 900000 || fin.ebitda !== null) throw new Error(`typed listing: ${JSON.stringify({ d, fin })}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-listings-fill-error.png"), fullPage: true });
  });

  await step("Screen listings: the filter pills count fits and misses; Pass with a reason removes the row, keeps it in the Passed list, and Find finds it there", async () => {
    await page.goto(`${BASE}/work/listings`);
    await page.getByTestId("to-screen-card").waitFor();
    const pill = async (k) => Number(await page.getByTestId(`listings-filter-${k}`).getAttribute("data-count"));
    const rows = page.locator("[data-testid=listing-row][data-hidden='0']");
    if ((await pill("all")) !== (await rows.count()) || (await pill("fit")) + (await pill("nofit")) !== (await pill("all"))) throw new Error("listing filter counts");
    await page.getByTestId("listings-filter-fit").click();
    if ((await rows.count()) !== (await pill("fit")) || (await page.locator("[data-testid=listing-row][data-hidden='0'][data-fits='0']").count())) throw new Error("Fits buy box shows the wrong rows");
    await page.getByTestId("listings-filter-all").click();
    const before = Number((await page.getByTestId("tab-to-screen").innerText()).trim());
    const row = page.getByTestId("listing-row").filter({ hasText: "Titan Steel Fabrication" });
    if ((await row.getByTestId("buy-box-pill").innerText()).trim() !== "Too big") throw new Error("Titan should be too big");
    await row.getByTestId("pass-button").click();
    await page.getByTestId("pass-menu").waitFor();
    await page.getByTestId("pass-reason-too_big").click();
    await row.getByTestId("listing-result").waitFor();
    await page.waitForFunction((n) => document.querySelector("[data-testid=tab-to-screen]")?.innerText.trim() === String(n - 1), before, { timeout: 15000 });
    const d = await dealByName("Titan Steel Fabrication");
    if (d.stage !== "Passed" || d.pass_reason !== "too_big" || d.screened !== true) throw new Error(JSON.stringify(d));
    // Passed is collapsed by default; the Passed pill opens it and shows only passed rows; Find narrows them.
    if ((await page.getByTestId("passed-card").getAttribute("data-collapsed")) !== "1") throw new Error("Passed should start collapsed");
    await page.getByTestId("listings-filter-passed").click();
    await page.locator("[data-testid=passed-card][data-collapsed='0']").waitFor();
    if ((await page.getByTestId("to-screen-card").getAttribute("data-collapsed")) !== "1") throw new Error("To screen should collapse under the Passed filter");
    await page.getByTestId("listings-search").fill("titan");
    const prow = page.getByTestId("passed-row");
    if ((await prow.count()) !== 1 || (await prow.first().getByTestId("passed-reason").innerText()).trim() !== "Too big") throw new Error("passed list search");
    await page.getByTestId("listings-search").fill("zzzz");
    await page.getByTestId("passed-empty").waitFor();
    await page.getByTestId("listings-search").fill("");
    await page.getByTestId("listings-filter-all").click();
    // Collapse all on this page too.
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Expand all");
    if (await page.getByTestId("listing-row").count()) throw new Error("rows still drawn under the collapsed To screen");
    await page.getByTestId("collapse-all").click();
    await page.getByTestId("listing-row").first().waitFor();
  });

  await step("Interested fills the open questions with the AI stand-in; then Done twice from Home moves the deal through two stages (Yes); Not yet clears the action", async () => {
    await page.goto(`${BASE}/work/listings`);
    const row = page.getByTestId("listing-row").filter({ hasText: "Riverbend Commercial Cleaning" });
    const qBefore = (await aicalls()).filter((c) => c === "open_questions").length;
    await row.getByTestId("interested-button").click();
    await row.getByTestId("listing-result").waitFor({ timeout: 20000 });
    const result = await row.getByTestId("listing-result").innerText();
    if (!result.includes("now a deal at Interested") || !result.includes("Open questions drafted by the AI")) throw new Error(`interested confirmation: ${result}`);
    if ((await aicalls()).filter((c) => c === "open_questions").length !== qBefore + 1) throw new Error("Interested should ask the AI for questions once");
    let d = await dealByName("Riverbend Commercial Cleaning");
    if (d.stage !== "Interested" || d.next_action !== "Sign the NDA and ask the broker for a call" || d.next_action_due !== nyDate(1)) throw new Error(JSON.stringify(d));
    const q = d.open_questions_json;
    if (!q || q.seller.length !== 2 || q.broker.length !== 2 || q.self.length !== 1 || !q.seller[0].includes("Riverbend Commercial Cleaning")) throw new Error(`questions: ${JSON.stringify(q)}`);
    if (!(await one("select 1 x from tasks where pipeline_item_id = $1 and status = 'todo' and title = $2", [d.id, `00 Commercial Cleaning: ${d.next_action}`]))) throw new Error("no task for the next action");
    // Due today, so it shows on Home.
    await pg.query("update pipeline_items set next_action_due = $2 where id = $1", [d.id, nyDate(0)]);
    for (const expectStage of ["NDA signed", "CIM review"]) {
      await page.goto(`${BASE}/work`);
      const r = page.locator(`[data-testid=next-action-row][data-deal="${d.id}"]`);
      await r.waitFor();
      await r.getByTestId("next-action-done").click();
      await r.getByTestId("next-action-ask").waitFor();
      if (!(await r.getByTestId("next-action-ask").innerText()).includes(`to ${expectStage}?`)) throw new Error(`ask text: ${await r.getByTestId("next-action-ask").innerText()}`);
      if (await r.getByTestId("next-action-todo").count()) throw new Error("no to-do, so no Next: choice");
      await r.getByTestId("next-action-yes").click();
      await r.getByTestId("next-action-result").waitFor();
      if (!(await r.getByTestId("next-action-result").innerText()).includes(`moved to ${expectStage}`)) throw new Error("result text");
      for (let i = 0; i < 40 && (await dealByName("Riverbend Commercial Cleaning")).stage !== expectStage; i++) await page.waitForTimeout(250);
      d = await dealByName("Riverbend Commercial Cleaning");
      if (d.stage !== expectStage) throw new Error(`stage ${d.stage}`);
      await pg.query("update pipeline_items set next_action_due = $2 where id = $1", [d.id, nyDate(0)]);
    }
    if (!d.next_action.startsWith("Write the key finding")) throw new Error(`next action after two moves: ${d.next_action}`);
    const done = (await one("select count(*)::int n from tasks where pipeline_item_id = $1 and status = 'done'", [d.id])).n;
    if (done < 2) throw new Error(`done tasks: ${done}`);
    // Not yet: the deal stays and needs a next action.
    await page.goto(`${BASE}/work`);
    const r = page.locator(`[data-testid=next-action-row][data-deal="${d.id}"]`);
    await r.getByTestId("next-action-done").click();
    await r.getByTestId("next-action-not-yet").click();
    await r.getByTestId("next-action-result").waitFor();
    for (let i = 0; i < 40 && (await dealByName("Riverbend Commercial Cleaning")).next_action !== null; i++) await page.waitForTimeout(250);
    d = await dealByName("Riverbend Commercial Cleaning");
    if (d.stage !== "CIM review" || d.next_action !== null) throw new Error(JSON.stringify(d));
    // It now shows under Needs a next action on Home, with Set next action (outlined cobalt, not solid).
    await page.goto(`${BASE}/work`);
    if ((await page.locator(`[data-testid=needs-action-row][data-deal="${d.id}"] [data-testid=set-next-action]`).getAttribute("data-tone")) !== "cobalt") throw new Error("Set next action should be outlined");
    await page.goto(`${BASE}/work`);
    await page.locator(`[data-testid=needs-action-row][data-deal="${d.id}"] [data-testid=set-next-action]`).waitFor();
    await page.goto(`${BASE}/work/deals`);
    const dr = page.locator(`[data-testid=deal-row][data-deal="${d.id}"]`);
    await dr.getByTestId("needs-action").waitFor();
    await page.screenshot({ path: path.join(OUT, "flow-work-deals.png"), fullPage: true });
  });

  await step("Later moves a next action to tomorrow (the deal and its task); Done on a typed action with no to-dos only clears it", async () => {
    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work`);
    const r = page.locator(`[data-testid=next-action-row][data-deal="${dalton.id}"]`);
    await r.waitFor();
    await r.getByTestId("next-action-later").click();
    await r.getByTestId("later-tomorrow").click();
    await r.getByTestId("next-action-result").waitFor();
    for (let i = 0; i < 40 && (await dealByName("Dalton Services")).next_action_due !== nyDate(1); i++) await page.waitForTimeout(250);
    const after = await dealByName("Dalton Services");
    if (after.next_action_due !== nyDate(1)) throw new Error(`due ${after.next_action_due}`);
    const task = await one("select due_date::text from tasks where pipeline_item_id = $1 and status = 'todo' and title = $2", [dalton.id, `Dalton Services: ${dalton.next_action}`]);
    if (task && task.due_date !== nyDate(1)) throw new Error(`task due ${task.due_date}`);
    await pg.query("update pipeline_items set next_action_due = $2 where id = $1", [dalton.id, nyDate(0)]);
    // Hilltop's action is the stage default. Meridian's is typed: with its to-dos, Done offers the top one (checked on the deal page later);
    // without to-dos it clears at once. Ridgeline has a typed action and no to-dos.
    const ridgeline = await dealByName("Ridgeline Commercial Roofing");
    await pg.query("update pipeline_items set next_action = 'Call the partner about the roofing backlog', next_action_due = $2 where id = $1", [ridgeline.id, nyDate(0)]);
    await page.goto(`${BASE}/work`);
    const m = page.locator(`[data-testid=next-action-row][data-deal="${ridgeline.id}"]`);
    await m.getByTestId("next-action-done").click();
    await m.getByTestId("next-action-result").waitFor();
    if (await m.getByTestId("next-action-ask").count()) throw new Error("a typed action without to-dos should not ask");
    for (let i = 0; i < 40 && (await dealByName("Ridgeline Commercial Roofing")).next_action !== null; i++) await page.waitForTimeout(250);
    if ((await dealByName("Ridgeline Commercial Roofing")).stage !== "Partner presentation") throw new Error("Ridgeline moved");
  });

  await step("Follow up opens the email editor with a drafted follow-up; sending through the Google stand-in logs it on the deal and resets the wait (Followed up)", async () => {
    const summit = await dealByName("Summit Logistics Group");
    const sentBefore = (await gsent()).length;
    await page.goto(`${BASE}/work`);
    const r = page.locator(`[data-testid=waiting-row][data-deal="${summit.id}"]`);
    await r.waitFor();
    if ((await r.getByTestId("waiting-days").getAttribute("data-tone")) !== "red") throw new Error("Summit should be red");
    if (!(await r.getByTestId("waiting-since").innerText()).includes("CIM review")) throw new Error("the stage shows next to Since");
    await r.getByTestId("follow-up-button").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    if ((await composeTo(page)) !== "mark.reed@example.com") throw new Error(`To is ${await composeTo(page)}`);
    if ((await page.getByTestId("compose-subject").inputValue()) !== "Following up on Summit Logistics Group") throw new Error("subject");
    const body = await shownText(page.getByTestId("compose-body"));
    if (!body.includes("Hi Mark,") || !body.includes("a seller call to be scheduled") || !body.includes("11 days")) throw new Error(`body: ${body.slice(0, 120)}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-follow-up.png") });
    await page.getByTestId("send-now").click();
    const confirm = page.getByRole("dialog", { name: "Send this email?" });
    await confirm.waitFor();
    await page.getByTestId("send-confirm").click();
    await dlg.getByTestId("send-success").waitFor();
    if ((await gsent()).length !== sentBefore + 1) throw new Error("Gmail did not get the follow-up");
    await page.getByTestId("compose-close").click();
    await r.getByTestId("follow-up-sent").waitFor();
    if (!(await r.getByTestId("follow-up-sent").innerText()).startsWith("Followed up")) throw new Error("the confirmation should say Followed up");
    for (let i = 0; i < 40 && (await dealByName("Summit Logistics Group")).waiting_since !== nyDate(0); i++) await page.waitForTimeout(250);
    const after = await dealByName("Summit Logistics Group");
    if (after.waiting_since !== nyDate(0) || after.waiting_on !== summit.waiting_on) throw new Error(JSON.stringify(after));
    const comm = await one("select id, subject from communications where pipeline_item_id = $1 and subject = 'Following up on Summit Logistics Group'", [summit.id]);
    if (!comm) throw new Error("the follow-up was not logged on the deal");
    await page.goto(`${BASE}/work/deals/${summit.id}`);
    await page.getByTestId("timeline-event").filter({ hasText: "Following up on Summit Logistics Group" }).waitFor();
    if (!(await page.getByTestId("deal-wait-pill").innerText()).includes("Today")) throw new Error("the deal page should show the wait reset to today");
  });

  await step("Deal page: Listed as, Findings (key finding grows, open questions outline, Suggest questions, Email these questions prefilled), Also to do (add, suggest, make next action), Done offers the top to-do", async () => {
    // A deal with both names shows the company name as the title and "Listed as" under it.
    const coastal = await dealByName("Coastal Fleet Maintenance");
    await page.goto(`${BASE}/work/deals/${coastal.id}`);
    await page.getByTestId("work-deal").waitFor();
    if ((await page.locator("h1").first().innerText()).trim() !== "Coastal Fleet Maintenance") throw new Error("title should be the company name");
    if ((await page.getByTestId("deal-listed-as").innerText()).trim() !== "Listed as 00 Fleet Repair Shop, Jacksonville") throw new Error("Listed as");
    // The record-page rule: left Findings, Next action, Tasks; right Facts, Timeline, Documents, Decision.
    const order = await page.locator("[data-testid=work-deal] section[data-testid^=deal-], [data-testid=work-deal] [data-testid=panel-documents]").evaluateAll((els) => els.map((e) => e.dataset.testid));
    if (order.join(",") !== "deal-findings,deal-next-action,deal-todos,deal-facts,deal-timeline,panel-documents,deal-decision") throw new Error(`card order: ${order.join(",")}`);
    // The Tasks card (was Also to do) and the three header figures.
    if ((await page.getByTestId("deal-todos").locator("h2").innerText()).trim() !== "Tasks") throw new Error("the checklist should be titled Tasks");
    if (await page.locator("body", { hasText: "Also to do" }).count() && (await page.locator("body").innerText()).includes("Also to do")) throw new Error("Also to do is still on the deal page");
    const figs = await page.getByTestId("record-figures").locator("[data-testid^=figure-]").evaluateAll((els) => els.map((e) => e.dataset.testid));
    if (figs.join(",") !== "figure-next,figure-tasks,figure-last") throw new Error(`figures: ${figs.join(",")}`);
    // Add a note sits below the timeline list.
    const noteBelow = await page.getByTestId("deal-timeline").evaluate((card) => {
      const events = card.querySelector("[data-testid=timeline-events]").getBoundingClientRect();
      const form = card.querySelector("[data-testid=note-form]").getBoundingClientRect();
      return form.top >= events.bottom - 1;
    });
    if (!noteBelow) throw new Error("Add a note should sit below the timeline");

    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    await page.getByTestId("work-deal").waitFor();
    const status = await page.getByTestId("deal-status-line").innerText();
    if (!status.includes("Broker call · day 4") || !status.includes("Not waiting on anyone")) throw new Error(`status line: ${status}`);
    if ((await page.getByTestId("timeline-event").count()) < 6 || (await page.getByTestId("panel-documents").innerText()).includes("No documents")) throw new Error("timeline or documents");
    if (!(await page.getByTestId("fact-asking").innerText()).includes("(3.5x)")) throw new Error("multiple");
    // The open questions outline: the sample's three groups, every line a text box.
    const groups = await page.getByTestId("question-group").evaluateAll((els) => els.map((e) => [e.dataset.group, Number(e.dataset.count)]));
    if (groups.map((g) => g[0]).join(",") !== "seller,broker,self" || groups[0][1] !== 4 || groups[1][1] !== 3 || groups[2][1] !== 3) throw new Error(`groups: ${JSON.stringify(groups)}`);
    const labels = await page.getByTestId("findings-form").innerText();
    for (const t of ["Key finding", "Open questions", "Ask the seller", "Ask the broker", "Find out myself", "Filled by the AI when a listing becomes Interested. Edit anything."]) if (!labels.includes(t)) throw new Error(`Findings is missing "${t}"`);
    if (labels.includes("One line that decides it")) throw new Error("the old subtitle is still there");
    // The key finding box grows with its text (a textarea that gets taller).
    const h1 = await page.getByTestId("key-finding").evaluate((e) => e.getBoundingClientRect().height);
    await page.getByTestId("key-finding").fill("70% recurring; the service side is the growth question.\nTechnician tenure is long.\nThe asking multiple is fair if the top customer stays.\nAsk about the warranty backlog.");
    const h2 = await page.getByTestId("key-finding").evaluate((e) => e.getBoundingClientRect().height);
    if (h2 <= h1 + 20) throw new Error(`key finding did not grow: ${h1} -> ${h2}`);
    // Edit a line, delete a line, add a line.
    const sellerGroup = page.locator("[data-testid=question-group][data-group=seller]");
    await sellerGroup.getByTestId("question-input").first().fill("Why sell now at 58, and would you stay 18 months after close?");
    await sellerGroup.getByTestId("question-delete").last().click();
    await page.getByTestId("question-add-self").click();
    await page.locator("[data-testid=question-group][data-group=self] [data-testid=question-input]").last().fill("What do service techs earn in Chattanooga?");
    await page.getByTestId("findings-save").click();
    await page.getByTestId("deal-findings").getByTestId("save-ok").waitFor();
    let saved = await dealByName("Dalton Services");
    if (saved.open_questions_json.seller.length !== 3 || saved.open_questions_json.seller[0] !== "Why sell now at 58, and would you stay 18 months after close?" || saved.open_questions_json.self.length !== 4 || !saved.key_finding.includes("warranty backlog")) throw new Error(`saved questions: ${JSON.stringify(saved.open_questions_json)}`);
    // Suggest questions: the AI stand-in adds lines that are not there yet (saved on the deal; the note says how many).
    await page.getByTestId("suggest-questions").click();
    await page.getByTestId("suggest-note").waitFor({ timeout: 20000 });
    if (!(await page.getByTestId("suggest-note").innerText()).includes("5 suggested")) throw new Error(`suggest note: ${await page.getByTestId("suggest-note").innerText()}`);
    saved = await dealByName("Dalton Services");
    if (saved.open_questions_json.seller.length !== 5 || saved.open_questions_json.broker.length !== 5 || saved.open_questions_json.self.length !== 5) throw new Error(`after suggest: ${JSON.stringify(saved.open_questions_json)}`);
    if ((await page.getByTestId("findings-save").isDisabled()) !== true) throw new Error("nothing is unsaved after Suggest questions");
    // Email these questions: the editor opens to the broker with the seller and broker groups as bullets under their headings.
    await page.getByTestId("email-questions").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    if ((await composeTo(page)) !== "rachel.kim@example.com") throw new Error(`To is ${await composeTo(page)}`);
    if ((await page.getByTestId("compose-subject").inputValue()) !== "Dalton Services, questions") throw new Error("subject");
    const body = await editorText(page.getByTestId("compose-body"));
    if (!body.includes("Hi Rachel,") || !body.includes("Ask the seller") || !body.includes("Ask the broker") || !body.includes("- Why sell now at 58, and would you stay 18 months after close?") || !body.includes("- Can we get 3 years of tax returns and the monthly P&L?")) throw new Error(`body: ${body.slice(0, 200)}`);
    if (body.includes("Find out myself") || body.includes("What do service techs earn")) throw new Error("Find out myself should stay on the deal page");
    const sendTo = page.getByTestId("compose-recipient");
    if (!(await sendTo.innerText()).includes("(Broker)")) throw new Error("the broker should be listed as the broker");
    await page.screenshot({ path: path.join(OUT, "flow-work-email-questions.png") });
    const sentBefore = (await gsent()).length;
    await page.getByTestId("send-now").click();
    await page.getByRole("dialog", { name: "Send this email?" }).waitFor();
    await page.getByTestId("send-confirm").click();
    await dlg.getByTestId("send-success").waitFor();
    if ((await gsent()).length !== sentBefore + 1) throw new Error("Gmail did not get the questions");
    await page.getByTestId("compose-close").click();
    await page.getByTestId("timeline-event").filter({ hasText: "Dalton Services, questions" }).waitFor({ timeout: 15000 });
    if (!(await one("select 1 x from communications where pipeline_item_id = $1 and subject = 'Dalton Services, questions'", [dalton.id]))) throw new Error("the questions email was not logged on the deal");

    // Also to do: the sample's three items; add one, Suggest adds the stand-in's, Make this the next action swaps it in and keeps the old action as an item.
    const todos = page.getByTestId("deal-todos");
    if ((await todos.getByTestId("todo-item").count()) !== 3) throw new Error("Dalton should start with 3 to-dos");
    await todos.getByTestId("todo-add").click();
    await todos.getByTestId("todo-input").fill("Call the two reference customers");
    await todos.getByTestId("todo-save").click();
    await todos.getByTestId("todo-item").filter({ hasText: "Call the two reference customers" }).waitFor();
    await todos.getByTestId("todo-suggest").click();
    await todos.getByTestId("todo-note").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=deal-todos] [data-testid=todo-item]").length === 7, null, { timeout: 15000 });
    let rows = await todosOf(dalton.id);
    if (rows.length !== 7 || !rows.some((t) => t.text === "Read the CIM of Dalton Services end to end")) throw new Error(`to-dos: ${rows.map((t) => t.text).join(" | ")}`);
    // The checkbox marks one done (struck through, at the bottom); the x deletes one.
    const first = todos.getByTestId("todo-item").first();
    const firstText = (await first.getByTestId("todo-text").innerText()).trim();
    await first.getByTestId("todo-check").check();
    await page.waitForFunction((t) => [...document.querySelectorAll("[data-testid=deal-todos] [data-testid=todo-item][data-done='1']")].some((e) => e.innerText.includes(t)), firstText, { timeout: 15000 });
    rows = await todosOf(dalton.id);
    if (!rows.find((t) => t.text === firstText).done_at) throw new Error("done_at not set");
    const last = todos.getByTestId("todo-item").filter({ hasText: "Compare Dalton Services with the last two deals passed on" });
    await last.getByTestId("todo-delete").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=deal-todos] [data-testid=todo-item]").length === 6, null, { timeout: 15000 });
    // Make this the next action.
    const target = todos.getByTestId("todo-item").filter({ hasText: "Call the two reference customers" });
    await target.getByTestId("todo-make-next").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=na-action]")?.value === "Call the two reference customers", null, { timeout: 15000 });
    saved = await dealByName("Dalton Services");
    if (saved.next_action !== "Call the two reference customers" || saved.next_action_due !== nyDate(1)) throw new Error(`next action: ${JSON.stringify(saved)}`);
    rows = await todosOf(dalton.id);
    if (rows.some((t) => t.text === "Call the two reference customers") || !rows.some((t) => t.text === "Review the CIM and write the key finding" && t.position === 0)) throw new Error(`after make next: ${rows.map((t) => `${t.position}:${t.text}`).join(" | ")}`);
    if ((await page.getByTestId("na-due").inputValue()) !== nyDate(1)) throw new Error("due tomorrow on the card");
    // Done on this typed action offers the top to-do as the next action.
    await page.getByTestId("next-action-done").click();
    await page.getByTestId("next-action-ask").waitFor();
    const choice = page.getByTestId("next-action-todo");
    if (!(await choice.innerText()).includes("Next: Review the CIM and write the key finding")) throw new Error(`Next choice: ${await choice.innerText()}`);
    await choice.click();
    await page.waitForFunction(() => document.querySelector("[data-testid=na-action]")?.value === "Review the CIM and write the key finding", null, { timeout: 15000 });
    saved = await dealByName("Dalton Services");
    if (saved.next_action !== "Review the CIM and write the key finding" || saved.next_action_due !== nyDate(1) || (await todosOf(dalton.id)).some((t) => t.text === saved.next_action)) throw new Error(`after Done with to-do: ${JSON.stringify(saved)}`);
    // Done on the stage default offers Yes (move), the top to-do, and Not yet: Hilltop with a to-do added.
    const hilltop = await dealByName("Hilltop Pest Solutions");
    await pg.query("insert into deal_todos (owner_id, deal_id, text, position) values ($1, $2, 'Ask about the route density', 1)", [OWNER, hilltop.id]);
    await page.goto(`${BASE}/work`);
    const hr = page.locator(`[data-testid=next-action-row][data-deal="${hilltop.id}"]`);
    await hr.waitFor();
    await hr.getByTestId("next-action-done").click();
    await hr.getByTestId("next-action-ask").waitFor();
    const askText = await hr.getByTestId("next-action-ask").innerText();
    if (!askText.includes("to NDA signed?") || !askText.includes("Next: Ask about the route density") || !askText.includes("Not yet")) throw new Error(`ask with to-do: ${askText}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-done-todo.png") });
    await hr.getByTestId("next-action-todo").click();
    await hr.getByTestId("next-action-result").waitFor();
    for (let i = 0; i < 40 && (await dealByName("Hilltop Pest Solutions")).next_action !== "Ask about the route density"; i++) await page.waitForTimeout(250);
    const h = await dealByName("Hilltop Pest Solutions");
    if (h.stage !== "Interested" || h.next_action !== "Ask about the route density" || (await todosOf(hilltop.id)).length !== 0) throw new Error(`Hilltop after Next: ${JSON.stringify(h)}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-deal.png"), fullPage: true });
  });

  await step("Deal page: next action, facts (two names), a note; Advance moves the stage; Pass with a reason (charcoal pill); the Deals filters, Find, Collapse all, and a remembered stage", async () => {
    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    await page.getByTestId("work-deal").waitFor();
    // Next action: block minutes and waiting on
    await page.getByTestId("na-minutes").fill("75");
    await page.getByTestId("na-waiting").fill("Rachel Kim");
    await page.getByTestId("na-save").click();
    await page.getByTestId("deal-next-action").getByTestId("save-ok").waitFor();
    // Facts: the listing name and the company name are two fields.
    await page.getByTestId("facts-edit").click();
    if ((await page.getByTestId("fact-name").inputValue()) !== "Dalton Services" || (await page.getByTestId("fact-companyName").inputValue()) !== "") throw new Error("facts name fields");
    await page.getByTestId("fact-revenue").fill("$5.9M");
    await page.getByTestId("fact-whySelling").fill("Retiring at 58, no successor");
    await page.getByTestId("facts-save").click();
    await page.getByTestId("facts-grid").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=fact-revenue]")?.innerText.includes("$5.9M"), null, { timeout: 15000 });
    // A note (under the timeline)
    await page.getByTestId("deal-note").fill("Flow note: technician tenure averages 6 years.");
    await page.getByTestId("note-save").click();
    await page.getByTestId("timeline-event").filter({ hasText: "Flow note: technician tenure" }).waitFor();
    await page.reload();
    if (!(await page.getByTestId("key-finding").inputValue()).includes("warranty backlog")) throw new Error("key finding not kept");
    if ((await page.getByTestId("na-minutes").inputValue()) !== "75" || (await page.getByTestId("na-waiting").inputValue()) !== "Rachel Kim") throw new Error("next action not kept");
    if (!(await page.getByTestId("deal-wait-pill").innerText()).includes("Waiting on Rachel Kim")) throw new Error("wait pill");
    const saved = await one("select f.revenue, i.why_selling, i.next_action_minutes, i.waiting_on from pipeline_items i join deal_financials f on f.item_id = i.id where i.id = $1", [dalton.id]);
    if (Number(saved.revenue) !== 5900000 || saved.why_selling !== "Retiring at 58, no successor" || saved.next_action_minutes !== 75) throw new Error(JSON.stringify(saved));
    // Advance
    await page.getByTestId("decision-advance").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=deal-stage-pill]")?.innerText.includes("Seller call"), null, { timeout: 15000 });
    // A typed next action is kept on a stage move (the approved rule); only a stage default is replaced.
    const moved = await dealByName("Dalton Services");
    if (moved.stage !== "Seller call" || moved.next_action !== "Review the CIM and write the key finding" || moved.waiting_on !== null) throw new Error(JSON.stringify(moved));
    await page.getByTestId("timeline-event").filter({ hasText: "Moved to Seller call" }).waitFor();
    // Pass with a reason (header button) on another deal: the Passed pill is charcoal with white text.
    const oakline = await dealByName("Oakline Dental Lab");
    await page.goto(`${BASE}/work/deals/${oakline.id}`);
    await page.getByTestId("deal-pass").click();
    await page.getByTestId("pass-reason-no_growth_path").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=decision-closed]")?.innerText.includes("No growth path"), null, { timeout: 15000 });
    const passed = await dealByName("Oakline Dental Lab");
    if (passed.stage !== "Passed" || passed.pass_reason !== "no_growth_path") throw new Error(JSON.stringify(passed));
    if (await page.getByTestId("deal-advance").count()) throw new Error("a passed deal still offers Advance");
    const pillStyle = await page.getByTestId("deal-stage-pill").evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    if (pillStyle[0] !== "rgb(75, 85, 99)" || pillStyle[1] !== "rgb(255, 255, 255)") throw new Error(`Passed pill: ${pillStyle.join(" / ")}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-deal-passed.png") });
    // Deals: three phase columns with the nine stages, the stage counts match, the filters count and collapse,
    // a card opens the deal page, Passed and Lost in the bar under the columns
    await page.goto(`${BASE}/work/deals`);
    const phases = await page.getByTestId("deals-phase").evaluateAll((els) => els.map((e) => [e.dataset.phase, Number(e.dataset.count)]));
    if (phases.map((x) => x[0]).join(",") !== "early,evaluate,decide") throw new Error(`phases: ${JSON.stringify(phases)}`);
    const counts = await page.getByTestId("stage-heading").evaluateAll((els) => els.map((e) => [e.dataset.stage, Number(e.dataset.count)]));
    if (counts.map((x) => x[0]).join(",") !== "Interested,NDA signed,CIM review,Broker call,Seller call,Model,Partner presentation,IOI or LOI,Diligence") throw new Error(`stages: ${JSON.stringify(counts)}`);
    // Edit batch B: Early holds two stages, Evaluate four with Broker call right after CIM review.
    const perPhase = await page.getByTestId("deals-phase").evaluateAll((els) => els.map((e) => [...e.querySelectorAll("[data-testid=stage-heading]")].map((h) => h.dataset.stage).join(",")));
    if (perPhase.join("|") !== "Interested,NDA signed|CIM review,Broker call,Seller call,Model|Partner presentation,IOI or LOI,Diligence") throw new Error(`stages per phase: ${perPhase.join("|")}`);
    for (const [name, n] of counts) {
      const inDb = (await one("select count(*)::int n from pipeline_items i join pipeline_stages s on s.id = i.stage_id join pipelines p on p.id = i.pipeline_id where p.kind = 'acquisition' and s.name = $1 and i.screened and i.status = 'open'", [name])).n;
      if (inDb !== n) throw new Error(`${name}: shown ${n}, records ${inDb}`);
    }
    if (counts.reduce((s, [, n]) => s + n, 0) !== phases.reduce((s, [, n]) => s + n, 0)) throw new Error("phase counts do not add up to the stage counts");
    if (await page.getByTestId("deals-stepper").count()) throw new Error("the stepper is still on Deals");
    // Filters: the pill counts match the cards; Waiting on someone shows only the waiting cards and collapses the other stages
    const pill = async (k) => Number(await page.getByTestId(`deals-filter-${k}`).getAttribute("data-count"));
    const allRows = page.locator("[data-testid=deal-row][data-hidden]");
    if ((await pill("all")) !== (await allRows.count())) throw new Error("All count");
    if ((await pill("wait")) !== (await allRows.locator("[data-testid=deal-wait]").count())) throw new Error("Waiting count");
    if ((await pill("needs")) !== (await allRows.locator("[data-testid=needs-action]").count())) throw new Error("Needs count");
    await page.getByTestId("deals-filter-wait").click();
    if ((await page.locator("[data-testid=deal-row][data-hidden='0']").count()) !== (await pill("wait"))) throw new Error("Waiting filter shows the wrong cards");
    const collapsed = await page.getByTestId("stage-group").evaluateAll((els) => els.filter((e) => e.closest("[data-testid=deals-phase]")).map((e) => [e.dataset.stage, e.dataset.collapsed, !!e.querySelector("[data-testid=deal-row][data-hidden='0']"), Number(e.querySelector("[data-testid=stage-heading]").dataset.count)]));
    for (const [name, c, hasMatch, n] of collapsed) if (n && c !== (hasMatch ? "0" : "1")) throw new Error(`${name} should be ${hasMatch ? "open" : "collapsed"} under Waiting on someone`);
    await page.screenshot({ path: path.join(OUT, "flow-work-deals-filter.png") });
    await page.getByTestId("deals-filter-all").click();
    if ((await page.locator("[data-testid=deal-row][data-hidden='0']").count()) !== (await pill("all"))) throw new Error("All shows every card");
    // Find a deal narrows by name (the first card's full name, so only that deal is shown)
    const firstName = (await page.locator("[data-testid=deal-row][data-hidden='0']").first().innerText()).split("\n")[0].trim();
    await page.getByTestId("deals-search").fill(firstName.toLowerCase());
    const found = await page.locator("[data-testid=deal-row][data-hidden='0']").count();
    if (found < 1 || found > (await pill("all")) || (await page.locator("[data-testid=deal-row][data-hidden='0']").first().innerText()).indexOf(firstName) < 0) throw new Error(`Find a deal: ${firstName} gives ${found}`);
    if ((await page.locator("[data-testid=deal-row][data-hidden='1']").count()) !== (await pill("all")) - found) throw new Error("Find a deal hides the rest");
    await page.getByTestId("deals-search").fill("");
    // Collapse all collapses every stage with deals and reads Expand all; Expand all opens them again.
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Expand all");
    if (await page.locator("[data-testid=stage-group][data-collapsed='0'] [data-testid=stage-heading]:not([data-count='0'])").count()) throw new Error("a stage with deals is still open after Collapse all");
    if (await page.getByTestId("stage-body").count()) throw new Error("a collapsed stage still draws its body");
    await page.screenshot({ path: path.join(OUT, "flow-work-deals-collapsed.png") });
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Collapse all");
    if ((await page.locator("[data-testid=deal-row][data-hidden='0']").count()) !== (await pill("all"))) throw new Error("Expand all shows every card");
    // A collapsed stage is remembered in this browser (the first stage that has deals; an empty stage has nothing to collapse)
    const stageName = await page.locator("[data-testid=stage-heading]:not([data-count='0'])").first().getAttribute("data-stage");
    await page.locator(`[data-testid=stage-heading][data-stage="${stageName}"]`).click();
    await page.locator(`[data-testid=stage-group][data-stage="${stageName}"][data-collapsed="1"]`).waitFor();
    await page.reload();
    await page.locator(`[data-testid=stage-group][data-stage="${stageName}"][data-collapsed="1"]`).waitFor({ timeout: 10000 }).catch(() => { throw new Error(`collapsed stage ${stageName} not remembered`); });
    await page.locator(`[data-testid=stage-heading][data-stage="${stageName}"]`).click();
    await page.locator(`[data-testid=stage-group][data-stage="${stageName}"][data-collapsed="0"]`).waitFor();
    if (!(await page.getByTestId("closed-label").innerText()).match(/Passed \d+ · Lost \d+/)) throw new Error("closed label");
    await page.getByTestId("closed-toggle").click();
    await page.locator("[data-testid=stage-group][data-stage=Passed]").waitFor();
    await page.locator(`[data-testid=deal-row][data-deal="${moved.id}"]`).click();
    await page.waitForURL(new RegExp(`/work/deals/${moved.id}$`));
  });

  // ---------- Batch B1 (database update 0022): Outreach, the person page, Log a call, emails logged, To-dos, the menu ----------
  // The weekly counter as the database sees it: emails sent and calls logged to people, Monday to Friday of this week (New York dates).
  const weekCount = async () => {
    const t = nyDate(0);
    const d = new Date(`${t}T12:00:00Z`);
    const dow = d.getUTCDay();
    const monday = nyDate(dow === 0 ? -6 : 1 - dow);
    const friday = nyDate((dow === 0 ? -6 : 1 - dow) + 4);
    return (await one(`select count(*)::int n from communications where contact_id is not null and not awaiting_log and direction <> 'incoming' and method in ('email', 'call', 'meeting', 'video')
      and (occurred_at at time zone 'America/New_York')::date between $1 and $2`, [monday, friday])).n;
  };

  await step("Outreach: the counter, the sections by next follow-up, the rows with their figures, the filters and purpose pills, Find a person, Collapse all", async () => {
    await page.goto(`${BASE}/work/outreach`);
    await page.getByTestId("outreach-card").waitFor();
    const counter = page.getByTestId("outreach-counter");
    const n = Number(await counter.getAttribute("data-count"));
    if (n !== (await weekCount()) || Number(await counter.getAttribute("data-target")) !== 10) throw new Error(`counter ${n} of ${await counter.getAttribute("data-target")} vs ${await weekCount()}`);
    const sections = await page.getByTestId("outreach-section").evaluateAll((els) => els.map((e) => [e.dataset.section, Number(e.querySelector("[data-testid=section-heading]")?.dataset.count)]));
    if (sections.map((x) => x[0]).join(",") !== "overdue,today,week,later,nodate") throw new Error(`sections: ${JSON.stringify(sections)}`);
    const inDb = await one(`select (select count(*)::int from contacts where archived_at is null and follow_up_date < $1) o, (select count(*)::int from contacts where archived_at is null and follow_up_date = $1) t,
      (select count(*)::int from contacts where archived_at is null and follow_up_date > $1 and follow_up_date <= $2) w, (select count(*)::int from contacts where archived_at is null and follow_up_date > $2) l,
      (select count(*)::int from contacts where archived_at is null and follow_up_date is null) nd`, [nyDate(0), nyDate(7)]);
    if (sections[0][1] !== inDb.o || sections[1][1] !== inDb.t || sections[2][1] !== inDb.w || sections[3][1] !== inDb.l || sections[4][1] !== inDb.nd) throw new Error(`section counts ${JSON.stringify(sections)} vs ${JSON.stringify(inDb)}`);
    if (sections[0][1] < 2 || sections[1][1] < 3 || sections[4][1] < 2) throw new Error("the sample should fill Overdue, Due today, and No date");
    // Mark Reed's row: the org and role line, the purpose pill, the note, LAST CONTACT and NEXT FOLLOW-UP (red).
    const reed = await personByName("Mark Reed");
    const row = page.locator(`[data-testid=person-row][data-person="${reed.id}"]`);
    const text = await row.innerText();
    if (!text.includes("Transworld Business Advisors · Broker, Broker, East Tennessee") && !text.includes("Transworld Business Advisors · Broker, Broker")) {
      if (!text.includes("Transworld Business Advisors") || !text.includes("Broker")) throw new Error(`row line: ${text.slice(0, 120)}`);
    }
    if (!text.includes("Off-market deals") || !text.includes("Asked him for off-market HVAC owners")) throw new Error(`row: ${text.slice(0, 200)}`);
    if ((await row.getByTestId("person-next-follow-up").getAttribute("data-tone")) !== "over") throw new Error("Mark Reed should be overdue (red)");
    if (!(await row.getByTestId("person-last-contact").innerText()).match(/^(Today|[A-Z][a-z]{2} \d+) · (email|call|meeting)/)) throw new Error(`last contact: ${await row.getByTestId("person-last-contact").innerText()}`);
    // Filters: the date pills and the purpose pills count the rows; a purpose pill shows only those people.
    const pill = async (k) => Number(await page.getByTestId(`outreach-filter-${k}`).getAttribute("data-count"));
    const shownRows = () => page.locator("[data-testid=outreach-row][data-hidden='0']").count();
    if ((await pill("all")) !== (await shownRows())) throw new Error("All counts every row");
    if ((await pill("today")) !== inDb.t || (await pill("over")) !== inDb.o || (await pill("nodate")) !== inDb.nd) throw new Error("date pills");
    const purposeInDb = async (k) => (await one("select count(*)::int n from contacts where archived_at is null and $1 = any (purposes)", [k])).n;
    for (const k of ["off_market_deals", "job_search", "consulting", "rosara"]) if ((await pill(k)) !== (await purposeInDb(k))) throw new Error(`purpose pill ${k}`);
    await page.getByTestId("outreach-filter-job_search").click();
    if ((await shownRows()) !== (await pill("job_search"))) throw new Error("Job search filter shows the wrong rows");
    const shownPills = await page.locator("[data-testid=outreach-row][data-hidden='0'] [data-testid=purpose-pill]").allInnerTexts();
    if (!shownPills.every((t) => t === "Job search")) throw new Error(`job search rows carry other pills: ${shownPills.join(",")}`);
    const collapsedStates = await page.getByTestId("outreach-section").evaluateAll((els) => els.map((e) => [e.dataset.section, e.dataset.collapsed, !!e.querySelector("[data-testid=outreach-row][data-hidden='0']"), Number(e.querySelector("[data-testid=section-heading]").dataset.count)]));
    for (const [name, c, hasMatch, cnt] of collapsedStates) if (cnt && c !== (hasMatch ? "0" : "1")) throw new Error(`${name} should be ${hasMatch ? "open" : "collapsed"} under Job search`);
    await page.screenshot({ path: path.join(OUT, "flow-work-outreach-filter.png") });
    await page.getByTestId("outreach-filter-all").click();
    await page.getByTestId("outreach-search").fill("transworld");
    const found = await shownRows();
    if (found < 2 || (await page.locator("[data-testid=outreach-row][data-hidden='1']").count()) !== (await pill("all")) - found) throw new Error(`Find a person by organization: ${found}`);
    await page.getByTestId("outreach-search").fill("");
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Expand all");
    if (await page.locator("[data-testid=outreach-section][data-collapsed='0'] [data-testid=section-heading]:not([data-count='0'])").count()) throw new Error("a section with people is still open after Collapse all");
    await page.getByTestId("collapse-all").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=collapse-all]")?.innerText.trim() === "Collapse all");
  });

  await step("Outreach: Add a person with the Purpose checklist (chosen values shown as text); the person lands in Next 7 days and on the contacts table", async () => {
    await page.goto(`${BASE}/work/outreach?add=1`);
    await page.getByTestId("add-person").waitFor();
    if (!(await page.getByTestId("add-person").innerText()).includes("People here are the app's contact records. Outreach is the working view of them.")) throw new Error("the note under the form");
    await page.getByTestId("person-name").fill("Flow Tester");
    await page.getByTestId("person-organization").fill("Transworld Business Advisors");
    await page.getByTestId("person-role").selectOption("lender");
    await page.getByTestId("purpose-toggle").click();
    await page.getByTestId("purpose-menu").waitFor();
    await page.getByTestId("purpose-off_market_deals").check();
    await page.getByTestId("purpose-rosara").check();
    await page.getByTestId("person-name").click();
    if ((await page.getByTestId("purpose-toggle").innerText()).trim() !== "Off-market deals, Rosara") throw new Error(`purpose text: ${await page.getByTestId("purpose-toggle").innerText()}`);
    if (await page.getByTestId("purpose-menu").count()) throw new Error("the checklist should close on a click outside");
    await page.getByTestId("person-email").fill("flow.tester@example.com");
    await page.getByTestId("person-phone").fill("(404) 555-0100");
    await page.getByTestId("person-linkedin").fill("linkedin.com/in/flowtester");
    await page.getByTestId("person-nextFollowUp").fill(nyDate(3));
    await page.getByTestId("person-note").fill("Flow: a lender who hears about owners first");
    await page.screenshot({ path: path.join(OUT, "flow-work-add-person.png"), fullPage: true });
    await page.getByTestId("person-save").click();
    await page.waitForURL(/\/work\/outreach\?saved=/);
    await page.getByTestId("person-saved").waitFor();
    const p = await personByName("Flow Tester");
    if (!p || p.follow_up_date !== nyDate(3) || p.outreach_role !== "lender" || p.purposes.join(",") !== "off_market_deals,rosara" || p.notes !== "Flow: a lender who hears about owners first") throw new Error(JSON.stringify(p));
    const org = await one("select o.name from contacts c join organizations o on o.id = c.organization_id where c.id = $1", [p.id]);
    if (org.name !== "Transworld Business Advisors") throw new Error("the existing organization should be reused");
    if ((await one("select count(*)::int n from organizations where name ilike 'Transworld Business Advisors'")).n !== 1) throw new Error("the organization was duplicated");
    const row = page.locator(`[data-testid=person-row][data-person="${p.id}"]`);
    await row.waitFor();
    if ((await row.locator("xpath=ancestor::*[@data-testid='outreach-section']").getAttribute("data-section")) !== "week") throw new Error("the new person should sit under Next 7 days");
    if ((await row.getByTestId("person-last-contact").innerText()).split("\n")[0].trim() !== "Never") throw new Error("a new person has no last contact");
  });

  await step("Outreach: Done sets the next follow-up date and moves the row; the Home outreach row's Later moves the date", async () => {
    const tom = await personByName("Tom Alvarez");
    if (tom.follow_up_date !== nyDate(0)) throw new Error(`Tom should be due today: ${tom.follow_up_date}`);
    await page.goto(`${BASE}/work/outreach`);
    const row = page.locator(`[data-testid=person-row][data-person="${tom.id}"]`);
    await row.waitFor();
    await row.getByTestId("row-done").click();
    await row.getByTestId("person-done-ask").waitFor();
    await row.getByTestId("person-done-what").fill("Flow: ask for the two owner names");
    const choice = row.getByTestId("person-done-choice").first();
    const chosen = await choice.getAttribute("data-date");
    await choice.click();
    await row.getByTestId("person-done-result").waitFor();
    for (let i = 0; i < 40 && (await personByName("Tom Alvarez")).follow_up_date !== chosen; i++) await page.waitForTimeout(250);
    const after = await personByName("Tom Alvarez");
    if (after.follow_up_date !== chosen || after.follow_up_note !== "Flow: ask for the two owner names") throw new Error(JSON.stringify(after));
    if (after.last_contact_at !== tom.last_contact_at) throw new Error("Done must not log anything");
    await page.waitForFunction((id) => !!document.querySelector(`[data-testid=person-row][data-person="${id}"] [data-testid=person-next-follow-up]`), tom.id, { timeout: 15000 });
    const section = await page.locator(`[data-testid=person-row][data-person="${tom.id}"]`).locator("xpath=ancestor::*[@data-testid='outreach-section']").getAttribute("data-section");
    if (section !== "week") throw new Error(`Tom should have moved to Next 7 days, is under ${section}`);
    // Done with "No date" moves a person to No date.
    const carla = await personByName("Carla Jenkins");
    const crow = page.locator(`[data-testid=person-row][data-person="${carla.id}"]`);
    await crow.getByTestId("row-done").click();
    await crow.getByTestId("person-done-none").click();
    await crow.getByTestId("person-done-result").waitFor();
    for (let i = 0; i < 40 && (await personByName("Carla Jenkins")).follow_up_date !== null; i++) await page.waitForTimeout(250);
    if ((await personByName("Carla Jenkins")).follow_up_date !== null) throw new Error("No date should clear the date");
    await pg.query("update contacts set follow_up_date = $2 where id = $1", [carla.id, nyDate(0)]);
    // Home: the people due today or overdue are rows on Next actions with the Outreach lane pill; Later moves one to tomorrow.
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-bento").waitFor();
    const lanes = page.locator("[data-testid=outreach-action-row]");
    const due = (await one("select count(*)::int n from contacts where archived_at is null and follow_up_date <= $1", [nyDate(0)])).n;
    if ((await lanes.count()) !== due) throw new Error(`outreach rows on Home: ${await lanes.count()} vs ${due} due`);
    if ((await lanes.first().getByTestId("lane-pill").innerText()).trim() !== "Outreach") throw new Error("lane pill");
    const reed = await personByName("Mark Reed");
    const hr = page.locator(`[data-testid=outreach-action-row][data-person="${reed.id}"]`);
    if ((await hr.getByTestId("next-action-due").getAttribute("data-tone")) !== "over") throw new Error("Mark Reed is overdue on Home");
    if (!(await hr.innerText()).includes("Ask for the two owner names and the Summit seller call date")) throw new Error("the row shows what the follow-up is for");
    await hr.getByTestId("next-action-later").click();
    await hr.getByTestId("later-tomorrow").click();
    await hr.getByTestId("next-action-result").waitFor();
    for (let i = 0; i < 40 && (await personByName("Mark Reed")).follow_up_date !== nyDate(1); i++) await page.waitForTimeout(250);
    if ((await personByName("Mark Reed")).follow_up_date !== nyDate(1)) throw new Error("Later on Home");
    await pg.query("update contacts set follow_up_date = $2 where id = $1", [reed.id, nyDate(-2)]);
    // The Outreach tile: the counter, up to three people due today, the overdue count, the link.
    await page.goto(`${BASE}/work`);
    const tile = page.getByTestId("home-outreach");
    if (Number(await tile.getByTestId("home-outreach-counter").getAttribute("data-count")) !== (await weekCount())) throw new Error("tile counter");
    const tileRows = await tile.getByTestId("home-outreach-row").count();
    if (tileRows < 1 || tileRows > 3) throw new Error(`tile rows: ${tileRows}`);
    if (!(await tile.getByTestId("home-outreach-overdue").innerText()).match(/^\d+ overdue$/)) throw new Error("overdue line");
    if (!(await page.getByTestId("home-jobs").innerText()).includes("Next conversation")) throw new Error("the Job search tile");
    await page.screenshot({ path: path.join(OUT, "flow-work-home-outreach.png"), fullPage: true });
  });

  await step("Log a call from Outreach lands on the person's timeline, updates the last contact, and bumps the counter; Email from Outreach logs and bumps it too", async () => {
    const before = await weekCount();
    const priya = await personByName("Priya Natarajan");
    await page.goto(`${BASE}/work/outreach`);
    const row = page.locator(`[data-testid=person-row][data-person="${priya.id}"]`);
    await row.waitFor();
    if (Number(await page.getByTestId("outreach-counter").getAttribute("data-count")) !== before) throw new Error("counter before");
    await row.getByTestId("row-log-call").click();
    const drawer = page.getByTestId("log-call-drawer");
    await drawer.waitFor();
    if ((await drawer.getByTestId("call-who").inputValue()) !== "Priya Natarajan") throw new Error("Who is prefilled");
    if (!(await drawer.innerText()).includes("From Outreach")) throw new Error("the drawer says where it was opened from");
    const width = await drawer.evaluate((e) => e.getBoundingClientRect().width);
    if (width < 440 || width > 520) throw new Error(`drawer width ${width}`);
    await drawer.getByTestId("call-minutes").selectOption("30");
    await drawer.getByTestId("call-said").fill("Flow: two owners asked about exit loans; she will ask if they want an intro.");
    await drawer.getByTestId("call-next").fill("Flow: send Priya the one-page buy box");
    const choice = drawer.getByTestId("call-next-date");
    const date = await choice.locator("option").nth(1).getAttribute("value");
    await choice.selectOption(date);
    await page.screenshot({ path: path.join(OUT, "flow-work-log-call.png") });
    await drawer.getByTestId("call-save").click();
    await drawer.waitFor({ state: "hidden" });
    await row.getByTestId("person-logged").waitFor();
    if (!(await row.getByTestId("person-logged").innerText()).includes("Call logged, 30 min")) throw new Error("the row says the call was logged");
    const comm = await one("select id, method, call_minutes, summary, call_outcome, is_outreach from communications where contact_id = $1 order by created_at desc limit 1", [priya.id]);
    if (comm.method !== "call" || comm.call_minutes !== 30 || !comm.summary.startsWith("Flow: two owners") || comm.call_outcome !== "Flow: send Priya the one-page buy box" || !comm.is_outreach) throw new Error(JSON.stringify(comm));
    const after = await personByName("Priya Natarajan");
    if (after.last_contact_kind !== "call" || after.follow_up_date !== date || after.follow_up_note !== "Flow: send Priya the one-page buy box") throw new Error(JSON.stringify(after));
    if ((await weekCount()) !== before + 1) throw new Error("the call should count this week");
    await page.waitForFunction((n) => Number(document.querySelector("[data-testid=outreach-counter]")?.dataset.count) === n, before + 1, { timeout: 15000 });
    await page.goto(`${BASE}/work/outreach/${priya.id}`);
    await page.getByTestId("timeline-event").filter({ hasText: "Call with Priya Natarajan, 30 min" }).waitFor();
    if (!(await page.getByTestId("figure-last").innerText()).includes("Today · call")) throw new Error("the header figure shows the call");
    // Email from an Outreach row: the editor is prefilled to the person; the send (Google stand-in) is logged and counts.
    const jamal = await personByName("Jamal Whitaker");
    const sentBefore = (await gsent()).length;
    await page.goto(`${BASE}/work/outreach`);
    const jrow = page.locator(`[data-testid=person-row][data-person="${jamal.id}"]`);
    await jrow.getByTestId("row-email").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    if ((await composeTo(page)) !== "jamal.whitaker@example.com") throw new Error(`To is ${await composeTo(page)}`);
    await page.getByTestId("compose-subject").fill("Flow: thanks for the intro");
    await fillEditor(page.getByTestId("compose-body"), "Hi Jamal,\n\nThanks again for the intro to your partner. Could we find 20 minutes next week?\n\nBram");
    await page.getByTestId("send-now").click();
    await page.getByRole("dialog", { name: "Send this email?" }).waitFor();
    await page.getByTestId("send-confirm").click();
    await dlg.getByTestId("send-success").waitFor();
    if ((await gsent()).length !== sentBefore + 1) throw new Error("Gmail did not get the email");
    await page.getByTestId("compose-close").click();
    await jrow.getByTestId("person-logged").waitFor();
    const mail = await one("select subject, method, direction from communications where contact_id = $1 and subject = 'Flow: thanks for the intro'", [jamal.id]);
    if (!mail || mail.method !== "email" || mail.direction !== "outgoing") throw new Error("the email was not logged on the person");
    if ((await personByName("Jamal Whitaker")).last_contact_kind !== "email") throw new Error("last contact after the email");
    if ((await weekCount()) !== before + 2) throw new Error("the email should count this week");
    await page.waitForFunction((n) => Number(document.querySelector("[data-testid=outreach-counter]")?.dataset.count) === n, before + 2, { timeout: 15000 });
  });

  await step("Person page: the record-page layout, Why in touch, Next follow-up (Save, Done, Later), Tasks (add, make next), Facts (Edit), Incoming (Log it), a note, Archive and Reopen", async () => {
    const reed = await personByName("Mark Reed");
    await page.goto(`${BASE}/work/outreach/${reed.id}`);
    await page.getByTestId("work-person").waitFor();
    if ((await page.locator("h1").first().innerText()).trim() !== "Mark Reed") throw new Error("title");
    if (!(await page.getByTestId("person-crumb").innerText()).includes("Outreach")) throw new Error("crumb");
    // Left: Why in touch, Next follow-up, Tasks. Right: Facts, Incoming, Timeline, Decision.
    const order = await page.locator("[data-testid=work-person] section[data-testid^=person-]").evaluateAll((els) => els.map((e) => e.dataset.testid));
    if (order.join(",") !== "person-why,person-next-follow-up,person-tasks,person-facts,person-incoming,person-timeline,person-decision") throw new Error(`card order: ${order.join(",")}`);
    const figs = await page.getByTestId("record-figures").locator("[data-testid^=figure-]").evaluateAll((els) => els.map((e) => [e.dataset.testid, e.dataset.tone, e.innerText.split("\n")[0]]));
    if (figs[0][0] !== "figure-next" || figs[0][1] !== "over" || figs[1][0] !== "figure-tasks" || figs[1][2] !== "2" || figs[2][0] !== "figure-last") throw new Error(`figures: ${JSON.stringify(figs)}`);
    const status = await page.getByTestId("person-status-line").innerText();
    if (!status.includes("Off-market deals") || !status.includes("Transworld Business Advisors")) throw new Error(`status: ${status}`);
    const why = await page.getByTestId("person-why").innerText();
    if (!why.includes("Ask for the two owner names and the Summit seller call date") || !why.includes("Asked him for off-market HVAC owners")) throw new Error(`why in touch: ${why}`);
    if ((await page.getByTestId("person-incoming").getByTestId("incoming-row").count()) !== 2) throw new Error("Mark Reed should have two incoming replies");
    // Add a note sits below the timeline list.
    const noteBelow = await page.getByTestId("person-timeline").evaluate((card) => card.querySelector("[data-testid=note-form]").getBoundingClientRect().top >= card.querySelector("[data-testid=timeline-events]").getBoundingClientRect().bottom - 1);
    if (!noteBelow) throw new Error("Add a note should sit below the timeline");
    const eventsBefore = await page.getByTestId("timeline-event").count();
    // Log it: the reply joins the timeline and the last contact becomes that email.
    await page.getByTestId("person-incoming").getByTestId("incoming-log").first().click();
    await page.waitForFunction((n) => document.querySelectorAll("[data-testid=incoming-row]").length === n, 1, { timeout: 15000 });
    await page.waitForFunction((n) => document.querySelectorAll("[data-testid=timeline-event]").length === n + 1, eventsBefore, { timeout: 15000 });
    if ((await one("select count(*)::int n from communications where contact_id = $1 and awaiting_log", [reed.id])).n !== 1) throw new Error("Log it should clear awaiting_log");
    if (!(await page.getByTestId("timeline-event").filter({ hasText: "Re: East Tennessee owners" }).count())) throw new Error("the logged reply is on the timeline");
    if ((await personByName("Mark Reed")).last_contact_kind !== "email") throw new Error("last contact after Log it");
    // Next follow-up: Save a new date and what for.
    await page.getByTestId("fu-date").fill(nyDate(2));
    await page.getByTestId("fu-what").fill("Flow: call about the two owners");
    await page.getByTestId("fu-save").click();
    await page.getByTestId("person-next-follow-up").getByTestId("save-ok").waitFor();
    let saved = await personByName("Mark Reed");
    if (saved.follow_up_date !== nyDate(2) || saved.follow_up_note !== "Flow: call about the two owners") throw new Error(JSON.stringify(saved));
    await page.waitForFunction(() => document.querySelector("[data-testid=figure-next]")?.dataset.tone === "later", null, { timeout: 15000 });
    // Done on the card: the choices, then the new date.
    await page.getByTestId("fu-done").click();
    await page.getByTestId("fu-done-ask").waitFor();
    const d2 = await page.getByTestId("fu-done-choice").nth(1).getAttribute("data-date");
    await page.getByTestId("fu-done-choice").nth(1).click();
    await page.getByTestId("fu-result").waitFor();
    for (let i = 0; i < 40 && (await personByName("Mark Reed")).follow_up_date !== d2; i++) await page.waitForTimeout(250);
    if ((await personByName("Mark Reed")).follow_up_date !== d2) throw new Error("Done on the card");
    // Later: tomorrow.
    await page.getByTestId("fu-later").click();
    await page.getByTestId("fu-later-tomorrow").click();
    for (let i = 0; i < 40 && (await personByName("Mark Reed")).follow_up_date !== nyDate(1); i++) await page.waitForTimeout(250);
    if ((await personByName("Mark Reed")).follow_up_date !== nyDate(1)) throw new Error("Later on the card");
    // Tasks: add one, Make this the next action turns it into the follow-up and keeps the old one as a task.
    const tasks = page.getByTestId("person-tasks");
    await tasks.getByTestId("todo-add").click();
    await tasks.getByTestId("todo-input").fill("Flow: send the buy box");
    await tasks.getByTestId("todo-save").click();
    await tasks.getByTestId("todo-item").filter({ hasText: "Flow: send the buy box" }).waitFor();
    await tasks.getByTestId("todo-item").filter({ hasText: "Flow: send the buy box" }).getByTestId("todo-make-next").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=fu-what]")?.value === "Flow: send the buy box", null, { timeout: 15000 });
    saved = await personByName("Mark Reed");
    if (saved.follow_up_note !== "Flow: send the buy box") throw new Error(JSON.stringify(saved));
    const taskRows = (await pg.query("select text, record_type from deal_todos where record_id = $1 order by position", [reed.id])).rows;
    if (taskRows.some((t) => t.text === "Flow: send the buy box") || !taskRows.some((t) => t.text === "Flow: call about the two owners") || !taskRows.every((t) => t.record_type === "contacts")) throw new Error(`tasks: ${taskRows.map((t) => t.text).join(" | ")}`);
    // Facts: Edit the phone and the purpose; the organization and role line follows.
    await page.getByTestId("person-facts-edit").click();
    await page.getByTestId("person-phone").fill("(865) 555-0199");
    await page.getByTestId("purpose-toggle").click();
    await page.getByTestId("purpose-rosara").check();
    await page.getByTestId("person-facts-save").click();
    await page.getByTestId("person-facts-grid").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=pf-phone]")?.innerText.includes("(865) 555-0199"), null, { timeout: 15000 });
    saved = await personByName("Mark Reed");
    if (saved.purposes.join(",") !== "off_market_deals,rosara" || !saved.notes.startsWith("Asked him for off-market HVAC owners")) throw new Error(JSON.stringify(saved));
    if (!(await page.getByTestId("pf-purpose").innerText()).includes("Off-market deals, Rosara")) throw new Error("the Facts purpose line");
    // A note.
    await page.getByTestId("person-note").fill("Flow note: likes a Friday call.");
    await page.getByTestId("note-save").click();
    await page.getByTestId("timeline-event").filter({ hasText: "Flow note: likes a Friday call." }).waitFor();
    if (!(await one("select 1 x from notes where record_type = 'contacts' and record_id = $1 and body = 'Flow note: likes a Friday call.'", [reed.id]))) throw new Error("the note was not saved on the contact");
    await page.screenshot({ path: path.join(OUT, "flow-work-person.png"), fullPage: true });
    // Archive takes the person off Outreach; Reopen brings them back.
    await page.getByTestId("person-archive").click();
    await page.getByTestId("person-reopen").waitFor({ timeout: 15000 });
    if (!(await personByName("Mark Reed")).archived_at) throw new Error("archived_at");
    await page.goto(`${BASE}/work/outreach`);
    await page.getByTestId("outreach-card").waitFor();
    if (await page.locator(`[data-testid=person-row][data-person="${reed.id}"]`).count()) throw new Error("an archived person is still on Outreach");
    if (!(await page.getByTestId("outreach-archived").innerText()).includes("Archived 1")) throw new Error("the Archived bar");
    await page.goto(`${BASE}/work/outreach/${reed.id}`);
    await page.getByTestId("person-reopen").click();
    await page.getByTestId("person-archive").waitFor({ timeout: 15000 });
    if ((await personByName("Mark Reed")).archived_at) throw new Error("Reopen");
    await pg.query("update contacts set follow_up_date = $2 where id = $1", [reed.id, nyDate(-2)]);
  });

  await step("Deal page: Log a call from a deal lands on the deal timeline (and the broker's last contact) and sets the next action; the Tasks card still adds and moves items", async () => {
    const dalton = await dealByName("Dalton Services");
    const kim = await personByName("Rachel Kim");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    await page.getByTestId("work-deal").waitFor();
    await page.getByTestId("deal-log-call").click();
    const drawer = page.getByTestId("log-call-drawer");
    await drawer.waitFor();
    if ((await drawer.getByTestId("call-who").inputValue()) !== "Rachel Kim") throw new Error("the deal's main contact is prefilled");
    if (!(await drawer.innerText()).includes("From Dalton Services")) throw new Error("drawer sub line");
    await drawer.getByTestId("call-minutes").selectOption("15");
    await drawer.getByTestId("call-said").fill("Flow: she will send the customer list by Friday.");
    await drawer.getByTestId("call-next").fill("Flow: read the customer list");
    await drawer.getByTestId("call-save").click();
    await drawer.waitFor({ state: "hidden" });
    await page.getByTestId("deal-call-logged").waitFor();
    await page.getByTestId("timeline-event").filter({ hasText: "Call with Rachel Kim, 15 min" }).waitFor({ timeout: 15000 });
    const comm = await one("select contact_id, pipeline_item_id, call_minutes from communications where pipeline_item_id = $1 and summary like 'Flow: she will send%'", [dalton.id]);
    if (!comm || comm.contact_id !== kim.id || comm.call_minutes !== 15) throw new Error(JSON.stringify(comm));
    const moved = await dealByName("Dalton Services");
    if (moved.next_action !== "Flow: read the customer list") throw new Error(`next action after the call: ${moved.next_action}`);
    if ((await personByName("Rachel Kim")).last_contact_kind !== "call") throw new Error("the broker's last contact");
    if (!(await page.getByTestId("figure-last").innerText()).includes("Today · call")) throw new Error("the deal header figure shows the call");
    if (!(await one("select 1 x from record_links where from_type = 'communications' and to_type = 'pipeline_items' and to_id = $1 and from_id = (select id from communications where summary like 'Flow: she will send%' limit 1)", [dalton.id]))) throw new Error("record link");
  });

  await step("To-dos: the three sections from the sample, add (with and without a date), check off into Done today, edit inline, delete", async () => {
    await page.goto(`${BASE}/work/todos`);
    await page.getByTestId("todos-card").waitFor();
    const sections = await page.getByTestId("todos-section").evaluateAll((els) => els.map((e) => [e.dataset.section, Number(e.querySelector("[data-testid=section-heading]")?.dataset.count), e.dataset.collapsed]));
    if (sections.map((x) => x[0]).join(",") !== "today,week,later,done") throw new Error(`sections: ${JSON.stringify(sections)}`);
    if (sections[0][1] !== 2 || sections[1][1] !== 2 || sections[2][1] !== 1 || sections[3][1] !== 0) throw new Error(`section counts: ${JSON.stringify(sections)}`);
    const card = page.getByTestId("todos-card");
    const width = await card.evaluate((e) => e.getBoundingClientRect().width);
    if (width > 720) throw new Error(`the To-dos card is ${width}px wide`);
    await page.getByTestId("personal-todo-input").fill("Flow: call the insurance agent");
    await page.getByTestId("personal-todo-add").click();
    await page.locator("[data-testid=personal-todo]", { hasText: "Flow: call the insurance agent" }).waitFor();
    await page.getByTestId("personal-todo-input").fill("Flow: renew the passport");
    await page.getByTestId("personal-todo-due").fill(nyDate(6));
    await page.getByTestId("personal-todo-input").press("Enter");
    const later = page.locator("[data-testid=personal-todo]", { hasText: "Flow: renew the passport" });
    await later.waitFor();
    if ((await later.locator("xpath=ancestor::*[@data-testid='todos-section']").getAttribute("data-section")) !== "week") throw new Error("a to-do due in 6 days sits under Next 7 days");
    if ((await page.locator("[data-testid=personal-todo]", { hasText: "Flow: call the insurance agent" }).locator("xpath=ancestor::*[@data-testid='todos-section']").getAttribute("data-section")) !== "today") throw new Error("a to-do without a date sits under Today");
    const inDb = await one("select text, due_on::text from todos where text = 'Flow: renew the passport'");
    if (!inDb || inDb.due_on !== nyDate(6)) throw new Error(JSON.stringify(inDb));
    // Check off: the item moves under Done today (collapsed by default, so the count shows it).
    await page.locator("[data-testid=personal-todo]", { hasText: "Book the dentist" }).getByTestId("personal-todo-check").check();
    await page.waitForFunction(() => Number(document.querySelector("[data-testid=todos-section][data-section=done] [data-testid=section-heading]")?.dataset.count) === 1, null, { timeout: 15000 });
    if (!(await one("select done_at from todos where text = 'Book the dentist'")).done_at) throw new Error("done_at");
    // Edit inline.
    const line = page.locator("[data-testid=personal-todo]", { hasText: "Flow: call the insurance agent" });
    await line.getByTestId("personal-todo-text").click();
    // While editing, the text sits in the input (not in the row's text), so the input is found on the page.
    await page.getByTestId("personal-todo-edit").fill("Flow: call the insurance agent about the umbrella policy");
    await page.getByTestId("personal-todo-edit").press("Enter");
    await page.locator("[data-testid=personal-todo]", { hasText: "about the umbrella policy" }).waitFor({ timeout: 15000 });
    if (!(await one("select 1 x from todos where text = 'Flow: call the insurance agent about the umbrella policy'"))) throw new Error("the edit was not saved");
    // Delete.
    await page.locator("[data-testid=personal-todo]", { hasText: "Flow: renew the passport" }).getByTestId("personal-todo-delete").click();
    await page.waitForFunction(() => !document.body.innerText.includes("Flow: renew the passport"), null, { timeout: 15000 });
    if (await one("select 1 x from todos where text = 'Flow: renew the passport'")) throw new Error("not deleted");
    await page.screenshot({ path: path.join(OUT, "flow-work-todos.png"), fullPage: true });
  });

  // ---------- Batch B2: Rosara projects, Job search, Consulting, Ask AI, the AI order ----------

  await step("Rosara: the weekly focus bar (edit, Save, shown on Home), the Projects card sections from the sample, the filters, Find a project, Add a project (lands under Active)", async () => {
    await page.goto(`${BASE}/work/rosara`);
    await page.getByTestId("projects-card").waitFor();
    if (await page.getByTestId("coming-next").count()) throw new Error("Rosara still shows the placeholder");
    const sections = await page.getByTestId("project-section").evaluateAll((els) => els.map((e) => [e.dataset.section, Number(e.querySelector("[data-testid=section-heading]")?.dataset.count), e.dataset.collapsed]));
    if (sections.map((x) => x[0]).join(",") !== "today,active,needs,closed") throw new Error(`sections: ${JSON.stringify(sections)}`);
    if (sections[0][1] !== 1 || sections[1][1] !== 7 || sections[2][1] !== 1 || sections[3][1] !== 1) throw new Error(`section counts: ${JSON.stringify(sections)}`);
    if (sections[3][2] !== "1") throw new Error("Closed is open by default");
    const active = await page.locator("[data-testid=project-section][data-section=active] [data-testid=project-row]").allInnerTexts();
    if (!active[0].includes("Rosara platform")) throw new Error(`Active is not sorted by the next due: ${active[0].slice(0, 60)}`);
    const figures = await page.locator("[data-testid=project-section][data-section=today] [data-testid=project-tasks]").innerText();
    if (!figures.includes("5")) throw new Error(`the TASKS figure: ${figures}`);
    if ((await page.locator("[data-testid=project-section][data-section=needs] [data-testid=set-next-action]").count()) !== 1) throw new Error("No next action rows show Set the next action");
    if (!(await page.getByTestId("rosara-note").innerText()).includes("People you talk to for Rosara live on Outreach")) throw new Error("the note under the card");
    // The filters and Find.
    const pill = async (k) => Number(await page.getByTestId(`rosara-filter-${k}`).getAttribute("data-count"));
    if ((await pill("all")) !== 9 || (await pill("today")) !== 1 || (await pill("needs")) !== 1 || (await pill("closed")) !== 1) throw new Error("filter counts");
    await page.getByTestId("rosara-filter-needs").click();
    if ((await page.locator("[data-testid=rosara-row][data-hidden='0']").count()) !== 1) throw new Error("the Needs filter shows one row");
    await page.getByTestId("rosara-filter-all").click();
    await page.getByTestId("rosara-search").fill("onboarding");
    const found = await page.locator("[data-testid=rosara-row][data-hidden='0']").allInnerTexts();
    if (found.length !== 1 || !found[0].includes("Rosara platform")) throw new Error(`Find a project by milestone: ${found.length}`);
    await page.getByTestId("rosara-search").fill("");
    // The weekly focus: type, Save, and the setting holds it.
    await page.getByTestId("weekly-focus-input").fill("This week: Flow focus, ten owner calls");
    await page.getByTestId("weekly-focus-save").click();
    await page.getByTestId("weekly-focus-note").waitFor({ timeout: 15000 });
    if ((await one("select value_text from inputs where key = 'rosara_weekly_focus'")).value_text !== "This week: Flow focus, ten owner calls") throw new Error("the weekly focus was not saved");
    // Add a project.
    await page.getByTestId("add-project-button").click();
    await page.getByTestId("add-project-form").waitFor();
    await page.getByTestId("project-name").fill("Flow project");
    await page.getByTestId("project-goal").fill("Flow goal");
    await page.getByTestId("project-milestone").fill("Flow milestone");
    await page.getByTestId("project-nextAction").fill("Flow first step");
    await page.getByTestId("project-due").fill(nyDate(9));
    await page.screenshot({ path: path.join(OUT, "flow-work-rosara-add.png"), fullPage: true });
    await page.getByTestId("project-save").click();
    await page.locator("[data-testid=project-row]", { hasText: "Flow project" }).waitFor({ timeout: 15000 });
    const made = await projectByName("Flow project");
    if (!made || made.next_action !== "Flow first step" || made.next_action_due !== nyDate(9) || made.milestone !== "Flow milestone") throw new Error(JSON.stringify(made));
    if ((await page.locator("[data-testid=project-row]", { hasText: "Flow project" }).locator("xpath=ancestor::*[@data-testid='project-section']").getAttribute("data-section")) !== "active") throw new Error("the new project sits under Active");
    await page.screenshot({ path: path.join(OUT, "flow-work-rosara.png"), fullPage: true });
  });

  await step("Project page: the record-page layout, Goal and milestone, Next action (Done clears it, offers the top task), Later, a task made the next action, a note and a finding with a source, Close and Reopen", async () => {
    const research = await projectByName("Market research");
    await page.goto(`${BASE}/work/rosara/${research.id}`);
    await page.getByTestId("work-project").waitFor();
    // The record-page rule: breadcrumb, Rosara pill, milestone, figures NEXT ACTION and OPEN TASKS; cards in their places.
    if ((await page.getByTestId("project-crumb").innerText()).trim() !== "Rosara") throw new Error("breadcrumb");
    if (!(await page.getByTestId("record-status-line").innerText()).includes("Ten agency owner conversations")) throw new Error("the milestone in the status line");
    if ((await page.getByTestId("figure-next").innerText()).replace(/\s+/g, " ").trim().toLowerCase() !== "today next action") throw new Error("NEXT ACTION figure");
    if ((await page.getByTestId("figure-tasks").innerText()).replace(/\s+/g, " ").trim().toLowerCase() !== "5 open tasks") throw new Error("OPEN TASKS figure");
    if (await page.getByTestId("figure-last").count()) throw new Error("a project has no LAST CONTACT figure");
    const cards = await page.locator("[data-testid=work-project] section h2").allInnerTexts();
    if (cards.map((t) => t.trim()).join("|") !== "Goal and milestone|Next action|Tasks|Facts|Notes and findings|Decision") throw new Error(`cards: ${cards.join("|")}`);
    // The timeline: two findings with their source links, two notes.
    if ((await page.locator("[data-testid=timeline-event][data-kind=finding]").count()) !== 2) throw new Error("two findings");
    if ((await page.getByTestId("finding-pill").count()) !== 2 || (await page.getByTestId("finding-source").count()) !== 2) throw new Error("the Finding pills and sources");
    // Goal and milestone save.
    await page.getByTestId("project-goal-input").fill("Flow: know what ten owners would pay for");
    await page.getByTestId("project-goal-save").click();
    await page.getByTestId("save-ok").first().waitFor({ timeout: 15000 });
    if (!(await one("select goal from projects where id = $1", [research.id])).goal.startsWith("Flow: know")) throw new Error("the goal was not saved");
    await page.screenshot({ path: path.join(OUT, "flow-work-project.png"), fullPage: true });
    // Later moves the next action to tomorrow.
    await page.getByTestId("project-next-action").getByTestId("next-action-later").click();
    await page.getByTestId("project-next-action").getByTestId("later-tomorrow").click();
    await page.waitForFunction((id) => document.body.innerText.includes("Moved to"), research.id, { timeout: 15000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Moved to"), null, { timeout: 15000 }).catch(() => {});
    if ((await projectByName("Market research")).next_action_due !== nyDate(1)) throw new Error("Later did not move the date");
    // Done offers the top task; taking it makes the task the next action (due tomorrow) and it leaves the list.
    await page.getByTestId("project-next-action").getByTestId("next-action-done").click();
    await page.getByTestId("next-action-ask").waitFor();
    await page.getByTestId("next-action-todo").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=na-action]")?.value === "Summarize the three calls so far", null, { timeout: 15000 });
    const afterTask = await projectByName("Market research");
    if (afterTask.next_action !== "Summarize the three calls so far" || afterTask.next_action_due !== nyDate(1)) throw new Error(JSON.stringify(afterTask));
    if ((await one("select count(*)::int n from deal_todos where record_type = 'projects' and record_id = $1 and done_at is null", [research.id])).n !== 4) throw new Error("the task did not leave the list");
    // Done with no task chosen clears the action: the project moves to No next action on Rosara.
    await page.getByTestId("project-next-action").getByTestId("next-action-done").click();
    await page.getByTestId("next-action-ask").waitFor();
    await page.getByTestId("next-action-not-yet").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=na-action]")?.value === "", null, { timeout: 15000 });
    if ((await projectByName("Market research")).next_action !== null) throw new Error("Done did not clear the action");
    await page.goto(`${BASE}/work/rosara`);
    await page.getByTestId("projects-card").waitFor();
    if ((await page.locator("[data-testid=project-row]", { hasText: "Market research" }).locator("xpath=ancestor::*[@data-testid='project-section']").getAttribute("data-section")) !== "needs") throw new Error("the project should sit under No next action");
    // Make this the next action from the Tasks card; add a task; a note and a finding with a source.
    await page.goto(`${BASE}/work/rosara/${research.id}`);
    await page.getByTestId("project-tasks").waitFor();
    await page.getByTestId("project-tasks").getByTestId("todo-make-next").first().click();
    await page.getByTestId("todo-note").waitFor({ timeout: 15000 });
    if ((await projectByName("Market research")).next_action !== "Ask Denise Walker for two more owner intros") throw new Error("Make this the next action");
    await page.getByTestId("project-tasks").getByTestId("todo-add").click();
    await page.getByTestId("todo-input").fill("Flow task on the project");
    await page.getByTestId("todo-save").click();
    await page.locator("[data-testid=todo-item]", { hasText: "Flow task on the project" }).waitFor({ timeout: 15000 });
    await page.getByTestId("project-note").fill("Flow note on the project");
    await page.getByTestId("note-save").click();
    await page.locator("[data-testid=timeline-event][data-kind=note]", { hasText: "Flow note on the project" }).waitFor({ timeout: 15000 });
    await page.getByTestId("project-note").fill("Flow finding: owners pay for scheduling first");
    await page.getByTestId("note-finding").check();
    await page.getByTestId("note-source").fill("https://www.example.com/flow-source");
    await page.getByTestId("note-save").click();
    await page.locator("[data-testid=timeline-event][data-kind=finding]", { hasText: "Flow finding" }).waitFor({ timeout: 15000 });
    const finding = await one("select kind, source_url from notes where record_type = 'projects' and record_id = $1 and body like 'Flow finding%'", [research.id]);
    if (!finding || finding.kind !== "finding" || finding.source_url !== "https://www.example.com/flow-source") throw new Error(JSON.stringify(finding));
    if ((await page.locator("[data-testid=timeline-event][data-kind=finding]", { hasText: "Flow finding" }).getByTestId("finding-source").innerText()).trim() !== "Source: example.com") throw new Error("the source link label");
    // Close and Reopen.
    await page.getByTestId("decision-close").click();
    await page.getByTestId("decision-closed").waitFor({ timeout: 15000 });
    if ((await projectByName("Market research")).status !== "closed") throw new Error("not closed");
    if ((await page.getByTestId("project-pill").innerText()).trim() !== "Closed") throw new Error("the status pill");
    await page.getByTestId("decision-reopen").click();
    await page.getByTestId("decision-close").waitFor({ timeout: 15000 });
    if ((await projectByName("Market research")).status !== "open") throw new Error("not reopened");
  });

  await step("Job search: the two phases with the sample rows, the filters, Add an opportunity (opens its page), the opportunity page (What to find out, Facts), Advance, Close (Declined) joins the closed bar", async () => {
    await page.goto(`${BASE}/work/jobs`);
    await page.getByTestId("jobs-columns").waitFor();
    // The counts come from the database: the demo seed holds job items of its own next to the sample's five.
    const jobCounts = await pg.query(`select s.name, count(*)::int n from pipeline_items i join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id where p.kind = 'job' and i.status = 'open' group by s.name`).then((r) => Object.fromEntries(r.rows.map((x) => [x.name, x.n])));
    const n = (k) => jobCounts[k] ?? 0;
    const phases = await page.getByTestId("jobs-phase").evaluateAll((els) => els.map((e) => [e.dataset.phase, Number(e.dataset.count)]));
    if (JSON.stringify(phases) !== JSON.stringify([["early", n("Contact") + n("Conversation")], ["decide", n("Interview") + n("Offer")]])) throw new Error(`phases: ${JSON.stringify(phases)} vs ${JSON.stringify(jobCounts)}`);
    const stagesShown = await page.locator("[data-testid=stage-heading]").evaluateAll((els) => els.map((e) => `${e.dataset.stage}:${e.dataset.count}`));
    if (stagesShown.join(",") !== `Contact:${n("Contact")},Conversation:${n("Conversation")},Interview:${n("Interview")},Offer:${n("Offer")}`) throw new Error(`stages: ${stagesShown.join(",")}`);
    if ((await page.getByTestId("item-wait").count()) < 1 || (await page.getByTestId("needs-action").count()) < 1) throw new Error("the waiting pill and the Needs a next action pill");
    const closedCounts = await pg.query(`select s.name, count(*)::int n from pipeline_items i join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id where p.kind = 'job' and s.outcome <> 'open' group by s.name`).then((r) => Object.fromEntries(r.rows.map((x) => [x.name, x.n])));
    const declined = closedCounts.Declined ?? 0;
    const closedLabel = `Declined ${declined} · Not chosen ${closedCounts["Not chosen"] ?? 0}${closedCounts.Accepted ? ` · Accepted ${closedCounts.Accepted}` : ""}`;
    if ((await page.getByTestId("closed-label").innerText()).trim() !== closedLabel) throw new Error(`closed bar: ${await page.getByTestId("closed-label").innerText()} vs ${closedLabel}`);
    const pill = async (k) => Number(await page.getByTestId(`jobs-filter-${k}`).getAttribute("data-count"));
    const openJobs = n("Contact") + n("Conversation") + n("Interview") + n("Offer");
    if ((await pill("all")) !== openJobs || (await pill("today")) < 1 || (await pill("wait")) < 1 || (await pill("needs")) < 1) throw new Error("the Job search filter counts");
    await page.getByTestId("jobs-filter-wait").click();
    if ((await page.locator("[data-testid=item-row][data-hidden='0']").count()) !== (await pill("wait"))) throw new Error("the Waiting filter shows the waiting cards");
    await page.getByTestId("jobs-filter-all").click();
    await page.getByTestId("jobs-search").fill("director of operations");
    if ((await page.locator("[data-testid=item-row][data-hidden='0']").count()) !== 1) throw new Error("Find matches the role");
    await page.getByTestId("jobs-search").fill("");
    await page.screenshot({ path: path.join(OUT, "flow-work-jobs.png"), fullPage: true });
    // Add an opportunity: the form, Save, the page opens.
    await page.getByTestId("add-opportunity-button").click();
    await page.getByTestId("add-opportunity-form").waitFor();
    await page.getByTestId("opp-company").fill("Flow Industries");
    await page.getByTestId("opp-role").fill("VP Flow");
    await page.getByTestId("opp-contact").fill("Flo Contact");
    await page.getByTestId("opp-payRange").fill("$160K to $180K");
    await page.getByTestId("opp-save").click();
    await page.waitForURL(/\/work\/jobs\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await page.getByTestId("work-opportunity").waitFor();
    const flow = await itemByName("Flow Industries", "job");
    if (!flow || flow.stage !== "Contact" || flow.next_action !== "Ask for an introduction or a first conversation") throw new Error(`the new opportunity: ${JSON.stringify(flow)}`);
    if ((await one("select pay_range from pipeline_items where id = $1", [flow.id])).pay_range !== "$160K to $180K") throw new Error("pay range");
    // The opportunity page (Harbor Health Partners): What to find out on top, the facts, the record-page figures.
    const harbor = await itemByName("Harbor Health Partners", "job");
    await page.goto(`${BASE}/work/jobs/${harbor.id}`);
    await page.getByTestId("work-opportunity").waitFor();
    const cards = await page.locator("[data-testid=work-opportunity] section h2").allInnerTexts();
    if (cards.map((t) => t.trim()).join("|") !== "What to find out|Next action|Tasks|Facts|Timeline|Decision") throw new Error(`cards: ${cards.join("|")}`);
    if ((await page.getByTestId("find-out-line").count()) !== 3) throw new Error("three lines to find out");
    if ((await page.getByTestId("item-stage-pill").innerText()).trim() !== "Conversation · day 5") throw new Error(`stage pill: ${await page.getByTestId("item-stage-pill").innerText()}`);
    if (!(await page.getByTestId("fact-pay").innerText()).includes("$150K to $170K")) throw new Error("the pay range in Facts");
    if ((await page.getByTestId("figure-next").innerText()).replace(/\s+/g, " ").trim().toLowerCase() !== "today next action") throw new Error("NEXT ACTION figure");
    if (!(await page.getByTestId("figure-last").innerText()).includes("email")) throw new Error("LAST CONTACT figure");
    // Edit a line of What to find out and save.
    await page.getByTestId("find-out-add").click();
    await page.locator("[data-testid=find-out-input]").last().fill("Flow: who would I report to?");
    await page.getByTestId("find-out-save").click();
    await page.getByTestId("item-find-out").getByTestId("save-ok").waitFor({ timeout: 15000 });
    const q = (await one("select open_questions_json from pipeline_items where id = $1", [harbor.id])).open_questions_json;
    if (!q.self.includes("Flow: who would I report to?") || q.self.length !== 4) throw new Error(JSON.stringify(q));
    await page.screenshot({ path: path.join(OUT, "flow-work-opportunity.png"), fullPage: true });
    // Advance to Interview (the stage default comes along), then Close as Declined from the Decision card.
    await page.getByTestId("item-advance").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=item-stage-pill]")?.innerText.startsWith("Interview"), null, { timeout: 15000 });
    const advanced = await itemByName("Harbor Health Partners", "job");
    if (advanced.stage !== "Interview" || advanced.next_action !== "Prepare for the call with the COO") throw new Error(`advance keeps a typed action: ${JSON.stringify(advanced)}`);
    await page.getByTestId("decision-close").click();
    await page.getByTestId("decision-close-declined").click();
    await page.getByTestId("decision-closed").waitFor({ timeout: 15000 });
    const closed = await itemByName("Harbor Health Partners", "job");
    if (closed.stage !== "Declined" || closed.status !== "lost") throw new Error(JSON.stringify(closed));
    await page.goto(`${BASE}/work/jobs`);
    await page.getByTestId("jobs-columns").waitFor();
    if (!(await page.getByTestId("closed-label").innerText()).trim().startsWith(`Declined ${declined + 1}`)) throw new Error("the closed bar after Declined");
    await page.getByTestId("closed-toggle").click();
    if (!(await page.locator("[data-testid=jobs-closed] [data-testid=stage-group][data-stage=Declined]").innerText()).includes("Harbor Health Partners")) throw new Error("Show lists the declined opportunity");
    // Reopen puts it back at Contact.
    await page.goto(`${BASE}/work/jobs/${harbor.id}`);
    await page.getByTestId("decision-reopen").click();
    await page.getByTestId("decision-close").waitFor({ timeout: 15000 });
    if ((await itemByName("Harbor Health Partners", "job")).stage !== "Contact") throw new Error("Reopen");
  });

  await step("Consulting: the four columns with fees and the sample rows, the filters, Add a lead (opens its page with the scope and fee in Facts), Advance (Done asks about the next stage on the default)", async () => {
    await page.goto(`${BASE}/work/consulting`);
    await page.getByTestId("consulting-columns").waitFor();
    // The counts come from the database: the demo seed and the older sample hold consulting items of their own next to the sample's four.
    const conCounts = await pg.query(`select s.name, count(*)::int n from pipeline_items i join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id where p.kind = 'consulting' group by s.name`).then((r) => Object.fromEntries(r.rows.map((x) => [x.name, x.n])));
    const c = (k) => conCounts[k] ?? 0;
    const cols = await page.getByTestId("consulting-stage").evaluateAll((els) => els.map((e) => `${e.dataset.stage}:${e.dataset.count}`));
    if (cols.join(",") !== `Lead:${c("Lead")},Proposal:${c("Proposal")},Engagement:${c("Engagement")},Paid:${c("Paid")}`) throw new Error(`columns: ${cols.join(",")} vs ${JSON.stringify(conCounts)}`);
    const fees = await page.getByTestId("item-fee").allInnerTexts();
    if (!fees.includes("$12K est.") || !fees.includes("$18K") || !fees.includes("$4.5K")) throw new Error(`fees: ${fees.join(",")}`);
    if ((await page.getByTestId("closed-label").innerText()).trim() !== `Lost ${c("Lost")} · Done ${c("Done")}`) throw new Error("the Consulting closed bar");
    const pill = async (k) => Number(await page.getByTestId(`consulting-filter-${k}`).getAttribute("data-count"));
    const openCon = c("Lead") + c("Proposal") + c("Engagement") + c("Paid");
    if ((await pill("all")) !== openCon || (await pill("week")) < 3) throw new Error(`filter counts: ${await pill("all")} ${await pill("today")} ${await pill("week")}`);
    await page.getByTestId("consulting-search").fill("sullivan");
    if ((await page.locator("[data-testid=item-row][data-hidden='0']").count()) !== 2) throw new Error("Find a client");
    await page.getByTestId("consulting-search").fill("");
    await page.screenshot({ path: path.join(OUT, "flow-work-consulting.png"), fullPage: true });
    // Add a lead.
    await page.getByTestId("add-lead-button").click();
    await page.getByTestId("add-lead-form").waitFor();
    await page.getByTestId("lead-client").fill("Flow Client");
    await page.getByTestId("lead-project").fill("Flow review");
    await page.getByTestId("lead-fee").fill("$7.5K");
    await page.getByTestId("lead-scope").fill("Read the flow and write five fixes");
    await page.getByTestId("lead-startDate").fill(nyDate(20));
    await page.getByTestId("lead-save").click();
    await page.waitForURL(/\/work\/consulting\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await page.getByTestId("work-consulting-item").waitFor();
    const lead = await itemByName("Flow Client", "consulting");
    if (!lead || lead.stage !== "Lead" || lead.next_action !== "Find out what they need and who decides") throw new Error(JSON.stringify(lead));
    const det = await one("select scope_notes, start_date::text, rate from consulting_details where item_id = $1", [lead.id]);
    if (!det || det.scope_notes !== "Read the flow and write five fixes" || det.start_date !== nyDate(20) || Number(det.rate) !== 7500) throw new Error(JSON.stringify(det));
    if (!(await page.getByTestId("fact-scope").innerText()).includes("five fixes") || !(await page.getByTestId("fact-fee").innerText()).includes("$7.5K est.")) throw new Error("the scope and fee in Facts");
    if ((await page.getByTestId("figure-fee").innerText()).replace(/\s+/g, " ").trim().toLowerCase() !== "$7.5k est. fee") throw new Error("the FEE figure in the header");
    const cards = await page.locator("[data-testid=work-consulting-item] section h2").allInnerTexts();
    if (cards.map((t) => t.trim()).join("|") !== "Next action|Tasks|Facts|Timeline|Decision") throw new Error(`cards: ${cards.join("|")}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-consulting-page.png"), fullPage: true });
    // Done on the stage default asks about the next stage; Yes moves the lead to Proposal with that stage's default.
    await page.getByTestId("item-next-action").getByTestId("next-action-done").click();
    await page.getByTestId("next-action-ask").waitFor();
    await page.getByTestId("next-action-yes").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=item-stage-pill]")?.innerText.startsWith("Proposal"), null, { timeout: 15000 });
    const moved = await itemByName("Flow Client", "consulting");
    if (moved.stage !== "Proposal" || moved.next_action !== "Send the scope and fee") throw new Error(JSON.stringify(moved));
    // Advance from the header.
    await page.getByTestId("item-advance").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=item-stage-pill]")?.innerText.startsWith("Engagement"), null, { timeout: 15000 });
    if ((await itemByName("Flow Client", "consulting")).stage !== "Engagement") throw new Error("Advance");
  });

  await step("Home: every lane merges on Next actions with lane pills (Outreach, Rosara, Job search, Consulting; deals none), the Rosara and Job search tiles; By the AI orders the rows with the mock AI (cached once a day, Order again), Soonest first comes back, the choice is remembered", async () => {
    // A consulting item and a project due today, so every lane has a row.
    await pg.query("update pipeline_items set next_action_due = $1 where name = 'Sunrise Home Care' and what_it_does = 'Scheduling review'", [nyDate(0)]);
    await pg.query("update projects set next_action_due = $1 where name = 'Rosara platform'", [nyDate(0)]);
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-bento").waitFor();
    const lanes = await page.locator("[data-testid=home-section][data-section=today] [data-testid=home-row]").evaluateAll((els) => els.map((e) => e.dataset.lane));
    for (const lane of ["deals", "outreach", "rosara", "job-search", "consulting"]) if (!lanes.includes(lane)) throw new Error(`no ${lane} row under Due today: ${lanes.join(",")}`);
    const pills = await page.locator("[data-testid=home-section][data-section=today] [data-testid=lane-pill]").allInnerTexts();
    for (const p of ["Outreach", "Rosara", "Job search", "Consulting"]) if (!pills.includes(p)) throw new Error(`no ${p} pill: ${pills.join(",")}`);
    if (await page.locator("[data-testid=home-row][data-lane=deals] [data-testid=lane-pill]").count()) throw new Error("a deal row has a lane pill");
    // Soonest first: deals before the other lanes on the same day.
    if (lanes[0] !== "deals") throw new Error(`the first row under Due today is ${lanes[0]}`);
    // The Rosara tile.
    const rosara = await page.getByTestId("home-rosara").innerText();
    if (!rosara.includes("This week") || !rosara.includes("Flow focus, ten owner calls") || !rosara.includes("Open Rosara")) throw new Error("the Rosara tile");
    if ((await page.getByTestId("home-rosara-count").innerText()).trim() !== "10") throw new Error("the project count on the tile");
    // The Job search tile.
    const jobs = await page.getByTestId("home-jobs").innerText();
    const interview = await one(`select coalesce(i.company_name, i.name) as name from pipeline_items i join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id
      where p.kind = 'job' and i.status = 'open' and s.name = 'Interview' order by i.next_action_due nulls last, i.name limit 1`);
    if (!jobs.includes("Next conversation") || !jobs.includes("Next interview") || !jobs.includes(interview.name) || jobs.includes("Comes with the next update")) throw new Error(`the Job search tile (next interview ${interview.name})`);
    await page.screenshot({ path: path.join(OUT, "flow-work-home-lanes.png") });
    // By the AI: the mock AI reverses the rows and gives one reason each; the order is cached for today.
    await aipost("/__reset");
    const soonest = await page.locator("[data-testid=home-section][data-section=overdue] [data-testid=home-row], [data-testid=home-section][data-section=today] [data-testid=home-row]").evaluateAll((els) => els.map((e) => e.dataset.key));
    await page.getByTestId("home-order-ai").click();
    await page.getByTestId("ai-order-rows").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=ai-reason]").length > 0, null, { timeout: 20000 });
    const ordered = await page.locator("[data-testid=ai-order-rows] [data-testid=home-row]").evaluateAll((els) => els.map((e) => e.dataset.key));
    if (JSON.stringify(ordered) !== JSON.stringify([...soonest].reverse())) throw new Error(`AI order: ${ordered.join(",")} vs ${soonest.join(",")}`);
    if ((await page.getByTestId("ai-reason").count()) !== ordered.length) throw new Error("one reason under each row");
    if ((await page.getByTestId("ai-order-number").first().innerText()).trim() !== "1") throw new Error("the rows are numbered");
    if (!(await page.getByTestId("ai-order-heading").innerText()).toLowerCase().includes("ordered by the ai this")) throw new Error("the heading");
    const cache = await one("select ordered_ids, reasons, for_date::text from ai_order_cache where for_date = $1", [nyDate(0)]);
    if (!cache || cache.ordered_ids.length !== ordered.length || Object.keys(cache.reasons).length !== ordered.length) throw new Error(`cache: ${JSON.stringify(cache)}`);
    if ((await aicalls()).filter((c) => c === "ai_order").length !== 1) throw new Error("one AI call");
    await page.screenshot({ path: path.join(OUT, "flow-work-ai-order.png") });
    // Reload: the choice is remembered and the cached order is used without a new call.
    await page.reload();
    await page.getByTestId("ai-order-rows").waitFor({ timeout: 20000 });
    if ((await aicalls()).filter((c) => c === "ai_order").length !== 1) throw new Error("the cache should be used on reload");
    if ((await page.getByTestId("home-order-ai").getAttribute("aria-checked")) !== "true") throw new Error("By the AI not remembered");
    // Order again asks once more.
    await page.getByTestId("ai-order-again").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=ai-order-again]")?.innerText.trim() === "Order again", null, { timeout: 20000 });
    if ((await aicalls()).filter((c) => c === "ai_order").length !== 2) throw new Error("Order again should ask again");
    // Soonest first comes back.
    await page.getByTestId("home-order-soonest").click();
    await page.getByTestId("ai-order-rows").waitFor({ state: "hidden" });
    if (await page.getByTestId("ai-reason").count()) throw new Error("reasons shown under Soonest first");
    const back = await page.locator("[data-testid=home-section][data-section=overdue] [data-testid=home-row], [data-testid=home-section][data-section=today] [data-testid=home-row]").evaluateAll((els) => els.map((e) => e.dataset.key));
    if (JSON.stringify(back) !== JSON.stringify(soonest)) throw new Error("Soonest first order");
    // Done on a Rosara row from Home clears the project's action (No next action).
    const row = page.locator("[data-testid=home-row][data-lane=rosara]").first();
    const rowKey = await row.getAttribute("data-key");
    await row.getByTestId("next-action-done").click();
    await row.getByTestId("next-action-ask").waitFor();
    await row.getByTestId("next-action-not-yet").click();
    await row.getByTestId("next-action-result").waitFor({ timeout: 15000 });
    if ((await one("select next_action from projects where id = $1", [rowKey.split(":")[1]])).next_action !== null) throw new Error("Done on the Home row");
  });

  await step("Ask AI: the page pill (suggested questions, a cost line, an answer with Make this the next action and Open in email), a card star (Tasks), a field star (Use this fills the field), Set as next action on a record page, all with the mock AI", async () => {
    await aipost("/__reset");
    await page.goto(`${BASE}/work`);
    await page.getByTestId("home-bento").waitFor();
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if (await page.getByTestId("ask-ai-note").count()) throw new Error("the panel still says it comes with the next update");
    await page.getByTestId("ask-ai-pills").waitFor({ timeout: 15000 });
    const pills = await page.getByTestId("ask-ai-pill").allInnerTexts();
    if (pills.length !== 3 || pills[0] !== "What should I do first today?") throw new Error(`pills: ${pills.join("|")}`);
    if (!(await page.getByTestId("ask-ai-estimate").innerText()).match(/One call is (about \d+ cents?|under 1 cent)\./)) throw new Error("the cost line");
    if (await page.getByTestId("ask-ai-steps").count()) throw new Error("no Suggested next steps on Home");
    await page.getByTestId("ask-ai-pill").first().click();
    await page.getByTestId("ask-ai-answer").waitFor({ timeout: 20000 });
    const answer = await page.getByTestId("ask-ai-answer").innerText();
    if (!answer.includes("What should I do first today?") || !answer.includes("comes first on Home")) throw new Error(`answer: ${answer.slice(0, 120)}`);
    if (!(await page.getByTestId("ask-ai-make-next").count()) || !(await page.getByTestId("ask-ai-open-email").count())) throw new Error("the answer buttons");
    // The context sent: only this page's records (the home prompt names the deals, nobody else's data).
    await page.screenshot({ path: path.join(OUT, "flow-work-ask-ai.png") });
    // Make this the next action on Home makes a personal to-do for today.
    await page.getByTestId("ask-ai-make-next").click();
    await page.getByTestId("ask-ai-set-note").waitFor({ timeout: 15000 });
    if (!(await page.getByTestId("ask-ai-set-note").innerText()).includes("Set as a to-do for today")) throw new Error(await page.getByTestId("ask-ai-set-note").innerText());
    if (!(await one("select 1 x from todos where text like 'Deal with %' and due_on = $1", [nyDate(0)]))) throw new Error("the to-do was not made");
    // Open in email: the editor opens with the drafted subject and message.
    await page.getByTestId("ask-ai-open-email").click();
    await page.getByTestId("compose-dialog").waitFor();
    if (!(await page.getByTestId("compose-subject").inputValue()).startsWith("Quick follow-up on")) throw new Error("the email subject");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard email" }).click();
    await page.getByTestId("compose-dialog").waitFor({ state: "hidden" });
    await page.getByTestId("drawer-close").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    // The page pill on a record page: Suggested next steps load on their own; Set as next action.
    const research = await projectByName("Market research");
    await page.goto(`${BASE}/work/rosara/${research.id}`);
    await page.getByTestId("project-tasks").waitFor();
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if ((await page.getByTestId("ask-ai-title").innerText()).trim() !== "Ask AI" || !(await page.getByTestId("ask-ai-panel").innerText()).includes("Context: Market research")) throw new Error("the page context");
    await page.getByTestId("ask-ai-step").first().waitFor({ timeout: 20000 });
    if ((await page.getByTestId("ask-ai-step").count()) !== 3) throw new Error("three suggested steps");
    const stepText = (await page.getByTestId("ask-ai-step").first().locator("p").first().innerText()).trim();
    await page.getByTestId("ask-ai-set-next").first().click();
    await page.getByTestId("ask-ai-set-note").waitFor({ timeout: 15000 });
    if ((await projectByName("Market research")).next_action !== stepText) throw new Error("Set as next action");
    await page.getByTestId("drawer-close").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    // A card star on a record page (Edit batch B): the Tasks card's panel is about the tasks: its title, its three
    // questions, "Suggest tasks for this project" with Add as a task.
    await page.getByTestId("project-tasks").locator("[data-testid=ai-card-star][data-card=Tasks]").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if ((await page.getByTestId("ask-ai-title").innerText()).trim() !== "Ask AI about Tasks" || !(await page.getByTestId("ask-ai-panel").innerText()).includes("Context: Tasks, Market research")) throw new Error("the card context");
    const taskPills = await page.getByTestId("ask-ai-pill").allInnerTexts();
    if (taskPills.length !== 3 || taskPills[1] !== "Which task is missing on this project?") throw new Error(`card pills: ${taskPills.join("|")}`);
    if ((await page.getByTestId("ask-ai-steps").getAttribute("data-kind")) !== "tasks") throw new Error("the Tasks suggestions");
    await page.getByTestId("ask-ai-add-task").first().waitFor({ timeout: 20000 });
    if (!(await page.getByTestId("ask-ai-steps-again").innerText()).includes("Suggest tasks for this project")) throw new Error(`the Suggest tasks button: ${await page.getByTestId("ask-ai-steps-again").innerText()}`);
    const taskText = (await page.getByTestId("ask-ai-step").first().locator("p").first().innerText()).trim();
    const tasksBefore = (await one("select count(*)::int n from deal_todos where record_type = 'projects' and record_id = $1", [research.id])).n;
    await page.getByTestId("ask-ai-add-task").first().click();
    await page.getByTestId("ask-ai-set-note").waitFor({ timeout: 15000 });
    if (!(await page.getByTestId("ask-ai-set-note").innerText()).startsWith("Added as a task")) throw new Error(await page.getByTestId("ask-ai-set-note").innerText());
    if ((await one("select count(*)::int n from deal_todos where record_type = 'projects' and record_id = $1 and text = $2", [research.id, taskText])).n !== 1 || (await one("select count(*)::int n from deal_todos where record_type = 'projects' and record_id = $1", [research.id])).n !== tasksBefore + 1) throw new Error("Add as a task did not add the task");
    await page.screenshot({ path: path.join(OUT, "flow-work-ask-ai-card.png") });
    await page.getByTestId("drawer-close").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    // The field star: the Weekly focus on Rosara; the star shows while the field is empty or focused; Use this fills it.
    await page.goto(`${BASE}/work/rosara`);
    await page.getByTestId("weekly-focus").waitFor();
    const star = page.getByTestId("weekly-focus").locator("[data-testid=ai-field-star][data-field=weekly_focus]");
    if (await star.isVisible()) throw new Error("the star should hide while the field holds text and is not focused");
    await page.getByTestId("weekly-focus-input").focus();
    await star.waitFor({ state: "visible" });
    await star.click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if (!(await page.getByTestId("ask-ai-panel").innerText()).includes("Context: the Weekly focus field")) throw new Error("the field context");
    if ((await page.getByTestId("ask-ai-title").innerText()).trim() !== "Ask AI about the Weekly focus field" || (await page.getByTestId("ask-ai-pill").count()) !== 3 || (await page.getByTestId("ask-ai-steps").count())) throw new Error("a field panel: its own title and questions, no next steps");
    // The Weekly focus is a one-field card: only the field star, no card-header star.
    if (await page.getByTestId("weekly-focus").locator("[data-testid=ai-card-star]").count()) throw new Error("the Weekly focus bar should have no card star");
    await page.getByTestId("ask-ai-draft").waitFor({ timeout: 20000 });
    await page.getByTestId("ask-ai-use").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    if ((await page.getByTestId("weekly-focus-input").inputValue()) !== "This week: finish the agency hub onboarding flow and send the deck to two investors") throw new Error("Use this did not fill the field");
    const calls = await aicalls();
    for (const c of ["ask_page", "next_steps", "field_draft"]) if (!calls.includes(c)) throw new Error(`no ${c} call: ${calls.join(",")}`);
    if (!(await one("select 1 x from ai_usage where purpose = 'ask_field'"))) throw new Error("the call was not recorded with its purpose");
    // A field star in the email editor: Subject gets a line from the AI.
    const reed = await personByName("Mark Reed");
    await page.goto(`${BASE}/work/outreach/${reed.id}`);
    await page.getByTestId("person-page-email").click();
    await page.getByTestId("compose-dialog").waitFor();
    await page.getByTestId("compose-dialog").locator("[data-testid=ai-field-star][data-field=email_subject]").click();
    await page.getByTestId("ask-ai-draft").waitFor({ timeout: 20000 });
    await page.getByTestId("ask-ai-use").click();
    await page.waitForFunction(() => (document.querySelector("[data-testid=compose-subject]")?.value ?? "").startsWith("Next step on"), null, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, "flow-work-ask-ai-field.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard email" }).click();
    await page.getByTestId("compose-dialog").waitFor({ state: "hidden" });
  });

  await step("Edit batch B round 2: a reply cut off by the length limit (stop reason max_tokens) is asked again with double the limit; Suggested next steps render as proper items and the answer renders bullets, never a bracket fragment", async () => {
    await aipost("/__reset");
    await aipost("/__mode", { cutoff: "once" });
    const research = await projectByName("Market research");
    await page.goto(`${BASE}/work/rosara/${research.id}`);
    await page.getByTestId("project-tasks").waitFor();
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    // Suggested next steps: the first reply is cut off; the app asks again and shows the three proper items.
    await page.getByTestId("ask-ai-step").first().waitFor({ timeout: 20000 });
    if ((await page.getByTestId("ask-ai-step").count()) !== 3) throw new Error(`${await page.getByTestId("ask-ai-step").count()} steps after the retry`);
    const stepTexts = await page.getByTestId("ask-ai-step").allInnerTexts();
    if (stepTexts.some((t) => /[{}[\]]|"text"|"reason"/.test(t))) throw new Error(`a bracket fragment rendered as a step: ${stepTexts.join(" | ").slice(0, 160)}`);
    if (!stepTexts[0].includes("Email the main contact on") || !stepTexts[0].includes("The last contact is the oldest line on the page")) throw new Error(`the first step: ${stepTexts[0]}`);
    if (await page.getByTestId("ask-ai-steps-error").count()) throw new Error(`an error line after the retry: ${await page.getByTestId("ask-ai-steps-error").innerText()}`);
    // The answer pill: the first reply is cut off too; the retry gives the bullets, the next action, and the email.
    await page.getByTestId("ask-ai-pill").first().click();
    await page.getByTestId("ask-ai-answer").waitFor({ timeout: 20000 });
    const bullets = await page.getByTestId("ask-ai-answer").locator("li").allInnerTexts();
    // (innerText of a list item starts with the browser's marker text.)
    if (bullets.length !== 3 || bullets.some((t) => /[{}[\]]|"bullets"/.test(t)) || !bullets[0].includes("First: Market research comes first")) throw new Error(`answer bullets: ${bullets.join(" | ").slice(0, 160)}`);
    if (await page.getByTestId("ask-ai-answer-error").count()) throw new Error("an error line under the answer");
    if (!(await page.getByTestId("ask-ai-make-next").count())) throw new Error("the Make this the next action button");
    await page.screenshot({ path: path.join(OUT, "flow-work-ask-ai-cutoff.png") });
    // The mock saw one cut-off reply and one full reply per task, and the retry asked with double the limit.
    const calls = await aicalls();
    for (const c of ["next_steps_cut", "ask_page_cut"]) if (!calls.includes(c)) throw new Error(`no ${c}: ${calls.join(",")}`);
    if (calls.filter((c) => c === "next_steps").length !== 2 || calls.filter((c) => c === "ask_page").length !== 2) throw new Error(`calls: ${calls.join(",")}`);
    const limits = await (await fetch(`${AIMOCK}/__limits`)).json();
    const of = (task) => limits.filter((l) => l.task === task).map((l) => l.max_tokens);
    if (of("next_steps").join(",") !== "1500,3000" || of("ask_page").join(",") !== "1800,3600") throw new Error(`the limits: next_steps ${of("next_steps").join(",")}, ask_page ${of("ask_page").join(",")}`);
    await page.getByTestId("drawer-close").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    await aipost("/__mode", { cutoff: "none" });
  });

  await step("Edit batch B: Suggest tasks reads a plain-text reply (the shared Thinking state meanwhile); an unusable reply shows the AI's text with Try again; Write it reads plain text; Fill from text thinks", async () => {
    await aipost("/__reset");
    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    const todos = page.getByTestId("deal-todos");
    await todos.waitFor();
    const suggest = todos.getByTestId("todo-suggest");
    if ((await suggest.innerText()).trim() !== "Suggest tasks") throw new Error(`the button reads: ${await suggest.innerText()}`);
    // Plain text: the mock answers with bulleted lines, no JSON; the reader takes the lines as items. The mock answers
    // 1.5 seconds late here, so the Thinking state can be seen.
    await aipost("/__mode", { todos: "plain", delay: 1500 });
    const before = (await todosOf(dalton.id)).length;
    await suggest.click();
    // The thinking state: grayed, a spinner, "Thinking".
    await page.waitForFunction(() => { const b = document.querySelector("[data-testid=deal-todos] [data-testid=todo-suggest][data-busy='1']"); return !!b && !!b.querySelector("[data-testid=ai-thinking]") && b.innerText.includes("Thinking"); }, null, { timeout: 5000 });
    await todos.getByTestId("todo-note").waitFor({ timeout: 20000 });
    const note = await todos.getByTestId("todo-note").innerText();
    if (!/\d suggested\./.test(note)) throw new Error(`plain-text tasks: ${note}`);
    await page.waitForFunction((n) => document.querySelectorAll("[data-testid=deal-todos] [data-testid=todo-item]").length > n, before, { timeout: 15000 });
    const added = (await todosOf(dalton.id)).map((t) => t.text);
    if (added.length <= before) throw new Error("no task added from the plain reply");
    if (added.some((t) => /^Here are a few things/.test(t))) throw new Error("the reply's lead-in line became a task");
    if ((await suggest.getAttribute("data-busy")) !== "0" || (await suggest.innerText()).trim() !== "Suggest tasks") throw new Error("the button should read Suggest tasks again");
    // An unusable reply (JSON without a list) after the retry: the message, the reply's text, Try again.
    await aipost("/__mode", { todos: "invalid", delay: 0 });
    const callsBefore = (await aicalls()).filter((c) => c === "deal_todos").length;
    await suggest.click();
    await todos.getByTestId("todo-note-retry").waitFor({ timeout: 20000 });
    const bad = await todos.getByTestId("todo-note").innerText();
    if (!bad.includes("not in a form the app can use") || !(await todos.getByTestId("todo-note-reply").innerText()).includes("Nothing to add for this deal")) throw new Error(`unusable reply: ${bad}`);
    if ((await aicalls()).filter((c) => c === "deal_todos").length !== callsBefore + 2) throw new Error("the AI should be asked twice (the stricter second try)");
    // Try again with a good reply.
    await aipost("/__mode", { todos: "valid" });
    await todos.getByTestId("todo-note-retry").click();
    await page.waitForFunction(() => /suggested\.|Nothing new/.test(document.querySelector("[data-testid=deal-todos] [data-testid=todo-note]")?.innerText ?? ""), null, { timeout: 20000 });
    // Write it with plain text: the Key finding star; the draft shows the bare sentence; Use this fills the field.
    await aipost("/__mode", { field: "plain" });
    await page.getByTestId("key-finding").focus();
    await page.getByTestId("deal-findings").locator("[data-testid=ai-field-star][data-field=key_finding]").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    await page.getByTestId("ask-ai-draft").waitFor({ timeout: 20000 });
    const draft = await page.getByTestId("ask-ai-draft").innerText();
    if (!draft.includes("Mock finding:") || draft.includes("{")) throw new Error(`plain draft: ${draft}`);
    if (!(await page.getByTestId("ask-ai-write-again").innerText()).includes("Write it again")) throw new Error("Write it again");
    await page.getByTestId("ask-ai-use").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
    if (!(await page.getByTestId("key-finding").inputValue()).startsWith("Mock finding:")) throw new Error("Use this did not fill the key finding");
    await aipost("/__mode", { field: "valid" });
    // Fill from text shares the thinking state.
    await aipost("/__mode", { delay: 1500 });
    await page.goto(`${BASE}/work/listings?add=1`);
    await page.getByTestId("listing-text").fill("For sale: Regional Sign Shop\nRevenue $3.1M, EBITDA $1.1M, Asking $4.0M\nLocation: Macon, GA\nIndustry: Signage");
    const fill = page.getByTestId("listing-fill");
    await fill.click();
    await page.locator("[data-testid=listing-fill][data-busy='1'] [data-testid=ai-thinking]").waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector("[data-testid=listing-name]")?.value.includes("Sign Shop"), null, { timeout: 20000 });
    if ((await fill.innerText()).trim() !== "Fill from text") throw new Error("Fill from text should read its name again");
    await aipost("/__mode", { delay: 0 });
  });

  await step("Edit batch B: the Ask AI panel opens before its content loads (title and questions at once, the cost line later)", async () => {
    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    await page.getByTestId("deal-todos").waitFor();
    await page.waitForLoadState("networkidle");
    // Every server action answers 4 seconds late: the panel must not wait for it. (The clock is not measured: under the
    // fake clock of late-evening.sh the browser's own timing is not steady; what counts is that the title and the
    // questions are there while the server has not answered yet, and that the cost line arrives after.)
    const slow = async (route, req) => {
      if (req.method() === "POST" && req.headers()["next-action"]) await new Promise((r) => setTimeout(r, 4000));
      await route.continue().catch(() => null);
    };
    await page.route("**/*", slow);
    const t0 = Date.now();
    await page.getByTestId("deal-todos").locator("[data-testid=ai-card-star][data-card=Tasks]").click();
    await page.getByTestId("ask-ai-title").waitFor();
    await page.getByTestId("ask-ai-pills").waitFor();
    const opened = Date.now() - t0;
    if ((await page.getByTestId("ask-ai-title").innerText()).trim() !== "Ask AI about Tasks" || (await page.getByTestId("ask-ai-pill").count()) !== 3) throw new Error("the panel's own title and questions");
    if (await page.getByTestId("ask-ai-estimate").count()) throw new Error(`the cost line arrived before the server answered (the panel took ${opened} ms)`);
    await page.getByTestId("ask-ai-estimate").waitFor({ timeout: 20000 });
    if (Date.now() - t0 < 3500) throw new Error("the cost line should come from the server");
    await page.unroute("**/*", slow);
    await page.getByTestId("drawer-close").click();
    await page.getByTestId("ask-ai-panel").waitFor({ state: "hidden" });
  });

  await step("Edit batch B: Done buttons outlined cobalt with a white fill; Advance outlined; the one solid button on a page is its main action; no gold or brown hex in the built styles", async () => {
    await page.goto(`${BASE}/work`);
    await page.getByTestId("next-action-row").first().waitFor();
    const done = page.getByTestId("next-action-done").first();
    const style = await done.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { tone: el.dataset.tone, bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
    });
    if (style.tone !== "cobalt" || style.bg !== "rgb(255, 255, 255)" || style.border !== "rgb(30, 64, 175)" || style.color !== "rgb(30, 64, 175)") throw new Error(`Done: ${JSON.stringify(style)}`);
    await done.hover();
    // The color changes over a short transition.
    await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-testid=next-action-done]")).backgroundColor === "rgb(234, 242, 255)", null, { timeout: 3000 }).catch(() => null);
    const hovered = await done.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (hovered !== "rgb(234, 242, 255)") throw new Error(`Done on hover: ${hovered}`);
    // Follow up is soft blue; Set next action (Needs a next action) is outlined.
    const follow = await page.getByTestId("follow-up-button").first().evaluate((el) => [el.dataset.tone, getComputedStyle(el).backgroundColor, getComputedStyle(el).color].join("|"));
    if (follow !== "soft|rgb(234, 242, 255)|rgb(30, 64, 175)") throw new Error(`Follow up: ${follow}`);
    // The progress mark: done segments cobalt, the current one #00F0FF, the rest light gray.
    const segs = await page.locator("[data-testid=progress-mark]").evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.children].map((i) => `${i.dataset.seg}:${getComputedStyle(i).backgroundColor}`)))]);
    if (!segs.some((x) => x === "current:rgb(0, 240, 255)") || !segs.some((x) => x === "done:rgb(30, 64, 175)") || !segs.some((x) => x === "todo:rgb(226, 232, 240)")) throw new Error(`stage mark: ${segs.join(",")}`);
    // The counter bar fill is #00F0FF; the section headings are charcoal; the lane pills are the one soft blue.
    const bar = await page.locator("[data-testid=home-outreach-counter] i").evaluate((el) => getComputedStyle(el).backgroundColor);
    if (bar !== "rgb(0, 240, 255)") throw new Error(`counter bar: ${bar}`);
    const heading = await page.locator("[data-testid=section-heading][data-count]:not([data-count='0'])").first().evaluate((el) => getComputedStyle(el).color);
    if (heading !== "rgb(51, 65, 85)") throw new Error(`heading color: ${heading}`);
    const lanes = await page.getByTestId("lane-pill").evaluateAll((els) => [...new Set(els.map((e) => `${e.dataset.tone}:${getComputedStyle(e).backgroundColor}`))]);
    if (lanes.length !== 1 || lanes[0] !== "blue:rgb(234, 242, 255)") throw new Error(`lane pills: ${lanes.join(",")}`);
    // The deal page: Advance outlined, Save solid (#14297b at rest).
    const dalton = await dealByName("Dalton Services");
    await page.goto(`${BASE}/work/deals/${dalton.id}`);
    await page.getByTestId("decision-advance").waitFor();
    const advance = await page.getByTestId("decision-advance").evaluate((el) => [el.dataset.tone, getComputedStyle(el).backgroundColor].join("|"));
    if (advance !== "cobalt|rgb(255, 255, 255)") throw new Error(`Advance: ${advance}`);
    await page.goto(`${BASE}/work/outreach`);
    await page.getByTestId("add-person-button").waitFor();
    const add = await page.getByTestId("add-person-button").evaluate((el) => getComputedStyle(el).backgroundColor);
    if (add !== "rgb(20, 41, 123)") throw new Error(`Add a person: ${add}`);
    const solids = await page.locator("main button, main a").evaluateAll((els) => els.filter((e) => getComputedStyle(e).backgroundColor === "rgb(20, 41, 123)").map((e) => e.innerText.trim()));
    if (solids.join("|") !== "Add a person") throw new Error(`solid buttons on Outreach: ${solids.join("|")}`);
    // No gold or brown anywhere in the built styles.
    const sheets = await page.evaluate(async () => {
      const hrefs = [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href);
      const texts = await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.text())));
      return texts.join("\n") + [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    });
    if (!sheets.length) throw new Error("no stylesheet found");
    for (const hex of ["b8862b", "7a5714", "fbf4e2", "e8d29a", "d9bd84", "f6ead0", "92400e", "fcd34d", "--gold"]) if (sheets.toLowerCase().includes(hex)) throw new Error(`the built styles still carry ${hex}`);
  });

  await step("Edit batch B: rows line up. On Home, Outreach, Rosara, and Screen listings every figure and button column sits at the same x on every row, with long and short text", async () => {
    // Make the longest cases: a 120 minute block, a 4-days-late due, a long next action that wraps, a long name.
    const dalton = await dealByName("Dalton Services");
    const meridian = await dealByName("Meridian Industrial Coatings");
    await pg.query("update pipeline_items set next_action_minutes = 120, next_action_due = $2, next_action = 'Finish the seven year model with the downside scenario at three times trailing earnings and send it to the partners for comments before the call' where id = $1", [meridian.id, nyDate(-4)]);
    await pg.query("update pipeline_items set next_action_minutes = 5, next_action_due = $2 where id = $1", [dalton.id, nyDate(0)]);
    const sameX = async (selector, cols) => {
      const rows = await page.locator(selector).evaluateAll((els, cs) => els.filter((e) => getComputedStyle(e).display !== "none").map((e) => Object.fromEntries(cs.map((c) => { const col = e.querySelector(`[data-col=${c}]`); return [c, col ? Math.round(col.getBoundingClientRect().left) : null]; }))), cols);
      if (rows.length < 3) throw new Error(`${selector}: only ${rows.length} rows to compare`);
      for (const c of cols) {
        const xs = [...new Set(rows.map((r) => r[c]).filter((x) => x !== null))];
        if (xs.length !== 1) throw new Error(`${selector} column ${c} sits at x ${xs.join(", ")} (${rows.length} rows)`);
      }
      return rows.length;
    };
    await page.goto(`${BASE}/work`);
    await page.getByTestId("next-action-row").first().waitFor();
    await page.getByTestId("home-order-soonest").click();
    const homeRows = await sameX("[data-testid=next-action-row], [data-testid=outreach-action-row], [data-testid=project-action-row], [data-testid=item-action-row], [data-testid=needs-action-row]", ["due", "minutes", "buttons"]);
    // The row with the long action wraps its text inside its own width: the figures stay on one line at the right.
    const tall = await page.locator(`[data-testid=next-action-row][data-deal="${meridian.id}"]`).evaluate((e) => ({ h: e.getBoundingClientRect().height, due: e.querySelector("[data-col=due]").innerText, min: e.querySelector("[data-col=minutes]").innerText }));
    if (tall.due !== "4 days late" || tall.min !== "120 min") throw new Error(`the longest case: ${JSON.stringify(tall)}`);
    await page.goto(`${BASE}/work/outreach`);
    await page.getByTestId("person-row").first().waitFor();
    await sameX("[data-testid=person-row]", ["lastContact", "nextDate", "buttons"]);
    await page.goto(`${BASE}/work/rosara`);
    await page.getByTestId("project-row").first().waitFor();
    await sameX("[data-testid=project-row]", ["count", "nextDate", "buttons"]);
    if ((await page.getByTestId("set-next-action").count()) < 1) throw new Error("the sample should have a project without a next action (Set the next action)");
    await page.goto(`${BASE}/work/listings`);
    await page.getByTestId("listing-row").first().waitFor();
    await sameX("[data-testid=listing-row]:not([data-hidden='1'])", ["money", "buttons"]);
    // Screenshots of Home with the long and short rows, at 1280 and on the phone.
    await shoot3(`${BASE}/work`, "work-now");
    await pg.query("update pipeline_items set next_action_minutes = 60, next_action = 'Finish the 7-year model, scenario at 3x TTM', next_action_due = $2 where id = $1", [meridian.id, nyDate(-1)]);
    if (homeRows < 5) throw new Error(`only ${homeRows} rows on Home`);
  });

  // ---------- Batch C (database update 0025): Targets, End of day, Reports, the Home tile, Ask AI ----------
  const eodDay = () => nyDate(0);
  /** Waits (up to 15 s) until a database check passes: the actions save after the page shows the change. */
  const untilDb = async (check, what) => {
    for (let i = 0; i < 60; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(what);
  };
  const ownerTargets = () => pg.query("select id, name, counts_key, period, minimum_count, is_commitment, archived_at from targets where counts_key is not null order by sort_order").then((r) => r.rows);

  await step("Batch C: Targets: the six defaults counted from the sample's facts, the strip and the marks, the Commitment switch saves, Edit changes number and cadence, Add a target lands on the list, Remove archives it (the row stays)", async () => {
    await page.goto(`${BASE}/work/targets`);
    await page.getByTestId("work-targets").waitFor();
    const sub = (await page.getByTestId("accountability-subnav").locator("a").allInnerTexts()).map((t) => t.trim().split("\n")[0]);
    if (sub.join("|") !== "Targets|End of day|Reports") throw new Error(`accountability subnav: ${sub.join("|")}`);
    if ((await page.getByTestId("subnav-eod-badge").innerText()).trim() !== "5:30") throw new Error("End of day badge should read 5:30 before the close");
    const rows = await page.getByTestId("target-row").evaluateAll((els) => els.map((e) => [e.dataset.target, e.dataset.mark, e.dataset.commitment]));
    if (rows.map((r) => r[0]).join("|") !== "Listings screened|Brokers contacted|Network outreach|Follow-ups done on time|Deals moved a stage|Rosara focus done") throw new Error(`targets: ${JSON.stringify(rows)}`);
    const inDb = await ownerTargets();
    if (inDb.length !== 6 || inDb.filter((t) => t.is_commitment).length !== 2) throw new Error(`db targets: ${JSON.stringify(inDb.map((t) => [t.name, t.is_commitment]))}`);
    // The strips: five cells for a per-weekday target, eight for a per-week one; the open cell is amber (the "now" state).
    const strips = await page.getByTestId("target-strip").evaluateAll((els) => els.map((e) => [...e.querySelectorAll("[data-cell]")].map((c) => c.dataset.cell).join(",")));
    if (strips[0].split(",").length !== 5 || strips[1].split(",").length !== 8) throw new Error(`strips: ${JSON.stringify(strips)}`);
    if (!strips[1].endsWith("now")) throw new Error("the week's last cell should be open");
    // The figures and marks sit at the same x on every row (the alignment rule).
    const xs = await page.getByTestId("target-row").evaluateAll((els) => els.map((e) => [Math.round(e.querySelector("[data-testid=status-mark]").getBoundingClientRect().left), Math.round(e.querySelector("[data-row-right]").getBoundingClientRect().left), Math.round(e.querySelector("[data-col=buttons]").getBoundingClientRect().left)]));
    for (const x of xs) if (x.join(",") !== xs[0].join(",")) throw new Error(`columns shift between rows: ${JSON.stringify(xs)}`);
    // The Rosara focus done target counts the sample's focus_done events: last week met.
    if (!(await page.getByTestId("target-row").nth(5).innerText()).includes("Done")) throw new Error("Rosara focus done should show Done for last week");
    // The Commitment switch saves.
    const brokers = page.getByTestId("target-row").nth(1);
    await brokers.getByTestId("commitment-switch").check({ force: true });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row][data-commitment='1']").length === 3);
    await untilDb(async () => (await one("select is_commitment from targets where name = 'Brokers contacted'")).is_commitment, "the switch did not save");
    await page.waitForFunction(() => document.querySelector("[data-testid=targets-summary]")?.innerText.includes("3 commitments"));
    await brokers.getByTestId("commitment-switch").uncheck({ force: true });
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row][data-commitment='1']").length === 2);
    // Edit: the number and the cadence.
    await brokers.getByTestId("target-edit-button").click();
    await brokers.getByTestId("target-edit-number").fill("4");
    await brokers.getByTestId("target-edit-cadence").selectOption("day");
    await brokers.getByTestId("target-edit-save").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row]")[1]?.innerText.includes("Per weekday · target 4"));
    const edited = await one("select period, minimum_count from targets where name = 'Brokers contacted'");
    if (edited.period !== "day" || edited.minimum_count !== 4) throw new Error(`edit: ${JSON.stringify(edited)}`);
    await page.getByTestId("target-row").nth(1).getByTestId("target-edit-button").click();
    await page.getByTestId("target-row").nth(1).getByTestId("target-edit-number").fill("5");
    await page.getByTestId("target-row").nth(1).getByTestId("target-edit-cadence").selectOption("week");
    await page.getByTestId("target-row").nth(1).getByTestId("target-edit-save").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row]")[1]?.innerText.includes("Per week · target 5"));
    // Add a target.
    await page.getByTestId("add-target-button").click();
    await page.getByTestId("add-target-name").fill("Calls a day");
    await page.getByTestId("add-target-counts").selectOption("calls_logged");
    await page.getByTestId("add-target-cadence").selectOption("day");
    await page.getByTestId("add-target-number").fill("2");
    await page.getByTestId("add-target-commitment").check({ force: true });
    await page.getByTestId("add-target-save").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row]").length === 7);
    const added = await one("select counts_key, period, minimum_count, is_commitment, archived_at from targets where name = 'Calls a day'");
    if (!added || added.counts_key !== "calls_logged" || added.period !== "day" || added.minimum_count !== 2 || !added.is_commitment) throw new Error(`added: ${JSON.stringify(added)}`);
    const last = page.getByTestId("target-row").nth(6);
    if (!(await last.innerText()).includes("Calls a day")) throw new Error("the new target should be last");
    if (!(await last.getByTestId("target-strip").innerText()).includes("Mon to Fri")) throw new Error("a per-weekday target shows the Mon to Fri strip");
    // Remove archives: the row leaves the list, the table keeps it.
    await last.getByTestId("target-edit-button").click();
    await last.getByTestId("target-remove").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=target-row]").length === 6);
    const gone = await one("select archived_at from targets where name = 'Calls a day'");
    if (!gone || !gone.archived_at) throw new Error("Remove should archive, not delete");
    // Past weeks: four tiles; the legend; Most missed names a target.
    if ((await page.getByTestId("past-week").count()) !== 4) throw new Error("four past weeks");
    if ((await page.getByTestId("legend-mark").count()) !== 3) throw new Error("the legend's three marks");
    // The old Targets page is still reachable under More.
    await page.goto(`${BASE}/more`);
    const more = await page.getByTestId("more-links").innerText();
    for (const t of ["Targets (old)", "Commitments", "Partner reports", "Close the day"]) if (!more.includes(t)) throw new Error(`More is missing ${t}`);
    await page.goto(`${BASE}/accountability/targets`);
    await page.waitForLoadState("networkidle");
  });

  await step("Batch C: End of day: the status line, Today counted from the database, the reason owed from the sample's skipped day, Skip today with a reason (badge Skipped, the tile line), then the day reopened for the send", async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("work-end-of-day").waitFor();
    const status = page.getByTestId("eod-status");
    const owed = Number(await status.getAttribute("data-owed"));
    if (owed < 1) throw new Error("the sample's skipped day should leave a reason owed");
    if (!(await page.getByTestId("eod-step-reasons").innerText()).includes(`${owed} left`)) throw new Error("the status line should count the reasons left");
    if (!(await page.getByTestId("eod-step-tomorrow").innerText()).includes("empty")) throw new Error("the tomorrow line starts empty");
    if ((await page.getByTestId("eod-owed").count()) < 1) throw new Error("the owed row from the skipped day is missing");
    // Today, counted: the figures match the database (calls and emails logged today).
    const comms = await one("select count(*)::int n from communications where direction <> 'incoming' and method in ('call','meeting','video') and (occurred_at at time zone 'America/New_York')::date = $1", [eodDay()]);
    const calls = await page.getByTestId("counted-row").nth(2).getByTestId("counted-figure").first().innerText();
    if (!calls.startsWith(String(comms.n))) throw new Error(`calls counted ${calls} vs ${comms.n} in the database`);
    // The report card: the partner from the sample (Jake Morgan, report frequency daily), the email with the greeting and the closing lines.
    if (!(await page.getByTestId("report-meta").innerText()).includes("Jake Morgan")) throw new Error("the report should go to the sample's Jake Morgan");
    const preview = await page.getByTestId("report-preview").innerText();
    for (const t of ["Hello Jake,", "Nothing is required from you.", "Thank you,", "Bram", "TODAY", "TARGETS"]) if (!preview.includes(t)) throw new Error(`the preview is missing ${t}`);
    // Skip today with a reason.
    await page.getByTestId("skip-today").click();
    await page.getByTestId("skip-reason").fill("Travel day, Atlanta");
    await page.getByTestId("skip-confirm").click();
    await page.getByTestId("skipped-line").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=tab-eod-badge]")?.dataset.badge === "Skipped");
    const row = await one("select status, skip_reason, judged from end_of_day where day = $1", [eodDay()]);
    if (row.status !== "skipped" || row.skip_reason !== "Travel day, Atlanta" || !Array.isArray(row.judged) || !row.judged.length) throw new Error(`skipped row: ${JSON.stringify(row)}`);
    await page.goto(`${BASE}/work`);
    if ((await page.getByTestId("home-eod-pill").innerText()).trim() !== "Skipped") throw new Error("the Home tile should say Skipped");
    if (!(await page.getByTestId("home-eod-line").innerText()).includes("Skipped: Travel day, Atlanta")) throw new Error("the Home tile's End of day line");
    await page.goto(`${BASE}/work/reports?view=sent`);
    await page.getByTestId("sent-row").first().waitFor();
    if ((await page.getByTestId("sent-row").first().getAttribute("data-state")) !== "skipped") throw new Error("the skipped day should be the newest row under Sent reports");
    // Test only: the day opens again so the send can be checked on the same day.
    await pg.query("delete from end_of_day where day = $1", [eodDay()]);
  });

  await step("Batch C: End of day: reasons drafted by the mock AI (Use these), Same reason for all, the tomorrow line (Use this line), the field star, Edit the report in place, Approve and send through the Google stand-in: the sent row under Reports, the badge Sent, the partner report kept", async () => {
    await aipost("/__reset");
    await gpost("/__reset");
    // A weak day on purpose: the demo seed screens several listings "today", so the target is raised for the check.
    await pg.query("update targets set minimum_count = 50 where name = 'Listings screened'");
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("work-end-of-day").waitFor();
    const asks = await page.getByTestId("eod-target").evaluateAll((els) => els.filter((e) => e.dataset.asks === "1").map((e) => e.dataset.target));
    if (!asks.includes("Listings screened")) throw new Error(`Listings screened should ask for a reason on a weak day: ${asks.join(",")}`);
    // The card star opens the panel about the reasons and drafts them with the mock AI; Use these fills the boxes.
    await page.getByTestId("ai-card-star").first().click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if (!(await page.getByTestId("ask-ai-title").innerText()).includes("Reasons")) throw new Error("the panel should be about the reasons");
    await page.getByTestId("ask-ai-reasons-drafts").waitFor({ timeout: 20000 });
    if ((await page.getByTestId("ask-ai-reason-draft").count()) < 1) throw new Error("no reason draft");
    if (!(await aicalls()).includes("eod_reasons")) throw new Error("the mock AI was not asked for eod_reasons");
    await page.getByTestId("ask-ai-use-reasons").click();
    await page.getByTestId("ask-ai-reasons-note").waitFor();
    await page.getByTestId("drawer-close").click();
    const filled = await page.getByTestId("reason-input").evaluateAll((els) => els.map((e) => e.value));
    if (!filled.some((v) => v.startsWith("Mock reason"))) throw new Error(`the drafts did not fill the boxes: ${JSON.stringify(filled)}`);
    await page.waitForFunction(() => { const r = document.querySelector("[data-testid=eod-status]"); return r && r.dataset.owed === String(document.querySelectorAll("[data-testid=reason-input]").length - [...document.querySelectorAll("[data-testid=reason-input]")].filter((e) => e.value.trim()).length); }, null, { timeout: 15000 }).catch((e) => { throw new Error(`reasons-left after Use these: ${e.message.split("\n")[0]}`); });
    // Same reason for all: every box gets the typed line, saved on blur.
    await page.getByTestId("same-reason-toggle").click();
    await page.getByTestId("same-reason-input").fill("Site visit in Chattanooga took the day");
    await page.getByTestId("same-reason-input").blur();
    await page.waitForFunction(() => document.querySelector("[data-testid=eod-status]")?.dataset.owed === "0", null, { timeout: 15000 }).catch((e) => { throw new Error(`reasons-left after Same reason for all: ${e.message.split("\n")[0]}`); });
    await untilDb(async () => Object.values((await one("select reasons from end_of_day where day = $1", [eodDay()])).reasons).every((v) => v === "Site visit in Chattanooga took the day"), "the shared reason was not saved to every box");
    if (!(await page.getByTestId("eod-step-reasons").innerText()).includes("done")) throw new Error("Reasons should read done");
    // The tomorrow line: the field star writes it with the mock AI, Use this line fills the box.
    await page.getByTestId("tomorrow-input").focus();
    await page.getByTestId("ai-field-star").last().click();
    await page.getByTestId("ask-ai-draft").waitFor({ timeout: 20000 });
    if ((await page.getByTestId("ask-ai-use").innerText()).trim() !== "Use this line") throw new Error("the button should read Use this line");
    await page.getByTestId("ask-ai-use").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=tomorrow-input]")?.value.includes("Meridian model"), null, { timeout: 15000 }).catch((e) => { throw new Error(`tomorrow box after Use this line: ${e.message.split("\n")[0]}`); });
    await page.waitForFunction(() => document.querySelector("[data-testid=eod-step-tomorrow]")?.dataset.word === "done");
    await untilDb(async () => String((await one("select tomorrow_line from end_of_day where day = $1", [eodDay()])).tomorrow_line ?? "").includes("Meridian model"), "the tomorrow line was not saved");
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.innerText.includes("Meridian model"));
    // Edit in place: a typed change lands in the saved HTML and the preview says edited.
    await page.getByTestId("report-edit").click();
    await page.getByTestId("report-preview").evaluate((el) => { const p = [...el.querySelectorAll("p")].find((x) => x.textContent.startsWith("Here is my report")); p.textContent = "Here is my report, with one line added by hand."; });
    await page.getByTestId("report-edit").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.dataset.edited === "1");
    await untilDb(async () => { const ed = await one("select report_edited, report_html from end_of_day where day = $1", [eodDay()]); return ed.report_edited && ed.report_html.includes("one line added by hand") && !/<script|onerror=/i.test(ed.report_html); }, "the edit was not kept cleanly");
    if (!(await page.getByTestId("report-hint").innerText()).includes("edited")) throw new Error("the hint should say edited");
    await page.screenshot({ path: path.join(OUT, "flow-work-end-of-day-ready.png"), fullPage: true });
    // Approve and send: one email through the Google stand-in to Jake, the row under Reports, the badge Sent.
    await page.getByTestId("report-send").click();
    await page.getByTestId("sent-line").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector("[data-testid=tab-eod-badge]")?.dataset.badge === "Sent");
    const sent = await gsent();
    if (sent.length !== 1 || sent[0].to !== "jake.morgan@example.com" || !/^Daily report/.test(sent[0].subject)) throw new Error(`sent: ${JSON.stringify(sent.map((m) => [m.to, m.subject]))}`);
    if (!sent[0].html.includes("one line added by hand") || !sent[0].body.includes("one line added by hand") || !sent[0].html.includes("Thank you,<br>Bram")) throw new Error("the email should carry the edited text in both parts");
    if (/<script|<style|onerror=/i.test(sent[0].html.split("gmail_signature")[0])) throw new Error("html not email-safe");
    // On a Friday the report adds the week and the tomorrow line is Monday's.
    const friday = new Date(`${nyDate(0)}T12:00:00Z`).getUTCDay() === 5;
    if (friday && (!sent[0].html.includes("The week, ") || !sent[0].html.includes(">Monday<") || !sent[0].subject.includes("with the week"))) throw new Error("the Friday report should add the week and end with Monday");
    if (!friday && sent[0].html.includes("The week, ")) throw new Error("a weekday report should not add the week");
    const day = await one("select status, sent_at, report_id, report_subject from end_of_day where day = $1", [eodDay()]);
    if (day.status !== "sent" || !day.sent_at || !day.report_id || day.report_subject !== sent[0].subject) throw new Error(`day row: ${JSON.stringify(day)}`);
    const rep = await one("select status, report_kind, sent_at, gmail_message_id, summary from partner_reports where id = $1", [day.report_id]);
    if (rep.status !== "finalized" || rep.report_kind !== "end_of_day" || !rep.sent_at || !rep.gmail_message_id || !rep.summary) throw new Error(`report: ${JSON.stringify(rep)}`);
    const comm = await one("select id, subject from communications where gmail_message_id = $1", [rep.gmail_message_id]);
    if (!comm) throw new Error("no communication for the send");
    if (!(await one("select count(*)::int n from record_links where from_id = $1 and to_type = 'partner_reports'", [comm.id])).n) throw new Error("the communication is not linked to the report");
    if (!(await page.getByTestId("eod-step-send").innerText()).includes("sent")) throw new Error("the status line should say sent");
    if ((await page.getByTestId("report-hint").innerText()).trim() !== "As sent") throw new Error("the hint should say As sent");
    if (await page.getByTestId("report-send").count()) throw new Error("Approve and send should be gone after the send");
    await page.screenshot({ path: path.join(OUT, "flow-work-end-of-day-sent.png"), fullPage: true });
    // A second press of the same request does not send twice (the page is reloaded; the button is gone).
    await page.reload();
    await page.getByTestId("sent-line").waitFor();
    if ((await gsent()).length !== 1) throw new Error("sent twice");
    await pg.query("update targets set minimum_count = 5 where name = 'Listings screened'");
    // Home: the tile says Sent.
    await page.goto(`${BASE}/work`);
    if ((await page.getByTestId("home-eod-pill").innerText()).trim() !== "Sent") throw new Error("the Home tile should say Sent");
    if ((await page.getByTestId("home-target-line").count()) < 2) throw new Error("the tile shows two or three target lines");
  });

  await step("Batch C: Reports: the week view with its six tiles and four cards, the period pills, Sent reports by week with the sample's reviewed, plain, and skipped rows and today's, Find, Collapse all, a row opens the report as sent with the reply", async () => {
    await page.goto(`${BASE}/work/reports`);
    await page.getByTestId("work-reports").waitFor();
    const labels = await page.getByTestId("week-tile").evaluateAll((els) => els.map((e) => e.dataset.label));
    if (labels.join("|") !== "Targets met|Deals moved|Listings screened|Network outreach|Follow-ups on time|Days waiting on brokers") throw new Error(`tiles: ${labels.join("|")}`);
    for (const t of ["report-targets", "report-waits", "report-moves", "report-passed"]) if (!(await page.getByTestId(t).count())) throw new Error(`missing card ${t}`);
    // Deals moved this week matches the database (stage moves of screened items with an earlier stage this week).
    const movesShown = Number((await page.getByTestId("report-moves").innerText()).match(/(\d+) moves?/)[1]);
    const monday = nyDate(-((new Date(`${nyDate(0)}T12:00:00Z`).getUTCDay() + 6) % 7));
    const movesDb = await one(`select count(*)::int n from stage_history h join pipeline_stages s on s.id = h.stage_id join pipeline_items i on i.id = h.item_id
      where s.outcome in ('open','won') and (h.entered_at at time zone 'America/New_York')::date >= $1
        and exists (select 1 from stage_history x where x.item_id = h.item_id and x.stage_id is not null and x.entered_at < h.entered_at)`, [monday]);
    if (movesShown !== movesDb.n) throw new Error(`deals moved: ${movesShown} shown, ${movesDb.n} in the database`);
    await page.getByTestId("reports-period-last").click();
    if ((await page.getByTestId("week-view").getAttribute("data-period")) !== "last") throw new Error("Last week did not switch");
    if (!(await page.getByTestId("period-lead").innerText()).startsWith("Week of")) throw new Error("the period lead");
    await page.getByTestId("reports-period-month").click();
    if (!(await page.getByTestId("report-targets").innerText()).includes("Met on")) throw new Error("the month view rows");
    await page.getByTestId("reports-period-this").click();
    // Sent reports.
    await page.getByTestId("reports-view-sent").click();
    await page.getByTestId("sent-reports-card").waitFor();
    const states = await page.getByTestId("sent-row").evaluateAll((els) => els.map((e) => e.dataset.state));
    if (states[0] !== "sent" || states.filter((s) => s === "skipped").length < 1 || states.length < 4) throw new Error(`sent rows: ${states.join(",")}`);
    const pills = await page.getByTestId("sent-pill").allInnerTexts();
    if (!pills.includes("Jake reviewed") || !pills.includes("Sent") || !pills.includes("Skipped")) throw new Error(`pills: ${pills.join(",")}`);
    if (!(await page.getByTestId("sent-reports-card").innerText()).includes("Jake replied")) throw new Error("the reply pill");
    // The pills and times sit at the same x on every row.
    const xs = await page.getByTestId("sent-row").evaluateAll((els) => els.map((e) => [Math.round(e.querySelector("[data-col=sent]").getBoundingClientRect().left), Math.round(e.querySelector("[data-col=pill]").getBoundingClientRect().left)]));
    for (const x of xs) if (x.join(",") !== xs[0].join(",")) throw new Error(`sent columns shift: ${JSON.stringify(xs)}`);
    // Open the reviewed report with the reply.
    const replied = page.getByTestId("sent-row").filter({ hasText: "Jake replied" }).first();
    await replied.click();
    await page.getByTestId("sent-report-drawer").waitFor();
    const drawer = (await page.getByTestId("sent-report-drawer").innerText()).toLowerCase();
    for (const t of ["jake opened", "jake replied", "pinecrest loi", "hello jake,", "a sent report never changes."]) if (!drawer.includes(t)) throw new Error(`the drawer is missing ${t}`);
    await page.screenshot({ path: path.join(OUT, "flow-work-reports-open.png"), fullPage: true });
    await page.getByTestId("drawer-close").click();
    // Today's sent report opens with the edited line.
    await page.getByTestId("sent-row").first().click();
    await page.getByTestId("sent-report-drawer").waitFor();
    if (!(await page.getByTestId("sent-html").innerText()).includes("one line added by hand")) throw new Error("today's report as sent");
    await page.getByTestId("drawer-close").click();
    // Find narrows; Collapse all flips.
    await page.getByTestId("reports-search").fill("Pinecrest");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=sent-row]").length === 1);
    await page.getByTestId("reports-search").fill("");
    await page.getByTestId("collapse-all").click();
    if ((await page.getByTestId("collapse-all").getAttribute("data-state")) !== "collapsed" || (await page.getByTestId("sent-row").count()) !== 0) throw new Error("Collapse all");
    await page.getByTestId("collapse-all").click();
  });

  await step("Batch C: Ask AI on Targets (the three questions, an answer from the page), on End of day (the page pill offers the drafts; a sent day says so), on Reports (What changed versus last week), all with the mock AI", async () => {
    await page.goto(`${BASE}/work/targets`);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    const pills = await page.getByTestId("ask-ai-pill").allInnerTexts();
    if (pills[0] !== "Which target am I missing most often?") throw new Error(`targets questions: ${pills.join("|")}`);
    await page.getByTestId("ask-ai-pill").first().click();
    await page.getByTestId("ask-ai-answer").waitFor({ timeout: 20000 });
    await page.getByTestId("drawer-close").click();
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    for (const t of ["ask-ai-reasons", "ask-ai-tomorrow", "ask-ai-short"]) if (!(await page.getByTestId(t).count())) throw new Error(`the End of day panel should offer ${t}`);
    if (!(await page.getByTestId("ask-ai-short").innerText()).includes("Today is already sent.")) throw new Error("a sent day says so in the panel");
    const eodPills = await page.getByTestId("ask-ai-pill").allInnerTexts();
    if (eodPills.join("|") !== "Draft the reasons for the missed commitments|Write tomorrow's line|Make the report shorter") throw new Error(`eod questions: ${eodPills.join("|")}`);
    await page.getByTestId("drawer-close").click();
    await page.goto(`${BASE}/work/reports`);
    await page.getByTestId("ask-ai").click();
    await page.getByTestId("ask-ai-panel").waitFor();
    if ((await page.getByTestId("ask-ai-pill").first().innerText()) !== "What changed versus last week?") throw new Error("reports questions");
    await page.getByTestId("ask-ai-pill").first().click();
    await page.getByTestId("ask-ai-answer").waitFor({ timeout: 20000 });
    await page.getByTestId("drawer-close").click();
    // The screens at 1280 and on the phone, after the send.
    await shoot3(`${BASE}/work/targets`, "work-targets");
    await shoot3(`${BASE}/work/end-of-day`, "work-end-of-day");
    await shoot3(`${BASE}/work/reports`, "work-reports");
    await shoot3(`${BASE}/work/reports?view=sent`, "work-reports-sent");
    await shoot3(`${BASE}/work`, "work-now");
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
    await page.goto(OLD_HOME);
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
    // Contacts are counted by the sample marker, not the name: the Work module's sample brokers carry the mockup's names.
    const demo = await one("select (select count(*)::int from accounts where name not like 'Sample %') a, (select count(*)::int from contacts c where not exists (select 1 from sample_records r where r.record_id = c.id)) c, (select count(*)::int from transactions t where not exists (select 1 from sample_records r where r.record_id = t.id)) t");
    await page.goto(`${BASE}/settings/data`);
    await page.getByTestId("sample-remove").click();
    await expectText(page, "Sample data removed:");
    const after = await one(`select (select count(*)::int from sample_records) marked,
      (select count(*)::int from accounts where name not like 'Sample %') a, (select count(*)::int from contacts) c, (select count(*)::int from transactions) t`);
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

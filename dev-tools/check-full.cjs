// LOCAL TESTING ONLY: the full check before launch, part A (Bram, 2026-11-07). It covers the pages and buttons the
// push checks (B, C, D, E, E2) and the page check do not: Screen listings (Pass, Interested, Add a listing), Rosara
// (weekly focus, add a project, its page), Job search and Consulting (add an item, its page, on Home), and the Settings
// pages (Profile, Work settings, Buy box, Email signature, AI, Export). It replaces dev-tools/check-flows.cjs, which
// tests pages of the app before the Work module (/plan, /opportunities, /records, /today) that no longer exist.
// Needs a fresh local database (dev-tools/setup-local-db.sh) and the built app with the stand-ins (start-local.sh).
const { chromium } = require("playwright");
const path = require("node:path");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
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

(async () => {
  await db.connect();
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
  const mainText = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");

  await step("Sample data is loaded and Google is connected through the stand-in", async () => {
    await open("/settings/data");
    if (!(await page.getByText("Sample data loaded").count()) && (await page.getByTestId("sample-load").count())) {
      const confirm = page.getByTestId("sample-confirm-real");
      if (await confirm.count()) await confirm.check();
      await page.getByTestId("sample-load").click();
      await page.getByText("Sample data loaded").first().waitFor({ timeout: 60000 });
    }
    await open("/api/google/connect");
    assert(/google=connected|settings/.test(page.url()), `Google connect went to ${page.url()}`);
  });

  // ---------- Screen listings ----------
  let passedName = "";
  let interestedName = "";
  await step("Screen listings: Pass with a reason moves the listing to Passed with that reason", async () => {
    await open("/work/listings");
    const row = page.getByTestId("listing-row").first();
    await row.waitFor();
    passedName = (await row.getByTestId("listing-name-button").innerText()).trim();
    await row.getByTestId("pass-button").click();
    await page.getByTestId("pass-reason-too_small").click();
    await row.getByTestId("listing-result").waitFor({ timeout: 15000 });
    await open("/work/listings");
    // The Passed section starts closed: open it.
    const card = page.getByTestId("passed-card");
    if ((await card.getAttribute("data-collapsed")) === "1") await card.getByRole("button").first().click();
    const passed = page.getByTestId("passed-row").filter({ hasText: passedName });
    await until(async () => (await passed.count()) === 1, `"${passedName}" is not under Passed`);
    assert((await passed.innerText()).includes("Too small") || (await page.getByTestId("passed-card").innerText()).includes("Too small"), "the reason Too small is not shown");
    assert((await page.getByTestId("listing-row").filter({ hasText: passedName }).count()) === 0, "the passed listing is still to screen");
    const r = await one("select screened, status, pass_reason from pipeline_items where name = $1 or company_name = $1 limit 1", [passedName]);
    assert(r && r.pass_reason, `no pass reason saved: ${JSON.stringify(r)}`);
  });

  await step("Screen listings: Interested moves the listing onto Deals", async () => {
    await open("/work/listings");
    const row = page.getByTestId("listing-row").first();
    await row.waitFor();
    interestedName = (await row.getByTestId("listing-name-button").innerText()).trim();
    await row.getByTestId("interested-button").click();
    await row.getByTestId("listing-result").waitFor({ timeout: 15000 });
    await open("/work/deals");
    await until(async () => (await mainText()).includes(interestedName), `"${interestedName}" is not on Deals`);
  });

  await step("Screen listings: Add a listing saves it to screen, with its figures", async () => {
    await open("/work/listings?add=1");
    await page.getByTestId("listing-name").fill("Check Valve Distributor");
    await page.getByTestId("listing-revenue").fill("4200000");
    await page.getByTestId("listing-earnings").fill("900000");
    await page.getByTestId("listing-location").fill("Charlotte, NC");
    await page.getByTestId("listing-save").click();
    await page.waitForURL(/saved=/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    const row = page.getByTestId("listing-row").filter({ hasText: "Check Valve Distributor" });
    await until(async () => (await row.count()) === 1, "the new listing is not to screen");
    assert((await row.getByTestId("listing-revenue-stat").innerText()).replace(/\s/g, "").includes("4.2M"), `revenue shows ${await row.getByTestId("listing-revenue-stat").innerText()}`);
  });

  // ---------- Rosara ----------
  await step("Rosara: the weekly focus saves and can be marked done", async () => {
    await open("/work/rosara");
    const input = page.getByTestId("weekly-focus-input");
    if (await input.count()) {
      await input.fill("Check: close two agency pilots");
      await page.getByTestId("weekly-focus-save").click();
      await page.getByTestId("weekly-focus-note").waitFor({ timeout: 15000 });
      await open("/work/rosara");
    }
    const r = await one("select value_text from inputs where key = 'rosara_weekly_focus'");
    assert(r && r.value_text, "no weekly focus saved");
    if (await page.getByTestId("weekly-focus-mark-done").count()) {
      await page.getByTestId("weekly-focus-mark-done").click();
      await page.getByTestId("weekly-focus-done").waitFor({ timeout: 15000 });
    } else assert(await page.getByTestId("weekly-focus-done").count(), "neither Mark done nor Done shows");
  });

  let projectHref = "";
  await step("Rosara: Add a project shows it with its first next action, and its page opens", async () => {
    await open("/work/rosara");
    await page.getByTestId("add-project-button").click();
    await page.getByTestId("project-name").fill("Check project: referral program");
    await page.getByTestId("project-nextAction").fill("Draft the referral offer");
    await page.getByTestId("project-save").click();
    const row = page.getByTestId("project-row").filter({ hasText: "Check project: referral program" });
    await until(async () => (await row.count()) >= 1, "the new project is not listed");
    assert((await row.first().innerText()).includes("Draft the referral offer"), "the first next action is not on its row");
    projectHref = (await row.first().getByTestId("project-link").getAttribute("href")) || "";
    assert(/\/work\/rosara\/[0-9a-f-]{36}/.test(projectHref), `project link: ${projectHref}`);
    await open(projectHref);
    assert((await mainText()).includes("Check project: referral program"), "the project page does not show its name");
  });

  // ---------- Job search and Consulting ----------
  await step("Job search: Add an opportunity opens its page and it shows on the board and on Home", async () => {
    await open("/work/jobs?add=1");
    await page.getByTestId("opp-company").fill("Check Logistics");
    await page.getByTestId("opp-role").fill("Chief Operating Officer");
    await page.getByTestId("opp-nextAction").fill("Email the Check Logistics recruiter");
    // Due today, so it is on Home (items due later stay on their board).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await page.getByTestId("opp-due").fill(today);
    await page.getByTestId("opp-save").click();
    await page.waitForURL(/\/work\/jobs\/[0-9a-f-]{36}/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    assert((await mainText()).includes("Check Logistics"), "the item page does not show the company");
    await open("/work/jobs");
    await until(async () => (await mainText()).includes("Check Logistics"), "not on the Job search board");
    await open("/work");
    await page.getByTestId("now-actions").waitFor();
    await until(async () => (await page.getByTestId("now-actions").innerText()).includes("Email the Check Logistics recruiter"), "its next action is not on Home");
  });

  await step("Consulting: Add a lead opens its page and it shows on the board", async () => {
    await open("/work/consulting?add=1");
    await page.getByTestId("lead-client").fill("Check Clinic Group");
    await page.getByTestId("lead-project").fill("Scheduling review");
    await page.getByTestId("lead-nextAction").fill("Send the scheduling review outline");
    await page.getByTestId("lead-save").click();
    await page.waitForURL(/\/work\/consulting\/[0-9a-f-]{36}/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    assert((await mainText()).includes("Check Clinic Group"), "the item page does not show the client");
    await open("/work/consulting");
    await until(async () => (await mainText()).includes("Check Clinic Group"), "not on the Consulting board");
  });

  // ---------- Settings ----------
  await step("Settings, Profile: the Name saves and stays after a reload", async () => {
    await open("/settings/profile");
    const name = page.locator('input[name="display_name"]');
    await name.fill("Check Owner");
    await page.locator("main form").getByRole("button").last().click();
    await page.waitForLoadState("networkidle");
    await until(async () => (await one("select display_name from owner_profile limit 1"))?.display_name === "Check Owner", "the Name is not saved");
    await open("/settings/profile");
    assert((await name.inputValue()) === "Check Owner", `the field shows ${await name.inputValue()}`);
  });

  await step("Settings, Work settings: the waiting threshold saves, and Home's Waiting card follows it", async () => {
    await open("/settings");
    await page.getByTestId("work-threshold").fill("6");
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    await open("/work");
    await page.getByTestId("now-wait").waitFor();
    await until(async () => /6\+ DAYS/i.test(await page.getByTestId("now-wait").innerText()), `the Waiting card shows: ${(await page.getByTestId("now-wait").innerText()).slice(0, 120)}`);
    await open("/settings");
    await page.getByTestId("work-threshold").fill("5");
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    await open("/work");
    await page.getByTestId("now-wait").waitFor();
    await until(async () => /5\+ DAYS/i.test(await page.getByTestId("now-wait").innerText()), "the Waiting card did not go back to 5+ days");
  });

  await step("Settings, Buy box: the page shows the form and Save answers", async () => {
    await open("/settings/buy-box");
    await page.getByTestId("buy-box-form").waitFor();
    const industries = page.getByTestId("buy-box-industries");
    const before = await industries.inputValue();
    await industries.fill(before ? `${before}, check` : "Distribution");
    await page.getByTestId("buy-box-save").click();
    await page.getByTestId("buy-box-note").waitFor({ timeout: 15000 });
    await open("/settings/buy-box");
    assert((await page.getByTestId("buy-box-industries").inputValue()) !== before, "the change did not stay after a reload");
  });

  await step("Settings, Email, AI and Export: each page shows its main part", async () => {
    await open("/settings/email");
    assert((await page.getByTestId("signature-card").count()) + (await page.getByTestId("signature-db-update").count()) > 0, "no signature card");
    await open("/settings/ai");
    assert((await mainText()).includes("AI usage"), "no AI usage page");
    await open("/settings");
    assert(await page.getByTestId("ai-cap-input").count(), "no AI limit field in Settings");
    await open("/settings/export");
    assert(await page.getByTestId("settings-export-download").count(), "no Download full export");
  });

  await step("No page showed an error in the browser", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join("\n"));
  });

  await browser.close();
  await db.end();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

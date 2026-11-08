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
const GOOGLE = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
const g = (p, body) => fetch(`${GOOGLE}${p}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());

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
    await page.getByTestId("home-right").getByTestId("now-wait").waitFor();
    await until(async () => /6\+ DAYS/i.test(await page.getByTestId("home-right").getByTestId("now-wait").innerText()), `the Waiting card shows: ${(await page.getByTestId("home-right").getByTestId("now-wait").innerText()).slice(0, 120)}`);
    await open("/settings");
    await page.getByTestId("work-threshold").fill("5");
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    await open("/work");
    await page.getByTestId("home-right").getByTestId("now-wait").waitFor();
    await until(async () => /5\+ DAYS/i.test(await page.getByTestId("home-right").getByTestId("now-wait").innerText()), "the Waiting card did not go back to 5+ days");
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

  // ---------- One report window (Bram, 2026-11-07 design A; 2026-11-08 one window, Also send to, carried-over edits) ----------
  const rw = () => page.getByTestId("report-window");
  const sec = (key) => rw().locator(`[data-testid=report-section][data-section=${key}]`);
  const sendFromWindow = async () => {
    await rw().getByTestId("report-window-send").click();
    const anyway = page.getByTestId("send-check-anyway");
    await Promise.race([anyway.waitFor({ timeout: 20000 }).then(() => anyway.click()), page.getByTestId("sent-line").waitFor({ timeout: 20000 }), until(async () => /Sent (to|the report of)/.test(await rw().getByTestId("report-window-note").innerText()), "x", 80)]).catch(() => {});
  };
  let saved = "";
  let someone = null;
  await step("Send a report (End of day card) opens the one report window: Which report (today), the note box, Also send to open; the review has Change, Edit and + Note", async () => {
    await open("/work/end-of-day");
    await page.getByTestId("send-a-report").first().click();
    await rw().getByTestId("report-also-picker").waitFor({ timeout: 20000 });
    assert((await rw().getByTestId("report-day-select").inputValue()).match(/^\d{4}-\d{2}-\d{2}$/), "no day chosen");
    assert(await rw().getByTestId("report-intro").count(), "no note box");
    assert((await sec("targets").getByTestId("section-edit").count()) && (await sec("targets").getByTestId("section-note-open").count()), "no Edit or + Note");
  });

  await step("Sending only to people under Also send to (partner unticked) sends them the report with the note, the section note and the edit, and the day stays open; the edit and the note stay in today's draft", async () => {
    const before = (await g("/__sent")).length;
    someone = await one("select id, name, email from contacts where email like '%@%.%' and archived_at is null and coalesce(outreach_role, '') <> 'accountability_partner' order by name limit 1");
    const picker = rw().getByTestId("report-also-picker");
    await picker.getByTestId("send-report-search").fill(someone.name.split(" ")[0]);
    await picker.getByTestId("send-report-match").filter({ hasText: someone.email }).first().click();
    saved = `advisor-${Date.now()}@example.com`;
    await picker.getByTestId("send-report-new-email").fill(saved);
    await picker.getByTestId("send-report-new-name").fill("Avery Advisor");
    await picker.getByTestId("send-report-new-add").click();
    await picker.getByTestId("send-report-new-save").uncheck();
    await picker.getByTestId("send-report-new-email").fill("just-once@example.com");
    await picker.getByTestId("send-report-new-add").click();
    assert((await picker.getByTestId("send-report-chip").count()) === 3, `${await picker.getByTestId("send-report-chip").count()} people chosen`);
    // Jake unticked for now: only the people added get it.
    await rw().locator("[data-testid=report-send-to-partner][data-partner=Jake] input").uncheck();
    await sec("targets").getByTestId("section-note-open").click();
    await sec("targets").getByTestId("section-note-text").fill("A note for the midday send.");
    await sec("targets").getByTestId("section-note-save").click();
    await sec("tomorrow").getByTestId("section-edit").click();
    await sec("tomorrow").getByTestId("section-edit-text").fill("Tomorrow, rewritten at midday.");
    await sec("tomorrow").getByTestId("section-edit-save").click();
    await rw().getByTestId("report-intro").fill("Avery, this is the daily report I mentioned.");
    await until(async () => (await rw().getByTestId("report-preview").innerText()).includes("this is the daily report I mentioned"), "the preview does not show the note under the greeting");
    await until(async () => /Send to 3 people/.test(await rw().getByTestId("report-window-send").innerText()), `the button reads ${await rw().getByTestId("report-window-send").innerText()}`);
    await sendFromWindow();
    await until(async () => /Sent to/.test(await rw().getByTestId("report-window-note").innerText()), "no sent line in the window", 120);
    const mails = (await g("/__sent")).slice(before);
    assert(mails.length === 3, `${mails.length} emails sent`);
    for (const a of [someone.email, saved, "just-once@example.com"]) assert(mails.some((m) => String(m.to).includes(a)), `no email to ${a}`);
    for (const m of mails) for (const t of ["this is the daily report I mentioned", "A note for the midday send.", "Tomorrow, rewritten at midday."]) assert(String(m.body).includes(t) && String(m.html).includes(t), `an email lacks "${t}"`);
    assert(/Hello Avery,/.test(String(mails.find((m) => String(m.to).includes(saved)).body)), "the greeting does not use the new person's first name");
    assert((await one("select count(*)::int n from contacts where email = $1", [saved])).n === 1, "the new address was not saved as a contact");
    assert((await one("select count(*)::int n from contacts where email = 'just-once@example.com'")).n === 0, "the address sent only was saved as a contact");
    const eod = await one("select status, report_edits::text e from end_of_day where day = (select max(day) from end_of_day)");
    assert(eod.status === "open", `the day is ${eod.status}`);
    assert(eod.e.includes("A note for the midday send.") && eod.e.includes("rewritten at midday") && eod.e.includes("_edited_at"), "the edit and the note are not in today's draft");
    assert((await one("select count(*)::int n from communications where direction = 'outgoing' and contact_id = (select id from contacts where email = $1)", [saved])).n >= 1, "the send is not on the new contact's timeline");
  });

  await step("Carried over: reopened later, the note and the edit saved before that send are outlined amber with 'before the report went out'; closing with changes to an earlier day asks Discard first", async () => {
    await open("/work/end-of-day");
    await page.getByTestId("report-view").click();
    await rw().locator("[data-testid=report-send-to-partner][data-partner=Jake] input").check();
    await until(async () => (await sec("targets").getAttribute("data-stale")) === "1" && (await sec("tomorrow").getAttribute("data-stale")) === "1", "the carried-over sections are not marked");
    assert((await sec("tomorrow").getByTestId("section-stale").innerText()).includes("before the report went out"), await sec("tomorrow").getByTestId("section-stale").innerText());
    // Today's people and note are saved with the day (2026-11-08), so only an earlier day's changes ask before closing.
    const earlierDay = (await one("select day::text as d from end_of_day where status = 'sent' and day < (select max(day) from end_of_day) order by day desc limit 1")).d;
    await until(async () => (await rw().locator(`[data-testid=report-day-select] option[value="${earlierDay}"]`).count()) === 1, "the earlier day is not in Which report");
    await rw().getByTestId("report-day-select").selectOption(earlierDay);
    await rw().getByTestId("report-past-picker").getByTestId("send-report-new-email").fill("left-here@example.com");
    await rw().getByTestId("report-past-picker").getByTestId("send-report-new-add").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("discard-warning").waitFor();
    await page.getByTestId("discard-keep").click();
    assert(await rw().isVisible(), "Keep editing closed the window");
    await rw().getByTestId("report-window-close").click();
    await page.getByTestId("discard-yes").click();
    await until(async () => !(await rw().count()) || !(await rw().isVisible()), "Discard did not close the window");
  });

  await step("Also send to: a new address added under the partner boxes gets the open tab's copy right after Approve and send (which closes the day); the card names them first", async () => {
    await open("/work/end-of-day");
    await page.getByTestId("report-view").click();
    await rw().getByTestId("report-also").waitFor({ timeout: 15000 });
    assert((await rw().getByTestId("report-also-names").innerText()).includes("Nobody else"), "someone is already on Also send to");
    await rw().getByTestId("report-also-open").click();
    const picker = rw().getByTestId("report-also-picker");
    await picker.waitFor({ timeout: 20000 });
    // A partner already on today's report is not offered again; one not due today (Sarah on a Thursday) can be added.
    assert(!(await picker.getByTestId("send-report-partner").filter({ hasText: "Jake Morgan" }).count()), "Jake (on today's report) shows again in Also send to");
    await picker.getByTestId("send-report-new-email").fill("also-once@example.com");
    await picker.getByTestId("send-report-new-name").fill("Morgan Also");
    await picker.getByTestId("send-report-new-save").uncheck();
    await picker.getByTestId("send-report-new-add").click();
    await rw().getByTestId("report-also-open").click();
    assert((await rw().getByTestId("report-also-names").innerText()).includes("Morgan Also"), "the name is not on the Also send to line");
    const before = (await g("/__sent")).length;
    await sendFromWindow();
    await page.getByTestId("sent-line").waitFor({ timeout: 60000 });
    await until(async () => (await page.getByTestId("sent-line").innerText()).includes("Also sent to Morgan Also"), "the sent line does not name Morgan Also", 120);
    const mails = (await g("/__sent")).slice(before);
    const extra = mails.find((m) => String(m.to).includes("also-once@example.com"));
    assert(extra && /Hello Morgan,/.test(String(extra.body)), `no copy for the extra person: ${mails.map((m) => m.to)}`);
    assert(mails.some((m) => String(m.to).includes("jake.morgan")), "Jake did not get the report");
    assert((await one("select status from end_of_day where day = (select max(day) from end_of_day)")).status === "sent", "Approve and send did not close the day");
  });

  await step("Which report: an earlier sent day, sent again to a contact, goes out and changes nothing about that day; Reports' Send a report opens the same window", async () => {
    const earlier = await one("select day::text as d, sent_at::text as sent_at, report_id from end_of_day where status = 'sent' and day < (select max(day) from end_of_day) order by day desc limit 1");
    assert(earlier, "no earlier sent day in the sample");
    await open("/work/reports");
    await page.getByTestId("send-a-report").first().click();
    await page.waitForURL(/end-of-day\?send=1/);
    await rw().getByTestId("report-day-select").waitFor({ timeout: 20000 });
    await until(async () => (await rw().locator(`[data-testid=report-day-select] option[value="${earlier.d}"]`).count()) === 1, "the earlier day is not in Which report");
    await rw().getByTestId("report-day-select").selectOption(earlier.d);
    const picker = rw().getByTestId("report-past-picker");
    await picker.waitFor({ timeout: 20000 });
    await picker.getByTestId("send-report-new-email").fill(saved);
    await picker.getByTestId("send-report-new-add").click();
    await rw().getByTestId("report-preview").waitFor({ timeout: 20000 });
    const before = (await g("/__sent")).length;
    await rw().getByTestId("report-window-send").click();
    await until(async () => /Sent the report of/.test(await rw().getByTestId("report-window-note").innerText()), "no sent line for the earlier day", 120);
    assert((await g("/__sent")).length === before + 1, "the earlier report was not sent");
    const after = await one("select day::text as d, sent_at::text as sent_at, report_id from end_of_day where day = $1", [earlier.d]);
    assert(after.sent_at === earlier.sent_at && after.report_id === earlier.report_id, "the earlier day changed");
    assert((await one("select count(*)::int n from partner_reports where period_start = $1 and (snapshot->>'resend')::boolean", [earlier.d])).n === 1, "the resend is not kept as a copy");
  });

  // ---------- The work week (Bram, 2026-11-07, design B). The app runs on a Thursday clock. ----------
  const workWeek = async (days, review) => {
    await open("/settings");
    const card = page.getByTestId("work-settings");
    await card.waitFor();
    for (let n = 1; n <= 7; n++) {
      const box = card.locator(`[data-testid=work-day][data-day="${n}"] input`);
      if ((await box.isChecked()) !== days.includes(n)) await box.click();
    }
    await card.getByTestId("work-review-day").selectOption(String(review));
    await card.getByTestId("work-settings-save").click();
    await card.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    assert((await card.getByTestId("work-settings-note").innerText()).includes("Saved"), await card.getByTestId("work-settings-note").innerText());
  };
  await step("Settings, Work settings: Work days (Mon to Fri ticked), Week starts on Monday, Weekly review day Friday; Profile no longer has the review day", async () => {
    await open("/settings");
    const card = page.getByTestId("work-settings");
    await card.waitFor();
    const ticked = [];
    for (let n = 1; n <= 7; n++) if (await card.locator(`[data-testid=work-day][data-day="${n}"] input`).isChecked()) ticked.push(n);
    assert(JSON.stringify(ticked) === "[1,2,3,4,5]", `ticked ${ticked}`);
    assert((await card.getByTestId("work-week-start").inputValue()) === "1", "the week does not start Monday");
    assert((await card.getByTestId("work-review-day").inputValue()) === "5", "the review day is not Friday");
    await open("/settings/profile");
    assert(!(await page.locator("select[name=weekly_review_weekday]").count()), "Profile still has the review day");
  });

  await step("Work week Mon to Sat with the review on Thursday: today (Thursday) shows the Weekly review, the week is judged Saturday, the strip reads Mon to Sat, a new partner day can be Saturday", async () => {
    await workWeek([1, 2, 3, 4, 5, 6], 4);
    const p = await one("select work_days::text d, weekly_review_weekday r, week_start s from owner_profile limit 1");
    assert(p.d === "{1,2,3,4,5,6}" && p.r === 4 && p.s === 1, JSON.stringify(p));
    await open("/work/end-of-day");
    await page.getByTestId("eod-review").waitFor({ timeout: 15000 });
    assert((await page.getByTestId("eod-review").innerText()).includes("Thursdays. Goes into Thursday's report."), "the review card does not name Thursday");
    assert((await page.getByTestId("eod-targets-note").innerText()).includes("judged on Saturday"), await page.getByTestId("eod-targets-note").innerText());
    await open("/work/targets");
    assert((await page.getByTestId("target-strip").first().innerText()).includes("Mon to Sat"), await page.getByTestId("target-strip").first().innerText());
  });

  await step("Back to Mon to Fri with the review on Friday: no Weekly review on Thursday, the week is judged Friday", async () => {
    await workWeek([1, 2, 3, 4, 5], 5);
    await open("/work/end-of-day");
    await page.getByTestId("eod-targets-note").waitFor();
    assert(!(await page.getByTestId("eod-review").count()), "the review card still shows on Thursday");
    assert((await page.getByTestId("eod-targets-note").innerText()).includes("judged on Friday"), await page.getByTestId("eod-targets-note").innerText());
    await open("/work/targets");
    assert((await page.getByTestId("target-strip").first().innerText()).includes("Mon to Fri"), "the strip does not read Mon to Fri");
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

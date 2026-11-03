// LOCAL TESTING ONLY. Click-through checks of push B (People, Organizations, partner reports, Gmail replies) against
// the local stand-ins. Best run on a Friday clock, so both sample partners are due (dev-tools/push-b-friday.sh does
// that); on another weekday the checks that need two partners are skipped with a note.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-push-b.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
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
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
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
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
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
    assert(page.url().includes("google=connected"), `connect result ${page.url()}`);
    const conn = await one("select scopes from google_connections");
    assert(conn.scopes.includes("gmail.readonly"), "the read permission is saved");
  });

  await step("Old Outreach addresses go to People", async () => {
    await page.goto(`${BASE}/work/outreach?add=1`);
    assert(new URL(page.url()).pathname === "/work/people" && page.url().includes("add=1"), page.url());
    const mark = await one("select id from contacts where name = 'Mark Reed'");
    await page.goto(`${BASE}/work/outreach/${mark.id}`);
    assert(page.url().endsWith(`/work/people/${mark.id}`), page.url());
    await page.getByRole("heading", { name: "Mark Reed" }).waitFor();
  });

  await step("Contacts: the tab, the three views, the Filter window by role and by kind", async () => {
    await page.goto(`${BASE}/work/people`);
    assert((await page.getByTestId("work-tab-work-people").innerText()).startsWith("Contacts"), "tab label");
    assert((await page.locator("nav[aria-label='Work sections']").innerText()).includes("Contacts"), "no Contacts tab");
    assert(!(await page.locator("nav[aria-label='Work sections']").innerText()).includes("Outreach"), "Outreach tab still there");
    await page.getByTestId("outreach-card").waitFor();
    assert(!(await page.getByTestId("outreach-card").innerText()).includes("Jake Morgan"), "a partner without a follow-up sits on Follow-ups");
    await page.getByTestId("people-view-people").click();
    await page.getByTestId("everyone-card").waitFor();
    const n = await page.getByTestId("everyone-row").count();
    assert(n === (await one("select count(*)::int n from contacts where archived_at is null")).n, `everyone rows ${n}`);
    await page.getByTestId("filter-open").click();
    await page.locator("#fo-role-accountability_partner").check();
    await page.getByTestId("filter-show").click();
    const names = await page.getByTestId("everyone-row").allInnerTexts();
    assert(names.length === 2 && names[0].includes("Jake Morgan") && names[1].includes("Sarah Klein") && names.every((t) => t.includes("Gets reports")), names.join(" | "));
    assert((await page.getByTestId("filter-open").innerText()).includes("Filter · 1"), "Filter · 1");
    await page.getByTestId("people-view-orgs").click();
    await page.getByTestId("orgs-card").waitFor();
    await page.getByTestId("filter-open").click();
    await page.locator("#fo-kind-broker").check();
    await page.getByTestId("filter-show").click();
    const orgs = await page.getByTestId("org-row").allInnerTexts();
    assert(orgs.length === 4 && orgs.some((t) => t.includes("Transworld Business Advisors") && t.includes("Mark Reed, Rachel Kim")), orgs.join(" | "));
    await shot(page, "people-organizations-1440.png");
  });

  await step("Add an organization from Organizations: it opens its new page", async () => {
    await page.goto(`${BASE}/work/people?view=orgs&add=1`);
    await page.getByTestId("org-name").fill("Peak Capital");
    await page.getByTestId("org-kind").selectOption("lender");
    await page.getByTestId("org-region").fill("Charlotte, NC");
    await page.getByTestId("org-save").click();
    await page.waitForURL(/\/work\/people\/organizations\//);
    await page.getByRole("heading", { name: "Peak Capital" }).waitFor();
    const o = await one("select kind, region from organizations where name = 'Peak Capital'");
    assert(o && o.kind === "lender" && o.region === "Charlotte, NC", JSON.stringify(o));
  });

  await step("Organization page: people, next action, tasks, facts, deals, timeline; add a person, a task, a note; Later", async () => {
    const tw = await one("select id from organizations where name = 'Transworld Business Advisors'");
    await page.goto(`${BASE}/work/people/organizations/${tw.id}`);
    const people = await page.getByTestId("org-person-row").allInnerTexts();
    assert(people.length === 2 && people[0].includes("Mark Reed"), people.join(" | "));
    assert((await page.getByTestId("org-deal-row").count()) >= 3, "deals from this firm");
    assert((await page.getByTestId("org-next-action-input").inputValue()) === "Ask for their full East Tennessee listing sheet", "next action");
    await shot(page, "organization-page-1440.png");
    await page.getByTestId("org-add-person").click();
    await page.getByTestId("org-new-person").fill("Pat Example");
    await page.getByTestId("org-add-person-save").click();
    await page.getByText("Pat Example").first().waitFor();
    const pat = await one("select organization_id, outreach_role from contacts where name = 'Pat Example'");
    assert(pat.organization_id === tw.id && pat.outreach_role === "broker", JSON.stringify(pat));
    await page.getByTestId("org-tasks").getByTestId("todo-add").click();
    await page.getByTestId("org-tasks").getByTestId("todo-input").fill("Call Transworld about spring listings");
    await page.getByTestId("org-tasks").getByTestId("todo-save").click();
    await page.getByText("Call Transworld about spring listings").waitFor();
    assert((await one("select count(*)::int n from deal_todos where record_type = 'organizations' and record_id = $1", [tw.id])).n === 4, "task saved");
    await page.getByTestId("org-note").fill("Mark is out until the 12th.");
    await page.getByTestId("org-note-save").click();
    await page.getByText("Mark is out until the 12th.").waitFor();
    const dueBefore = (await one("select next_action_due::text d from organizations where id = $1", [tw.id])).d;
    await page.getByTestId("org-next-later").click();
    await page.getByTestId("org-later-choice").getByRole("button", { name: "Tomorrow" }).click();
    await page.getByTestId("org-next-result").waitFor();
    const due = await one("select next_action_due::text d from organizations where id = $1", [tw.id]);
    assert(due.d && due.d !== dueBefore, `later ${dueBefore} to ${due.d}`);
  });

  await step("Partner page: the Reports card in place of Why in touch; days and sections save at once", async () => {
    const jake = await one("select id from contacts where name = 'Jake Morgan'");
    await page.goto(`${BASE}/work/people/${jake.id}`);
    await page.getByTestId("partner-reports-card").waitFor();
    assert((await page.getByTestId("person-why").count()) === 0, "Why in touch still shows");
    await shot(page, "partner-page-jake-1440.png");
    await page.locator("[data-testid=partner-day][data-day='3']").click();
    await page.getByTestId("partner-saved").waitFor();
    let c = await one("select report_days, report_sections from contacts where id = $1", [jake.id]);
    assert(JSON.stringify(c.report_days) === "[1,2,4,5]", `days ${JSON.stringify(c.report_days)}`);
    await page.locator("[data-testid=partner-day][data-day='3']").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=partner-day][data-day='3']")?.getAttribute("data-on") === "1");
    await page.getByTestId("partner-section-jobs").uncheck();
    await page.waitForTimeout(800);
    c = await one("select report_days, report_sections from contacts where id = $1", [jake.id]);
    assert(JSON.stringify(c.report_days) === "[1,2,3,4,5]" && !c.report_sections.includes("jobs") && c.report_sections.includes("top"), JSON.stringify(c));
    await page.getByTestId("partner-section-jobs").check();
    await page.waitForTimeout(800);
  });

  const weekday = (await one("select extract(isodow from (now() at time zone 'America/New_York'))::int d")).d;
  const friday = Number(process.env.FAKE_ISODOW || 0) === 5 || (!process.env.FAKETIME && weekday === 5) || process.env.FAKE_ISODOW === "5";

  await step("End of day on a Friday: a copy per partner with the To choice, each with only their sections; Approve and send to 2", async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-card").waitFor();
    const n = Number(await page.getByTestId("report-send").getAttribute("data-count"));
    if (!friday) {
      console.log(`     (not a Friday on this clock: ${n} partner due; run dev-tools/push-b-friday.sh for the two-partner send)`);
      return;
    }
    assert(n === 2 && (await page.getByTestId("report-send").innerText()) === "Approve and send to 2", `send button ${n}`);
    assert((await page.getByTestId("report-due-line").innerText()) === "Jake gets weekdays; Sarah gets Fridays", await page.getByTestId("report-due-line").innerText());
    assert((await page.getByTestId("report-card").innerText()).includes("Reports to Jake and Sarah"), "card title");
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    assert((await page.getByTestId("report-tab").count()) === 2, "a tab per partner");
    const jakeText = await page.getByTestId("report-preview").innerText();
    assert(jakeText.includes("Hello Jake,") && /TODAY/i.test(jakeText) && /TOP 3 DEALS/i.test(jakeText), "Jake's copy");
    const included = async () => page.$$eval("[data-testid=report-section]", (els) => els.filter((e) => e.getAttribute("data-included") === "1").map((e) => e.getAttribute("data-section")));
    // Jake, today only: Job search left out, a different deal in the top 3, Waiting on brokers rewritten.
    const sec = (k) => page.locator(`[data-testid=report-section][data-section=${k}]`);
    await sec("jobs").getByTestId("section-include").uncheck();
    await sec("top").getByTestId("section-change").click();
    const offTop = sec("top").locator("[data-testid=picker-option][data-on='0']").first();
    const swapIn = await offTop.getAttribute("data-id");
    await sec("top").locator("[data-testid=picker-option][data-on='1']").first().locator("input").uncheck();
    await sec("top").locator(`[data-testid=picker-option][data-id='${swapIn}'] input`).check();
    await sec("top").getByTestId("picker-done").click();
    await sec("waiting").getByTestId("section-edit").click();
    await sec("waiting").getByTestId("section-edit-text").fill("Waiting on brokers\n  - Summit: Mark owes the seller call date");
    await sec("waiting").getByTestId("section-edit-save").click();
    await page.waitForTimeout(1500);
    const jakeId = (await one("select id from contacts where name = 'Jake Morgan'")).id;
    const saved = (await one("select report_edits from end_of_day order by day desc limit 1")).report_edits[jakeId];
    assert(saved && saved.include && saved.include.jobs === false && saved.top && saved.top.includes(swapIn) && saved.edits && saved.edits.waiting.includes("Mark owes"), `saved choices ${JSON.stringify(saved)}`);
    const swapName = await one("select coalesce(company_name, name) n from pipeline_items where id = $1", [swapIn]);
    await page.locator("[data-testid=report-tab][data-partner=Sarah]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hello Sarah,"));
    const sarahIn = await included();
    assert(JSON.stringify(sarahIn) === JSON.stringify(["targets", "week", "tomorrow"]), `Sarah's standing sections ${JSON.stringify(sarahIn)}`);
    // Sarah, today only: Top 3 deals added.
    await sec("top").getByTestId("section-include").check();
    await page.waitForTimeout(1500);
    await shot(page, "end-of-day-friday-sarah-1440.png");
    await page.getByTestId("report-window-close").click();
    await page.getByTestId("report-send").click();
    const check = page.getByTestId("send-check-anyway");
    await Promise.race([check.waitFor({ timeout: 15000 }).then(() => check.click()), page.getByTestId("sent-line").waitFor({ timeout: 15000 })]).catch(() => {});
    await page.getByTestId("sent-line").waitFor({ timeout: 30000 });
    const sent = await g("/__sent");
    const reports = sent.filter((m) => /Daily report/.test(m.subject));
    assert(reports.length === 2 && reports.some((m) => m.to.includes("jake.morgan")) && reports.some((m) => m.to.includes("sarah.klein")), JSON.stringify(reports.map((m) => m.to)));
    const sarahMail = reports.find((m) => m.to.includes("sarah.klein"));
    assert(sarahMail.body.includes("Hello Sarah,") && !sarahMail.body.includes("TODAY") && !sarahMail.body.includes("WAITING ON BROKERS") && sarahMail.body.includes("TARGETS") && sarahMail.body.includes("TOP 3 DEALS"), "Sarah's email has her sections and today's Top 3");
    const jakeMail = reports.find((m) => m.to.includes("jake.morgan"));
    assert(!jakeMail.body.includes("JOB SEARCH") && jakeMail.body.includes("Mark owes the seller call date") && jakeMail.body.includes(swapName.n), "Jake's email has today's choices");
    const rows = await all("select r.contact_id, r.gmail_thread_id, c.name from partner_reports r join contacts c on c.id = r.contact_id where r.period_start = (select max(day) from end_of_day where status = 'sent') and r.report_kind = 'end_of_day' order by c.name");
    assert(rows.length === 2 && rows.every((r) => r.gmail_thread_id && r.gmail_thread_id.startsWith("thread-")), JSON.stringify(rows));
    const comms = await all("select contact_id from communications where direction = 'outgoing' and partner_report_id in (select id from partner_reports where gmail_thread_id like 'thread-%')");
    assert(comms.length === 2, `communications ${comms.length}`);
    const logs = await one("select count(*)::int n from change_log where field = 'email_sent' and new_value->>'kind' = 'end_of_day'");
    assert(logs.n === 2, `change log ${logs.n}`);
    await shot(page, "end-of-day-friday-sent-1440.png");
  });

  await step("A second press does not send again (the same click, and a new page)", async () => {
    if (!friday) return;
    const before = (await g("/__sent")).length;
    await page.goto(`${BASE}/work/end-of-day`);
    assert(await page.getByTestId("report-send").isDisabled(), "the send button is off on a sent day");
    assert((await g("/__sent")).length === before, "an email went out again");
  });

  await step("A reply in Gmail shows on Reports (row and drawer) and on the partner's timeline, stored once", async () => {
    if (!friday) return;
    const r = await g("/__reply", { to: "sarah.klein@example.com", text: "Good week. What is the plan if Summit stalls again?" });
    assert(r.id, "reply queued");
    await db.query("update google_connections set replies_checked_at = null");
    await page.goto(`${BASE}/work/reports?view=sent`);
    const row = page.locator("[data-testid=sent-row]").first();
    await row.waitFor();
    assert((await row.innerText()).includes("What is the plan if Summit stalls again?"), `row: ${await row.innerText()}`);
    assert((await row.getByTestId("sent-pill").innerText()) === "Replied", "pill");
    const stored = await all("select contact_id, partner_report_id, awaiting_log from communications where gmail_message_id = $1", [r.id]);
    assert(stored.length === 1 && stored[0].partner_report_id && stored[0].awaiting_log === false, JSON.stringify(stored));
    // Looked again: the same reply is not stored twice.
    await db.query("update google_connections set replies_checked_at = null");
    await page.goto(`${BASE}/work/reports?view=sent`);
    await page.locator("[data-testid=sent-row]").first().waitFor();
    assert((await one("select count(*)::int n from communications where gmail_message_id = $1", [r.id])).n === 1, "stored twice");
    // Throttle: a page opening within a few minutes does not ask Gmail again.
    const reads = (await g("/__replies")).threadReads;
    await page.goto(`${BASE}/work`);
    assert((await g("/__replies")).threadReads === reads, "Gmail was asked again within five minutes");
    await page.goto(`${BASE}/work/reports?view=sent`);
    await page.locator("[data-testid=sent-row]").first().click();
    await page.getByTestId("sent-report-drawer").waitFor();
    assert((await page.getByTestId("sent-replies").innerText()).includes("What is the plan if Summit stalls again?"), "drawer reply");
    await shot(page, "reports-sent-reply-drawer-1440.png");
    const sarahReply = page.getByTestId("sent-reply").filter({ hasText: "Summit stalls again" });
    await sarahReply.getByTestId("reply-make-task").click();
    await page.getByTestId("reply-task-result").waitFor();
    const sarah = await one("select id from contacts where name = 'Sarah Klein'");
    const t = await one("select text from deal_todos where record_type = 'contacts' and record_id = $1 order by created_at desc limit 1", [sarah.id]);
    assert(t && t.text.startsWith("Answer Sarah's reply: Good week."), JSON.stringify(t));
    await sarahReply.getByTestId("reply-button").click();
    await page.getByTestId("compose-subject").waitFor();
    assert((await page.getByTestId("compose-subject").inputValue()).startsWith("Re: Daily report"), "reply subject");
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/work/people/${sarah.id}`);
    const tl = await page.getByTestId("person-timeline").innerText();
    assert(tl.includes("Reply to Friday's report") && tl.includes("Summit stalls again"), tl.slice(0, 300));
    await shot(page, "partner-page-sarah-timeline-1440.png");
  });

  await step("A reply to another email from the app waits on the person's Incoming card", async () => {
    const dana = await one("select id from contacts where name = 'Dana Whitfield'");
    await page.goto(`${BASE}/work/people/${dana.id}`);
    await page.getByTestId("person-page-email").click();
    await page.getByTestId("compose-subject").fill("Spring owners");
    await page.locator("[contenteditable=true]").first().fill("Any owners thinking about spring?");
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor({ timeout: 20000 });
    const r = await g("/__reply", { to: "dana.whitfield@example.com", text: "Two landscaping owners. Call me." });
    await db.query("update google_connections set replies_checked_at = null");
    await page.goto(`${BASE}/work`);
    await page.goto(`${BASE}/work/people/${dana.id}`);
    const inc = await page.getByTestId("person-incoming").innerText();
    assert(inc.includes("Two landscaping owners"), inc);
    const c = await one("select awaiting_log, partner_report_id from communications where gmail_message_id = $1", [r.id]);
    assert(c.awaiting_log === true && c.partner_report_id === null, JSON.stringify(c));
  });

  await step("Without the read permission: a plain Reconnect note, no error", async () => {
    const before = await one("select scopes from google_connections");
    await db.query("update google_connections set scopes = replace(scopes, ' https://www.googleapis.com/auth/gmail.readonly', ''), replies_checked_at = null");
    await page.goto(`${BASE}/work/reports?view=sent`);
    await page.getByTestId("replies-reconnect").waitFor();
    assert((await page.getByTestId("replies-reconnect").innerText()).includes("Reconnect Google to see replies"), "note");
    await page.goto(`${BASE}/settings`);
    await page.getByText("Reconnect Google to see replies to your reports and emails").waitFor();
    await db.query("update google_connections set scopes = $1", [before.scopes]);
  });

  await step("Remove sample data removes the sample people's reports, emails, and replies; real records stay", async () => {
    await page.goto(`${BASE}/settings/data`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sample-remove").click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /Remove/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
    await page.waitForFunction(async () => true);
    for (let i = 0; i < 40 && (await one("select count(*)::int n from sample_records")).n; i++) await page.waitForTimeout(500);
    const left = await one(`select (select count(*)::int from sample_records) s, (select count(*)::int from partner_reports) r, (select count(*)::int from communications where partner_report_id is not null or direction = 'incoming') c,
      (select string_agg(name, ',' order by name) from organizations) orgs, (select string_agg(name, ',' order by name) from contacts) people, (select count(*)::int from deal_todos) t`);
    assert(left.s === 0 && left.r === 0 && left.c === 0 && left.orgs === "Peak Capital" && left.people === "Pat Example", JSON.stringify(left));
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

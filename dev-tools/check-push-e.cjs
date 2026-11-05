// LOCAL TESTING ONLY. Click-through checks of push E against the local stand-ins: the Waiting on someone card with
// deals and people and the third group "No reply yet" (an email the app sent shows after N days and not before, a
// reply makes it go, Dismiss, Add to Waiting on a deal and on a person, the card counts, Show all), a person waited on
// (the person page's Next follow-up card and Follow up from the card), Replied and Clear, the No reply yet setting,
// and sample data load and remove. Replies come from the local Gmail stand-in (POST /__reply), as in check-push-b.
// Needs a fresh local database (dev-tools/setup-local-db.sh) and the built app with the stand-ins (dev-tools/start-local.sh).
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-push-e.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
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
const ny = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (process.env.FAKETIME) await ctx.clock.setSystemTime(Date.now());
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await g("/__reset", {});
  const today = ny();
  const shot = async (name, el = null) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await (el ?? page).screenshot({ path: path.join(SHOTS, name) });
  };

  // ---------- Helpers on the Waiting card ----------
  const card = () => page.getByTestId("now-wait");
  const group = (key) => card().locator(`[data-testid="home-section"][data-section="wait-${key}"]`);
  const openHome = async () => {
    await page.goto(`${BASE}/work`);
    await card().waitFor();
    await page.waitForLoadState("networkidle");
  };
  const openGroup = async (key) => {
    const s = group(key);
    if ((await s.getAttribute("data-collapsed")) === "1" && Number(await s.getByTestId("section-heading").getAttribute("data-count")) > 0) {
      await s.getByTestId("section-heading").click();
      await until(async () => (await s.getAttribute("data-collapsed")) === "0", `${key} opens`);
    }
  };
  const openAll = async () => {
    for (const k of ["over", "under", "no-reply"]) await openGroup(k);
  };
  const groupCount = async (key) => Number(await group(key).getByTestId("section-heading").getAttribute("data-count"));
  const cardCount = async () => Number((await card().locator("h2 .tabular").count()) ? await card().locator("h2 .tabular").innerText() : 0);
  const noReplyRow = (text) => group("no-reply").getByTestId("no-reply-row").filter({ hasText: text });
  const waitRow = (text) => card().getByTestId("waiting-row").filter({ hasText: text });
  const setting = async (n) => {
    await page.goto(`${BASE}/settings`);
    await page.getByTestId("work-no-reply").fill(String(n));
    await page.getByTestId("work-settings-save").click();
    await until(async () => (await one("select value_number::int n from inputs where key = 'no_reply_after_days'"))?.n === n, `setting saved as ${n}`);
  };
  /** Sends an email from a person page through the Gmail stand-in; returns the logged communication. */
  const sendFromPerson = async (name, subject, text) => {
    const p = await one("select id from contacts where name = $1", [name]);
    await page.goto(`${BASE}/work/people/${p.id}`);
    await page.getByTestId("person-page-email").click();
    await page.getByTestId("compose-subject").fill(subject);
    await page.locator("[contenteditable=true]").first().fill(text);
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor({ timeout: 20000 });
    const c = await one("select id, gmail_thread_id, occurred_at from communications where direction = 'outgoing' and subject = $1 and contact_id = $2", [subject, p.id]);
    assert(c && c.gmail_thread_id, `the email was logged with its thread: ${JSON.stringify(c)}`);
    return { ...c, contactId: p.id };
  };
  const backdate = (commId, days) => db.query("update communications set occurred_at = $2 where id = $1", [commId, `${addDays(today, -days)}T15:00:00Z`]);
  const lookForReplies = async () => {
    await db.query("update google_connections set replies_checked_at = null");
    await openHome();
  };

  await step("Sample data loads with the push E records; Google is connected through the stand-in", async () => {
    if ((await one("select count(*)::int n from sample_records")).n === 0) {
      await page.goto(`${BASE}/settings/data`);
      const c = page.getByTestId("sample-confirm-real");
      if (await c.count()) await c.check();
      await page.getByTestId("sample-load").click();
      await page.waitForSelector("text=Sample data loaded", { timeout: 90000 });
    }
    await page.goto(`${BASE}/api/google/connect`);
    await page.waitForURL(/\/settings\?google=/);
    const s = await one(`select
      (select waiting_on from contacts where name = 'Priya Natarajan') priya,
      (select c.subject from pipeline_items i join communications c on c.id = i.waiting_comm_id where i.name = 'Pinecrest Landscaping') pine,
      (select count(*)::int from communications where gmail_thread_id like 'sample-thread-e%') threaded,
      (select count(*)::int from sample_records where table_name = 'communications' and record_id in (select id from communications where gmail_thread_id like 'sample-thread-e%')) tracked`);
    assert(s.priya && s.pine === "Pinecrest LOI" && s.threaded === 4 && s.tracked === 4, JSON.stringify(s));
  });

  await step("Settings, Work settings: 'No reply yet after [2] days' under the waiting field, 2 by default", async () => {
    await page.goto(`${BASE}/settings`);
    const row = page.getByTestId("work-settings-no-reply");
    await row.waitFor();
    assert((await row.innerText()).replace(/\s+/g, " ").trim() === "No reply yet after days", await row.innerText());
    assert((await page.getByTestId("work-no-reply").inputValue()) === "2", "2 by default");
    const rows = await page.getByTestId("work-settings").locator("[data-testid^=work-settings-]").evaluateAll((els) => els.map((e) => e.dataset.testid));
    assert(rows.indexOf("work-settings-no-reply") === rows.indexOf("work-settings-threshold") + 1, `order ${rows}`);
    // The label column stays aligned.
    const xs = await page.getByTestId("work-settings").locator("[data-testid^=work-settings-] > span:first-child").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert(new Set(xs).size === 1, `labels at ${xs}`);
    // The number boxes line up in one column too.
    const boxes = await Promise.all(["work-threshold", "work-no-reply", "work-outreach", "work-block-minutes"].map(async (t) => Math.round((await page.getByTestId(t).boundingBox()).x)));
    assert(new Set(boxes).size === 1, `boxes at ${boxes}`);
    // The two cards side by side still line up at the top.
    const a = await page.getByTestId("google-card").boundingBox();
    const b = await page.getByTestId("work-settings").boundingBox();
    assert(Math.abs(a.y - b.y) <= 1, `cards at ${a.y} and ${b.y}`);
    await page.getByTestId("work-no-reply").fill("0");
    await page.getByTestId("work-settings-save").click();
    await until(async () => (await page.getByTestId("work-settings-note").count()) && (await page.getByTestId("work-settings-note").innerText()).startsWith("No reply yet"), "a bad value says so");
    // Back to 2: nothing to save (no settings row yet; it reads as 2).
    await page.getByTestId("work-no-reply").fill("2");
    assert(await page.getByTestId("work-settings-save").isDisabled(), "nothing to save");
    assert(!(await one("select 1 x from inputs where key = 'no_reply_after_days'")), "no row was written");
    await page.locator("#s-work").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("settings-work-settings-1440.png");
  });

  await step("Waiting on someone: three groups (closed at first), the card counts deals and people, No reply yet counts its own; a person row, a Replied row, two No reply rows", async () => {
    await openHome();
    const sections = await card().locator('[data-testid="home-section"]').evaluateAll((els) => els.map((e) => [e.dataset.section, e.dataset.collapsed]));
    assert(JSON.stringify(sections) === JSON.stringify([["wait-over", "1"], ["wait-under", "1"], ["wait-no-reply", "1"]]), JSON.stringify(sections));
    const heads = await card().locator('[data-testid="home-section"] [data-testid="section-heading"]').allInnerTexts();
    assert(/5\+ days/i.test(heads[0]) && /Less than 5 days/i.test(heads[1]) && /No reply yet/i.test(heads[2]), `${heads}`);
    const expected = await one(`select
      (select count(*)::int from pipeline_items i join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id
        where p.kind = 'acquisition' and i.screened and i.status = 'open' and s.outcome = 'open' and coalesce(btrim(i.waiting_on), '') <> '') deals,
      (select count(*)::int from contacts where archived_at is null and coalesce(btrim(waiting_on), '') <> '') people`);
    assert((await cardCount()) === expected.deals + expected.people && expected.people === 1, `card ${await cardCount()} vs ${JSON.stringify(expected)}`);
    assert((await groupCount("over")) + (await groupCount("under")) === expected.deals + expected.people, "the day groups hold every wait");
    assert((await groupCount("no-reply")) === 2, `no reply ${await groupCount("no-reply")}`);
    await openAll();
    // The person row: Contacts pill, name, amber days, what and who, Since and role, Follow up.
    const priya = waitRow("Priya Natarajan");
    assert((await priya.getAttribute("data-kind")) === "person", "kind");
    assert((await priya.getByTestId("lane-pill").innerText()) === "Contacts", "the Contacts pill");
    assert((await priya.getByTestId("waiting-days").innerText()) === "6 days" && (await priya.getByTestId("waiting-days").getAttribute("data-tone")) === "amber", "six days, amber");
    assert((await priya.innerText()).includes("Intros to the two owners who asked about exit loans · Truist"), await priya.innerText());
    assert((await priya.getByTestId("waiting-since").innerText()) === `Since ${short(addDays(today, -6))} · Lender`, await priya.getByTestId("waiting-since").innerText());
    assert(await priya.getByTestId("follow-up-button").isVisible(), "Follow up");
    // The Replied row: the green pill with the reply's day and Clear in place of Follow up.
    const pine = waitRow("Pinecrest Landscaping");
    assert((await pine.getByTestId("waiting-replied").innerText()) === `Replied ${short(addDays(today, -1))}` && (await pine.getByTestId("waiting-replied").getAttribute("data-tone")) === "green", "Replied");
    assert((await pine.getByTestId("waiting-clear").count()) === 1 && (await pine.getByTestId("follow-up-button").count()) === 0, "Clear, no Follow up");
    assert((await pine.innerText()).includes("A reply to: Pinecrest LOI"), await pine.innerText());
    // No reply yet: "Sent Nov 3 to Luis Ortega: Oakline CIM" with the deal, and Rita's email with her organization.
    const oak = noReplyRow("Oakline CIM");
    assert((await oak.getByTestId("no-reply-line").innerText()) === `Sent ${short(addDays(today, -2))} to Luis Ortega: Oakline CIM`, await oak.getByTestId("no-reply-line").innerText());
    assert((await oak.innerText()).includes("Oakline Dental Lab") && (await oak.getAttribute("data-target")) === "deal", "the deal");
    const rita = noReplyRow("Member survey project");
    assert((await rita.getByTestId("no-reply-line").innerText()) === `Sent ${short(addDays(today, -10))} to Rita Caldwell: Member survey project`, await rita.getByTestId("no-reply-line").innerText());
    assert((await rita.innerText()).includes("GA Home Care Association") && (await rita.getAttribute("data-target")) === "person", "the person");
    assert((await rita.getByTestId("no-reply-add").innerText()) === "Add to Waiting" && (await rita.getByTestId("no-reply-dismiss").innerText()) === "Dismiss", "the two buttons");
    // The End of day reports sent to the partners are never listed.
    assert(!(await group("no-reply").innerText()).includes("report"), "no reports");
    await shot("work-on-now-1440.png");
    // The card scrolls on its own; for the picture it is shown at full height (a tall window) with all three groups open.
    await page.setViewportSize({ width: 1440, height: 2400 });
    await card().evaluate((el) => (el.style.maxHeight = "none"));
    await card().evaluate((el) => el.scrollTo(0, 0));
    await shot("waiting-card-three-groups-1440.png", card());
    await card().evaluate((el) => (el.style.maxHeight = ""));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("A click on a No reply row opens the deal or the person; Find and the Area selector leave the card as it is", async () => {
    await openHome();
    const before = await card().innerText();
    await page.getByTestId("home-search").fill("Hilltop");
    await page.getByTestId("area-selector").locator('[data-testid="area-option"][data-value="contacts"]').click();
    assert((await card().innerText()) === before, "not narrowed");
    await openGroup("no-reply");
    await noReplyRow("Oakline CIM").getByTestId("no-reply-line").click();
    await page.waitForURL(/\/work\/deals\//);
    const oak = await one("select id from pipeline_items where name = 'Oakline Dental Lab'");
    assert(page.url().endsWith(`/work/deals/${oak.id}`), page.url());
    await openHome();
    await page.getByTestId("area-selector").locator('[data-testid="area-option"][data-value="all"]').click().catch(() => {});
    await openGroup("no-reply");
    await noReplyRow("Member survey project").getByTestId("no-reply-line").click();
    await page.waitForURL(/\/work\/people\//);
    const rita = await one("select id from contacts where name = 'Rita Caldwell'");
    assert(page.url().endsWith(`/work/people/${rita.id}`), page.url());
  });

  let sam;
  await step("An email sent from the app shows under No reply yet after 2 days and not before; the setting moves it", async () => {
    sam = await sendFromPerson("Sam Patel", "Carriers selling this winter", "Have you heard of any carriers thinking about selling?");
    await openHome();
    await openGroup("no-reply");
    assert((await noReplyRow("Carriers selling this winter").count()) === 0, "not on the day it was sent");
    await backdate(sam.id, 1);
    await openHome();
    await openGroup("no-reply");
    assert((await noReplyRow("Carriers selling this winter").count()) === 0, "not after one day");
    await backdate(sam.id, 2);
    await openHome();
    await openGroup("no-reply");
    const r = noReplyRow("Carriers selling this winter");
    assert((await r.getByTestId("no-reply-line").innerText()) === `Sent ${short(addDays(today, -2))} to Sam Patel: Carriers selling this winter`, await r.getByTestId("no-reply-line").innerText());
    assert((await groupCount("no-reply")) === 3, `count ${await groupCount("no-reply")}`);
    // The setting: at 3 days the two-day-old emails go; at 1 day the one-day-old would show; back to 2.
    await setting(3);
    await openHome();
    await openGroup("no-reply");
    assert((await noReplyRow("Carriers selling this winter").count()) === 0 && (await noReplyRow("Oakline CIM").count()) === 0 && (await noReplyRow("Member survey project").count()) === 1, "at 3 days");
    await setting(2);
  });

  await step("A reply in the thread makes the row go by itself (and it is stored once)", async () => {
    const r = await g("/__reply", { threadId: sam.gmail_thread_id, from: "Sam Patel <sam.patel@example.com>", text: "Two carriers. Call me." });
    assert(r.id, "reply queued");
    await lookForReplies();
    await openGroup("no-reply");
    assert((await noReplyRow("Carriers selling this winter").count()) === 0, "gone after the reply");
    const stored = await all("select direction from communications where gmail_thread_id = $1 and direction = 'incoming'", [sam.gmail_thread_id]);
    assert(stored.length === 1, JSON.stringify(stored));
  });

  await step("Dismiss: the row goes and stays gone", async () => {
    await openHome();
    await openGroup("no-reply");
    const before = await groupCount("no-reply");
    await noReplyRow("Member survey project").getByTestId("no-reply-dismiss").click();
    await until(async () => (await noReplyRow("Member survey project").count()) === 0, "gone at once");
    const c = await one("select no_reply_dismissed_at from communications where subject = 'Member survey project'");
    assert(c.no_reply_dismissed_at, "marked");
    await openHome();
    await openGroup("no-reply");
    assert((await noReplyRow("Member survey project").count()) === 0 && (await groupCount("no-reply")) === before - 1, "still gone after a reload");
  });

  await step("Add to Waiting on a deal email: the deal waits on 'A reply to: <subject>' since the day it was sent, with who it went to; the email is remembered", async () => {
    await openHome();
    const countBefore = await cardCount();
    await openGroup("no-reply");
    await noReplyRow("Oakline CIM").getByTestId("no-reply-add").click();
    await until(async () => (await noReplyRow("Oakline CIM").count()) === 0, "the No reply row goes");
    const d = await one("select i.waiting_on, i.waiting_since::text since, c.subject from pipeline_items i join communications c on c.id = i.waiting_comm_id where i.name = 'Oakline Dental Lab'");
    assert(d && d.waiting_on === "A reply to: Oakline CIM" && d.since === addDays(today, -2) && d.subject === "Oakline CIM", JSON.stringify(d));
    await openHome();
    await openAll();
    const row = waitRow("Oakline Dental Lab");
    assert((await row.innerText()).includes("A reply to: Oakline CIM · Luis Ortega"), await row.innerText());
    assert((await cardCount()) === countBefore, "Oakline was already waiting, so the count stays");
    assert((await noReplyRow("Oakline CIM").count()) === 0, "not listed again while the deal waits on it");
  });

  let nina;
  await step("Add to Waiting on an email with no deal: the person waits on it and shows on the card", async () => {
    nina = await sendFromPerson("Nina Reyes", "COO search update", "Any news on the COO search?");
    await backdate(nina.id, 3);
    await openHome();
    const countBefore = await cardCount();
    await openGroup("no-reply");
    await noReplyRow("COO search update").getByTestId("no-reply-add").click();
    await until(async () => (await noReplyRow("COO search update").count()) === 0, "the No reply row goes");
    const p = await one("select waiting_on, waiting_since::text since, waiting_comm_id from contacts where name = 'Nina Reyes'");
    assert(p.waiting_on === "A reply to: COO search update" && p.since === addDays(today, -3) && p.waiting_comm_id === nina.id, JSON.stringify(p));
    await openHome();
    await openAll();
    const row = waitRow("Nina Reyes");
    assert((await row.getAttribute("data-kind")) === "person" && (await row.getByTestId("waiting-days").innerText()) === "3 days", await row.innerText());
    assert((await cardCount()) === countBefore + 1, `count ${await cardCount()} after ${countBefore}`);
  });

  await step("Replied: a reply to the email a wait came from shows the green Replied pill and Clear; it does not clear by itself; Clear empties Waiting on", async () => {
    await g("/__reply", { threadId: nina.gmail_thread_id, from: "Nina Reyes <nina.reyes@example.com>", text: "The client picked a finalist. Sorry." });
    await lookForReplies();
    await openAll();
    const row = waitRow("Nina Reyes");
    assert((await row.getByTestId("waiting-replied").innerText()) === `Replied ${short(today)}`, await row.innerText());
    assert((await one("select waiting_on from contacts where name = 'Nina Reyes'")).waiting_on, "still waiting until Clear");
    const countBefore = await cardCount();
    await row.getByTestId("waiting-clear").click();
    await until(async () => (await waitRow("Nina Reyes").count()) === 0, "the row goes");
    const p = await one("select waiting_on, waiting_since, waiting_comm_id from contacts where name = 'Nina Reyes'");
    assert(!p.waiting_on && !p.waiting_since && !p.waiting_comm_id, JSON.stringify(p));
    await openHome();
    assert((await cardCount()) === countBefore - 1, "the count drops");
    // The sample's Replied deal clears the same way.
    await openAll();
    await waitRow("Pinecrest Landscaping").getByTestId("waiting-clear").click();
    await until(async () => (await waitRow("Pinecrest Landscaping").count()) === 0, "Pinecrest goes");
    const d = await one("select waiting_on, waiting_comm_id from pipeline_items where name = 'Pinecrest Landscaping'");
    assert(!d.waiting_on && !d.waiting_comm_id, JSON.stringify(d));
  });

  await step("Follow up on a person: the editor opens to that person; sending restarts the wait today and moves it to the follow-up email", async () => {
    await openHome();
    await openAll();
    const row = waitRow("Priya Natarajan");
    await row.getByTestId("follow-up-button").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    assert((await page.getByTestId("compose-to").inputValue()) === "priya.natarajan@example.com", "To");
    assert((await page.getByTestId("compose-subject").inputValue()) === "Following up", await page.getByTestId("compose-subject").inputValue());
    const body = await page.getByTestId("compose-body").evaluate((el) => el.innerText);
    assert(body.includes("Hi Priya,") && body.includes("intros to the two owners who asked about exit loans") && body.includes("6 days"), body.slice(0, 200));
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await dlg.getByTestId("send-success").waitFor({ timeout: 20000 });
    await page.getByTestId("compose-close").click();
    await row.getByTestId("follow-up-sent").waitFor();
    await until(async () => (await one("select waiting_since::text s from contacts where name = 'Priya Natarajan'")).s === today, "the wait starts again today");
    const p = await one("select c.subject, c.gmail_thread_id from contacts p join communications c on c.id = p.waiting_comm_id where p.name = 'Priya Natarajan'");
    assert(p && p.subject === "Following up" && p.gmail_thread_id, JSON.stringify(p));
  });

  await step("The person page: Waiting on and Since on the Next follow-up card, saved like a deal's; the person shows on the card", async () => {
    const priya = await one("select id from contacts where name = 'Priya Natarajan'");
    await page.goto(`${BASE}/work/people/${priya.id}`);
    const cardEl = page.getByTestId("person-next-follow-up");
    await cardEl.waitFor();
    assert((await page.getByTestId("fu-waiting").inputValue()) === "Intros to the two owners who asked about exit loans", "Waiting on");
    assert((await page.getByTestId("fu-since").inputValue()) === today, "Since");
    // Labels line up in one column.
    const xs = await page.getByTestId("follow-up-form").locator(":scope > label").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert(new Set(xs).size === 1, `labels at ${xs}`);
    await shot("person-next-follow-up-waiting-1440.png", cardEl);
    const kevin = await one("select id from contacts where name = $1", ["Kevin O'Brien"]);
    await page.goto(`${BASE}/work/people/${kevin.id}`);
    await page.getByTestId("fu-waiting").fill("His reference letter");
    await page.getByTestId("fu-since").fill(addDays(today, -4));
    await page.getByTestId("fu-save").click();
    await until(async () => (await one("select waiting_on, waiting_since::text s from contacts where id = $1", [kevin.id])).s === addDays(today, -4), "saved");
    await openHome();
    await openAll();
    assert((await waitRow("Kevin O'Brien").getByTestId("waiting-days").innerText()) === "4 days", "Kevin on the card");
    // Emptied by hand: off the card.
    await page.goto(`${BASE}/work/people/${kevin.id}`);
    await page.getByTestId("fu-waiting").fill("");
    await page.getByTestId("fu-save").click();
    await until(async () => !(await one("select waiting_on from contacts where id = $1", [kevin.id])).waiting_on, "emptied");
  });

  await step("Waiting on changed by hand on a deal whose wait came from an email forgets the email, and the email does not come back to No reply yet", async () => {
    const oak = await one("select id, waiting_comm_id from pipeline_items where name = 'Oakline Dental Lab'");
    await page.goto(`${BASE}/work/deals/${oak.id}`);
    await page.getByTestId("na-waiting").fill("The CIM");
    await page.getByTestId("na-save").click();
    await until(async () => (await one("select waiting_on from pipeline_items where id = $1", [oak.id])).waiting_on === "The CIM", "saved");
    const after = await one("select i.waiting_comm_id, c.no_reply_dismissed_at from pipeline_items i, communications c where i.id = $1 and c.id = $2", [oak.id, oak.waiting_comm_id]);
    assert(!after.waiting_comm_id && after.no_reply_dismissed_at, JSON.stringify(after));
    await openHome();
    await openGroup("no-reply");
    assert((await noReplyRow("Oakline CIM").count()) === 0, "not back");
  });

  await step("Long lists: a group shows 8 rows, then Show all (N) opens a centered window with all of them", async () => {
    const ids = (await all("select id from contacts where archived_at is null and waiting_on is null order by name limit 9")).map((r) => r.id);
    await db.query("update contacts set waiting_on = 'A test wait', waiting_since = $2 where id = any($1)", [ids, addDays(today, -1)]);
    await openHome();
    await openGroup("under");
    const n = await groupCount("under");
    assert(n > 8, `under has ${n}`);
    assert((await group("under").getByTestId("waiting-row").count()) === 8, "8 rows");
    const link = page.getByTestId("wait-under-all-link");
    assert((await link.innerText()) === `Show all (${n})`, await link.innerText());
    const lb = await link.boundingBox();
    const cb = await card().boundingBox();
    assert(Math.abs(lb.x + lb.width / 2 - (cb.x + cb.width / 2)) <= 2, "centered under the rows");
    await link.click();
    const win = page.getByTestId("wait-under-all-window");
    await win.waitFor();
    assert((await win.getByTestId("waiting-row").count()) === n, "all in the window");
    await page.keyboard.press("Escape");
    await win.waitFor({ state: "hidden" });
    await db.query("update contacts set waiting_on = null, waiting_since = null where id = any($1)", [ids]);
  });

  await step("Elsewhere: Reports and End of day 'Waiting on brokers' and the Deals summary count deals only", async () => {
    await db.query("update contacts set waiting_since = $1 where name = 'Priya Natarajan'", [addDays(today, -9)]);
    await page.goto(`${BASE}/work/reports`);
    await page.getByTestId("report-waits").waitFor();
    assert(!(await page.getByTestId("report-waits").innerText()).includes("Priya"), "no people on Reports");
    await page.goto(`${BASE}/work/deals`);
    await page.waitForLoadState("networkidle");
    assert(!(await page.locator("body").innerText()).includes("Priya Natarajan"), "no people on Deals");
  });

  await step("Remove sample data removes the push E records; nothing is left waiting on a removed email", async () => {
    await page.goto(`${BASE}/settings/data`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sample-remove").click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /Remove/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
    for (let i = 0; i < 40 && (await one("select count(*)::int n from sample_records")).n; i++) await page.waitForTimeout(500);
    const left = await one(`select (select count(*)::int from sample_records) s,
      (select count(*)::int from communications where gmail_thread_id like 'sample-thread-e%') threads,
      (select count(*)::int from contacts where waiting_on is not null) people,
      (select count(*)::int from pipeline_items where waiting_on is not null or waiting_comm_id is not null) deals`);
    assert(left.s === 0 && left.threads === 0 && left.people === 0 && left.deals === 0, JSON.stringify(left));
    await openHome();
    assert((await page.getByTestId("now-wait-empty").count()) === 1, "the card is empty");
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

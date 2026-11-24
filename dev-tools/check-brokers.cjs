// LOCAL TESTING ONLY: broker links (push K, Bram 2026-11-24; claude/2026-11-24-broker-links-build-plan.md). A deal's
// broker, associate and brokerage are records of their own (a person, a person, an organization); "Brokers to link"
// turns the typed broker text into those links; every call and meeting names a person; a person can have a second
// role; "Brokers contacted" counts a call logged from a deal and a calendar meeting with a broker.
// Needs a fresh local database and the built app with the stand-ins (dev-tools/start-local.sh), on a weekday clock.
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-brokers.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || "";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;

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
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
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
  const shot = async (name, target = page) => {
    if (SHOTS) await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };
  const deal = async (name) => one("select * from pipeline_items where name = $1 order by created_at limit 1", [name]);
  const person = async (name) => one("select * from contacts where name = $1 order by created_at limit 1", [name]);
  /** Types into a picker and takes the row offered: the add row (a new name) or the record of that name. */
  const pickIn = async (scope, testId, text, how) => {
    const input = scope.getByTestId(`${testId}-input`);
    await input.fill(text);
    if (how === "add") await scope.getByTestId(`${testId}-add`).click();
    else await scope.getByTestId(`${testId}-option`).filter({ hasText: how }).first().click();
  };

  // The stand-in's two sample calendar events (12:30 lunch, 15:30 call) are left out, so no step depends on the time
  // of day the check runs at; the calendar steps add their own events.
  await fetch(`${process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329"}/__mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ calendarEvents: false }) }).catch(() => {});

  await step("Sample data is loaded", async () => {
    await open("/settings/data");
    if (!(await page.getByText("Sample data loaded").count()) && (await page.getByTestId("sample-load").count())) {
      const confirm = page.getByTestId("sample-confirm-real");
      if (await confirm.count()) await confirm.check();
      await page.getByTestId("sample-load").click();
      await page.getByText("Sample data loaded").first().waitFor({ timeout: 60000 });
    }
  });

  // Two open deals as the live app has them: the broker typed as text, no person linked. One names a broker who is
  // not on Contacts (with a call logged on the deal with no person, as before this release), one a broker who is.
  let thatcherDeal, daltonDeal;
  await step("Setup: two open deals with the broker typed as text and no person linked; one has a call logged with no person", async () => {
    const d1 = await deal("Summit Logistics Group");
    const d2 = await deal("Dalton Services");
    assert(d1 && d2, "the sample deals are missing");
    await db.query("update pipeline_items set primary_contact_id = null, broker_organization_id = null, broker_associate_contact_id = null, broker_name = 'Example Business Brokers, Thatcher Brown' where id = $1", [d1.id]);
    await db.query("update pipeline_items set primary_contact_id = null, broker_organization_id = null, broker_associate_contact_id = null, broker_name = 'Transworld, Mark Reed' where id = $1", [d2.id]);
    // Every other open deal is linked for this check, so the list holds exactly these two.
    await db.query("update pipeline_items set broker_name = null where screened = true and primary_contact_id is null and id not in ($1, $2)", [d1.id, d2.id]);
    await db.query("insert into communications (owner_id, occurred_at, method, direction, contact_id, pipeline_item_id, subject, call_minutes) values ($1, now(), 'call', 'outgoing', null, $2, 'Call with Thatcher Brown', 20)", [d1.owner_id, d1.id]);
    assert(!(await person("Thatcher Brown")), "Thatcher Brown is already on Contacts");
    assert(await person("Mark Reed"), "Mark Reed is not in the sample data");
    thatcherDeal = d1;
    daltonDeal = d2;
  });

  await step("Deals: a line says 2 deals have their broker typed as text; 'Link brokers' opens the list with what the app proposes (a new person and brokerage; a person and a brokerage on file)", async () => {
    await open("/work/deals");
    const line = page.getByTestId("brokers-to-link-line");
    await line.waitFor({ timeout: 20000 });
    assert((await line.innerText()).startsWith("2 deals have their broker typed as text"), await line.innerText());
    await shot("deals-line", line);
    await page.getByTestId("brokers-to-link-open").click();
    const win = page.getByTestId("brokers-rows");
    await win.waitFor({ timeout: 20000 });
    const rows = page.getByTestId("brokers-row");
    assert((await rows.count()) === 2, `${await rows.count()} rows`);
    const r1 = page.locator(`[data-testid=brokers-row][data-deal="${thatcherDeal.id}"]`);
    assert((await r1.getByTestId("brokers-typed").innerText()) === "Example Business Brokers, Thatcher Brown", "typed text");
    assert((await r1.getByTestId("brokers-broker-input").inputValue()) === "Thatcher Brown" && (await r1.getByTestId("brokers-broker").getAttribute("data-picked")) === "new", "Thatcher Brown is proposed as a new person");
    assert((await r1.getByTestId("brokers-brokerage-input").inputValue()) === "Example Business Brokers" && (await r1.getByTestId("brokers-brokerage").getAttribute("data-picked")) === "new", "the brokerage is proposed as new");
    const r2 = page.locator(`[data-testid=brokers-row][data-deal="${daltonDeal.id}"]`);
    assert((await r2.getByTestId("brokers-broker-input").inputValue()) === "Mark Reed" && (await r2.getByTestId("brokers-broker").getAttribute("data-picked")) === "on-file", "Mark Reed is matched on Contacts");
    assert((await r2.getByTestId("brokers-brokerage").getAttribute("data-picked")) === "on-file", "Transworld is matched on file");
    await shot("brokers-to-link", page.getByTestId("brokers-to-link"));
    // Nothing is linked until Confirm.
    assert(!(await deal("Summit Logistics Group")).primary_contact_id && !(await person("Thatcher Brown")), "linked before Confirm");
  });

  await step("Confirm on one row: the person and the brokerage are added (role Broker, kind Broker), the deal is linked, and the call logged with no person now names the broker", async () => {
    const r1 = page.locator(`[data-testid=brokers-row][data-deal="${thatcherDeal.id}"]`);
    await r1.getByTestId("brokers-confirm").click();
    await page.getByTestId("brokers-note").waitFor({ timeout: 20000 });
    assert(/^1 deal linked; 1 earlier call or meeting now names the broker\.$/.test(await page.getByTestId("brokers-note").innerText()), await page.getByTestId("brokers-note").innerText());
    const p = await person("Thatcher Brown");
    const d = await deal("Summit Logistics Group");
    const org = await one("select * from organizations where name = 'Example Business Brokers'");
    assert(p && p.outreach_role === "broker" && org && org.kind === "broker" && p.organization_id === org.id, "the person or the brokerage was not added as a broker");
    assert(d.primary_contact_id === p.id && d.broker_organization_id === org.id && d.broker_name === "Example Business Brokers, Thatcher Brown", JSON.stringify([d.primary_contact_id, d.broker_organization_id, d.broker_name]));
    const c = await one("select contact_id from communications where pipeline_item_id = $1 and subject = 'Call with Thatcher Brown'", [d.id]);
    assert(c.contact_id === p.id, "the earlier call does not name the broker");
    await until(async () => (await page.getByTestId("brokers-row").count()) === 1, "the confirmed row is still on the list");
  });

  await step("Confirm the other row: Mark Reed (on Contacts) and Transworld (on file) are linked, nobody is added twice; the line leaves Deals", async () => {
    const before = (await one("select count(*)::int n from contacts")).n;
    await page.getByTestId("brokers-confirm").click();
    await page.getByTestId("brokers-none").waitFor({ timeout: 20000 });
    const d = await deal("Dalton Services");
    const mark = await person("Mark Reed");
    assert(d.primary_contact_id === mark.id && d.broker_organization_id, "Dalton Services is not linked");
    assert((await one("select count(*)::int n from contacts")).n === before, "a person was added though Mark Reed is on Contacts");
    await open("/work/deals");
    assert((await page.getByTestId("brokers-to-link-line").count()) === 0, "the line is still on Deals");
  });

  await step("Deal page, Facts: Broker and Brokerage show as links to their own pages; Edit shows Broker, Associate and Brokerage in place of the typed box, lined up with the form; an associate typed as a new name is added with the role Broker", async () => {
    await open(`/work/deals/${thatcherDeal.id}`);
    const facts = page.getByTestId("deal-facts");
    await facts.getByTestId("fact-broker-shown").waitFor({ timeout: 20000 });
    const p = await person("Thatcher Brown");
    assert((await facts.getByTestId("fact-broker-shown").locator("a").getAttribute("href")) === `/work/people/${p.id}`, "the broker is not a link to the person");
    assert((await facts.getByTestId("fact-brokerage-shown").locator("a").innerText()) === "Example Business Brokers", "the brokerage is not shown as a link");
    await shot("deal-facts-linked", facts);
    await page.getByTestId("facts-edit").click();
    const form = page.getByTestId("facts-form");
    const row = form.getByTestId("fact-broker-links");
    await row.waitFor();
    assert((await form.getByTestId("fact-brokerName").count()) === 0, "the typed Broker box is still in the form");
    // Broker and Associate side by side, Brokerage under them across both, each lined up with the form's two columns.
    const boxes = await Promise.all(["fact-broker", "fact-associate", "fact-brokerage"].map(async (t) => row.getByTestId(`${t}-input`).boundingBox()));
    const name = await form.getByTestId("fact-name").boundingBox();
    const company = await form.getByTestId("fact-companyName").boundingBox();
    const near = (a, b) => Math.abs(a - b) <= 1;
    assert(near(boxes[0].y, boxes[1].y) && boxes[2].y > boxes[0].y, `Broker and Associate are not side by side with Brokerage under them: ${JSON.stringify(boxes.map((b) => [b.x, b.y]))}`);
    assert(near(boxes[0].x, name.x) && near(boxes[1].x, company.x) && near(boxes[2].x, name.x) && near(boxes[2].x + boxes[2].width, company.x + company.width), "the boxes do not line up with the form's two columns");
    assert((await row.getByTestId("fact-broker-input").inputValue()) === "Thatcher Brown" && (await row.getByTestId("fact-brokerage-input").inputValue()) === "Example Business Brokers", "the boxes do not start with the links");
    await row.getByTestId("fact-associate-input").fill("Jordan Avery");
    await row.getByTestId("fact-associate-add").waitFor();
    assert((await row.getByTestId("fact-associate-add").innerText()).includes('Add "Jordan Avery" as a new broker'), await row.getByTestId("fact-associate-add").innerText());
    await shot("deal-facts-editing", facts);
    await row.getByTestId("fact-associate-add").click();
    await form.getByTestId("facts-save").click();
    await until(async () => !!(await person("Jordan Avery")), "the associate was not added to Contacts");
    const a = await person("Jordan Avery");
    const d = await deal("Summit Logistics Group");
    const org = await one("select id from organizations where name = 'Example Business Brokers'");
    assert(a.outreach_role === "broker" && a.organization_id === org.id && d.broker_associate_contact_id === a.id, "the associate is not a broker at the brokerage, or the deal does not link to them");
    await until(async () => (await facts.getByTestId("fact-associate-shown").count()) === 1, "the associate is not shown on Facts");
    // The same person cannot be both.
    await page.getByTestId("facts-edit").click();
    await page.getByTestId("fact-associate-input").fill("Thatcher Brown");
    await page.getByTestId("fact-brokerage-input").click();
    await until(async () => /same person as the broker/.test(await page.getByTestId("fact-broker-hint").innerText()), "no warning for the same person as broker and associate");
    assert(await page.getByTestId("facts-save").isDisabled(), "Save is not off with the same person as broker and associate");
    await page.getByTestId("facts-edit").click();
  });

  await step("A person on Contacts with another role picked as a deal's broker keeps the role and gets Broker as the second role ('Also'), shown and editable on their Facts card", async () => {
    const carla = await one("select * from contacts where outreach_role = 'personal_network' and archived_at is null order by name limit 1");
    assert(carla, "no personal network person in the sample data");
    await open(`/work/deals/${daltonDeal.id}`);
    await page.getByTestId("facts-edit").click();
    const row = page.getByTestId("fact-broker-links");
    await row.waitFor();
    await pickIn(row, "fact-broker", carla.name, carla.name);
    await page.getByTestId("facts-save").click();
    await until(async () => (await one("select second_role from contacts where id = $1", [carla.id])).second_role === "broker", "Broker was not added as the second role");
    const after = await one("select outreach_role, second_role from contacts where id = $1", [carla.id]);
    assert(after.outreach_role === "personal_network", "the first role changed");
    await open(`/work/people/${carla.id}`);
    assert(/Personal network, also Broker/.test(await page.getByTestId("pf-role").innerText()), await page.getByTestId("pf-role").innerText());
    // Also can be changed on the person's Facts card.
    await page.getByTestId("person-facts-edit").click();
    assert((await page.getByTestId("person-also").inputValue()) === "broker", "Also does not show Broker");
    await shot("person-also", page.getByTestId("person-facts"));
    await page.getByTestId("person-facts").getByRole("button", { name: "Cancel" }).first().click();
    // Mark Reed stays the broker of record for the rest of the check.
    const mark = await person("Mark Reed");
    await db.query("update pipeline_items set primary_contact_id = $2 where id = $1", [daltonDeal.id, mark.id]);
  });

  await step("Log a call from a deal: 'With' starts with the deal's broker; the saved call names the broker and the deal", async () => {
    await open(`/work/deals/${thatcherDeal.id}`);
    await page.getByTestId("deal-log-call").click();
    const form = page.getByTestId("log-call-form");
    await form.waitFor();
    assert((await form.getByTestId("call-who").inputValue()) === "Thatcher Brown", `With starts as: ${await form.getByTestId("call-who").inputValue()}`);
    await shot("log-call-from-deal", page.getByTestId("log-call-drawer"));
    await form.getByTestId("call-said").fill("Walked through the offer terms.");
    await page.getByTestId("call-save").click();
    await page.getByTestId("deal-call-logged").waitFor({ timeout: 20000 });
    const p = await person("Thatcher Brown");
    const c = await one("select contact_id, pipeline_item_id from communications where summary = 'Walked through the offer terms.'");
    assert(c && c.contact_id === p.id && c.pipeline_item_id === thatcherDeal.id, JSON.stringify(c));
  });

  await step("Every call names a person: saving with 'With' empty asks who the call was with and saves nothing; a new name is added to Contacts", async () => {
    await db.query("update pipeline_items set primary_contact_id = null where id = $1", [daltonDeal.id]);
    await open(`/work/deals/${daltonDeal.id}`);
    await page.getByTestId("deal-log-call").click();
    const form = page.getByTestId("log-call-form");
    await form.waitFor();
    assert((await form.getByTestId("call-who").inputValue()) === "", "With is not empty on a deal with no broker linked");
    const before = (await one("select count(*)::int n from communications")).n;
    await form.getByTestId("call-said").fill("No person yet.");
    await page.getByTestId("call-save").click();
    await page.getByTestId("call-error").waitFor();
    assert(/^Who was this call with\?/.test(await page.getByTestId("call-error").innerText()), await page.getByTestId("call-error").innerText());
    assert((await one("select count(*)::int n from communications")).n === before, "a call was saved with no person");
    await form.getByTestId("call-who").fill("Priya Nandakumar");
    await page.getByTestId("call-who-pick-add").click();
    await page.getByTestId("call-save").click();
    await page.getByTestId("deal-call-logged").waitFor({ timeout: 20000 });
    const p = await person("Priya Nandakumar");
    const c = await one("select contact_id from communications where summary = 'No person yet.'");
    assert(p && c.contact_id === p.id, "the new name was not added to Contacts, or the call does not name them");
    const mark = await person("Mark Reed");
    await db.query("update pipeline_items set primary_contact_id = $2 where id = $1", [daltonDeal.id, mark.id]);
  });

  await step("End of day: the call logged from the deal counts under Brokers contacted in the report's day counts", async () => {
    await open("/work/end-of-day");
    await page.getByTestId("report-view").first().click();
    const prev = page.getByTestId("report-preview");
    await prev.waitFor({ timeout: 20000 });
    const box = await prev.locator("[data-today-box]").first().innerText();
    const m = /(\d+)\s*Brokers\s*contacted/i.exec(box.replace(/\s+/g, " "));
    assert(m && Number(m[1]) >= 1, `Brokers contacted in the report: ${box.replace(/\s+/g, " ")}`);
    const brokersToday = (await all("select distinct c.contact_id from communications c join contacts p on p.id = c.contact_id where c.direction <> 'incoming' and c.method in ('call','meeting','video','email') and (p.outreach_role = 'broker' or p.second_role = 'broker') and c.occurred_at > now() - interval '20 hours'")).length;
    assert(Number(m[1]) >= 1 && Number(m[1]) <= brokersToday, `the report says ${m[1]}, the day's broker contacts are ${brokersToday}`);
    const thatcher = await person("Thatcher Brown");
    assert((await all("select 1 from communications where contact_id = $1 and method = 'call'", [thatcher.id])).length === 2, "Thatcher Brown's two calls (the earlier one and today's) are not both on the person");
    await page.getByTestId("report-window-close").click();
  });

  // ---------- Calendar meetings on record (Bram, 2026-11-24 3:22 pm; claude/2026-11-24-calendar-meetings-proposal.md) ----------
  const GOOGLE = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
  const TZ = "America/New_York";
  const addEvent = async (summary, startMs, endMs) => (await (await fetch(`${GOOGLE}/calendar/v3/calendars/primary/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary, start: { dateTime: new Date(startMs).toISOString() }, end: { dateTime: new Date(endMs).toISOString() } }) })).json()).id;
  /** An instant as the Date and time box takes it ("2026-11-24T16:40", the owner's time zone). */
  const localBox = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
  };
  const eodReady = async () => {
    await open("/work/end-of-day");
    await page.getByTestId("activity-calendar-note").waitFor({ timeout: 20000 });
    await until(async () => !(await page.getByTestId("activity-calendar-note").innerText()).includes("Reading your calendar"), "the calendar part never finished");
  };
  const callsInReport = async () => {
    await page.getByTestId("report-view").first().click();
    const prev = page.getByTestId("report-preview");
    await prev.waitFor({ timeout: 20000 });
    const m = /(\d+)\s*Calls\s*and\s*meetings/i.exec((await prev.locator("[data-today-box]").first().innerText()).replace(/\s+/g, " "));
    await page.getByTestId("report-window-close").click();
    assert(m, "the report has no Calls and meetings count");
    return Number(m[1]);
  };
  let past, ahead, callsBefore;
  const now = Date.now();
  // A calendar meeting that ended 90 minutes ago with Thatcher Brown, and one with Mark Reed that starts in 20 minutes.
  await step("Calendar: a meeting with a person on Contacts that has ended is saved as a meeting on that person's record (once), and shows as one Meeting row on End of day; a meeting that has not ended yet is not saved", async () => {
    await open("/api/google/connect");
    await eodReady();
    callsBefore = await callsInReport();
    past = await addEvent("Offer review with Thatcher Brown", now - 120 * 60000, now - 90 * 60000);
    ahead = await addEvent("Check-in with Mark Reed", now + 20 * 60000, now + 50 * 60000);
    await eodReady();
    const thatcher = await person("Thatcher Brown");
    await until(async () => !!(await one("select 1 from communications where calendar_event_id = $1", [`auto:${past}`])), "the ended calendar meeting was not saved as a meeting");
    const c = await one("select method, direction, contact_id, subject, call_minutes, is_outreach from communications where calendar_event_id = $1", [`auto:${past}`]);
    assert(c.method === "meeting" && c.direction === "outgoing" && c.contact_id === thatcher.id && c.subject === "Offer review with Thatcher Brown" && c.call_minutes === 30 && c.is_outreach === true, JSON.stringify(c));
    assert(!(await one("select 1 from communications where calendar_event_id in ($1, $2)", [`auto:${ahead}`, ahead])), "a calendar meeting that has not ended was saved");
    // Read again: saved once, however often the calendar is read.
    await eodReady();
    assert((await one("select count(*)::int n from communications where calendar_event_id = $1", [`auto:${past}`])).n === 1, "the calendar meeting was saved twice");
    const rows = page.getByTestId("eod-activity").getByTestId("activity-row");
    const mine = page.locator(`[data-testid=activity-row][data-id="cal:${past}"]`);
    await until(async () => (await mine.count()) === 1 && (await mine.getAttribute("data-kind")) === "meeting", `the saved meeting is not one Meeting row (rows of that id: ${await mine.count()})`);
    assert((await page.locator(`[data-testid=activity-row][data-id="cal:${ahead}"]`).getAttribute("data-kind")) === "calendar", "the meeting that has not ended is not a Calendar row");
    assert(await rows.count(), "no rows");
    await shot("eod-activity-calendar-meeting", page.getByTestId("eod-activity"));
    assert((await callsInReport()) === callsBefore + 1, "the calendar meeting does not count under Calls and meetings");
  });

  await step("The calendar meeting is on the person's Timeline and is their last contact", async () => {
    const thatcher = await person("Thatcher Brown");
    await open(`/work/people/${thatcher.id}`);
    await until(async () => (await page.getByTestId("timeline-events").innerText()).includes("Offer review with Thatcher Brown"), "the calendar meeting is not on the person's Timeline");
    await shot("person-timeline-calendar-meeting", page.getByTestId("timeline-events"));
    assert(thatcher.last_contact_at, "the person has no last contact");
  });

  await step("Drop on End of day takes the calendar meeting off the person's record and out of the count; Keep brings it back", async () => {
    await eodReady();
    const mine = page.locator(`[data-testid=activity-row][data-id="cal:${past}"]`);
    await mine.getByTestId("activity-toggle").click();
    await until(async () => !(await one("select 1 from communications where calendar_event_id = $1", [`auto:${past}`])), "Drop did not take the meeting off the record");
    await eodReady();
    const again = page.locator(`[data-testid=activity-row][data-id="cal:${past}"]`);
    await until(async () => (await again.count()) === 1 && (await again.getAttribute("data-off")) === "1", "the dropped row is not shown grayed");
    assert((await callsInReport()) === callsBefore, "the dropped calendar meeting still counts");
    await again.getByTestId("activity-toggle").click();
    await until(async () => !!(await one("select 1 from communications where calendar_event_id = $1", [`auto:${past}`])), "Keep did not bring the meeting back");
  });

  await step("A call logged by hand with the same person at the calendar meeting's time is that one meeting (no second one); with another person at that time the window warns and 'Log anyway' saves it", async () => {
    const mark = await person("Mark Reed");
    const thatcher = await person("Thatcher Brown");
    // The same person: Mark Reed, at the time of his calendar meeting.
    await open(`/work/people/${mark.id}`);
    await page.getByTestId("person-page-log-call").click();
    let form = page.getByTestId("log-call-form");
    await form.waitFor();
    await form.getByTestId("call-when").fill(localBox(now + 25 * 60000));
    await form.getByTestId("call-said").fill("Agreed the next steps on the model.");
    await page.getByTestId("call-save").click();
    await page.getByTestId("call-tied").waitFor({ timeout: 20000 });
    assert((await page.getByTestId("call-tied").innerText()).includes("Check-in with Mark Reed"), await page.getByTestId("call-tied").innerText());
    await shot("log-call-same-meeting", page.getByTestId("log-call-drawer"));
    const tied = await all("select id, contact_id, subject, summary, calendar_event_id from communications where calendar_event_id in ($1, $2)", [ahead, `auto:${ahead}`]);
    assert(tied.length === 1 && tied[0].calendar_event_id === ahead && tied[0].contact_id === mark.id && tied[0].summary === "Agreed the next steps on the model." && tied[0].subject === "Check-in with Mark Reed", JSON.stringify(tied));
    await page.getByTestId("call-tied-done").click();
    // Another person at that time: a warning, nothing saved, then Log anyway.
    await open(`/work/people/${thatcher.id}`);
    await page.getByTestId("person-page-log-call").click();
    form = page.getByTestId("log-call-form");
    await form.waitFor();
    await form.getByTestId("call-when").fill(localBox(now + 25 * 60000));
    await form.getByTestId("call-said").fill("A second call at the same time.");
    const before = (await one("select count(*)::int n from communications")).n;
    await page.getByTestId("call-save").click();
    await page.getByTestId("call-overlap").waitFor({ timeout: 20000 });
    assert(/This overlaps "Check-in with Mark Reed" on your calendar/.test(await page.getByTestId("call-overlap").innerText()), await page.getByTestId("call-overlap").innerText());
    assert((await one("select count(*)::int n from communications")).n === before, "the call was saved before Log anyway");
    await shot("log-call-overlap-warning", page.getByTestId("log-call-drawer"));
    await page.getByTestId("call-overlap-anyway").click();
    await until(async () => (await one("select count(*)::int n from communications")).n === before + 1, "Log anyway did not save the call");
    const c = await one("select contact_id, calendar_event_id from communications where summary = 'A second call at the same time.'");
    assert(c.contact_id === thatcher.id && c.calendar_event_id === null, JSON.stringify(c));
  });

  await step("No page showed an error in the browser", async () => {
    assert(!errors.length, errors.slice(0, 3).join(" | "));
  });

  await browser.close();
  await db.end();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

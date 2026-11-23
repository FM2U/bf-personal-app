// LOCAL TESTING ONLY: the report sends itself (Bram, 2026-11-08; claude/2026-11-08-auto-send-report-plan.md).
// Calls the report job the way Supabase Cron will (/api/cron/report with the cron secret), at fake times on today's
// date (?at=, accepted only with the stand-in Google): 3:00 pm nothing, 4:00 pm the first reminder email, 5:30 pm the
// second, 6:00 pm the send (to the partner due, then the people saved under Also send to, with the note under the
// greeting), each once; Send automatically (off by default since 2026-11-15) off sends no report and one "ready and
// not sent" email to you; a failed send is recorded and tried again. Also checks
// that the people and the note added in the window are kept when it closes, and that Skip today is gone.
// Needs a fresh local database and the built app with the stand-ins, on a weekday clock (see all-checks).
const { chromium } = require("playwright");
const path = require("node:path");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const GOOGLE = process.env.GOOGLE_API_MOCK_URL || "http://localhost:54329";
const SECRET = process.env.CRON_SECRET || "test-cron-secret";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
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
// Today in New York (the app's clock), and a New York wall-clock time on it as an instant.
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const nyAt = (day, hh, mm) => {
  for (const off of [-5, -4]) {
    const d = new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${off === -5 ? "-05:00" : "-04:00"}`);
    const back = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    if (back === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) return d.toISOString();
  }
  throw new Error("no time");
};
const job = async (day, hh, mm) => {
  const r = await fetch(`${BASE}/api/cron/report?at=${encodeURIComponent(nyAt(day, hh, mm))}`, { headers: { authorization: `Bearer ${SECRET}` } });
  const j = await r.json();
  const v = Object.values(j.results ?? {})[0] ?? {};
  return v;
};
const auto = async (day) => ((await one("select report_edits from end_of_day where day = $1", [day])) || {}).report_edits?._auto ?? {};

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
  const rw = () => page.getByTestId("report-window");
  const day = nyToday();

  await step("Sample data is loaded and Google is connected through the stand-in", async () => {
    await open("/settings/data");
    if (!(await page.getByText("Sample data loaded").count()) && (await page.getByTestId("sample-load").count())) {
      const confirm = page.getByTestId("sample-confirm-real");
      if (await confirm.count()) await confirm.check();
      await page.getByTestId("sample-load").click();
      await page.getByText("Sample data loaded").first().waitFor({ timeout: 60000 });
    }
    await open("/api/google/connect");
    await g("/__reset", {});
  });

  await step("Settings: 'Send by' 6:00 pm and 'Send automatically' off by default (2026-11-15); Amber after 5 and Red after 10, the four groups, no Network outreach row", async () => {
    await open("/settings");
    assert((await page.getByTestId("work-eod-time").inputValue()) === "18:00", `the time is ${await page.getByTestId("work-eod-time").inputValue()}`);
    assert(!(await page.getByTestId("work-auto-send").isChecked()), "Send automatically is on by default");
    const eodRow = (await page.getByTestId("work-settings-eod").innerText()).replace(/\s+/g, " ");
    assert(eodRow.includes("Send by") && !eodRow.includes("Report goes out at"), eodRow);
    assert((await page.getByTestId("work-settings-auto").innerText()).includes("Off: reminders, and an email at that time if not sent"), await page.getByTestId("work-settings-auto").innerText());
    assert((await page.getByTestId("work-threshold").inputValue()) === "5" && (await page.getByTestId("work-stalled").inputValue()) === "10", "Follow up / Stalled numbers");
    const t = (await page.getByTestId("work-settings").innerText()).replace(/\s+/g, " ");
    assert(t.includes("Amber after") && t.includes("days with no answer (time to nudge)") && t.includes("Red after") && t.includes("days with no answer (stalled)") && t.includes("Unanswered email after") && !t.includes("Network outreach"), t);
    for (const h of ["WAITING ON SOMEONE", "DAILY REPORT", "WORK WEEK", "CALENDAR"]) assert(t.toUpperCase().includes(h), `no group ${h}`);
  });

  await step("End of day with Send automatically off: the card says 'Send by 6:00 pm: press Approve and send'; then Send automatically is ticked and saved", async () => {
    await open("/work/end-of-day");
    const line = await page.getByTestId("report-auto-line").innerText();
    assert(line.includes("Send by 6:00 pm: press Approve and send"), line);
    await open("/settings");
    await page.getByTestId("work-auto-send").check();
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    await until(async () => Number((await one("select value_number from inputs where key = 'report_auto_send'"))?.value_number) === 1, "Send automatically was not saved as on");
  });

  await step("End of day: no Skip today; the card says the report goes out by itself at 6:00 pm", async () => {
    await open("/work/end-of-day");
    assert(!(await page.getByTestId("skip-today").count()), "Skip today is still there");
    assert((await page.getByTestId("report-auto-line").innerText()).includes("Goes out by itself at 6:00 pm"), await page.getByTestId("report-auto-line").innerText());
  });

  await step("Also send to and the note under the greeting are kept when the window closes (no question), and saved with the day", async () => {
    await page.getByTestId("report-view").click();
    await rw().getByTestId("report-also-open").click();
    const picker = rw().getByTestId("report-also-picker");
    await picker.waitFor({ timeout: 20000 });
    await picker.getByTestId("send-report-new-email").fill("auto-advisor@example.com");
    await picker.getByTestId("send-report-new-name").fill("Riley Auto");
    await picker.getByTestId("send-report-new-save").uncheck();
    await picker.getByTestId("send-report-new-add").click();
    await rw().getByTestId("report-intro").fill("Riley, this is my daily report.");
    await page.keyboard.press("Escape");
    assert(!(await page.getByTestId("discard-warning").count()), "closing asked Discard");
    await until(async () => !(await rw().isVisible().catch(() => false)), "the window did not close");
    await until(async () => {
      const e = (await one("select report_edits from end_of_day where day = $1", [day]))?.report_edits?._extras;
      return e && e.fresh?.[0]?.email === "auto-advisor@example.com" && e.intro === "Riley, this is my daily report.";
    }, "the people and the note were not saved with the day");
    await open("/work/end-of-day");
    await page.getByTestId("report-view").click();
    await until(async () => (await rw().getByTestId("report-also-names").innerText()).includes("Riley Auto"), "Riley is not on Also send to after a reload");
    assert((await rw().getByTestId("report-intro").inputValue()) === "Riley, this is my daily report.", "the note is gone after a reload");
    await rw().getByTestId("report-window-close").click();
  });

  await step("3:00 pm: nothing; 4:00 pm: the first reminder email to you (once); 5:30 pm: the second", async () => {
    const before = (await g("/__sent")).length;
    assert((await job(day, 15, 0)).step === "none", "something happened at 3:00 pm");
    // Step 4 (2026-11-15): the first reminder comes with the AI drafts (the opening is empty, so it is drafted).
    await db.query("update end_of_day set report_edits = coalesce(report_edits, '{}'::jsonb) - '_opening' - '_drafts' where day = $1", [day]);
    const r1 = await job(day, 16, 0);
    assert(r1.step === "remind1" && /drafts written/.test(r1.detail), JSON.stringify(r1));
    assert((await job(day, 16, 5)).step === "none", "the first reminder came twice");
    const r2 = await job(day, 17, 30);
    assert(r2.step === "remind2", JSON.stringify(r2));
    const mails = (await g("/__sent")).slice(before);
    assert(mails.length === 2, `${mails.length} reminder emails`);
    for (const m of mails) {
      assert(/Your report goes out at 6:00 pm/.test(m.subject), m.subject);
      assert(String(m.body).includes("Still open:") || String(m.body).includes("Everything is filled in."), m.body);
      assert(String(m.body).includes("/work/end-of-day"), "no link to End of day");
    }
    const a = await auto(day);
    assert(a.reminded1 && a.reminded2, JSON.stringify(a));
    assert(/AI drafts of the opening(, tomorrow's line)? and \d+ Today lines are ready to check on End of day\./.test(String(mails[0].body)) && !String(mails[1].body).includes("AI drafts"), `the drafts line is in the first reminder only: ${mails[0].body}`);
  });

  await step("End of day after the 4:00 pm drafts (release 4): 'AI draft' on the opening and the Today lines; Keep, typing over, and a Today line edit make them yours; Redraft writes only what is still the AI's; the report shows the Today lines", async () => {
    const edits = async () => (await one("select report_edits from end_of_day where day = $1", [day])).report_edits;
    let e = await edits();
    assert(e._opening && e._opening.startsWith("**Mock opening") && e._opening.includes("\n- **Seller and broker calls:** the broker call is set.") && e._drafts && e._drafts.opening === true, JSON.stringify(e._drafts));
    const ids = Object.keys(e._drafts.today || {});
    assert(ids.length >= 2 && ids.every((id) => e._drafts.today[id].ai === true), JSON.stringify(e._drafts.today));
    await open("/work/end-of-day");
    // 2026-11-23: the opening box is an editor with Bold and Bulleted list; the draft shows with a bold lead line and bullets.
    await page.getByTestId("opening-input").waitFor({ timeout: 20000 });
    assert((await page.getByTestId("opening-input").innerText()).startsWith("Mock opening"), "the opening box does not show the draft");
    assert((await page.locator("[data-testid=opening-input] strong").count()) === 3 && (await page.locator("[data-testid=opening-input] ul > li").count()) === 2, "the opening box does not show the bold lead line and two bullets");
    await page.getByTestId("draft-mark-opening").waitFor();
    const lines = page.getByTestId("today-line");
    assert((await lines.count()) === ids.length && (await page.locator("[data-testid=today-line][data-ai='1']").count()) === ids.length, `${await lines.count()} Today lines`);
    // The report shows the AI's Today line on each record worked on today.
    await page.getByTestId("report-view").click();
    await until(async () => /Today\s+mock today for/.test(await page.getByTestId("report-preview").innerText()), "the report does not show the Today lines");
    await page.getByTestId("report-window-close").click();
    // Keep the opening; type one Today line over; then Redraft: the kept and typed text stay, the other Today lines are drafted again.
    await page.getByTestId("draft-keep-opening").click();
    await until(async () => (await edits())._drafts.opening === false, "Keep did not save");
    const first = lines.first();
    await first.getByTestId("today-input").fill("Owner call booked for Thursday; financials asked for");
    await page.getByTestId("opening-input").click();
    await until(async () => Object.values((await edits())._drafts.today).some((n) => n.text === "Owner call booked for Thursday; financials asked for" && n.ai === false), "the typed Today line was not saved as yours");
    await db.query("update end_of_day set report_edits = jsonb_set(report_edits, '{_opening}', '\"Kept by hand.\"') where day = $1", [day]);
    await open("/work/end-of-day");
    await page.getByTestId("redraft").click();
    await page.getByTestId("redraft-note").waitFor({ timeout: 30000 });
    e = await edits();
    assert(e._opening === "Kept by hand.", `the kept opening was replaced: ${e._opening}`);
    const now = Object.values(e._drafts.today);
    assert(now.filter((n) => n.ai === false).length === 1 && now.filter((n) => n.ai === true).length === ids.length - 1, JSON.stringify(e._drafts.today));
    // Typing while Redraft runs: the AI's answer (3 seconds in the stand-in) never replaces text typed meanwhile, in the
    // box or in the saved day (the opening is an AI draft again first, so Redraft may write it).
    await db.query("update end_of_day set report_edits = jsonb_set(report_edits, '{_drafts,opening}', 'true') where day = $1", [day]);
    await open("/work/end-of-day");
    await page.getByTestId("redraft").click();
    await page.getByTestId("opening-input").fill("Typed while the AI was writing.");
    const second = page.getByTestId("today-line").nth(1).getByTestId("today-input");
    await second.fill("Typed Today line while the AI was writing");
    await page.getByTestId("opening-input").click();
    await page.getByTestId("redraft-note").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    assert((await page.getByTestId("opening-input").innerText()).trim() === "Typed while the AI was writing.", `the opening box was replaced: ${await page.getByTestId("opening-input").innerText()}`);
    assert((await second.inputValue()) === "Typed Today line while the AI was writing", `the Today box was replaced: ${await second.inputValue()}`);
    await page.getByTestId("today-line").first().getByTestId("today-input").click();
    await until(async () => {
      const x = await edits();
      return x._opening === "Typed while the AI was writing." && x._drafts.opening === false && Object.values(x._drafts.today).some((n) => n.text === "Typed Today line while the AI was writing" && n.ai === false);
    }, "the text typed during Redraft was not the saved text");
    // Clearing a Today line goes back to the kept rows of Today's activity.
    await page.getByTestId("today-line").first().getByTestId("today-input").fill("");
    await page.getByTestId("opening-input").click();
    await until(async () => Object.keys((await edits())._drafts.today).length === ids.length - 1, "clearing a Today line did not remove it");
  });

  await step("Send automatically off: 6:00 pm sends no report, one 'ready and not sent' email to you (once), and the day stays open", async () => {
    await open("/settings");
    await page.getByTestId("work-auto-send").uncheck();
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    const before = (await g("/__sent")).length;
    const r = await job(day, 18, 0);
    assert(r.step === "due" && r.detail === "emailed", JSON.stringify(r));
    assert((await job(day, 18, 5)).step === "none", "the 'ready and not sent' email came twice");
    const mails = (await g("/__sent")).slice(before);
    assert(mails.length === 1, `${mails.length} emails at 6:00 pm`);
    assert(mails[0].subject === "Today's report is ready and not sent", mails[0].subject);
    assert(String(mails[0].body).includes("is ready and not sent. It was due at 6:00 pm.") && String(mails[0].body).includes("/work/end-of-day"), mails[0].body);
    assert((await auto(day)).dueMailed, "the email was not recorded");
    assert((await one("select status from end_of_day where day = $1", [day])).status === "open", "the day closed");
    await open("/settings");
    await page.getByTestId("work-auto-send").check();
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
  });

  await step("A failed send at 6:00 pm is recorded and the day stays open; it goes out on a later run", async () => {
    await g("/__mode", { sendError: "server" });
    const r = await job(day, 18, 0);
    assert(r.step === "send" && /failed/.test(String(r.detail)), JSON.stringify(r));
    assert((await one("select status from end_of_day where day = $1", [day])).status === "open", "the day closed after a failed send");
    assert((await auto(day)).failedAt, "the failure is not recorded");
    await g("/__mode", { sendError: null });
  });

  await step("6:05 pm: the report goes to the partner due with the note under the greeting, then to Riley (Also send to); the day is sent and the list is cleared; a later run does nothing", async () => {
    const before = (await g("/__sent")).length;
    const r = await job(day, 18, 5);
    assert(r.step === "send" && /sent to/.test(String(r.detail)), JSON.stringify(r));
    const mails = (await g("/__sent")).slice(before);
    const jake = mails.find((m) => String(m.to).includes("jake.morgan"));
    const riley = mails.find((m) => String(m.to).includes("auto-advisor@example.com"));
    assert(jake && riley, `sent to ${mails.map((m) => m.to)}`);
    assert(String(jake.body).includes("Riley, this is my daily report.") && /Hey Riley,/.test(String(riley.body)), "the note or the greeting is missing");
    const row = await one("select status, report_edits from end_of_day where day = $1", [day]);
    assert(row.status === "sent", `the day is ${row.status}`);
    assert(!row.report_edits?._extras, "Also send to was not cleared after its send");
    assert((await job(day, 18, 10)).step === "none", "a later run did something");
    await open("/work/end-of-day");
    await page.getByTestId("sent-line").waitFor({ timeout: 15000 });
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

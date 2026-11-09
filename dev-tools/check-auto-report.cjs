// LOCAL TESTING ONLY: the report sends itself (Bram, 2026-11-08; claude/2026-11-08-auto-send-report-plan.md).
// Calls the report job the way Supabase Cron will (/api/cron/report with the cron secret), at fake times on today's
// date (?at=, accepted only with the stand-in Google): 3:00 pm nothing, 4:00 pm the first reminder email, 5:30 pm the
// second, 6:00 pm the send (to the partner due, then the people saved under Also send to, with the note under the
// greeting), each once; Send automatically off sends nothing; a failed send is recorded and tried again. Also checks
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

  await step("Settings: 'Report goes out at' 6:00 pm and 'Send automatically' on; Amber after 5 and Red after 10, the four groups, no Network outreach row", async () => {
    await open("/settings");
    assert((await page.getByTestId("work-eod-time").inputValue()) === "18:00", `the time is ${await page.getByTestId("work-eod-time").inputValue()}`);
    assert(await page.getByTestId("work-auto-send").isChecked(), "Send automatically is off");
    assert((await page.getByTestId("work-threshold").inputValue()) === "5" && (await page.getByTestId("work-stalled").inputValue()) === "10", "Follow up / Stalled numbers");
    const t = (await page.getByTestId("work-settings").innerText()).replace(/\s+/g, " ");
    assert(t.includes("Amber after") && t.includes("days with no answer (time to nudge)") && t.includes("Red after") && t.includes("days with no answer (stalled)") && t.includes("Unanswered email after") && !t.includes("Network outreach"), t);
    for (const h of ["WAITING ON SOMEONE", "DAILY REPORT", "WORK WEEK", "CALENDAR"]) assert(t.toUpperCase().includes(h), `no group ${h}`);
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
    const r1 = await job(day, 16, 0);
    assert(r1.step === "remind1", JSON.stringify(r1));
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
  });

  await step("Send automatically off: 6:00 pm sends nothing and the day stays open", async () => {
    await open("/settings");
    await page.getByTestId("work-auto-send").uncheck();
    await page.getByTestId("work-settings-save").click();
    await page.getByTestId("work-settings-note").waitFor({ timeout: 15000 });
    const before = (await g("/__sent")).length;
    assert((await job(day, 18, 0)).step === "none", "it sent with Send automatically off");
    assert((await g("/__sent")).length === before, "an email went out");
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

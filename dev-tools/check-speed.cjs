// LOCAL TESTING ONLY: the speed plan's check (Bram, 2026-11-07; claude/2026-11-07-speed-plan.md).
// Needs the built app started with the speed line and the comparison on:
//   SHOW_TIMING=1 BATCH_VERIFY=1 bash dev-tools/start-local.sh   (sample data loaded; LOG_DIR as for start-local)
// 1. Every page, loaded twice (the second time with the settings kept in the browser), must reach the database in no
//    more trips than its limit below. A read that waits for another read's answer adds a trip.
// 2. Every read answered inside a trip must equal the same read asked on its own ("[batch-verify] DIFFERENT" in the
//    app log fails the check).
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { cookie } = require("./session.cjs");

const BASE = process.argv[2] || "http://localhost:3000";
const LOG = path.join(process.env.LOG_DIR || "/tmp", "next.log");
// Trips per page on a full load, including the left menu's badges. Home also fills Waiting on someone and Targets
// today after the page is on screen (their own reads wait on each other), so it has more.
const LIMITS = { "/work": 4, "/work/listings": 2, "/work/deals": 2, "/work/people": 2, "/work/rosara": 2, "/work/jobs": 2, "/work/consulting": 2, "/work/todos": 2, "/work/targets": 2, "/work/end-of-day": 2, "/work/reports": 2, "/settings": 2 };

let failed = 0;
const ok = (good, name, detail) => {
  console.log(`${good ? "ok  " : "FAIL"} ${name}${good ? "" : `\n     ${detail}`}`);
  if (!good) failed++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  for (const [p, limit] of Object.entries(LIMITS)) {
    let text = "";
    for (let i = 0; i < 2; i++) {
      await page.goto(`${BASE}${p}`);
      const el = page.getByTestId("timing-line");
      await el.waitFor({ timeout: 30000 });
      for (let n = 0; n < 40 && !/database trip/.test(text = (await el.textContent()) || ""); n++) await page.waitForTimeout(250);
    }
    const trips = Number((text.match(/(\d+) database trips?/) || [])[1]);
    ok(trips <= limit, `${p}: ${trips} database trips (at most ${limit})`, text);
  }
  await page.waitForTimeout(1500);
  if (fs.existsSync(LOG)) {
    const log = fs.readFileSync(LOG, "utf8");
    const same = (log.match(/\[batch-verify\] same/g) || []).length;
    const diff = log.split("\n").filter((l) => /\[batch-verify\] (DIFFERENT|could not compare)/.test(l));
    ok(same > 0 && diff.length === 0, `every read in a trip equals the same read asked alone (${same} compared)`, diff.slice(0, 3).join("\n     ") || "nothing compared: start the app with BATCH_VERIFY=1");
  } else ok(false, "the app log is readable", `${LOG} not found (set LOG_DIR as for start-local.sh)`);
  await browser.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

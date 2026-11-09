// LOCAL TESTING ONLY. Click-through checks of push E part 2 (approved 2026-11-05): the "< 5 days" heading; several
// waits on one deal or person (one row with a line per wait on the Waiting card, Add to Waiting adds a line, "+ Add" and
// × on the deal, person, and item pages, Advance clears a deal's waits); Follow up watches both emails (a reply to the
// original email after a Follow up shows Replied); the Reports week buttons and Back to this week; and the End of day
// Today line (next actions done by area, to-dos done, people in "waiting 5+ days", the report section deals only).
// Replies come from the local Gmail stand-in (POST /__reply), as in check-push-b and check-push-e.
// 2026-11-05 (approved build): End of day's first visit after loading the sample shows the 6 default targets (not "0 of
// 0 met"); "+ Note" on the report sections (saves, shows in both partners' tabs, a left-out section does not send its
// note, Remove note, the note in the sent email and on Reports); the pending looks of Approve and send, Download the
// export, Finish the review, and Download full export.
// Needs a fresh local database (dev-tools/setup-local-db.sh) and the built app with the stand-ins (dev-tools/start-local.sh).
// Usage: NODE_PATH=$(npm root -g) node dev-tools/check-push-e2.cjs [baseUrl]   (SHOTS_DIR=<folder> saves screenshots)
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
  const card = () => page.getByTestId("home-right").getByTestId("now-wait");
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
  const cardCount = async () => Number((await card().locator("h2 .tabular").count()) ? await card().locator("h2 .tabular").innerText() : 0);
  const noReplyRow = (text) => group("no-reply").getByTestId("no-reply-row").filter({ hasText: text });
  const waitRow = (name) => card().getByTestId("waiting-row").filter({ has: page.locator(`text="${name}"`) });
  const lines = async (row) => row.getByTestId("waiting-line").evaluateAll((els) => els.map((e) => e.querySelector("[data-testid=waiting-what]").innerText));
  const dealId = async (name) => (await one("select id from pipeline_items where name = $1", [name])).id;
  /** The waits the Waiting card counts (edits of Nov 5): every wait of an open deal in the nine stages or of a person. */
  const openWaits = async (minDays = 0) =>
    (await one(`select
      (select count(*)::int from waits w join pipeline_items i on i.id = w.pipeline_item_id join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id
        where p.kind = 'acquisition' and i.screened and i.status = 'open' and s.outcome = 'open' and w.since <= $1::date - $2::int)
      + (select count(*)::int from waits w join contacts c on c.id = w.contact_id where c.archived_at is null and w.since <= $1::date - $2::int) n`, [today, minDays])).n;
  const personId = async (name) => (await one("select id from contacts where name = $1", [name])).id;
  const lookForReplies = async () => {
    await db.query("update google_connections set replies_checked_at = null");
    await openHome();
  };
  /** Sends an email from a deal or person page through the Gmail stand-in; returns the logged communication. */
  const send = async (url, button, subject, text) => {
    await page.goto(`${BASE}${url}`);
    await page.getByTestId(button).first().click();
    await page.getByTestId("compose-subject").fill(subject);
    await page.locator("[contenteditable=true]").first().fill(text);
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await page.getByTestId("send-success").waitFor({ timeout: 20000 });
    const c = await one("select id, gmail_thread_id, occurred_at from communications where direction = 'outgoing' and subject = $1 order by occurred_at desc limit 1", [subject]);
    assert(c && c.gmail_thread_id, `the email was logged with its thread: ${JSON.stringify(c)}`);
    return c;
  };
  const backdate = (commId, days) => db.query("update communications set occurred_at = $2 where id = $1", [commId, `${addDays(today, -days)}T15:00:00Z`]);
  /** Follow up on one line of a row: the editor opens, the email is sent, the line reads Followed up. */
  const followUp = async (row, lineText) => {
    const line = row.getByTestId("waiting-line").filter({ hasText: lineText });
    await line.getByTestId("follow-up-button").click();
    const dlg = page.getByTestId("compose-dialog");
    await dlg.waitFor();
    await page.getByTestId("send-now").click();
    await page.getByTestId("send-confirm").click();
    await dlg.getByTestId("send-success").waitFor({ timeout: 20000 });
    await page.getByTestId("compose-close").click();
    await line.getByTestId("follow-up-sent").waitFor();
  };

  await step("Sample data loads; BrightPath waits on two things (two rows of the waits table); Google is connected through the stand-in", async () => {
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
      (select count(*)::int from waits w join pipeline_items i on i.id = w.pipeline_item_id where i.name = 'BrightPath Home Care') bright,
      (select count(*)::int from sample_records where table_name = 'waits') tracked,
      (select count(*)::int from waits) waits,
      (select count(*)::int from information_schema.columns where table_schema = 'public' and column_name in ('waiting_on', 'waiting_since', 'waiting_comm_id')) old_columns`);
    assert(s.bright === 2 && s.tracked === s.waits && s.waits >= 6 && s.old_columns === 0, JSON.stringify(s));
  });

  await step("2026-11-05: the sample brings the 6 default targets, and End of day's FIRST visit shows them (not '0 of 0 met')", async () => {
    const t = await one("select count(*)::int n from targets where counts_key is not null and archived_at is null");
    assert(t.n === 6, `targets after the sample load ${t.n}`);
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("eod-targets").waitFor();
    const rows = await page.getByTestId("eod-target").count();
    const line = await page.getByTestId("eod-met-count").innerText();
    assert(rows === 6 && !/^0 of 0\b/.test(line), `first visit: ${rows} rows, "${line}"`);
  });

  await step("2026-11-05: with no targets at all, the first End of day visit makes the 6 defaults and shows all 6 on that same visit (no duplicates)", async () => {
    await db.query("delete from targets");
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("eod-targets").waitFor();
    const rows = await page.getByTestId("eod-target").count();
    const line = await page.getByTestId("eod-met-count").innerText();
    const t = await one("select count(*)::int n from targets");
    assert(rows === 6 && t.n === 6 && !/^0 of 0\b/.test(line), `first visit: ${rows} rows, ${t.n} in the database, "${line}"`);
  });

  await step("Edits of Nov 5, items 7 and 8: sample next actions are things Bram does (Pinecrest: call Dana about the seller note); the owed thing is the wait, worded '<Name>'s reply to your email \"<subject>\"' (item 3 of 2026-11-05)", async () => {
    const pine = await one("select next_action from pipeline_items where name = 'Pinecrest Landscaping'");
    assert(pine.next_action === "Call Dana about the seller note", pine.next_action);
    const pw = await all("select w.text from waits w join pipeline_items i on i.id = w.pipeline_item_id where i.name = 'Pinecrest Landscaping'");
    assert(JSON.stringify(pw.map((x) => x.text)) === JSON.stringify(['Dana Whitfield\'s reply to your email "Pinecrest LOI"']), JSON.stringify(pw));
    // Nothing a next action or follow-up says is what someone else owes ("Wait for ...", "Response to ...", "... to be scheduled").
    const owed = "^(wait|waiting|response|awaiting|reply from)\\b|to be (scheduled|sent|signed)";
    const passive = await all(
      `select name, next_action what from pipeline_items where next_action ~* $1
       union all select name, next_action from projects where next_action ~* $1
       union all select name, next_action from organizations where next_action ~* $1
       union all select name, follow_up_note from contacts where follow_up_note ~* $1`,
      [owed],
    );
    assert(passive.length === 0, JSON.stringify(passive));
    const changed = await one(`select
      (select next_action from pipeline_items where name = 'Oakline Dental Lab') oak,
      (select next_action from pipeline_items where name = 'Summit Logistics Group') summit,
      (select next_action from pipeline_items where name = 'Lumen Industrial Holdings') lumen,
      (select count(*)::int from waits where text like 'A reply to:%') old`);
    assert(changed.oak === "List the questions for Luis before the CIM arrives" && changed.summit === "Email Mark Reed for seller call times now the owner is back" && changed.lumen === "Prepare for the second interview with the partners" && changed.old === 0, JSON.stringify(changed));
  });

  await step("The second group reads '< 5 days' (small caps '< 5 DAYS'), next to '5+ days'", async () => {
    await openHome();
    // The band shows the count badge first, then the name in small caps.
    const heads = (await card().locator('[data-testid="home-section"] [data-testid="section-heading"]').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, "").trim());
    assert(JSON.stringify(heads) === JSON.stringify(["5+ DAYS", "< 5 DAYS", "NO REPLY YET"]), JSON.stringify(heads));
  });

  await step("Two waits on one deal show as ONE row with two lines, longest first, each with its own days pill, Since, and Follow up; the row sits in the group of its longest wait; the card counts waits (edits of Nov 5)", async () => {
    await openHome();
    await openAll();
    const row = waitRow("BrightPath Home Care");
    assert((await row.count()) === 1, `rows: ${await row.count()}`);
    assert((await row.getAttribute("data-lines")) === "2", "two lines");
    assert(JSON.stringify(await lines(row)) === JSON.stringify(["The CIM · Rachel Kim", "Times for a seller call · Rachel Kim"]), JSON.stringify(await lines(row)));
    assert(JSON.stringify(await row.getByTestId("waiting-days").allInnerTexts()) === JSON.stringify(["3 days", "1 day"]), "own pills");
    assert(JSON.stringify(await row.getByTestId("waiting-since").allInnerTexts()) === JSON.stringify([`Since ${short(addDays(today, -3))}`, `Since ${short(addDays(today, -1))}`]), "own Since");
    assert((await row.getByTestId("follow-up-button").count()) === 2, "a Follow up per line");
    assert((await row.getByTestId("waiting-context").innerText()) === "NDA signed", "the stage after the name");
    assert((await group("under").getByTestId("waiting-row").filter({ has: page.locator('text="BrightPath Home Care"') }).count()) === 1, "in < 5 days (its longest wait is 3 days)");
    const rows = await card().getByTestId("waiting-row").count();
    const waits = await openWaits();
    assert((await cardCount()) === waits && waits > rows, `card ${await cardCount()}, rows ${rows}, waits ${waits}`);
  });

  await step("Edits of Nov 5, items 2 and 5: on every row the name and its stage or role share one center line (also when the name wraps); each group's badge counts its waits; the card counts them all", async () => {
    await openHome();
    await openAll();
    const heads = () =>
      card().getByTestId("waiting-row").evaluateAll((rows) =>
        rows.map((r) => {
          const name = r.querySelector("[data-testid=waiting-name] > span");
          const ctx = r.querySelector("[data-testid=waiting-context]");
          if (!name || !ctx) return null;
          const first = name.getClientRects()[0];
          const c = ctx.getBoundingClientRect();
          return { name: name.textContent, lines: new Set([...name.getClientRects()].map((x) => Math.round(x.top))).size, gap: Math.abs(first.top + first.height / 2 - (c.top + c.height / 2)), ctxTop: Math.round(c.top), firstTop: Math.round(first.top) };
        }).filter(Boolean),
      );
    const before = await heads();
    assert(before.length >= 3 && before.every((h) => h.gap <= 1), `off center: ${JSON.stringify(before.filter((h) => h.gap > 1))}`);
    // Summit and Pinecrest, as Bram saw them.
    for (const n of ["Summit Logistics Group", "Pinecrest Landscaping"]) assert(before.some((h) => h.name === n), `${n} listed`);
    // For the picture: a tall window, the card at full height, every group open.
    await page.setViewportSize({ width: 1440, height: 2600 });
    await card().evaluate((el) => (el.style.maxHeight = "none"));
    await card().evaluate((el) => el.scrollTo(0, 0));
    await shot("waiting-card-headings-counts-1440.png", card());
    await card().evaluate((el) => (el.style.maxHeight = ""));
    await page.setViewportSize({ width: 1440, height: 900 });
    // A long name wraps beside its stage, which stays level with the name's first line.
    await card().getByTestId("waiting-row").filter({ has: page.locator('text="Summit Logistics Group"') }).locator("[data-testid=waiting-name] > span").evaluate((el) => (el.textContent = "Summit Logistics Group of Knoxville, Chattanooga, and the Tri-Cities Region"));
    const wrapped = (await heads()).find((h) => h.name.startsWith("Summit Logistics Group of"));
    assert(wrapped && wrapped.lines >= 2 && wrapped.gap <= 1, `wrapped: ${JSON.stringify(wrapped)}`);
    // The counts: each group's badge is the number of its wait lines; the card's number is all of them.
    const groups = {};
    for (const k of ["over", "under"]) {
      const sec = group(k);
      const shown = await sec.getByTestId("waiting-row").count();
      const badge = Number(await sec.getByTestId("section-heading").getAttribute("data-count"));
      const lineSum = await sec.getByTestId("waiting-row").evaluateAll((rows) => rows.reduce((n, r) => n + Number(r.getAttribute("data-lines")), 0));
      if (shown <= 8 && (await sec.getByTestId(`wait-${k}-all-link`).count()) === 0) assert(badge === lineSum, `${k}: badge ${badge}, lines ${lineSum}`);
      groups[k] = badge;
    }
    assert((await cardCount()) === groups.over + groups.under && (await cardCount()) === (await openWaits()), `card ${await cardCount()}, groups ${JSON.stringify(groups)}`);
  });

  await step("Add to Waiting adds a line and never replaces the typed wait: Oakline keeps 'The CIM' and gets 'Luis Ortega's reply to your email \"Oakline CIM\"', with no second '· Luis Ortega'", async () => {
    await openHome();
    const countBefore = await cardCount();
    await openGroup("no-reply");
    await noReplyRow("Oakline CIM").getByTestId("no-reply-add").click();
    await until(async () => (await noReplyRow("Oakline CIM").count()) === 0, "the No reply row goes");
    const w = await all("select w.text, w.since::text since, w.comm_id from waits w join pipeline_items i on i.id = w.pipeline_item_id where i.name = 'Oakline Dental Lab' order by w.created_at");
    assert(w.length === 2 && w[0].text === "The CIM" && !w[0].comm_id && w[1].text === 'Luis Ortega\'s reply to your email "Oakline CIM"' && w[1].since === addDays(today, -2) && w[1].comm_id, JSON.stringify(w));
    await openHome();
    await openAll();
    const row = waitRow("Oakline Dental Lab");
    assert((await row.count()) === 1 && (await row.getAttribute("data-lines")) === "2", "one row, two lines");
    assert((await lines(row)).includes("The CIM · Luis Ortega") && (await lines(row)).includes('Luis Ortega\'s reply to your email "Oakline CIM"'), JSON.stringify(await lines(row)));
    assert((await cardCount()) === countBefore + 1, "the same row, one more wait: the count goes up by one (edits of Nov 5)");
    // Added twice (a second tab): still one line for that email.
    assert((await one("select count(*)::int n from waits where comm_id = $1", [w[1].comm_id])).n === 1, "no double");
    // The days pills sit in one column: the same right edge on every line of every row.
    const rights = await card().locator('[data-col="days"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
    assert(new Set(rights).size === 1, `pills at ${rights}`);
    // For the picture: a tall window, the card at full height, every group open.
    await page.setViewportSize({ width: 1440, height: 2600 });
    await card().evaluate((el) => (el.style.maxHeight = "none"));
    await card().evaluate((el) => el.scrollTo(0, 0));
    await shot("waiting-card-two-wait-row-1440.png", card());
    await card().evaluate((el) => (el.style.maxHeight = ""));
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("Deal page: the Next action card's Waiting on is a short list (text, Since, ×); + Add adds a line; × removes one; the labels line up", async () => {
    const id = await dealId("Oakline Dental Lab");
    await page.goto(`${BASE}/work/deals/${id}`);
    const cardEl = page.getByTestId("deal-next-action");
    await cardEl.waitFor();
    const list = cardEl.getByTestId("waits-list");
    assert((await list.getByTestId("wait-line").count()) === 2, "two lines");
    assert(JSON.stringify(await list.getByTestId("wait-text").allInnerTexts()) === JSON.stringify(["The CIM", 'Luis Ortega\'s reply to your email "Oakline CIM"']), JSON.stringify(await list.getByTestId("wait-text").allInnerTexts()));
    assert(JSON.stringify(await list.getByTestId("wait-since").allInnerTexts()) === JSON.stringify([`Since ${short(addDays(today, -2))}`, `Since ${short(addDays(today, -2))}`]), "Since");
    assert((await list.getByTestId("wait-remove").count()) === 2, "an × per line");
    await cardEl.getByTestId("wait-add").click();
    await cardEl.getByTestId("wait-add-text").fill("Three years of tax returns");
    assert((await cardEl.getByTestId("wait-add-since").inputValue()) === today, "Since starts at today");
    await cardEl.getByTestId("wait-add-since").fill(addDays(today, -1));
    await cardEl.getByTestId("wait-add-save").click();
    await until(async () => (await list.getByTestId("wait-line").count()) === 3, "three lines");
    assert((await one("select since::text s from waits where pipeline_item_id = $1 and text = 'Three years of tax returns'", [id])).s === addDays(today, -1), "saved with its Since");
    // The label column, the Since column, and the × column line up.
    const labels = await cardEl.getByTestId("next-action-form").locator(":scope > label, :scope > [data-testid=waits-label]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert(new Set(labels).size === 1, `labels at ${labels}`);
    const sinceX = await list.getByTestId("wait-since").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    const xX = await list.getByTestId("wait-remove").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert(new Set(sinceX).size === 1 && new Set(xX).size === 1, `Since at ${sinceX}, × at ${xX}`);
    await shot("deal-next-action-waits-1440.png", cardEl);
    // × removes that one line at once.
    await list.getByTestId("wait-line").filter({ hasText: "Three years of tax returns" }).getByTestId("wait-remove").click();
    await until(async () => (await one("select count(*)::int n from waits where pipeline_item_id = $1", [id])).n === 2, "removed");
    await until(async () => (await list.getByTestId("wait-line").count()) === 2, "two lines again");
    // An empty line is not added.
    await cardEl.getByTestId("wait-add").click();
    assert(await cardEl.getByTestId("wait-add-save").isDisabled(), "Add needs text");
    await cardEl.getByTestId("wait-add-cancel").click();
  });

  await step("Person page: + Add gives Priya a second wait (one row, two lines on the card); × removes it", async () => {
    const id = await personId("Priya Natarajan");
    await page.goto(`${BASE}/work/people/${id}`);
    const cardEl = page.getByTestId("person-next-follow-up");
    await cardEl.waitFor();
    await cardEl.getByTestId("wait-add").click();
    await cardEl.getByTestId("wait-add-text").fill("The term sheet");
    await cardEl.getByTestId("wait-add-text").press("Enter");
    await until(async () => (await one("select count(*)::int n from waits where contact_id = $1", [id])).n === 2, "added with Enter");
    await openHome();
    await openAll();
    assert((await waitRow("Priya Natarajan").getAttribute("data-lines")) === "2", "two lines on the card");
    await page.goto(`${BASE}/work/people/${id}`);
    await page.getByTestId("person-next-follow-up").getByTestId("wait-line").filter({ hasText: "The term sheet" }).getByTestId("wait-remove").click();
    await until(async () => (await one("select count(*)::int n from waits where contact_id = $1", [id])).n === 1, "removed");
  });

  await step("Job item page: the same list (Lumen waits on Jamal Whitaker)", async () => {
    const id = (await one("select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'job' and i.name = 'Lumen Industrial Holdings'")).id;
    await page.goto(`${BASE}/work/jobs/${id}`);
    const list = page.getByTestId("item-next-action").getByTestId("waits-list");
    await list.waitFor();
    assert(JSON.stringify(await list.getByTestId("wait-text").allInnerTexts()) === JSON.stringify(["Jamal Whitaker"]), "Lumen's wait");
  });

  await step("Edits of Nov 5, item 6: Pinecrest's deal page shows the Nov 4 reply as a green 'Dana replied' pill with Clear on its wait, as the Waiting card does", async () => {
    const id = await dealId("Pinecrest Landscaping");
    await page.goto(`${BASE}/work/deals/${id}`);
    const cardEl = page.getByTestId("deal-next-action");
    await cardEl.waitFor();
    // The reply is on the Timeline...
    assert((await page.locator("body").innerText()).includes("Re: Pinecrest LOI"), "the reply on the Timeline");
    // ...and now on the wait.
    const line = cardEl.getByTestId("wait-line").filter({ hasText: 'Dana Whitfield\'s reply to your email "Pinecrest LOI"' });
    assert((await line.getAttribute("data-replied")) === "1", "marked replied");
    assert((await line.getByTestId("wait-replied").innerText()) === `Dana replied ${short(addDays(today, -1))}` && (await line.getByTestId("wait-replied").getAttribute("data-tone")) === "green", await line.innerText());
    assert((await line.getByTestId("wait-clear").innerText()) === "Clear" && (await line.getByTestId("wait-remove").count()) === 0, "Clear in place of the x");
    // The same day as the Waiting card shows.
    await shot("pinecrest-next-action-replied-1440.png", cardEl);
    await openHome();
    await openAll();
    assert((await waitRow("Pinecrest Landscaping").getByTestId("waiting-replied").innerText()) === `Dana replied ${short(addDays(today, -1))}`, "the card agrees");
  });

  await step("Edits of Nov 5, item 6: a job item's waits list shows Replied after a reply to the email the wait came from; Clear removes the wait", async () => {
    const owner = (await one("select id from auth.users limit 1")).id;
    const lumen = (await one("select i.id, i.primary_contact_id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'job' and i.name = 'Lumen Industrial Holdings'"));
    const sent = await one("insert into communications (owner_id, occurred_at, method, direction, contact_id, subject, gmail_thread_id, pipeline_item_id) values ($1, $2, 'email', 'outgoing', $3, 'Second interview dates', 'check-e2-lumen', $4) returning id", [owner, `${addDays(today, -3)}T15:00:00Z`, lumen.primary_contact_id, lumen.id]);
    await db.query("insert into communications (owner_id, occurred_at, method, direction, contact_id, subject, gmail_thread_id, pipeline_item_id) values ($1, $2, 'email', 'incoming', $3, 'Re: Second interview dates', 'check-e2-lumen', $4)", [owner, `${addDays(today, -1)}T15:00:00Z`, lumen.primary_contact_id, lumen.id]);
    await db.query("insert into waits (owner_id, pipeline_item_id, text, since, comm_id) values ($1, $2, 'Reply to your email: Second interview dates', $3, $4)", [owner, lumen.id, addDays(today, -3), sent.id]);
    await page.goto(`${BASE}/work/jobs/${lumen.id}`);
    const list = page.getByTestId("item-next-action").getByTestId("waits-list");
    await list.waitFor();
    const line = list.getByTestId("wait-line").filter({ hasText: "Second interview dates" });
    // A wait saved in the older wording keeps its text; the pill names the person the email went to.
    assert((await line.getByTestId("wait-text").innerText()).trim() === "Reply to your email: Second interview dates", await line.innerText());
    assert((await line.getByTestId("wait-replied").innerText()) === `Jamal replied ${short(addDays(today, -1))}`, await line.innerText());
    // The other wait (no email) keeps its x.
    assert((await list.getByTestId("wait-line").filter({ hasText: "Jamal Whitaker" }).getByTestId("wait-remove").count()) === 1, "the x on the other wait");
    await line.getByTestId("wait-clear").click();
    await until(async () => (await one("select count(*)::int n from waits where comm_id = $1", [sent.id])).n === 0, "Clear removes the wait");
    await until(async () => (await list.getByTestId("wait-line").filter({ hasText: "Second interview dates" }).count()) === 0, "the line goes");
    assert((await one("select count(*)::int n from waits where pipeline_item_id = $1", [lumen.id])).n === 1, "Jamal Whitaker stays");
  });

  await step("Follow up watches both emails: after Follow up, a reply to the ORIGINAL email shows Replied; Since stays the follow-up day", async () => {
    const id = await dealId("Dalton Services");
    const orig = await send(`/work/deals/${id}`, "deal-email", "Dalton LOI", "Here is our LOI for Dalton Services.");
    await backdate(orig.id, 6);
    await openHome();
    await openGroup("no-reply");
    await noReplyRow("Dalton LOI").getByTestId("no-reply-add").click();
    await until(async () => (await noReplyRow("Dalton LOI").count()) === 0, "added");
    await openHome();
    await openAll();
    const row = waitRow("Dalton Services");
    await followUp(row, "reply to your email \"Dalton LOI\"");
    const w = await one("select w.since::text since, w.comm_id, f.subject fsubject, f.gmail_thread_id fthread from waits w left join communications f on f.id = w.follow_up_comm_id where w.comm_id = $1", [orig.id]);
    assert(w && w.since === today && w.comm_id === orig.id && w.fsubject && w.fthread && w.fthread !== orig.gmail_thread_id, JSON.stringify(w));
    // Rachel answers the original LOI email, not the follow-up.
    await g("/__reply", { threadId: orig.gmail_thread_id, from: "Rachel Kim <rachel.kim@example.com>", text: "Seller is reviewing the LOI." });
    await lookForReplies();
    await openAll();
    const line = waitRow("Dalton Services").getByTestId("waiting-line").filter({ hasText: "reply to your email \"Dalton LOI\"" });
    const to = (await one("select c.name from communications m join contacts c on c.id = m.contact_id where m.id = $1", [orig.id]))?.name;
    assert(to && (await line.getByTestId("waiting-what").innerText()).trim() === `${to}'s reply to your email "Dalton LOI"`, await line.innerText());
    assert((await line.getByTestId("waiting-replied").innerText()) === `${to.split(" ")[0]} replied ${short(today)}`, await line.innerText());
    assert((await line.getByTestId("waiting-clear").count()) === 1, "Clear on that line");
    assert((await one("select since::text s from waits where comm_id = $1", [orig.id])).s === today, "Since stays the follow-up day");
  });

  await step("Follow up on a person, and a reply to the follow-up shows Replied too; Clear removes only that line", async () => {
    const id = await personId("Sam Patel");
    const orig = await send(`/work/people/${id}`, "person-page-email", "Carriers this winter", "Any carriers thinking about selling?");
    await backdate(orig.id, 3);
    await openHome();
    await openGroup("no-reply");
    await noReplyRow("Carriers this winter").getByTestId("no-reply-add").click();
    await until(async () => (await noReplyRow("Carriers this winter").count()) === 0, "added");
    await openHome();
    await openAll();
    await followUp(waitRow("Sam Patel"), 'Sam Patel\'s reply to your email "Carriers this winter"');
    const f = await one("select f.gmail_thread_id t from waits w join communications f on f.id = w.follow_up_comm_id where w.comm_id = $1", [orig.id]);
    await g("/__reply", { threadId: f.t, from: "Sam Patel <sam.patel@example.com>", text: "Two of them. Call me." });
    await lookForReplies();
    // Edits of Nov 5, item 6: the person page's Next follow-up card shows Replied and Clear too.
    await page.goto(`${BASE}/work/people/${id}`);
    const personLine = page.getByTestId("person-next-follow-up").getByTestId("wait-line").filter({ hasText: "Carriers this winter" });
    await personLine.waitFor();
    assert((await personLine.getByTestId("wait-replied").innerText()) === `Sam replied ${short(today)}` && (await personLine.getByTestId("wait-clear").count()) === 1, await personLine.innerText());
    await openHome();
    await openAll();
    const row = waitRow("Sam Patel");
    assert((await row.getByTestId("waiting-replied").innerText()) === `Sam replied ${short(today)}`, await row.innerText());
    await row.getByTestId("waiting-clear").click();
    await until(async () => (await waitRow("Sam Patel").count()) === 0, "the row goes with its last line");
    assert((await one("select count(*)::int n from waits where comm_id = $1", [orig.id])).n === 0, "removed");
    const d = await one("select (select no_reply_dismissed_at from communications where id = $1) a, (select no_reply_dismissed_at from communications where gmail_thread_id = $2 and direction = 'outgoing') b", [orig.id, f.t]);
    assert(d.a && d.b, `both emails stay off No reply yet: ${JSON.stringify(d)}`);
  });

  await step("Advance on a deal clears its waits (both lines)", async () => {
    const id = await dealId("BrightPath Home Care");
    await page.goto(`${BASE}/work/deals/${id}`);
    await page.getByTestId("deal-advance").click();
    await until(async () => (await one("select count(*)::int n from waits where pipeline_item_id = $1", [id])).n === 0, "cleared");
    await openHome();
    await openAll();
    assert((await waitRow("BrightPath Home Care").count()) === 0, "off the card");
  });

  await step("Reports, The week: the four past-week buttons look like the period pills; the chosen one is blue; Back to this week shows and does what This week does", async () => {
    await page.goto(`${BASE}/work/reports`);
    await page.getByTestId("past-weeks").waitFor();
    const weeks = page.getByTestId("past-week");
    assert((await weeks.count()) === 4, "four weeks");
    const style = (loc) => loc.evaluate((e) => { const s = getComputedStyle(e); return { radius: parseFloat(s.borderTopLeftRadius), border: s.borderTopWidth, borderColor: s.borderTopColor, bg: s.backgroundColor }; });
    const pillOff = await style(page.getByTestId("reports-period-last"));
    const pillOn = await style(page.getByTestId("reports-period-this"));
    const w0 = await style(weeks.nth(0));
    assert(w0.radius >= 12 && w0.border === pillOff.border && w0.borderColor === pillOff.borderColor && w0.bg === "rgb(255, 255, 255)", `a white pill with a border: ${JSON.stringify(w0)} vs ${JSON.stringify(pillOff)}`);
    assert((await page.getByTestId("back-to-this-week").count()) === 0, "no Back link on this week");
    // Hover: the background changes.
    await weeks.nth(1).hover();
    assert((await style(weeks.nth(1))).bg !== "rgb(255, 255, 255)", "hover");
    await weeks.nth(1).click();
    await page.waitForURL(/period=w2|period=last/);
    await until(async () => (await weeks.nth(1).getAttribute("data-chosen")) === "1", "chosen");
    // Off the button, once the color change has finished.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const on = await style(weeks.nth(1));
    assert(on.bg === pillOn.bg && on.borderColor === pillOn.borderColor, `the chosen pill's fill and border: ${JSON.stringify(on)} vs ${JSON.stringify(pillOn)}`);
    assert((await page.getByTestId("most-missed").isVisible()) && (await page.getByTestId("back-to-this-week").isVisible()), "Most missed and Back to this week");
    // Back at the right end of the row; the four buttons share one width and one top.
    const row = await page.getByTestId("past-weeks").boundingBox();
    const back = await page.getByTestId("back-to-this-week").boundingBox();
    assert(Math.abs(row.x + row.width - 20 - (back.x + back.width)) <= 2, `Back at the right end: ${back.x + back.width} vs ${row.x + row.width - 20}`);
    const boxes = await weeks.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.top)]; }));
    assert(new Set(boxes.map((b) => b[0])).size === 1 && new Set(boxes.map((b) => b[1])).size === 1, `widths and tops ${JSON.stringify(boxes)}`);
    await page.locator("main").evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot("reports-week-past-week-chosen-1440.png");
    await page.getByTestId("back-to-this-week").click();
    await page.waitForURL((u) => !u.search.includes("period="));
    assert((await page.getByTestId("reports-period-this").getAttribute("aria-pressed")) === "true", "This week chosen");
    assert((await page.getByTestId("back-to-this-week").count()) === 0, "the link goes");
    // Phone width: no sideways scroll, the buttons still line up two by two.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("past-week").nth(2).click();
    await page.getByTestId("back-to-this-week").waitFor();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 0, `scrolls sideways by ${over}px`);
    const phone = await weeks.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.left)]; }));
    assert(new Set(phone.map((b) => b[0])).size === 1 && new Set(phone.map((b) => b[1])).size === 2, `phone ${JSON.stringify(phone)}`);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("Edits of Nov 5, item 3: Reports, The week: the line by 'How the week went' reads 'This week, Nov 2 to 6 · partial, through today, Thu Nov 5' (real dates), 'Week of Oct 12 to 16' for a past week; one line, larger and darker; no note about when targets are judged", async () => {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const monday = addDays(today, -((dow + 6) % 7));
    const friday = addDays(monday, 4);
    const span = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${short(a)} to ${Number(b.slice(8, 10))}` : `${short(a)} to ${short(b)}`);
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const eod = await one("select status from end_of_day where day = $1", [today]);
    const open = dow >= 1 && dow <= 5 && (today < friday || !eod || eod.status === "open");
    await page.goto(`${BASE}/work/reports`);
    const lead = page.getByTestId("period-lead");
    await lead.waitFor();
    const want = `This week, ${span(monday, friday)}${open ? ` · partial, through today, ${DAYS[dow]} ${short(today)}` : ""}`;
    assert((await lead.innerText()) === want, `${await lead.innerText()} vs ${want}`);
    assert(!/judged/i.test(await lead.innerText()), "the targets note moved out");
    const look = await lead.evaluate((e) => {
      const s = getComputedStyle(e.parentElement);
      const r = e.parentElement.getBoundingClientRect();
      // The slate-600 and slate-700 of the app's own styles, to compare with.
      const ref = (cls) => {
        const x = document.createElement("span");
        x.className = cls;
        document.body.appendChild(x);
        const c = getComputedStyle(x).color;
        x.remove();
        return c;
      };
      return { size: parseFloat(s.fontSize), weight: s.fontWeight, color: s.color, slate: [ref("text-slate-600"), ref("text-slate-700")], height: r.height, lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5 };
    });
    assert(look.size >= 13.5 && look.size <= 14 && Number(look.weight) === 500 && look.slate.includes(look.color), JSON.stringify(look));
    assert(look.height <= look.lineHeight + 2, `one line: ${JSON.stringify(look)}`);
    await shot("reports-week-line-this-week-1440.png", page.getByTestId("reports-group-went").locator("[data-testid=reports-group-heading]"));
    // A past week.
    await page.goto(`${BASE}/work/reports?period=w2`);
    await page.locator("[data-testid=week-view][data-period=w2]").waitFor();
    const w2 = addDays(monday, -14);
    assert((await page.getByTestId("period-lead").innerText()) === `Week of ${span(w2, addDays(w2, 4))}`, await page.getByTestId("period-lead").innerText());
  });

  await step("End of day, Today tiles: next actions done split by area, to-dos done, and people in 'waiting 5+ days'; the report's broker section stays deals only", async () => {
    // A known day: the next actions done today and the to-dos and tasks checked off today are set here.
    const owner = (await one("select id from auth.users limit 1")).id;
    await db.query("delete from work_events where kind = 'next_action_done' and happened_on = $1", [today]);
    await db.query("update deal_todos set done_at = null where done_at >= $1::date - 1", [today]);
    const ids = await one(`select
      (select id from pipeline_items where name = 'Dalton Services') dalton,
      (select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'job' and i.status = 'open' order by i.name limit 1) job,
      (select i.id from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = 'consulting' and i.status = 'open' order by i.name limit 1) con,
      (select id from projects order by name limit 1) project,
      (select id from deal_todos where record_type = 'pipeline_items' and record_id = (select id from pipeline_items where name = 'Summit Logistics Group') limit 1) summit_task,
      (select id from deal_todos where record_id = (select id from pipeline_items where name = 'Summit Logistics Group') or deal_id = (select id from pipeline_items where name = 'Summit Logistics Group') limit 1) summit_any`);
    const ev = (type, id, label, action) => db.query("insert into work_events (owner_id, kind, record_type, record_id, label, happened_on, happened_at, meta) values ($1, 'next_action_done', $2, $3, $4, $5, now(), $6)", [owner, type, id, label, today, { action }]);
    await ev("pipeline_items", ids.dalton, "Dalton Services", "Review the CIM");
    await ev("projects", ids.project, "A project", "Ship the screens");
    await ev("pipeline_items", ids.job, "A job", "Send the thank-you");
    await ev("pipeline_items", ids.con, "A client", "Send the scope");
    let task = ids.summit_task || ids.summit_any;
    if (!task) task = (await one("insert into deal_todos (owner_id, record_type, record_id, deal_id, text, position) values ($1, 'pipeline_items', (select id from pipeline_items where name = 'Summit Logistics Group'), (select id from pipeline_items where name = 'Summit Logistics Group'), 'Ask Mark for the date', 1) returning id", [owner])).id;
    await db.query("update deal_todos set done_at = now() where id = $1", [task]);
    const todos = await all("select id, text from deal_todos where record_id is null and deal_id is null order by text limit 2");
    await db.query("update deal_todos set done_at = now() where id = any($1)", [todos.map((t) => t.id)]);
    // Edits of Nov 5 (item 5): the waits of 5+ days, each counted (not the deals and people).
    const waiting = await one(`select
      (select count(*)::int from waits w join pipeline_items i on i.id = w.pipeline_item_id join pipelines p on p.id = i.pipeline_id join pipeline_stages s on s.id = i.stage_id
        where p.kind = 'acquisition' and i.screened and i.status = 'open' and s.outcome = 'open' and w.since <= $1::date - 5) deals,
      (select count(*)::int from waits w join contacts c on c.id = w.contact_id where c.archived_at is null and w.since <= $1::date - 5) people`, [today]);
    assert(waiting.people >= 1, `a person waited on 5+ days: ${JSON.stringify(waiting)}`);

    await page.goto(`${BASE}/work/end-of-day`);
    const strip = page.getByTestId("eod-today");
    await strip.waitFor();
    // The Today tiles (2026-11-05): a number over its label; Next actions done carries the split by area. A follow-up
    // marked Done today (Contacts) counts too, so the split names Contacts when the sample has one today.
    const tile = async (key) => {
      const t = strip.locator(`[data-testid=eod-today-part][data-key=${key}]`);
      return { n: Number(await t.getAttribute("data-count")), text: (await t.innerText()).replace(/\s+/g, " ").trim() };
    };
    const followUpsToday = (await one("select count(*)::int n from work_events where kind = 'follow_up_done' and happened_on = $1", [today])).n;
    const done = await tile("done");
    const split = `Deals 2${followUpsToday ? ` · Contacts ${followUpsToday}` : ""} · Rosara 1 · Job search 1 · Consulting 1`;
    assert(done.n === 5 + followUpsToday && done.text === `${5 + followUpsToday} NEXT ACTIONS DONE ${split}`, done.text);
    const todosTile = await tile("todos");
    assert(todosTile.n === 2 && todosTile.text === "2 TO-DOS DONE", todosTile.text);
    const waitsTile = await tile("waits");
    assert(waitsTile.n === waiting.deals + waiting.people && waitsTile.text === `${waiting.deals + waiting.people} WAITING 5+ DAYS`, `${waitsTile.text} vs ${JSON.stringify(waiting)}`);
    await shot("end-of-day-today-tiles-1440.png", strip);
    // Phone width: two tiles a row, Next actions done two wide; the split wraps between areas, never inside one; no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 0, `scrolls sideways by ${over}px`);
    const areaChunks = await strip.locator("[data-testid=eod-today-areas] > span > span").evaluateAll((els) => els.map((e) => new Set([...e.getClientRects()].map((r) => Math.round(r.top))).size));
    assert(areaChunks.length === (followUpsToday ? 5 : 4) && areaChunks.every((n) => n === 1), `an area split inside: ${areaChunks}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The drawers.
    await strip.locator('[data-key="done"]').click();
    let drawer = page.getByTestId("eod-today-drawer");
    await drawer.waitFor();
    const doneItems = await drawer.getByTestId("eod-today-item").allInnerTexts();
    assert(doneItems.length === 5 + followUpsToday && /^Dalton Services\nDeals · Review the CIM/.test(doneItems[0]) && doneItems.some((t) => t.includes("Rosara · Ship the screens")), JSON.stringify(doneItems));
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await strip.locator('[data-key="todos"]').click();
    drawer = page.getByTestId("eod-today-drawer");
    await drawer.waitFor();
    assert(JSON.stringify((await drawer.getByTestId("eod-today-item").allInnerTexts()).map((t) => t.trim()).sort()) === JSON.stringify(todos.map((t) => t.text).sort()), "the to-dos");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    await strip.locator('[data-key="waits"]').click();
    drawer = page.getByTestId("eod-today-drawer");
    await drawer.waitFor();
    const waitItems = await drawer.getByTestId("eod-today-item").allInnerTexts();
    assert(waitItems.length === waiting.deals + waiting.people && waitItems.some((t) => t.startsWith("Priya Natarajan") && t.includes("· Contacts")), JSON.stringify(waitItems));
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    // The partner report's "Waiting on brokers 5+ days" stays deals only.
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    const preview = await page.getByTestId("report-preview").innerText();
    const waitPart = preview.slice(preview.search(/Waiting on brokers/i), preview.search(/Waiting on brokers/i) + 400);
    assert(/Waiting on brokers/i.test(preview) && waitPart.includes("Summit") && !preview.includes("Priya Natarajan"), waitPart);
    await page.keyboard.press("Escape");
  });

  await step("Edits of Nov 5, items 4 and 5: every End of day panel row is a link to its record (same tab, the row hover); 'waiting 5+ days' counts waits, so a deal with two such waits counts 2", async () => {
    const owner = (await one("select id from auth.users limit 1")).id;
    const summit = await dealId("Summit Logistics Group");
    // A second wait of 5+ days on Summit: one more in the count, and Summit twice in the panel.
    await db.query("insert into waits (owner_id, pipeline_item_id, text, since) values ($1, $2, 'Three years of tax returns', $3)", [owner, summit, addDays(today, -7)]);
    const over = await openWaits(5);
    const dalton = await dealId("Dalton Services");
    const priya = await personId("Priya Natarajan");
    await page.goto(`${BASE}/work/end-of-day`);
    const strip = page.getByTestId("eod-today");
    await strip.waitFor();
    assert(Number(await strip.locator('[data-key="waits"]').getAttribute("data-count")) === over, `waits ${await strip.locator('[data-key="waits"]').getAttribute("data-count")} vs ${over}`);
    const parts = await strip.locator("[data-testid=eod-today-part]").evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.dataset.count)]));
    let checked = 0;
    for (const [key, count] of parts) {
      if (!count) continue;
      await strip.locator(`[data-key="${key}"]`).click();
      const drawer = page.getByTestId("eod-today-drawer");
      await drawer.waitFor();
      const items = drawer.getByTestId("eod-today-item");
      const links = await drawer.getByTestId("eod-today-link").evaluateAll((els) => els.map((e) => ({ href: e.getAttribute("href"), target: e.getAttribute("target"), hover: e.classList.contains("row-hover"), text: e.innerText })));
      assert(links.length === (await items.count()) && links.length > 0, `${key}: ${links.length} links for ${await items.count()} rows`);
      assert(links.every((l) => l.href && l.href.startsWith("/work/") && !l.target && l.hover), `${key}: ${JSON.stringify(links)}`);
      if (key === "waits") {
        assert(links.length === over && links.filter((l) => l.text.startsWith("Summit Logistics Group")).length === 2, JSON.stringify(links));
        assert(links.find((l) => l.text.startsWith("Summit Logistics Group")).href === `/work/deals/${summit}` && links.find((l) => l.text.startsWith("Priya Natarajan")).href === `/work/people/${priya}`, JSON.stringify(links));
        await shot("end-of-day-waiting-panel-links-1440.png");
      }
      if (key === "todos") assert(links.every((l) => l.href === "/work/todos"), JSON.stringify(links));
      if (key === "done") assert(links.some((l) => l.href === `/work/deals/${dalton}`) && links.some((l) => l.href.startsWith("/work/rosara/")) && links.some((l) => l.href.startsWith("/work/jobs/")) && links.some((l) => l.href.startsWith("/work/consulting/")), JSON.stringify(links));
      if (key === "emails") assert(links.some((l) => l.href === `/work/deals/${dalton}`), `the Dalton email opens the deal: ${JSON.stringify(links)}`);
      checked++;
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
    }
    assert(checked >= 3, `panels checked: ${checked}`);
    // A row hovers like the app's other rows and opens its record in the same tab.
    await strip.locator('[data-key="waits"]').click();
    const first = page.getByTestId("eod-today-drawer").getByTestId("eod-today-link").filter({ hasText: "Summit Logistics Group" }).first();
    await first.hover();
    await page.waitForTimeout(300);
    const hoverBg = await first.evaluate((e) => getComputedStyle(e).backgroundColor);
    assert(hoverBg === "rgb(241, 245, 249)", `the row hover: ${hoverBg}`);
    const pages = ctx.pages().length;
    await first.click();
    await page.waitForURL(new RegExp(`/work/deals/${summit}$`));
    assert(ctx.pages().length === pages, "same tab");
    // The report's broker section stays one entry per deal.
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    const preview = await page.getByTestId("report-preview").innerText();
    assert((preview.match(/Summit Logistics Group/g) || []).length >= 1 && !preview.includes("Three years of tax returns"), "the broker section is one line per deal");
    await page.keyboard.press("Escape");
    await db.query("delete from waits where pipeline_item_id = $1 and text = 'Three years of tax returns'", [summit]);
  });

  // ---------- End of day top areas (2026-11-05): Today tiles (Option A) and the report card (Option B) ----------
  const eodTop = async () => {
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("eod-today").waitFor();
    await page.getByTestId("report-card").waitFor();
    await page.waitForLoadState("networkidle");
  };

  await step("End of day: the 'Before you send' line under the title is gone; the TODAY label and the report card's top line up; the tiles are 4 a row (2 on the phone), Next actions done two wide", async () => {
    await eodTop();
    assert(!(await page.getByTestId("eod-sticky").innerText()).toLowerCase().includes("before you send") && (await page.getByTestId("eod-status").count()) === 0, "the old line under the title");
    assert((await page.getByTestId("report-status-line").count()) === 0, "no orange status line while the day is open");
    const tops = async () => page.evaluate(() => ({ today: Math.round(document.querySelector("[data-testid=eod-today]").getBoundingClientRect().top), card: Math.round(document.querySelector("[data-testid=report-card]").getBoundingClientRect().top), left: Math.round(document.querySelector("[data-testid=eod-left]").getBoundingClientRect().top) }));
    const t = await tops();
    assert(Math.abs(t.today - t.card) <= 1 && t.today === t.left, `tops ${JSON.stringify(t)}`);
    const boxes = async () => page.getByTestId("eod-today-part").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { key: e.dataset.key, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }));
    let b = await boxes();
    assert(b.map((x) => x.key).join(",") === "screened,moved,calls,emails,done,todos,waits", JSON.stringify(b));
    assert(new Set(b.slice(0, 4).map((x) => x.top)).size === 1 && new Set(b.slice(4).map((x) => x.top)).size === 1 && b[4].top > b[0].top, `rows of 4: ${JSON.stringify(b)}`);
    assert(Math.abs(b[4].w - (b[0].w * 2 + 8)) <= 2, `Next actions done two wide: ${JSON.stringify(b)}`);
    // The tiles of a row are the same height, so the numbers and labels stay level.
    assert(new Set(b.slice(0, 4).map((x) => x.h)).size === 1 && new Set(b.slice(4).map((x) => x.h)).size === 1, `heights ${JSON.stringify(b)}`);
    // A zero is light gray; Waiting is red above 0.
    // Colors compared as the browser draws them (Tailwind's colors are lab()): the gray of slate-400, the red of the missed status.
    const ref = await page.evaluate(() => {
      const probe = (cls) => { const e = document.createElement("span"); e.className = cls; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
      return { gray: probe("text-slate-400"), red: probe("text-status-missed"), ink: probe("text-slate-900") };
    });
    const colors = await page.getByTestId("eod-today-part").evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.dataset.count), getComputedStyle(e.querySelector("[data-testid=eod-today-value]")).color]));
    for (const [key, n, color] of colors) {
      if (!n) assert(color === ref.gray, `${key} zero: ${color} vs ${ref.gray}`);
      else if (key === "waits") assert(color === ref.red, `waits red: ${color} vs ${ref.red}`);
      else assert(color === ref.ink, `${key}: ${color} vs ${ref.ink}`);
    }
    await shot("end-of-day-top-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    b = await boxes();
    assert(b[0].top === b[1].top && b[2].top === b[3].top && b[2].top > b[0].top && b[4].top > b[2].top && b[5].top === b[6].top && b[5].top > b[4].top, `2 a row: ${JSON.stringify(b)}`);
    assert(Math.abs(b[4].w - (b[0].w * 2 + 8)) <= 2, "two wide on the phone");
    assert((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, "no sideways scroll");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("End of day: each Today tile opens its panel (the existing side panel), listing what it counts", async () => {
    await eodTop();
    const titles = { screened: "Listings screened today", moved: "Deals moved today", calls: "Calls today", emails: "Emails sent today", done: "Next actions done today", todos: "To-dos done today", waits: "Waiting on someone" };
    const tiles = await page.getByTestId("eod-today-part").evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.dataset.count)]));
    for (const [key, n] of tiles) {
      await page.locator(`[data-testid=eod-today-part][data-key=${key}]`).click();
      const drawer = page.getByTestId("eod-today-drawer");
      await drawer.waitFor();
      assert((await drawer.innerText()).includes(titles[key]), `${key}: ${(await drawer.innerText()).slice(0, 80)}`);
      const items = await drawer.getByTestId("eod-today-item").count();
      assert(items === n || (key === "done" && items === n), `${key}: ${items} rows for ${n}`);
      if (!n) assert((await drawer.getByTestId("eod-today-empty").count()) === 1, `${key}: the empty line`);
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
    }
  });

  await step("End of day: the report card's 'Before you send' checklist: Reasons and Tomorrow's line with their states, 'N of M done', a click scrolls to the card and outlines it, a green check when done", async () => {
    await db.query("update end_of_day set tomorrow_line = '' where day = $1", [today]);
    await eodTop();
    const list = page.getByTestId("eod-checklist");
    const rows = async () => list.getByTestId("eod-check").evaluateAll((els) => els.map((e) => ({ key: e.dataset.key, done: e.dataset.done, state: e.dataset.state, text: e.innerText.replace(/\s+/g, " ").trim(), check: !!e.querySelector("svg") })));
    let r = await rows();
    const owed = Number(await list.getAttribute("data-owed"));
    assert(r.map((x) => x.key).join(",") === "reasons,tomorrow", JSON.stringify(r));
    assert(r[0].state === (owed ? `${owed} left` : "Done") && r[0].text === `Reasons ${r[0].state}` && r[0].check === !owed, JSON.stringify(r[0]));
    assert(r[1].state === "Empty" && r[1].text === "Tomorrow's line Empty" && !r[1].check, JSON.stringify(r[1]));
    const doneN = r.filter((x) => x.done === "1").length;
    assert((await list.innerText()).toUpperCase().startsWith("BEFORE YOU SEND") && (await page.getByTestId("eod-checklist-count").innerText()) === `${doneN} of 2 done`, await page.getByTestId("eod-checklist-count").innerText());
    // The buttons sit right under the checklist.
    const below = await page.evaluate(() => document.querySelector("[data-testid=report-acts]").getBoundingClientRect().top >= document.querySelector("[data-testid=eod-checklist]").getBoundingClientRect().bottom);
    assert(below, "View report and Approve and send under the checklist");
    // A click on Tomorrow's line scrolls to its card and outlines it for a moment.
    await list.locator("[data-testid=eod-check][data-key=tomorrow]").click();
    await until(async () => (await page.locator("#eod-tomorrow").getAttribute("class")).includes("field-flash"), "the card is outlined");
    await page.waitForTimeout(800);
    const inView = await page.evaluate(() => { const b = document.getElementById("eod-tomorrow").getBoundingClientRect(); return b.top >= 0 && b.top < window.innerHeight; });
    assert(inView, "scrolled to the card");
    await until(async () => !(await page.locator("#eod-tomorrow").getAttribute("class")).includes("field-flash"), "the outline goes");
    // A click on Reasons goes to the Targets card.
    await list.locator("[data-testid=eod-check][data-key=reasons]").click();
    await until(async () => (await page.locator("#eod-targets").getAttribute("class")).includes("field-flash"), "the Targets card is outlined");
    // Writing tomorrow's line turns its row green with a check.
    await page.getByTestId("tomorrow-input").fill("Call Mark Reed about the Summit seller call at 10.");
    await page.getByTestId("tomorrow-input").blur();
    await until(async () => (await list.locator("[data-testid=eod-check][data-key=tomorrow]").getAttribute("data-state")) === "Done", "Tomorrow's line Done");
    r = await rows();
    assert(r[1].check && r[1].done === "1", JSON.stringify(r[1]));
    const color = await list.locator("[data-testid=eod-check][data-key=tomorrow] > span").last().evaluate((e) => { const p = document.createElement("span"); p.className = "text-status-met"; document.body.appendChild(p); const g = getComputedStyle(p).color; p.remove(); return getComputedStyle(e).color === g; });
    assert(color, "Done in green");
    const count = await page.getByTestId("eod-checklist-count").innerText();
    assert(count === (owed ? "1 of 2 done" : "All done"), count);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("end-of-day-report-card-1440.png", page.getByTestId("report-card"));
  });

  await step("End of day: the partner table (Partner | Gets | Sections) replaces the section sentences; View shows a partner's sections as a list", async () => {
    await eodTop();
    const table = page.getByTestId("eod-partners");
    await table.waitFor();
    assert((await page.getByTestId("report-includes").count()) === 0, "no run-on section sentence");
    const head = (await table.locator("div").first().innerText()).replace(/\s+/g, " ").trim();
    assert(head === "PARTNER GETS SECTIONS", head);
    const jake = table.locator("[data-testid=eod-partner][data-partner=Jake]");
    assert((await jake.getByTestId("eod-partner-gets").innerText()) === "Weekdays", "Gets Weekdays");
    const count = await jake.getByTestId("eod-partner-count").innerText();
    assert(/^\d+ sections?$/.test(count), count);
    assert((await jake.getByTestId("eod-partner-sections").count()) === 0 && (await jake.getByTestId("eod-partner-view").innerText()) === "View", "closed at first");
    await jake.getByTestId("eod-partner-view").click();
    const sections = (await jake.getByTestId("eod-partner-sections").innerText()).split(", ");
    assert(sections.length === Number(count.split(" ")[0]) && sections[0].length > 0, `${count}: ${sections.join(" | ")}`);
    assert((await jake.getByTestId("eod-partner-view").innerText()) === "Hide", "Hide");
    await shot("end-of-day-partner-table-view-1440.png", page.getByTestId("report-card"));
    // The columns line up across rows: Gets and Sections start at the same x as their headings.
    const xs = await table.evaluate((el) => { const head = el.firstElementChild.children; const row = el.querySelector("[data-testid=eod-partner] > div").children; return [0, 1, 2].map((i) => Math.round(head[i].getBoundingClientRect().left) === Math.round(row[i].getBoundingClientRect().left)); });
    assert(xs.every(Boolean), `columns ${xs}`);
    await jake.getByTestId("eod-partner-view").click();
    assert((await jake.getByTestId("eod-partner-sections").count()) === 0, "Hide closes it");
  });

  // Fix list item 1 (approved 2026-11-06): a checkbox per partner, ticked by default; unticked skips that partner today.
  await step("End of day partner checkboxes: ticked by default; untick in the table and the View report window matches (one setting, kept on reload); the name opens the person; Manage partners opens Contacts", async () => {
    await eodTop();
    const table = page.getByTestId("eod-partners");
    await table.waitFor();
    const rowOf = (who) => table.locator(`[data-testid=eod-partner][data-partner=${who}]`);
    const sarahId = (await one("select id from contacts where email = 'sarah.klein@example.com'")).id;
    const checks = await table.getByTestId("eod-partner-check").evaluateAll((els) => els.map((e) => e.checked));
    assert(checks.length >= 2 && checks.every(Boolean), `ticked by default ${checks}`);
    assert((await rowOf("Sarah").getByTestId("eod-partner-name").getAttribute("href")) === `/work/people/${sarahId}`, "the name opens Sarah's page");
    assert((await page.getByTestId("eod-manage-partners").getAttribute("href")) === "/work/people?view=people", "Manage partners opens Contacts");
    const sendCount = async () => Number(await page.getByTestId("report-send").getAttribute("data-count"));
    const n = await sendCount();
    await rowOf("Sarah").getByTestId("eod-partner-check").uncheck();
    await until(async () => (await rowOf("Sarah").getAttribute("data-on")) === "0" && (await sendCount()) === n - 1, "Sarah is unticked and Approve and send counts one fewer");
    assert((await rowOf("Sarah").getByTestId("eod-partner-count").innerText()) === "Skipped today", "Skipped today");
    await until(async () => JSON.stringify((await one("select skipped_partners from end_of_day where day = $1", [today]))?.skipped_partners) === JSON.stringify([sarahId]), "saved for today");
    await shot("end-of-day-partner-unticked-1440.png", page.getByTestId("report-card"));
    await page.reload();
    await until(async () => (await rowOf("Sarah").getAttribute("data-on")) === "0", "kept on reload");
    // The window shows the same setting; ticking there ticks the table too.
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    const inWin = page.getByTestId("report-window").locator("[data-testid=report-send-to-partner][data-partner=Sarah]");
    assert((await inWin.getAttribute("data-on")) === "0", "the window shows Sarah unticked");
    await shot("report-window-send-to-1440.png", page.getByTestId("report-window"));
    await inWin.getByTestId("report-send-to-check").check();
    await until(async () => (await inWin.getAttribute("data-on")) === "1" && (await rowOf("Sarah").getAttribute("data-on")) === "1", "ticked in the window and in the table");
    await page.keyboard.press("Escape");
    await until(async () => JSON.stringify((await one("select skipped_partners from end_of_day where day = $1", [today]))?.skipped_partners) === "[]", "every partner ticked again");
  });

  await step("Item 2: Done on a Contacts follow-up raises 'next actions done' under Contacts (the person's name, the follow-up note), and still counts toward Follow-ups on time", async () => {
    const reed = await one("select id, follow_up_note from contacts where name = 'Mark Reed'");
    await eodTop();
    const before = Number(await page.locator("[data-testid=eod-today-part][data-key=done]").getAttribute("data-count"));
    const contactsBefore = Number(((await page.locator("[data-testid=eod-today-part][data-key=done]").innerText()).match(/Contacts (\d+)/) || [0, 0])[1]);
    const followUpsBefore = (await one("select count(*)::int n from work_events where kind = 'follow_up_done' and happened_on = $1", [today])).n;
    await page.goto(`${BASE}/work/people`);
    const row = page.locator(`[data-testid=person-row][data-person="${reed.id}"]`);
    await row.waitFor();
    await row.getByTestId("row-done").click();
    await row.getByTestId("person-done-ask").waitFor();
    await row.getByTestId("person-done-choice").first().click();
    await row.getByTestId("person-done-result").waitFor();
    await until(async () => (await one("select count(*)::int n from work_events where kind = 'follow_up_done' and happened_on = $1", [today])).n === followUpsBefore + 1, "the follow-up Done is recorded");
    await eodTop();
    const tile = page.locator("[data-testid=eod-today-part][data-key=done]");
    assert(Number(await tile.getAttribute("data-count")) === before + 1, `next actions done ${await tile.getAttribute("data-count")} after ${before}`);
    assert((await tile.innerText()).includes(`Contacts ${contactsBefore + 1}`), await tile.innerText());
    await tile.click();
    const drawer = page.getByTestId("eod-today-drawer");
    await drawer.waitFor();
    const link = drawer.getByTestId("eod-today-link").filter({ hasText: /^Mark ReedContacts/ });
    assert((await link.count()) === 1, `one row for the one Done: ${JSON.stringify(await drawer.getByTestId("eod-today-item").allInnerTexts())}`);
    assert((await link.innerText()).replace(/\s+/g, " ").trim() === `Mark Reed Contacts · ${reed.follow_up_note}`, await link.innerText());
    assert((await link.getAttribute("href")) === `/work/people/${reed.id}`, await link.getAttribute("href"));
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    // The Next actions done target and the report's Today tile agree; Follow-ups done on time still counts it.
    const target = page.locator("[data-testid=eod-target][data-target='Next actions done']");
    if (await target.count()) assert((await target.getByTestId("eod-figure").innerText()).startsWith(`${before + 1} of`), await target.innerText());
    await page.getByTestId("report-view").click();
    await page.getByTestId("report-window").waitFor();
    const preview = (await page.getByTestId("report-preview").innerText()).replace(/\s+/g, " ");
    assert(new RegExp(`NEXT ACTIONS DONE ${before + 1}\\b`, "i").test(preview) || preview.includes(`Next actions done ${before + 1}`), preview.slice(0, 600));
    await page.keyboard.press("Escape");
    const fu = page.locator("[data-testid=eod-target][data-target='Follow-ups done on time']");
    if (await fu.count()) assert((await fu.innerText()).includes("Mark Reed") || /\d+ of \d+/.test(await fu.innerText()), await fu.innerText());
  });

  // ---------- 2026-11-05: "+ Note" on the report sections, and the pending looks ----------

  // Watches a button from before the press: whether it ever read `label` with a spinner while disabled.
  const watchBusy = async (testIds, label) =>
    page.evaluate(
      ({ ids, label }) => {
        window.__busySeen = false;
        const look = () => {
          for (const id of ids)
            for (const b of document.querySelectorAll(`[data-testid="${id}"]`))
              if (b.textContent.includes(label) && b.querySelector("svg.animate-spin") && b.disabled) window.__busySeen = true;
        };
        if (window.__busyObs) window.__busyObs.disconnect();
        window.__busyObs = new MutationObserver(look);
        window.__busyObs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      },
      { ids: testIds, label },
    );
  const busySeen = () => page.evaluate(() => window.__busySeen === true);

  const TOP_NOTE = "Pinecrest is the one to watch.\nDana wants the seller-note numbers before Friday's call.";
  const TARGETS_NOTE = "Two CIMs came in late, so screening picks up tomorrow.";
  const win = () => page.getByTestId("report-window");
  const wsec = (key) => win().locator(`[data-testid="report-section"][data-section="${key}"]`);
  const addNote = async (key, text) => {
    await wsec(key).getByTestId("section-note-open").click();
    await wsec(key).getByTestId("section-note-text").fill(text);
    await wsec(key).getByTestId("section-note-save").click();
    await wsec(key).getByTestId("section-note").waitFor();
  };
  const notesInDb = async () => ((await one("select report_edits from end_of_day where day = $1", [today])) || {}).report_edits?._notes ?? {};

  await step("+ Note: the box opens under the section (placeholder, Save, Cancel, no AI star); Save shows the note under Top 3 deals with a thin left rule, 'Note added' by the title, Edit note and Remove note; it is saved once for the day", async () => {
    // Both partners get today's report (Sarah normally gets Fridays only).
    await db.query("update contacts set report_days = '{1,2,3,4,5,6,7}' where email = 'sarah.klein@example.com'");
    await page.goto(`${BASE}/work/end-of-day`);
    await page.getByTestId("report-view").click();
    await win().waitFor();
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Jake,"));
    // Every section with Edit has + Note, Tomorrow's line too.
    const sections = await win().getByTestId("report-section").evaluateAll((els) => els.filter((e) => e.dataset.included === "1").map((e) => [e.dataset.section, !!e.querySelector("[data-testid=section-edit]"), e.querySelector("[data-testid=section-note-open]")?.textContent]));
    assert(sections.length >= 5 && sections.every(([, edit, note]) => !edit || note === "+ Note"), JSON.stringify(sections));
    assert(sections.some(([k]) => k === "tomorrow"), "tomorrow's line is a section");
    await wsec("top").getByTestId("section-note-open").click();
    const box = wsec("top").getByTestId("section-note-box");
    await box.waitFor();
    assert((await wsec("top").getByTestId("section-note-text").getAttribute("placeholder")) === "Add a few lines for your partner: context, why it matters, what to watch", "placeholder");
    assert((await box.locator("[data-testid=ai-star], [data-testid*=ai-]").count()) === 0, "no AI star on the note box");
    const h1 = await wsec("top").getByTestId("section-note-text").evaluate((e) => e.getBoundingClientRect().height);
    await wsec("top").getByTestId("section-note-box").evaluate((e) => e.scrollIntoView({ block: "center" }));
    if (SHOTS) await win().screenshot({ path: path.join(SHOTS, "report-note-box-open-1440.png") });
    // It grows with the text, up to about 6 lines, then scrolls.
    await wsec("top").getByTestId("section-note-text").fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"));
    const h2 = await wsec("top").getByTestId("section-note-text").evaluate((e) => e.getBoundingClientRect().height);
    assert(h1 >= 60 && h1 <= 90 && h2 > h1 && h2 <= 140, `box heights ${h1} then ${h2}`);
    await wsec("top").getByTestId("section-note-cancel").click();
    assert((await wsec("top").getByTestId("section-note").count()) === 0 && (await wsec("top").getAttribute("data-note")) === "0", "Cancel saves nothing");
    await addNote("top", TOP_NOTE);
    const note = wsec("top").getByTestId("section-note");
    assert((await note.innerText()).replace(/\s+/g, " ").trim() === TOP_NOTE.replace(/\s+/g, " "), await note.innerText());
    const look = await note.locator("[data-note]").evaluate((e) => ({ rule: getComputedStyle(e).borderLeftWidth, ruleColor: getComputedStyle(e).borderLeftColor, color: getComputedStyle(e).color, br: e.querySelectorAll("br").length }));
    assert(look.rule === "3px" && look.color === "rgb(15, 23, 42)" && look.ruleColor === "rgb(30, 64, 175)" && look.br === 1, JSON.stringify(look));
    assert((await wsec("top").getByTestId("section-note-mark").innerText()) === "Note added", "the Note added mark");
    assert((await wsec("top").getByTestId("section-note-open").innerText()) === "Edit note" && (await wsec("top").getByTestId("section-note-remove").innerText()) === "Remove note", "Edit note and Remove note");
    await until(async () => (await notesInDb()).top === TOP_NOTE, "saved in report_edits._notes");
    const saved = (await one("select report_edits from end_of_day where day = $1", [today])).report_edits;
    assert(Object.keys(saved).every((k) => k === "_notes" || k === "_edited_at" || /^[0-9a-f-]{36}$/.test(k)), JSON.stringify(Object.keys(saved)));
    await wsec("top").getByTestId("section-note").evaluate((e) => e.scrollIntoView({ block: "center" }));
    if (SHOTS) await win().screenshot({ path: path.join(SHOTS, "report-note-top-3-deals-1440.png") });
  });

  await step("+ Note: a note sits above Edit's text too; the Targets note shows in Sarah's tab (one note for every copy); in her tab a left-out section shows 'Left out today, note not sent'", async () => {
    await addNote("targets", TARGETS_NOTE);
    await page.locator("[data-testid=report-tab][data-partner=Sarah]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Sarah,"));
    assert((await wsec("targets").getByTestId("section-note").innerText()).includes(TARGETS_NOTE), "Sarah's tab shows the Targets note typed in Jake's tab");
    assert((await wsec("top").getAttribute("data-included")) === "0", "Top 3 is not one of Sarah's sections");
    assert((await wsec("top").innerText()).includes("Left out today, note not sent"), await wsec("top").innerText());
    // Sarah today: Top 3 ticked (its note goes to her too), Targets left out (its note stays saved, not sent to her).
    await wsec("top").getByTestId("section-include").check();
    await until(async () => (await wsec("top").getAttribute("data-included")) === "1", "Top 3 in");
    await wsec("targets").getByTestId("section-include").uncheck();
    await until(async () => (await wsec("targets").getAttribute("data-included")) === "0", "Targets out");
    await page.waitForTimeout(1200);
    assert((await notesInDb()).targets === TARGETS_NOTE, "the Targets note is kept");
    // A typed edit with a note: the note follows the edited text.
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Jake,"));
    await wsec("targets").getByTestId("section-edit").click();
    await wsec("targets").getByTestId("section-edit-text").fill("Targets\n  - Two CIMs to screen first thing");
    await wsec("targets").getByTestId("section-edit-save").click();
    await until(async () => (await wsec("targets").getAttribute("data-edited")) === "1", "edited");
    const order = await wsec("targets").evaluate((e) => {
      const t = e.textContent;
      return [t.indexOf("Two CIMs to screen first thing"), t.indexOf("Two CIMs came in late")];
    });
    assert(order[1] >= 0 && order[0] > order[1], `the note is above the edited text (2026-11-06) ${JSON.stringify(order)}`);
  });

  await step("+ Note: Remove note takes it away (the button reads + Note again; the saved notes lose it)", async () => {
    await addNote("tomorrow", "A short one to remove.");
    await until(async () => (await notesInDb()).tomorrow === "A short one to remove.", "saved");
    await wsec("tomorrow").getByTestId("section-note-remove").click();
    await until(async () => (await wsec("tomorrow").getAttribute("data-note")) === "0", "gone from the window");
    assert((await wsec("tomorrow").getByTestId("section-note-open").innerText()) === "+ Note" && (await wsec("tomorrow").getByTestId("section-note-mark").count()) === 0, "back to + Note");
    await until(async () => !("tomorrow" in (await notesInDb())) && (await notesInDb()).top === TOP_NOTE, "removed from the saved notes only");
  });

  await step("Text not saved (Bram, 2026-11-06): a typed note or Edit not saved makes Close, Escape, another partner's tab and a browser reload ask first (Save, Discard, Keep editing); Save saves it, Discard drops it", async () => {
    const box = page.getByTestId("unsaved-warning");
    const line = () => page.getByTestId("unsaved-line").innerText();
    const labels = async () => [await page.getByTestId("unsaved-save").innerText(), await page.getByTestId("unsaved-discard").innerText(), await page.getByTestId("unsaved-keep").innerText()].join(" | ");
    await wsec("tomorrow").getByTestId("section-note-open").click();
    await wsec("tomorrow").getByTestId("section-note-text").fill("Typed, not saved.");
    assert(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), "a browser reload asks first");
    await page.getByTestId("report-window-close").click();
    await box.waitFor();
    assert(/^Your note in the .+ section is not saved\.$/.test(await line()) && (await labels()) === "Save | Discard | Keep editing", `${await line()} / ${await labels()}`);
    await page.getByTestId("unsaved-keep").click();
    await box.waitFor({ state: "detached" });
    assert((await wsec("tomorrow").getByTestId("section-note-text").inputValue()) === "Typed, not saved.", "Keep editing keeps the text");
    await page.keyboard.press("Escape");
    await box.waitFor();
    assert((await box.getAttribute("data-to")) === "close", "Escape asks too");
    await page.keyboard.press("Escape");
    await box.waitFor({ state: "detached" });
    assert(await win().isVisible(), "Escape on the question goes back to the box; the window stays");
    await page.locator("[data-testid=report-tab][data-partner=Sarah]").click();
    await box.waitFor();
    assert((await box.innerText()).includes("before you switch to Sarah's copy"), await box.innerText());
    await page.getByTestId("unsaved-discard").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Sarah,"));
    await page.waitForTimeout(600);
    assert(!("tomorrow" in (await notesInDb())), "Discard saved nothing");
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Jake,"));
    // An Edit typed and not saved asks the same way.
    await wsec("targets").getByTestId("section-edit").click();
    await wsec("targets").getByTestId("section-edit-text").fill("Targets\n  - Typed in Edit, not saved");
    await page.getByTestId("report-window-close").click();
    await box.waitFor();
    assert(/^Your edit to the .+ section is not saved\.$/.test(await line()), await line());
    await page.getByTestId("unsaved-discard").click();
    await win().waitFor({ state: "detached" });
    // Save from the question saves the note, then closes the window.
    await page.getByTestId("report-view").click();
    await win().waitFor();
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Jake,"));
    assert(!(await wsec("targets").innerText()).includes("Typed in Edit, not saved"), "the discarded Edit is gone");
    await wsec("tomorrow").getByTestId("section-note-open").click();
    await wsec("tomorrow").getByTestId("section-note-text").fill("Saved from the question.");
    await page.getByTestId("report-window-close").click();
    await box.waitFor();
    if (SHOTS) await win().screenshot({ path: path.join(SHOTS, "report-unsaved-question-1440.png") });
    await page.getByTestId("unsaved-save").click();
    await win().waitFor({ state: "detached" });
    await until(async () => (await notesInDb()).tomorrow === "Saved from the question.", "Save saved the note");
  });

  await step("Approve and send: 'Sending…' with the spinner, grayed; the sent emails carry the notes under their sections (HTML with the left rule, plain text with '| '), and a left-out section's note is not sent", async () => {
    await page.reload();
    await page.getByTestId("report-send").waitFor();
    await watchBusy(["report-send", "report-window-send"], "Sending…");
    const before = (await g("/__sent")).length;
    // Bram, 2026-11-06: Approve and send with a typed note not saved asks first; Save and send saves it, then sends it.
    await page.getByTestId("report-view").click();
    await win().waitFor();
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=report-preview]")?.textContent?.includes("Hey Jake,"));
    await wsec("tomorrow").getByTestId("section-note-open").click();
    await wsec("tomorrow").getByTestId("section-note-text").fill("Typed just before sending.");
    await page.getByTestId("report-window-send").click();
    await page.getByTestId("unsaved-warning").waitFor();
    assert((await page.getByTestId("unsaved-save").innerText()) === "Save and send" && (await page.getByTestId("unsaved-discard").innerText()) === "Send without it", "the send question's buttons");
    assert((await g("/__sent")).length === before, "nothing is sent while the question shows");
    await page.getByTestId("unsaved-save").click();
    const anyway = page.getByTestId("send-check-anyway");
    await Promise.race([anyway.waitFor({ timeout: 15000 }).then(() => anyway.click()), page.getByTestId("sent-line").waitFor({ timeout: 15000 })]).catch(() => {});
    await page.getByTestId("sent-line").waitFor({ timeout: 30000 });
    assert(await busySeen(), "Approve and send never showed 'Sending…' with a spinner while grayed");
    const mails = (await g("/__sent")).slice(before).filter((m) => /Daily report/.test(m.subject)).map((m) => ({ ...m, body: String(m.body).replace(/\r\n/g, "\n") }));
    const jake = mails.find((m) => m.to.includes("jake.morgan"));
    const sarah = mails.find((m) => m.to.includes("sarah.klein"));
    assert(jake && sarah, JSON.stringify(mails.map((m) => m.to)));
    assert(/<div data-note="1" style="[^"]*border-left:3px solid #1e40af[^"]*">Pinecrest is the one to watch\.<br>Dana wants the seller-note numbers before Friday&#39;s call\.<\/div>/.test(jake.html), "Jake's HTML has the Top 3 note");
    assert(jake.html.includes("Two CIMs came in late") && jake.body.includes("| Pinecrest is the one to watch.\n| Dana wants the seller-note numbers before Friday's call.") && jake.body.includes("| Two CIMs came in late"), "Jake's text part has both notes");
    assert(jake.html.includes("Typed just before sending."), "Save and send sent the note typed just before");
    assert(sarah.html.includes("Pinecrest is the one to watch.") && !sarah.html.includes("Two CIMs came in late") && !sarah.body.includes("Two CIMs came in late"), "Sarah gets the Top 3 note and not the left-out Targets note");
    if (SHOTS) {
      const view = await ctx.newPage();
      await view.setViewportSize({ width: 1440, height: 900 });
      await view.setContent(`<!doctype html><html><body style="margin:0;background:#f8fafc">${jake.html}</body></html>`);
      await view.screenshot({ path: path.join(SHOTS, "report-note-sent-email-1440.png"), fullPage: true });
      await view.close();
    }
    const snap = await one("select snapshot from partner_reports where period_start = $1 and contact_id = (select id from contacts where email = 'jake.morgan@example.com') and report_kind = 'end_of_day'", [today]);
    assert(snap.snapshot.notes && snap.snapshot.notes.top === TOP_NOTE, "the sent copy keeps its notes");
    // The send went through the View report window: close it (nothing is left unsaved, so no question).
    if (await win().count()) {
      await page.getByTestId("report-window-close").click();
      await win().waitFor({ state: "detached" });
    }
  });

  await step("A sent report re-shown on Reports (the centered sent-report window) and on End of day shows the note the same way", async () => {
    await page.getByTestId("report-view").click();
    await win().waitFor();
    await page.locator("[data-testid=report-tab][data-partner=Jake]").click();
    const eodNotes = await win().locator("[data-testid=report-preview] [data-note]").allInnerTexts();
    assert(eodNotes.some((t) => t.includes("Pinecrest is the one to watch.")), `End of day's sent copy ${JSON.stringify(eodNotes)}`);
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/work/reports?view=sent`);
    const row = page.locator(`[data-testid=sent-row][data-day="${today}"]`);
    await row.waitFor();
    await row.click();
    await page.getByTestId("sent-report-drawer").waitFor();
    const n = page.getByTestId("sent-html").locator("[data-note]").filter({ hasText: "Pinecrest is the one to watch." });
    await n.waitFor();
    const look = await n.evaluate((e) => ({ text: e.innerText, rule: getComputedStyle(e).borderLeftWidth, ruleColor: getComputedStyle(e).borderLeftColor, color: getComputedStyle(e).color }));
    assert(look.text.includes("Pinecrest is the one to watch.") && look.rule === "3px" && look.color === "rgb(15, 23, 42)" && look.ruleColor === "rgb(30, 64, 175)", JSON.stringify(look));
    await page.getByTestId("sent-close").click();
  });

  // Fix list item 1: a send with one partner unticked goes to the others only, and the day still closes as sent.
  // The day is re-opened the way UPDATE_PREVIEW_PUSH_F.sql re-opens Friday Nov 6 (the sent copies removed).
  await step("Approve and send with Sarah unticked: only Jake gets the email, signed with the Name in Settings; the day is marked sent; tomorrow everyone is ticked again", async () => {
    await db.query("begin");
    await db.query("select set_config('app.bulk_delete', 'on', true)");
    await db.query("delete from partner_reports where report_kind = 'end_of_day' and period_start = $1", [today]);
    await db.query("update end_of_day set status = 'open', sent_at = null, report_id = null, report_subject = null, report_html = null, report_edited = false, skipped_partners = '[]' where day = $1", [today]);
    await db.query("commit");
    // Fix list item 10: the email signs with the Name in Settings (its first word).
    await db.query("update owner_profile set display_name = 'Bram Frankel'");
    await eodTop();
    const sarah = page.locator("[data-testid=eod-partner][data-partner=Sarah]");
    await sarah.getByTestId("eod-partner-check").uncheck();
    await until(async () => (await sarah.getAttribute("data-on")) === "0", "Sarah unticked");
    const before = (await g("/__sent")).length;
    await page.getByTestId("report-send").click();
    const anyway = page.getByTestId("send-check-anyway");
    await Promise.race([anyway.waitFor({ timeout: 15000 }).then(() => anyway.click()), page.getByTestId("sent-line").waitFor({ timeout: 15000 })]).catch(() => {});
    await page.getByTestId("sent-line").waitFor({ timeout: 30000 });
    const mails = (await g("/__sent")).slice(before).filter((m) => /Daily report/.test(m.subject));
    const to = mails.map((m) => m.to);
    assert(to.length === 1 && to[0].includes("jake.morgan"), `sent to ${JSON.stringify(to)}`);
    const body = String(mails[0].body).replace(/\r\n/g, "\n").trimEnd();
    assert(/Thank you,\nBram$/.test(body) && String(mails[0].html).includes("Thank you,<br>Bram"), `the sign-off: ...${body.slice(-40)}`);
    const day = await one("select status from end_of_day where day = $1", [today]);
    assert(day.status === "sent", `the day is ${day.status}`);
    const tomorrowRow = await one("select count(*)::int n from end_of_day where day > $1 and skipped_partners <> '[]'", [today]);
    assert(tomorrowRow.n === 0, "no later day carries an unticked partner");
  });

  await step("Download the export (Monthly review) and Download full export (Settings): 'Preparing…' with a spinner and grayed until the file comes; then the button is back", async () => {
    const ym = today.slice(0, 7).split("-").map(Number);
    const slug = ym[1] === 1 ? `${ym[0] - 1}-12` : `${ym[0]}-${String(ym[1] - 1).padStart(2, "0")}`;
    await page.goto(`${BASE}/work/reports/monthly/${slug}`);
    const btn = page.getByTestId("monthly-export-download");
    await btn.waitFor();
    await watchBusy(["monthly-export-download"], "Preparing…");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), btn.click()]);
    assert(/bf-personal-app-export-.*\.zip$/.test(download.suggestedFilename()), download.suggestedFilename());
    assert(await busySeen(), "Download the export never showed 'Preparing…' with a spinner while grayed");
    await until(async () => (await btn.isEnabled()) && (await btn.innerText()).includes("Download the export"), "the button is back");
    await page.getByTestId("monthly-export").getByText("Downloaded just now").waitFor();
    // Finish the review: "Saving…" with the spinner.
    await watchBusy(["monthly-finish"], "Saving…");
    await page.getByTestId("monthly-finish").click();
    await page.getByTestId("monthly-finished").waitFor({ timeout: 30000 });
    assert(await busySeen(), "Finish the review never showed 'Saving…' with a spinner while grayed");
    await page.goto(`${BASE}/settings/export`);
    const full = page.getByTestId("settings-export-download");
    await full.waitFor();
    await watchBusy(["settings-export-download"], "Preparing…");
    const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), full.click()]);
    assert(/bf-personal-app-export-.*\.zip$/.test(d2.suggestedFilename()), d2.suggestedFilename());
    assert(await busySeen(), "Download full export never showed 'Preparing…' with a spinner while grayed");
    await until(async () => (await full.isEnabled()) && (await full.innerText()) === "Download full export", "the button is back");
  });

  await step("Remove sample data removes the waits", async () => {
    await page.goto(`${BASE}/settings/data`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("sample-remove").click();
    await page.waitForTimeout(500);
    const confirm = page.getByRole("button", { name: /Remove/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
    for (let i = 0; i < 40 && (await one("select count(*)::int n from sample_records")).n; i++) await page.waitForTimeout(500);
    const left = await one("select (select count(*)::int from sample_records) s, (select count(*)::int from waits) waits");
    assert(left.s === 0 && left.waits === 0, JSON.stringify(left));
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
